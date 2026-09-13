import React from 'react';
import { Box, Icon, IconButton, Icons, Spinner, Text } from 'folds';
import { millisecondsToMinutesAndSeconds } from '../../utils/common';
import { VoiceWaveform } from '../../components/voice/VoiceWaveform';
import { VoiceRecorderPhase } from './useVoiceRecorder';
import * as css from './VoiceRecordingCapsule.css';

type VoiceRecordingCapsuleProps = {
  phase: VoiceRecorderPhase;
  elapsedMs: number;
  waveform: number[];
  canPause: boolean;
  hasPendingSend?: boolean;
  sendDisabled?: boolean;
  onDiscard: () => void;
  onPause: () => void;
  onResume: () => void;
  onSend: () => void;
};

const isBusyPhase = (phase: VoiceRecorderPhase): boolean =>
  phase === 'requesting' || phase === 'processing' || phase === 'sending';

const getStatusText = (phase: VoiceRecorderPhase): string => {
  if (phase === 'requesting') return 'Starting voice recording';
  if (phase === 'paused') return 'Voice recording paused';
  if (phase === 'processing') return 'Processing voice recording';
  if (phase === 'sending') return 'Sending voice recording';
  return 'Voice recording active';
};

export function VoiceRecordingCapsule({
  phase,
  elapsedMs,
  waveform,
  canPause,
  hasPendingSend,
  sendDisabled: sendDisabledProp,
  onDiscard,
  onPause,
  onResume,
  onSend,
}: VoiceRecordingCapsuleProps) {
  const busy = isBusyPhase(phase);
  const paused = phase === 'paused';
  const recording = phase === 'recording';
  const pendingReady = hasPendingSend && phase === 'idle';
  const pauseDisabled = pendingReady || busy || (!paused && (!recording || !canPause));
  const sendDisabled = sendDisabledProp || busy || (!pendingReady && !recording && !paused);
  const sendLabel = pendingReady ? 'Retry sending voice recording' : 'Send voice recording';
  const statusText = pendingReady ? 'Voice recording ready to retry' : getStatusText(phase);

  return (
    <Box className={css.Capsule}>
      <IconButton
        variant="SurfaceVariant"
        size="300"
        radii="300"
        onClick={onDiscard}
        disabled={phase === 'processing' || phase === 'sending'}
        aria-label="Discard voice recording"
      >
        <Icon src={Icons.Delete} size="50" />
      </IconButton>
      <VoiceWaveform waveform={waveform} dimmed={paused || busy} compact />
      <Text className={css.Timer} size="B300" aria-live="polite">
        {millisecondsToMinutesAndSeconds(elapsedMs)}
      </Text>
      <IconButton
        variant="SurfaceVariant"
        size="300"
        radii="300"
        onClick={paused ? onResume : onPause}
        disabled={pauseDisabled}
        aria-label={paused ? 'Resume voice recording' : 'Pause voice recording'}
        aria-pressed={paused}
      >
        {busy ? (
          <Spinner size="50" variant="Secondary" />
        ) : (
          <Icon src={paused ? Icons.Play : Icons.Pause} size="50" />
        )}
      </IconButton>
      <IconButton
        variant="Primary"
        size="300"
        radii="300"
        onClick={onSend}
        disabled={sendDisabled}
        aria-label={sendLabel}
      >
        {phase === 'sending' ? (
          <Spinner size="50" variant="Primary" fill="Solid" />
        ) : (
          <Icon src={Icons.Send} size="50" />
        )}
      </IconButton>
      <span className={css.HiddenStatus} aria-live="polite">
        {statusText}
      </span>
    </Box>
  );
}
