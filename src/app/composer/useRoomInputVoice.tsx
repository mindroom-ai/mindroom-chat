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
import { IContent, MatrixClient } from 'matrix-js-sdk';
import type { Descendant } from 'slate';
import { Icon, Icons } from 'folds';
import { IconButton } from '../ui/glass/GlassPrimitives';
import { IconTooltip } from '../ui/IconTooltip';
import { useMediaConfig } from '../matrix/hooks/useMediaConfig';
import {
  type PendingVoiceSendContext,
  type StagedList,
  composerUploadItemsAtom,
  pendingVoiceSendDraftAtom,
  roomUploadAtomFamily,
  threadViewVoiceComposersAtom,
  voiceAutoSendPendingAtom,
  voiceComposerKey,
} from './roomInputDrafts';
import { TUploadItem, UploadStatus } from '../matrix/state/upload';
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
import {
  VoiceRecorderComposer,
  type VoiceRecorderComposerHandle,
} from './voice/VoiceRecorderDialog';
import {
  liveVoiceRecordingAtom,
  startLiveVoiceRecording,
  voiceAccountGuard,
} from './voice/liveVoiceRecording';
import type { VoiceCaptureSession } from './voice/voiceCaptureSession';
import { hasFailedPasteMarkerInText } from './useRoomInputSendSessionController';
import type { useRoomInputSendSessionController } from './useRoomInputSendSessionController';
import type { RoomInputAttachmentAccess } from './roomInputAttachmentAccess';
import type { useRoomInputUploadTransport } from './useRoomInputUploadTransport';
import { ComposerIconButton } from './RoomInput.css';
import { revealDirectionControls } from '../ui/directional';
import { ConversationViewContext } from '../navigation/conversationView';
import { isLocalEchoEventId } from '../event-store/threads/threadRouteUtils';
import { isJoined } from '../matrix/state/roomList';
import { shortcutAttributes } from '../shortcuts/ShortcutKeys';
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
  onRoomMessageSent?: (eventId: string) => boolean | void;
};

/**
 * The voice message a Send carries, decided as it is pressed: the recording that was live then,
 * or the parked one this composer offered then. A Send pressed with neither carries none, however
 * long it waits before it goes out.
 */
export type VoiceSendBinding = { live: VoiceCaptureSession } | { parked: File };

type VoiceFeature = {
  blocksSubmit: () => boolean;
  /** What a Send pressed here now carries. Call it before the Send waits for anything. */
  bindSend: () => VoiceSendBinding | undefined;
  /**
   * Sends what the Send was bound to, with the text, if that is still there to send. False
   * leaves the text to go out alone.
   */
  submitBound: (binding: VoiceSendBinding | undefined, textContent?: IContent) => Promise<boolean>;
  microphone: React.ReactNode;
  renderRecorder: (onRetryRequest: () => void) => React.ReactNode;
  /** What the voice key (right ⌥) reads and does here. */
  voiceKey: Pick<VoiceComposer, 'active' | 'offersFailed' | 'phase' | 'start'>;
};

type PendingVoiceComposerBundle = {
  roomId: string;
  composerThreadId?: string;
  textContent?: IContent;
  composerFallback?: Descendant[];
  companionItems: TUploadItem[];
  /** The list they were staged in, which a thread view drops from its family as it closes. */
  stagedList: StagedList;
  composerReset: boolean;
  handedOff: boolean;
  releasePasteProtection: () => void;
};

export const useRoomInputVoice = ({
  mx,
  composer: { getContext, snapshotText, resetText, restoreText, clearConsumedReply },
  attachments: attachmentAccess,
  transport: { createVoiceUploadItems, uploadItem, uploadItemWhileStaged, sendVoiceItem },
  sessions: { hasActiveSendSession, startSendSession },
  onRoomMessageSent,
}: UseRoomInputVoiceOptions): VoiceFeature => {
  const { t } = useTranslation();
  const store = useStore();
  const view = useContext(ConversationViewContext);
  const mediaConfig = useMediaConfig();
  const allowUploadSize = mediaConfig['m.upload.size'] ?? Infinity;
  // The account's recording, which this composer shows while it runs and sends when its Send is
  // pressed (voice/liveVoiceRecording.ts). It is not this composer's until then.
  const liveRecording = useAtomValue(liveVoiceRecordingAtom) !== undefined;
  // This composer's Send took the recording: its capsule stays, as sending, until that settles.
  // It covers the whole send; the recorder hook's `claimed` (voice/useVoiceRecorder.ts) holds the
  // recording itself for the same time, and is what the capsule draws.
  const [sendingHere, setSendingHere] = useState(false);
  const voiceAutoSendPending = useAtomValue(voiceAutoSendPendingAtom);
  const pendingVoiceSendDraft = useAtomValue(pendingVoiceSendDraftAtom);
  const setPendingVoiceSendDraft = useSetAtom(pendingVoiceSendDraftAtom);
  // Drafts are stamped with the matrix userId of the session that captured
  // them. The global atom is one slot for the whole router, so an account
  // switch in the sidebar leaves yesterday's draft visible to a new
  // account; ignore (and clean up) any draft that does not belong to us.
  const currentSessionId = mx.getUserId() ?? undefined;
  // A failed send recorded in this composer comes back in it.
  const composerContext = getContext();
  const composerKey = voiceComposerKey(composerContext);
  const { roomId } = composerContext;
  const draftBelongsToCurrentSession =
    !!pendingVoiceSendDraft && pendingVoiceSendDraft.context.ownerSessionId === currentSessionId;
  // A recording made while its thread's root was still sending belongs to that thread after.
  const draftKey = draftBelongsToCurrentSession
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
    draftKey === composerKey ||
    (draftKey === voiceComposerKey({ ...composerContext, threadView: true }) &&
      !threadViewComposers.some((entry) => entry.key === draftKey));
  const otherComposerOwnsPendingVoiceDraft = draftBelongsToCurrentSession && !ownsPendingVoiceDraft;
  // Set while this composer holds the send lock (`voiceAutoSendPendingAtom`): the guard of the
  // account it took the lock under. Left since, the lock is the next account's to release.
  const voiceAutoSendClaimedRef = useRef<() => boolean>();
  const voiceAutoSendInFlightRef = useRef(false);
  const voiceRecorderRef = useRef<VoiceRecorderComposerHandle>(null);
  const pendingVoiceComposerBundleRef = useRef<PendingVoiceComposerBundle>();

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
  useEffect(() => {
    if (!pendingVoiceSendDraft) return;
    if (!draftBelongsToCurrentSession) {
      setPendingVoiceSendDraft(undefined);
      return;
    }
    const sourceRoom = mx.getRoom(pendingVoiceSendDraft.context.roomId);
    if (!sourceRoom || !isJoined(sourceRoom)) {
      setPendingVoiceSendDraft(undefined);
    }
  }, [draftBelongsToCurrentSession, mx, pendingVoiceSendDraft, setPendingVoiceSendDraft]);

  // Where a recording goes when Send is pressed in this composer: its room, thread and reply as
  // they are then. A failed send parks the audio with this context, so a retry keeps the
  // attempted destination. The session id keeps a parked draft from another account's hands.
  const getVoiceSendContext = useCallback(
    (): PendingVoiceSendContext =>
      getRoomInputVoiceSendContext({
        ownerSessionId: mx.getUserId() ?? '',
        ...getContext(),
      }),
    [mx, getContext]
  );

  const claimVoiceAutoSend = useCallback(() => {
    if (store.get(voiceAutoSendPendingAtom)) return false;

    voiceAutoSendClaimedRef.current = voiceAccountGuard(store);
    store.set(voiceAutoSendPendingAtom, true);
    const bundle = pendingVoiceComposerBundleRef.current;
    if (bundle?.textContent && !bundle.composerReset) {
      bundle.composerReset = true;
      resetText();
    }
    return true;
  }, [resetText, store]);

  const releaseVoiceAutoSend = useCallback(() => {
    const sameAccount = voiceAutoSendClaimedRef.current;
    if (!sameAccount) return;

    const bundle = pendingVoiceComposerBundleRef.current;
    if (bundle?.composerReset && !bundle.handedOff && bundle.composerFallback) {
      restoreText(bundle.roomId, bundle.composerFallback, bundle.composerThreadId);
    }
    bundle?.releasePasteProtection();
    pendingVoiceComposerBundleRef.current = undefined;
    voiceAutoSendInFlightRef.current = false;
    voiceAutoSendClaimedRef.current = undefined;
    if (sameAccount()) store.set(voiceAutoSendPendingAtom, false);
  }, [restoreText, store]);

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
      const sameAccount = voiceAccountGuard(store);
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
        liveContext = refreshRoomInputVoiceSendContext(mx, context);
        if (!liveContext) {
          throw new Error(t('composer.voiceRoomUnavailable'));
        }
        // No reply can point at a root the server has not confirmed (still sending, or deleted
        // unsent); a retry once it has can.
        if (isLocalEchoEventId(liveContext.threadId)) {
          throw new Error(t('composer.voiceThreadRootUnsent'));
        }

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
          sentEventIdToNotify = await sendVoiceItem(liveContext, fileItem, mxc);
        } catch (err) {
          return logAndThrowUploadError(err, 'send');
        }
        clearConsumedReply(liveContext);
      } finally {
        if (liveContext && fileItems.length > 0) {
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
      clearConsumedReply,
      createVoiceUploadItems,
      hasActiveSendSession,
      mx,
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
  // Send here sends the account's recording here, with this composer's text and files.
  const bindSend = useCallback((): VoiceSendBinding | undefined => {
    const live = store.get(liveVoiceRecordingAtom);
    if (live) return { live };
    const parked = ownsPendingVoiceDraft ? store.get(pendingVoiceSendDraftAtom) : undefined;
    return parked && { parked: parked.file };
  }, [ownsPendingVoiceDraft, store]);
  const submitBound = useCallback(
    async (binding: VoiceSendBinding | undefined, content?: IContent): Promise<boolean> => {
      if (!binding) return false;
      // A Send that waited (for a paste, for its thread's root) sends only what it was pressed
      // with. Sent from another composer or discarded since, that is gone, and what is recorded
      // now is not this Send's. Nothing below waits before the recorder takes it.
      const stillThere =
        'live' in binding
          ? store.get(liveVoiceRecordingAtom) === binding.live
          : ownsPendingVoiceDraft && store.get(pendingVoiceSendDraftAtom)?.file === binding.parked;
      if (!stillThere) return false;
      if (hasFailedPasteMarkerInText(content, attachmentAccess.snapshot().staged)) return true;

      const recorder = voiceRecorderRef.current;
      if (!recorder) return true;

      const context = getContext();
      const companionItems = attachmentAccess.snapshot().staged;
      pendingVoiceComposerBundleRef.current = {
        roomId: context.roomId,
        composerThreadId: context.threadId,
        textContent: content,
        composerFallback: content ? snapshotText() : undefined,
        companionItems,
        stagedList: composerUploadItemsAtom(context.roomId, view),
        releasePasteProtection: attachmentAccess.protectPasteItems(companionItems),
        composerReset: false,
        handedOff: false,
      };
      setSendingHere(true);
      try {
        await recorder.send();
      } finally {
        setSendingHere(false);
        // A request rejected before onSendStopRequest never owns editor state.
        // Drop only that untouched snapshot; claimed requests clear through
        // releaseVoiceAutoSend after send, failure, or retry settlement.
        if (!voiceAutoSendClaimedRef.current) {
          pendingVoiceComposerBundleRef.current?.releasePasteProtection();
          pendingVoiceComposerBundleRef.current = undefined;
        }
      }

      return true;
    },
    [attachmentAccess, getContext, ownsPendingVoiceDraft, snapshotText, store, view]
  );

  const renderRecorder = (onRetryRequest: () => void): React.ReactNode =>
    liveRecording || sendingHere || ownsPendingVoiceDraft ? (
      <VoiceRecorderComposer
        ref={voiceRecorderRef}
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
  // One recording at a time, for the whole account: none starts while one runs, is being sent,
  // or waits parked for a retry, in this composer or another. The voice key shares the guards,
  // read from the store, as the key acts after a delay.
  const microphoneDisabled = liveRecording || voiceAutoSendPending || draftBelongsToCurrentSession;
  const startRecording = (): boolean => {
    const draft = store.get(pendingVoiceSendDraftAtom);
    if (
      store.get(liveVoiceRecordingAtom) ||
      store.get(voiceAutoSendPendingAtom) ||
      draft?.context.ownerSessionId === currentSessionId
    )
      return false;
    pauseAllMediaElements();
    void startLiveVoiceRecording(store);
    return true;
  };
  const recorderShown = liveRecording || sendingHere || ownsPendingVoiceDraft;
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
          <Icon src={Icons.Mic} />
        </IconButton>
      )}
    </IconTooltip>
  );

  return { blocksSubmit, bindSend, submitBound, microphone, renderRecorder, voiceKey };
};
