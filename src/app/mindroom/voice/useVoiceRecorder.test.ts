import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeMatrixWaveform,
  timeDomainDataToWaveformPoint,
  VOICE_WAVEFORM_BAR_COUNT,
} from '../../utils/audioWaveform';
import { useVoiceRecorder } from './useVoiceRecorder';

type Listener = (event: Event) => void;

class MockMediaStreamTrack {
  stop = vi.fn();
}

class MockMediaStream {
  track = new MockMediaStreamTrack();

  getTracks() {
    return [this.track];
  }
}

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];

  static isTypeSupported = vi.fn(() => true);

  static autoStop = true;

  state: RecordingState = 'inactive';

  mimeType: string;

  pause = vi.fn(() => {
    this.state = 'paused';
  });

  resume = vi.fn(() => {
    this.state = 'recording';
  });

  private listeners = new Map<string, Set<Listener>>();

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? 'audio/ogg;codecs=opus';
    MockMediaRecorder.instances.push(this);
  }

  addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    if (!listener) return;
    const fn =
      typeof listener === 'function' ? listener : (event: Event) => listener.handleEvent(event);
    const current = this.listeners.get(type) ?? new Set<Listener>();
    current.add(fn);
    this.listeners.set(type, current);
  }

  start() {
    this.state = 'recording';
  }

  stop = vi.fn(() => {
    this.state = 'inactive';
    if (MockMediaRecorder.autoStop) {
      this.flushStop();
    }
  });

  flushStop() {
    this.dispatch('dataavailable', {
      data: new Blob(['voice'], { type: this.mimeType }),
    } as BlobEvent);
    this.dispatch('stop', new Event('stop'));
  }

  dispatch(type: string, event: Event) {
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

class MockAnalyser {
  static sampleIndex = 0;

  fftSize = 4;

  getByteTimeDomainData(data: Uint8Array) {
    MockAnalyser.sampleIndex += 1;
    data.fill(128 + MockAnalyser.sampleIndex);
  }
}

class MockAudioContext {
  state: AudioContextState = 'running';

  analyser = new MockAnalyser();

  createMediaStreamSource = vi.fn(() => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }));

  createAnalyser = vi.fn(() => this.analyser);

  resume = vi.fn(() => Promise.resolve());

  close = vi.fn(() => Promise.resolve());
}

type HarnessProps = {
  onRecordingStart?: () => void;
  onSendStopRequest?: () => boolean | void;
  onSendStopFailure?: () => void;
  onSendRecording?: (file: File, duration: number, waveform?: number[]) => Promise<void> | void;
};

const recorderState = {
  current: undefined as ReturnType<typeof useVoiceRecorder> | undefined,
};

function Harness(props: HarnessProps) {
  recorderState.current = useVoiceRecorder(props);
  return null;
}

const renderHarness = async (props: HarnessProps = {}) => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(React.createElement(Harness, props));
  });
  return renderer;
};

const secureWindow = {
  isSecureContext: true,
  AudioContext: MockAudioContext,
};

const expectedAnalyserSample = (index: number): number =>
  timeDomainDataToWaveformPoint(new Uint8Array(2048).fill(128 + index));

const expectedAnalyserSamples = (start: number, end: number): number[] =>
  Array.from({ length: end - start + 1 }, (_value, index) => expectedAnalyserSample(start + index));

describe('useVoiceRecorder', () => {
  let stream: MockMediaStream;
  let getUserMedia: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    stream = new MockMediaStream();
    getUserMedia = vi.fn(async () => stream);
    MockMediaRecorder.instances = [];
    MockMediaRecorder.autoStop = true;
    MockMediaRecorder.isTypeSupported.mockReturnValue(true);
    MockAnalyser.sampleIndex = 0;

    vi.stubGlobal('window', secureWindow);
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia,
      },
    });
    vi.stubGlobal('MediaRecorder', MockMediaRecorder);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    recorderState.current = undefined;
  });

  it('starts mic capture and emits file, active duration, and waveform on send', async () => {
    const onRecordingStart = vi.fn();
    const onSendRecording = vi.fn();
    const renderer = await renderHarness({ onRecordingStart, onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    await act(async () => {
      await recorderState.current?.send();
    });

    expect(onRecordingStart).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(onSendRecording).toHaveBeenCalledOnce();
    expect(onSendRecording.mock.calls[0][0]).toBeInstanceOf(File);
    expect(onSendRecording.mock.calls[0][1]).toBe(1200);
    expect(onSendRecording.mock.calls[0][2]).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(stream.track.stop).toHaveBeenCalledOnce();

    renderer.unmount();
  });

  it('accumulates raw live display samples as the recording grows', async () => {
    const renderer = await renderHarness();

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(3 * 80);
    });

    const waveform = recorderState.current?.waveform;
    expect(waveform).toEqual(expectedAnalyserSamples(1, 4));

    renderer.unmount();
  });

  it('appends one live display sample per waveform tick', async () => {
    const renderer = await renderHarness();

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(60 * 80);
    });

    const previousWaveform = recorderState.current?.waveform ?? [];
    expect(previousWaveform).toEqual(expectedAnalyserSamples(1, 61));

    await act(async () => {
      vi.advanceTimersByTime(80);
    });

    const nextWaveform = recorderState.current?.waveform ?? [];
    expect(nextWaveform).toEqual(expectedAnalyserSamples(1, 62));
    expect(nextWaveform.slice(0, -1)).toEqual(previousWaveform);
    expect(nextWaveform.at(-1)).toBe(expectedAnalyserSample(62));

    renderer.unmount();
  });

  it('sends a normalized Matrix waveform from full metadata samples', async () => {
    const onSendRecording = vi.fn();
    const renderer = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(60 * 80);
    });
    await act(async () => {
      await recorderState.current?.send();
    });

    const metadataSamples = expectedAnalyserSamples(1, 61);
    expect(onSendRecording).toHaveBeenCalledOnce();
    expect(onSendRecording.mock.calls[0][2]).toEqual(normalizeMatrixWaveform(metadataSamples));
    expect(onSendRecording.mock.calls[0][2]).not.toEqual(metadataSamples.slice(-48));

    renderer.unmount();
  });

  it('excludes paused time from duration and calls native pause/resume', async () => {
    const onSendRecording = vi.fn();
    const renderer = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    act(() => {
      recorderState.current?.pause();
    });
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    act(() => {
      recorderState.current?.resume();
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    await act(async () => {
      await recorderState.current?.send();
    });

    const recorder = MockMediaRecorder.instances[0];
    expect(recorder.pause).toHaveBeenCalledOnce();
    expect(recorder.resume).toHaveBeenCalledOnce();
    expect(onSendRecording.mock.calls[0][1]).toBe(1500);

    renderer.unmount();
  });

  it('discards without sending and cleans up capture resources', async () => {
    const onSendRecording = vi.fn();
    const renderer = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await recorderState.current?.discard();
    });

    expect(onSendRecording).not.toHaveBeenCalled();
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(recorderState.current?.phase).toBe('idle');

    renderer.unmount();
  });

  it('ignores discard while a send stop is still processing', async () => {
    MockMediaRecorder.autoStop = false;
    const onSendRecording = vi.fn();
    const renderer = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });

    const recorder = MockMediaRecorder.instances[0];
    let sendPromise!: Promise<boolean>;
    await act(async () => {
      vi.advanceTimersByTime(500);
      sendPromise = recorderState.current!.send();
    });
    let discardResult: boolean | undefined;
    await act(async () => {
      discardResult = await recorderState.current?.discard();
    });
    await act(async () => {
      recorder.flushStop();
      await sendPromise;
    });

    expect(discardResult).toBe(false);
    expect(onSendRecording).toHaveBeenCalledOnce();
    expect(onSendRecording.mock.calls[0][1]).toBe(500);

    renderer.unmount();
  });

  it('keeps an explicit send alive if the recorder unmounts before the stop event', async () => {
    MockMediaRecorder.autoStop = false;
    const onSendRecording = vi.fn();
    const renderer = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });

    const recorder = MockMediaRecorder.instances[0];
    let sendPromise!: Promise<boolean>;
    await act(async () => {
      vi.advanceTimersByTime(500);
      sendPromise = recorderState.current!.send();
    });

    act(() => {
      renderer.unmount();
    });
    await act(async () => {
      recorder.flushStop();
      await sendPromise;
    });

    expect(onSendRecording).toHaveBeenCalledOnce();
    expect(onSendRecording.mock.calls[0][1]).toBe(500);
    expect(stream.track.stop).toHaveBeenCalled();
  });

  it('requests send ownership before the delayed recorder stop event builds a voice file', async () => {
    MockMediaRecorder.autoStop = false;
    const onSendStopRequest = vi.fn(() => true);
    const onSendRecording = vi.fn();
    const renderer = await renderHarness({ onSendStopRequest, onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });

    const recorder = MockMediaRecorder.instances[0];
    let sendPromise!: Promise<boolean>;
    await act(async () => {
      vi.advanceTimersByTime(500);
      sendPromise = recorderState.current!.send();
    });

    expect(onSendStopRequest).toHaveBeenCalledOnce();
    expect(onSendRecording).not.toHaveBeenCalled();

    await act(async () => {
      recorder.flushStop();
      await sendPromise;
    });

    expect(onSendRecording).toHaveBeenCalledOnce();
    expect(onSendRecording.mock.calls[0][1]).toBe(500);

    renderer.unmount();
  });

  it('stops an active recorder on unmount cleanup', async () => {
    const onSendRecording = vi.fn();
    const renderer = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });

    const recorder = MockMediaRecorder.instances[0];
    act(() => {
      renderer.unmount();
    });

    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(onSendRecording).not.toHaveBeenCalled();
    expect(stream.track.stop).toHaveBeenCalled();
  });

  it('uses the send callback captured when recording started', async () => {
    const initialSend = vi.fn();
    const laterSend = vi.fn();
    const renderer = await renderHarness({ onSendRecording: initialSend });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      renderer.update(React.createElement(Harness, { onSendRecording: laterSend }));
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    expect(initialSend).toHaveBeenCalledOnce();
    expect(laterSend).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('stops the acquired stream when MediaRecorder construction fails', async () => {
    class ThrowingMediaRecorder {
      static isTypeSupported = vi.fn(() => true);

      constructor() {
        throw new Error('constructor failed');
      }
    }
    vi.stubGlobal('MediaRecorder', ThrowingMediaRecorder);
    const onSendRecording = vi.fn();
    const renderer = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });

    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(onSendRecording).not.toHaveBeenCalled();
    expect(recorderState.current?.errorMessage).toBe('constructor failed');

    renderer.unmount();
  });

  it('does not send when recording stops without an explicit send action', async () => {
    const onSendRecording = vi.fn();
    const renderer = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });

    const recorder = MockMediaRecorder.instances[0];
    await act(async () => {
      recorder.state = 'inactive';
      recorder.flushStop();
      await Promise.resolve();
    });

    expect(onSendRecording).not.toHaveBeenCalled();
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(recorderState.current?.phase).toBe('idle');
    expect(recorderState.current?.errorMessage).toBe(
      'Voice recording stopped unexpectedly. Please record again.'
    );

    renderer.unmount();
  });

  it('keeps recording and sends duration-only metadata when analyser setup fails', async () => {
    vi.stubGlobal('window', {
      isSecureContext: true,
      AudioContext: class {
        constructor() {
          throw new Error('no analyser');
        }
      },
    });
    const onSendRecording = vi.fn();
    const renderer = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(700);
      await recorderState.current?.send();
    });

    expect(onSendRecording).toHaveBeenCalledOnce();
    expect(onSendRecording.mock.calls[0][1]).toBe(700);
    expect(onSendRecording.mock.calls[0][2]).toBeUndefined();

    renderer.unmount();
  });
});
