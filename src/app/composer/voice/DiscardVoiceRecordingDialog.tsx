import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Button, Text, config } from 'folds';
import { Dialog } from '../../ui/glass/GlassPrimitives';
import { ModalLayer } from '../../ui/ModalLayer';

type DiscardVoiceRecordingDialogProps = {
  open: boolean;
  onCancel: () => void;
  /** Confirmed: only now does the recording go. Resolves once its disk copy is gone. */
  onDiscard: () => Promise<void>;
};

/**
 * Asks before a voice recording is discarded, live or parked: every Discard goes through it.
 * Focus starts on Cancel and stays inside; Escape or a press outside cancels. It stays, busy,
 * until the confirmed recording is gone from disk too: a reload cannot offer it again. It offers
 * no notice place, or the recording it asks about would move into it
 * (LiveVoiceRecordingIndicator.tsx).
 */
export function DiscardVoiceRecordingDialog({
  open,
  onCancel,
  onDiscard,
}: DiscardVoiceRecordingDialogProps) {
  const { t } = useTranslation();
  const title = t('mindroomUi.voice.voiceRecorderDialog.discardVoiceRecording');
  const [busy, setBusy] = useState(false);
  // The buttons stay enabled, so the focus kept inside always has a place.
  const discard = () => {
    if (busy) return;
    setBusy(true);
    void onDiscard().finally(() => setBusy(false));
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
          <Text size="T300">
            {t(
              'mindroomUi.voice.voiceRecorderDialog.thisRecordingHasNotBeenSentDiscardItPermanently'
            )}
          </Text>
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
