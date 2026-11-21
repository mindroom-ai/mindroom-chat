import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createVoiceCaptureSession,
  VOICE_RECORDER_STOP_TIMEOUT_MS,
  VOICE_RECORDER_TIMESLICE_MS,
  type VoiceCaptureSession,
} from './voiceCaptureSession';

const diagnostics = vi.hoisted(() => ({ publish: vi.fn(), trace: vi.fn() }));
vi.mock('../../diagnostics/flightRecorder', () => ({
  setFlightRecorderVoiceCaptureState: diagnostics.publish,
}));
vi.mock('../../diagnostics/deepTrace', () => ({ recordDeepTraceEvent: diagnostics.trace }));
vi.mock('../../native/nativeSso', () => ({ isNativeApp: () => false }));
const native = vi.hoisted(() => ({ available: vi.fn(() => false), start: vi.fn() }));
vi.mock('../../native/nativeVoiceRecorder', () => ({
  isNativeVoiceRecorderAvailable: native.available,
  startNativeVoiceRecorder: native.start,
}));

class Recorder {
  static instances: Recorder[] = [];

  static isTypeSupported = () => true;

  state: RecordingState = 'inactive';

  timeslice: number | undefined;

  mimeType: string;

  listeners = new Map<string, Set<(event: any) => void>>();

  constructor(_stream: MediaStream, readonly options: MediaRecorderOptions) {
    this.mimeType = options.mimeType ?? '';
    Recorder.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void) {
    const entries = this.listeners.get(type) ?? new Set();
    entries.add(listener);
    this.listeners.set(type, entries);
  }

  removeEventListener(type: string, listener: (event: any) => void) {
    this.listeners.get(type)?.delete(listener);
  }

  start(timeslice?: number) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }

  pause() {
    this.state = 'paused';
  }

  resume() {
    this.state = 'recording';
  }

  stop = vi.fn(() => {
    this.state = 'inactive';
  });

  emitData(data: Blob) {
    this.listeners.get('dataavailable')?.forEach((listener) => listener({ data }));
  }

  emitStop() {
    this.state = 'inactive';
    this.listeners.get('stop')?.forEach((listener) => listener(new Event('stop')));
  }
}
class Audio {
  static instances: Audio[] = [];

  static failure: 'source' | 'analyser' | 'connect' | undefined;

  state = 'running';

  source = {
    disconnect: vi.fn(),
    connect: vi.fn(() => {
      if (Audio.failure === 'connect') throw new Error('connect');
    }),
  };

  analyser = { fftSize: 2048, getByteTimeDomainData: (buffer: Uint8Array) => buffer.fill(160) };

  close = vi.fn(async () => undefined);

  constructor() {
    Audio.instances.push(this);
  }

  createMediaStreamSource() {
    if (Audio.failure === 'source') throw new Error('source');
    return this.source;
  }

  createAnalyser() {
    if (Audio.failure === 'analyser') throw new Error('analyser');
    return this.analyser;
  }
}
const newStream = () => {
  const track = { stop: vi.fn() };
  return { track, getTracks: () => [track] };
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
let stream: ReturnType<typeof newStream>;
let getUserMedia: ReturnType<typeof vi.fn>;
let sessions: VoiceCaptureSession[];
const capture = () => {
  const session = createVoiceCaptureSession();
  sessions.push(session);
  return session;
};
class NativeRecorder extends EventTarget {
  state: RecordingState = 'recording';
  mimeType = 'audio/mp4';
  id = 'native-id';
  level = () => 0.25;
  pause = vi.fn(() => {
    this.state = 'paused';
  });
  resume = vi.fn(() => {
    this.state = 'recording';
  });
  stop = vi.fn(() => {
    this.state = 'inactive';
  });
  deliver(body = 'voice') {
    this.dispatchEvent(Object.assign(new Event('dataavailable'), { data: new Blob([body]) }));
    this.dispatchEvent(new Event('stop'));
  }
}
const withoutWebCapture = () => {
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('MediaRecorder', undefined);
  native.available.mockReturnValue(true);
  const recorder = new NativeRecorder();
  native.start.mockResolvedValue(recorder);
  return recorder;
};
const latest = () => Recorder.instances.at(-1)!;
const finish = async (session: VoiceCaptureSession, body = 'voice') => {
  const recorder = latest();
  const result = session.finish();
  recorder.emitData(new Blob([body], { type: 'audio/webm' }));
  recorder.emitStop();
  return result;
};

beforeEach(() => {
  vi.useFakeTimers();
  sessions = [];
  stream = newStream();
  getUserMedia = vi.fn(async () => stream);
  Recorder.instances = [];
  Audio.instances = [];
  Audio.failure = undefined;
  diagnostics.publish.mockClear();
  diagnostics.trace.mockClear();
  native.available.mockReset().mockReturnValue(false);
  native.start.mockReset();
  vi.stubGlobal('window', { isSecureContext: true, AudioContext: Audio });
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
  vi.stubGlobal('MediaRecorder', Recorder);
});
afterEach(() => {
  sessions.forEach((session) => session.reset());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('voice capture session', () => {
  it('constructs without browser effects and publishes stable immutable snapshots', async () => {
    const session = capture();
    const idle = session.getSnapshot();
    expect(session.getSnapshot()).toBe(idle);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(diagnostics.publish).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
    const listener = vi.fn();
    const unsubscribe = session.subscribe(listener);
    await session.start();
    const recording = session.getSnapshot();
    expect(recording).not.toBe(idle);
    expect(session.getSnapshot()).toBe(recording);
    expect(() => recording.waveform.push(999)).toThrow();
    const retained = [...recording.waveform];
    vi.advanceTimersByTime(80);
    expect(recording.waveform).toEqual(retained);
    expect(session.getSnapshot().waveform).toHaveLength(2);
    expect(session.getSnapshot().sampleCount).toBe(recording.sampleCount + 1);
    unsubscribe();
    listener.mockClear();
    vi.advanceTimersByTime(80);
    expect(listener).not.toHaveBeenCalled();
    const result = await finish(session);
    expect(result.status).toBe('captured');
    if (result.status === 'captured') expect(result.recording.waveform).not.toContain(999);
  });

  it('captures compressed audio and counts only active time across pause', async () => {
    const session = capture();
    await session.start();
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: {
        channelCount: 1,
        sampleRate: 24_000,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(latest().options.audioBitsPerSecond).toBe(32_000);
    vi.advanceTimersByTime(250);
    expect(session.pause()).toBe(true);
    const paused = session.getSnapshot();
    vi.advanceTimersByTime(5000);
    expect(session.getSnapshot()).toBe(paused);
    expect(session.resume()).toBe(true);
    vi.advanceTimersByTime(150);
    const result = await finish(session);
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') throw new Error('missing recording');
    expect(result.recording.duration).toBe(400);
    expect(await result.recording.file.text()).toBe('voice');
    expect(result.recording.file.type).toBe(latest().mimeType);
    expect(result.recording.waveform).toEqual(Array(48).fill(512));
    expect(session.getSnapshot().phase).toBe('processing');
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(Audio.instances[0]!.source.disconnect).toHaveBeenCalledOnce();
    expect(Audio.instances[0]!.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('ignores finish when a processing subscriber synchronously resets the session', async () => {
    const session = capture();
    await session.start();
    const recorder = latest();
    session.subscribe(() => {
      if (session.getSnapshot().phase === 'processing') session.reset();
    });
    const result = session.finish();
    recorder.emitData(new Blob(['dropped']));
    recorder.emitStop();
    expect(await result).toEqual({ status: 'ignored' });
    expect(session.getSnapshot().phase).toBe('idle');
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['permission', 'sample'] as const)(
    'releases resources when a %s subscriber tears down during start',
    async (releaseAt) => {
      const session = capture();
      let tornDown = false;
      session.subscribe(() => {
        const snapshot = session.getSnapshot();
        if (
          !tornDown &&
          (releaseAt === 'permission'
            ? Recorder.instances.length > 0
            : snapshot.waveform.length === 1)
        ) {
          tornDown = true;
          session.reset();
        }
      });
      expect(await session.start()).toBe(false);
      expect(stream.track.stop).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(session.getSnapshot().phase).toBe('idle');
      expect(latest().state).toBe('inactive');
    }
  );

  it.each(['initial', 'requesting'] as const)(
    'cancels start on %s notification reset before permission acquisition',
    async (notification) => {
      const session = capture();
      let canceled = false;
      session.subscribe(() => {
        if (
          !canceled &&
          (notification === 'initial' || session.getSnapshot().phase === 'requesting')
        ) {
          canceled = true;
          session.reset();
        }
      });
      const started = await session.start();
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(Recorder.instances).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(session.getSnapshot().phase).toBe('idle');
      expect(started).toBe(false);
    }
  );

  it('does not resurrect recording when an immediate resume sample resets capture', async () => {
    const session = capture();
    await session.start();
    vi.advanceTimersByTime(250);
    session.pause();
    const samples = session.getSnapshot().waveform.length;
    let reset = false;
    const unsubscribe = session.subscribe(() => {
      if (!reset && session.getSnapshot().waveform.length > samples) {
        reset = true;
        session.reset();
      }
    });
    const resumed = session.resume();
    expect(session.getSnapshot().phase).toBe('idle');
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(resumed).toBe(false);
    unsubscribe();
    expect(await session.start()).toBe(true);
  });

  it.each(['start', 'resume'] as const)(
    'preserves accepted finish from the immediate %s sample',
    async (operation) => {
      const session = capture();
      if (operation === 'resume') {
        await session.start();
        vi.advanceTimersByTime(250);
        session.pause();
        vi.advanceTimersByTime(500);
      }
      const sampleCount = operation === 'start' ? 0 : session.getSnapshot().waveform.length;
      const NativeFile = File;
      const files: File[] = [];
      vi.stubGlobal(
        'File',
        class extends NativeFile {
          constructor(bits: BlobPart[], name: string, options?: FilePropertyBag) {
            super(bits, name, options);
            files.push(this);
          }
        }
      );
      let accepted: ReturnType<VoiceCaptureSession['finish']> | undefined;
      let claimed = false;
      session.subscribe(() => {
        if (
          !claimed &&
          session.canStop() &&
          session.getSnapshot().waveform.length === sampleCount + 1
        ) {
          claimed = true;
          accepted = session.finish();
        }
      });
      const started = await session[operation]();
      expect(accepted).toBeDefined();
      expect(session.getSnapshot().phase).toBe('processing');
      expect(started).toBe(false);
      const recorder = latest();
      expect(recorder.stop).toHaveBeenCalledOnce();
      recorder.emitData(new Blob(['accepted-' + operation], { type: 'audio/webm' }));
      recorder.emitStop();
      const result = await accepted!;
      expect(result.status).toBe('captured');
      if (result.status !== 'captured') throw new Error('missing accepted recording');
      expect(await result.recording.file.text()).toBe('accepted-' + operation);
      expect(result.recording.duration).toBe(operation === 'start' ? 1 : 250);
      recorder.emitData(new Blob(['late']));
      recorder.emitStop();
      expect(files).toEqual([result.recording.file]);
      expect(await session.finish()).toEqual({ status: 'ignored' });
      expect(stream.track.stop).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(session.getSnapshot().phase).toBe('processing');
    }
  );

  it.each(['start', 'resume'] as const)(
    'reports false when final %s recording notification invokes reset',
    async (operation) => {
      const session = capture();
      if (operation === 'resume') {
        await session.start();
        session.pause();
      }
      session.subscribe(() => {
        if (session.getSnapshot().phase === 'recording') session.reset();
      });
      const started = await session[operation]();
      expect(session.getSnapshot().phase).toBe('idle');
      expect(stream.track.stop).toHaveBeenCalledOnce();
      expect(Audio.instances[0]!.close).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
      expect(started).toBe(false);
    }
  );

  it.each(['resolve', 'reject', 'overconstrained'] as const)(
    'ignores permission %s after reset',
    async (outcome) => {
      const permission = deferred<ReturnType<typeof newStream>>();
      getUserMedia.mockReturnValue(permission.promise);
      const session = capture();
      const started = session.start();
      session.reset();
      if (outcome === 'resolve') permission.resolve(stream);
      else
        permission.reject(
          new DOMException(
            'denied',
            outcome === 'overconstrained' ? 'OverconstrainedError' : 'NotAllowedError'
          )
        );
      expect(await started).toBe(false);
      expect(getUserMedia).toHaveBeenCalledOnce();
      expect(Recorder.instances).toHaveLength(0);
      expect(vi.getTimerCount()).toBe(0);
      expect(session.getSnapshot().errorMessage).toBeUndefined();
      if (outcome === 'resolve') expect(stream.track.stop).toHaveBeenCalledOnce();
    }
  );

  it.each(['OverconstrainedError', 'NotAllowedError'])(
    'retries only overconstrained permission: %s',
    async (name) => {
      getUserMedia.mockRejectedValueOnce(new DOMException('denied', name));
      const session = capture();
      expect(await session.start()).toBe(name === 'OverconstrainedError');
      expect(getUserMedia).toHaveBeenCalledTimes(name === 'OverconstrainedError' ? 2 : 1);
      if (name === 'OverconstrainedError')
        expect(getUserMedia).toHaveBeenLastCalledWith({ audio: true });
    }
  );

  it.each(['source', 'analyser', 'connect'] as const)(
    'releases partial audio setup at %s and still captures duration-only audio',
    async (failure) => {
      Audio.failure = failure;
      const session = capture();
      await session.start();
      expect(Audio.instances[0]!.close).toHaveBeenCalledOnce();
      if (failure !== 'source')
        expect(Audio.instances[0]!.source.disconnect).toHaveBeenCalledOnce();
      vi.advanceTimersByTime(250);
      const result = await finish(session);
      expect(result.status).toBe('captured');
      if (result.status === 'captured') {
        expect(result.recording.duration).toBe(250);
        expect(result.recording.waveform).toBeUndefined();
      }
    }
  );

  it('releases resources and reports failed when native stop throws', async () => {
    const session = capture();
    await session.start();
    latest().stop.mockImplementation(() => {
      throw new Error('stop failed');
    });
    expect(await session.finish()).toEqual({ status: 'failed' });
    expect(session.getSnapshot().errorMessage).toBe('stop failed');
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(Audio.instances[0]!.close).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('records in timeslices so audio reaches the app before native stop', async () => {
    const session = capture();
    await session.start();
    expect(latest().timeslice).toBe(VOICE_RECORDER_TIMESLICE_MS);
  });

  it('sends the audio already delivered when native stop never arrives', async () => {
    const session = capture();
    await session.start();
    vi.advanceTimersByTime(2000);
    const recorder = latest();
    recorder.emitData(new Blob(['early'], { type: 'audio/mp4' }));
    let settled = false;
    const result = session.finish().finally(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(VOICE_RECORDER_STOP_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const finished = await result;
    expect(finished.status).toBe('captured');
    if (finished.status === 'captured') {
      expect(await finished.recording.file.text()).toBe('early');
      expect(finished.recording.duration).toBe(2000);
    }
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(diagnostics.publish).toHaveBeenLastCalledWith('inactive');
    expect(diagnostics.trace).toHaveBeenCalledWith('voice.capture.stop_timeout', {
      chunk_count: 1,
    });
    recorder.emitData(new Blob(['late']));
    recorder.emitStop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('fails instead of hanging when native stop never arrives without audio', async () => {
    const session = capture();
    await session.start();
    const result = session.finish();
    await vi.advanceTimersByTimeAsync(VOICE_RECORDER_STOP_TIMEOUT_MS);
    expect(await result).toEqual({ status: 'failed' });
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      errorMessage: 'No audio data was captured.',
    });
    expect(stream.track.stop).toHaveBeenCalledOnce();
  });

  it('cancels the stop deadline once native stop arrives', async () => {
    const session = capture();
    await session.start();
    expect((await finish(session)).status).toBe('captured');
    expect(vi.getTimerCount()).toBe(0);
    expect(diagnostics.trace).not.toHaveBeenCalled();
  });

  it('rejects empty audio and unsolicited stops without producing captured data', async () => {
    const session = capture();
    await session.start();
    const result = session.finish();
    latest().emitData(new Blob([]));
    latest().emitStop();
    expect(await result).toEqual({ status: 'failed' });
    expect(session.getSnapshot().errorMessage).toBe('No audio data was captured.');
    await session.start();
    latest().emitData(new Blob(['unclaimed']));
    latest().emitStop();
    expect(session.getSnapshot().errorMessage).toBe(
      'Voice recording stopped unexpectedly. Please record again.'
    );
    expect(await session.finish()).toEqual({ status: 'ignored' });
  });

  it('parks the audio of a recorder that stops on its own', async () => {
    const park = vi.fn(() => true);
    const session = createVoiceCaptureSession(undefined, park);
    sessions.push(session);
    await session.start();
    vi.advanceTimersByTime(4_900);
    latest().emitData(new Blob(['voice'], { type: 'audio/webm' }));
    latest().emitStop();
    expect(park).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ duration: 4_900 }));
    expect(session.getSnapshot()).toMatchObject({ phase: 'idle', errorMessage: undefined });
    expect(stream.track.stop).toHaveBeenCalledOnce();
  });

  it('parks on request as when the recorder stops on its own, with its last audio', async () => {
    const disk = {
      id: 'recording',
      append: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    const park = vi.fn(() => true);
    const session = createVoiceCaptureSession(() => disk, park);
    sessions.push(session);

    // Not started yet: there is no audio to park, and it ends.
    getUserMedia.mockReturnValueOnce(new Promise(() => undefined));
    void session.start();
    session.park();
    expect(session.getSnapshot().phase).toBe('idle');
    expect(park).not.toHaveBeenCalled();

    await session.start();
    vi.advanceTimersByTime(700);
    session.park();
    expect(latest().stop).toHaveBeenCalledOnce();
    expect(park).not.toHaveBeenCalled();
    latest().emitData(new Blob(['last']));
    latest().emitStop();
    expect(disk.append).toHaveBeenCalledExactlyOnceWith(0, expect.any(Blob), 700);
    expect(park).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ duration: 700, recordingId: 'recording' })
    );
    expect(session.getSnapshot()).toMatchObject({ phase: 'idle', errorMessage: undefined });
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(disk.release).not.toHaveBeenCalled();

    // Not kept (the draft slot is taken): the disk copy stays, unlocked.
    park.mockReturnValue(false);
    await session.start();
    session.park();
    latest().emitData(new Blob(['more']));
    latest().emitStop();
    expect(disk.release).toHaveBeenCalledOnce();
    expect(disk.remove).not.toHaveBeenCalled();
  });

  it('continues recording after a journal write rejects and keeps the recorded bytes', async () => {
    const append = vi.fn().mockRejectedValue(new Error('quota exceeded'));
    const session = createVoiceCaptureSession(() => ({
      id: 'recording',
      append,
      remove: vi.fn(),
      release: vi.fn(),
    }));
    sessions.push(session);
    expect(await session.start()).toBe(true);
    vi.advanceTimersByTime(1_000);
    latest().emitData(new Blob(['first'], { type: 'audio/webm' }));
    await Promise.resolve();
    expect(session.getSnapshot().phase).toBe('recording');
    const result = await finish(session, 'second');
    expect(append.mock.calls.map(([seq]) => seq)).toEqual([0, 1]);
    expect(result.status).toBe('captured');
    if (result.status !== 'captured') return;
    expect(result.recording.recordingId).toBe('recording');
    expect(await result.recording.file.text()).toBe('firstsecond');
    expect(result.recording.file.type).toBe(latest().mimeType);
  });

  it('lets the last audio of a recorder that reset stops reach its disk copy', async () => {
    const disk = {
      id: 'recording',
      append: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
      release: vi.fn(),
    };
    const session = createVoiceCaptureSession(() => disk);
    sessions.push(session);
    const settled = () => [disk.release.mock.calls.length, disk.remove.mock.calls.length];

    // Before the first timeslice: the microphone goes now, the copy waits for the recorder.
    await session.start();
    vi.advanceTimersByTime(700);
    session.reset();
    expect(stream.track.stop).toHaveBeenCalledOnce();
    expect(session.getSnapshot().phase).toBe('idle');
    expect(settled()).toEqual([0, 0]);
    latest().emitData(new Blob(['last']));
    latest().emitStop();
    expect(disk.append).toHaveBeenCalledExactlyOnceWith(0, expect.any(Blob), 700);
    expect(settled()).toEqual([1, 0]);

    // A recorder that had no audio at all: the empty copy goes.
    await session.start();
    session.reset();
    latest().emitStop();
    expect(settled()).toEqual([1, 1]);

    // A recorder that never says it stopped is not waited for longer than a Send waits.
    await session.start();
    latest().emitData(new Blob(['first']));
    session.reset();
    expect(settled()).toEqual([1, 1]);
    vi.advanceTimersByTime(VOICE_RECORDER_STOP_TIMEOUT_MS);
    expect(settled()).toEqual([2, 1]);

    // A Discard waits for nothing: the copy goes at once, and what the recorder says is dropped.
    await session.start();
    disk.append.mockClear();
    void session.discard();
    expect(settled()).toEqual([2, 2]);
    latest().emitData(new Blob(['discarded']));
    latest().emitStop();
    expect(disk.append).not.toHaveBeenCalled();
    expect(settled()).toEqual([2, 2]);
  });

  it('resolves a Discard once its disk copy is gone', async () => {
    const removed = deferred<void>();
    const session = createVoiceCaptureSession(() => ({
      id: 'recording',
      append: vi.fn().mockResolvedValue(undefined),
      remove: () => removed.promise,
      release: vi.fn(),
    }));
    sessions.push(session);
    await session.start();
    let gone = false;
    const discarded = session.discard().then(() => {
      gone = true;
    });
    // The recording ends in the same call; only the promise waits for the disk.
    expect(session.getSnapshot().phase).toBe('idle');
    expect(stream.track.stop).toHaveBeenCalledOnce();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(gone).toBe(false);
    removed.resolve();
    await discarded;
    expect(gone).toBe(true);
  });

  it('stops a running recorder at once on reset, and takes nothing it says after', async () => {
    const session = capture();
    await session.start();
    session.reset();
    expect(stream.track.stop).toHaveBeenCalledOnce();
    latest().emitData(new Blob(['discarded']));
    latest().emitStop();
    expect(session.getSnapshot()).toMatchObject({ phase: 'idle', errorMessage: undefined });
    await session.start();
    session.reset();
    expect(latest().stop).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
    expect(session.getSnapshot().phase).toBe('idle');
  });

  it('isolates old data/stop from a new capture after reset', async () => {
    const session = capture();
    await session.start();
    vi.advanceTimersByTime(250);
    const old = latest();
    session.reset();
    const freshStream = newStream();
    getUserMedia.mockResolvedValue(freshStream);
    await session.start();
    Audio.instances.at(-1)!.analyser.getByteTimeDomainData = (buffer) => buffer.fill(144);
    vi.advanceTimersByTime(80);
    const snapshot = session.getSnapshot();
    old.emitData(new Blob(['old']));
    old.emitStop();
    expect(session.getSnapshot()).toBe(snapshot);
    expect(freshStream.track.stop).not.toHaveBeenCalled();
    vi.advanceTimersByTime(160);
    const result = await finish(session, 'fresh');
    if (result.status !== 'captured') throw new Error('missing fresh recording');
    expect(await result.recording.file.text()).toBe('fresh');
    expect(result.recording.duration).toBe(240);
    expect(result.recording.waveform!.at(-1)).toBe(362);
    expect(snapshot.waveform).toEqual([512, 362]);
  });

  it('bounds raw live samples without normalizing display data', async () => {
    const session = capture();
    await session.start();
    Audio.instances[0]!.analyser.getByteTimeDomainData = (buffer) => buffer.fill(128);
    vi.advanceTimersByTime(96_000);
    expect(session.getSnapshot().waveform).toEqual(Array(1200).fill(0));
    // The count keeps going past the cap, so the live waveform still glides.
    expect(session.getSnapshot().sampleCount).toBeGreaterThan(1200);
    const result = await finish(session);
    if (result.status !== 'captured') throw new Error('missing recording');
    expect(result.recording.waveform).toHaveLength(48);
  });
});

describe('voice capture session on the native recorder', () => {
  it.each(['send', 'discard', 'account exit'] as const)(
    'stops native capture for %s without journaling or parking its audio',
    async (action) => {
      const recorder = withoutWebCapture();
      const begin = vi.fn(() => ({
        id: 'journal-id',
        append: vi.fn(async () => undefined),
        remove: vi.fn(),
        release: vi.fn(),
      }));
      const park = vi.fn(() => true);
      const session = createVoiceCaptureSession(begin, park);
      expect(await session.start('@voice:example.org')).toBe(true);
      expect(native.start).toHaveBeenCalledExactlyOnceWith('@voice:example.org');
      vi.advanceTimersByTime(1_800);

      let stopped;
      if (action === 'account exit') session.reset();
      else stopped = action === 'send' ? session.finish() : session.discard();
      expect(recorder.stop).toHaveBeenCalledExactlyOnceWith();
      recorder.deliver('native voice');

      const result = await stopped;
      if (action === 'send') {
        expect(result).toMatchObject({ status: 'captured', recording: { duration: 1_800 } });
        if (!result || typeof result === 'boolean' || result.status !== 'captured')
          throw new Error('missing native recording');
        expect(await result.recording.file.text()).toBe('native voice');
        expect(result.recording.recordingId).toBeUndefined();
      }
      expect(begin).not.toHaveBeenCalled();
      expect(park).not.toHaveBeenCalled();
      session.reset();
      expect(session.getSnapshot().phase).toBe('idle');
    }
  );

  it('parks the audio of the native recorder on request, from memory', async () => {
    const recorder = withoutWebCapture();
    const park = vi.fn((_recording: { file: File; recordingId?: string }) => true);
    const session = createVoiceCaptureSession(undefined, park);
    expect(await session.start('@voice:example.org')).toBe(true);
    session.park();
    expect(recorder.stop).toHaveBeenCalledOnce();
    recorder.deliver('native voice');
    const [parked] = park.mock.calls[0]!;
    expect(await parked.file.text()).toBe('native voice');
    expect(parked.recordingId).toBeUndefined();
    expect(session.getSnapshot()).toMatchObject({ phase: 'idle', errorMessage: undefined });
  });

  it('records, pauses and sends through the native recorder', async () => {
    const recorder = withoutWebCapture();
    const session = capture();
    expect(await session.start()).toBe(true);
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(session.getSnapshot()).toMatchObject({ phase: 'recording', canPause: true });
    vi.advanceTimersByTime(250);
    expect(session.pause()).toBe(true);
    expect(recorder.pause).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    const finished = session.finish();
    expect(recorder.stop).toHaveBeenCalledOnce();
    recorder.deliver();
    const result = await finished;
    if (result.status !== 'captured') throw new Error('missing recording');
    expect(result.recording.duration).toBe(250);
    expect(result.recording.file.type).toBe('audio/mp4');
    expect(result.recording.file.name).toMatch(/^voice-message-.*\.m4a$/);
    expect(await result.recording.file.text()).toBe('voice');
    expect(result.recording.waveform).toEqual(Array(48).fill(512));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops a native recorder whose start outlived the recording', async () => {
    const recorder = withoutWebCapture();
    const gate = deferred<NativeRecorder>();
    native.start.mockReturnValue(gate.promise);
    const session = capture();
    const started = session.start();
    expect(session.getSnapshot().phase).toBe('requesting');
    session.reset();
    gate.resolve(recorder);
    expect(await started).toBe(false);
    expect(recorder.stop).toHaveBeenCalledOnce();
    expect(session.getSnapshot().phase).toBe('idle');
  });

  it('ends a native recording at once on reset', async () => {
    const recorder = withoutWebCapture();
    const session = capture();
    await session.start();
    session.reset();
    expect(recorder.stop).toHaveBeenCalledOnce();
    recorder.deliver();
    expect(session.getSnapshot()).toMatchObject({ phase: 'idle', errorMessage: undefined });
  });

  it('keeps the next recording when a timed-out native stop answers late', async () => {
    const first = withoutWebCapture();
    const session = capture();
    await session.start();
    const failed = session.finish();
    vi.advanceTimersByTime(VOICE_RECORDER_STOP_TIMEOUT_MS);
    expect((await failed).status).toBe('failed');
    expect(session.getSnapshot().errorMessage).toBe('No audio data was captured.');
    const second = withoutWebCapture();
    expect(await session.start()).toBe(true);
    first.deliver('old');
    expect(session.getSnapshot().phase).toBe('recording');
    const finished = session.finish();
    second.deliver('new');
    const result = await finished;
    if (result.status !== 'captured') throw new Error('missing recording');
    expect(await result.recording.file.text()).toBe('new');
  });

  it('reports a native recording that ended by itself', async () => {
    const recorder = withoutWebCapture();
    const session = capture();
    await session.start();
    recorder.state = 'inactive';
    recorder.dispatchEvent(new Event('stop'));
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      errorMessage: 'Voice recording stopped unexpectedly. Please record again.',
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shows the microphone message of a failed native start', async () => {
    withoutWebCapture();
    native.start.mockRejectedValue(Object.assign(new Error('native'), { name: 'NotFoundError' }));
    const session = capture();
    expect(await session.start()).toBe(false);
    expect(session.getSnapshot()).toMatchObject({
      phase: 'idle',
      errorMessage: 'No microphone was found on this device.',
    });
  });

  it('keeps the web recorder where the web view has media capture', async () => {
    native.available.mockReturnValue(true);
    const session = capture();
    expect(await session.start()).toBe(true);
    expect(native.start).not.toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledOnce();
  });

  it('is unsupported without media capture and without the plugin', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('MediaRecorder', undefined);
    const session = capture();
    expect(await session.start()).toBe(false);
    expect(session.getSnapshot().errorMessage).toBe(
      'Voice recording is not supported in this browser.'
    );
  });
});
