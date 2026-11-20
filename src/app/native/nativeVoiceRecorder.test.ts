import { Capacitor } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  forgetNativeVoiceRecording,
  isNativeVoiceRecorderAvailable,
  listNativeVoiceOrphans,
  startNativeVoiceRecorder,
} from './nativeVoiceRecorder';

const plugin = vi.hoisted(() => ({
  start: vi.fn(),
  pause: vi.fn(),
  resume: vi.fn(),
  stop: vi.fn(),
  forget: vi.fn(),
  level: vi.fn(),
  orphans: vi.fn(),
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
  recorder.addEventListener('stop', () => seen.push('stop'));
  return { seen, chunks };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
  [plugin.pause, plugin.resume, plugin.forget].forEach((method) =>
    method.mockResolvedValue(undefined)
  );
  plugin.start.mockResolvedValue({ id: 'a' });
  plugin.stop.mockResolvedValue({ path: PATH });
  plugin.level.mockResolvedValue({ level: 0.25 });
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
  ])('names a %s start failure %s', async (code, name) => {
    plugin.start.mockRejectedValue({ code, message: 'native' });
    await expect(startNativeVoiceRecorder()).rejects.toMatchObject({ name });
  });

  it('records on the start after a failed one', async () => {
    plugin.start.mockRejectedValueOnce({ code: 'START_FAILED' });
    await expect(startNativeVoiceRecorder()).rejects.toMatchObject({ name: 'NotReadableError' });
    const recorder = await startNativeVoiceRecorder();
    expect(recorder.state).toBe('recording');
  });

  it('names each start on the page before it asks, so that the newest one is the one named', async () => {
    const page = globalThis as { mindroomVoiceStart?: string };
    const asked: [unknown, unknown][] = [];
    plugin.start.mockImplementation(async (options: { nonce: string }) => {
      asked.push([options.nonce, page.mindroomVoiceStart]);
      return { id: 'a' };
    });
    await startNativeVoiceRecorder();
    await startNativeVoiceRecorder();
    const [[older, olderOnPage], [newer, newerOnPage]] = asked as [
      [string, string],
      [string, string]
    ];
    expect([olderOnPage, newerOnPage]).toEqual([older, newer]);
    expect(older).not.toBe(newer);
    expect(newer).toMatch(/^[0-9a-f-]{36}$/);
    expect(page.mindroomVoiceStart).toBe(newer);
  });

  it('starts recording audio/mp4 and reads the newest level', async () => {
    const recorder = await startNativeVoiceRecorder();
    expect([recorder.state, recorder.mimeType, recorder.level()]).toEqual([
      'recording',
      'audio/mp4',
      0,
    ]);
    expect(plugin.level.mock.calls).toEqual([[{ id: 'a' }]]);
    await vi.waitFor(() => expect(recorder.level()).toBe(0.25));
  });

  it('asks for no level while paused', async () => {
    const recorder = await startNativeVoiceRecorder();
    recorder.pause();
    expect(recorder.level()).toBe(0);
    expect(plugin.level).not.toHaveBeenCalled();
  });

  it('ends a recording that ended by itself and keeps its file', async () => {
    // The native calls reject NOT_RECORDING once its device changed or its file could not be
    // written.
    plugin.level.mockRejectedValue({ code: 'NOT_RECORDING' });
    plugin.stop.mockRejectedValue({ code: 'NOT_RECORDING' });
    const recorder = await startNativeVoiceRecorder();
    const { seen } = watch(recorder);
    expect(recorder.level()).toBe(0);
    await vi.waitFor(() => expect(seen).toEqual(['stop']));
    expect(recorder.state).toBe('inactive');
    expect(plugin.forget).not.toHaveBeenCalled();
  });

  it('keeps the last level and goes on when a level is not answered', async () => {
    const recorder = await startNativeVoiceRecorder();
    const { seen } = watch(recorder);
    recorder.level();
    await vi.waitFor(() => expect(recorder.level()).toBe(0.25));
    plugin.level.mockRejectedValue(new Error('bridge'));
    recorder.level();
    await Promise.resolve();
    await Promise.resolve();
    expect([recorder.state, recorder.level(), seen]).toEqual(['recording', 0.25, []]);
    expect(plugin.stop).not.toHaveBeenCalled();
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
    'stops the recording, keeping its file, when a native %s fails',
    async (method) => {
      stubFetch(audio());
      plugin[method].mockRejectedValue({ code: 'NOT_RECORDING' });
      const recorder = await startNativeVoiceRecorder();
      const { seen } = watch(recorder);
      recorder[method]();
      // What still records natively ends, and its audio is delivered.
      await vi.waitFor(() => expect(seen).toEqual(['dataavailable', 'stop']));
      expect(recorder.state).toBe('inactive');
      expect(plugin.stop.mock.calls).toEqual([[{ id: 'a' }]]);
      expect(plugin.forget).not.toHaveBeenCalled();
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
    await vi.waitFor(() => expect(seen).toEqual(['dataavailable', 'stop']));
    pausing.reject({ code: 'NOT_RECORDING' });
    await vi.waitFor(() => expect(plugin.pause).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(seen).toHaveLength(2);
    expect(plugin.stop).toHaveBeenCalledOnce();
  });

  it('delivers the recording, then reports the stop, and deletes nothing by itself', async () => {
    const fetchMock = stubFetch(audio());
    const recorder = await startNativeVoiceRecorder();
    const { seen, chunks } = watch(recorder);
    recorder.stop();
    expect(recorder.state).toBe('inactive');
    recorder.stop();
    await vi.waitFor(() => expect(seen).toEqual(['dataavailable', 'stop']));
    expect(plugin.stop.mock.calls).toEqual([[{ id: 'a' }]]);
    expect(plugin.forget).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(`capacitor://localhost/_capacitor_file_${PATH}`, {
      signal: expect.any(AbortSignal),
    });
    expect(await chunks[0]!.text()).toBe('voice');
  });

  it('delivers a local file that WebKit answers with status 0', async () => {
    stubFetch({ ...audio(), ok: false, status: 0 });
    const recorder = await startNativeVoiceRecorder();
    const { seen, chunks } = watch(recorder);
    recorder.stop();
    await vi.waitFor(() => expect(seen).toEqual(['dataavailable', 'stop']));
    expect(await chunks[0]!.text()).toBe('voice');
  });

  it('deletes the file only when it is told to forget, and reports a failed delete', async () => {
    stubFetch(audio());
    const recorder = await startNativeVoiceRecorder();
    const { seen } = watch(recorder);
    recorder.stop();
    await vi.waitFor(() => expect(seen).toEqual(['dataavailable', 'stop']));
    await recorder.forget();
    expect(plugin.forget.mock.calls).toEqual([[{ id: 'a' }]]);
    plugin.forget.mockRejectedValue({ code: 'DELETE_FAILED' });
    await expect(recorder.forget()).rejects.toMatchObject({ code: 'DELETE_FAILED' });
  });

  it('forgets a live recording without stopping or reading it, and raises no event', async () => {
    const fetchMock = stubFetch(audio());
    const recorder = await startNativeVoiceRecorder();
    const { seen } = watch(recorder);
    await recorder.forget();
    expect(recorder.state).toBe('inactive');
    expect(plugin.forget.mock.calls).toEqual([[{ id: 'a' }]]);
    recorder.stop();
    recorder.level();
    expect(plugin.stop).not.toHaveBeenCalled();
    expect(plugin.level).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });

  it('leaves the next recording alone when a slow stop settles late', async () => {
    const reading = deferred<Response>();
    stubFetch(reading.promise);
    const first = await startNativeVoiceRecorder();
    first.stop();
    plugin.start.mockResolvedValue({ id: 'b' });
    const second = await startNativeVoiceRecorder();
    const { seen } = watch(first);
    reading.resolve(audio() as Response);
    await vi.waitFor(() => expect(seen).toEqual(['dataavailable', 'stop']));
    expect(plugin.stop.mock.calls).toEqual([[{ id: 'a' }]]);
    expect(plugin.forget).not.toHaveBeenCalled();
    expect(second.state).toBe('recording');
    second.level();
    expect(plugin.level.mock.calls).toEqual([[{ id: 'b' }]]);
  });

  it.each([
    ['the native stop fails', () => plugin.stop.mockRejectedValue({ code: 'NOT_RECORDING' })],
    ['the file lost audio', () => plugin.stop.mockRejectedValue({ code: 'INCOMPLETE' })],
    ['the file cannot be read', () => stubFetch({ ok: false, status: 404 })],
    ['a status 0 answer is empty', () => stubFetch({ ...audio(''), ok: false, status: 0 })],
    [
      'the read is given up',
      () =>
        vi.stubGlobal(
          'fetch',
          vi.fn(() => Promise.reject(new DOMException('slow', 'TimeoutError')))
        ),
    ],
    ['the file is empty', () => stubFetch(audio(''))],
  ])('reports a stop without audio and keeps the file when %s', async (_name, fail) => {
    stubFetch(audio());
    fail();
    const recorder = await startNativeVoiceRecorder();
    const { seen } = watch(recorder);
    recorder.stop();
    await vi.waitFor(() => expect(seen).toEqual(['stop']));
    expect(plugin.forget).not.toHaveBeenCalled();
  });
});

describe('native voice orphans', () => {
  const recording = (id: string, startedAt: number) => ({
    id,
    path: `/support/MindRoomVoiceRecorder/${id}.m4a`,
    startedAt,
  });

  it('lists the recordings left on disk oldest first, as audio/mp4 files', async () => {
    plugin.orphans.mockResolvedValue({
      recordings: [recording('new', 20), recording('old', 10), recording('gone', 5)],
    });
    const fetchMock = vi.fn((url: string) =>
      url.endsWith('gone.m4a')
        ? Promise.resolve({ ok: false, status: 404 } as Response)
        : Promise.resolve({ ...audio(url.includes('new') ? 'later' : 'earlier') } as Response)
    );
    vi.stubGlobal('fetch', fetchMock);
    const orphans = await listNativeVoiceOrphans();
    expect(orphans.map(({ id, startedAt }) => [id, startedAt])).toEqual([
      ['old', 10],
      ['new', 20],
    ]);
    expect(orphans.map(({ file }) => [file.name, file.type])).toEqual([
      ['old.m4a', 'audio/mp4'],
      ['new.m4a', 'audio/mp4'],
    ]);
    expect(await orphans[0]!.file.text()).toBe('earlier');
    expect(fetchMock).toHaveBeenCalledWith(
      'capacitor://localhost/_capacitor_file_/support/MindRoomVoiceRecorder/old.m4a',
      { signal: expect.any(AbortSignal) }
    );
    // Listing deletes nothing.
    expect(plugin.forget).not.toHaveBeenCalled();
  });

  it.each([
    ['empty', () => stubFetch(audio(''))],
    [
      'unread',
      () =>
        vi.stubGlobal(
          'fetch',
          vi.fn(() => Promise.reject(new TypeError('gone')))
        ),
    ],
  ])('leaves out a recording whose file is %s', async (_name, fail) => {
    plugin.orphans.mockResolvedValue({ recordings: [recording('a', 1)] });
    fail();
    expect(await listNativeVoiceOrphans()).toEqual([]);
  });

  it('lists none off the Mac app', async () => {
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValueOnce(false);
    expect(await listNativeVoiceOrphans()).toEqual([]);
    expect(plugin.orphans).not.toHaveBeenCalled();
  });

  it('forgets a recording by deleting its file natively', async () => {
    await forgetNativeVoiceRecording('old');
    expect(plugin.forget.mock.calls).toEqual([[{ id: 'old' }]]);
  });
});
