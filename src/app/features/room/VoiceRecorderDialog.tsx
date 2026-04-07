import React, { useEffect, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  Icon,
  IconButton,
  Icons,
  Line,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  config,
} from 'folds';
import { secondsToMinutesAndSeconds } from '../../utils/common';
import {
  DEFAULT_VOICE_RECORDER_MIME_TYPE,
  getAudioFileExtension,
  getSupportedRecorderMimeType,
} from './voiceRecorderMime';
import { pauseAllMediaElements } from '../../utils/dom';

const formatElapsed = (ms: number): string => secondsToMinutesAndSeconds(Math.floor(ms / 1000));

const getVoiceRecorderErrorMessage = (err: unknown): string => {
  if (!window.isSecureContext) {
    return 'Voice recording requires HTTPS on iPhone Safari (or localhost). Open MindRoom over HTTPS.';
  }

  if (err instanceof DOMException) {
    if (err.name === 'NotAllowedError') {
      return 'Microphone access is blocked. Allow microphone access for this site/app in iPhone settings and try again.';
    }
    if (err.name === 'NotFoundError') {
      return 'No microphone was found on this device.';
    }
    if (err.name === 'NotReadableError') {
      return 'Microphone is unavailable right now (it may be in use by another app).';
    }
  }

  if (err instanceof Error) {
    if (/not allowed by the user agent|current context/i.test(err.message)) {
      return 'Microphone access is blocked in this context. On iPhone Safari/Brave, use HTTPS and allow microphone permission.';
    }
    return err.message;
  }

  return 'Failed to access microphone.';
};

type RecorderPhase = 'idle' | 'requesting' | 'recording' | 'processing';

type VoiceRecordingDraft = {
  file: File;
  duration: number;
  previewUrl: string;
};

type VoiceRecorderComposerProps = {
  active: boolean;
  onClose: () => void;
  onSaveRecording: (file: File, duration: number) => Promise<void> | void;
  onSendRecording?: (file: File, duration: number) => Promise<void> | void;
};

export function VoiceRecorderComposer({
  active,
  onClose,
  onSaveRecording,
  onSendRecording,
}: VoiceRecorderComposerProps) {
  const [phase, setPhase] = useState<RecorderPhase>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [draft, setDraft] = useState<VoiceRecordingDraft>();
  const [saving, setSaving] = useState(false);
  const [errorDialogMessage, setErrorDialogMessage] = useState<string>();

  const recorderRef = useRef<MediaRecorder>();
  const streamRef = useRef<MediaStream>();
  const startedAtRef = useRef<number>();
  const timerRef = useRef<number>();
  const chunkRef = useRef<Blob[]>([]);
  const discardOnStopRef = useRef(false);
  const closeOnStopRef = useRef(false);
  const sendOnStopRef = useRef(false);
  const elapsedAtStopRef = useRef(0);
  const autoStartTriggeredRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current !== undefined) {
      window.clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
  };

  const stopStream = () => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = undefined;
  };

  const revokeDraftUrl = (value?: VoiceRecordingDraft) => {
    if (value?.previewUrl) {
      URL.revokeObjectURL(value.previewUrl);
    }
  };

  const clearDraft = () => {
    setDraft((prev) => {
      revokeDraftUrl(prev);
      return undefined;
    });
  };

  const resetRecorderState = () => {
    clearTimer();
    stopStream();
    recorderRef.current = undefined;
    chunkRef.current = [];
    discardOnStopRef.current = false;
    closeOnStopRef.current = false;
    sendOnStopRef.current = false;
    startedAtRef.current = undefined;
    elapsedAtStopRef.current = 0;
    setElapsedMs(0);
    setPhase('idle');
    setSaving(false);
  };

  const closeComposer = () => {
    if (saving) return;

    if (phase === 'processing') {
      closeOnStopRef.current = true;
      discardOnStopRef.current = true;
      return;
    }

    if (recorderRef.current?.state === 'recording') {
      closeOnStopRef.current = true;
      discardOnStopRef.current = true;
      setPhase('processing');
      recorderRef.current.stop();
      clearTimer();
      stopStream();
      return;
    }

    clearDraft();
    resetRecorderState();
    onClose();
  };

  const stopRecording = () => {
    if (recorderRef.current?.state !== 'recording') return;

    elapsedAtStopRef.current = elapsedMs;
    setPhase('processing');
    recorderRef.current.stop();
    clearTimer();
  };

  const stopAndSend = () => {
    if (recorderRef.current?.state !== 'recording' || !onSendRecording) return;

    elapsedAtStopRef.current = elapsedMs;
    sendOnStopRef.current = true;
    setPhase('processing');
    recorderRef.current.stop();
    clearTimer();
  };

  const startRecording = async () => {
    if (!active || phase === 'requesting' || phase === 'recording' || phase === 'processing')
      return;

    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setErrorDialogMessage('Voice recording is not supported in this browser.');
      onClose();
      return;
    }
    if (!window.isSecureContext) {
      setErrorDialogMessage(
        'Voice recording requires HTTPS on iPhone Safari/Brave (or localhost). Open MindRoom over HTTPS.'
      );
      onClose();
      return;
    }

    pauseAllMediaElements();
    clearDraft();
    setElapsedMs(0);
    setPhase('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = getSupportedRecorderMimeType();
      const recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);

      streamRef.current = stream;
      recorderRef.current = recorder;
      chunkRef.current = [];
      discardOnStopRef.current = false;
      closeOnStopRef.current = false;
      sendOnStopRef.current = false;
      elapsedAtStopRef.current = 0;

      recorder.addEventListener('dataavailable', (event) => {
        if (event.data.size > 0) {
          chunkRef.current.push(event.data);
        }
      });

      recorder.addEventListener('stop', () => {
        clearTimer();
        stopStream();

        const shouldDiscard = discardOnStopRef.current;
        const shouldClose = closeOnStopRef.current;
        const shouldSend = sendOnStopRef.current;
        discardOnStopRef.current = false;
        closeOnStopRef.current = false;
        sendOnStopRef.current = false;

        if (shouldDiscard) {
          chunkRef.current = [];
          setPhase('idle');
          setElapsedMs(0);
          if (shouldClose) {
            onClose();
          }
          return;
        }

        if (chunkRef.current.length === 0) {
          setPhase('idle');
          setErrorDialogMessage('No audio data was captured.');
          onClose();
          return;
        }

        const chunkMimeType = chunkRef.current.find((chunk) => chunk.type)?.type;
        const outputMimeType =
          recorder.mimeType || mimeType || chunkMimeType || DEFAULT_VOICE_RECORDER_MIME_TYPE;
        const blob = new Blob(chunkRef.current, { type: outputMimeType });
        const duration = Math.max(1, Math.round(elapsedAtStopRef.current || elapsedMs));
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const file = new File(
          [blob],
          `voice-message-${timestamp}.${getAudioFileExtension(outputMimeType)}`,
          { type: outputMimeType }
        );

        chunkRef.current = [];

        if (shouldSend && onSendRecording) {
          setPhase('idle');
          setSaving(true);
          void (async () => {
            try {
              await onSendRecording(file, duration);
              clearDraft();
              resetRecorderState();
              onClose();
            } catch (err) {
              setSaving(false);
              setErrorDialogMessage(
                err instanceof Error ? err.message : 'Failed to send voice message.'
              );
            }
          })();
          return;
        }

        setPhase('idle');
        setDraft((prev) => {
          revokeDraftUrl(prev);
          return {
            file,
            duration,
            previewUrl: URL.createObjectURL(blob),
          };
        });
      });

      startedAtRef.current = performance.now();
      timerRef.current = window.setInterval(() => {
        if (startedAtRef.current === undefined) return;
        setElapsedMs(Math.max(0, Math.round(performance.now() - startedAtRef.current)));
      }, 200);

      recorder.start();
      setPhase('recording');
    } catch (err) {
      stopStream();
      recorderRef.current = undefined;
      chunkRef.current = [];
      setPhase('idle');
      setErrorDialogMessage(getVoiceRecorderErrorMessage(err));
      onClose();
    }
  };

  const saveRecording = async () => {
    if (!draft || saving) return;

    setSaving(true);
    try {
      await onSaveRecording(draft.file, draft.duration);
      clearDraft();
      resetRecorderState();
      onClose();
    } catch (err) {
      setSaving(false);
      setErrorDialogMessage(err instanceof Error ? err.message : 'Failed to add voice message.');
    }
  };

  const discardDraftAndClose = () => {
    if (saving) return;
    clearDraft();
    resetRecorderState();
    onClose();
  };

  const recordAgain = () => {
    if (saving) return;
    clearDraft();
    resetRecorderState();
    autoStartTriggeredRef.current = true;
    void startRecording();
  };

  useEffect(() => {
    if (!active) {
      autoStartTriggeredRef.current = false;
      clearDraft();
      resetRecorderState();
      return;
    }

    if (draft || saving) return;
    if (phase !== 'idle') return;
    if (autoStartTriggeredRef.current) return;

    autoStartTriggeredRef.current = true;
    void startRecording();
  }, [active, draft, phase, saving]);

  useEffect(
    () => () => {
      clearDraft();
      resetRecorderState();
    },
    []
  );

  if (!active && !errorDialogMessage) {
    return null;
  }

  return (
    <>
      <Overlay open={!!errorDialogMessage} backdrop={<OverlayBackdrop />}>
        <OverlayCenter>
          <Dialog variant="Surface">
            <Box direction="Column" gap="300" style={{ padding: config.space.S400, maxWidth: 360 }}>
              <Text size="H5">Voice Recording Error</Text>
              <Text size="T300">{errorDialogMessage}</Text>
              <Box justifyContent="End" gap="200">
                <Button variant="Primary" onClick={() => setErrorDialogMessage(undefined)}>
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
          <Box
            direction="Column"
            gap="200"
            style={{ padding: `${config.space.S200} ${config.space.S300}` }}
          >
            <Box alignItems="Center" justifyContent="SpaceBetween" gap="200">
              <Box alignItems="Center" gap="200">
                <Chip
                  variant={phase === 'recording' ? 'Critical' : 'SurfaceVariant'}
                  radii="Pill"
                  disabled={phase !== 'recording'}
                  before={
                    phase === 'requesting' || phase === 'processing' ? (
                      <Spinner size="50" variant="Secondary" />
                    ) : (
                      <Icon src={Icons.Mic} size="50" />
                    )
                  }
                  onClick={stopRecording}
                >
                  <Text size="B300">
                    {phase === 'recording'
                      ? 'Stop'
                      : phase === 'processing'
                      ? 'Processing...'
                      : 'Starting...'}
                  </Text>
                </Chip>
                {phase === 'recording' && onSendRecording && (
                  <Chip
                    variant="Primary"
                    radii="Pill"
                    before={<Icon src={Icons.Send} size="50" />}
                    onClick={stopAndSend}
                  >
                    <Text size="B300">Send</Text>
                  </Chip>
                )}
                <Text size="B300">{formatElapsed(elapsedMs)}</Text>
              </Box>
              <IconButton
                onClick={closeComposer}
                variant="SurfaceVariant"
                size="300"
                radii="300"
                disabled={saving}
                aria-label="Cancel voice recording"
              >
                <Icon src={Icons.Cross} size="50" />
              </IconButton>
            </Box>

            {phase === 'recording' && (
              <Text size="T200" priority="300">
                Recording... tap stop when you are done.
              </Text>
            )}

            {draft && (
              <Box direction="Column" gap="200">
                <Text size="T200" priority="300">
                  Preview ({formatElapsed(draft.duration)})
                </Text>
                {/* Preview-only voice clips do not have captions. */}
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <audio controls src={draft.previewUrl} style={{ width: '100%' }} />
                <Box alignItems="Center" gap="200" wrap="Wrap">
                  <Chip
                    variant="Primary"
                    radii="Pill"
                    onClick={saveRecording}
                    disabled={saving}
                    before={
                      saving ? <Spinner size="50" variant="Primary" fill="Solid" /> : undefined
                    }
                  >
                    <Text size="B300">{saving ? 'Adding...' : 'Add to uploads'}</Text>
                  </Chip>
                  <Chip
                    variant="SurfaceVariant"
                    radii="Pill"
                    onClick={recordAgain}
                    disabled={saving}
                  >
                    <Text size="B300">Record again</Text>
                  </Chip>
                  <Chip
                    variant="SurfaceVariant"
                    radii="Pill"
                    onClick={discardDraftAndClose}
                    disabled={saving}
                  >
                    <Text size="B300">Discard</Text>
                  </Chip>
                </Box>
              </Box>
            )}
          </Box>
        </div>
      )}
    </>
  );
}
