import React from 'react';
import { act, create, ReactTestRenderer } from 'react-test-renderer';
import { MatrixError, Room } from 'matrix-js-sdk';
import { Capacitor } from '@capacitor/core';
import { createStore, Provider, useStore } from 'jotai';
import { readFileSync } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import {
  normalizeMatrixWaveform,
  timeDomainDataToWaveformPoint,
  VOICE_WAVEFORM_BAR_COUNT,
} from '../../lib/audioWaveform';
import {
  getVoiceRecorderErrorMessage,
  useVoiceRecorder,
  VOICE_RECORDER_AUDIO_BITS_PER_SECOND,
  VOICE_RECORDER_AUDIO_CONSTRAINTS,
} from './useVoiceRecorder';
import {
  forgetComposerStateOfSession,
  pendingVoiceSendDraftAtom,
  type PendingVoiceSendContext,
  type PendingVoiceSendDraft,
} from '../roomInputDrafts';
import { discardLiveCapture, liveCaptureAtom, liveCaptureErrorAtom } from '../capture/liveCapture';
import { startLiveVoiceRecording } from './startLiveVoiceRecording';
import { VOICE_RECORDER_STOP_TIMEOUT_MS } from './voiceCaptureSession';
import * as journal from '../capture/captureJournal';

const flightRecorderMocks = vi.hoisted(() => ({
  setVoiceCaptureState: vi.fn(),
}));

vi.mock('../../diagnostics/flightRecorder', () => ({
  setFlightRecorderVoiceCaptureState: flightRecorderMocks.setVoiceCaptureState,
}));

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

  options: MediaRecorderOptions;

  pause = vi.fn(() => {
    this.state = 'paused';
  });

  resume = vi.fn(() => {
    this.state = 'recording';
  });

  private listeners = new Map<string, Set<Listener>>();

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.options = { ...(options ?? {}) };
    this.mimeType = this.options.mimeType ?? 'audio/ogg;codecs=opus';
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

  flushStop(audio = 'voice') {
    this.dispatch('dataavailable', {
      data: new Blob([audio], { type: this.mimeType }),
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
  onSendStopRequest?: () => boolean | void;
  onSendStopFailure?: () => void;
  onSendRecording?: (
    file: File,
    duration: number,
    waveform: number[] | undefined,
    context: PendingVoiceSendContext
  ) => Promise<void> | void;
  getSendContext?: () => PendingVoiceSendContext;
  state?: {
    current: HarnessRecorder | undefined;
  };
};

/** A composer's recorder, with the mic button's start beside it. */
type HarnessRecorder = ReturnType<typeof useVoiceRecorder> & { start: () => Promise<boolean> };

const recorderState = {
  current: undefined as HarnessRecorder | undefined,
};
const mountedRenderers = new Set<ReactTestRenderer>();
const stores = new Set<ReturnType<typeof createStore>>();

function Harness({
  onSendStopRequest,
  onSendStopFailure,
  onSendRecording,
  getSendContext,
  state = recorderState,
}: HarnessProps) {
  const store = useStore();
  const recorder = useVoiceRecorder({
    ownsPendingVoiceDraft: true,
    onSendStopRequest,
    onSendStopFailure,
    onSendRecording,
    getSendContext: getSendContext ?? (() => createTestSendContext()),
  });
  // The mic button hands its composer's context over, which names the account for the journal.
  const start = () => startLiveVoiceRecording(store, createTestSendContext());
  state.current = { ...recorder, start };
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
  mountedRenderers.add(renderer);
  stores.add(store);
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
  let getUserMedia: Mock;

  beforeEach(() => {
    vi.useFakeTimers();
    stream = new MockMediaStream();
    getUserMedia = vi.fn(async () => stream);
    MockMediaRecorder.instances = [];
    MockMediaRecorder.autoStop = true;
    MockMediaRecorder.isTypeSupported.mockReturnValue(true);
    MockAnalyser.sampleIndex = 0;
    flightRecorderMocks.setVoiceCaptureState.mockReset();
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

  afterEach(async () => {
    // No unmount ends a recording, so each test's is ended here, and a stop left waiting runs out.
    await act(async () => {
      stores.forEach((store) => void discardLiveCapture(store));
      await vi.advanceTimersByTimeAsync(VOICE_RECORDER_STOP_TIMEOUT_MS);
      mountedRenderers.forEach((renderer) => renderer.unmount());
    });
    mountedRenderers.clear();
    stores.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    recorderState.current = undefined;
  });

  it('releases partial audio resources when connecting the analyser throws', async () => {
    const disconnect = vi.fn();
    const close = vi.fn(async () => undefined);
    vi.stubGlobal('window', {
      isSecureContext: true,
      AudioContext: class {
        state = 'running';

        close = close;

        createMediaStreamSource() {
          return {
            disconnect,
            connect() {
              throw new Error('connect failed');
            },
          };
        }

        createAnalyser() {
          return { fftSize: 4 };
        }
      },
    });
    const send = vi.fn();
    await renderHarness({ onSendRecording: send });
    await act(async () => {
      await recorderState.current!.start();
    });
    expect(disconnect).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    await act(async () => {
      vi.advanceTimersByTime(250);
      await recorderState.current!.send();
    });
    expect(send.mock.calls[0]![1]).toBe(250);
    expect(send.mock.calls[0]![2]).toBeUndefined();
  });

  it('releases mic resources after native stop throws', async () => {
    const failed = vi.fn();
    const { store } = await renderHarness({ onSendStopFailure: failed });
    await act(async () => {
      await recorderState.current!.start();
    });
    MockMediaRecorder.instances[0]!.stop.mockImplementation(() => {
      throw new Error('stop failed');
    });
    await act(async () => {
      expect(await recorderState.current!.send()).toBe(false);
    });
    expect(failed).toHaveBeenCalledOnce();
    expect(store.get(liveCaptureErrorAtom)).toEqual({ kind: 'voice', message: 'stop failed' });
    expect(recorderState.current!.phase).toBe('idle');
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores delayed old data and stop after a discard starts a fresh recording', async () => {
    MockMediaRecorder.autoStop = false;
    const send = vi.fn();
    await renderHarness({ onSendRecording: send });
    await act(async () => {
      await recorderState.current!.start();
    });
    const old = MockMediaRecorder.instances[0]!;
    await act(async () => {
      void recorderState.current!.discard();
    });
    const freshStream = new MockMediaStream();
    getUserMedia.mockResolvedValue(freshStream);
    await act(async () => {
      await recorderState.current!.start();
    });
    await act(async () => {
      old.flushStop();
      vi.advanceTimersByTime(250);
    });
    expect(recorderState.current!.phase).toBe('recording');
    expect(freshStream.track.stop).not.toHaveBeenCalled();
    const fresh = MockMediaRecorder.instances[1]!;
    let result!: Promise<boolean>;
    await act(async () => {
      result = recorderState.current!.send();
    });
    await act(async () => {
      fresh.flushStop();
      await result;
    });
    expect(await send.mock.calls[0]![0].text()).toBe('voice');
    expect(send.mock.calls[0]![1]).toBe(250);
  });

  it('pins the compressed speech capture contract', () => {
    expect(VOICE_RECORDER_AUDIO_BITS_PER_SECOND).toBe(32_000);
    expect(VOICE_RECORDER_AUDIO_CONSTRAINTS).toEqual({
      channelCount: 1,
      sampleRate: 24_000,
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    });
  });

  it('starts mic capture and emits file, active duration, waveform, and effective context on send', async () => {
    const onSendRecording = vi.fn();
    const getSendContext = vi.fn(() => createTestSendContext(ROOM_ID, '$thread-a'));
    const { renderer } = await renderHarness({ onSendRecording, getSendContext });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(1200);
    });
    await act(async () => {
      await recorderState.current?.send();
    });

    // Read once, when Send is pressed.
    expect(getSendContext).toHaveBeenCalledOnce();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: VOICE_RECORDER_AUDIO_CONSTRAINTS,
    });
    expect(MockMediaRecorder.instances[0]!.options).toEqual({
      mimeType: 'audio/ogg;codecs=opus',
      audioBitsPerSecond: VOICE_RECORDER_AUDIO_BITS_PER_SECOND,
    });
    expect(onSendRecording).toHaveBeenCalledOnce();
    expect(onSendRecording.mock.calls[0]![0]).toBeInstanceOf(File);
    expect(onSendRecording.mock.calls[0]![1]).toBe(1200);
    expect(onSendRecording.mock.calls[0]![2]).toHaveLength(VOICE_WAVEFORM_BAR_COUNT);
    expect(onSendRecording.mock.calls[0]![3]).toMatchObject({
      roomId: ROOM_ID,
      threadId: '$thread-a',
    });
    expect(stream.track.stop).toHaveBeenCalledOnce();

    renderer.unmount();
  });

  it('reports every capture phase in order, and inactive after a send or a discard, not an unmount', async () => {
    const onSendRecording = vi.fn();
    const { renderer, store } = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    act(() => {
      recorderState.current?.pause();
    });
    act(() => {
      recorderState.current?.resume();
    });
    await act(async () => {
      await recorderState.current?.send();
    });

    expect(flightRecorderMocks.setVoiceCaptureState.mock.calls.map(([state]) => state)).toEqual([
      'requesting',
      'recording',
      'paused',
      'recording',
      'processing',
      'inactive',
      'inactive',
    ]);

    await act(async () => {
      await recorderState.current?.start();
    });
    act(() => renderer.unmount());
    expect(flightRecorderMocks.setVoiceCaptureState).toHaveBeenLastCalledWith('recording');
    act(() => void discardLiveCapture(store));
    expect(flightRecorderMocks.setVoiceCaptureState).toHaveBeenLastCalledWith('inactive');
  });

  it('does not let the delayed stop of a claimed recording touch the one started after it', async () => {
    MockMediaRecorder.autoStop = false;
    const staleSend = vi.fn();
    const { renderer: firstRenderer, store } = await renderHarness({ onSendRecording: staleSend });

    await act(async () => {
      await recorderState.current?.start();
    });
    const staleRecorder = MockMediaRecorder.instances[0]!;
    let staleSendPromise!: Promise<boolean>;
    await act(async () => {
      staleSendPromise = recorderState.current!.send();
    });
    await act(async () => {
      firstRenderer.unmount();
    });

    const { renderer: secondRenderer } = await renderHarness({}, store);
    await act(async () => {
      await recorderState.current?.start();
    });
    expect(recorderState.current?.phase).toBe('recording');
    expect(flightRecorderMocks.setVoiceCaptureState).toHaveBeenLastCalledWith('recording');

    await act(async () => {
      staleRecorder.flushStop();
      await staleSendPromise;
    });

    expect(staleSend).toHaveBeenCalledOnce();
    expect(recorderState.current?.phase).toBe('recording');
    expect(flightRecorderMocks.setVoiceCaptureState).toHaveBeenLastCalledWith('recording');

    await act(async () => {
      secondRenderer.unmount();
    });
  });

  it('shares one recording between two composers, and Send in one takes it from both', async () => {
    MockMediaRecorder.autoStop = false;
    const first = { current: undefined as HarnessRecorder | undefined };
    const second = { current: undefined as HarnessRecorder | undefined };
    const firstSend = vi.fn();
    const secondSend = vi.fn();
    const secondClaim = vi.fn();
    const { store } = await renderHarness({ state: first, onSendRecording: firstSend });
    await renderHarness(
      { state: second, onSendRecording: secondSend, onSendStopRequest: secondClaim },
      store
    );

    await act(async () => {
      await first.current!.start();
      // The second composer's mic does nothing while the first one's recording runs.
      expect(await second.current!.start()).toBe(false);
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(first.current!.phase).toBe('recording');
    expect(second.current!.phase).toBe('recording');
    expect(second.current!.elapsedMs).toBe(first.current!.elapsedMs);
    expect(second.current!.waveform).toBe(first.current!.waveform);

    // Paused in one composer, it is paused in both.
    act(() => {
      second.current!.pause();
    });
    expect(first.current!.phase).toBe('paused');
    act(() => {
      first.current!.resume();
    });
    expect(second.current!.phase).toBe('recording');

    // Two Sends in one tick: the first takes the recording, the second finds none and leaves
    // its composer alone (onSendStopRequest is what empties the editor).
    let sending!: Promise<boolean>;
    await act(async () => {
      sending = first.current!.send();
      expect(await second.current!.send()).toBe(false);
    });
    expect(first.current!.phase).toBe('sending');
    expect(first.current!.elapsedMs).toBe(600);
    expect(second.current!.phase).toBe('idle');
    expect(second.current!.elapsedMs).toBe(0);
    await act(async () => {
      MockMediaRecorder.instances[0]!.flushStop();
      expect(await sending).toBe(true);
    });
    expect(firstSend).toHaveBeenCalledOnce();
    expect(secondSend).not.toHaveBeenCalled();
    expect(secondClaim).not.toHaveBeenCalled();
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(first.current!.phase).toBe('idle');
    expect(second.current!.phase).toBe('idle');
    expect(stream.track.stop).toHaveBeenCalledOnce();
  });

  it('discards the recording for every composer at once', async () => {
    const first = { current: undefined as HarnessRecorder | undefined };
    const second = { current: undefined as HarnessRecorder | undefined };
    const firstSend = vi.fn();
    const { store } = await renderHarness({ state: first, onSendRecording: firstSend });
    await renderHarness({ state: second }, store);
    await act(async () => {
      await first.current!.start();
    });

    // Discard pressed in the composer that did not start it.
    await act(async () => {
      void second.current!.discard();
    });

    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(first.current!.phase).toBe('idle');
    expect(second.current!.phase).toBe('idle');
    expect(stream.track.stop).toHaveBeenCalledOnce();
    await act(async () => {
      expect(await first.current!.send()).toBe(false);
    });
    expect(firstSend).not.toHaveBeenCalled();
    expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
  });

  it('stops the microphone and forgets the recording when the account leaves', async () => {
    const onSendRecording = vi.fn();
    const { store } = await renderHarness({ onSendRecording });
    await act(async () => {
      await recorderState.current!.start();
    });
    const recorder = MockMediaRecorder.instances[0]!;

    act(() => forgetComposerStateOfSession(store));

    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(onSendRecording).not.toHaveBeenCalled();
    expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
    expect(flightRecorderMocks.setVoiceCaptureState).toHaveBeenLastCalledWith('inactive');
  });

  it('stops capture in the task Send is pressed in, with the destination the composer shows then', async () => {
    MockMediaRecorder.autoStop = false;
    const onSendRecording = vi.fn();
    let destination = createTestSendContext(ROOM_ID, '$thread-a');
    const { store } = await renderHarness({ onSendRecording, getSendContext: () => destination });
    await act(async () => {
      await recorderState.current!.start();
    });
    const recorder = MockMediaRecorder.instances[0]!;
    let sendPromise!: Promise<boolean>;

    act(() => {
      sendPromise = recorderState.current!.send();
      // Before anything is awaited: the recording left the account, and the recorder was stopped.
      expect(store.get(liveCaptureAtom)).toBeUndefined();
      expect(recorder.stop).toHaveBeenCalledOnce();
    });

    // The composer shows another thread by the time the recorder hands over the audio.
    destination = createTestSendContext(ROOM_ID, '$thread-b');
    await act(async () => {
      recorder.flushStop();
      await sendPromise;
    });

    expect(onSendRecording).toHaveBeenCalledOnce();
    expect(onSendRecording.mock.calls[0]?.[3]).toMatchObject({ threadId: '$thread-a' });
  });

  it('releases the microphone as a recording is discarded, so leaving the account after it has nothing left to stop', async () => {
    MockMediaRecorder.autoStop = false;
    const { store } = await renderHarness();
    await act(async () => {
      await recorderState.current!.start();
    });
    const recorder = MockMediaRecorder.instances[0]!;

    act(() => void recorderState.current!.discard());

    // In the same call, without the recorder saying it stopped.
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(store.get(liveCaptureAtom)).toBeUndefined();

    act(() => forgetComposerStateOfSession(store));
    await act(async () => {
      recorder.flushStop();
      await vi.advanceTimersByTimeAsync(VOICE_RECORDER_STOP_TIMEOUT_MS);
    });

    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
  });

  it('releases the microphone at once and says nothing more when the account leaves while a claimed recording stops', async () => {
    MockMediaRecorder.autoStop = false;
    const onSendRecording = vi.fn();
    const { store } = await renderHarness({ onSendRecording });
    await act(async () => {
      await recorderState.current!.start();
    });
    let sendPromise!: Promise<boolean>;
    await act(async () => {
      vi.advanceTimersByTime(500);
      sendPromise = recorderState.current!.send();
      await Promise.resolve();
    });
    // The Send took the recording out of the account's hands; its recorder has yet to stop.
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(stream.track.stop).not.toHaveBeenCalled();

    act(() => forgetComposerStateOfSession(store));

    // Now, not when the recorder says it stopped or the time it is given for that runs out.
    expect(stream.track.stop).toHaveBeenCalledOnce();

    // The recorder stops late, with no audio: under the account, that was an error to show.
    let sent: boolean | undefined;
    await act(async () => {
      MockMediaRecorder.instances[0]!.dispatch('stop', new Event('stop'));
      sent = await sendPromise;
    });

    expect(sent).toBe(false);
    expect(onSendRecording).not.toHaveBeenCalled();
    expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
  });

  it.each([
    ['is delivered', (settle: { resolve: () => void }) => settle.resolve()],
    [
      'fails',
      (settle: { reject: (error: Error) => void }) => settle.reject(new Error('voice send failed')),
    ],
  ])(
    "leaves the next account's parked recording alone when a send begun before the switch %s",
    async (_outcome, settleSend) => {
      const settle = {} as { resolve: () => void; reject: (error: Error) => void };
      const onSendRecording = vi.fn(
        () =>
          new Promise<void>((resolve, reject) => {
            settle.resolve = resolve;
            settle.reject = reject;
          })
      );
      const { store } = await renderHarness({ onSendRecording });
      await act(async () => {
        await recorderState.current!.start();
      });
      let sendPromise!: Promise<boolean>;
      await act(async () => {
        vi.advanceTimersByTime(500);
        sendPromise = recorderState.current!.send();
        await Promise.resolve();
      });
      expect(onSendRecording).toHaveBeenCalledOnce();

      // The account is left during the upload, and the next one parks a recording of its own.
      const nextAccountsDraft: PendingVoiceSendDraft = {
        file: new File(['voice'], 'voice.ogg', { type: 'audio/ogg' }),
        duration: 1200,
        waveform: undefined,
        context: { ...createTestSendContext(), ownerSessionId: '@next:example.org' },
        errorMessage: 'offline',
      };
      act(() => {
        forgetComposerStateOfSession(store);
        store.set(pendingVoiceSendDraftAtom, nextAccountsDraft);
      });
      await act(async () => {
        settleSend(settle);
        await sendPromise;
      });

      expect(store.get(pendingVoiceSendDraftAtom)).toBe(nextAccountsDraft);
      expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
    }
  );

  it('passes the audio bitrate even when no preferred MIME type is supported', async () => {
    MockMediaRecorder.isTypeSupported.mockReturnValue(false);
    const { renderer } = await renderHarness();

    await act(async () => {
      await recorderState.current?.start();
    });

    expect(MockMediaRecorder.instances[0]!.options).toEqual({
      audioBitsPerSecond: VOICE_RECORDER_AUDIO_BITS_PER_SECOND,
    });
    expect(MockMediaRecorder.instances[0]!.options).not.toHaveProperty('mimeType');

    renderer.unmount();
  });

  it('falls back to unconstrained mic capture on OverconstrainedError', async () => {
    const fallbackStream = new MockMediaStream();
    getUserMedia
      .mockRejectedValueOnce(new DOMException('msg', 'OverconstrainedError'))
      .mockResolvedValueOnce(fallbackStream);
    const { renderer } = await renderHarness();

    await act(async () => {
      await recorderState.current?.start();
    });

    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: VOICE_RECORDER_AUDIO_CONSTRAINTS,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, { audio: true });
    expect(recorderState.current?.phase).toBe('recording');

    renderer.unmount();
  });

  it('does not start unconstrained fallback mic capture after a discard', async () => {
    let rejectGetUserMedia!: (error: DOMException) => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<MockMediaStream>((_resolve, reject) => {
          rejectGetUserMedia = reject;
        })
    );
    const { store } = await renderHarness();

    let startPromise!: Promise<unknown>;
    await act(async () => {
      startPromise = recorderState.current!.start();
      await Promise.resolve();
    });

    act(() => void recorderState.current!.discard());

    await act(async () => {
      rejectGetUserMedia(new DOMException('msg', 'OverconstrainedError'));
      await startPromise;
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      audio: VOICE_RECORDER_AUDIO_CONSTRAINTS,
    });
    expect(MockMediaRecorder.instances).toHaveLength(0);
    expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
  });

  it('does not fall back to unconstrained mic capture on NotAllowedError', async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const { renderer, store } = await renderHarness();

    await act(async () => {
      await recorderState.current?.start();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(recorderState.current?.phase).toBe('idle');
    // A recording that could not start leaves, with its reason for the shell's one dialog.
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(store.get(liveCaptureErrorAtom)).toEqual({
      kind: 'voice',
      message:
        'Microphone access is blocked. Allow microphone access for this site/app in your browser or system settings and try again.',
    });
    expect(flightRecorderMocks.setVoiceCaptureState.mock.calls.map(([state]) => state)).toEqual([
      'requesting',
      'inactive',
    ]);

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
    expect(onSendRecording.mock.calls[0]![2]).toEqual(normalizeMatrixWaveform(metadataSamples));
    expect(onSendRecording.mock.calls[0]![2]).not.toEqual(metadataSamples.slice(-48));

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

    const recorder = MockMediaRecorder.instances[0]!;
    expect(recorder.pause).toHaveBeenCalledOnce();
    expect(recorder.resume).toHaveBeenCalledOnce();
    expect(onSendRecording.mock.calls[0]![1]).toBe(1500);

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
      void recorderState.current?.discard();
    });

    expect(onSendRecording).not.toHaveBeenCalled();
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(recorderState.current?.phase).toBe('idle');

    renderer.unmount();
  });

  it('leaves a claimed recording alone when Discard follows its Send', async () => {
    MockMediaRecorder.autoStop = false;
    const onSendRecording = vi.fn();
    const { renderer } = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });

    const recorder = MockMediaRecorder.instances[0]!;
    let sendPromise!: Promise<boolean>;
    await act(async () => {
      vi.advanceTimersByTime(500);
      sendPromise = recorderState.current!.send();
    });
    await act(async () => {
      void recorderState.current?.discard();
    });
    await act(async () => {
      recorder.flushStop();
      await sendPromise;
    });

    expect(onSendRecording).toHaveBeenCalledOnce();
    expect(onSendRecording.mock.calls[0]![1]).toBe(500);

    renderer.unmount();
  });

  it('keeps an explicit send alive if the recorder unmounts before the stop event', async () => {
    MockMediaRecorder.autoStop = false;
    const onSendRecording = vi.fn();
    const { renderer } = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });

    const recorder = MockMediaRecorder.instances[0]!;
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
    expect(onSendRecording.mock.calls[0]![1]).toBe(500);
    expect(stream.track.stop).toHaveBeenCalled();
  });

  it('resolves an in-flight send after unmount without parking a draft', async () => {
    let resolveSend!: () => void;
    const onSendRecording = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveSend = resolve;
        })
    );
    const store = createStore();
    const { renderer } = await renderHarness({ onSendRecording }, store);

    await act(async () => {
      await recorderState.current?.start();
    });
    let sendPromise!: Promise<boolean>;
    await act(async () => {
      vi.advanceTimersByTime(500);
      sendPromise = recorderState.current!.send();
      await Promise.resolve();
    });

    expect(onSendRecording).toHaveBeenCalledOnce();
    act(() => {
      renderer.unmount();
    });

    let sent: boolean | undefined;
    await act(async () => {
      resolveSend();
      sent = await sendPromise;
    });

    expect(sent).toBe(true);
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
  });

  it('parks an in-flight send failure after unmount with its captured context', async () => {
    let rejectSend!: (error: Error) => void;
    const capturedContext = createTestSendContext(ROOM_ID);
    const sendFailure = new Error('voice send failed');
    const onSendRecording = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSend = reject;
        })
    );
    const store = createStore();
    const { renderer } = await renderHarness(
      { onSendRecording, getSendContext: () => capturedContext },
      store
    );

    await act(async () => {
      await recorderState.current?.start();
    });
    let sendPromise!: Promise<boolean>;
    await act(async () => {
      vi.advanceTimersByTime(500);
      sendPromise = recorderState.current!.send();
      await Promise.resolve();
    });

    act(() => {
      renderer.unmount();
    });

    let sent: boolean | undefined;
    await act(async () => {
      rejectSend(sendFailure);
      sent = await sendPromise;
    });

    expect(sent).toBe(false);
    expect(store.get(pendingVoiceSendDraftAtom)).toMatchObject({
      errorMessage: 'voice send failed',
      context: capturedContext,
    });
  });

  it('requests send ownership before the delayed recorder stop event builds a voice file', async () => {
    MockMediaRecorder.autoStop = false;
    const onSendStopRequest = vi.fn(() => true);
    const onSendRecording = vi.fn();
    const { renderer } = await renderHarness({ onSendStopRequest, onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });

    const recorder = MockMediaRecorder.instances[0]!;
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
    expect(onSendRecording.mock.calls[0]![1]).toBe(500);

    renderer.unmount();
  });

  it('sends to the composer whose Send is pressed, in another room than where it started', async () => {
    const startedIn = { current: undefined as HarnessRecorder | undefined };
    const sentFrom = { current: undefined as HarnessRecorder | undefined };
    const startRoomSend = vi.fn();
    const sendRoomSend = vi.fn();
    const replyDraft = { userId: '@agent:example.org', eventId: '$question', body: 'Question' };
    // The composer of a room's main view, where the mic is pressed.
    const { renderer: startRenderer, store } = await renderHarness({
      state: startedIn,
      onSendRecording: startRoomSend,
      getSendContext: () => createTestSendContext(ROOM_ID),
    });
    await act(async () => {
      await startedIn.current!.start();
      vi.advanceTimersByTime(700);
    });

    // On to a thread of another room: the first composer goes, another one comes.
    await act(async () => {
      startRenderer.unmount();
    });
    expect(stream.track.stop).not.toHaveBeenCalled();
    // Time passes on a page with no composer (the Threads page): the recording keeps counting.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    const getSendContext = () => ({
      ...createTestSendContext(OTHER_ROOM_ID, '$thread-b'),
      replyDraft,
      threadView: true,
    });
    await renderHarness(
      {
        state: sentFrom,
        onSendRecording: sendRoomSend,
        getSendContext,
      },
      store
    );
    expect(sentFrom.current!.elapsedMs).toBe(1200);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await act(async () => {
      expect(await sentFrom.current!.send()).toBe(true);
    });

    expect(startRoomSend).not.toHaveBeenCalled();
    expect(sendRoomSend).toHaveBeenCalledOnce();
    expect(sendRoomSend.mock.calls[0]![1]).toBe(1500);
    expect(sendRoomSend.mock.calls[0]![3]).toMatchObject({
      roomId: OTHER_ROOM_ID,
      threadId: '$thread-b',
      replyDraft,
      threadView: true,
    });
    expect(MockMediaRecorder.instances).toHaveLength(1);
  });

  it('sends with the callback and context the composer has when Send is pressed', async () => {
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
          React.createElement(Harness, {
            onSendRecording: laterSend,
            getSendContext: () => createTestSendContext(ROOM_ID, '$thread-at-send'),
          })
        )
      );
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    expect(initialSend).not.toHaveBeenCalled();
    expect(laterSend).toHaveBeenCalledOnce();
    expect(laterSend.mock.calls[0]![3]).toMatchObject({ threadId: '$thread-at-send' });

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

    const firstFile = onSendRecording.mock.calls[0]![0];
    const firstDuration = onSendRecording.mock.calls[0]![1];
    const firstWaveform = onSendRecording.mock.calls[0]![2];
    const firstContext = onSendRecording.mock.calls[0]![3];
    expect(recorderState.current?.hasPendingSend).toBe(true);
    expect(recorderState.current?.pendingDuration).toBe(firstDuration);
    expect(recorderState.current?.pendingWaveform).toEqual(firstWaveform);

    await act(async () => {
      await recorderState.current?.retry();
    });

    expect(onSendRecording).toHaveBeenCalledTimes(2);
    expect(onSendRecording.mock.calls[1]![0]).toBe(firstFile);
    expect(onSendRecording.mock.calls[1]![1]).toBe(firstDuration);
    expect(onSendRecording.mock.calls[1]![2]).toBe(firstWaveform);
    // The retry must reuse the originally-captured context so the message
    // lands in the room where it was recorded, not the room currently shown.
    expect(onSendRecording.mock.calls[1]![3]).toEqual(firstContext);
    expect(recorderState.current?.hasPendingSend).toBe(false);
    expect(recorderState.current?.phase).toBe('idle');

    renderer.unmount();
  });

  it('parks and retries the room and thread the composer shows when Send is pressed', async () => {
    const uploadError = new Error('voice send failed');
    const onSendRecording = vi
      .fn()
      .mockRejectedValueOnce(uploadError)
      .mockResolvedValueOnce(undefined);
    let destination = createTestSendContext(ROOM_ID, '$thread-at-start');
    const getSendContext = () => destination;
    const { renderer, store } = await renderHarness({ onSendRecording, getSendContext });

    await act(async () => {
      await recorderState.current?.start();
    });
    destination = createTestSendContext(OTHER_ROOM_ID, '$thread-at-send');
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });

    expect(onSendRecording.mock.calls[0]![3]).toMatchObject({
      roomId: OTHER_ROOM_ID,
      threadId: '$thread-at-send',
    });
    expect(store.get(pendingVoiceSendDraftAtom)?.context).toMatchObject({
      roomId: OTHER_ROOM_ID,
      threadId: '$thread-at-send',
    });

    destination = createTestSendContext(ROOM_ID, '$thread-after-failure');
    await act(async () => {
      await recorderState.current?.retry();
    });

    expect(onSendRecording.mock.calls[1]![3]).toMatchObject({
      roomId: OTHER_ROOM_ID,
      threadId: '$thread-at-send',
    });

    renderer.unmount();
  });

  it('uses Android-specific permission help for blocked microphone access in the native app', () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');

    expect(getVoiceRecorderErrorMessage(new DOMException('', 'NotAllowedError'))).toBe(
      'Microphone access is blocked. Allow microphone access for MindRoom in Android app settings and try again.'
    );
  });

  it('declares the Android permissions Capacitor requests for native voice recording', () => {
    const manifestSource = readFileSync(
      new URL('../../../../android/app/src/main/AndroidManifest.xml', import.meta.url),
      'utf8'
    );

    expect(manifestSource).toContain(
      '<uses-permission android:name="android.permission.RECORD_AUDIO" />'
    );
    expect(manifestSource).toContain(
      '<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS" />'
    );
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

  it('parks nothing under the next account when a retry fails after the account left', async () => {
    let failRetry!: (error: Error) => void;
    const onSendRecording = vi
      .fn()
      .mockRejectedValueOnce(new Error('upload failed'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            failRetry = reject;
          })
      );
    const { renderer, store } = await renderHarness({ onSendRecording });
    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
    });
    expect(store.get(pendingVoiceSendDraftAtom)).toBeDefined();

    let retry!: Promise<boolean | undefined>;
    await act(async () => {
      retry = Promise.resolve(recorderState.current?.retry());
      await Promise.resolve();
    });
    act(() => forgetComposerStateOfSession(store));
    await act(async () => {
      failRetry(new Error('offline'));
      expect(await retry).toBe(false);
    });
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();

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
      await recorderState.current?.discardPending();
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

  it('starts no recorder when microphone permission arrives after the account left', async () => {
    // A permission prompt answered after the account's pages went must not build a
    // MediaRecorder, start capture or timers, or keep the mic stream for the next account.
    const onSendRecording = vi.fn();
    let resolveGetUserMedia!: (stream: MockMediaStream) => void;
    getUserMedia.mockImplementationOnce(
      () =>
        new Promise<MockMediaStream>((resolve) => {
          resolveGetUserMedia = resolve;
        })
    );
    const { renderer, store } = await renderHarness({ onSendRecording });

    let startPromise!: Promise<unknown>;
    await act(async () => {
      startPromise = recorderState.current!.start();
      await Promise.resolve();
    });

    // The account leaves while the OS permission dialog is still open.
    act(() => {
      renderer.unmount();
      forgetComposerStateOfSession(store);
    });

    // The permission prompt now resolves with a real stream.
    const lateStream = new MockMediaStream();
    await act(async () => {
      resolveGetUserMedia(lateStream);
      await startPromise;
    });

    expect(lateStream.track.stop).toHaveBeenCalledOnce();
    expect(MockMediaRecorder.instances).toHaveLength(0);
    expect(onSendRecording).not.toHaveBeenCalled();
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
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
      .fn<() => boolean | void>()
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

  it('does not resurrect a draft discarded synchronously by an accepted retry claim', async () => {
    const store = createStore();
    const onSendStopFailure = vi.fn();
    const onSendRecording = vi.fn().mockRejectedValueOnce(new Error('initial failure'));
    const onSendStopRequest = vi
      .fn<() => boolean | void>()
      .mockReturnValueOnce(true)
      .mockImplementationOnce(() => {
        store.set(pendingVoiceSendDraftAtom, undefined);
        return true;
      });
    const { renderer } = await renderHarness(
      { onSendRecording, onSendStopFailure, onSendStopRequest },
      store
    );

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
    expect(onSendRecording).toHaveBeenCalledOnce();
    expect(onSendStopFailure).toHaveBeenCalledTimes(2);

    renderer.unmount();
  });

  it('does not reset a replacement capture started from delivery failure settlement', async () => {
    let replacementStart: boolean | undefined;
    const onSendStopFailure = vi.fn(async () => {
      await recorderState.current?.discardPending();
      await Promise.resolve();
      replacementStart = await recorderState.current?.start();
    });
    const onSendRecording = vi.fn().mockRejectedValueOnce(new Error('initial failure'));
    const { renderer } = await renderHarness({
      onSendRecording,
      onSendStopFailure: () => void onSendStopFailure(),
    });

    await act(async () => {
      await recorderState.current?.start();
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
      await recorderState.current?.send();
      await Promise.resolve();
    });

    expect(replacementStart).toBe(true);
    expect(MockMediaRecorder.instances).toHaveLength(2);
    expect(recorderState.current?.phase).toBe('recording');

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
    const { renderer, store } = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });

    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(onSendRecording).not.toHaveBeenCalled();
    expect(store.get(liveCaptureErrorAtom)).toEqual({
      kind: 'voice',
      message: 'constructor failed',
    });
    expect(store.get(liveCaptureAtom)).toBeUndefined();

    renderer.unmount();
  });

  /** The recording's disk copy, as `startLiveVoiceRecording` hands it to the capture session. */
  const journalRecording = () => {
    const disk = {
      id: crypto.randomUUID(),
      append: vi.fn(async () => undefined),
      release: vi.fn<() => void>(),
      remove: vi.fn(async () => undefined),
    };
    const begin = vi.spyOn(journal, 'beginVoiceRecording').mockReturnValueOnce(disk);
    return { disk, begin };
  };

  it('parks the audio of a recorder that stops on its own as a recovered recording', async () => {
    const { disk, begin } = journalRecording();
    const onSendRecording = vi.fn();
    const { renderer, store } = await renderHarness({ onSendRecording });

    await act(async () => {
      await recorderState.current?.start();
    });
    expect(begin).toHaveBeenCalledExactlyOnceWith(
      TEST_USER_ID,
      expect.any(Number),
      expect.any(String)
    );

    const recorder = MockMediaRecorder.instances[0]!;
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      recorder.state = 'inactive';
      recorder.flushStop();
    });

    expect(onSendRecording).not.toHaveBeenCalled();
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(store.get(liveCaptureErrorAtom)).toBeUndefined();
    const parked = store.get(pendingVoiceSendDraftAtom);
    expect(parked).toMatchObject({ duration: 5_000, recovered: true, recordingId: disk.id });
    expect(await parked?.file.text()).toBe('voice');
    expect(recorderState.current).toMatchObject({ hasPendingSend: true, recovered: true });
    // Parked, it is still this tab's: its disk copy goes once it is sent or discarded.
    expect(disk.release).not.toHaveBeenCalled();
    expect(disk.remove).not.toHaveBeenCalled();

    renderer.unmount();
    begin.mockRestore();
  });

  it('leaves a self-stopped recording on disk, unlocked, while the draft slot is taken', async () => {
    const { disk, begin } = journalRecording();
    const { store } = await renderHarness();
    await act(async () => {
      await recorderState.current?.start();
    });
    const older: PendingVoiceSendDraft = {
      file: new File(['older'], 'older.ogg', { type: 'audio/ogg' }),
      duration: 900,
      context: createTestSendContext(),
    };
    const recorder = MockMediaRecorder.instances[0]!;
    await act(async () => {
      store.set(pendingVoiceSendDraftAtom, older);
      recorder.state = 'inactive';
      recorder.flushStop();
    });

    expect(store.get(pendingVoiceSendDraftAtom)).toBe(older);
    expect(store.get(liveCaptureAtom)).toBeUndefined();
    expect(disk.release).toHaveBeenCalledOnce();
    expect(disk.remove).not.toHaveBeenCalled();
    begin.mockRestore();
  });

  it('keeps the disk copy, unlocked, when the account leaves, and deletes it on Discard', async () => {
    MockMediaRecorder.autoStop = false;
    const left = journalRecording();
    const { store } = await renderHarness();
    await act(async () => {
      await recorderState.current?.start();
    });
    const emitChunk = (recorder: MockMediaRecorder) =>
      recorder.dispatch('dataavailable', { data: new Blob(['voice']) } as BlobEvent);
    emitChunk(MockMediaRecorder.instances[0]!);
    // A change of account without signing out: the microphone stops, the audio waits on disk.
    act(() => forgetComposerStateOfSession(store));
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(left.disk.release).not.toHaveBeenCalled();
    // The stopped recorder's last audio reaches the disk copy before its lock goes.
    MockMediaRecorder.instances[0]!.flushStop();
    expect(left.disk.append).toHaveBeenCalledTimes(2);
    expect(left.disk.release).toHaveBeenCalledOnce();
    expect(left.disk.remove).not.toHaveBeenCalled();
    expect(store.get(pendingVoiceSendDraftAtom)).toBeUndefined();
    left.begin.mockRestore();

    const discarded = journalRecording();
    await act(async () => {
      await recorderState.current?.start();
    });
    emitChunk(MockMediaRecorder.instances[1]!);
    act(() => void recorderState.current!.discard());
    expect(discarded.disk.remove).toHaveBeenCalledOnce();
    expect(discarded.disk.release).not.toHaveBeenCalled();
    discarded.begin.mockRestore();
  });

  it('does not retain a pending send draft when no audio chunks were captured', async () => {
    MockMediaRecorder.autoStop = false;
    const onSendRecording = vi.fn();
    const onSendStopFailure = vi.fn();
    const { renderer, store } = await renderHarness({ onSendRecording, onSendStopFailure });

    await act(async () => {
      await recorderState.current?.start();
    });

    const recorder = MockMediaRecorder.instances[0]!;
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
    expect(store.get(liveCaptureErrorAtom)).toEqual({
      kind: 'voice',
      message: 'No audio data was captured.',
    });
    expect(recorderState.current?.hasPendingSend).toBe(false);
    expect(recorderState.current?.phase).toBe('idle');

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
    expect(onSendRecording.mock.calls[0]![1]).toBe(700);
    expect(onSendRecording.mock.calls[0]![2]).toBeUndefined();

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
