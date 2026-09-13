import React, { useEffect, useRef } from 'react';
import {
  Box,
  Button,
  Dialog,
  Line,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Text,
  config,
} from 'folds';
import { VoiceRecordingCapsule } from '../../features/room/VoiceRecordingCapsule';
import { useVoiceRecorder } from '../../features/room/useVoiceRecorder';

type VoiceRecorderComposerProps = {
  active: boolean;
  sendDisabled?: boolean;
  onClose: () => void;
  onRecordingStart?: () => void;
  onSendStopRequest?: () => boolean | void;
  onSendStopFailure?: () => void;
  onSendRecording: (file: File, duration: number, waveform?: number[]) => Promise<void> | void;
};

export function VoiceRecorderComposer({
  active,
  sendDisabled,
  onClose,
  onRecordingStart,
  onSendStopRequest,
  onSendStopFailure,
  onSendRecording,
}: VoiceRecorderComposerProps) {
  const autoStartTriggeredRef = useRef(false);
  const {
    phase,
    elapsedMs,
    waveform,
    errorMessage,
    canPause,
    start,
    pause,
    resume,
    send,
    discard,
    reset,
    clearError,
  } = useVoiceRecorder({
    onRecordingStart,
    onSendStopRequest,
    onSendStopFailure,
    onSendRecording,
  });

  const discardAndClose = () => {
    void (async () => {
      await discard();
      onClose();
    })();
  };

  const sendAndClose = () => {
    if (sendDisabled) return;

    void (async () => {
      const sent = await send();
      if (sent) {
        onClose();
      }
    })();
  };

  const dismissError = () => {
    clearError();
    onClose();
  };

  useEffect(() => {
    if (!active) {
      autoStartTriggeredRef.current = false;
      reset();
      return;
    }

    if (autoStartTriggeredRef.current) return;
    autoStartTriggeredRef.current = true;
    void start();
  }, [active, reset, start]);

  if (!active && !errorMessage) {
    return null;
  }

  return (
    <>
      <Overlay open={!!errorMessage} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <Dialog variant="Surface">
            <Box direction="Column" gap="300" style={{ padding: config.space.S400, maxWidth: 360 }}>
              <Text size="H5">Voice Recording Error</Text>
              <Text size="T300">{errorMessage}</Text>
              <Box justifyContent="End" gap="200">
                <Button variant="Primary" onClick={dismissError}>
                  OK
                </Button>
              </Box>
            </Box>
          </Dialog>
        </OverlayCenter>
      </Overlay>

      {active && (
        <div>
          <Line variant="SurfaceVariant" size="300" />
          <Box style={{ padding: `${config.space.S200} ${config.space.S300}` }}>
            <VoiceRecordingCapsule
              phase={phase}
              elapsedMs={elapsedMs}
              waveform={waveform}
              canPause={canPause}
              sendDisabled={sendDisabled}
              onDiscard={discardAndClose}
              onPause={pause}
              onResume={resume}
              onSend={sendAndClose}
            />
          </Box>
        </div>
      )}
    </>
  );
}
