import {
  DICTATION_WORKLET_FILE,
  getSpeechModelDirectory,
  keepAudioContextRunning,
} from '../../lib/speechModelAssets';
import { timeDomainDataToWaveformPoint } from '../../lib/audioWaveform';
import {
  getVoiceRecorderErrorMessage,
  VOICE_RECORDER_AUDIO_CONSTRAINTS,
} from '../voice/voiceCaptureSession';

const WORKLET_STOP_TIMEOUT_MS = 150;

export class DictationCaptureError extends Error {}

export type DictationCaptureHandle = {
  readLevel?: () => number;
  /** Flushes any buffered worklet tail and stops capture (awaited on Pause and Finish). */
  stopAndFlush: () => Promise<void>;
  /** Tears down capture immediately without waiting (used on Discard and error recovery). */
  dispose: () => void;
};

export type DictationCaptureFactory = (callbacks: {
  onFrame: (frame: Float32Array) => void;
  onTrackEnded: () => void;
}) => Promise<DictationCaptureHandle>;

export type DictationAudioCaptureOptions = {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: () => AudioContext;
  workletUrl?: string;
};

export const describeCaptureError = (error: unknown): string =>
  error instanceof DictationCaptureError ? error.message : getVoiceRecorderErrorMessage(error);

const getAudioContextConstructor = (): typeof AudioContext | undefined => {
  if (typeof window === 'undefined') return undefined;
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  );
};

const safeDisconnect = (node?: AudioNode) => {
  try {
    node?.disconnect();
  } catch {
    // Ignore disconnect errors on torn-down graphs.
  }
};

const requestMicrophone = async (
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>
): Promise<MediaStream> => {
  const acquire =
    getUserMedia ??
    ((constraints: MediaStreamConstraints) => navigator.mediaDevices.getUserMedia(constraints));
  try {
    return await acquire({ audio: VOICE_RECORDER_AUDIO_CONSTRAINTS });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'OverconstrainedError') {
      return acquire({ audio: true });
    }
    throw error;
  }
};

/**
 * Browser microphone + AudioWorklet capture factory. Creates and resumes the AudioContext
 * synchronously inside the caller's user gesture, downsamples to 16 kHz mono frames in
 * `dictationCaptureWorklet.js`, and flushes the final <96 ms tail before teardown on Pause/Finish.
 */
export const createBrowserCaptureFactory =
  (options: DictationAudioCaptureOptions): DictationCaptureFactory =>
  async ({ onFrame, onTrackEnded }) => {
    const makeContext =
      options.createAudioContext ??
      (() => {
        const Ctor = getAudioContextConstructor();
        if (!Ctor) throw new DictationCaptureError('Audio capture is unavailable in this browser.');
        return new Ctor();
      });

    const context = makeContext();
    const stopKeepingRunning = keepAudioContextRunning(context);
    let stream: MediaStream | undefined;
    let sourceNode: MediaStreamAudioSourceNode | undefined;
    let workletNode: AudioWorkletNode | undefined;
    let silentGain: GainNode | undefined;
    let detachTrackEnded: (() => void) | undefined;
    let stoppedResolve: (() => void) | undefined;
    let disposed = false;

    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      stoppedResolve?.();
      stoppedResolve = undefined;
      detachTrackEnded?.();
      stopKeepingRunning();
      if (workletNode) {
        try {
          workletNode.port.onmessage = null;
        } catch {
          // Ignore port errors on torn-down nodes.
        }
      }
      safeDisconnect(workletNode);
      safeDisconnect(silentGain);
      safeDisconnect(sourceNode);
      stream?.getTracks().forEach((track) => track.stop());
      stream = undefined;
      workletNode = undefined;
      void context.close().catch(() => undefined);
    };

    try {
      stream = await requestMicrophone(options.getUserMedia);
      const [audioTrack] = stream.getAudioTracks();
      if (audioTrack) {
        audioTrack.addEventListener('ended', onTrackEnded);
        detachTrackEnded = () => audioTrack.removeEventListener('ended', onTrackEnded);
      }

      sourceNode = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      sourceNode.connect(analyser);
      const timeDomain = new Uint8Array(analyser.fftSize);
      const readLevel = () => {
        analyser.getByteTimeDomainData(timeDomain);
        return timeDomainDataToWaveformPoint(timeDomain);
      };

      silentGain = context.createGain();
      silentGain.gain.value = 0;
      silentGain.connect(context.destination);

      const workletUrl =
        options.workletUrl ?? `${getSpeechModelDirectory()}${DICTATION_WORKLET_FILE}`;
      try {
        if (!('audioWorklet' in context) || typeof AudioWorkletNode !== 'function') {
          throw new Error('AudioWorklet unavailable');
        }
        await context.audioWorklet.addModule(workletUrl);
        const node = new AudioWorkletNode(context, 'dictation-capture-processor', {
          channelCount: 1,
          channelCountMode: 'explicit',
          channelInterpretation: 'speakers',
        });
        node.port.onmessage = (event: MessageEvent<unknown>) => {
          if (disposed) return;
          const data = event.data;
          if (data instanceof Float32Array) onFrame(data);
          else if (data instanceof ArrayBuffer) onFrame(new Float32Array(data));
          else if (
            data &&
            typeof data === 'object' &&
            (data as { type?: unknown }).type === 'stopped'
          ) {
            stoppedResolve?.();
            stoppedResolve = undefined;
          }
        };
        sourceNode.connect(node);
        node.connect(silentGain);
        workletNode = node;
      } catch {
        throw new DictationCaptureError('Could not initialize dictation audio capture.');
      }

      const stopAndFlush = async () => {
        if (disposed) return;
        detachTrackEnded?.();
        detachTrackEnded = undefined;
        if (workletNode) {
          await new Promise<void>((resolve) => {
            const finishWait = () => {
              clearTimeout(timer);
              stoppedResolve = undefined;
              resolve();
            };
            const timer = setTimeout(finishWait, WORKLET_STOP_TIMEOUT_MS);
            stoppedResolve = finishWait;
            try {
              workletNode?.port.postMessage({ type: 'stop' });
            } catch {
              finishWait();
            }
          });
        }
        cleanup();
      };

      const dispose = () => {
        if (disposed) return;
        try {
          workletNode?.port.postMessage({ type: 'stop' });
        } catch {
          // Ignore port errors on torn-down nodes.
        }
        cleanup();
      };

      return { readLevel, stopAndFlush, dispose };
    } catch (error) {
      cleanup();
      throw error;
    }
  };
