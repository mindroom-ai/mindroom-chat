import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useAtom, useAtomValue, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Text, config } from 'folds';
import { Dialog, IconButton } from '../../ui/glass/GlassPrimitives';
import { IconTooltip } from '../../ui/IconTooltip';
import { ModalLayer } from '../../ui/ModalLayer';
import { coverNoticeSlotAtom, pageNoticeSlotAtom } from '../../ui/noticeSlots';
import { millisecondsToMinutesAndSeconds } from '../../lib/common';
import {
  discardLiveVoiceRecording,
  liveVoiceCapsulesShownAtom,
  liveVoiceRecordingAtom,
  liveVoiceRecordingErrorAtom,
} from './liveVoiceRecording';
import { DiscardVoiceRecordingDialog } from './DiscardVoiceRecordingDialog';
import { useVoiceCaptureSnapshot } from './useVoiceRecorder';
import type { VoiceCaptureSession } from './voiceCaptureSession';
import { localizeVoiceErrorMessage } from './voiceErrorMessage';
import * as css from './LiveVoiceRecordingIndicator.css';

/**
 * The account's live recording where no composer shows it (the Threads page, settings, a phone's
 * room list): a pill with its time and Discard, which asks first as a composer's does. It has no
 * Send, because a recording has no destination until Send is pressed in a composer. It shows in
 * the app's notice places (ui/noticeSlots.tsx): the one inside what covers the page (a large
 * dialog, a phone's members sheet or drawer), where the keyboard still reaches it, else the
 * page's. Mounted once in the signed-in shell, it also shows why a recording could not be
 * captured, once for every composer.
 */
export function LiveVoiceRecordingIndicator() {
  const { t } = useTranslation();
  const store = useStore();
  const recording = useAtomValue(liveVoiceRecordingAtom);
  const { phase, elapsedMs } = useVoiceCaptureSnapshot(recording);
  const capsulesShown = useAtomValue(liveVoiceCapsulesShownAtom);
  const [error, setError] = useAtom(liveVoiceRecordingErrorAtom);
  // The recording whose Discard was pressed here, until the person confirms or cancels.
  const [discarding, setDiscarding] = useState<VoiceCaptureSession>();
  const paused = phase === 'paused';
  const requesting = phase === 'requesting';
  const discardLabel = t('mindroomUi.voice.discardRecording');
  const coverSlot = useAtomValue(coverNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const slot = coverSlot ?? pageSlot;
  const shown = recording !== undefined && capsulesShown === 0 && slot !== null;
  const status = requesting
    ? t('mindroomUi.voice.statusStarting')
    : t(paused ? 'mindroomUi.voice.statusPaused' : 'mindroomUi.voice.statusActive');
  const label = requesting
    ? status
    : t(paused ? 'composer.voiceIndicator.paused' : 'composer.voiceIndicator.recording', {
        time: millisecondsToMinutesAndSeconds(elapsedMs),
      });

  return (
    <>
      {/* A modal layer, so OK answers over a bottom sheet or the command palette too. */}
      <ModalLayer open={error !== undefined} onClose={() => setError(undefined)}>
        <Dialog variant="Surface">
          <Box direction="Column" gap="300" style={{ padding: config.space.S400, maxWidth: 360 }}>
            <Text size="H5">{t('mindroomUi.voice.voiceRecorderDialog.voiceRecordingError')}</Text>
            <Text size="T300">{localizeVoiceErrorMessage(t, error)}</Text>
            <Box justifyContent="End" gap="200">
              <Button
                variant="Primary"
                onClick={() => setError(undefined)}
                fill="Soft"
                outlined
                radii="300"
              >
                {t('mindroomUi.voice.voiceRecorderDialog.ok')}
              </Button>
            </Box>
          </Box>
        </Dialog>
      </ModalLayer>
      <DiscardVoiceRecordingDialog
        open={recording !== undefined && discarding === recording}
        onCancel={() => setDiscarding(undefined)}
        onDiscard={() => discardLiveVoiceRecording(store)}
      />
      {/* Announce state once even when several capsules show it. Timers are never live. */}
      <span className={css.Announcement} role="status">
        {recording !== undefined && status}
      </span>
      {shown &&
        createPortal(
          <div className={css.Pill} aria-live="off" data-testid="live-voice-recording-indicator">
            <span className={css.Dot({ paused })} aria-hidden />
            <Text className={css.Label} size="B300">
              {label}
            </Text>
            <IconTooltip label={discardLabel} position="Bottom">
              {(triggerRef) => (
                <IconButton
                  ref={triggerRef}
                  variant="SurfaceVariant"
                  size="300"
                  radii="Pill"
                  onClick={() => setDiscarding(recording)}
                  aria-label={discardLabel}
                >
                  <Icon src={Icons.Delete} size="50" />
                </IconButton>
              )}
            </IconTooltip>
          </div>,
          slot
        )}
    </>
  );
}
