import { createPortal } from 'react-dom';
import { useAtom, useAtomValue, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import {
  Box,
  Button,
  Icon,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  config,
} from 'folds';
import { Dialog, IconButton } from '../../ui/glass/GlassPrimitives';
import { IconTooltip } from '../../ui/IconTooltip';
import {
  dialogNoticeSlotAtom,
  drawerNoticeSlotAtom,
  pageNoticeSlotAtom,
} from '../../ui/noticeSlots';
import { millisecondsToMinutesAndSeconds } from '../../lib/common';
import {
  discardLiveVoiceRecording,
  liveVoiceCapsulesShownAtom,
  liveVoiceRecordingAtom,
  liveVoiceRecordingErrorAtom,
} from './liveVoiceRecording';
import { useVoiceCaptureSnapshot } from './useVoiceRecorder';
import { localizeVoiceErrorMessage } from './voiceErrorMessage';
import * as css from './LiveVoiceRecordingIndicator.css';

/**
 * The account's live recording where no composer shows it (the Threads page, settings, a phone's
 * room list): a pill with its time and Discard. It has no Send, because a recording has no
 * destination until Send is pressed in a composer. It shows in the app's notice places
 * (ui/noticeSlots.tsx): the page's, or the one inside what covers the page, a large dialog or a
 * phone's drawer, where the keyboard still reaches it. Mounted once in the signed-in shell, it
 * also shows why a recording could not be captured, once for every composer.
 */
export function LiveVoiceRecordingIndicator() {
  const { t } = useTranslation();
  const store = useStore();
  const recording = useAtomValue(liveVoiceRecordingAtom);
  const { phase, elapsedMs } = useVoiceCaptureSnapshot(recording);
  const capsulesShown = useAtomValue(liveVoiceCapsulesShownAtom);
  const [error, setError] = useAtom(liveVoiceRecordingErrorAtom);
  const paused = phase === 'paused';
  const time = millisecondsToMinutesAndSeconds(elapsedMs);
  const discardLabel = t('mindroomUi.voice.discardRecording');
  const dialogSlot = useAtomValue(dialogNoticeSlotAtom);
  const drawerSlot = useAtomValue(drawerNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const slot = dialogSlot ?? drawerSlot ?? pageSlot;

  return (
    <>
      <Overlay open={error !== undefined} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
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
        </OverlayCenter>
      </Overlay>
      {recording &&
        capsulesShown === 0 &&
        slot &&
        createPortal(
          <>
            {/* The place reads out what is added to it; the time, which changes every second,
                is left out of that, and the state is said once, when it changes. */}
            <div className={css.Pill} aria-live="off" data-testid="live-voice-recording-indicator">
              <span className={css.Dot({ paused })} aria-hidden />
              <Text className={css.Label} size="B300">
                {paused
                  ? t('composer.voiceIndicator.paused', { time })
                  : t('composer.voiceIndicator.recording', { time })}
              </Text>
              <IconTooltip label={discardLabel} position="Bottom">
                {(triggerRef) => (
                  <IconButton
                    ref={triggerRef}
                    variant="SurfaceVariant"
                    size="300"
                    radii="Pill"
                    onClick={() => discardLiveVoiceRecording(store)}
                    aria-label={discardLabel}
                  >
                    <Icon src={Icons.Delete} size="50" />
                  </IconButton>
                )}
              </IconTooltip>
            </div>
            <span className={css.Announcement}>
              {paused ? t('mindroomUi.voice.statusPaused') : t('mindroomUi.voice.statusActive')}
            </span>
          </>,
          slot
        )}
    </>
  );
}
