import { useState } from 'react';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Box, Button, Text, config } from 'folds';
import { Dialog } from '../../ui/glass/GlassPrimitives';
import { ModalLayer } from '../../ui/ModalLayer';
import { captureDiscardsInFlightAtom, type LiveCaptureKind } from './liveCapture';

type DiscardCaptureDialogProps = {
  kind: LiveCaptureKind;
  open: boolean;
  onCancel: () => void;
  /** Confirmed: only now does the capture go. Resolves once its disk copy is gone. */
  onDiscard: () => Promise<void>;
};

/**
 * Asks before a voice recording or dictation is discarded, live or parked: every Discard goes
 * through it. Focus starts on Cancel and stays inside; Escape or a press outside cancels. It
 * stays, busy, until the confirmed capture is gone from disk too: a reload cannot offer it again.
 * It offers no notice place, or the capture it asks about would move into it
 * (`LiveCaptureIndicator.tsx`).
 */
export function DiscardCaptureDialog({
  kind,
  open,
  onCancel,
  onDiscard,
}: DiscardCaptureDialogProps) {
  const { t } = useTranslation();
  const title =
    kind === 'voice'
      ? t('mindroomUi.voice.voiceRecorderDialog.discardVoiceRecording')
      : t('composer.dictation.discardConfirmTitle');
  const body =
    kind === 'voice'
      ? t('mindroomUi.voice.voiceRecorderDialog.thisRecordingHasNotBeenSentDiscardItPermanently')
      : t('composer.dictation.discardConfirmBody');
  const [busy, setBusy] = useState(false);
  // Counted for the app too: a composer keeps this question up, and a reload still asks.
  const setInFlight = useSetAtom(captureDiscardsInFlightAtom);
  // The buttons stay enabled, so the focus kept inside always has a place.
  const discard = () => {
    if (busy) return;
    setBusy(true);
    setInFlight((count) => count + 1);
    void onDiscard().finally(() => {
      setBusy(false);
      setInFlight((count) => count - 1);
    });
  };
  return (
    <ModalLayer open={open || busy} busy={busy} onClose={onCancel}>
      <Dialog
        variant="Surface"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        noticeSlot={false}
      >
        <Box direction="Column" gap="300" style={{ padding: config.space.S400, maxWidth: 360 }}>
          <Text size="H5">{title}</Text>
          <Text size="T300">{body}</Text>
          <Box justifyContent="End" gap="200">
            <Button variant="Secondary" onClick={onCancel} fill="Soft" outlined radii="300">
              {t('mindroomUi.voice.voiceRecorderDialog.cancel')}
            </Button>
            <Button variant="Critical" onClick={discard} fill="Soft" outlined radii="300">
              {t('mindroomUi.voice.voiceRecorderDialog.discard')}
            </Button>
          </Box>
        </Box>
      </Dialog>
    </ModalLayer>
  );
}
