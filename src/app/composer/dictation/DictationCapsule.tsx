import { useEffect, useRef } from 'react';
import { Box, Button, Icon, Icons, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { formatClockDurationMs } from '../../lib/time';
import { IconButton } from '../../ui/glass/GlassPrimitives';
import { useLiquidGlass } from '../../ui/glass/liquid/useLiquidGlass';
import { useLiveCaptureCapsuleVisible } from '../capture/useLiveCaptureCapsuleVisible';
import { VoiceMessageIcon } from '../voice/VoiceMessageIcon';
import { CapsuleControlButton, RecordingCapsule } from '../voice/VoiceRecordingCapsule';
import * as voiceCss from '../voice/VoiceRecordingCapsule.css';
import * as css from './DictationCapsule.css';
import type { DictationSnapshot } from './dictationSession';

export type DictationCapsuleProps = {
  snapshot: DictationSnapshot;
  sending?: boolean;
  showingLive?: boolean;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onRetry?: () => void;
  onVoiceFallback?: () => void;
  voiceFallbackPending?: boolean;
  onInsertPartial: () => void;
  onDiscard: () => void;
  onDismissError: () => void;
};

const getScreenReaderStatusKey = (
  phase: DictationSnapshot['phase'],
  sending: boolean,
  recovered: boolean
) => {
  if (phase === 'requesting') return 'composer.dictation.statusStarting' as const;
  if (phase === 'paused') {
    return recovered
      ? ('composer.dictation.statusRecovered' as const)
      : ('composer.dictation.statusPaused' as const);
  }
  if (phase === 'finishing') {
    return sending
      ? ('composer.dictation.statusSending' as const)
      : ('composer.dictation.statusFinishing' as const);
  }
  return 'composer.dictation.statusListening' as const;
};

export function DictationCapsule({
  snapshot,
  sending = false,
  showingLive = false,
  onCancel,
  onPause,
  onResume,
  onFinish,
  onRetry,
  onVoiceFallback,
  voiceFallbackPending = false,
  onInsertPartial,
  onDiscard,
  onDismissError,
}: DictationCapsuleProps) {
  const { t } = useTranslation();
  const glassRef = useLiquidGlass<HTMLDivElement>();
  const {
    phase,
    elapsedMs,
    waveform,
    sampleCount,
    pendingUploads,
    failedSegments,
    hasPartialText,
    hasVoiceAudio,
    previewText,
    interrupted,
    recovered,
    hasClient,
    errorMessage,
  } = snapshot;
  useLiveCaptureCapsuleVisible(showingLive && phase !== 'idle');
  const previewRef = useRef<HTMLDivElement | null>(null);
  const showPreview = phase !== 'idle' && previewText.length > 0;

  useEffect(() => {
    const el = previewRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [phase, previewText]);

  const previewNode = showPreview ? (
    <div
      ref={previewRef}
      className={css.Preview}
      role="region"
      data-testid="dictation-preview"
      aria-label={t('composer.dictation.previewLabel')}
    >
      <Text size="T300">{previewText}</Text>
    </div>
  ) : null;

  // Non-active microphone error banner (e.g. permission denied before recording started).
  if (phase === 'idle') {
    if (!errorMessage) return null;
    return (
      <div className={voiceCss.Container}>
        <Box ref={glassRef} className={voiceCss.Capsule} role="alert">
          <Icon size="100" src={Icons.Warning} className={voiceCss.Control} />
          <Text size="T300" className={css.ErrorText}>
            {errorMessage}
          </Text>
          <IconButton
            size="300"
            radii="300"
            variant="SurfaceVariant"
            className={voiceCss.Control}
            aria-label={t('composer.dictation.dismissError')}
            onClick={onDismissError}
          >
            <Icon size="50" src={Icons.Cross} />
          </IconButton>
        </Box>
      </div>
    );
  }

  // Inline failure recovery bar after Finish could not transcribe all segments.
  if (phase === 'failed') {
    const summary = t('composer.dictation.failedSummary', { count: failedSegments });
    const detail =
      errorMessage && errorMessage !== summary ? `${summary} ${errorMessage}` : summary;
    return (
      <div className={voiceCss.Container}>
        <Box ref={glassRef} className={voiceCss.CapsuleStacked}>
          {previewNode}
          <div className={css.RecoveryBar} role="alert">
            <Text size="T300" className={css.ErrorText}>
              {detail}
            </Text>
            <div className={css.RecoveryActions}>
              {onRetry && (
                <Button
                  size="300"
                  radii="300"
                  variant="Primary"
                  className={css.RecoveryButton}
                  onClick={onRetry}
                >
                  <Text size="B300">
                    {sending ? t('composer.dictation.retryAndSend') : t('composer.dictation.retry')}
                  </Text>
                </Button>
              )}
              {hasVoiceAudio && onVoiceFallback && (
                <Button
                  size="300"
                  radii="300"
                  variant="Secondary"
                  fill="Soft"
                  outlined
                  className={css.RecoveryButton}
                  disabled={voiceFallbackPending}
                  before={<Icon size="50" src={VoiceMessageIcon} aria-hidden="true" />}
                  onClick={onVoiceFallback}
                >
                  <Text size="B300">
                    {sending
                      ? t('composer.dictation.sendAsVoice')
                      : t('composer.dictation.attachAsVoice')}
                  </Text>
                </Button>
              )}
              {hasPartialText && (
                <Button
                  size="300"
                  radii="300"
                  variant="Secondary"
                  fill="Soft"
                  outlined
                  className={css.RecoveryButton}
                  onClick={onInsertPartial}
                >
                  <Text size="B300">{t('composer.dictation.insertPartial')}</Text>
                </Button>
              )}
              <Button
                size="300"
                radii="300"
                variant="Critical"
                fill="Soft"
                outlined
                className={css.RecoveryButton}
                onClick={onDiscard}
              >
                <Text size="B300">{t('composer.dictation.discard')}</Text>
              </Button>
            </div>
          </div>
        </Box>
      </div>
    );
  }

  const recording = phase === 'recording';
  const paused = phase === 'paused';
  const finishing = phase === 'finishing';
  const requesting = phase === 'requesting';
  const pauseDisabled = requesting || finishing || sending || (paused && !hasClient);
  const finishDisabled = requesting || finishing || sending;
  const time = formatClockDurationMs(elapsedMs);
  const timerText = recovered ? t('composer.dictation.recoveredDuration', { time }) : time;

  let subtleStatus: string | undefined;
  if (finishing) {
    subtleStatus = sending
      ? t('composer.dictation.statusSending')
      : t('composer.dictation.statusFinishing');
  } else if (interrupted) {
    subtleStatus = t('composer.dictation.micInterrupted');
  } else if (paused && !hasClient && (pendingUploads > 0 || failedSegments > 0)) {
    subtleStatus = t('composer.dictation.statusPendingRetry', {
      count: pendingUploads + failedSegments,
    });
  } else if (failedSegments > 0) {
    subtleStatus = t('composer.dictation.statusPendingRetry', { count: failedSegments });
  } else if (errorMessage) {
    subtleStatus = errorMessage;
  }

  return (
    <div className={voiceCss.Container}>
      <RecordingCapsule
        top={previewNode}
        dismissIcon={Icons.Cross}
        dismissLabel={t('composer.dictation.cancel')}
        dismissDisabled={sending}
        onDismiss={onCancel}
        waveform={waveform}
        liveSampleCount={recording ? sampleCount : undefined}
        waveformDimmed={paused || finishing || requesting || sending}
        timerText={timerText}
        paused={paused}
        pauseLabel={paused ? t('composer.dictation.resume') : t('composer.dictation.pause')}
        pauseDisabled={pauseDisabled}
        onTogglePause={paused ? onResume : onPause}
        after={
          <CapsuleControlButton
            label={t('composer.dictation.finish')}
            variant="SurfaceVariant"
            disabled={finishDisabled}
            onClick={onFinish}
          >
            {finishing ? (
              <Spinner size="50" variant="Secondary" />
            ) : (
              <Icon src={Icons.Check} size="50" />
            )}
          </CapsuleControlButton>
        }
        bottom={
          subtleStatus ? (
            <Text size="T200" className={css.StatusNote}>
              {subtleStatus}
            </Text>
          ) : null
        }
        statusText={subtleStatus ?? t(getScreenReaderStatusKey(phase, sending, recovered))}
        statusRole="status"
      />
    </div>
  );
}
