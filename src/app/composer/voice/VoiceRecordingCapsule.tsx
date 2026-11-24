import type { AriaRole, ReactNode } from 'react';
import { Box, Icon, Icons, Spinner, Text, type IconSrc } from 'folds';
import { useTranslation } from 'react-i18next';
import { IconButton } from '../../ui/glass/GlassPrimitives';
import { millisecondsToMinutesAndSeconds } from '../../lib/common';
import { VoiceWaveform } from '../../messages/content/voice/VoiceWaveform';
import { VoiceRecorderPhase } from './useVoiceRecorder';
import { useLiquidGlass } from '../../ui/glass/liquid/useLiquidGlass';
import * as css from './VoiceRecordingCapsule.css';
import { IconTooltip } from '../../ui/IconTooltip';

export function CapsuleControlButton(props: {
  label: string;
  variant?: 'SurfaceVariant' | 'Primary';
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <IconTooltip label={props.label} position="Top">
      {(triggerRef) => (
        <IconButton
          ref={triggerRef}
          variant={props.variant ?? 'SurfaceVariant'}
          size="300"
          radii="300"
          className={css.Control}
          onClick={props.onClick}
          disabled={props.disabled}
          aria-label={props.label}
          aria-pressed={props.pressed}
        >
          {props.children}
        </IconButton>
      )}
    </IconTooltip>
  );
}

export type RecordingCapsuleProps = {
  top?: ReactNode;
  dismissIcon: IconSrc;
  dismissLabel: string;
  dismissDisabled?: boolean;
  onDismiss: () => void;
  waveform: number[];
  liveSampleCount?: number;
  waveformDimmed?: boolean;
  timerText: string;
  paused: boolean;
  pauseLabel: string;
  pauseDisabled?: boolean;
  pauseBusy?: boolean;
  onTogglePause: () => void;
  after?: ReactNode;
  statusText: string;
  statusRole?: AriaRole;
};

export function RecordingCapsule(props: RecordingCapsuleProps) {
  const glassRef = useLiquidGlass<HTMLDivElement>();

  return (
    <Box ref={glassRef} className={css.CapsuleStacked}>
      {props.top}
      <div className={css.ControlsRow}>
        <CapsuleControlButton
          label={props.dismissLabel}
          disabled={props.dismissDisabled}
          onClick={props.onDismiss}
        >
          <Icon src={props.dismissIcon} size="50" />
        </CapsuleControlButton>
        <VoiceWaveform
          waveform={props.waveform}
          liveSampleCount={props.liveSampleCount}
          dimmed={props.waveformDimmed}
          compact
        />
        <Text className={css.Timer} size="B300">
          {props.timerText}
        </Text>
        <CapsuleControlButton
          label={props.pauseLabel}
          disabled={props.pauseDisabled}
          pressed={props.paused}
          onClick={props.onTogglePause}
        >
          {props.pauseBusy ? (
            <Spinner size="50" variant="Secondary" />
          ) : (
            <Icon src={props.paused ? Icons.Play : Icons.Pause} size="50" />
          )}
        </CapsuleControlButton>
        {props.after}
      </div>
      <span className={css.HiddenStatus} role={props.statusRole}>
        {props.statusText}
      </span>
    </Box>
  );
}

type VoiceRecordingCapsuleProps = {
  phase: VoiceRecorderPhase;
  elapsedMs: number;
  waveform: number[];
  /** Samples of the live recording so far; the bars glide left as it grows. */
  sampleCount?: number;
  canPause: boolean;
  hasPendingSend?: boolean;
  recovered?: boolean;
  onDiscard: () => void;
  onPause: () => void;
  onResume: () => void;
};

const isBusyPhase = (phase: VoiceRecorderPhase): boolean =>
  phase === 'requesting' || phase === 'sending';

const getStatusKey = (phase: VoiceRecorderPhase) => {
  if (phase === 'requesting') return 'mindroomUi.voice.statusStarting' as const;
  if (phase === 'paused') return 'mindroomUi.voice.statusPaused' as const;
  if (phase === 'sending') return 'mindroomUi.voice.statusSending' as const;
  return 'mindroomUi.voice.statusActive' as const;
};

export function VoiceRecordingCapsule({
  phase,
  elapsedMs,
  waveform,
  sampleCount,
  canPause,
  hasPendingSend,
  recovered,
  onDiscard,
  onPause,
  onResume,
}: VoiceRecordingCapsuleProps) {
  const { t } = useTranslation();
  const busy = isBusyPhase(phase);
  const paused = phase === 'paused';
  const recording = phase === 'recording';
  const pendingReady = hasPendingSend && phase === 'idle';
  const pauseDisabled = pendingReady || busy || (!paused && (!recording || !canPause));
  const time = millisecondsToMinutesAndSeconds(elapsedMs);
  const statusText = pendingReady
    ? t('mindroomUi.voice.statusReadyToRetry')
    : t(getStatusKey(phase));

  return (
    <RecordingCapsule
      dismissIcon={Icons.Delete}
      dismissLabel={t('mindroomUi.voice.discardRecording')}
      dismissDisabled={phase === 'sending'}
      onDismiss={onDiscard}
      waveform={waveform}
      // Only a recording glides: paused or finishing, the bars stop, and the count starts
      // afresh on resume rather than gliding in everything since.
      liveSampleCount={recording ? sampleCount : undefined}
      waveformDimmed={paused || busy}
      timerText={recovered ? t('mindroomUi.voice.recoveredRecording', { time }) : time}
      paused={paused}
      pauseLabel={
        paused ? t('mindroomUi.voice.resumeRecording') : t('mindroomUi.voice.pauseRecording')
      }
      pauseDisabled={pauseDisabled}
      pauseBusy={busy}
      onTogglePause={paused ? onResume : onPause}
      statusText={statusText}
    />
  );
}
