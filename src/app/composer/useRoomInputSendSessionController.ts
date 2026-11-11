import {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useStore } from 'jotai';
import { IContent, MatrixClient, Room } from 'matrix-js-sdk';
import { Descendant, Editor } from 'slate';
import {
  resetEditor,
  resetEditorHistory,
  restoreEditorContent,
} from '../editor/utils';
import { IReplyDraft, roomUploadAtomFamily, voiceComposerKey } from './roomInputDrafts';
import { useInConversationView } from '../navigation/conversationView';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { TUploadItem, Upload } from '../matrix/state/upload';
import type { RoomInputAttachmentAccess } from './roomInputAttachmentAccess';
import { TUploadContent } from '../matrix/matrix';
import { isSignalBridgeRoom } from '../matrix/bridgeDetection';
import {
  buildLongTextPreview,
  contentBytes,
  MAX_EVENT_CONTENT_BYTES,
} from '../matrix/protocol/longText';
import { uploadLongTextSidecar } from '../matrix/send/longTextSidecarUpload';
import { createPasteMarker } from '../matrix/protocol/pasteAttachmentMarker';
import { discardFailedLocalEcho } from '../matrix/protocol/pendingLocalEcho';
import {
  createRoomInputSendSessionState,
  getTextRelationForSendSession,
  getUploadRelationForSendSession,
  hasRoomInputSendFailures,
  isRoomInputSendSessionStalled,
  resolveRoomInputSendStep,
  RoomInputSendSessionState,
} from './roomInputSendSession';
import { getRoomMessageSentNotificationEventId } from '../event-store/timeline/roomMessageSent';

type SendSession = RoomInputSendSessionState & {
  room: Room;
  roomId: string;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  textContent?: IContent;
  composerFallback?: Descendant[];
  composerContext: ComposerContext;
  replyCleared: boolean;
  signalBridgedRoom: boolean;
  failFast: boolean;
  uploads?: Upload[];
  onUploadSent?: (file: TUploadContent) => void;
  /** What the session uses of the composer that started it, taken at Send. */
  composer: SessionComposer;
};

type ComposerContext = Pick<RoomInputSendContext, 'roomId' | 'threadId'>;

type SessionComposer = {
  attachments: RoomInputAttachmentAccess;
  buildUploadMessageContent: UseRoomInputSendSessionControllerOptions['buildUploadMessageContent'];
  clearReplyDraft: UseRoomInputSendSessionControllerOptions['clearReplyDraft'];
  /** Puts a caption back: in the editor while it shows `context`, else in its stored draft. */
  restoreText: (context: ComposerContext, fragment: Descendant[]) => void;
  /** Reports a sent room message, only while the composer is mounted and shows `context`. */
  reportSent: (context: ComposerContext, eventId: string) => void;
  /** False once the composer unmounted: no one can retry the session's files then. */
  mounted: () => boolean;
};

/**
 * The sends of one composer: the session going out, the sends queued behind it, and the texts
 * sent beside one that waits for the person. It outlives the composer: as the composer unmounts
 * with a send under way, the slot is parked under the composer's key (`voiceComposerKey`), and
 * the next composer mounting for that key takes it over.
 */
type SendSlot = {
  session?: SendSession;
  processing: boolean;
  queued: (() => void)[];
  textsBeside: Promise<void>;
  /** Ends the session's watch of its uploads. */
  stopWatching?: () => void;
  listeners: Set<() => void>;
  /** The session came from a composer that unmounted. */
  adopted: boolean;
  /** Takes the slot out of the parked ones. */
  unpark?: () => void;
  /** Parks the slot again under the key of the session it holds now. */
  repark?: () => void;
  /** Starts a send with the composer holding the slot, for the sends queued in it. */
  start?: (options: StartRoomInputSendSessionOptions, slot: SendSlot) => Promise<void>;
};

const createSendSlot = (): SendSlot => ({
  processing: false,
  queued: [],
  textsBeside: Promise.resolve(),
  listeners: new Set(),
  adopted: false,
});

// Per client: the slots parked by composer key, and the slots with a session going out.
const parkedSlots = new WeakMap<MatrixClient, Map<string, SendSlot>>();
const busySlots = new WeakMap<MatrixClient, Set<SendSlot>>();

const ofClient = <T>(map: WeakMap<MatrixClient, T>, mx: MatrixClient, create: () => T): T => {
  if (!map.has(mx)) map.set(mx, create());
  return map.get(mx) as T;
};
const parkedSlotsOf = (mx: MatrixClient) => ofClient(parkedSlots, mx, () => new Map());
const busySlotsOf = (mx: MatrixClient) => ofClient(busySlots, mx, () => new Set());

const notifySlot = (slot: SendSlot) => slot.listeners.forEach((listener) => listener());

export type RoomInputSendContext = {
  roomId: string;
  room: Room;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  signalBridgedRoom: boolean;
};

export type StartRoomInputSendSessionOptions = {
  textContent?: IContent;
  batch?: {
    fileItems: TUploadItem[];
    uploads: Upload[];
  };
  context?: RoomInputSendContext;
  completeWithinCall?: boolean;
  composerFallback?: Descendant[];
  composerContext?: ComposerContext;
  composerAlreadyReset?: boolean;
  onUploadSent?: (file: TUploadContent) => void;
};

export type RoomInputReplyDraftContext = Pick<RoomInputSendContext, 'roomId' | 'replyDraft'>;

type UseRoomInputSendSessionControllerOptions = {
  mx: MatrixClient;
  room: Room;
  roomId: string;
  threadId?: string;
  replyDraft?: IReplyDraft;
  threadingEnabled?: boolean;
  clearReplyDraft: (context: RoomInputReplyDraftContext) => void;
  editor: Editor;
  sendTypingStatus: (typing: boolean) => void;
  attachments: RoomInputAttachmentAccess;
  mountedRef?: MutableRefObject<boolean>;
  buildUploadMessageContent: (
    fileItem: TUploadItem,
    mxc: string,
    signalBridgedRoom: boolean
  ) => Promise<IContent>;
  restoreComposerFallbackForRoom?: (
    roomId: string,
    fragment: Descendant[],
    threadId?: string
  ) => void;
  onRoomMessageSent?: (eventId: string) => boolean | void;
};

const getTextContentStrings = (content: IContent | undefined): string[] => {
  if (!content) return [];

  return [content.body, content.formatted_body].filter(
    (value): value is string => typeof value === 'string'
  );
};

export const hasFailedPasteMarkerInText = (
  textContent: IContent | undefined,
  fileItems: TUploadItem[]
): boolean => {
  const textValues = getTextContentStrings(textContent);
  if (textValues.length === 0) return false;

  return fileItems.some((fileItem) => {
    const pasteMetadata = fileItem.prepError
      ? fileItem.metadata.mindroomPasteAttachment
      : undefined;
    if (!pasteMetadata) return false;

    let marker: string;
    try {
      marker = createPasteMarker({
        id: pasteMetadata.id,
        chars: pasteMetadata.chars,
        fileName: pasteMetadata.fileName,
      });
    } catch {
      return false;
    }
    return textValues.some((text) => text.includes(marker));
  });
};

const createSendSession = (
  context: RoomInputSendContext,
  files: TUploadContent[],
  fields: Pick<
    SendSession,
    | 'textContent'
    | 'composerFallback'
    | 'composerContext'
    | 'failFast'
    | 'uploads'
    | 'onUploadSent'
    | 'composer'
  >
): SendSession => ({
  ...fields,
  room: context.room,
  roomId: context.roomId,
  threadId: context.threadId,
  replyDraft: context.replyDraft,
  threadingEnabled: context.threadingEnabled,
  signalBridgedRoom: context.signalBridgedRoom,
  replyCleared: false,
  ...createRoomInputSendSessionState({
    files,
    hasText: Boolean(fields.textContent),
    threadId: context.threadId,
    replyDraft: context.replyDraft,
    threadingEnabled: context.threadingEnabled,
  }),
});

const clearReplyDraftForSession = (session: SendSession) => {
  if (session.replyCleared) return;

  session.replyCleared = true;
  session.composer.clearReplyDraft({
    roomId: session.roomId,
    replyDraft: session.replyDraft,
  });
};

const restoreComposerFallback = (session: SendSession) => {
  // A caption that failed before it had a row of its own (its long-text file did not
  // upload, or an earlier upload of a lifecycle-complete send failed) goes back into the
  // composer instead of parking in the session: by then the uploads have left the board, so
  // the board's Send-again affordance that resumes a blocked session no longer exists.
  session.textPending = false;
  const fragment = session.composerFallback;
  session.composerFallback = undefined;
  if (fragment) session.composer.restoreText(session.composerContext, fragment);
};

const getSessionUploads = (session: SendSession): [Upload[], TUploadContent[]] => {
  const { staged, enrolled, uploads } = session.composer.attachments.snapshot(session.roomId);
  const activeFiles = new Set([...staged, ...enrolled].map((fileItem) => fileItem.file));
  return [session.uploads ?? uploads, Array.from(activeFiles)];
};

const isSessionStalled = (session: SendSession) =>
  isRoomInputSendSessionStalled(session, ...getSessionUploads(session));

// Queued texts go out one at a time once the session is done, and all of them at once when it
// can only go on after the person retries an attachment: they never wait for that.
const releaseQueuedSends = (sendSlot: SendSlot) => {
  const session = sendSlot.session;
  if (!session) {
    sendSlot.queued.shift()?.();
  } else if (isSessionStalled(session)) {
    sendSlot.queued.splice(0).forEach((startQueued) => startQueued());
  }
};

export const useRoomInputSendSessionController = ({
  mx,
  room,
  roomId,
  threadId,
  replyDraft,
  threadingEnabled = true,
  clearReplyDraft,
  editor,
  sendTypingStatus,
  attachments,
  mountedRef,
  buildUploadMessageContent,
  restoreComposerFallbackForRoom,
  onRoomMessageSent,
}: UseRoomInputSendSessionControllerOptions): {
  hasActiveSendSession: () => boolean;
  /** A send this composer took over from one that unmounted is still going out. */
  joinedSendPending: boolean;
  processSendSession: () => Promise<void>;
  startSendSession: (options?: StartRoomInputSendSessionOptions) => Promise<void>;
} => {
  const store = useStore();
  const threadView = useInConversationView();
  const [slot, setSlot] = useState(createSendSlot);
  const slotRef = useRef(slot);
  slotRef.current = slot;
  const composerKey = voiceComposerKey({ roomId, threadId, threadView });
  const composerKeyRef = useLatestRef(composerKey);
  const composerContextRef = useRef({ roomId, threadId });
  composerContextRef.current = { roomId, threadId };
  const onRoomMessageSentRef = useLatestRef(onRoomMessageSent);

  const isMounted = useCallback(() => mountedRef?.current ?? true, [mountedRef]);
  const showsContext = useCallback(
    (context: ComposerContext) =>
      isMounted() &&
      composerContextRef.current.roomId === context.roomId &&
      composerContextRef.current.threadId === context.threadId,
    [isMounted]
  );
  const restoreText = useCallback(
    (context: ComposerContext, fragment: Descendant[]) => {
      if (showsContext(context)) restoreEditorContent(editor, fragment);
      else restoreComposerFallbackForRoom?.(context.roomId, fragment, context.threadId);
    },
    [editor, restoreComposerFallbackForRoom, showsContext]
  );
  // A composer that went, or shows another room or thread, does not open the sent thread.
  const reportSent = useCallback(
    (context: ComposerContext, eventId: string) => {
      if (showsContext(context)) onRoomMessageSentRef.current?.(eventId);
    },
    [onRoomMessageSentRef, showsContext]
  );

  const sendSessionText = useCallback(
    async (session: SendSession) => {
      if (!session.textContent) return;

      const relation = getTextRelationForSendSession(session);
      const content: IContent = relation
        ? {
            ...session.textContent,
            'm.relates_to': relation,
          }
        : session.textContent;
      // Content too large for one event goes as a long-text sidecar, as MindRoom's long replies do.
      // A failed upload throws before anything is sent, so the text returns to the composer.
      const eventContent =
        contentBytes(content) <= MAX_EVENT_CONTENT_BYTES
          ? content
          : await uploadLongTextSidecar(
              mx,
              session.room,
              content,
              buildLongTextPreview(content)
            );
      const txnId = mx.makeTxnId();
      const sendPromise = mx.sendMessage(session.roomId, eventContent as any, txnId);
      const localEvent = session.room.getEventForTxnId(txnId);
      const localEventId = localEvent?.getId();
      let roomMessageSentNotified = false;

      const notifyRoomMessageSent = (eventId: string | undefined) => {
        if (!eventId || roomMessageSentNotified) return;

        const sentEventIdToNotify = getRoomMessageSentNotificationEventId({
          eventId,
          relation,
          replyDraft: session.replyDraft,
          threadId: session.threadId,
        });
        if (!sentEventIdToNotify) return;

        roomMessageSentNotified = true;
        session.composer.reportSent(session.composerContext, sentEventIdToNotify);
      };

      if (localEventId === `~${session.roomId}:${txnId}`) {
        notifyRoomMessageSent(localEventId);
      }

      const sent = sendPromise.then((response) => notifyRoomMessageSent(response.event_id));
      if (localEvent) {
        // The message has its own row from here on: pending, then sent, or "Not sent" with Retry
        // and Delete. So the session does not wait for the server, and the client's queue sends
        // the next message after this one.
        sent.catch(() => undefined);
      } else {
        // Without a row of its own, a failed text goes back to the composer.
        await sent;
      }

      session.textPending = false;
      clearReplyDraftForSession(session);
    },
    [mx]
  );

  const sendSessionUpload = useCallback(
    async (session: SendSession, file: TUploadContent, mxc: string, isRoot: boolean) => {
      const { attachments, buildUploadMessageContent } = session.composer;
      const { staged, enrolled } = attachments.snapshot(session.roomId);
      const fileItem =
        staged.find((item) => item.file === file) ?? enrolled.find((item) => item.file === file);
      if (!fileItem) {
        throw new Error('Missing upload item for send session.');
      }

      const content = await buildUploadMessageContent(fileItem, mxc, session.signalBridgedRoom);
      const relation = getUploadRelationForSendSession(session, isRoot);
      const contentWithRelation: IContent = relation
        ? {
            ...content,
            'm.relates_to': relation,
          }
        : content;
      const txnId = mx.makeTxnId();
      const response = await mx
        .sendMessage(session.roomId, contentWithRelation as any, txnId)
        .catch((error: unknown) => {
          // The composer keeps the attachment to send again; drop the unsent echo.
          discardFailedLocalEcho(mx, session.room.getEventForTxnId(txnId));
          throw error;
        });
      const sentEventIdToNotify = getRoomMessageSentNotificationEventId({
        eventId: response.event_id,
        relation,
        replyDraft: session.replyDraft,
        threadId: session.threadId,
      });

      session.sentFiles.add(file);
      session.failedFiles.delete(file);
      if (session.mode === 'auto-thread-upload-root' && isRoot) {
        session.rootEventId = response.event_id;
      }
      session.onUploadSent?.(file);
      clearReplyDraftForSession(session);
      // The composer that took the send over meanwhile holds the file now.
      session.composer.attachments.remove(session.roomId, [file]);
      if (sentEventIdToNotify) {
        session.composer.reportSent(session.composerContext, sentEventIdToNotify);
      }
    },
    [mx]
  );

  const clearSendSession = useCallback((sendSlot: SendSlot) => {
    const session = sendSlot.session;
    sendSlot.session = undefined;
    busySlotsOf(mx).delete(sendSlot);
    sendSlot.stopWatching?.();
    sendSlot.stopWatching = undefined;
    sendSlot.adopted = false;
    if (sendSlot.queued.length === 0) sendSlot.unpark?.();
    session?.composer.attachments.clearEnrollment(session.orderedFiles);
    notifySlot(sendSlot);
  }, [mx]);

  const processSendSession = useCallback(async (sendSlot: SendSlot = slotRef.current) => {
    if (sendSlot.processing) return;

    sendSlot.processing = true;
    try {
      while (sendSlot.session) {
        const session = sendSlot.session;

        const step = resolveRoomInputSendStep(session, ...getSessionUploads(session));

        if (step.kind === 'wait') {
          // Once its composer went, no one can retry or remove the files it waits for.
          if (!session.composer.mounted() && isSessionStalled(session)) clearSendSession(sendSlot);
          return;
        }
        if (step.kind === 'complete') {
          clearSendSession(sendSlot);
          return;
        }

        if (step.kind === 'send-text') {
          try {
            await sendSessionText(session);
          } catch (error) {
            // Only a text that never got a row of its own fails here.
            restoreComposerFallback(session);
            if (session.failFast) {
              throw error;
            }
          }
          continue;
        }

        try {
          await sendSessionUpload(session, step.file, step.mxc, step.isRoot);
        } catch (error) {
          if (session.failFast) {
            throw error;
          }
          if (step.isRoot) {
            // The caption goes on without it (resolveRoomInputSendStep).
            session.blockedRoot = true;
            continue;
          }
          session.failedFiles.add(step.file);
        }
      }
    } finally {
      sendSlot.processing = false;
      releaseQueuedSends(sendSlot);
    }
  }, [
    sendSessionText,
    sendSessionUpload,
    clearSendSession,
  ]);

  const startSendSession = useCallback(
    async ({
      textContent,
      batch,
      context,
      completeWithinCall = false,
      composerFallback,
      composerContext,
      composerAlreadyReset = false,
      onUploadSent,
    }: StartRoomInputSendSessionOptions = {}, sendSlot: SendSlot = slotRef.current) => {
      // The session takes what it needs of this composer now: it may outlive it.
      const composer: SessionComposer = {
        attachments,
        buildUploadMessageContent,
        clearReplyDraft,
        restoreText,
        reportSent,
        mounted: isMounted,
      };
      const existingSession = sendSlot.session;
      if (existingSession) {
        if (completeWithinCall) {
          throw new Error(
            'Cannot start a lifecycle-complete send while another session is active.'
          );
        }
        if (hasRoomInputSendFailures(existingSession) && !composerAlreadyReset) {
          // Send again: the attachments whose send failed go out again; text being sent stays
          // in the composer meanwhile.
          existingSession.blockedRoot = false;
          existingSession.failedFiles.clear();
          await processSendSession(sendSlot);
          return;
        }
        // Repeated sends while uploads are still resolving should not create duplicate events.
        if (!textContent) return;
        if (hasFailedPasteMarkerInText(textContent, attachments.snapshot(context?.roomId).staged)) {
          return;
        }
        // The composer takes the message now, as it does any message; the reply draft the earlier
        // message took stays with that one.
        const nextFallback = composerFallback ?? structuredClone(editor.children);
        if (!composerAlreadyReset) {
          resetEditor(editor); resetEditorHistory(editor);
          sendTypingStatus(false);
        }
        const nextContext: RoomInputSendContext = context ?? {
          roomId,
          room,
          threadId,
          replyDraft: replyDraft === existingSession.replyDraft ? undefined : replyDraft,
          threadingEnabled,
          signalBridgedRoom: isSignalBridgeRoom(room),
        };
        const nextComposerContext = composerContext ?? { roomId, threadId };
        if (isSessionStalled(existingSession)) {
          // The session waits for the person to retry an attachment; the text does not wait
          // with it and gets its row at once.
          const session = createSendSession(nextContext, [], {
            textContent,
            composerFallback: nextFallback,
            composerContext: nextComposerContext,
            failFast: false,
            composer,
          });
          const sending = sendSlot.textsBeside.then(() =>
            sendSessionText(session).catch(() => restoreComposerFallback(session))
          );
          sendSlot.textsBeside = sending;
          await sending;
          return;
        }
        // Otherwise it follows the message still going out, in order.
        sendSlot.queued.push(() => {
          sendSlot
            .start?.({
              textContent,
              context: nextContext,
              composerFallback: nextFallback,
              composerContext: nextComposerContext,
              composerAlreadyReset: true,
              onUploadSent,
            }, sendSlot)
            .catch((error: unknown) => {
              // eslint-disable-next-line no-console
              console.warn('[room-input] could not send the queued message', error);
            });
        });
        return;
      }

      const { staged } = attachments.snapshot(context?.roomId);
      // A file goes with one send at a time: one another send holds stays with that one.
      const heldFiles = new Set(
        [...busySlotsOf(mx)].flatMap((busy) => busy.session?.orderedFiles ?? [])
      );
      const sendItems = (batch?.fileItems ?? staged).filter(
        (fileItem) => !fileItem.prepError && !heldFiles.has(fileItem.file)
      );
      const sendFiles = sendItems.map((item) => item.file);
      if (sendFiles.length === 0 && !textContent) return;
      if (hasFailedPasteMarkerInText(textContent, staged)) return;
      attachments.enroll(sendItems);

      const session = createSendSession(
        context ?? {
          roomId,
          room,
          threadId,
          replyDraft,
          threadingEnabled,
          signalBridgedRoom: isSignalBridgeRoom(room),
        },
        sendFiles,
        {
          textContent,
          composerContext: composerContext ?? { roomId, threadId },
          failFast: completeWithinCall,
          uploads: batch?.uploads,
          onUploadSent,
          composer,
        }
      );
      sendSlot.session = session;
      busySlotsOf(mx).add(sendSlot);
      // A send queued in a parked slot waits there under its own key.
      sendSlot.repark?.();
      // The session wakes on its own uploads, with or without its composer.
      const unsubscribes = sendFiles.map((file) =>
        store.sub(roomUploadAtomFamily(file), () =>
          queueMicrotask(() => void processSendSession(sendSlot))
        )
      );
      sendSlot.stopWatching = () => unsubscribes.forEach((unsubscribe) => unsubscribe());
      if (textContent) {
        // The caption sends last (after the uploads), so free the composer as soon as the
        // session has snapshotted the text instead of when the text event goes out. Keep a
        // clone of the composer content so a caption that never gets a row of its own can be
        // restored (slate mutates editor.children in place).
        session.composerFallback = composerFallback ?? structuredClone(editor.children);
        if (!composerAlreadyReset) {
          // Start the editor over, and stop the typing indicator, now that its text is captured.
          resetEditor(editor); resetEditorHistory(editor);
          sendTypingStatus(false);
        }
      }
      try {
        await processSendSession(sendSlot);
      } catch (error) {
        if (completeWithinCall) {
          const failedSession = sendSlot.session;
          if (failedSession?.textPending) {
            restoreComposerFallback(failedSession);
          }
          clearSendSession(sendSlot);
        }
        throw error;
      }
      if (completeWithinCall && sendSlot.session) {
        clearSendSession(sendSlot);
        throw new Error('Lifecycle-complete send did not finish within the initiating call.');
      }
    },
    [
      roomId,
      threadId,
      replyDraft,
      threadingEnabled,
      room,
      editor,
      sendTypingStatus,
      attachments,
      buildUploadMessageContent,
      clearReplyDraft,
      restoreText,
      reportSent,
      isMounted,
      mx,
      store,
      processSendSession,
      sendSessionText,
      clearSendSession,
    ]
  );

  useEffect(() => {
    let disposed = false;
    let queued = false;
    const wake = () => {
      if (queued) return;
      queued = true;
      // Attachment updates can render synchronously inside enrollment/removal. Defer
      // processing until the initiating operation finishes updating the send session.
      queueMicrotask(() => {
        queued = false;
        if (!disposed) void processSendSession(slot);
      });
    };
    const unsubscribe = attachments.subscribe(wake);
    wake();
    return () => {
      disposed = true;
      unsubscribe();
      // A session left waiting for the person ends with its composer (processSendSession).
      queueMicrotask(() => void processSendSession(slot));
    };
  }, [attachments, processSendSession, slot]);

  slot.start = startSendSession;

  // A composer showing the key of one that unmounted with a send under way, as it mounts or moves
  // there, takes that send over: its board shows the files still to go, which it can cancel or
  // retry, and its sends follow that one.
  useEffect(() => {
    const own = slotRef.current;
    if (own.session || own.queued.length > 0) return;
    const parked = parkedSlotsOf(mx).get(composerKey);
    const session = parked?.session;
    if (!parked || !session || session.failFast) return;
    parked.unpark?.();
    parked.unpark = undefined;
    parked.repark = undefined;
    const { staged, enrolled } = session.composer.attachments.snapshot(session.roomId);
    const items = new Map(
      // The board's copy of a file is the newest.
      [...enrolled, ...staged]
        .filter(
          (item) => session.orderedFiles.includes(item.file) && !session.sentFiles.has(item.file)
        )
        .map((item) => [item.file, item])
    );
    session.composer = {
      ...session.composer,
      attachments,
      restoreText,
      reportSent,
      mounted: isMounted,
    };
    attachments.append(session.roomId, [...items.values()]);
    attachments.enroll([...items.values()]);
    parked.adopted = true;
    slotRef.current = parked;
    setSlot(parked);
  }, [attachments, composerKey, isMounted, mx, reportSent, restoreText]);

  // Unmounting with a send under way parks it for the next composer of the same key.
  useEffect(
    () => () => {
      const current = slotRef.current;
      const { session } = current;
      if (!session && current.queued.length === 0) return;
      const parked = parkedSlotsOf(mx);
      const park = () => {
        current.unpark?.();
        const key = current.session
          ? voiceComposerKey({ ...current.session.composerContext, threadView })
          : composerKeyRef.current;
        // A key another send still waits under stays that send's.
        if (parked.get(key)?.session) return;
        parked.set(key, current);
        current.unpark = () => {
          if (parked.get(key) === current) parked.delete(key);
        };
      };
      current.repark = park;
      park();
    },
    [composerKeyRef, mx, threadView]
  );

  const joinedSendPending = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        slot.listeners.add(listener);
        return () => slot.listeners.delete(listener);
      },
      [slot]
    ),
    () => slot.adopted
  );

  const hasActiveSendSession = useCallback(() => slotRef.current.session !== undefined, []);

  return {
    hasActiveSendSession,
    joinedSendPending,
    processSendSession,
    startSendSession,
  };
};
