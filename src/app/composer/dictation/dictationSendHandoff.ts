import type { createStore } from 'jotai';
import type { IContent, MatrixClient, Room } from 'matrix-js-sdk';
import {
  createEditor,
  Range as SlateRange,
  Transforms,
  type BaseRange,
  type Descendant,
  type Editor,
} from 'slate';
import { createParagraphElement, isEmptyEditor, withInlineElements } from '../../editor/utils';
import { isSignalBridgeRoom } from '../../matrix/bridgeDetection';
import { MID_TURN_MODE_KEY } from '../../matrix/protocol/midTurn';
import type { ThreadModelContent } from '../../matrix/protocol/threadModel';
import { listSessions } from '../../matrix/session/sessions';
import type { TUploadContent } from '../../matrix/matrix';
import { isUploadItemReady, UploadStatus, type TUploadItem } from '../../matrix/state/upload';
import type { MidTurnMode } from '../../preferences/midTurnModes';
import type { SlashCommand } from '../commands/useCommands';
import { composeTextMessage, withMention } from '../composeTextMessage';
import {
  hasMissingPasteAttachmentForText,
  prepareAndUploadDeferredAttachments,
  type RoomInputAttachmentAccess,
} from '../roomInputAttachmentAccess';
import {
  detachedDictationErrorAtom,
  detachedDictationSendsAtom,
  restoreTextToDraft,
  roomUploadAtomFamily,
  type DetachedDictationError,
  type DetachedDictationSend,
  type IReplyDraft,
} from '../roomInputDrafts';
import { readActingCommand, readUnknownCommand } from '../slashCommandQuery';
import {
  LIFECYCLE_COMPLETE_ACTIVE_SESSION_ERROR,
  LIFECYCLE_COMPLETE_UNFINISHED_ERROR,
  skipsRootModel,
  type RoomInputSendContext,
  type StartRoomInputSendSessionOptions,
} from '../useRoomInputSendSessionController';
import { deleteCapture, releaseCapture } from '../capture/captureJournal';
import { captureAccountGuard } from '../capture/liveCapture';
import type { DictationFinishResult, DictationSession } from './dictationSession';
import { insertDictatedText } from './insertDictatedText';

export {
  detachedDictationErrorAtom,
  detachedDictationSendsAtom,
  type DetachedDictationError,
  type DetachedDictationSend,
};

type JotaiStore = ReturnType<typeof createStore>;
type ComposerContext = { roomId: string; threadId: string | undefined };

export type MountedDictationOwner = {
  insertDictatedText: (text: string, focus: boolean, session: DictationSession) => void;
  restoreText: (fragment: Descendant[]) => void;
  restoreReplyDraft: (replyDraft: IReplyDraft) => void;
  restoreAttachments: (roomId: string, items: TUploadItem[]) => void;
  onCommandProblem: (unknownCommand: string) => void;
  onNoSpeech: () => void;
};

const mountedOwnersByStore = new WeakMap<JotaiStore, Map<string, Set<MountedDictationOwner>>>();

/** Tracks mounted composers per stable send key so background completions reach a live view. */
export const registerMountedDictationOwner = (
  store: JotaiStore,
  sendKey: string,
  owner: MountedDictationOwner
): (() => void) => {
  let map = mountedOwnersByStore.get(store);
  if (!map) {
    map = new Map();
    mountedOwnersByStore.set(store, map);
  }
  let set = map.get(sendKey);
  if (!set) {
    set = new Set();
    map.set(sendKey, set);
  }
  set.add(owner);
  return () => {
    set.delete(owner);
    if (set.size === 0) map.delete(sendKey);
  };
};

export const getMountedOwner = (
  store: JotaiStore,
  sendKey: string
): MountedDictationOwner | undefined => {
  const set = mountedOwnersByStore.get(store)?.get(sendKey);
  return set && set.size > 0 ? [...set][set.size - 1] : undefined;
};

const hasDocContent = (children: Descendant[]): boolean => {
  if (children.length === 0) return false;
  const scratch = withInlineElements(createEditor());
  scratch.children = children;
  return !isEmptyEditor(scratch);
};

/** Merges dictated text into a cloned Slate document off-DOM, keeping inline nodes and marks. */
export const mergeDictatedDoc = (
  docSnapshot: Descendant[],
  rawText: string,
  savedSelection: BaseRange | null,
  pendingMarks: Record<string, unknown> | null
): Editor => {
  const scratch = withInlineElements(createEditor());
  scratch.children =
    docSnapshot.length > 0 ? structuredClone(docSnapshot) : [createParagraphElement()];
  if (pendingMarks && (!savedSelection || SlateRange.isCollapsed(savedSelection))) {
    if (savedSelection) {
      try {
        Transforms.select(scratch, savedSelection);
      } catch {
        // Out-of-bounds selection falls back to end of doc in insertDictatedText.
      }
    }
    scratch.marks = { ...pendingMarks };
  }
  insertDictatedText(scratch, rawText, savedSelection, { focus: false });
  return scratch;
};

const VOICE_SEND_FALLBACK_ERROR = 'Could not send voice message.';

export type CreateVoiceUploadItems = (
  file: File,
  duration: number,
  waveform: number[] | undefined,
  targetRoom?: Room
) => Promise<TUploadItem[]>;

export type DetachedDictationAsk = {
  agentUserId: string;
  isDirect?: boolean;
  canSend: (sentTo?: Room) => boolean;
  onSendingChange?: (sending: boolean) => void;
  onLocalEcho?: (eventId: string, room: Room) => void;
};

export type StartDetachedDictationSendInput = {
  store: JotaiStore;
  mx: MatrixClient;
  ownerKey: string;
  draftKey: string;
  roomName: string;
  sendContext: RoomInputSendContext;
  composerContext: ComposerContext;
  session: DictationSession;
  docSnapshot: Descendant[];
  savedSelection: BaseRange | null;
  pendingMarks: Record<string, unknown> | null;
  stagedSnapshot: TUploadItem[];
  tracksEnrollment: boolean;
  rootModel?: ThreadModelContent;
  midTurnMode: MidTurnMode;
  explicitMidTurnMode: boolean;
  isMarkdown: boolean;
  ownUserId: string | undefined;
  linkSchemes?: readonly string[];
  parseCommands: boolean;
  commandsSnapshot: Record<string, SlashCommand>;
  ask?: DetachedDictationAsk;
  attachments: RoomInputAttachmentAccess;
  sessions: {
    startSendSession: (options?: StartRoomInputSendSessionOptions) => Promise<void>;
    restoreText: (context: ComposerContext, fragment: Descendant[]) => void;
  };
  restoreReplyDraft: (replyDraft: IReplyDraft) => void;
  restoreRootModelDraft?: (room: Room, content: ThreadModelContent) => void;
  dismissLostNotices?: () => void;
  /** Prepares/encrypts a fallback voice message File for `targetRoom`. */
  createVoiceUploadItems?: CreateVoiceUploadItems;
  /** Uploads a staged attachment right before send when deferred (Home) or voice fallback. */
  uploadItem?: (item: TUploadItem) => Promise<string>;
  /** Prepares/encrypts deferred staged attachments for `room` right before uploading them. */
  prepareAttachmentsForSend?: (room: Room, items: TUploadItem[]) => Promise<TUploadItem[]>;
};

export type HandoffComposerDictationInput = Omit<
  StartDetachedDictationSendInput,
  | 'docSnapshot'
  | 'savedSelection'
  | 'pendingMarks'
  | 'stagedSnapshot'
  | 'tracksEnrollment'
  | 'rootModel'
  | 'sendContext'
  | 'commandsSnapshot'
> & {
  editor: Editor;
  room: Room;
  roomId: string;
  threadId?: string;
  replyDraft?: IReplyDraft;
  threadingEnabled: boolean;
  forkFrom?: unknown;
  savedSelection: BaseRange | null;
  commands: Record<string, SlashCommand>;
  preExistingContent?: IContent;
  takeRootModelDraft: (room: Room) => ThreadModelContent | undefined;
  createVoiceUploadItems: CreateVoiceUploadItems;
  uploadItem: (item: TUploadItem) => Promise<string>;
  clearReplyDraft: (ctx: { roomId: string; replyDraft?: IReplyDraft }) => void;
  resetComposer: () => void;
  stopTyping: () => void;
};

/** Snapshots composer state, enrolls/starts staged uploads, resets composer, and starts handoff. */
export const handoffComposerDictationSend = (
  params: HandoffComposerDictationInput
): DetachedDictationSend => {
  const { editor, room, roomId, threadId, replyDraft, threadingEnabled, ask, attachments, store } =
    params;
  const docSnapshot = structuredClone(editor.children);
  const pendingMarks = editor.marks ? { ...editor.marks } : null;
  const savedSelection =
    params.savedSelection ?? (editor.selection ? structuredClone(editor.selection) : null);
  const { staged, enrolled } = attachments.snapshot();
  const enrolledFiles = new Set(enrolled.map((item) => item.file));
  const stagedSnapshot = staged.filter(
    (item) => isUploadItemReady(item) && !enrolledFiles.has(item.file)
  );
  const rootModel =
    !ask &&
    !params.forkFrom &&
    threadingEnabled &&
    !threadId &&
    !replyDraft &&
    !skipsRootModel(params.preExistingContent)
      ? params.takeRootModelDraft(room)
      : undefined;
  if (stagedSnapshot.length > 0) {
    attachments.enroll(stagedSnapshot);
    // Deferred composers (Home) wait until Send commits to encrypt and upload for the target room.
    if (!params.prepareAttachmentsForSend) {
      const roomEncrypted = room.hasEncryptionStateEvent();
      stagedSnapshot.forEach((item) => {
        if (roomEncrypted && !item.encInfo) return;
        if (store.get(roomUploadAtomFamily(item.file)).status === UploadStatus.Idle) {
          void params.uploadItem(item).catch(() => undefined);
        }
      });
    }
  }
  const tracksEnrollment =
    stagedSnapshot.length > 0 &&
    attachments.snapshot(roomId).enrolled.some((entry) => entry.file === stagedSnapshot[0]!.file);
  if (replyDraft) params.clearReplyDraft({ roomId, replyDraft });
  params.resetComposer();
  params.stopTyping();
  ask?.onSendingChange?.(true);
  return startDetachedDictationSend({
    ...params,
    sendContext: {
      roomId,
      room,
      threadId,
      replyDraft,
      threadingEnabled,
      signalBridgedRoom: isSignalBridgeRoom(room),
    },
    docSnapshot,
    savedSelection,
    pendingMarks,
    stagedSnapshot,
    tracksEnrollment,
    rootModel,
    commandsSnapshot: { ...params.commands },
  });
};

/** Hands a recording/paused dictation session off to finish and send in the background. */
export const startDetachedDictationSend = (
  input: StartDetachedDictationSendInput
): DetachedDictationSend => {
  const { store, mx, ownerKey, sendContext, composerContext, session, ask, attachments } = input;
  const { roomId, replyDraft } = sendContext;
  const sameAccount = captureAccountGuard(store);
  const isDeferredSend = Boolean(ask || input.prepareAttachmentsForSend);
  let currentStaged = input.stagedSnapshot;
  const enrolledFileRefs = new Set(currentStaged.map((item) => item.file));
  const sentCompanionFiles = new Set<TUploadContent>();
  let createdThreadId: string | undefined;
  let aborted = false;
  let accountRestored = false;
  const journalId = session.getJournalId();
  let currentEntry!: DetachedDictationSend;
  const isLive = () => !aborted && sameAccount();
  const settleJournal = (targetJournalId = journalId) => {
    if (!targetJournalId) return;
    if (isLive()) void deleteCapture(targetJournalId).catch(() => undefined);
    else releaseCapture(targetJournalId);
  };
  const isUnsentCompanion = (item: TUploadItem): boolean =>
    !sentCompanionFiles.has(item.file) && !sentCompanionFiles.has(item.originalFile);

  const getActiveStaged = (): TUploadItem[] => {
    if (currentStaged.length === 0) return [];
    if (!input.tracksEnrollment) {
      return currentStaged.filter((item) => isUploadItemReady(item) && isUnsentCompanion(item));
    }
    const snap = attachments.snapshot(roomId);
    const enrolledByFile = new Map(snap.enrolled.map((i) => [i.file, i]));
    const stagedByFile = isDeferredSend ? new Map(snap.staged.map((i) => [i.file, i])) : undefined;
    return currentStaged
      .map((item) => enrolledByFile.get(item.file) ?? stagedByFile?.get(item.file))
      .filter(
        (item): item is TUploadItem =>
          item !== undefined && isUploadItemReady(item) && isUnsentCompanion(item)
      );
  };

  const clearEnrollments = () => {
    if (enrolledFileRefs.size > 0) attachments.clearEnrollment([...enrolledFileRefs]);
  };

  const clearMatchingError = () => {
    if (sameAccount() && store.get(detachedDictationErrorAtom)?.ownerKey === ownerKey) {
      store.set(detachedDictationErrorAtom, undefined);
    }
  };

  const removeEntry = () => {
    const current = store.get(detachedDictationSendsAtom);
    if (current.get(ownerKey) !== currentEntry) return;
    const next = new Map(current);
    next.delete(ownerKey);
    store.set(detachedDictationSendsAtom, next);
  };

  const restoreDocOnAccountSwitch = () => {
    if (accountRestored || !hasDocContent(input.docSnapshot)) return;
    accountRestored = true;
    if (input.ownUserId && listSessions().some((entry) => entry.userId === input.ownUserId)) {
      restoreTextToDraft(store, input.draftKey, input.docSnapshot);
    }
  };

  const restoreTextFragment = (fragment: Descendant[]) => {
    const owner = getMountedOwner(store, ownerKey);
    if (owner) owner.restoreText(fragment);
    else input.sessions.restoreText(composerContext, fragment);
  };

  const restoreDraftAndCleanup = (fragment: Descendant[]) => {
    removeEntry();
    clearMatchingError();
    const owner = getMountedOwner(store, ownerKey);
    if (hasDocContent(fragment)) restoreTextFragment(fragment);
    if (replyDraft) {
      if (owner) owner.restoreReplyDraft(replyDraft);
      else input.restoreReplyDraft(replyDraft);
    }
    if (input.rootModel) {
      input.restoreRootModelDraft?.(mx.getRoom(roomId) ?? sendContext.room, input.rootModel);
    }
    const activeStaged = getActiveStaged();
    if (activeStaged.length > 0) owner?.restoreAttachments(roomId, activeStaged);
    clearEnrollments();
    ask?.onSendingChange?.(false);
  };

  const describeVoiceFallbackError = (error: unknown): string => {
    const message = error instanceof Error ? error.message.trim() : '';
    if (
      !message ||
      message === LIFECYCLE_COMPLETE_ACTIVE_SESSION_ERROR ||
      message === LIFECYCLE_COMPLETE_UNFINISHED_ERROR
    ) {
      return VOICE_SEND_FALLBACK_ERROR;
    }
    return message;
  };

  const abortDetachedSend = () => {
    clearEnrollments();
    session.reset();
    restoreDocOnAccountSwitch();
    removeEntry();
  };

  const setEntryStatus = (
    status: 'sending' | 'failed',
    errorMessage?: string
  ): DetachedDictationSend => {
    currentEntry = {
      ownerKey,
      roomId,
      roomName: input.roomName,
      status,
      ...(errorMessage !== undefined ? { errorMessage } : {}),
      session,
      retryAndSend,
      sendAsVoice,
      insertPartial,
      discard,
      abort,
    };
    if (sameAccount()) {
      const next = new Map(store.get(detachedDictationSendsAtom));
      next.set(ownerKey, currentEntry);
      store.set(detachedDictationSendsAtom, next);
    }
    return currentEntry;
  };

  const markFailed = (errorMessage?: string) => {
    setEntryStatus('failed', errorMessage);
    if (!getMountedOwner(store, ownerKey)) {
      store.set(detachedDictationErrorAtom, {
        ownerKey,
        roomName: input.roomName,
        kind: 'failed',
      });
    }
  };

  const detectBlockedSlashCommand = (
    children: Descendant[]
  ): { kind: 'unknown'; command: string } | { kind: 'acting' } | undefined => {
    if (ask) return undefined;
    const unknownCommand = readUnknownCommand(children, input.commandsSnapshot);
    if (unknownCommand !== undefined) return { kind: 'unknown', command: unknownCommand };
    if (readActingCommand(children, input.commandsSnapshot)) return { kind: 'acting' };
    return undefined;
  };

  const composeDetachedTextContent = (scratch: Editor): IContent | undefined => {
    const rawContent = composeTextMessage(
      scratch,
      input.isMarkdown,
      input.ownUserId,
      input.linkSchemes,
      input.parseCommands
    );
    return rawContent
      ? {
          ...(ask ? withMention(rawContent, ask.agentUserId) : rawContent),
          [MID_TURN_MODE_KEY]: input.midTurnMode,
        }
      : undefined;
  };

  const buildSendSessionBase = (liveRoom: Room, textContent: IContent | undefined) => ({
    textContent,
    midTurnMode: input.midTurnMode,
    explicitMidTurnMode: input.explicitMidTurnMode,
    context: {
      ...sendContext,
      threadId: createdThreadId ?? sendContext.threadId,
      room: liveRoom,
      signalBridgedRoom: isSignalBridgeRoom(liveRoom),
    },
    composerContext,
    composerAlreadyReset: true,
    beforeSend: (sentTo: Room) => sameAccount() && (!ask || ask.canSend(sentTo)),
    onLocalEchoCreated: ask?.onLocalEcho
      ? (eventId: string, sentRoom: Room) => {
          if (sameAccount()) ask.onLocalEcho?.(eventId, sentRoom);
        }
      : undefined,
  });

  const prepareCompanionStaged = async (
    liveRoom: Room,
    activeStaged: TUploadItem[],
    textContent: IContent | undefined,
    requireAllStaged = false
  ): Promise<
    | { status: 'aborted' }
    | { status: 'missingPaste' }
    | { status: 'failedUpload' }
    | { status: 'ready'; items: TUploadItem[] }
  > => {
    if (!input.prepareAttachmentsForSend) {
      return { status: 'ready', items: activeStaged };
    }
    const hasUnsentStaged = (
      stillStaged: readonly TUploadItem[],
      uploadedOrigs?: ReadonlySet<TUploadContent>
    ): boolean => {
      const stillStagedOrigs = new Set(stillStaged.map((entry) => entry.originalFile));
      return currentStaged.some(
        (item) =>
          isUnsentCompanion(item) &&
          stillStagedOrigs.has(item.originalFile) &&
          !uploadedOrigs?.has(item.originalFile)
      );
    };
    if (activeStaged.length > 0) {
      let failedUpload = false;
      const prepResult = await prepareAndUploadDeferredAttachments({
        room: liveRoom,
        items: activeStaged,
        batchItems: activeStaged,
        textContent,
        prepareForSend: (targetRoom, items) =>
          input.prepareAttachmentsForSend!(targetRoom, items ?? activeStaged),
        uploadItem: input.uploadItem
          ? (item) =>
              input.uploadItem!(item).then(
                () =>
                  attachments.snapshot(roomId).staged.some((entry) => entry.file === item.file)
                    ? item
                    : undefined,
                () => {
                  if (
                    attachments.snapshot(roomId).staged.some((entry) => entry.file === item.file)
                  ) {
                    failedUpload = true;
                  }
                  return undefined;
                }
              )
          : undefined,
        onPrepared: (prepared) => {
          // Merge replacements by originalFile while keeping still-staged unprepared items so
          // retrying Send as voice never silently drops an oversized/failed Home attachment.
          const liveStaged = attachments.snapshot(roomId).staged;
          const liveByOrig = new Map(liveStaged.map((entry) => [entry.originalFile, entry]));
          const preparedByOrig = new Map(prepared.map((item) => [item.originalFile, item]));
          const merged = currentStaged
            .map(
              (prev) => preparedByOrig.get(prev.originalFile) ?? liveByOrig.get(prev.originalFile)
            )
            .filter((item): item is TUploadItem => item !== undefined);
          const seenOrig = new Set(merged.map((item) => item.originalFile));
          for (const item of prepared) {
            if (!seenOrig.has(item.originalFile)) merged.push(item);
          }
          currentStaged = merged;
          prepared.forEach((item) => enrolledFileRefs.add(item.file));
        },
        isAborted: () => !isLive(),
      });
      if (prepResult.aborted) return { status: 'aborted' };
      if (prepResult.missingPasteMarker) return { status: 'missingPaste' };
      if (requireAllStaged) {
        const stillStaged = attachments.snapshot(roomId).staged;
        const stillStagedFiles = new Set(stillStaged.map((entry) => entry.file));
        const uploadedOrigs = new Set(prepResult.uploadedItems.map((entry) => entry.originalFile));
        if (
          failedUpload ||
          prepResult.prepared.some(
            (item) => Boolean(item.prepError) && stillStagedFiles.has(item.file)
          ) ||
          hasUnsentStaged(stillStaged, uploadedOrigs)
        ) {
          return { status: 'failedUpload' };
        }
      }
      const sendSet = new Set(prepResult.uploadedItems.map((item) => item.file));
      const dropped = [...enrolledFileRefs].filter((file) => !sendSet.has(file));
      if (dropped.length > 0) attachments.clearEnrollment(dropped);
      return { status: 'ready', items: prepResult.uploadedItems };
    }
    const stillStaged = attachments.snapshot(roomId).staged;
    if (hasMissingPasteAttachmentForText(textContent, stillStaged, [])) {
      return { status: 'missingPaste' };
    }
    if (requireAllStaged && hasUnsentStaged(stillStaged)) {
      return { status: 'failedUpload' };
    }
    return { status: 'ready', items: activeStaged };
  };

  const handleFinishResult = async (result: DictationFinishResult): Promise<void> => {
    if (!isLive()) {
      if (result.status === 'completed' && journalId) releaseCapture(journalId);
      abortDetachedSend();
      return;
    }
    if (result.status === 'cancelled') {
      restoreDraftAndCleanup(input.docSnapshot);
      return;
    }
    if (result.status === 'failed') {
      markFailed();
      return;
    }

    const scratch = mergeDictatedDoc(
      input.docSnapshot,
      result.text,
      input.savedSelection,
      input.pendingMarks
    );
    const mergedFallback = structuredClone(scratch.children);
    const blockedCommand = detectBlockedSlashCommand(scratch.children);
    if (blockedCommand) {
      restoreDraftAndCleanup(mergedFallback);
      settleJournal();
      if (blockedCommand.kind === 'unknown') {
        getMountedOwner(store, ownerKey)?.onCommandProblem(blockedCommand.command);
      }
      return;
    }

    const textContent = composeDetachedTextContent(scratch);
    const activeStaged = getActiveStaged();
    if (!textContent && activeStaged.length === 0) {
      restoreDraftAndCleanup(input.docSnapshot);
      settleJournal();
      const mountedOwner = getMountedOwner(store, ownerKey);
      if (mountedOwner) {
        mountedOwner.onNoSpeech();
      } else {
        store.set(detachedDictationErrorAtom, {
          ownerKey,
          roomName: input.roomName,
          kind: 'noSpeech',
        });
      }
      return;
    }

    const liveRoom = mx.getRoom(roomId);
    if (!liveRoom || (ask && !ask.canSend(liveRoom))) {
      restoreDraftAndCleanup(mergedFallback);
      settleJournal();
      return;
    }

    const preparedStaged = await prepareCompanionStaged(liveRoom, activeStaged, textContent);
    if (preparedStaged.status === 'aborted') {
      clearEnrollments();
      if (journalId) releaseCapture(journalId);
      restoreDocOnAccountSwitch();
      removeEntry();
      return;
    }
    if (preparedStaged.status !== 'ready' || (!textContent && preparedStaged.items.length === 0)) {
      restoreDraftAndCleanup(
        preparedStaged.status === 'missingPaste' ? mergedFallback : input.docSnapshot
      );
      settleJournal();
      return;
    }
    const sendStaged = preparedStaged.items;

    const effectiveRootModel =
      skipsRootModel(textContent) && sendStaged.length === 0 ? undefined : input.rootModel;
    if (input.rootModel && !effectiveRootModel) {
      input.restoreRootModelDraft?.(liveRoom, input.rootModel);
    }
    removeEntry();
    clearMatchingError();
    if (textContent) input.dismissLostNotices?.();

    let textConsumed = false;
    const onTextConsumed = () => {
      if (textConsumed) return;
      textConsumed = true;
      settleJournal();
    };
    try {
      await input.sessions.startSendSession({
        ...buildSendSessionBase(liveRoom, textContent),
        rootModel: effectiveRootModel ?? null,
        batch: { fileItems: sendStaged },
        completeWithinCall: Boolean(input.prepareAttachmentsForSend && sendStaged.length > 0),
        composerFallback: mergedFallback,
        onTextConsumed,
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.warn('[dictation-send] could not send dictated message', error);
      if (!textConsumed && isLive()) {
        restoreDraftAndCleanup(mergedFallback);
      }
      onTextConsumed();
    } finally {
      if (sameAccount()) ask?.onSendingChange?.(false);
    }
  };

  function retryAndSend() {
    if (!isLive() || currentEntry.status !== 'failed') return;
    clearMatchingError();
    setEntryStatus('sending');
    void session
      .retryFailed()
      .then(handleFinishResult, () => handleFinishResult({ status: 'cancelled' }));
  }

  const runSendAsVoice = async (): Promise<void> => {
    const { createVoiceUploadItems, uploadItem } = input;
    if (!createVoiceUploadItems || !uploadItem) {
      return markFailed(VOICE_SEND_FALLBACK_ERROR);
    }

    const voiceAudio = await session.buildVoiceAudio();
    if (!isLive()) return abortDetachedSend();
    if (!voiceAudio) return markFailed(VOICE_SEND_FALLBACK_ERROR);

    const liveRoom = mx.getRoom(roomId);
    if (!liveRoom || (ask && !ask.canSend(liveRoom))) {
      return markFailed(VOICE_SEND_FALLBACK_ERROR);
    }

    const scratch = mergeDictatedDoc(
      input.docSnapshot,
      voiceAudio.missingAudioPartialText ?? '',
      input.savedSelection,
      input.pendingMarks
    );
    const mergedFallback = structuredClone(scratch.children);
    const blockedCommand = detectBlockedSlashCommand(scratch.children);
    if (blockedCommand) {
      if (blockedCommand.kind === 'unknown') {
        getMountedOwner(store, ownerKey)?.onCommandProblem(blockedCommand.command);
        return markFailed(
          `Unknown command "/${blockedCommand.command}". Discard to edit the draft.`
        );
      }
      return markFailed(
        'Slash commands cannot be sent with a voice message. Discard to edit the draft.'
      );
    }
    const textContent = composeDetachedTextContent(scratch);

    let sendStaged: TUploadItem[] | undefined;
    if (isDeferredSend) {
      // Prepare deferred companions before uploading the WAV so a known oversized/failed
      // companion fails immediately instead of re-uploading the voice recording on every retry.
      const preparedStaged = await prepareCompanionStaged(
        liveRoom,
        getActiveStaged(),
        textContent,
        true
      );
      if (preparedStaged.status === 'aborted') return abortDetachedSend();
      if (preparedStaged.status !== 'ready') {
        return markFailed(
          preparedStaged.status === 'missingPaste'
            ? 'Could not upload pasted attachment.'
            : 'Could not upload attachment.'
        );
      }
      sendStaged = preparedStaged.items;
    }

    let voiceItem: TUploadItem | undefined;
    let voiceCommitted = false;
    try {
      try {
        const [first] = await createVoiceUploadItems(
          voiceAudio.file,
          voiceAudio.duration,
          voiceAudio.waveform,
          liveRoom
        );
        if (!first || first.prepError) {
          throw first?.prepError ?? new Error('Could not prepare voice message.');
        }
        voiceItem = first;
        if (!isLive()) return abortDetachedSend();
        await uploadItem(voiceItem);
      } catch (error) {
        if (!isLive()) return abortDetachedSend();
        return markFailed(describeVoiceFallbackError(error));
      }
      if (!isLive()) return abortDetachedSend();

      const readyVoiceItem = voiceItem;
      const commitVoice = () => {
        if (voiceCommitted) return;
        voiceCommitted = true;
        removeEntry();
        clearMatchingError();
        if (textContent) input.dismissLostNotices?.();
        settleJournal(session.completeVoiceFallback().journalId ?? journalId);
      };

      if (!isDeferredSend) {
        // Normal rooms hand readyVoiceItem to the composer board + real send controller so it
        // natively handles companion uploads, retries, thread-root continuity, and queuing.
        // Settle the dictation journal on handoff (matching Attach as voice) so removing a
        // failed voice card or leaving the room never resurrects a ghost dictation on reload.
        sendStaged = getActiveStaged();
        attachments.append(roomId, [readyVoiceItem]);
        commitVoice();
      } else if (sendStaged && sendStaged.length > 0) {
        const currentStagedFiles = new Set(
          attachments.snapshot(roomId).staged.map((item) => item.file)
        );
        const withdrawn = sendStaged.filter((item) => !currentStagedFiles.has(item.file));
        if (withdrawn.length > 0) {
          attachments.clearEnrollment(withdrawn.map((item) => item.file));
          sendStaged = sendStaged.filter((item) => currentStagedFiles.has(item.file));
        }
      }

      let keepFailedOnError = false;
      try {
        await input.sessions.startSendSession({
          ...buildSendSessionBase(liveRoom, textContent),
          rootModel: createdThreadId ? null : (input.rootModel ?? null),
          batch: { fileItems: [...(sendStaged ?? []), readyVoiceItem] },
          completeWithinCall: isDeferredSend,
          composerFallback: isDeferredSend ? [] : mergedFallback,
          onUploadSent: isDeferredSend
            ? (sentFile: TUploadContent, rootEventId?: string) => {
                if (rootEventId && !sendContext.threadId && !createdThreadId) {
                  createdThreadId = rootEventId;
                }
                if (sentFile === readyVoiceItem.file) {
                  commitVoice();
                } else {
                  sentCompanionFiles.add(sentFile);
                  const match = currentStaged.find((item) => item.file === sentFile);
                  if (match) sentCompanionFiles.add(match.originalFile);
                }
              }
            : undefined,
        });
        if (isDeferredSend && !voiceCommitted) {
          throw new Error(VOICE_SEND_FALLBACK_ERROR);
        }
      } catch (error) {
        // eslint-disable-next-line no-console
        console.warn('[dictation-send] could not send dictation as voice message', error);
        if (isDeferredSend && !voiceCommitted) {
          if (isLive()) {
            keepFailedOnError = true;
            markFailed(describeVoiceFallbackError(error));
          } else {
            abortDetachedSend();
          }
        } else if (textContent && isLive()) {
          restoreTextFragment(mergedFallback);
        }
      } finally {
        if (sameAccount() && !keepFailedOnError) ask?.onSendingChange?.(false);
      }
    } finally {
      if (voiceItem && (isDeferredSend || !voiceCommitted)) {
        roomUploadAtomFamily.remove(voiceItem.file);
      }
    }
  };

  function sendAsVoice() {
    if (!isLive() || currentEntry.status !== 'failed') return;
    clearMatchingError();
    setEntryStatus('sending');
    void runSendAsVoice().catch((error: unknown) => {
      if (!isLive()) return abortDetachedSend();
      markFailed(describeVoiceFallbackError(error));
    });
  }

  function insertPartial() {
    if (!isLive() || currentEntry.status !== 'failed') return;
    const { text } = session.takePartialText();
    const scratch = mergeDictatedDoc(
      input.docSnapshot,
      text,
      input.savedSelection,
      input.pendingMarks
    );
    restoreDraftAndCleanup(structuredClone(scratch.children));
    settleJournal();
  }

  async function discard(): Promise<void> {
    if (!isLive() || currentEntry.status !== 'failed') return;
    if (store.get(detachedDictationSendsAtom).get(ownerKey) !== currentEntry) return;
    restoreDraftAndCleanup(input.docSnapshot);
    await session.discard();
  }

  function abort() {
    if (aborted) return;
    aborted = true;
    session.reset();
    clearEnrollments();
    restoreDocOnAccountSwitch();
  }

  const entry = setEntryStatus('sending');
  const finishPromise = session.finish();
  void finishPromise.then(handleFinishResult, () => handleFinishResult({ status: 'cancelled' }));
  return entry;
};
