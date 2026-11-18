import { Capacitor } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isNativeVoiceRecorderAvailable, startNativeVoiceRecorder } from './nativeVoiceRecorder';

const plugin = vi.hoisted(() => ({
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  cancel: vi.fn(),
  addListener: vi.fn(),
  remove: vi.fn(),
}));
vi.mock('@capacitor/core', () => ({
  Capacitor: {
    getPlatform: vi.fn(() => 'ios'),
    isNativePlatform: vi.fn(() => true),
    isPluginAvailable: vi.fn(() => true),
    convertFileSrc: vi.fn((path: string) => `capacitor://localhost/_capacitor_file_${path}`),
  },
  registerPlugin: vi.fn(() => plugin),
}));

const PATH = '/tmp/voice-recorder/a.m4a';
let emitLevel: (data: { level: number }) => void;
const stubFetch = (response: Partial<Response> | Promise<Response>) => {
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) =>
    Promise.resolve(response as Response)
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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
const audio = (body = 'voice'): Partial<Response> => ({
  ok: true,
  blob: async () => new Blob([body]),
});
const watch = (recorder: EventTarget) => {
  const seen: string[] = [];
  const chunks: Blob[] = [];
  recorder.addEventListener('dataavailable', (event) => {
    seen.push('dataavailable');
    chunks.push((event as BlobEvent).data);
  });
  recorder.addEventListener('stop', () =>
    seen.push(plugin.cancel.mock.calls.length > 0 ? 'stop after cancel' : 'stop')
  );
  return { seen, chunks };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  [plugin.pause, plugin.resume, plugin.cancel, plugin.remove].forEach((method) =>
    method.mockResolvedValue(undefined)
  );
  plugin.start.mockResolvedValue({ id: 'a' });
  plugin.stop.mockResolvedValue({ path: PATH });
  plugin.addListener.mockImplementation(async (_event: string, listener: typeof emitLevel) => {
    emitLevel = listener;
    return { remove: plugin.remove };
  });
});

describe('native voice recorder', () => {
  it('is available only on a native iOS platform with the plugin', () => {
    expect(isNativeVoiceRecorderAvailable()).toBe(true);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValueOnce(false);
    expect(isNativeVoiceRecorderAvailable()).toBe(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValueOnce('android');
    expect(isNativeVoiceRecorderAvailable()).toBe(false);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValueOnce(false);
    expect(isNativeVoiceRecorderAvailable()).toBe(false);
    expect(Capacitor.isPluginAvailable).toHaveBeenCalledWith('MindRoomVoiceRecorder');
  });

  it.each([
    ['PERMISSION_DENIED', 'NotAllowedError'],
    ['NO_MICROPHONE', 'NotFoundError'],
    ['START_FAILED', 'NotReadableError'],
  ])('names a %s start failure %s and stops listening', async (code, name) => {
    plugin.start.mockRejectedValue({ code, message: 'native' });
    await expect(startNativeVoiceRecorder()).rejects.toMatchObject({ name });
    expect(plugin.remove).toHaveBeenCalledOnce();
  });

  it('records on the start after a failed one', async () => {
    plugin.start.mockRejectedValueOnce({ code: 'START_FAILED' });
    await expect(startNativeVoiceRecorder()).rejects.toMatchObject({ name: 'NotReadableError' });
    const recorder = await startNativeVoiceRecorder();
    expect(recorder.state).toBe('recording');
    expect(plugin.remove).toHaveBeenCalledOnce();
    emitLevel({ level: 0.5 });
    expect(recorder.level()).toBe(0.5);
  });

  it('starts recording audio/mp4 and reads the newest level', async () => {
    const recorder = await startNativeVoiceRecorder();
    expect(plugin.addListener).toHaveBeenCalledWith('level', expect.any(Function));
    expect([recorder.state, recorder.mimeType, recorder.level()]).toEqual([
      'recording',
      'audio/mp4',
      0,
    ]);
    emitLevel({ level: 0.25 });
    expect(recorder.level()).toBe(0.25);
  });

  it('pauses and resumes at once', async () => {
    const recorder = await startNativeVoiceRecorder();
    recorder.pause();
    expect(recorder.state).toBe('paused');
    expect(plugin.pause).toHaveBeenCalledWith({ id: 'a' });
    recorder.resume();
    expect(recorder.state).toBe('recording');
    expect(plugin.resume).toHaveBeenCalledWith({ id: 'a' });
  });

  it.each(['pause', 'resume'] as const)(
    'ends the recording when a native %s fails',
    async (method) => {
      plugin[method].mockRejectedValue({ code: 'NOT_RECORDING' });
      const recorder = await startNativeVoiceRecorder();
      const { seen } = watch(recorder);
      recorder[method]();
      await vi.waitFor(() => expect(seen).toEqual(['stop after cancel']));
      expect(recorder.state).toBe('inactive');
      expect(plugin.cancel).toHaveBeenCalledWith({ id: 'a' });
      expect(plugin.remove).toHaveBeenCalledOnce();
      expect(plugin.stop).not.toHaveBeenCalled();
    }
  );

  it('changes nothing when a transition fails after the stop', async () => {
    stubFetch(audio());
    const pausing = deferred<void>();
    plugin.pause.mockReturnValue(pausing.promise);
    const recorder = await startNativeVoiceRecorder();
    const { seen } = watch(recorder);
    recorder.pause();
    recorder.stop();
    await vi.waitFor(() => expect(seen).toEqual(['dataavailable', 'stop after cancel']));
    pausing.reject({ code: 'NOT_RECORDING' });
    await vi.waitFor(() => expect(plugin.pause).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(seen).toHaveLength(2);
    expect(plugin.cancel).toHaveBeenCalledOnce();
  });

  it('delivers the recording, deletes it, then reports the stop', async () => {
    const fetchMock = stubFetch(audio());
    const recorder = await startNativeVoiceRecorder();
    const { seen, chunks } = watch(recorder);
    recorder.stop();
    expect(recorder.state).toBe('inactive');
    recorder.stop();
    await vi.waitFor(() => expect(seen).toEqual(['dataavailable', 'stop after cancel']));
    expect(plugin.stop.mock.calls).toEqual([[{ id: 'a' }]]);
    expect(plugin.cancel.mock.calls).toEqual([[{ id: 'a' }]]);
    expect(plugin.remove).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(`capacitor://localhost/_capacitor_file_${PATH}`, {
      signal: expect.any(AbortSignal),
    });
    expect(await chunks[0]!.text()).toBe('voice');
  });

  it('leaves the next recording alone when a slow stop settles late', async () => {
    const reading = deferred<Response>();
    stubFetch(reading.promise);
    const first = await startNativeVoiceRecorder();
    first.stop();
    plugin.start.mockResolvedValue({ id: 'b' });
    const second = await startNativeVoiceRecorder();
    reading.resolve(audio() as Response);
    await vi.waitFor(() => expect(plugin.cancel).toHaveBeenCalledOnce());
    expect(plugin.stop.mock.calls).toEqual([[{ id: 'a' }]]);
    expect(plugin.cancel.mock.calls).toEqual([[{ id: 'a' }]]);
    expect(plugin.remove).toHaveBeenCalledOnce();
    expect(second.state).toBe('recording');
    emitLevel({ level: 0.5 });
    expect(second.level()).toBe(0.5);
  });

  it.each([
    ['the native stop fails', () => plugin.stop.mockRejectedValue({ code: 'NOT_RECORDING' })],
    ['the file cannot be read', () => stubFetch({ ok: false })],
    [
      'the read is given up',
      () =>
        vi.stubGlobal(
          'fetch',
          vi.fn(() => Promise.reject(new DOMException('slow', 'TimeoutError')))
        ),
    ],
    ['the file is empty', () => stubFetch(audio(''))],
  ])('reports a stop without audio when %s', async (_name, fail) => {
    stubFetch(audio());
    fail();
    const recorder = await startNativeVoiceRecorder();
    const { seen } = watch(recorder);
    recorder.stop();
    await vi.waitFor(() => expect(seen).toEqual(['stop after cancel']));
    expect(plugin.cancel.mock.calls).toEqual([[{ id: 'a' }]]);
  });
});
