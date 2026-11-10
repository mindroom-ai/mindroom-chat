import { MutableRefObject, useContext, useEffect, useLayoutEffect } from 'react';
import { useStore } from 'jotai';
import { IContent, MatrixClient, Room } from 'matrix-js-sdk';
import { Descendant, Editor } from 'slate';
import { resetEditor, resetEditorHistory, restoreEditorContent } from '../editor/utils';
import { IReplyDraft } from './roomInputDrafts';
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
import { ConversationViewContext } from '../navigation/conversationView';

type SendSession = RoomInputSendSessionState & {
  room: Room;
  roomId: string;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  textContent?: IContent;
  composerFallback?: Descendant[];
  composerContext: Pick<RoomInputSendContext, 'roomId' | 'threadId'>;
  replyCleared: boolean;
  signalBridgedRoom: boolean;
  failFast: boolean;
  uploads?: Upload[];
  onUploadSent?: (file: TUploadContent) => void;
  stopWatching?: () => void;
};

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
  composerContext?: Pick<RoomInputSendContext, 'roomId' | 'threadId'>;
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
    'textContent' | 'composerFallback' | 'composerContext' | 'failFast' | 'uploads' | 'onUploadSent'
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

type RoomInputSendController = {
  hasActiveSendSession: () => boolean;
  processSendSession: () => Promise<void>;
  startSendSession: (options?: StartRoomInputSendSessionOptions) => Promise<void>;
};

type ComposerSendController = {
  api: RoomInputSendController;
  /** The files the session under way claimed (a sent one has left the staged files). */
  claimed: () => TUploadContent[];
  /** The composer on screen lends the controller what it uses from now on. */
  bind: (composer: UseRoomInputSendSessionControllerOptions) => void;
  /** A composer mounts with its attachments; returns its unmount. */
  mount: (attachments: RoomInputAttachmentAccess) => () => void;
};

/**
 * The sends of one composer, from Enter to delivery: the session, the messages queued behind it,
 * and the texts that go beside a session waiting for a retry. It outlives the composer. The
 * composer on screen lends it the editor, the attachments and the callbacks, read as they are
 * used; after the composer unmounts it keeps the last ones, and the session's own watch on the
 * uploads it waits for wakes it. A session that can only go on after a retry ends once no
 * composer is mounted, as it did with its composer before: its files stay staged for another
 * send. `release` runs once the controller is idle with no composer mounted.
 */
const createSendController = (release: () => void): ComposerSendController => {
  let composer!: UseRoomInputSendSessionControllerOptions;
  let sendSession: SendSession | undefined;
  let processing = false;
  let mounted = 0;
  // Messages sent while another is still going out, each started once the one before is done.
  const queuedSends: (() => void)[] = [];
  // Texts sent beside a session that waits for the person, one after the other.
  let textsBeside: Promise<void> = Promise.resolve();
  let wakeQueued = false;

  const wake = () => {
    if (wakeQueued) return;
    wakeQueued = true;
    // Attachment updates can render synchronously inside enrollment/removal. Defer
    // processing until the initiating operation finishes updating the send session.
    queueMicrotask(() => {
      wakeQueued = false;
      void processSendSession();
    });
  };

  const clearReplyDraftForSession = (session: SendSession) => {
    if (session.replyCleared) return;

    session.replyCleared = true;
    composer.clearReplyDraft({
      roomId: session.roomId,
      replyDraft: session.replyDraft,
    });
  };

  // A sent message opens its thread only in a composer that still shows its room.
  const openSentMessage = (session: SendSession, eventId: string): boolean => {
    const { onRoomMessageSent, mountedRef, roomId } = composer;
    if (!onRoomMessageSent || !(mountedRef?.current ?? true) || roomId !== session.roomId) {
      return false;
    }
    onRoomMessageSent(eventId);
    return true;
  };

  const sendSessionText = async (session: SendSession) => {
    if (!session.textContent) return;

    const { mx } = composer;
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
        : await uploadLongTextSidecar(mx, session.room, content, buildLongTextPreview(content));
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

      roomMessageSentNotified = openSentMessage(session, sentEventIdToNotify);
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
  };

  const sendSessionUpload = async (
    session: SendSession,
    file: TUploadContent,
    mxc: string,
    isRoot: boolean
  ) => {
    const { mx } = composer;
    const { staged, enrolled } = composer.attachments.snapshot(session.roomId);
    const fileItem =
      staged.find((item) => item.file === file) ?? enrolled.find((item) => item.file === file);
    if (!fileItem) {
      throw new Error('Missing upload item for send session.');
    }

    const content = await composer.buildUploadMessageContent(
      fileItem,
      mxc,
      session.signalBridgedRoom
    );
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
    composer.attachments.remove(session.roomId, [file]);
    if (sentEventIdToNotify) {
      openSentMessage(session, sentEventIdToNotify);
    }
  };

  const restoreComposerFallback = (session: SendSession) => {
    // A caption that failed before it had a row of its own (its long-text file did not
    // upload, or an earlier upload of a lifecycle-complete send failed) goes back into the
    // composer instead of parking in the session: by then the uploads have left the board, so
    // the board's Send-again affordance that resumes a blocked session no longer exists.
    session.textPending = false;
    const fragment = session.composerFallback;
    session.composerFallback = undefined;
    const { editor, mountedRef, restoreComposerFallbackForRoom } = composer;
    const sameComposer =
      composer.roomId === session.composerContext.roomId &&
      composer.threadId === session.composerContext.threadId;
    if (fragment && (mountedRef?.current ?? true) && sameComposer) {
      restoreEditorContent(editor, fragment);
    } else if (fragment) {
      restoreComposerFallbackForRoom?.(
        session.composerContext.roomId,
        fragment,
        session.composerContext.threadId
      );
    }
  };

  const clearSendSession = () => {
    sendSession?.stopWatching?.();
    sendSession = undefined;
    composer.attachments.clearEnrollment();
  };

  const getSessionUploads = (session: SendSession): [Upload[], TUploadContent[]] => {
    const { staged, enrolled, uploads } = composer.attachments.snapshot(session.roomId);
    const activeFiles = new Set([...staged, ...enrolled].map((fileItem) => fileItem.file));
    return [session.uploads ?? uploads, Array.from(activeFiles)];
  };

  const isSessionStalled = (session: SendSession) =>
    isRoomInputSendSessionStalled(session, ...getSessionUploads(session));

  // Queued texts go out one at a time once the session is done, and all of them at once when it
  // can only go on after the person retries an attachment: they never wait for that.
  const releaseQueuedSends = () => {
    const session = sendSession;
    if (!session) {
      queuedSends.shift()?.();
    } else if (isSessionStalled(session)) {
      queuedSends.splice(0).forEach((startQueued) => startQueued());
    }
  };

  const processSendSession = async () => {
    if (processing) return;

    processing = true;
    try {
      while (sendSession) {
        const session = sendSession;

        const step = resolveRoomInputSendStep(session, ...getSessionUploads(session));

        if (step.kind === 'wait') {
          // Without a composer nothing shows the retry this session waits for.
          if (mounted === 0 && isSessionStalled(session)) clearSendSession();
          return;
        }
        if (step.kind === 'complete') {
          clearSendSession();
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
            // The caption goes on its own (see `resolveRoomInputSendStep`).
            session.blockedRoot = true;
            continue;
          }
          session.failedFiles.add(step.file);
        }
      }
    } finally {
      processing = false;
      releaseQueuedSends();
      if (mounted === 0 && !sendSession && queuedSends.length === 0) release();
    }
  };

  const startSendSession = async ({
    textContent,
    batch,
    context,
    completeWithinCall = false,
    composerFallback,
    composerContext,
    composerAlreadyReset = false,
    onUploadSent,
  }: StartRoomInputSendSessionOptions = {}) => {
    const {
      roomId,
      room,
      threadId,
      replyDraft,
      threadingEnabled = true,
      editor,
      sendTypingStatus,
      attachments,
    } = composer;
    const existingSession = sendSession;
    if (existingSession) {
      if (completeWithinCall) {
        throw new Error('Cannot start a lifecycle-complete send while another session is active.');
      }
      if (hasRoomInputSendFailures(existingSession) && !composerAlreadyReset) {
        // Send again: the attachments whose send failed go out again; text being sent stays
        // in the composer meanwhile.
        existingSession.blockedRoot = false;
        existingSession.failedFiles.clear();
        await processSendSession();
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
        });
        const sending = textsBeside.then(() =>
          sendSessionText(session).catch(() => restoreComposerFallback(session))
        );
        textsBeside = sending;
        await sending;
        return;
      }
      // Otherwise it follows the message still going out, in order.
      queuedSends.push(() => {
        startSendSession({
          textContent,
          context: nextContext,
          composerFallback: nextFallback,
          composerContext: nextComposerContext,
          composerAlreadyReset: true,
          onUploadSent,
        }).catch((error: unknown) => {
          // eslint-disable-next-line no-console
          console.warn('[room-input] could not send the queued message', error);
        });
      });
      return;
    }

    const { staged } = attachments.snapshot(context?.roomId);
    const sendItems = (batch?.fileItems ?? staged).filter((fileItem) => !fileItem.prepError);
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
      }
    );
    // The session follows its own uploads, so it goes on when no composer is left to tell it.
    session.stopWatching = attachments.watchUploads(sendFiles, wake);
    sendSession = session;
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
      await processSendSession();
    } catch (error) {
      if (completeWithinCall) {
        const failedSession = sendSession;
        if (failedSession?.textPending) {
          restoreComposerFallback(failedSession);
        }
        clearSendSession();
      }
      throw error;
    }
    if (completeWithinCall && sendSession) {
      clearSendSession();
      throw new Error('Lifecycle-complete send did not finish within the initiating call.');
    }
  };

  const controller: ComposerSendController = {
    api: {
      hasActiveSendSession: () => sendSession !== undefined,
      processSendSession,
      startSendSession,
    },
    claimed: () => sendSession?.orderedFiles ?? [],
    bind: (next) => {
      composer = next;
    },
    mount: (attachments) => {
      mounted += 1;
      // A composer that mounts while a send an earlier one started is under way claims that
      // send's files still staged again (not those sent or removed), so it neither drops them nor
      // sends them twice.
      if (sendSession) {
        const claimed = new Set(controller.claimed());
        attachments.enroll(
          attachments.snapshot(sendSession.roomId).staged.filter((item) => claimed.has(item.file))
        );
      }
      const unsubscribe = attachments.subscribe(wake);
      wake();
      return () => {
        mounted -= 1;
        unsubscribe();
        wake();
      };
    },
  };
  return controller;
};

// Each composer has one controller per store and account: the room page's (whichever room it
// shows) and each thread view's. A composer that mounts again finds the sends the one before left
// under way; an idle controller with no composer goes.
const controllers = new WeakMap<
  object,
  WeakMap<MatrixClient, Map<string | undefined, ComposerSendController>>
>();

const controllersOf = (store: object, mx: MatrixClient) => {
  const byClient = controllers.get(store) ?? new WeakMap();
  controllers.set(store, byClient);
  const byView = byClient.get(mx) ?? new Map<string | undefined, ComposerSendController>();
  byClient.set(mx, byView);
  return byView;
};

/** The files a send of this composer (`view`: a thread view's, else the room page's) holds. */
export const claimedSendFiles = (
  store: object,
  mx: MatrixClient,
  view: string | undefined
): TUploadContent[] => controllers.get(store)?.get(mx)?.get(view)?.claimed() ?? [];

export const useRoomInputSendSessionController = (
  options: UseRoomInputSendSessionControllerOptions
): RoomInputSendController => {
  const store = useStore();
  const view = useContext(ConversationViewContext);
  const byView = controllersOf(store, options.mx);
  let controller = byView.get(view);
  if (!controller) {
    const created = createSendController(() => {
      if (byView.get(view) === created) byView.delete(view);
    });
    byView.set(view, created);
    controller = created;
  }
  const bound = controller;
  useLayoutEffect(() => bound.bind(options));
  const { attachments } = options;
  useEffect(() => bound.mount(attachments), [attachments, bound]);
  return bound.api;
};
