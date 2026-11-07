import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeWav, startSpeechCapture, type SpeechStretch } from './speechCapture';
import { defined } from '../../../test/utils/defined';

type Message = Record<string, unknown>;

/** A Web Audio stand-in: records the worklet it loads, what is connected, and whether it closed. */
class FakeAudioContext {
  static last?: FakeAudioContext;

  currentTime = 10;

  state: AudioContextState = 'running';

  onstatechange: ((event: Event) => void) | null = null;

  /** How often the page asked the context to run. */
  resumes = 0;

  destination = { name: 'speakers' };

  modules: string[] = [];

  failLoading = false;

  source?: { stream: unknown; connectedTo?: unknown; disconnected: boolean };

  closed = false;

  audioWorklet = {
    addModule: (url: string) => {
      this.modules.push(url);
      return this.failLoading ? Promise.reject(new Error('blocked')) : Promise.resolve();
    },
  };

  constructor() {
    FakeAudioContext.last = this;
  }

  createMediaStreamSource(stream: unknown) {
    const source = {
      stream,
      connectedTo: undefined as unknown,
      disconnected: false,
      connect: (node: unknown) => {
        source.connectedTo = node;
      },
      disconnect: () => {
        source.disconnected = true;
      },
    };
    this.source = source;
    return source;
  }

  resume() {
    this.resumes += 1;
    return Promise.resolve();
  }

  close() {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }
}

/** The worklet's node: records what the page tells the worklet, and lets a test answer for it. */
class FakeWorkletNode {
  static last?: FakeWorkletNode;

  told: Message[] = [];

  connectedTo?: unknown;

  disconnected = false;

  port = {
    postMessage: (message: Message) => this.told.push(message),
    onmessage: null as ((event: { data: unknown }) => void) | null,
  };

  constructor(readonly context: FakeAudioContext, readonly name: string, readonly options: object) {
    FakeWorkletNode.last = this;
  }

  connect(destination: unknown) {
    this.connectedTo = destination;
  }

  disconnect() {
    this.disconnected = true;
  }

  /** The worklet posting `data` to the page. */
  answer(data: Message) {
    this.port.onmessage?.({ data });
  }
}

class FakeMediaStream {
  constructor(readonly tracks: unknown[]) {}
}

const TRACK = { kind: 'audio', id: 'microphone' } as unknown as MediaStreamTrack;
const NOW = Date.UTC(2026, 10, 7, 9, 30);

const start = async () => {
  const stretches: SpeechStretch[] = [];
  const capture = await startSpeechCapture(TRACK, (stretch) => stretches.push(stretch));
  const context = defined(FakeAudioContext.last, 'the audio context');
  const node = defined(FakeWorkletNode.last, 'the worklet node');
  return { capture, context, node, stretches };
};

const readBytes = async (blob: Blob) => new DataView(await blob.arrayBuffer());
const text = (view: DataView, offset: number, length: number) =>
  String.fromCharCode(...new Uint8Array(view.buffer, offset, length));

describe('encodeWav', () => {
  it('writes a 16 kHz mono 16-bit PCM WAV file around the samples', async () => {
    const wav = encodeWav(new Int16Array([0, 1, -1, 32767, -32768]));
    expect(wav.type).toBe('audio/wav');
    const view = await readBytes(wav);
    expect(view.byteLength).toBe(44 + 10);
    expect(text(view, 0, 4)).toBe('RIFF');
    expect(view.getUint32(4, true)).toBe(36 + 10);
    expect(text(view, 8, 8)).toBe('WAVEfmt ');
    expect(view.getUint32(16, true)).toBe(16); // the format chunk's size
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000); // samples a second
    expect(view.getUint32(28, true)).toBe(32000); // bytes a second
    expect(view.getUint16(32, true)).toBe(2); // bytes a sample
    expect(view.getUint16(34, true)).toBe(16); // bits a sample
    expect(text(view, 36, 4)).toBe('data');
    expect(view.getUint32(40, true)).toBe(10);
    expect([0, 1, 2, 3, 4].map((index) => view.getInt16(44 + 2 * index, true))).toEqual([
      0, 1, -1, 32767, -32768,
    ]);
  });
});

describe('startSpeechCapture', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.stubGlobal('AudioContext', FakeAudioContext);
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    vi.stubGlobal('MediaStream', FakeMediaStream);
    // The page, where clicks and key presses happen.
    vi.stubGlobal('window', new EventTarget());
    FakeAudioContext.last = undefined;
    FakeWorkletNode.last = undefined;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it('listens to the track through the speech worklet, mixed to one channel', async () => {
    const { context, node } = await start();
    expect(context.modules).toEqual(['/calls/speech-worklet.js?v=development-build']);
    expect(node.name).toBe('speech-finder');
    expect(node.options).toMatchObject({ channelCount: 1, channelCountMode: 'explicit' });
    const source = defined(context.source, 'the microphone source');
    expect(source.stream).toEqual(new FakeMediaStream([TRACK]));
    expect(source.connectedTo).toBe(node);
    expect(node.connectedTo).toBe(context.destination);
  });

  it('hands on each stretch as a WAV file with when it started and how long it is', async () => {
    const { context, node, stretches } = await start();
    context.currentTime = 42.5;
    node.answer({ type: 'stretch', samples: new Int16Array(24000), startTime: 40 });
    const [stretch, ...others] = stretches;
    expect(others).toEqual([]);
    const { wav, startedAt, seconds } = defined(stretch, 'a stretch');
    expect(seconds).toBe(1.5);
    expect(startedAt).toEqual(new Date(NOW - 2500));
    expect(wav.type).toBe('audio/wav');
    expect(wav.size).toBe(44 + 48000);
  });

  it('tells the worklet to pause and resume, and hands on nothing while paused', async () => {
    const { capture, node, stretches } = await start();
    capture.setPaused(true);
    node.answer({ type: 'stretch', samples: new Int16Array(16000), startTime: 9 });
    capture.setPaused(false);
    node.answer({ type: 'stretch', samples: new Int16Array(8000), startTime: 9.5 });
    expect(node.told).toEqual([
      { type: 'pause', paused: true },
      { type: 'pause', paused: false },
    ]);
    expect(stretches.map(({ seconds }) => seconds)).toEqual([0.5]);
  });

  it('on stop, hands on the stretch in progress, then lets go of the microphone', async () => {
    const { capture, context, node, stretches } = await start();
    let stopped = false;
    const stopping = capture.stop().then(() => {
      stopped = true;
    });
    expect(node.told).toEqual([{ type: 'flush' }]);
    node.answer({ type: 'stretch', samples: new Int16Array(16000), startTime: 9 });
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);
    expect(context.closed).toBe(false);

    node.answer({ type: 'flushed' });
    await stopping;
    expect(stretches.map(({ seconds }) => seconds)).toEqual([1]);
    expect(defined(context.source, 'the microphone source').disconnected).toBe(true);
    expect(node.disconnected).toBe(true);
    expect(context.closed).toBe(true);

    node.answer({ type: 'stretch', samples: new Int16Array(16000), startTime: 11 });
    expect(stretches).toHaveLength(1);
    await capture.stop();
    expect(node.told).toEqual([{ type: 'flush' }]);
  });

  it('stops after a second when the worklet does not answer', async () => {
    const { capture, context } = await start();
    let stopped = false;
    void capture.stop().then(() => {
      stopped = true;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(stopped).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(stopped).toBe(true);
    expect(context.closed).toBe(true);
  });

  it('asks a context the browser keeps suspended to run again at each click or key press', async () => {
    /** A context that runs only once the browser allows it (autoplay rules). */
    class SuspendedAudioContext extends FakeAudioContext {
      override state: AudioContextState = 'suspended';

      allowed = false;

      override resume() {
        this.resumes += 1;
        if (this.allowed) this.state = 'running';
        return Promise.resolve();
      }
    }
    vi.stubGlobal('AudioContext', SuspendedAudioContext);
    const { capture, context, node } = await start();
    const suspended = context as SuspendedAudioContext;
    expect(suspended.resumes).toBe(1);

    window.dispatchEvent(new Event('keydown'));
    expect(suspended.resumes).toBe(2);
    expect(suspended.state).toBe('suspended');

    suspended.allowed = true;
    window.dispatchEvent(new Event('pointerdown'));
    expect(suspended.state).toBe('running');
    // Running, it is left alone.
    window.dispatchEvent(new Event('click'));
    expect(suspended.resumes).toBe(3);

    // Suspended later (a phone call on the device), it asks again at once.
    suspended.state = 'suspended';
    suspended.onstatechange?.(new Event('statechange'));
    expect(suspended.resumes).toBe(4);
    expect(suspended.state).toBe('running');

    const stopping = capture.stop();
    node.answer({ type: 'flushed' });
    await stopping;
    suspended.state = 'suspended';
    window.dispatchEvent(new Event('click'));
    expect(suspended.resumes).toBe(4);
  });

  it('closes the audio context when the worklet cannot load', async () => {
    const failing = class extends FakeAudioContext {
      override failLoading = true;
    };
    vi.stubGlobal('AudioContext', failing);
    await expect(startSpeechCapture(TRACK, () => undefined)).rejects.toThrow('blocked');
    expect(defined(FakeAudioContext.last, 'the audio context').closed).toBe(true);
    expect(FakeWorkletNode.last).toBeUndefined();
  });
});
