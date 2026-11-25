import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const FORMAT_TOKENS = vi.hoisted(() => ({
  MP4: { format: 'mp4' },
  QTFF: { format: 'qtff' },
  WEBM: { format: 'webm' },
  MATROSKA: { format: 'matroska' },
}));

type MockWriteListener = (event: { start: number; end: number }) => void;
type MockAudioTrack = {
  type: 'audio';
  getCodec: ReturnType<typeof vi.fn<() => Promise<string | null>>>;
};
type MockVideoTrack = {
  type: 'video';
  canDecode: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  getDisplayWidth: ReturnType<typeof vi.fn<() => Promise<number>>>;
  getDisplayHeight: ReturnType<typeof vi.fn<() => Promise<number>>>;
  computePacketStats: ReturnType<
    typeof vi.fn<
      (targetPacketCount?: number) => Promise<{
        packetCount: number;
        averagePacketRate: number;
        averageBitrate: number;
      }>
    >
  >;
};
type MockConversion = {
  isValid: boolean;
  discardedTracks: Array<{ track: unknown; reason: string; trackOptions: unknown }>;
  onProgress?: (progress: number, processedTime: number) => unknown;
  execute: ReturnType<typeof vi.fn<() => Promise<void>>>;
  cancel: ReturnType<typeof vi.fn<() => Promise<void>>>;
};
type MockBufferTarget = {
  buffer: ArrayBuffer | null;
  listeners: Set<MockWriteListener>;
  on: ReturnType<typeof vi.fn<(event: string, listener: MockWriteListener) => () => void>>;
  emitWrite: (start: number, end: number) => void;
};
type MockInput = {
  options: unknown;
  dispose: ReturnType<typeof vi.fn<() => void>>;
};

type MockState = {
  inputs: MockInput[];
  targets: MockBufferTarget[];
  mp4Formats: Array<{ options: unknown }>;
  initCalls: Array<Record<string, unknown>>;
  conversions: MockConversion[];
  nextVideoTrack: MockVideoTrack | null;
  nextAudioTracks: MockAudioTrack[];
  nextDuration: number | null;
  nextIsValid: boolean;
  nextDiscardedTracks: Array<{ track: unknown; reason: string; trackOptions: unknown }>;
  nextOutputBytes: number | null;
  onInit?: (
    options: Record<string, unknown>,
    conversion: MockConversion,
    target: MockBufferTarget
  ) => Promise<void> | void;
  onExecute?: (conversion: MockConversion, target: MockBufferTarget) => Promise<void> | void;
};

const mocks = vi.hoisted(() => {
  const state: MockState = {
    inputs: [],
    targets: [],
    mp4Formats: [],
    initCalls: [],
    conversions: [],
    nextVideoTrack: null,
    nextAudioTracks: [],
    nextDuration: 10,
    nextIsValid: true,
    nextDiscardedTracks: [],
    nextOutputBytes: 500_000,
  };
  return { state };
});

vi.mock('mediabunny', () => {
  class BlobSource {
    constructor(readonly blob: Blob) {}
  }

  class Input {
    readonly dispose = vi.fn<() => void>();
    readonly getPrimaryVideoTrack = vi.fn(async () => mocks.state.nextVideoTrack);
    readonly getAudioTracks = vi.fn(async () => mocks.state.nextAudioTracks);
    readonly getDurationFromMetadata = vi.fn(async () => mocks.state.nextDuration);
    constructor(readonly options: unknown) {
      mocks.state.inputs.push(this);
    }
  }

  class BufferTarget {
    buffer: ArrayBuffer | null = null;
    readonly listeners = new Set<MockWriteListener>();
    readonly on = vi.fn<(event: string, listener: MockWriteListener) => () => void>(
      (event, listener) => {
        if (event === 'write') this.listeners.add(listener);
        return () => this.listeners.delete(listener);
      }
    );
    constructor() {
      mocks.state.targets.push(this);
    }
    emitWrite(start: number, end: number): void {
      for (const listener of [...this.listeners]) listener({ start, end });
    }
  }

  class Mp4OutputFormat {
    constructor(readonly options?: unknown) {
      mocks.state.mp4Formats.push({ options });
    }
  }

  class Output {
    constructor(readonly options: unknown) {}
  }

  class Conversion {
    static async init(options: Record<string, unknown>): Promise<MockConversion> {
      mocks.state.initCalls.push(options);
      const target = (options.output as { options: { target: MockBufferTarget } }).options.target;
      const conversion: MockConversion = {
        isValid: mocks.state.nextIsValid,
        discardedTracks: [...mocks.state.nextDiscardedTracks],
        execute: vi.fn(async () => {
          if (mocks.state.onExecute) {
            await mocks.state.onExecute(conversion, target);
            return;
          }
          if (mocks.state.nextOutputBytes !== null) {
            target.buffer = new ArrayBuffer(mocks.state.nextOutputBytes);
          }
        }),
        cancel: vi.fn(async () => undefined),
      };
      mocks.state.conversions.push(conversion);
      if (mocks.state.onInit) await mocks.state.onInit(options, conversion, target);
      return conversion;
    }
  }

  return {
    ...FORMAT_TOKENS,
    BlobSource,
    BufferTarget,
    Conversion,
    Input,
    Mp4OutputFormat,
    Output,
  };
});

import { compressVideo, type CompressVideoOptions } from './compressVideo';

const ONE_MIB = 1024 * 1024;
const SIXTY_FOUR_MIB = 64 * 1024 * 1024;
const BALANCED: CompressVideoOptions = {
  maxLongEdge: 1920,
  maxFps: 30,
  videoBitrate: 2_500_000,
};

const makeVideoTrack = (
  overrides: {
    canDecode?: boolean;
    displayWidth?: number;
    displayHeight?: number;
    fps?: number;
    packetCount?: number;
    statsError?: Error;
  } = {}
): MockVideoTrack => ({
  type: 'video',
  canDecode: vi.fn(async () => overrides.canDecode ?? true),
  getDisplayWidth: vi.fn(async () => overrides.displayWidth ?? 1920),
  getDisplayHeight: vi.fn(async () => overrides.displayHeight ?? 1080),
  computePacketStats: vi.fn(async () => {
    if (overrides.statsError) throw overrides.statsError;
    return {
      packetCount: overrides.packetCount ?? 120,
      averagePacketRate: overrides.fps ?? 30,
      averageBitrate: 8_000_000,
    };
  }),
});

const makeAudioTrack = (codec: string | null): MockAudioTrack => ({
  type: 'audio',
  getCodec: vi.fn(async () => codec),
});

const makeVideoFile = (
  size = 2 * ONE_MIB,
  name = 'Screen Recording.mov',
  type = 'video/quicktime',
  lastModified = 1_712_345_678_000
): File => {
  const file = new File([new Uint8Array(Math.min(size, 64))], name, { type, lastModified });
  if (size !== file.size) {
    Object.defineProperty(file, 'size', { configurable: true, value: size });
  }
  return file;
};

const defineGlobal = (key: 'VideoEncoder' | 'VideoDecoder', value: unknown) => {
  if (value === undefined) {
    Reflect.deleteProperty(globalThis, key);
  } else {
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
};

describe('compressVideo', () => {
  const origEncoder = Object.getOwnPropertyDescriptor(globalThis, 'VideoEncoder');
  const origDecoder = Object.getOwnPropertyDescriptor(globalThis, 'VideoDecoder');

  beforeEach(() => {
    Object.assign(mocks.state, {
      inputs: [],
      targets: [],
      mp4Formats: [],
      initCalls: [],
      conversions: [],
      nextVideoTrack: makeVideoTrack(),
      nextAudioTracks: [makeAudioTrack('aac')],
      nextDuration: 10,
      nextIsValid: true,
      nextDiscardedTracks: [],
      nextOutputBytes: 500_000,
      onInit: undefined,
      onExecute: undefined,
    });
    defineGlobal('VideoEncoder', class MockVideoEncoder {});
    defineGlobal('VideoDecoder', class MockVideoDecoder {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    if (origEncoder) Object.defineProperty(globalThis, 'VideoEncoder', origEncoder);
    else Reflect.deleteProperty(globalThis, 'VideoEncoder');
    if (origDecoder) Object.defineProperty(globalThis, 'VideoDecoder', origDecoder);
    else Reflect.deleteProperty(globalThis, 'VideoDecoder');
  });

  it('transcodes video to H.264 MP4 with explicit formats, updates extension, and disposes Input', async () => {
    const source = makeVideoFile(2 * ONE_MIB, 'Screen Recording.mov', 'video/quicktime', 1_700_000);

    const result = await compressVideo(source, BALANCED);

    expect(result).toBeDefined();
    expect(result?.file.name).toBe('Screen Recording.mp4');
    expect(result?.file.type).toBe('video/mp4');
    expect(result?.file.lastModified).toBe(1_700_000);
    expect(result?.originalSize).toBe(2 * ONE_MIB);
    expect(result?.compressedSize).toBe(500_000);
    expect(mocks.state.inputs[0]?.options).toEqual({
      formats: [FORMAT_TOKENS.MP4, FORMAT_TOKENS.QTFF, FORMAT_TOKENS.WEBM, FORMAT_TOKENS.MATROSKA],
      source: expect.objectContaining({ blob: source }),
    });
    expect(mocks.state.mp4Formats[0]?.options).toEqual({ fastStart: false });
    expect(mocks.state.initCalls[0]).toMatchObject({
      showWarnings: false,
      video: { codec: 'avc', bitrate: 2_500_000, width: 1920, height: 1080, fit: 'contain' },
    });
    expect(mocks.state.inputs[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it('skips non-videos, missing WebCodecs, pre-aborted signals, and files under 1 MiB unless over maxUploadSize', async () => {
    const aborted = new AbortController();
    aborted.abort();

    expect(
      await compressVideo(makeVideoFile(2 * ONE_MIB, 'photo.png', 'image/png'), BALANCED)
    ).toBeUndefined();
    expect(
      await compressVideo(makeVideoFile(), { ...BALANCED, signal: aborted.signal })
    ).toBeUndefined();
    expect(
      await compressVideo(makeVideoFile(ONE_MIB - 1, 'short.mp4', 'video/mp4'), BALANCED)
    ).toBeUndefined();

    defineGlobal('VideoEncoder', undefined);
    expect(await compressVideo(makeVideoFile(), BALANCED)).toBeUndefined();
    defineGlobal('VideoEncoder', class MockVideoEncoder {});
    defineGlobal('VideoDecoder', undefined);
    expect(await compressVideo(makeVideoFile(), BALANCED)).toBeUndefined();
    expect(mocks.state.inputs).toHaveLength(0);

    defineGlobal('VideoDecoder', class MockVideoDecoder {});
    mocks.state.nextOutputBytes = 400_000;
    const rescued = await compressVideo(makeVideoFile(800_000, 'tiny.webm', 'video/webm'), {
      ...BALANCED,
      maxUploadSize: 500_000,
    });
    expect(rescued?.file.name).toBe('tiny.mp4');
    expect(rescued?.compressedSize).toBe(400_000);
  });

  it('rounds odd screen-recording dimensions to even integers without upscaling', async () => {
    const cases = [
      { inW: 1281, inH: 721, maxLongEdge: 1920, outW: 1282, outH: 722 },
      { inW: 3840, inH: 2160, maxLongEdge: 1920, outW: 1920, outH: 1080 },
      { inW: 1081, inH: 1921, maxLongEdge: 1920, outW: 1080, outH: 1920 },
      { inW: 2561, inH: 1441, maxLongEdge: 1280, outW: 1280, outH: 720 },
      { inW: 800, inH: 600, maxLongEdge: 1920, outW: 800, outH: 600 },
      { inW: 1, inH: 1, maxLongEdge: 1920, outW: 2, outH: 2 },
    ];

    for (const tc of cases) {
      mocks.state.initCalls = [];
      mocks.state.nextVideoTrack = makeVideoTrack({ displayWidth: tc.inW, displayHeight: tc.inH });
      await compressVideo(makeVideoFile(), { ...BALANCED, maxLongEdge: tc.maxLongEdge });
      expect(mocks.state.initCalls[0]?.video).toMatchObject({
        width: tc.outW,
        height: tc.outH,
        fit: 'contain',
      });
    }
  });

  it('caps frameRate only when source fps exceeds maxFps and never upscales lower or unknown fps', async () => {
    mocks.state.nextVideoTrack = makeVideoTrack({ fps: 60 });
    await compressVideo(makeVideoFile(), BALANCED);
    expect((mocks.state.initCalls.at(-1)?.video as Record<string, unknown>).frameRate).toBe(30);

    for (const track of [
      makeVideoTrack({ fps: 15 }),
      makeVideoTrack({ fps: 24 }),
      makeVideoTrack({ fps: 30 }),
      makeVideoTrack({ fps: 30.05 }),
      makeVideoTrack({ fps: Number.POSITIVE_INFINITY, packetCount: 1 }),
      makeVideoTrack({ statsError: new Error('packet stats unavailable') }),
    ]) {
      mocks.state.initCalls = [];
      mocks.state.nextVideoTrack = track;
      await compressVideo(makeVideoFile(), BALANCED);
      expect(
        (mocks.state.initCalls[0]?.video as Record<string, unknown>).frameRate
      ).toBeUndefined();
    }
  });

  it('passes MP4-compatible audio through untouched and transcodes only incompatible audio tracks', async () => {
    for (const codec of ['aac', 'mp3', 'opus']) {
      mocks.state.initCalls = [];
      mocks.state.nextAudioTracks = [makeAudioTrack(codec)];
      await compressVideo(makeVideoFile(), BALANCED);
      expect(mocks.state.initCalls[0]?.audio).toBeUndefined();
    }

    mocks.state.initCalls = [];
    const aacTrack = makeAudioTrack('aac');
    const vorbisTrack = makeAudioTrack('vorbis');
    mocks.state.nextAudioTracks = [aacTrack, vorbisTrack];
    await compressVideo(makeVideoFile(), BALANCED);

    const audioCallback = mocks.state.initCalls[0]?.audio as (
      track: MockAudioTrack
    ) => Record<string, unknown>;
    expect(audioCallback(aacTrack)).toEqual({});
    expect(audioCallback(vorbisTrack)).toEqual({ codec: 'aac' });
  });

  it('cancels and returns undefined when conversion is invalid or an audio or video track is discarded', async () => {
    const audioTrack = makeAudioTrack('vorbis');
    mocks.state.nextAudioTracks = [audioTrack];
    mocks.state.nextDiscardedTracks = [
      { track: audioTrack, reason: 'no_encodable_target_codec', trackOptions: { codec: 'aac' } },
    ];
    expect(await compressVideo(makeVideoFile(), BALANCED)).toBeUndefined();
    expect(mocks.state.conversions.at(-1)?.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.state.conversions.at(-1)?.execute).not.toHaveBeenCalled();

    const videoTrack = makeVideoTrack();
    mocks.state.nextVideoTrack = videoTrack;
    mocks.state.nextAudioTracks = [makeAudioTrack('aac')];
    mocks.state.nextDiscardedTracks = [
      { track: videoTrack, reason: 'no_encodable_target_codec', trackOptions: {} },
    ];
    expect(await compressVideo(makeVideoFile(), BALANCED)).toBeUndefined();
    expect(mocks.state.conversions.at(-1)?.cancel).toHaveBeenCalledTimes(1);

    mocks.state.nextDiscardedTracks = [];
    mocks.state.nextIsValid = false;
    expect(await compressVideo(makeVideoFile(), BALANCED)).toBeUndefined();
    expect(mocks.state.conversions.at(-1)?.cancel).toHaveBeenCalledTimes(1);
  });

  it('serializes concurrent transcodes and immediately skips calls aborted while queued', async () => {
    let activeCount = 0;
    let maxActiveCount = 0;
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    let callIndex = 0;
    mocks.state.onExecute = async (_conversion, target) => {
      const idx = ++callIndex;
      activeCount += 1;
      maxActiveCount = Math.max(maxActiveCount, activeCount);
      events.push(`start-${idx}`);
      if (idx === 1) await firstGate;
      target.buffer = new ArrayBuffer(500_000);
      events.push(`end-${idx}`);
      activeCount -= 1;
    };

    const secondAbort = new AbortController();
    const firstPromise = compressVideo(makeVideoFile(2 * ONE_MIB, 'first.mov'), BALANCED);
    const secondPromise = compressVideo(makeVideoFile(2 * ONE_MIB, 'second.mov'), {
      ...BALANCED,
      signal: secondAbort.signal,
    });
    const thirdPromise = compressVideo(makeVideoFile(2 * ONE_MIB, 'third.mov'), BALANCED);

    await vi.waitFor(() => expect(events).toEqual(['start-1']));

    secondAbort.abort();
    expect(await secondPromise).toBeUndefined();
    expect(events).toEqual(['start-1']);

    releaseFirst();
    const [firstResult, thirdResult] = await Promise.all([firstPromise, thirdPromise]);
    expect(firstResult?.file.name).toBe('first.mp4');
    expect(thirdResult?.file.name).toBe('third.mp4');
    expect(maxActiveCount).toBe(1);
    expect(events).toEqual(['start-1', 'end-1', 'start-2', 'end-2']);
  });

  it('clamps and throttles progress callbacks and always emits final 1 on completion', async () => {
    vi.useFakeTimers();
    const received: number[] = [];

    mocks.state.onExecute = async (conversion, target) => {
      conversion.onProgress?.(-0.25, 0);
      vi.advanceTimersByTime(50);
      conversion.onProgress?.(0.35, 3);
      vi.advanceTimersByTime(60);
      conversion.onProgress?.(0.6, 6);
      vi.advanceTimersByTime(120);
      conversion.onProgress?.(1.4, 10);
      target.buffer = new ArrayBuffer(500_000);
    };

    await compressVideo(makeVideoFile(), { ...BALANCED, onProgress: (p) => received.push(p) });
    expect(received).toEqual([0, 0.6, 1]);

    const shortRun: number[] = [];
    mocks.state.onExecute = async (conversion, target) => {
      conversion.onProgress?.(0.4, 2);
      vi.advanceTimersByTime(20);
      target.buffer = new ArrayBuffer(500_000);
    };
    await compressVideo(makeVideoFile(), { ...BALANCED, onProgress: (p) => shortRun.push(p) });
    expect(shortRun).toEqual([0.4, 1]);
  });

  it('cancels via AbortSignal during init or execute, cleans up listeners, and stays quiet', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const initAbort = new AbortController();
    mocks.state.onInit = () => initAbort.abort();
    expect(
      await compressVideo(makeVideoFile(), { ...BALANCED, signal: initAbort.signal })
    ).toBeUndefined();
    expect(mocks.state.conversions.at(-1)?.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.state.conversions.at(-1)?.execute).not.toHaveBeenCalled();

    mocks.state.onInit = undefined;
    const execAbort = new AbortController();
    const removeSpy = vi.spyOn(execAbort.signal, 'removeEventListener');
    mocks.state.onExecute = async () => {
      execAbort.abort();
      throw new Error('Conversion has been canceled.');
    };

    expect(
      await compressVideo(makeVideoFile(), { ...BALANCED, signal: execAbort.signal })
    ).toBeUndefined();
    expect(mocks.state.conversions.at(-1)?.cancel).toHaveBeenCalledTimes(1);
    expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(mocks.state.inputs.at(-1)?.dispose).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('enforces the 64 MiB output cap before, during, and after conversion', async () => {
    mocks.state.nextDuration = 300;
    expect(await compressVideo(makeVideoFile(100 * ONE_MIB), BALANCED)).toBeUndefined();
    expect(mocks.state.initCalls).toHaveLength(0);
    expect(mocks.state.inputs[0]?.dispose).toHaveBeenCalledTimes(1);

    // Duration-less MediaRecorder WebM relies on incremental fastStart: false writes to enforce the 64 MiB cap live.
    mocks.state.nextDuration = null;
    mocks.state.onExecute = async (_conversion, target) => {
      target.emitWrite(0, SIXTY_FOUR_MIB + 1);
      target.buffer = new ArrayBuffer(500_000);
    };
    expect(
      await compressVideo(makeVideoFile(100 * ONE_MIB, 'recording.webm', 'video/webm'), BALANCED)
    ).toBeUndefined();
    expect(mocks.state.mp4Formats.at(-1)?.options).toEqual({ fastStart: false });
    expect(mocks.state.conversions.at(-1)?.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.state.targets.at(-1)?.listeners.size).toBe(0);

    mocks.state.onExecute = async (_conversion, target) => {
      target.buffer = { byteLength: SIXTY_FOUR_MIB + 1 } as ArrayBuffer;
    };
    expect(
      await compressVideo(makeVideoFile(100 * ONE_MIB), {
        ...BALANCED,
        maxUploadSize: 80 * ONE_MIB,
      })
    ).toBeUndefined();
  });

  it('enforces the 5% savings guard, maxUploadSize override, and extensionless naming', async () => {
    const source = makeVideoFile(2_000_000, 'clip');

    mocks.state.nextOutputBytes = 1_900_000;
    expect(await compressVideo(source, BALANCED)).toBeUndefined();

    mocks.state.nextOutputBytes = 1_960_000;
    expect(await compressVideo(source, BALANCED)).toBeUndefined();

    const rescued = await compressVideo(source, { ...BALANCED, maxUploadSize: 1_980_000 });
    expect(rescued?.file.name).toBe('clip.mp4');
    expect(rescued?.compressedSize).toBe(1_960_000);

    mocks.state.nextOutputBytes = 0;
    expect(await compressVideo(source, BALANCED)).toBeUndefined();
  });

  it('skips undecodable or missing tracks and logs console.warn on unexpected errors', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    mocks.state.nextVideoTrack = null;
    expect(await compressVideo(makeVideoFile(), BALANCED)).toBeUndefined();
    expect(mocks.state.inputs.at(-1)?.dispose).toHaveBeenCalledTimes(1);
    expect(warnSpy).not.toHaveBeenCalled();

    mocks.state.nextVideoTrack = makeVideoTrack({ canDecode: false });
    expect(await compressVideo(makeVideoFile(), BALANCED)).toBeUndefined();
    expect(mocks.state.inputs.at(-1)?.dispose).toHaveBeenCalledTimes(1);

    mocks.state.nextVideoTrack = makeVideoTrack();
    mocks.state.onExecute = async () => {
      throw new Error('VideoEncoder crashed');
    };
    expect(await compressVideo(makeVideoFile(), BALANCED)).toBeUndefined();
    expect(mocks.state.inputs.at(-1)?.dispose).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});
