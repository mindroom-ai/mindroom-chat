import { useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useAtom, useAtomValue, useStore } from 'jotai';
import { useTranslation } from 'react-i18next';
import { Box, Button, Icon, Icons, Text, config } from 'folds';
import { Dialog, IconButton } from '../../ui/glass/GlassPrimitives';
import { IconTooltip } from '../../ui/IconTooltip';
import { ModalLayer } from '../../ui/ModalLayer';
import { coverNoticeSlotAtom, pageNoticeSlotAtom } from '../../ui/noticeSlots';
import { millisecondsToMinutesAndSeconds } from '../../lib/common';
import { localizeVoiceErrorMessage } from '../voice/voiceErrorMessage';
import { DiscardCaptureDialog } from './DiscardCaptureDialog';
import {
  discardLiveCapture,
  liveCaptureAtom,
  liveCaptureCapsulesShownAtom,
  liveCaptureErrorAtom,
  type LiveCapture,
  type LiveCaptureSession,
} from './liveCapture';
import * as css from './LiveCaptureIndicator.css';

type CaptureIndicatorSnapshot = {
  readonly phase: string;
  readonly elapsedMs: number;
  readonly recovered?: boolean;
};

const IDLE_SNAPSHOT: CaptureIndicatorSnapshot = {
  phase: 'idle',
  elapsedMs: 0,
};
const getIdleSnapshot = (): CaptureIndicatorSnapshot => IDLE_SNAPSHOT;
const subscribeToNothing = () => () => undefined;

const useLiveCaptureSnapshot = (
  session: LiveCaptureSession | undefined
): CaptureIndicatorSnapshot => {
  const getSnapshot: () => CaptureIndicatorSnapshot = session?.getSnapshot ?? getIdleSnapshot;
  return useSyncExternalStore(session?.subscribe ?? subscribeToNothing, getSnapshot, getSnapshot);
};

/**
 * The account's live capture (voice recording or dictation) where no composer shows it (the
 * Threads page, settings, a phone's room list): a pill with its time and confirmed Discard. It
 * has no Send, because a capture has no destination until Finish or Send is pressed in a
 * composer. It shows in the app's notice places (`ui/noticeSlots.tsx`): the one inside what
 * covers the page (a large dialog, a phone's members sheet or drawer), where the keyboard still
 * reaches it, else the page's. Mounted once in the signed-in shell, it also shows why a capture
 * could not complete, once for every composer.
 */
export function LiveCaptureIndicator() {
  const { t } = useTranslation();
  const store = useStore();
  const capture = useAtomValue(liveCaptureAtom);
  const { phase, elapsedMs, recovered } = useLiveCaptureSnapshot(capture?.session);
  const capsulesShown = useAtomValue(liveCaptureCapsulesShownAtom);
  const [error, setError] = useAtom(liveCaptureErrorAtom);
  // The capture whose Discard was pressed here, kept until confirmation finishes deleting it.
  const [discarding, setDiscarding] = useState<LiveCapture>();
  const coverSlot = useAtomValue(coverNoticeSlotAtom);
  const pageSlot = useAtomValue(pageNoticeSlotAtom);
  const slot = coverSlot ?? pageSlot;
  const shown = capture !== undefined && capsulesShown === 0 && slot !== null;
  const time = millisecondsToMinutesAndSeconds(elapsedMs);

  const isDictation = capture?.kind === 'dictation';
  const paused = phase === 'paused' || phase === 'finishing' || phase === 'failed';
  const discardLabel = isDictation
    ? t('composer.dictation.discardDictation')
    : t('mindroomUi.voice.discardRecording');

  let status = '';
  let label = '';
  if (capture?.kind === 'voice') {
    if (phase === 'requesting') {
      status = t('mindroomUi.voice.statusStarting');
      label = status;
    } else if (phase === 'paused') {
      status = t('mindroomUi.voice.statusPaused');
      label = t('composer.voiceIndicator.paused', { time });
    } else {
      status = t('mindroomUi.voice.statusActive');
      label = t('composer.voiceIndicator.recording', { time });
    }
  } else if (capture?.kind === 'dictation') {
    if (phase === 'requesting') {
      status = t('composer.dictation.statusStarting');
      label = status;
    } else if (phase === 'finishing') {
      status = t('composer.dictation.indicator.finishing');
      label = status;
    } else if (phase === 'failed') {
      status = t('composer.dictation.indicator.failed');
      label = status;
    } else if (phase === 'paused' && recovered) {
      status = t('composer.dictation.statusRecovered');
      label = t('composer.dictation.indicator.recovered', { time });
    } else if (phase === 'paused') {
      status = t('composer.dictation.statusPaused');
      label = t('composer.dictation.indicator.paused', { time });
    } else {
      status = t('composer.dictation.statusListening');
      label = t('composer.dictation.indicator.recording', { time });
    }
  }

  const errorTitle =
    error?.kind === 'dictation'
      ? t('composer.dictation.errorTitle')
      : t('mindroomUi.voice.voiceRecorderDialog.voiceRecordingError');

  return (
    <>
      {/* A modal layer, so OK answers over a bottom sheet or the command palette too. */}
      <ModalLayer open={error !== undefined} onClose={() => setError(undefined)}>
        <Dialog variant="Surface">
          <Box direction="Column" gap="300" style={{ padding: config.space.S400, maxWidth: 360 }}>
            <Text size="H5">{errorTitle}</Text>
            <Text size="T300">{localizeVoiceErrorMessage(t, error?.message)}</Text>
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
      <DiscardCaptureDialog
        kind={discarding?.kind ?? capture?.kind ?? 'voice'}
        open={capture !== undefined && discarding?.session === capture.session}
        onCancel={() => setDiscarding(undefined)}
        onDiscard={() =>
          discardLiveCapture(store, discarding?.session).finally(() => setDiscarding(undefined))
        }
      />
      {/* Announce state once even when several capsules show it. Timers are never live. */}
      <span className={css.Announcement} role="status">
        {capture !== undefined && status}
      </span>
      {shown &&
        createPortal(
          // `data-cover-notice`: it moves into what covers the page (sidebar/PhoneNavDrawer.tsx).
          <div
            className={css.Pill}
            aria-live="off"
            data-testid={
              capture.kind === 'voice'
                ? 'live-voice-recording-indicator'
                : 'live-dictation-indicator'
            }
            data-capture-kind={capture.kind}
            data-cover-notice=""
          >
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
                  onClick={() => setDiscarding(capture)}
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
