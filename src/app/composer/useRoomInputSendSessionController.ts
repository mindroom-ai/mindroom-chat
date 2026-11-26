import {
  MutableRefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useStore } from 'jotai';
import { IContent, MatrixClient, RelationType, Room } from 'matrix-js-sdk';
import { Descendant, Editor } from 'slate';
import { resetEditor, resetEditorHistory, restoreEditorContent } from '../editor/utils';
import {
  IReplyDraft,
  roomUploadAtomFamily,
  threadViewVoiceComposersAtom,
  voiceComposerKey,
} from './roomInputDrafts';
import { resolveCanonicalThreadRootId } from '../event-store/threads/threadRouteUtils';
import { useInConversationView } from '../navigation/conversationView';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { isUploadItemReady, TUploadItem, Upload, UploadStatus } from '../matrix/state/upload';
import { hasPasteMarkerInText, type RoomInputAttachmentAccess } from './roomInputAttachmentAccess';
import { isTooLargeError, TUploadContent } from '../matrix/matrix';
import { isSignalBridgeRoom } from '../matrix/bridgeDetection';
import {
  buildLongTextPreview,
  contentBytes,
  MAX_EVENT_CONTENT_BYTES,
} from '../matrix/protocol/longText';
import { uploadLongTextSidecar } from '../matrix/send/longTextSidecarUpload';
import { discardFailedLocalEcho } from '../matrix/protocol/pendingLocalEcho';
import {
  createRoomInputSendSessionState,
  getSubmissionMarker,
  getTextRelationForSendSession,
  getUploadRelationForSendSession,
  hasRoomInputSendFailures,
  isRoomInputSendSessionStalled,
  isRoomInputSendSessionUploading,
  resolveRoomInputSendStep,
  RoomInputSendSessionState,
} from './roomInputSendSession';
import { MID_TURN_MODE_KEY } from '../matrix/protocol/midTurn';
import { SUBMISSION_CONTENT_KEY } from '../matrix/protocol/submission';
import type { ThreadModelContent } from '../matrix/protocol/threadModel';
import { isMidTurnMode, type MidTurnMode } from '../preferences/midTurnModes';
import { getRoomMessageSentNotificationEventId } from '../event-store/timeline/roomMessageSent';
import { getMessageRelation } from '../matrix/send/composeMessageRelation';
import {
  type ThreadForkRef,
  threadForkContent,
  threadForkDraftId,
} from '../event-store/threads/threadFork';

type SendSession = RoomInputSendSessionState & {
  room: Room;
  roomId: string;
  threadId: string | undefined;
  forkStart: ForkStart | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  textContent?: IContent;
  midTurnMode?: MidTurnMode;
  rootModel?: ThreadModelContent;
  composerFallback?: Descendant[];
  composerContext: ComposerContext;
  replyCleared: boolean;
  signalBridgedRoom: boolean;
  failFast: boolean;
  uploads?: Upload[];
  onUploadSent?: (file: TUploadContent) => void;
  beforeSend?: StartRoomInputSendSessionOptions['beforeSend'];
  onLocalEchoCreated?: StartRoomInputSendSessionOptions['onLocalEchoCreated'];
  onTextConsumed?: () => void;
  /** What the session uses of the composer that started it, taken at Send. */
  composer: SessionComposer;
  /** The thread its root opened (Compact): the session parks for that thread's composer. */
  openedThreadId?: string;
  /**
   * Parking key computed at send creation: a staged-draft key, or the originating composer's
   * `voiceComposerKey` (so a thread view taking over a room composer's send parks it back for
   * the room's composer when the view closes).
   */
  originParkKey?: string;
};

type ComposerContext = Pick<RoomInputSendContext, 'roomId' | 'threadId'>;

type SessionComposer = {
  attachments: RoomInputAttachmentAccess;
  buildUploadMessageContent: UseRoomInputSendSessionControllerOptions['buildUploadMessageContent'];
  clearReplyDraft: UseRoomInputSendSessionControllerOptions['clearReplyDraft'];
  /** Puts a caption back: in the editor while it shows `context`, else in its stored draft. */
  restoreText: (context: ComposerContext, fragment: Descendant[]) => void;
  /**
   * Reports a sent room message, only while the composer is mounted and shows `context`: true when
   * that opened the message's thread.
   */
  reportSent: (context: ComposerContext, eventId: string) => boolean;
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

/**
 * Reports a sent room message from the session's composer. The thread it opens is marked first:
 * opening it can unmount that composer at once, which parks the session for that thread.
 */
const reportSentFromSession = (session: SendSession, eventId: string) => {
  session.openedThreadId = eventId;
  if (!session.composer.reportSent(session.composerContext, eventId)) {
    session.openedThreadId = undefined;
  }
};

/**
 * The key of a mounted view of the thread `threadId` opened (`mountedViewKeys`, by
 * `voiceComposerKey`), under its root's ID as sent or as the server confirmed it; none while no
 * view of that thread is there to take a send over.
 */
export const openedThreadParkKey = (
  room: Room,
  roomId: string,
  threadId: string,
  mountedViewKeys: readonly string[]
): string | undefined =>
  [threadId, resolveCanonicalThreadRootId(room, threadId)]
    .map((id) => voiceComposerKey({ roomId, threadId: id, threadView: true }))
    .find((key) => mountedViewKeys.includes(key));

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
// Per client: the composers to tell when a slot parks for another composer, so a mounted one can
// take it over.
const parkListeners = new WeakMap<MatrixClient, Set<() => void>>();
const parkListenersOf = (mx: MatrixClient) => ofClient(parkListeners, mx, () => new Set());
const parkVersions = new WeakMap<MatrixClient, number>();
const busySlotsOf = (mx: MatrixClient) => ofClient(busySlots, mx, () => new Set());

const notifySlot = (slot: SendSlot) => slot.listeners.forEach((listener) => listener());

const sameComposerContext = (a: ComposerContext, b: ComposerContext): boolean =>
  a.roomId === b.roomId && a.threadId === b.threadId;

class BeforeSendRefusedError extends Error {
  constructor() {
    super('The message can no longer go where it was sent.');
  }
}

export type RoomInputSendContext = {
  roomId: string;
  room: Room;
  threadId: string | undefined;
  replyDraft: IReplyDraft | undefined;
  threadingEnabled: boolean;
  signalBridgedRoom: boolean;
  /** Sent from a fork draft: its messages without a relation start the fork or join it. */
  forkStart?: ForkStart;
};

export type StartRoomInputSendSessionOptions = {
  textContent?: IContent;
  midTurnMode?: MidTurnMode;
  /** True when `midTurnMode` was explicitly picked from the Send menu rather than defaulted. */
  explicitMidTurnMode?: boolean;
  rootModel?: ThreadModelContent | null;
  batch?: {
    fileItems: TUploadItem[];
    uploads?: Upload[];
  };
  context?: RoomInputSendContext;
  completeWithinCall?: boolean;
  composerFallback?: Descendant[];
  composerContext?: ComposerContext;
  composerAlreadyReset?: boolean;
  onUploadSent?: (file: TUploadContent) => void;
  /**
   * Asked for this send, with the room it goes to, just before its text message goes out, after
   * anything it waited for (its long-text upload): false sends nothing, and the text returns to
   * the composer.
   */
  beforeSend?: (room: Room) => boolean;
  /**
   * Hears of the local echo of this send's text message, in the room it goes to, as it is made:
   * also after the composer has gone, or shows another room.
   */
  onLocalEchoCreated?: (eventId: string, room: Room) => void;
  /**
   * Invoked once when this send's text is handed off to Matrix (local echo / send completed) OR
   * restored via `composerFallback`, OR when `textContent` is undefined and the send finishes.
   */
  onTextConsumed?: () => void;
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
  /** A fork draft's composer (`RoomInput`): its sends start the fork. */
  forkFrom?: ThreadForkRef;
  takeRootModelDraft?: (room: Room) => ThreadModelContent | undefined;
  /** Key for parking/adopting sends of a staged-draft composer apart from target rooms. */
  stagedDraftKey?: string;
};

export const hasFailedPasteMarkerInText = (
  textContent: IContent | undefined,
  fileItems: TUploadItem[]
): boolean =>
  hasPasteMarkerInText(
    textContent,
    fileItems.filter((fileItem) => Boolean(fileItem.prepError))
  );

const readMidTurnMode = (content?: IContent): MidTurnMode | undefined => {
  const mode = content?.[MID_TURN_MODE_KEY];
  return isMidTurnMode(mode) ? mode : undefined;
};

const createSendSession = (
  context: RoomInputSendContext,
  files: TUploadContent[],
  fields: Pick<
    SendSession,
    | 'textContent'
    | 'midTurnMode'
    | 'rootModel'
    | 'composerFallback'
    | 'composerContext'
    | 'failFast'
    | 'uploads'
    | 'onUploadSent'
    | 'beforeSend'
    | 'onLocalEchoCreated'
    | 'onTextConsumed'
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
  forkStart: context.forkStart,
  replyCleared: false,
  ...createRoomInputSendSessionState({
    files,
    hasText: Boolean(fields.textContent),
    threadId: context.threadId,
    replyDraft: context.replyDraft,
    threadingEnabled: context.threadingEnabled,
  }),
});

/**
 * A fork draft's start, which every send of the draft shares: one message carries the reference
 * (`root`, its ID once the server has it) and all later ones join its thread.
 */
type ForkStart = { ref: ThreadForkRef; root?: Promise<string | undefined> };

/**
 * A fork draft's send to its room's top level belongs to the fork: see `placeMessage`.
 */
const withForkStart = (
  context: RoomInputSendContext,
  roomId: string,
  forkStart: ForkStart | undefined
): RoomInputSendContext =>
  forkStart && !context.forkStart && context.roomId === roomId && !context.threadId
    ? { ...context, forkStart }
    : context;

/**
 * Where a fork draft's message without a relation goes: into the thread of the message that started
 * the fork, once the server confirmed it, or, as the first, it starts the fork, and `settle` hears its
 * server ID; one that was not sent (no ID) gives way to the next.
 */
const placeInFork = async (
  fork: ForkStart
): Promise<{ rootId: string } | { settle: (rootId?: string) => void }> => {
  const started = fork.root;
  if (started) {
    const rootId = await started;
    return rootId ? { rootId } : placeInFork(fork);
  }
  let resolve!: (rootId?: string) => void;
  const root = new Promise<string | undefined>((done) => {
    resolve = done;
  });
  fork.root = root;
  return {
    settle: (rootId) => {
      if (!rootId && fork.root === root) fork.root = undefined;
      resolve(rootId);
    },
  };
};

export const skipsRootModel = (content?: IContent): boolean =>
  (content !== undefined && content.msgtype !== 'm.text') ||
  (typeof content?.body === 'string' && /^[!/]/.test(content.body.trim()));

/**
 * A session's message with the relation it gets. In a fork draft exactly one message carries the
 * reference: the first without a relation, whose `settleFork` hears its server ID. Each later one,
 * a queued text, a caption or an upload sent again, joins that message's thread.
 */
const placeMessage = async (
  session: SendSession,
  content: IContent,
  relation: IContent['m.relates_to'] | undefined
): Promise<{
  content: IContent;
  relation: IContent['m.relates_to'] | undefined;
  settleFork?: (rootId?: string) => void;
}> => {
  const fork = relation ? undefined : session.forkStart;
  if (!fork) {
    if (relation) return { content: { ...content, 'm.relates_to': relation }, relation };
    const pick = !content['m.relates_to'] ? session.rootModel : undefined;
    return { content: pick ? { ...content, ...pick } : content, relation };
  }
  const place = await placeInFork(fork);
  if ('rootId' in place) {
    const joined = getMessageRelation(undefined, undefined, place.rootId);
    return { content: { ...content, 'm.relates_to': joined }, relation: joined };
  }
  return {
    content: { ...content, ...threadForkContent(fork.ref, session.roomId) },
    relation,
    settleFork: place.settle,
  };
};

const clearReplyDraftForSession = (session: SendSession) => {
  if (session.replyCleared) return;

  session.replyCleared = true;
  session.composer.clearReplyDraft({
    roomId: session.roomId,
    replyDraft: session.replyDraft,
  });
};

const consumeSessionText = (session: SendSession) => {
  const callback = session.onTextConsumed;
  session.onTextConsumed = undefined;
  callback?.();
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
  consumeSessionText(session);
};

const getSessionUploads = (session: SendSession): [Upload[], TUploadContent[]] => {
  const { staged, enrolled, uploads } = session.composer.attachments.snapshot(session.roomId);
  const activeFiles = new Set([...staged, ...enrolled].map((fileItem) => fileItem.file));
  return [session.uploads ?? uploads, Array.from(activeFiles)];
};

const isReleasableTooLargeItem = (
  item: TUploadItem | undefined,
  upload: Upload | undefined
): boolean =>
  item !== undefined &&
  item.metadata.mindroomPasteAttachment === undefined &&
  upload?.status === UploadStatus.Error &&
  isTooLargeError(upload.error);

// Too-large (413 / M_TOO_LARGE) ordinary uploads cannot be retried as-is: release them from the
// active send session while keeping them staged on the board so Compress (.zip) is available
// immediately. Large paste attachments are not zip-eligible and keep their existing enrollment.
const releaseTooLargeUploads = (session: SendSession): void => {
  const { staged, enrolled, uploads } = session.composer.attachments.snapshot(session.roomId);
  const itemsByFile = new Map([...enrolled, ...staged].map((item) => [item.file, item]));
  const uploadMap = new Map((session.uploads ?? uploads).map((upload) => [upload.file, upload]));
  const droppedFiles = session.orderedFiles.filter(
    (file) =>
      !session.sentFiles.has(file) &&
      isReleasableTooLargeItem(itemsByFile.get(file), uploadMap.get(file))
  );
  if (droppedFiles.length === 0) return;
  const dropped = new Set(droppedFiles);
  session.orderedFiles = session.orderedFiles.filter((file) => !dropped.has(file));
  droppedFiles.forEach((file) => session.failedFiles.delete(file));
  session.composer.attachments.clearEnrollment(droppedFiles);
};

const isSessionStalled = (session: SendSession) =>
  isRoomInputSendSessionStalled(session, ...getSessionUploads(session));

/**
 * The content with the submission marker of the event the session sends now (`sending` as in
 * `getSubmissionMarker`), taken from the session's state at that moment.
 */
const withSubmissionMarker = <T extends IContent>(
  session: SendSession,
  content: T,
  sending: TUploadContent | undefined
): T => {
  const marker = getSubmissionMarker(session, ...getSessionUploads(session), sending);
  return marker ? { ...content, [SUBMISSION_CONTENT_KEY]: marker } : content;
};

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
  forkFrom,
  takeRootModelDraft,
  stagedDraftKey,
}: UseRoomInputSendSessionControllerOptions): {
  hasActiveSendSession: () => boolean;
  /** A send this composer took over from one that unmounted is still going out. */
  joinedSendPending: boolean;
  processSendSession: () => Promise<void>;
  startSendSession: (options?: StartRoomInputSendSessionOptions) => Promise<void>;
  /** Puts text that was not sent back: into the editor while it shows `context`, else its draft. */
  restoreText: (context: ComposerContext, fragment: Descendant[]) => void;
} => {
  const store = useStore();
  const threadView = useInConversationView();
  const [slot, setSlot] = useState(createSendSlot);
  const slotRef = useRef(slot);
  slotRef.current = slot;
  // A fork draft keeps its text, and its sends' text to put back, apart from its thread's. Its sends
  // share one start (ThreadView keeps the draft's reference as one object while it shows).
  const composerThreadId = forkFrom ? threadForkDraftId(forkFrom) : threadId;
  const forkStart = useMemo<ForkStart | undefined>(
    () => (forkFrom ? { ref: forkFrom } : undefined),
    [forkFrom]
  );
  const composerKey =
    stagedDraftKey ?? voiceComposerKey({ roomId, threadId: composerThreadId, threadView });
  const composerKeyRef = useLatestRef(composerKey);
  const composerContextRef = useRef({ roomId, threadId: composerThreadId });
  composerContextRef.current = { roomId, threadId: composerThreadId };
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
    (context: ComposerContext, eventId: string) =>
      showsContext(context) && onRoomMessageSentRef.current?.(eventId) === true,
    [onRoomMessageSentRef, showsContext]
  );

  const sendSessionText = useCallback(
    async (session: SendSession) => {
      if (!session.textContent) return;

      const textContent = session.midTurnMode
        ? { ...session.textContent, [MID_TURN_MODE_KEY]: session.midTurnMode }
        : session.textContent;
      const { content, relation, settleFork } = await placeMessage(
        session,
        textContent,
        getTextRelationForSendSession(session)
      );
      const markedContent = withSubmissionMarker(session, content, undefined);
      // Content too large for one event goes as a long-text sidecar, as MindRoom's long replies do.
      // A failed upload throws before anything is sent, so the text returns to the composer.
      let eventContent: IContent;
      try {
        eventContent =
          contentBytes(markedContent) <= MAX_EVENT_CONTENT_BYTES
            ? markedContent
            : await uploadLongTextSidecar(
                mx,
                session.room,
                markedContent,
                buildLongTextPreview(markedContent)
              );
        if (session.beforeSend?.(session.room) === false) {
          throw new Error('The message can no longer go where it was sent.');
        }
      } catch (error) {
        settleFork?.();
        throw error;
      }
      if (!relation) session.rootModel = undefined;
      const txnId = mx.makeTxnId();
      const sendPromise = mx.sendMessage(session.roomId, eventContent as never, txnId);
      sendPromise.then(
        (response) => settleFork?.(response.event_id),
        () => settleFork?.()
      );
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
        reportSentFromSession(session, sentEventIdToNotify);
      };

      if (localEventId === `~${session.roomId}:${txnId}`) {
        if (!relation && session.sentFiles.size === 0) {
          session.onLocalEchoCreated?.(localEventId, session.room);
        }
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
      consumeSessionText(session);
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
      const contentWithMidTurn = session.midTurnMode
        ? { ...content, [MID_TURN_MODE_KEY]: session.midTurnMode }
        : content;
      const {
        content: contentWithRelation,
        relation,
        settleFork,
      } = await placeMessage(
        session,
        contentWithMidTurn,
        getUploadRelationForSendSession(session, isRoot)
      );
      // An upload retried while this file built or waited for its fork holds it back, as
      // resolveRoomInputSendStep does: the file stays unsent, gives up its place as the fork's
      // start, and the session builds and places it again once nothing uploads.
      if (isRoomInputSendSessionUploading(session, ...getSessionUploads(session))) {
        settleFork?.();
        return;
      }
      if (session.beforeSend?.(session.room) === false) {
        settleFork?.();
        throw new BeforeSendRefusedError();
      }
      if (!relation) session.rootModel = undefined;
      const txnId = mx.makeTxnId();
      const response = await mx
        .sendMessage(
          session.roomId,
          withSubmissionMarker(session, contentWithRelation, file) as never,
          txnId
        )
        .catch((error: unknown) => {
          settleFork?.();
          // The composer keeps the attachment to send again; drop the unsent echo.
          discardFailedLocalEcho(mx, session.room.getEventForTxnId(txnId));
          throw error;
        });
      settleFork?.(response.event_id);
      const sentEventIdToNotify = getRoomMessageSentNotificationEventId({
        eventId: response.event_id,
        relation,
        replyDraft: session.replyDraft,
        threadId: session.threadId,
      });

      session.sentFiles.add(file);
      session.failedFiles.delete(file);
      if (session.mode === 'auto-thread-upload-root' && isRoot) {
        // A root that joined a fork another message started keeps that thread for the rest.
        session.rootEventId =
          relation?.rel_type === RelationType.Thread && relation.event_id
            ? relation.event_id
            : response.event_id;
      }
      session.onUploadSent?.(file);
      clearReplyDraftForSession(session);
      // The composer that took the send over meanwhile holds the file now.
      session.composer.attachments.remove(session.roomId, [file]);
      if (sentEventIdToNotify) reportSentFromSession(session, sentEventIdToNotify);
    },
    [mx]
  );

  const clearSendSession = useCallback(
    (sendSlot: SendSlot) => {
      const session = sendSlot.session;
      sendSlot.session = undefined;
      busySlotsOf(mx).delete(sendSlot);
      sendSlot.stopWatching?.();
      sendSlot.stopWatching = undefined;
      sendSlot.adopted = false;
      if (sendSlot.queued.length === 0) sendSlot.unpark?.();
      session?.composer.attachments.clearEnrollment(session.orderedFiles);
      if (session && !session.textPending) consumeSessionText(session);
      notifySlot(sendSlot);
    },
    [mx]
  );

  const processSendSession = useCallback(
    async (sendSlot: SendSlot = slotRef.current) => {
      if (sendSlot.processing) return;

      sendSlot.processing = true;
      try {
        while (sendSlot.session) {
          const session = sendSlot.session;
          if (!session.failFast) releaseTooLargeUploads(session);

          const step = resolveRoomInputSendStep(session, ...getSessionUploads(session));

          if (step.kind === 'wait') {
            // Once its composer went, no one can retry or remove the files it waits for.
            if (!session.composer.mounted() && isSessionStalled(session))
              clearSendSession(sendSlot);
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
            if (error instanceof BeforeSendRefusedError) {
              if (session.textPending) restoreComposerFallback(session);
              clearSendSession(sendSlot);
              return;
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
    },
    [sendSessionText, sendSessionUpload, clearSendSession]
  );

  const parkSlot = useCallback(
    (target: SendSlot, notifyAlways: boolean) => {
      target.unpark?.();
      const { session: held } = target;
      let key = held?.originParkKey ?? composerKeyRef.current;
      // A send whose root opened its thread goes on with a view of that thread that is there
      // (one that mounts as this composer goes has listed itself already); else with the room's.
      const threadKey =
        held?.openedThreadId &&
        openedThreadParkKey(
          held.room,
          held.roomId,
          held.openedThreadId,
          store.get(threadViewVoiceComposersAtom).map((entry) => entry.key)
        );
      if (threadKey) key = threadKey;
      // A key another send still waits under stays that send's.
      const parked = parkedSlotsOf(mx);
      if (parked.get(key)?.session) return;
      parked.set(key, target);
      target.unpark = () => {
        if (parked.get(key) === target) parked.delete(key);
      };
      // A send handed to another composer (a thread's view, back to the room's, or started after
      // unmount) finds it mounted already: tell it.
      if (notifyAlways || key !== composerKeyRef.current) {
        parkVersions.set(mx, (parkVersions.get(mx) ?? 0) + 1);
        parkListenersOf(mx).forEach((listener) => listener());
      }
    },
    [composerKeyRef, mx, store]
  );

  const startSendSession = useCallback(
    async (
      {
        textContent,
        midTurnMode,
        explicitMidTurnMode = false,
        rootModel,
        batch,
        context,
        completeWithinCall = false,
        composerFallback,
        composerContext,
        composerAlreadyReset = false,
        onUploadSent,
        beforeSend,
        onLocalEchoCreated,
        onTextConsumed,
      }: StartRoomInputSendSessionOptions = {},
      sendSlot: SendSlot = slotRef.current
    ) => {
      // The session takes what it needs of this composer now: it may outlive it.
      const composer: SessionComposer = {
        attachments,
        buildUploadMessageContent,
        clearReplyDraft,
        restoreText,
        reportSent,
        mounted: isMounted,
      };
      const acquireRootModel = (target: RoomInputSendContext, hasFiles = false) => {
        if (rootModel !== undefined) return rootModel ?? undefined;
        if (
          target.roomId !== roomId ||
          target.threadingEnabled === false ||
          target.threadId ||
          target.replyDraft ||
          target.forkStart ||
          skipsRootModel(textContent) ||
          (!hasFiles && textContent?.['m.relates_to'])
        )
          return undefined;
        return takeRootModelDraft?.(target.room);
      };
      const resolvedMidTurnMode =
        (isMidTurnMode(midTurnMode) ? midTurnMode : undefined) ?? readMidTurnMode(textContent);
      const targetComposerContext = composerContext ?? { roomId, threadId: composerThreadId };
      let activeSlot = sendSlot;
      if (
        activeSlot === slotRef.current &&
        ((composerContext &&
          (!sameComposerContext(composerContext, composerContextRef.current) ||
            (activeSlot.session &&
              !sameComposerContext(activeSlot.session.composerContext, composerContext)))) ||
          (activeSlot.session &&
            isSessionStalled(activeSlot.session) &&
            (batch?.fileItems.length ?? 0) > 0))
      ) {
        activeSlot = createSendSlot();
        activeSlot.repark = () => parkSlot(activeSlot, true);
      }
      const restoreResetFallback = () => {
        if (!composerAlreadyReset || !composerFallback) return;
        restoreText(targetComposerContext, composerFallback);
        onTextConsumed?.();
      };
      const existingSession = activeSlot.session;
      if (existingSession) {
        if (completeWithinCall) {
          restoreResetFallback();
          throw new Error(
            'Cannot start a lifecycle-complete send while another session is active.'
          );
        }
        if (hasRoomInputSendFailures(existingSession) && !composerAlreadyReset) {
          // Send again: the attachments whose send failed go out again; text being sent stays
          // in the composer meanwhile. An explicit menu pick overrides the session's saved mode.
          if (explicitMidTurnMode && resolvedMidTurnMode) {
            existingSession.midTurnMode = resolvedMidTurnMode;
          }
          existingSession.blockedRoot = false;
          existingSession.failedFiles.clear();
          await processSendSession(activeSlot);
          return;
        }
        // Repeated sends while uploads are still resolving should not create duplicate events.
        if (!textContent && !batch?.fileItems.length) {
          onTextConsumed?.();
          return;
        }
        if (hasFailedPasteMarkerInText(textContent, attachments.snapshot(context?.roomId).staged)) {
          restoreResetFallback();
          return;
        }
        // The composer takes the message now, as it does any message; the reply draft the earlier
        // message took stays with that one.
        const nextFallback = composerFallback ?? structuredClone(editor.children);
        if (!composerAlreadyReset) {
          resetEditor(editor);
          resetEditorHistory(editor);
          sendTypingStatus(false);
        }
        const nextContext = withForkStart(
          context ?? {
            roomId,
            room,
            threadId,
            replyDraft: replyDraft === existingSession.replyDraft ? undefined : replyDraft,
            threadingEnabled,
            signalBridgedRoom: isSignalBridgeRoom(room),
          },
          roomId,
          forkStart
        );
        const nextRootModel = acquireRootModel(nextContext, Boolean(batch?.fileItems.length));
        if (isSessionStalled(existingSession)) {
          // The session waits for the person to retry an attachment; the text does not wait
          // with it and gets its row at once.
          const session = createSendSession(nextContext, [], {
            textContent,
            midTurnMode: resolvedMidTurnMode,
            rootModel: nextRootModel,
            composerFallback: nextFallback,
            composerContext: targetComposerContext,
            failFast: false,
            beforeSend,
            onLocalEchoCreated,
            onTextConsumed,
            composer,
          });
          const sending = activeSlot.textsBeside.then(() =>
            sendSessionText(session).catch(() => restoreComposerFallback(session))
          );
          activeSlot.textsBeside = sending;
          await sending;
          return;
        }
        // Otherwise it follows the message still going out, in order.
        activeSlot.queued.push(() => {
          activeSlot
            .start?.(
              {
                textContent,
                midTurnMode: resolvedMidTurnMode,
                explicitMidTurnMode,
                rootModel: nextRootModel ?? null,
                batch,
                context: nextContext,
                composerFallback: nextFallback,
                composerContext: targetComposerContext,
                composerAlreadyReset: true,
                onUploadSent,
                beforeSend,
                onLocalEchoCreated,
                onTextConsumed,
              },
              activeSlot
            )
            .catch((error: unknown) => {
              // eslint-disable-next-line no-console
              console.warn('[room-input] could not send the queued message', error);
            });
        });
        return;
      }

      const { staged, enrolled, uploads } = attachments.snapshot(context?.roomId);
      const uploadByFile = new Map(
        (batch?.uploads ?? uploads).map((upload) => [upload.file, upload])
      );
      // A file goes with one send at a time: one another send or background handoff holds stays
      // with that one.
      const heldFiles = new Set([
        ...[...busySlotsOf(mx)].flatMap((busy) => busy.session?.orderedFiles ?? []),
        ...(batch ? [] : enrolled.map((item) => item.file)),
      ]);
      const candidateItems = (batch?.fileItems ?? staged).filter(
        (fileItem) => isUploadItemReady(fileItem) && !heldFiles.has(fileItem.file)
      );
      const isDroppedTooLarge = (fileItem: TUploadItem) =>
        !completeWithinCall && isReleasableTooLargeItem(fileItem, uploadByFile.get(fileItem.file));
      const droppedTooLargeFiles = batch
        ? candidateItems.filter(isDroppedTooLarge).map((item) => item.file)
        : [];
      if (droppedTooLargeFiles.length > 0) {
        attachments.clearEnrollment(droppedTooLargeFiles);
      }
      const sendItems = candidateItems.filter((fileItem) => !isDroppedTooLarge(fileItem));
      const sendFiles = sendItems.map((item) => item.file);
      if (sendFiles.length === 0 && !textContent) {
        onTextConsumed?.();
        return;
      }
      if (hasFailedPasteMarkerInText(textContent, staged)) {
        restoreResetFallback();
        return;
      }
      attachments.enroll(sendItems);

      const sendContext = withForkStart(
        context ?? {
          roomId,
          room,
          threadId,
          replyDraft,
          threadingEnabled,
          signalBridgedRoom: isSignalBridgeRoom(room),
        },
        roomId,
        forkStart
      );
      const session = createSendSession(sendContext, sendFiles, {
        textContent,
        midTurnMode: resolvedMidTurnMode,
        rootModel: acquireRootModel(sendContext, sendFiles.length > 0),
        composerContext: targetComposerContext,
        failFast: completeWithinCall,
        uploads: batch?.uploads,
        onUploadSent,
        beforeSend,
        onLocalEchoCreated,
        onTextConsumed,
        composer,
      });
      session.originParkKey =
        stagedDraftKey ?? voiceComposerKey({ ...targetComposerContext, threadView });
      activeSlot.session = session;
      busySlotsOf(mx).add(activeSlot);
      // The session wakes on its own uploads, with or without its composer.
      const unsubscribes = sendFiles.map((file) =>
        store.sub(roomUploadAtomFamily(file), () =>
          queueMicrotask(() => void processSendSession(activeSlot))
        )
      );
      activeSlot.stopWatching = () => unsubscribes.forEach((unsubscribe) => unsubscribe());
      if (textContent) {
        // The caption sends last (after the uploads), so free the composer as soon as the
        // session has snapshotted the text instead of when the text event goes out. Keep a
        // clone of the composer content so a caption that never gets a row of its own can be
        // restored (slate mutates editor.children in place).
        session.composerFallback = composerFallback ?? structuredClone(editor.children);
        if (!composerAlreadyReset) {
          // Start the editor over, and stop the typing indicator, now that its text is captured.
          resetEditor(editor);
          resetEditorHistory(editor);
          sendTypingStatus(false);
        }
      }
      // A send queued in a parked slot or started off-context waits under its own key.
      activeSlot.repark?.();
      try {
        await processSendSession(activeSlot);
      } catch (error) {
        if (completeWithinCall) {
          const failedSession = activeSlot.session;
          if (failedSession?.textPending) {
            restoreComposerFallback(failedSession);
          }
          clearSendSession(activeSlot);
        }
        throw error;
      }
      if (completeWithinCall && activeSlot.session) {
        clearSendSession(activeSlot);
        throw new Error('Lifecycle-complete send did not finish within the initiating call.');
      }
    },
    [
      threadView,
      roomId,
      threadId,
      composerThreadId,
      forkStart,
      stagedDraftKey,
      takeRootModelDraft,
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
      parkSlot,
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

  // A composer showing the key of one that unmounted with a send under way, as it mounts, moves
  // there or the send parks there, takes that send over: its board shows the files still to go,
  // which it can cancel or retry, and its sends follow that one.
  const parkVersion = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        const listeners = parkListenersOf(mx);
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      [mx]
    ),
    () => parkVersions.get(mx) ?? 0
  );
  // A composer with a send of its own takes another over once its own is done.
  const ownBusy = useSyncExternalStore(
    useCallback(
      (listener: () => void) => {
        slot.listeners.add(listener);
        return () => slot.listeners.delete(listener);
      },
      [slot]
    ),
    () => !!slot.session || slot.queued.length > 0
  );
  useEffect(() => {
    const own = slotRef.current;
    if (own.session || own.queued.length > 0) return;
    const parked = parkedSlotsOf(mx).get(composerKey);
    const session = parked?.session;
    if (!parked || !session || session.failFast) return;
    parked.unpark?.();
    parked.unpark = undefined;
    parked.repark = undefined;
    const previous = session.composer.attachments;
    const { staged, enrolled } = previous.snapshot(session.roomId);
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
    // Files from another board (the room's, taken over by a thread's view) leave that one.
    const onBoard = new Set(attachments.snapshot(session.roomId).staged.map((item) => item.file));
    if (previous !== attachments) {
      previous.release(
        session.roomId,
        [...items.keys()].filter((file) => !onBoard.has(file))
      );
    }
    attachments.append(session.roomId, [...items.values()]);
    attachments.enroll([...items.values()]);
    parked.adopted = true;
    slotRef.current = parked;
    setSlot(parked);
  }, [attachments, composerKey, isMounted, mx, ownBusy, parkVersion, reportSent, restoreText]);

  // Unmounting with a send under way parks it for the next composer of the same key.
  // Always bind repark so a post-unmount send (such as background dictation) can park too.
  useEffect(
    () => () => {
      const current = slotRef.current;
      current.repark = () => parkSlot(current, true);
      if (current.session || current.queued.length > 0) {
        parkSlot(current, false);
      }
    },
    [parkSlot]
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
    restoreText,
  };
};
