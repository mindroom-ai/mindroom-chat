import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { MatrixError, Room } from 'matrix-js-sdk';
import { Capacitor } from '@capacitor/core';
import { createStore, Provider } from 'jotai';
import { readFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  normalizeMatrixWaveform,
  timeDomainDataToWaveformPoint,
  VOICE_WAVEFORM_BAR_COUNT,
} from '../../utils/audioWaveform';
import { getVoiceRecorderErrorMessage, useVoiceRecorder } from './useVoiceRecorder';
import {
  pendingVoiceSendDraftAtom,
  type PendingVoiceSendContext,
  type PendingVoiceSendDraft,
} from '../../state/room/roomInputDrafts';

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
    getPlatform: vi.fn(),
  },
}));

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

const ROOM_ID = '!room:example.org';
const OTHER_ROOM_ID = '!other:example.org';
const TEST_USER_ID = '@me:example.org';

const createTestRoom = (roomId: string, name?: string): Room =>
  ({
    roomId,
    name: name ?? roomId,
  } as unknown as Room);

const createTestSendContext = (
  roomId: string = ROOM_ID,
  threadId?: string
): PendingVoiceSendContext => ({
  ownerSessionId: TEST_USER_ID,
  roomId,
  room: createTestRoom(roomId),
  threadId,
  replyDraft: undefined,
  threadingEnabled: true,
  signalBridgedRoom: false,
});

type HarnessProps = {
  onRecordingStart?: () => void;
  onSendStopRequest?: () => boolean | void;
  onSendStopFailure?: () => void;
  onSendRecording?: (
    file: File,
    duration: number,
    waveform: number[] | undefined,
    context: PendingVoiceSendContext
  ) => Promise<void> | void;
  getSendContext?: () => PendingVoiceSendContext;
};

const recorderState = {
  current: undefined as ReturnType<typeof useVoiceRecorder> | undefined,
};

function Harness({
  onRecordingStart,
  onSendStopRequest,
  onSendStopFailure,
  onSendRecording,
  getSendContext,
}: HarnessProps) {
  recorderState.current = useVoiceRecorder({
    onRecordingStart,
    onSendStopRequest,
    onSendStopFailure,
    onSendRecording,
    getSendContext: getSendContext ?? (() => createTestSendContext()),
  });
  return null;
}

const renderHarness = async (
  props: HarnessProps = {},
  store: ReturnType<typeof createStore> = createStore()
) => {
  let renderer!: ReactTestRenderer;
  await act(async () => {
    renderer = create(
      React.createElement(Provider, { store }, React.createElement(Harness, props))
    );
  });
  return { renderer, store };
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
    vi.mocked(Capacitor.isNativePlatform).mockReset();
    vi.mocked(Capacitor.getPlatform).mockReset();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');

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

  it('starts mic capture and emits file, active duration, waveform, and captured context on send', async () => {
    const onRecordingStart = vi.fn();
    const onSendRecording = vi.fn();
    const getSendContext = vi.fn(() => createTestSendContext(ROOM_ID, '$thread-a'));
    const { renderer } = await renderHarness({
      onRecordingStart,
      onSendRecording,
      getSendContext,
    });

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
    expect(getSendContext).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(onSendRecording).toHaveBeenCalledOnce();
    expect(onSendRecording.mock.calls[0][0]).toBeInstanceOf(File);
    expect(onSendRecording.mock.calls[0][1]).toBe(1200);
    expect(onSendRecording.mock.calls[0][2]).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(onSendRecording.mock.calls[0][3]).toMatchObject({
      roomId: ROOM_ID,
      threadId: '$thread-a',
    });
    expect(stream.track.stop).toHaveBeenCalledOnce();

    renderer.unmount();
  });

  it('accumulates raw live display samples as the recording grows', async () => {
    const { renderer } = await renderHarness();

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
    const { renderer } = await renderHarness();

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
    const { renderer } = await renderHarness({ onSendRecording });

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
    const { renderer } = await renderHarness({ onSendRecording });

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
    const { renderer } = await renderHarness({ onSendRecording });

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
    const { renderer } = await renderHarness({ onSendRecording });

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
    const { renderer } = await renderHarness({ onSendRecording });

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
    const { renderer } = await renderHarness({ onSendStopRequest, onSendRecording });

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
    const { renderer } = await renderHarness({ onSendRecording });

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
    const { renderer, store } = await renderHarness({ onSendRecording: initialSend });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      renderer.update(
        React.createElement(
          Provider,
          { store },
          React.createElement(Harness, { onSendRecording: laterSend })
        )
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    expect(initialSend).toHaveBeenCalledOnce();
    expect(laterSend).not.toHaveBeenCalled();

    renderer.unmount();
  });

  it('shows a friendly transient message when voice send rejects with an unknown MatrixError', async () => {
    const onSendRecording = vi.fn(async () => {
      throw new MatrixError({ errcode: 'M_UNKNOWN', error: '' });
    });
    const { renderer } = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    expect(recorderState.current?.errorMessage).toBe(
      "Couldn't send — your connection dropped. Try again."
    );
    expect(recorderState.current?.errorMessage).not.toBe('MatrixError: Unknown message');

    renderer.unmount();
  });

  it('retains a failed recording draft and retries the same File, duration, and waveform', async () => {
    const uploadError = new MatrixError({ errcode: 'M_UNKNOWN', error: '' });
    const onSendRecording = vi
      .fn()
      .mockRejectedValueOnce(uploadError)
      .mockResolvedValueOnce(undefined);
    const { renderer } = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(60 * 80);
      await recorderState.current?.send();
    });

    const firstFile = onSendRecording.mock.calls[0][0];
    const firstDuration = onSendRecording.mock.calls[0][1];
    const firstWaveform = onSendRecording.mock.calls[0][2];
    const firstContext = onSendRecording.mock.calls[0][3];
    expect(recorderState.current?.hasPendingSend).toBe(true);
    expect(recorderState.current?.pendingDuration).toBe(firstDuration);
    expect(recorderState.current?.pendingWaveform).toEqual(firstWaveform);

    await act(async () => {
      await recorderState.current?.retry();
    });

    expect(onSendRecording).toHaveBeenCalledTimes(2);
    expect(onSendRecording.mock.calls[1][0]).toBe(firstFile);
    expect(onSendRecording.mock.calls[1][1]).toBe(firstDuration);
    expect(onSendRecording.mock.calls[1][2]).toBe(firstWaveform);
    // The retry must reuse the originally-captured context so the message
    // lands in the room where it was recorded, not the room currently shown.
    expect(onSendRecording.mock.calls[1][3]).toEqual(firstContext);
    expect(recorderState.current?.hasPendingSend).toBe(false);
    expect(recorderState.current?.phase).toBe('idle');

    renderer.unmount();
  });

  it('retries against the originally-captured room even after the parent reports a different room', async () => {
    const uploadError = new MatrixError({ errcode: 'M_UNKNOWN', error: '' });
    const onSendRecording = vi
      .fn()
      .mockRejectedValueOnce(uploadError)
      .mockResolvedValueOnce(undefined);
    let currentRoomId = ROOM_ID;
    const getSendContext = () => createTestSendContext(currentRoomId, '$thread-a');
    const { renderer } = await renderHarness({ onSendRecording, getSendContext });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });
    expect(onSendRecording.mock.calls[0][3]).toMatchObject({ roomId: ROOM_ID });

    // Simulate the parent navigating somewhere else without unmounting.
    currentRoomId = OTHER_ROOM_ID;

    await act(async () => {
      await recorderState.current?.retry();
    });
    expect(onSendRecording.mock.calls[1][3]).toMatchObject({ roomId: ROOM_ID });

    renderer.unmount();
  });

  it('uses Android-specific permission help for blocked microphone access in the native app', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');

    expect(getVoiceRecorderErrorMessage(new DOMException('', 'NotAllowedError'))).toBe(
      'Microphone access is blocked. Allow microphone access for MindRoom in Android app settings and try again.'
    );
  });

  it('declares the Android microphone permission for native voice recording', () => {
    const manifestSource = readFileSync(
      new URL('../../../../android/app/src/main/AndroidManifest.xml', import.meta.url),
      'utf8'
    );

    expect(manifestSource).toContain(
      '<uses-permission android:name="android.permission.RECORD_AUDIO" />'
    );
  });

  it('does not start a new capture while a failed recording draft is pending', async () => {
    const onSendRecording = vi.fn().mockRejectedValueOnce(new Error('upload failed'));
    const { renderer } = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    const pendingFile = onSendRecording.mock.calls[0][0];
    getUserMedia.mockClear();

    let started: boolean | undefined;
    await act(async () => {
      started = await recorderState.current?.start();
    });

    expect(started).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();

    await act(async () => {
      await recorderState.current?.retry();
    });

    expect(onSendRecording.mock.calls[1][0]).toBe(pendingFile);

    renderer.unmount();
  });

  it('claims retry ownership and releases it when retry sending fails', async () => {
    const onSendStopRequest = vi.fn(() => true);
    const onSendStopFailure = vi.fn();
    const onSendRecording = vi.fn().mockRejectedValue(new Error('upload failed'));
    const { renderer } = await renderHarness({
      onSendStopRequest,
      onSendStopFailure,
      onSendRecording,
    });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    expect(onSendStopRequest).toHaveBeenCalledTimes(1);
    expect(onSendStopFailure).toHaveBeenCalledTimes(1);
    expect(recorderState.current?.hasPendingSend).toBe(true);

    await act(async () => {
      await recorderState.current?.retry();
    });

    expect(onSendStopRequest).toHaveBeenCalledTimes(2);
    expect(onSendRecording).toHaveBeenCalledTimes(2);
    expect(onSendStopFailure).toHaveBeenCalledTimes(2);
    expect(recorderState.current?.hasPendingSend).toBe(true);
    expect(recorderState.current?.errorMessage).toBe('upload failed');

    renderer.unmount();
  });

  it('drops a same-tick second retry instead of double-submitting the draft', async () => {
    const onSendRecording = vi
      .fn()
      .mockRejectedValueOnce(new Error('upload failed once'))
      .mockRejectedValueOnce(new Error('upload failed twice'));
    const { renderer } = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    expect(onSendRecording).toHaveBeenCalledTimes(1);
    expect(recorderState.current?.hasPendingSend).toBe(true);

    let firstResult: boolean | undefined;
    let secondResult: boolean | undefined;
    await act(async () => {
      const firstPromise = recorderState.current!.retry();
      const secondPromise = recorderState.current!.retry();
      [firstResult, secondResult] = await Promise.all([firstPromise, secondPromise]);
    });

    // Without the synchronous retryInFlight guard, the second same-tick call
    // would also pass the React-state phase check and invoke sendRecording a
    // third time. Both calls must report failure but the send must fire once.
    expect(onSendRecording).toHaveBeenCalledTimes(2);
    expect(firstResult).toBe(false);
    expect(secondResult).toBe(false);

    renderer.unmount();
  });

  it('persists the failed-send draft (with context) to the global atom across remounts', async () => {
    const store = createStore();
    const onSendRecording = vi.fn().mockRejectedValueOnce(new Error('upload failed'));
    const getSendContext = () => createTestSendContext(ROOM_ID, '$thread-a');
    const { renderer: firstRenderer } = await renderHarness(
      { onSendRecording, getSendContext },
      store
    );

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    expect(recorderState.current?.hasPendingSend).toBe(true);
    const persisted = store.get(pendingVoiceSendDraftAtom);
    expect(persisted?.errorMessage).toBe('upload failed');
    expect(persisted?.context.roomId).toBe(ROOM_ID);
    expect(persisted?.context.threadId).toBe('$thread-a');

    firstRenderer.unmount();

    // The global atom must outlive the unmount (no reset() write to undefined).
    const afterUnmount = store.get(pendingVoiceSendDraftAtom);
    expect(afterUnmount?.errorMessage).toBe('upload failed');
    expect(afterUnmount?.context.roomId).toBe(ROOM_ID);

    const { renderer: secondRenderer } = await renderHarness(
      { onSendRecording, getSendContext },
      store
    );
    expect(recorderState.current?.hasPendingSend).toBe(true);
    expect(recorderState.current?.errorMessage).toBe('upload failed');

    secondRenderer.unmount();
  });

  it('does not resurrect a discarded draft when an in-flight retry fails (production discard path)', async () => {
    // rev-H Issue 1 / Issue 7: if the user discards mid-retry, the catch path
    // must not write the failure-state draft back over the discard. This
    // exercises the production discard path (discardPending → atom set), and
    // would FAIL if the catch read pendingDraftRef (post-commit synced) instead
    // of the live atom: the ref still holds the optimistic-cleared draft when
    // the await resumes inside the same microtask.
    const onSendStopFailure = vi.fn();
    const store = createStore();
    const onSendRecording = vi.fn(async () => {
      // Discard mid-retry via the production hook entry point.
      recorderState.current?.discardPending();
      throw new Error('upload failed twice');
    });
    onSendRecording.mockImplementationOnce(async () => {
      throw new Error('upload failed once');
    });
    const { renderer } = await renderHarness({ onSendRecording, onSendStopFailure }, store);

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    expect(store.get(pendingVoiceSendDraftAtom)).toBeDefined();

    let result: boolean | undefined;
    await act(async () => {
      result = await recorderState.current?.retry();
    });

    expect(result).toBe(false);
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    // onSendStopFailure must not fire when the discard already happened.
    expect(onSendStopFailure).toHaveBeenCalledTimes(1); // only the original send

    renderer.unmount();
  });

  it('also defends discard-mid-retry when discard happens via a direct atom write (forward-looking guarantee)', async () => {
    // rev-H Issue 1: the catch must read the live atom (store.get), not the
    // useEffect-synced pendingDraftRef. A future global discard surface that
    // writes the atom directly must be honored.
    const onSendStopFailure = vi.fn();
    const store = createStore();
    const onSendRecording = vi.fn(async () => {
      store.set(pendingVoiceSendDraftAtom, undefined);
      throw new Error('upload failed twice');
    });
    onSendRecording.mockImplementationOnce(async () => {
      throw new Error('upload failed once');
    });
    const { renderer } = await renderHarness({ onSendRecording, onSendStopFailure }, store);

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    let result: boolean | undefined;
    await act(async () => {
      result = await recorderState.current?.retry();
    });

    expect(result).toBe(false);
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    expect(onSendStopFailure).toHaveBeenCalledTimes(1);

    renderer.unmount();
  });

  it('cancels an in-flight getUserMedia after unmount so no recorder/timers start', async () => {
    // CLUSTER 2 (rev-C Issue 1, rev-E Issue 1): without a sessionIdRef bump
    // on unmount, a permission prompt resolved after unmount would pass the
    // post-await session check, build a MediaRecorder, start capture/timers,
    // and leak the mic stream. The unmount cleanup must invalidate the
    // session id even though the parked draft must outlive the unmount.
    const onSendRecording = vi.fn();
    let resolveGetUserMedia!: (stream: MockMediaStream) => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<MockMediaStream>((resolve) => {
          resolveGetUserMedia = resolve;
        })
    );
    const { renderer } = await renderHarness({ onSendRecording });

    let startPromise!: Promise<unknown>;
    await act(async () => {
      startPromise = recorderState.current!.start();
      await Promise.resolve();
    });

    // Unmount BEFORE getUserMedia resolves (simulates the user navigating
    // away while the OS permission dialog is still open).
    act(() => {
      renderer.unmount();
    });

    // The permission prompt now resolves with a real stream.
    const lateStream = new MockMediaStream();
    await act(async () => {
      resolveGetUserMedia(lateStream);
      await startPromise;
    });

    // The post-await session check must reject the resolved stream and stop
    // its tracks. No MediaRecorder may have been constructed.
    expect(lateStream.track.stop).toHaveBeenCalledOnce();
    expect(MockMediaRecorder.instances).toHaveLength(0);
    expect(onSendRecording).not.toHaveBeenCalled();
  });

  it('persists the failed-send draft to the global atom even when no atom is forwarded by the caller', async () => {
    // Positive control for the wiring fix: the hook owns the global atom
    // directly. Even without any caller-provided atom prop, a failed send
    // must still land in pendingVoiceSendDraftAtom.
    const store = createStore();
    const onSendRecording = vi.fn().mockRejectedValueOnce(new Error('upload failed'));
    const { renderer } = await renderHarness({ onSendRecording }, store);

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    const persisted = store.get(pendingVoiceSendDraftAtom);
    expect(persisted).toBeDefined();
    expect(persisted?.errorMessage).toBe('upload failed');
    expect(persisted?.context.roomId).toBe(ROOM_ID);

    renderer.unmount();
    expect(store.get(pendingVoiceSendDraftAtom)?.errorMessage).toBe('upload failed');
  });

  it('surfaces a busy message when retry is blocked by onSendStopRequest', async () => {
    const onSendStopRequest = vi
      .fn<[], boolean | void>()
      .mockReturnValueOnce(true)
      .mockReturnValueOnce(false);
    const onSendRecording = vi.fn().mockRejectedValueOnce(new Error('upload failed'));
    const { renderer } = await renderHarness({ onSendStopRequest, onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    expect(recorderState.current?.errorMessage).toBe('upload failed');

    let result: boolean | undefined;
    await act(async () => {
      result = await recorderState.current?.retry();
    });

    expect(result).toBe(false);
    expect(onSendRecording).toHaveBeenCalledTimes(1);
    expect(recorderState.current?.hasPendingSend).toBe(true);
    expect(recorderState.current?.errorMessage).toBe(
      'Another voice message is still sending. Please wait.'
    );

    renderer.unmount();
  });

  it('preserves plain voice send Error messages', async () => {
    const busyMessage =
      'Another voice message is still sending. Please wait before recording again.';
    const onSendRecording = vi.fn(async () => {
      throw new Error(busyMessage);
    });
    const { renderer } = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    expect(recorderState.current?.errorMessage).toBe(busyMessage);
    expect(recorderState.current?.errorMessage).not.toBe("Couldn't send. Try again.");

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
    const { renderer } = await renderHarness({ onSendRecording });

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
    const { renderer } = await renderHarness({ onSendRecording });

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

  it('does not retain a pending send draft when no audio chunks were captured', async () => {
    MockMediaRecorder.autoStop = false;
    const onSendRecording = vi.fn();
    const onSendStopFailure = vi.fn();
    const { renderer } = await renderHarness({ onSendRecording, onSendStopFailure });

    await act(async () => {
      await recorderState.current?.start();
    });

    const recorder = MockMediaRecorder.instances[0];
    let sendPromise!: Promise<boolean>;
    await act(async () => {
      vi.advanceTimersByTime(100);
      sendPromise = recorderState.current!.send();
    });
    await act(async () => {
      recorder.dispatch('stop', new Event('stop'));
      await sendPromise;
    });

    expect(onSendRecording).not.toHaveBeenCalled();
    expect(onSendStopFailure).toHaveBeenCalledOnce();
    expect(recorderState.current?.errorMessage).toBe('No audio data was captured.');
    expect(recorderState.current?.hasPendingSend).toBe(false);

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
    const { renderer } = await renderHarness({ onSendRecording });

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

  it('persists an inFlight token while a retry is awaiting and surfaces sending state on a remounted hook', async () => {
    // R5 FIX 1 (rev-D Issue 1): if the user starts a retry, navigates away
    // (keyed remount), and a fresh hook mounts before the request settles,
    // the new hook MUST see the in-flight signal so the capsule's Discard /
    // Send buttons stay disabled — otherwise the user could discard a draft
    // whose matrix message is still uploading and the message would land
    // after the explicit discard.
    const store = createStore();
    let resolveRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
      resolveRetry = resolve;
    });
    const onSendRecording = vi
      .fn()
      .mockRejectedValueOnce(new Error('initial failure'))
      .mockImplementationOnce(async () => {
        await retryGate;
        // Resolve as success.
      });

    const { renderer: firstRenderer } = await renderHarness({ onSendRecording }, store);

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    expect(store.get(pendingVoiceSendDraftAtom)?.errorMessage).toBe('initial failure');
    expect(store.get(pendingVoiceSendDraftAtom)?.inFlight).toBeUndefined();

    // Initiate retry — DO NOT await the promise, the test gate keeps it
    // pending while we tear down the first hook.
    let retryPromise!: Promise<boolean | undefined>;
    await act(async () => {
      retryPromise = Promise.resolve(recorderState.current?.retry());
      await Promise.resolve();
    });

    const inFlightAfterStart = store.get(pendingVoiceSendDraftAtom)?.inFlight;
    expect(inFlightAfterStart).toBeDefined();
    expect(typeof inFlightAfterStart?.token).toBe('string');

    // Tear down the first mount mid-retry; the inFlight token must survive.
    firstRenderer.unmount();
    expect(store.get(pendingVoiceSendDraftAtom)?.inFlight?.token).toBe(inFlightAfterStart?.token);

    // Fresh hook mounts. It must initialize phase to 'sending' from the
    // atom — the test asserts the user-visible promise: a remounted capsule
    // would render with phase='sending' and Discard disabled.
    const { renderer: secondRenderer } = await renderHarness({ onSendRecording }, store);
    expect(recorderState.current?.phase).toBe('sending');

    // Resolve the original retry. The atom's draft (with token) should be
    // cleared. The remounted hook's phase syncs back to idle.
    await act(async () => {
      resolveRetry();
      await retryPromise;
    });
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    expect(recorderState.current?.phase).toBe('idle');

    secondRenderer.unmount();
  });

  it('refuses a fresh retry while the atom already carries an inFlight token', async () => {
    // R5 FIX 1 defense-in-depth: even if some path bypasses the UI gate,
    // retry() must check the atom and bail when another retry is racing.
    const store = createStore();
    let resolveFirstRetry!: () => void;
    const firstRetryGate = new Promise<void>((resolve) => {
      resolveFirstRetry = resolve;
    });
    const onSendRecording = vi
      .fn()
      .mockRejectedValueOnce(new Error('initial failure'))
      .mockImplementationOnce(async () => {
        await firstRetryGate;
      });

    const { renderer } = await renderHarness({ onSendRecording }, store);

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    let firstRetryPromise!: Promise<boolean | undefined>;
    await act(async () => {
      firstRetryPromise = Promise.resolve(recorderState.current?.retry());
      await Promise.resolve();
    });
    expect(store.get(pendingVoiceSendDraftAtom)?.inFlight).toBeDefined();

    // A second concurrent retry attempt must be refused.
    let secondResult: boolean | undefined;
    await act(async () => {
      secondResult = await recorderState.current?.retry();
    });
    expect(secondResult).toBe(false);
    expect(onSendRecording).toHaveBeenCalledTimes(2); // initial + first retry only

    // Let the first retry finish so the test cleans up.
    await act(async () => {
      resolveFirstRetry();
      await firstRetryPromise;
    });

    renderer.unmount();
  });

  it('does not clobber a different draft when a stale retry resolves successfully', async () => {
    // R6 EXTREME-CONVERGENCE MAJOR (5/8 reviewers): the retry success path
    // token-checks the live atom before clearing, but R5's wiring then
    // called reset(), and reset() unconditionally wrote
    // pendingVoiceSendDraftAtom = undefined — defeating the token guard.
    // A stale successful retry could erase a newer parked draft from
    // another session/recording. The fix splits reset() into a
    // local-only resetLocalRecorderState() so the stale tail leaves the
    // atom alone whenever the token check declines ownership.
    const store = createStore();
    let resolveStaleRetry!: () => void;
    const staleRetryGate = new Promise<void>((resolve) => {
      resolveStaleRetry = resolve;
    });
    const onSendRecording = vi
      .fn()
      .mockRejectedValueOnce(new Error('initial failure'))
      .mockImplementationOnce(async () => {
        await staleRetryGate;
        // The stale retry resolves SUCCESSFULLY. Without the fix, this
        // is the path that erases the unrelated newer draft below.
      });

    const { renderer } = await renderHarness({ onSendRecording }, store);

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    // Kick off the retry; do NOT await (the gate keeps it pending).
    let stalePromise!: Promise<boolean | undefined>;
    await act(async () => {
      stalePromise = Promise.resolve(recorderState.current?.retry());
      await Promise.resolve();
    });

    // Simulate a different operation replacing the atom value with a new
    // draft (e.g. account-switch cleanup released the old atom and a new
    // failed recording parked a fresh draft). Different file, no inFlight,
    // different (or absent) token.
    const replacementDraft: PendingVoiceSendDraft = {
      file: new File(['replacement-audio'], 'new.m4a', { type: 'audio/mp4' }),
      duration: 700,
      errorMessage: 'replacement upload failed',
      context: createTestSendContext(OTHER_ROOM_ID),
    };
    await act(async () => {
      store.set(pendingVoiceSendDraftAtom, replacementDraft);
    });

    // Now the stale retry resolves successfully. The token guard must
    // decline ownership AND the local cleanup must NOT touch the atom.
    await act(async () => {
      resolveStaleRetry();
      await stalePromise;
    });

    // Replacement draft must still be intact.
    expect(store.get(pendingVoiceSendDraftAtom)).toBe(replacementDraft);

    renderer.unmount();
  });
});
