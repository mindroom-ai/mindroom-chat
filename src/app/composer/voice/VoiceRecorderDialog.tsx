import { useTranslation } from 'react-i18next';
import {
  type ForwardRefRenderFunction,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { Box, Button, Overlay, OverlayBackdrop, OverlayCenter, Text, config } from 'folds';
import FocusTrap from 'focus-trap-react';
import { useAtomValue, useSetAtom } from 'jotai';
import { Dialog } from '../../ui/glass/GlassPrimitives';
import { localizeVoiceErrorMessage } from './voiceErrorMessage';
import { DiscardVoiceRecordingDialog } from './DiscardVoiceRecordingDialog';
import { VoiceRecordingCapsule } from './VoiceRecordingCapsule';
import * as voiceCapsuleCss from './VoiceRecordingCapsule.css';
import { useVoiceRecorder, type VoiceRecorderPhase } from './useVoiceRecorder';
import { stopPropagation } from '../../lib/keyboard';
import type { PendingVoiceSendContext } from '../roomInputDrafts';
import { useConversationOutOfSightAtom } from '../../navigation/conversationView';
import { coverNoticeSlotAtom } from '../../ui/noticeSlots';
import { liveVoiceCapsulesShownAtom } from './liveVoiceRecording';

type VoiceRecorderComposerProps = {
  ownsPendingVoiceDraft: boolean;
  sendDisabled?: boolean;
  onSendStopRequest?: () => boolean | void;
  onSendStopFailure?: () => void;
  onRetryRequest: () => void;
  onSendRecording: (
    file: File,
    duration: number,
    waveform: number[] | undefined,
    context: PendingVoiceSendContext
  ) => Promise<void> | void;
  getSendContext: () => PendingVoiceSendContext;
};

export type VoiceRecorderComposerHandle = {
  send: () => Promise<boolean>;
  /** The phase as last rendered, for the voice key, which sends only a recording that runs. */
  phase: () => VoiceRecorderPhase;
};

/**
 * A composer's recorder: the capsule of the account's live recording, which every composer on
 * screen shows alike, or of this composer's parked draft with its failure and discard dialogs.
 * It mounts while there is one to show and starts or ends nothing by mounting.
 */
const VoiceRecorderComposerRender: ForwardRefRenderFunction<
  VoiceRecorderComposerHandle,
  VoiceRecorderComposerProps
> = (
  {
    ownsPendingVoiceDraft,
    sendDisabled,
    onSendStopRequest,
    onSendStopFailure,
    onRetryRequest,
    onSendRecording,
    getSendContext,
  },
  ref
) => {
  const { t } = useTranslation();
  const [discardConfirmationOpen, setDiscardConfirmationOpen] = useState(false);
  // Tracks a deferred (backdrop/Escape-dismissed) failure overlay. The
  // capsule + parked draft remain visible; the user can re-open the overlay
  // by retrying through primary composer Send. A fresh failure surfaces a fresh
  // overlay because errorMessage will differ from the deferred value.
  // The defer signal MUST come from the per-event predicates below
  // (clickOutsideDeactivates / escapeDeactivates), NOT from FocusTrap's
  // onDeactivate: focus-trap-react snapshots onDeactivate at first mount
  // and invokes it on every trap teardown, including the unmount that
  // happens when Retry/Discard flips showPendingSendError to false. Per-event
  // predicates run with the latest closure (or in our case, with stable refs
  // that always read live state).
  const [deferredErrorMessage, setDeferredErrorMessage] = useState<string | undefined>();
  const {
    phase,
    elapsedMs,
    waveform,
    sampleCount,
    errorMessage,
    canPause,
    hasPendingSend,
    recovered,
    pendingDuration,
    pendingWaveform,
    pause,
    resume,
    send,
    discard,
    retry,
    discardPending,
  } = useVoiceRecorder({
    ownsPendingVoiceDraft,
    onSendStopRequest,
    onSendStopFailure,
    onSendRecording,
    getSendContext,
  });
  const displayErrorMessage = localizeVoiceErrorMessage(t, errorMessage);

  const errorMessageRef = useRef(errorMessage);
  useEffect(() => {
    errorMessageRef.current = errorMessage;
  }, [errorMessage]);

  // The shell's indicator stands in while no composer shows the recording. This one counts while
  // it is in sight: its conversation is (not behind a side panel or a folded column), and
  // nothing covers the page (a large dialog such as Settings, a phone's drawer or members sheet).
  const conversationOutOfSight = useAtomValue(useConversationOutOfSightAtom());
  const pageCovered = useAtomValue(coverNoticeSlotAtom) !== null;
  const outOfSight = conversationOutOfSight || pageCovered;
  const setCapsulesShown = useSetAtom(liveVoiceCapsulesShownAtom);
  useEffect(() => {
    if (outOfSight) return undefined;
    setCapsulesShown((count) => count + 1);
    return () => setCapsulesShown((count) => count - 1);
  }, [outOfSight, setCapsulesShown]);

  // Any user-initiated retry must clear an existing defer so a follow-up
  // failure with the same canonical message (very common: connection-dropped)
  // re-surfaces the overlay rather than getting silently hidden.
  const beginRetry = useCallback((): Promise<boolean> => {
    setDeferredErrorMessage(undefined);
    return retry();
  }, [retry]);

  const submitRecording = useCallback(async (): Promise<boolean> => {
    if (sendDisabled || discardConfirmationOpen) return false;
    return hasPendingSend ? beginRetry() : send();
  }, [beginRetry, discardConfirmationOpen, hasPendingSend, send, sendDisabled]);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  useImperativeHandle(ref, () => ({ send: submitRecording, phase: () => phaseRef.current }), [
    submitRecording,
  ]);

  const confirmDiscard = () => {
    setDiscardConfirmationOpen(false);
    return hasPendingSend ? discardPending() : discard();
  };

  const showPendingSendError =
    !!errorMessage &&
    hasPendingSend &&
    !discardConfirmationOpen &&
    errorMessage !== deferredErrorMessage;

  // captureDeferDismiss reads errorMessage via errorMessageRef declared
  // below so the per-event predicate (captured by focus-trap-react at first
  // mount) always sees live state.
  const captureDeferDismiss = (): boolean => {
    if (errorMessageRef.current) {
      setDeferredErrorMessage(errorMessageRef.current);
    }
    return true;
  };

  return (
    <>
      <Overlay open={showPendingSendError} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <FocusTrap
            focusTrapOptions={{
              // Backdrop click and Escape key dismiss the overlay without
              // discarding the draft. The capsule remains visible so the user
              // can defer the retry/discard decision. Both signals come from
              // PER-EVENT predicates so they only fire on actual user-defer
              // intent — NOT on the trap-teardown that happens when Retry or
              // Discard flips showPendingSendError to false. (Earlier
              // revisions used onDeactivate, which focus-trap-react snapshots
              // at first mount and invokes on every teardown — that
              // mis-deferred valid Retry / Discard transitions.)
              clickOutsideDeactivates: captureDeferDismiss,
              escapeDeactivates: (event) => {
                // stopPropagation returns false when an editable element has
                // focus inside the trap — in that case keep the trap and let
                // the editable own the Escape.
                if (!stopPropagation(event)) return false;
                return captureDeferDismiss();
              },
            }}
          >
            {/* div lets FocusTrap attach its ref even when Dialog is a
                non-forwardRef function component (folds Dialog supports
                refs in production but the test mock doesn't). */}
            <div>
              <Dialog variant="Surface">
                <Box
                  direction="Column"
                  gap="300"
                  style={{ padding: config.space.S400, maxWidth: 360 }}
                >
                  <Text size="H5">{t('mindroomUi.voice.voiceRecorderDialog.voiceSendFailed')}</Text>
                  <Box direction="Column" gap="100">
                    <Text size="T300">{displayErrorMessage}</Text>
                    <Text size="T300">
                      {t('mindroomUi.voice.voiceRecorderDialog.yourRecordingIsStillSaved')}
                    </Text>
                  </Box>
                  <Box justifyContent="End" gap="200">
                    <Button
                      variant="Secondary"
                      onClick={() => setDiscardConfirmationOpen(true)}
                      fill="Soft"
                      outlined
                      radii="300"
                    >
                      {t('mindroomUi.voice.voiceRecorderDialog.discard')}
                    </Button>
                    <Button
                      variant="Primary"
                      onClick={onRetryRequest}
                      fill="Soft"
                      outlined
                      radii="300"
                    >
                      {t('mindroomUi.voice.voiceRecorderDialog.retry')}
                    </Button>
                  </Box>
                </Box>
              </Dialog>
            </div>
          </FocusTrap>
        </OverlayCenter>
      </Overlay>

      <DiscardVoiceRecordingDialog
        open={discardConfirmationOpen}
        onCancel={() => setDiscardConfirmationOpen(false)}
        onDiscard={confirmDiscard}
      />

      <div className={voiceCapsuleCss.Container}>
        <VoiceRecordingCapsule
          phase={phase}
          elapsedMs={hasPendingSend ? pendingDuration : elapsedMs}
          waveform={hasPendingSend ? pendingWaveform : waveform}
          sampleCount={hasPendingSend ? undefined : sampleCount}
          canPause={canPause}
          hasPendingSend={hasPendingSend}
          recovered={recovered}
          onDiscard={() => setDiscardConfirmationOpen(true)}
          onPause={pause}
          onResume={resume}
        />
      </div>
    </>
  );
};

export const VoiceRecorderComposer = forwardRef(VoiceRecorderComposerRender);
