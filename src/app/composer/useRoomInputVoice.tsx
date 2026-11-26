import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { useAtomValue, useSetAtom, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import { IContent, MatrixClient, Room } from 'matrix-js-sdk';
import type { ThreadModelContent } from '../matrix/protocol/threadModel';
import type { Descendant } from 'slate';
import { Icon } from 'folds';
import { IconButton } from '../ui/glass/GlassPrimitives';
import { IconTooltip } from '../ui/IconTooltip';
import { useMediaConfig } from '../matrix/hooks/useMediaConfig';
import {
  type PendingVoiceSendContext,
  type StagedList,
  composerUploadItemsAtom,
  getRoomInputDraftKey,
  pendingVoiceSendDraftAtom,
  restoreTextToDraft,
  roomUploadAtomFamily,
  threadViewVoiceComposersAtom,
  voiceAutoSendPendingAtom,
  voiceComposerKey,
} from './roomInputDrafts';
import { TUploadItem, UploadStatus } from '../matrix/state/upload';
import { listSessions } from '../matrix/session/sessions';
import { pauseAllMediaElements } from '../lib/dom';
import {
  MatrixUploadErrorStage,
  getMatrixUploadOriginalName,
  toMatrixUploadError,
} from '../matrix/matrix';
import {
  confirmedVoiceThreadId,
  getRoomInputVoiceSendContext,
  refreshRoomInputVoiceSendContext,
} from './RoomInputExtensions';
import { VoiceMessageIcon } from './voice/VoiceMessageIcon';
import {
  VoiceRecorderComposer,
  type VoiceRecorderComposerHandle,
} from './voice/VoiceRecorderDialog';
import {
  captureAccountGuard,
  captureDiscardsInFlightAtom,
  liveCaptureAtom,
} from './capture/liveCapture';
import { startLiveVoiceRecording } from './voice/startLiveVoiceRecording';
import { dictationRestoresAtom, getDictationSessionId } from './dictation/startLiveDictation';
import { useSavedVoiceDraft, voiceDraftRestoresAtom } from './voice/savedVoiceDraft';
import { releaseCapture } from './capture/captureJournal';
import { hasFailedPasteMarkerInText, skipsRootModel } from './useRoomInputSendSessionController';
import type { useRoomInputSendSessionController } from './useRoomInputSendSessionController';
import {
  hasMissingPasteAttachmentForText,
  type RoomInputAttachmentAccess,
} from './roomInputAttachmentAccess';
import type { useRoomInputUploadTransport } from './useRoomInputUploadTransport';
import { ComposerIconButton } from './RoomInput.css';
import { revealDirectionControls } from '../ui/directional';
import { ConversationViewContext } from '../navigation/conversationView';
import { isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';
import { isJoined } from '../matrix/state/roomList';
import { shortcutAttributes } from '../shortcuts/ShortcutKeys';
import { isMidTurnMode, type MidTurnMode } from '../preferences/midTurnModes';
import { useLatestRef } from '../lib/hooks/useLatestRef';
import { settingsAtom } from '../preferences/settings';
import { useSettingValue } from '../preferences/useSettingValue';
import type { VoiceComposer } from './voiceHoldShortcut';

type VoiceComposerAdapter = {
  getContext: () => Pick<
    PendingVoiceSendContext,
    'roomId' | 'room' | 'threadId' | 'replyDraft' | 'threadingEnabled' | 'threadView'
  >;
  snapshotText: () => Descendant[];
  resetText: () => void;
  restoreText: (roomId: string, fragment: Descendant[], threadId?: string) => void;
  clearConsumedReply: (context: Pick<PendingVoiceSendContext, 'roomId' | 'replyDraft'>) => void;
};

type UseRoomInputVoiceOptions = {
  mx: MatrixClient;
  composer: VoiceComposerAdapter;
  attachments: RoomInputAttachmentAccess;
  transport: Pick<
    ReturnType<typeof useRoomInputUploadTransport>,
    'createVoiceUploadItems' | 'uploadItem' | 'uploadItemWhileStaged' | 'sendVoiceItem'
  >;
  sessions: Pick<
    ReturnType<typeof useRoomInputSendSessionController>,
    'hasActiveSendSession' | 'startSendSession'
  >;
  takeRootModelDraft?: (room: Room) => ThreadModelContent | undefined;
  onRoomMessageSent?: (eventId: string) => boolean | void;
  /** False in a composer that takes no recording: it brings none back from disk either. */
  recover?: boolean;
  /** The upload list atom holding staged companions (differs from roomId for staged drafts). */
  stagedList?: StagedList;
  /** Fixed draft key for fallback text restore when not tied to a single room draft. */
  stagedDraftKey?: string;
  /** Prepares/encrypts deferred staged companion files for the target room at Send. */
  prepareAttachmentsForSend?: (room: Room, items?: TUploadItem[]) => Promise<TUploadItem[]>;
};

type VoiceFeature = {
  blocksSubmit: () => boolean;
  /** Whether this composer holds a live recording or parked voice draft ready to send. */
  hasVoice: boolean;
  /**
   * Takes the voice message for a Send, as it is pressed (see the function). Undefined when
   * there is none here, and the Send goes on without one.
   */
  sendAtPress: (
    takeText: (mode?: MidTurnMode) => IContent | undefined,
    pastesMissing: boolean,
    explicitMode?: MidTurnMode
  ) => Promise<void> | undefined;
  microphone: React.ReactNode;
  microphoneLabel: string;
  microphoneDisabled: boolean;
  startRecording: () => boolean;
  renderRecorder: (onRetryRequest: () => void) => React.ReactNode;
  /** What the voice key (⌃⇧Space, Ctrl+Shift+Space) reads and does here. */
  voiceKey: Pick<VoiceComposer, 'active' | 'offersFailed' | 'phase' | 'start'>;
};

type PendingVoiceComposerBundle = {
  roomId: string;
  composerThreadId?: string;
  textContent?: IContent;
  midTurnMode?: MidTurnMode;
  composerFallback?: Descendant[];
  companionItems: TUploadItem[];
  /** The list they were staged in, which a thread view drops from its family as it closes. */
  stagedList: StagedList;
  composerReset: boolean;
  handedOff: boolean;
  releasePasteProtection: () => void;
  /** The text's pasted files were not here at the press: the audio, taken alone, parks. */
  pastesMissing: boolean;
};

export const useRoomInputVoice = ({
  mx,
  composer: { getContext, snapshotText, resetText, restoreText, clearConsumedReply },
  attachments: attachmentAccess,
  transport: { createVoiceUploadItems, uploadItem, uploadItemWhileStaged, sendVoiceItem },
  sessions: { hasActiveSendSession, startSendSession },
  takeRootModelDraft,
  onRoomMessageSent,
  recover = true,
  stagedList,
  stagedDraftKey,
  prepareAttachmentsForSend,
}: UseRoomInputVoiceOptions): VoiceFeature => {
  const { t } = useTranslation();
  const store = useStore();
  const view = useContext(ConversationViewContext);
  const mediaConfig = useMediaConfig();
  const allowUploadSize = mediaConfig['m.upload.size'] ?? Infinity;
  const defaultMidTurnModeRef = useLatestRef(useSettingValue(settingsAtom, 'midTurnSend'));
  // The account's recording, which this composer shows while it runs and sends when its Send is
  // pressed (capture/liveCapture.ts). It is not this composer's until then.
  const liveCapture = useAtomValue(liveCaptureAtom);
  const liveRecording = liveCapture?.kind === 'voice';
  // This composer's Send took the recording: its capsule stays, as sending, until that settles.
  // It covers the whole send; the recorder hook's `claimed` (voice/useVoiceRecorder.ts) holds the
  // recording itself for the same time, and is what the capsule draws.
  const [sendingHere, setSendingHere] = useState(false);
  const voiceAutoSendPending = useAtomValue(voiceAutoSendPendingAtom);
  const voiceDraftRestores = useAtomValue(voiceDraftRestoresAtom);
  const dictationRestores = useAtomValue(dictationRestoresAtom);
  const pendingVoiceSendDraft = useAtomValue(pendingVoiceSendDraftAtom);
  const setPendingVoiceSendDraft = useSetAtom(pendingVoiceSendDraftAtom);
  // Drafts are stamped with the matrix userId of the session that captured
  // them. The global atom is one slot for the whole router, so an account
  // switch in the sidebar leaves yesterday's draft visible to a new
  // account; ignore (and clean up) any draft that does not belong to us.
  const currentSessionId = mx.getUserId() ?? undefined;
  const dictationSessionId = getDictationSessionId(mx);
  // A failed send recorded in this composer comes back in it.
  const composerContext = getContext();
  const composerKey = voiceComposerKey(composerContext);
  const { roomId } = composerContext;
  const draftBelongsToCurrentSession =
    !!pendingVoiceSendDraft && pendingVoiceSendDraft.context.ownerSessionId === currentSessionId;
  // A recovered recording has no destination yet: every composer offers it, and it is sent
  // wherever Send is pressed. A failed send keeps the destination it was attempted at.
  const recovered = draftBelongsToCurrentSession && !!pendingVoiceSendDraft.recovered;
  // A recording made while its thread's root was still sending belongs to that thread after.
  const draftKey =
    draftBelongsToCurrentSession && !recovered
      ? voiceComposerKey({
          ...pendingVoiceSendDraft.context,
          threadId: confirmedVoiceThreadId(
            pendingVoiceSendDraft.context.room,
            pendingVoiceSendDraft.context.threadId
          ),
        })
      : undefined;
  // A thread view's composer, while mounted, is the one to offer its thread's recording.
  const setThreadViewComposers = useSetAtom(threadViewVoiceComposersAtom);
  // Before the page paints: it would show the recording for a frame.
  useLayoutEffect(() => {
    if (view === undefined) return undefined;
    const entry = { key: composerKey, view };
    setThreadViewComposers((entries) => [...entries, entry]);
    return () => setThreadViewComposers((entries) => entries.filter((other) => other !== entry));
  }, [composerKey, setThreadViewComposers, view]);
  const threadViewComposers = useAtomValue(threadViewVoiceComposersAtom);
  // Without one, the room's page offers it while it shows that thread: on a page with no room for
  // the thread's column, the thread shows only there.
  const ownsPendingVoiceDraft =
    recovered ||
    draftKey === composerKey ||
    (draftKey === voiceComposerKey({ ...composerContext, threadView: true }) &&
      !threadViewComposers.some((entry) => entry.key === draftKey));
  const otherComposerOwnsPendingVoiceDraft = draftBelongsToCurrentSession && !ownsPendingVoiceDraft;
  // Set while this composer holds the send lock (`voiceAutoSendPendingAtom`): the guard of the
  // account it took the lock under. Left since, the lock is the next account's to release.
  const voiceAutoSendClaimedRef = useRef<() => boolean>(undefined);
  const voiceAutoSendInFlightRef = useRef(false);
  const voiceRootModelRef = useRef<ThreadModelContent>(undefined);
  const voiceRecorderRef = useRef<VoiceRecorderComposerHandle>(null);
  const pendingVoiceComposerBundleRef = useRef<PendingVoiceComposerBundle>(undefined);

  // Discard any orphaned draft. Three cases:
  //   1. Account-switch leak: the atom is module-level and survives
  //      logout/login since the router store is shared across sessions.
  //      A draft from account A must not block voice recording in B.
  //   2. Same-session room loss (rev-A R4 Issue 2): if the user was
  //      kicked from / left / forgot the parked-draft room, the draft
  //      would keep the mic disabled in every composer of the account
  //      (`microphoneDisabled` below) with no in-app surface to discard.
  //   3. Same-session non-joinable room (rev-B / rev-G R5): a Room
  //      object can survive in mx.getRoom() after the user is no longer
  //      Joined (Leave/Ban/etc), in which case the source room composer
  //      cannot render and the user has no way to retry/discard. Treat
  //      "not joined" the same as "not present".
  // A recovered recording names no room, so only the first case drops it. The disk copy of a
  // dropped draft stays, unlocked, for its account to recover on a later page load.
  useEffect(() => {
    if (!pendingVoiceSendDraft) return;
    const sourceRoom = mx.getRoom(pendingVoiceSendDraft.context.roomId);
    if (!draftBelongsToCurrentSession || (!recovered && (!sourceRoom || !isJoined(sourceRoom)))) {
      if (pendingVoiceSendDraft.recordingId) releaseCapture(pendingVoiceSendDraft.recordingId);
      setPendingVoiceSendDraft(undefined);
    }
  }, [
    draftBelongsToCurrentSession,
    mx,
    pendingVoiceSendDraft,
    recovered,
    setPendingVoiceSendDraft,
  ]);

  // Where a recording goes when Send is pressed in this composer: its room, thread and reply as
  // they are then. A failed send parks the audio with this context, so a retry keeps the
  // attempted destination. The session id keeps a parked draft from another account's hands.
  const getVoiceSendContext = useCallback(
    (): PendingVoiceSendContext => ({
      ...getRoomInputVoiceSendContext({
        ownerSessionId: mx.getUserId() ?? '',
        ...getContext(),
      }),
      ...(pendingVoiceComposerBundleRef.current?.midTurnMode !== undefined && {
        midTurnMode: pendingVoiceComposerBundleRef.current.midTurnMode,
      }),
    }),
    [mx, getContext]
  );
  // What the account left on disk comes back with the first composer: a failed send, or a
  // recording that a crash or a stopped recorder cut short.
  useSavedVoiceDraft(mx, getVoiceSendContext, recover);

  const claimVoiceAutoSend = useCallback(() => {
    if (store.get(voiceAutoSendPendingAtom)) return false;

    voiceAutoSendClaimedRef.current = captureAccountGuard(store);
    store.set(voiceAutoSendPendingAtom, true);
    const bundle = pendingVoiceComposerBundleRef.current;
    const parked =
      store.get(liveCaptureAtom)?.kind === 'voice'
        ? undefined
        : store.get(pendingVoiceSendDraftAtom);
    const target = parked && !parked.recovered ? parked.context : getContext();
    if (
      !bundle?.pastesMissing &&
      !skipsRootModel(bundle?.textContent) &&
      target.threadingEnabled !== false &&
      !target.threadId &&
      !target.replyDraft
    )
      voiceRootModelRef.current = takeRootModelDraft?.(target.room);
    if (bundle?.textContent && !bundle.composerReset) {
      bundle.composerReset = true;
      resetText();
    }
    return true;
  }, [getContext, resetText, store, takeRootModelDraft]);

  const releaseVoiceAutoSend = useCallback(() => {
    const accountGuard = voiceAutoSendClaimedRef.current;
    if (!accountGuard) return;
    const sameAccount = accountGuard();

    const bundle = pendingVoiceComposerBundleRef.current;
    if (bundle?.composerReset && !bundle.handedOff && bundle.composerFallback) {
      const userId = mx.getUserId();
      if (sameAccount) {
        restoreText(bundle.roomId, bundle.composerFallback, bundle.composerThreadId);
      } else if (userId && listSessions().some((session) => session.userId === userId)) {
        // Left, not signed out: the caption waits in the stored draft of the account it was
        // typed under, never in the next account's composer.
        restoreTextToDraft(
          store,
          stagedDraftKey ?? getRoomInputDraftKey(userId, bundle.roomId, bundle.composerThreadId),
          bundle.composerFallback
        );
      }
    }
    voiceRootModelRef.current = undefined;
    bundle?.releasePasteProtection();
    pendingVoiceComposerBundleRef.current = undefined;
    voiceAutoSendInFlightRef.current = false;
    voiceAutoSendClaimedRef.current = undefined;
    if (sameAccount) store.set(voiceAutoSendPendingAtom, false);
  }, [mx, restoreText, stagedDraftKey, store]);

  const handleVoiceSend = useCallback(
    async (
      file: File,
      duration: number,
      waveform: number[] | undefined,
      context: PendingVoiceSendContext
    ) => {
      // Wrap the ENTIRE body in try/finally. The voice auto-send slot is
      // claimed by claimVoiceAutoSend() in onSendStopRequest BEFORE this
      // function is invoked, so any early throw here (live-room refresh
      // failure, "another send pending" guard) MUST still release the
      // slot — otherwise voiceAutoSendPendingAtom stays true forever and
      // text submit + voice recording are globally locked until reload.
      // releaseVoiceAutoSend() short-circuits when no claim is held, so
      // calling it unconditionally is safe even on the un-claimed path.
      let fileItems: TUploadItem[] = [];
      let liveContext: PendingVoiceSendContext | null = null;
      let sentEventIdToNotify: string | undefined;
      let voiceSent = false;
      // Left meanwhile, the account sends nothing more: the send fails, and parks nothing.
      const sameAccount = captureAccountGuard(store);
      const ensureSameAccount = () => {
        if (!sameAccount()) throw new Error(t('composer.voiceRoomUnavailable'));
      };
      const logAndThrowUploadError = (err: unknown, stage: MatrixUploadErrorStage): never => {
        const originalName =
          getMatrixUploadOriginalName(err) ?? (err instanceof Error ? err.name : typeof err);
        const error = toMatrixUploadError(err, stage);
        // eslint-disable-next-line no-console
        console.error('[mr-upload]', {
          stage,
          originalName,
          name: error.name,
          errcode: error.errcode,
          httpStatus: error.httpStatus,
          message: error.message,
        });
        throw error;
      };

      try {
        // Re-resolve the live Room from the matrix client at send/retry
        // time. context.room is a snapshot from Send; it may be stale
        // by retry time (encryption upgrade, membership change,
        // signal-bridge member added/removed). Using the live room also
        // closes a plaintext-leak window: a room that gained encryption
        // between original failure and retry would otherwise be sent
        // unencrypted because context.room.hasEncryptionStateEvent()
        // returns the cached value.
        const pendingComposerBundle = pendingVoiceComposerBundleRef.current;
        const composerBundle =
          pendingComposerBundle?.roomId === context.roomId ? pendingComposerBundle : undefined;
        if (composerBundle?.pastesMissing) throw new Error(t('composer.voiceBundleBlocked'));
        liveContext = refreshRoomInputVoiceSendContext(mx, context);
        if (!liveContext) {
          throw new Error(t('composer.voiceRoomUnavailable'));
        }
        // No reply can point at a root the server has not confirmed (still sending, or deleted
        // unsent); a retry once it has can.
        if (isLocalEchoEventId(liveContext.threadId)) {
          throw new Error(t('composer.voiceThreadRootUnsent'));
        }
        const defaultMidTurnMode = defaultMidTurnModeRef.current;
        const candidateMidTurnMode =
          composerBundle?.midTurnMode ?? liveContext.midTurnMode ?? defaultMidTurnMode;
        const midTurnMode = isMidTurnMode(candidateMidTurnMode) ? candidateMidTurnMode : undefined;

        if (
          store.get(voiceAutoSendPendingAtom) &&
          (!voiceAutoSendClaimedRef.current || voiceAutoSendInFlightRef.current)
        ) {
          throw new Error(t('composer.voiceStillSending'));
        }
        if (!voiceAutoSendClaimedRef.current) {
          voiceAutoSendClaimedRef.current = sameAccount;
          store.set(voiceAutoSendPendingAtom, true);
        }
        voiceAutoSendInFlightRef.current = true;
        const rootModel = voiceRootModelRef.current;
        voiceRootModelRef.current = undefined;

        try {
          fileItems = await createVoiceUploadItems(file, duration, waveform, liveContext.room);
        } catch (err) {
          return logAndThrowUploadError(err, 'create');
        }
        ensureSameAccount();
        const [fileItem] = fileItems;
        if (fileItems.length !== 1 || !fileItem) {
          return logAndThrowUploadError(
            new Error(`Voice message preparation returned ${fileItems.length} upload items.`),
            'create'
          );
        }
        if (
          composerBundle &&
          composerBundle.companionItems.length > 0 &&
          prepareAttachmentsForSend
        ) {
          const initialCompanions = composerBundle.companionItems;
          const preparedCompanions = await prepareAttachmentsForSend(
            liveContext.room,
            initialCompanions
          );
          ensureSameAccount();
          const releasePrepared = attachmentAccess.protectPasteItems(preparedCompanions);
          const prevRelease = composerBundle.releasePasteProtection;
          composerBundle.releasePasteProtection = () => {
            releasePrepared();
            prevRelease();
          };
          if (
            hasMissingPasteAttachmentForText(
              composerBundle.textContent,
              initialCompanions,
              preparedCompanions
            )
          ) {
            return logAndThrowUploadError(
              new Error('A pasted attachment could not be prepared for this room.'),
              'create'
            );
          }
          composerBundle.companionItems = preparedCompanions;
        }
        const liveRoomEncrypted = liveContext.room.hasEncryptionStateEvent();
        // A file removed from the composer before it goes is left out.
        const stillStaged = (item: TUploadItem): boolean =>
          !!composerBundle &&
          store.get(composerBundle.stagedList).some((staged) => staged.file === item.file);
        const getEligibleCompanionItems = (): TUploadItem[] =>
          (composerBundle?.companionItems ?? []).filter(
            (item) =>
              stillStaged(item) &&
              !item.prepError &&
              Boolean(item.encInfo) === liveRoomEncrypted &&
              store.get(roomUploadAtomFamily(item.file)).status !== UploadStatus.Error &&
              item.file.size < allowUploadSize
          );
        let eligibleCompanionItems = getEligibleCompanionItems();
        if (
          composerBundle &&
          (composerBundle.textContent || eligibleCompanionItems.length > 0) &&
          hasActiveSendSession()
        ) {
          // Give a previously failed attachment session one chance to finish after its
          // upload cards were retried or removed before parking this new voice bundle.
          await startSendSession();
          ensureSameAccount();
          eligibleCompanionItems = getEligibleCompanionItems();
        }
        const activeSendSession = hasActiveSendSession();
        if (
          composerBundle &&
          (composerBundle.textContent || eligibleCompanionItems.length > 0) &&
          activeSendSession
        ) {
          throw new Error(t('composer.voiceBundleBlocked'));
        }
        const shouldCombineWithCompanions =
          composerBundle !== undefined &&
          !activeSendSession &&
          fileItem.file.size < allowUploadSize &&
          (eligibleCompanionItems.length > 0 || Boolean(composerBundle.textContent));

        if (shouldCombineWithCompanions) {
          const companionUploadResultsPromise = Promise.allSettled(
            eligibleCompanionItems.map((item) =>
              uploadItemWhileStaged(composerBundle.stagedList, item)
            )
          );
          try {
            await uploadItem(fileItem);
          } catch (err) {
            return logAndThrowUploadError(err, 'upload');
          }
          const companionUploadResults = await companionUploadResultsPromise;
          ensureSameAccount();

          const readyItems = [
            ...companionUploadResults
              .map((result) => (result.status === 'fulfilled' ? result.value : undefined))
              .filter((item): item is TUploadItem => item !== undefined && stillStaged(item)),
            fileItem,
          ];
          try {
            if (composerBundle) {
              composerBundle.handedOff = true;
            }
            await startSendSession({
              textContent: composerBundle?.textContent,
              midTurnMode,
              rootModel: rootModel ?? null,
              batch: {
                fileItems: readyItems,
                uploads: readyItems.map((item) => store.get(roomUploadAtomFamily(item.file))),
              },
              context: liveContext,
              completeWithinCall: true,
              composerFallback: composerBundle?.composerFallback,
              composerContext: composerBundle
                ? { roomId: composerBundle.roomId, threadId: composerBundle.composerThreadId }
                : undefined,
              composerAlreadyReset: composerBundle?.composerReset,
              onUploadSent: (sentFile) => {
                if (sentFile === fileItem.file) {
                  voiceSent = true;
                }
              },
            });
            return;
          } catch (err) {
            if (voiceSent) {
              // Uploads and voice already reached Matrix; lifecycle-complete sending restores
              // the failed trailing text. Treat voice as consumed so recorder retry cannot
              // duplicate an event that the homeserver accepted.
              return;
            }
            return logAndThrowUploadError(err, 'send');
          }
        }

        attachmentAccess.append(liveContext.roomId, fileItems);
        let mxc: string;
        try {
          mxc = await uploadItem(fileItem);
        } catch (err) {
          return logAndThrowUploadError(err, 'upload');
        }
        ensureSameAccount();
        try {
          sentEventIdToNotify = await sendVoiceItem(
            liveContext,
            fileItem,
            mxc,
            rootModel,
            midTurnMode
          );
        } catch (err) {
          return logAndThrowUploadError(err, 'send');
        }
        if (sameAccount()) clearConsumedReply(liveContext);
      } finally {
        if (sameAccount() && liveContext && fileItems.length > 0) {
          attachmentAccess.remove(
            liveContext.roomId,
            fileItems.map((fileItem) => fileItem.file)
          );
        }
        releaseVoiceAutoSend();
      }
      if (sentEventIdToNotify && sameAccount()) {
        onRoomMessageSent?.(sentEventIdToNotify);
      }
    },
    [
      attachmentAccess,
      allowUploadSize,
      defaultMidTurnModeRef,
      clearConsumedReply,
      createVoiceUploadItems,
      hasActiveSendSession,
      mx,
      prepareAttachmentsForSend,
      releaseVoiceAutoSend,
      sendVoiceItem,
      store,
      startSendSession,
      t,
      uploadItem,
      uploadItemWhileStaged,
      onRoomMessageSent,
    ]
  );

  const blocksSubmit = useCallback(() => store.get(voiceAutoSendPendingAtom), [store]);
  // A Send takes the recording at the press: it leaves the account's hands, capture stops and
  // no more audio is recorded. This composer's destination and bundle are taken in that task too
  // (the voice key sends audio only). A send that fails parks its audio at the attempted
  // destination.
  const sendAtPress = useCallback(
    (
      takeText: (mode?: MidTurnMode) => IContent | undefined,
      pastesMissing: boolean,
      explicitMode?: MidTurnMode
    ): Promise<void> | undefined => {
      const liveCapture = store.get(liveCaptureAtom);
      const live = liveCapture?.kind === 'voice' ? liveCapture.session : undefined;
      if (!live && !ownsPendingVoiceDraft) return undefined;
      const context = getContext();
      // No recording is taken for a thread the server has not confirmed: it stays live, so the
      // next press after confirmation sends it.
      if (isLocalEchoEventId(context.threadId)) return undefined;
      const recorder = voiceRecorderRef.current;
      const parked = live ? undefined : store.get(pendingVoiceSendDraftAtom);
      const candidateMode =
        explicitMode ??
        (parked && !parked.recovered ? parked.context.midTurnMode : undefined) ??
        defaultMidTurnModeRef.current;
      const midTurnMode = isMidTurnMode(candidateMode) ? candidateMode : undefined;
      // Text whose pasted files are not here goes nowhere: its restore reads the editor, which
      // this Send would empty. The audio is taken and parks alone; the text and files stay.
      const content = pastesMissing ? undefined : takeText(midTurnMode);
      const staged = pastesMissing ? [] : attachmentAccess.snapshot().staged;
      if (!recorder || hasFailedPasteMarkerInText(content, staged)) return Promise.resolve();

      pendingVoiceComposerBundleRef.current = {
        roomId: context.roomId,
        composerThreadId: context.threadId,
        textContent: content,
        midTurnMode,
        composerFallback: content ? snapshotText() : undefined,
        companionItems: staged,
        stagedList: stagedList ?? composerUploadItemsAtom(context.roomId, view),
        releasePasteProtection: attachmentAccess.protectPasteItems(staged),
        composerReset: false,
        handedOff: false,
        pastesMissing,
      };
      setSendingHere(true);
      // Up to its first wait, in this task: the claim, the destination and the stop of capture.
      return recorder
        .send()
        .then(() => undefined)
        .finally(() => {
          setSendingHere(false);
          // A request rejected before onSendStopRequest never owns editor state.
          // Drop only that untouched snapshot; claimed requests clear through
          // releaseVoiceAutoSend after send, failure, or retry settlement.
          if (!voiceAutoSendClaimedRef.current) {
            pendingVoiceComposerBundleRef.current?.releasePasteProtection();
            pendingVoiceComposerBundleRef.current = undefined;
          }
        });
    },
    [
      attachmentAccess,
      defaultMidTurnModeRef,
      getContext,
      ownsPendingVoiceDraft,
      snapshotText,
      stagedList,
      store,
      view,
    ]
  );

  // A confirmed Discard ends the recording at once and deletes its disk copy after: a recorder
  // that showed stays, with its busy question, until the copy is gone.
  const discarding = useAtomValue(captureDiscardsInFlightAtom) > 0;
  const recorderWasShown = useRef(false);
  const recorderShown =
    liveRecording ||
    sendingHere ||
    ownsPendingVoiceDraft ||
    (discarding && recorderWasShown.current);
  recorderWasShown.current = recorderShown;
  const hasVoice = (liveRecording || ownsPendingVoiceDraft) && !voiceAutoSendPending;
  const renderRecorder = (onRetryRequest: () => void): React.ReactNode =>
    recorderShown ? (
      <VoiceRecorderComposer
        ref={voiceRecorderRef}
        ownsPendingVoiceDraft={ownsPendingVoiceDraft}
        sendDisabled={voiceAutoSendPending}
        onSendStopRequest={claimVoiceAutoSend}
        onSendStopFailure={releaseVoiceAutoSend}
        onRetryRequest={onRetryRequest}
        onSendRecording={handleVoiceSend}
        getSendContext={getVoiceSendContext}
      />
    ) : null;

  let microphoneLabel = t('composer.recordVoice');
  if (otherComposerOwnsPendingVoiceDraft) {
    const { room: draftRoom, roomId: draftRoomId } = pendingVoiceSendDraft.context;
    microphoneLabel =
      draftRoomId === roomId
        ? t('composer.voicePausedInThisRoom')
        : t('composer.voicePausedInOtherRoom', {
            roomName: revealDirectionControls(draftRoom.name ?? draftRoomId),
          });
  }
  // The mic waits for restore, then no recording starts while one runs, sends or waits to retry.
  // Read from the store at start too: the voice key may have pinned this composer before restore.
  const microphoneBlocked = (
    restores = voiceDraftRestores,
    dictRestores = dictationRestores
  ): boolean =>
    (currentSessionId !== undefined && restores.get(currentSessionId) !== null) ||
    (dictationSessionId !== undefined && dictRestores.get(dictationSessionId) != null) ||
    store.get(liveCaptureAtom) !== undefined ||
    liveCapture !== undefined ||
    store.get(voiceAutoSendPendingAtom) ||
    store.get(pendingVoiceSendDraftAtom)?.context.ownerSessionId === currentSessionId;
  const microphoneDisabled = microphoneBlocked();
  const startRecording = (): boolean => {
    if (microphoneBlocked(store.get(voiceDraftRestoresAtom), store.get(dictationRestoresAtom))) {
      return false;
    }
    pauseAllMediaElements();
    void startLiveVoiceRecording(store, getVoiceSendContext());
    return true;
  };
  const voiceShortcut = useSettingValue(settingsAtom, 'voiceHoldShortcut')
    ? 'voiceRecord'
    : undefined;
  const voiceKey: VoiceFeature['voiceKey'] = {
    active: () => recorderShown,
    offersFailed: () => ownsPendingVoiceDraft,
    phase: () => {
      const phase = recorderShown ? voiceRecorderRef.current?.phase() : 'none';
      return phase === 'none' ||
        phase === 'requesting' ||
        phase === 'recording' ||
        phase === 'paused'
        ? phase
        : 'other';
    },
    start: startRecording,
  };

  const microphone = (
    // The label says why the button is disabled while another composer holds a draft;
    // the tooltip shows it too where the browser reports hovering a disabled button.
    <IconTooltip label={microphoneLabel} position="Top" shortcut={voiceShortcut}>
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          onClick={() => {
            startRecording();
          }}
          variant="SurfaceVariant"
          size="300"
          radii="300"
          disabled={microphoneDisabled}
          aria-label={microphoneLabel}
          {...shortcutAttributes(voiceShortcut)}
          className={ComposerIconButton}
        >
          <Icon src={VoiceMessageIcon} />
        </IconButton>
      )}
    </IconTooltip>
  );

  return {
    blocksSubmit,
    hasVoice,
    sendAtPress,
    microphone,
    microphoneLabel,
    microphoneDisabled,
    startRecording,
    renderRecorder,
    voiceKey,
  };
};
