import { useEffect, useRef } from 'react';
import { Box, Button, Icon, Icons, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { millisecondsToMinutesAndSeconds } from '../../lib/common';
import { VoiceWaveform } from '../../messages/content/voice/VoiceWaveform';
import { IconButton } from '../../ui/glass/GlassPrimitives';
import { useLiquidGlass } from '../../ui/glass/liquid/useLiquidGlass';
import { IconTooltip } from '../../ui/IconTooltip';
import * as voiceCss from '../voice/VoiceRecordingCapsule.css';
import * as css from './DictationCapsule.css';
import type { DictationSnapshot } from './dictationSession';

export type DictationCapsuleProps = {
  snapshot: DictationSnapshot;
  onCancel: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onRetry: () => void;
  onInsertPartial: () => void;
  onDiscard: () => void;
  onDismissError: () => void;
};

const getScreenReaderStatusKey = (phase: DictationSnapshot['phase']) => {
  if (phase === 'requesting') return 'composer.dictation.statusStarting' as const;
  if (phase === 'paused') return 'composer.dictation.statusPaused' as const;
  if (phase === 'finishing') return 'composer.dictation.statusFinishing' as const;
  return 'composer.dictation.statusListening' as const;
};

export function DictationCapsule({
  snapshot,
  onCancel,
  onPause,
  onResume,
  onFinish,
  onRetry,
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
    failedSegments,
    hasPartialText,
    previewText,
    capReached,
    interrupted,
    errorMessage,
  } = snapshot;
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
      <div className={css.Container}>
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
      <div className={css.Container}>
        <Box ref={glassRef} className={css.Capsule} role="alert">
          {previewNode}
          <div className={css.RecoveryBar}>
            <Text size="T300" className={css.ErrorText}>
              {detail}
            </Text>
            <div className={css.RecoveryActions}>
              <Button size="300" radii="300" variant="Primary" onClick={onRetry}>
                <Text size="B300">{t('composer.dictation.retry')}</Text>
              </Button>
              {hasPartialText && (
                <Button
                  size="300"
                  radii="300"
                  variant="Secondary"
                  fill="Soft"
                  outlined
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
  const pauseDisabled = requesting || finishing || capReached;
  const finishDisabled = requesting || finishing;

  let subtleStatus: string | undefined;
  if (finishing) {
    subtleStatus = t('composer.dictation.statusFinishing');
  } else if (capReached) {
    subtleStatus = t('composer.dictation.capReached');
  } else if (interrupted) {
    subtleStatus = t('composer.dictation.micInterrupted');
  } else if (failedSegments > 0) {
    subtleStatus = t('composer.dictation.statusPendingRetry', { count: failedSegments });
  } else if (errorMessage) {
    subtleStatus = errorMessage;
  }

  return (
    <div className={css.Container}>
      <Box ref={glassRef} className={css.Capsule}>
        {previewNode}
        <div className={css.ControlsRow}>
          <IconTooltip label={t('composer.dictation.cancel')} position="Top">
            {(triggerRef) => (
              <IconButton
                ref={triggerRef}
                variant="SurfaceVariant"
                size="300"
                radii="300"
                className={voiceCss.Control}
                onClick={onCancel}
                aria-label={t('composer.dictation.cancel')}
              >
                <Icon src={Icons.Cross} size="50" />
              </IconButton>
            )}
          </IconTooltip>
          <VoiceWaveform
            waveform={waveform}
            liveSampleCount={recording ? sampleCount : undefined}
            dimmed={paused || finishing || requesting}
            compact
          />
          <Text className={voiceCss.Timer} size="B300">
            {millisecondsToMinutesAndSeconds(elapsedMs)}
          </Text>
          <IconTooltip
            label={paused ? t('composer.dictation.resume') : t('composer.dictation.pause')}
            position="Top"
          >
            {(triggerRef) => (
              <IconButton
                ref={triggerRef}
                variant="SurfaceVariant"
                size="300"
                radii="300"
                className={voiceCss.Control}
                onClick={paused ? onResume : onPause}
                disabled={pauseDisabled}
                aria-label={paused ? t('composer.dictation.resume') : t('composer.dictation.pause')}
                aria-pressed={paused}
              >
                <Icon src={paused ? Icons.Play : Icons.Pause} size="50" />
              </IconButton>
            )}
          </IconTooltip>
          <IconTooltip label={t('composer.dictation.finish')} position="Top">
            {(triggerRef) => (
              <IconButton
                ref={triggerRef}
                variant="Primary"
                size="300"
                radii="300"
                className={voiceCss.Control}
                onClick={onFinish}
                disabled={finishDisabled}
                aria-label={t('composer.dictation.finish')}
              >
                {finishing ? (
                  <Spinner size="50" variant="Primary" />
                ) : (
                  <Icon src={Icons.Check} size="50" />
                )}
              </IconButton>
            )}
          </IconTooltip>
        </div>
        <span className={voiceCss.HiddenStatus} role="status">
          {subtleStatus ?? t(getScreenReaderStatusKey(phase))}
        </span>
      </Box>
      {subtleStatus && (
        <Text size="T200" className={css.StatusNote}>
          {subtleStatus}
        </Text>
      )}
    </div>
  );
}
