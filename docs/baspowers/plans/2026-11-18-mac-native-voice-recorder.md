# Mac Native Voice Recorder Implementation Plan

> **Superseded in part.** The spec's "After code review" section replaces parts of Task 1 (the wrapper), Task 3 (the Swift plugin and its contract test) and Task 4 (Step 4, whose probe below is current). Where this plan differs, the code and `nativeVoiceRecorderIOSContract.test.ts` are the reference:
>
> - **Levels** (Tasks 1 and 3): no `level` event, no `addListener` and no 80 ms native timer. The plugin has a method `level({ id })`, which the wrapper's `level()` calls while recording.
> - **Which start records** (Task 3): no `epoch`. The wrapper names each start with a nonce (`window.mindroomVoiceStart`, `start({ nonce })`); the plugin reads it back from the loaded page after the prompt, with a count of the page loads begun, and asks no closed or loading page for the microphone.
> - **A closed window** (Task 3): `SceneDelegate` calls `close()`, not `cancelRecording()`; a page load runs `pageWillLoad()`.
> - **The file read** (Task 1): a non-empty answer with status 0 is the recording. And the audio session (Task 3) records in `.playAndRecord`, not `.record`, so that the page still plays audio afterwards.

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development: Swift and TypeScript tasks meet at a contract, and a mistake in the capture session would break voice messages on iPhone and the web.

**Goal:** Voice messages record in the Mac app, whose WebKit has no media capture, through a native recorder plugin.

**Architecture:** The capture session keeps one recorder of a small type, the part of `MediaRecorder` it already drives. On the Mac app, where `getUserMedia` or `MediaRecorder` is missing and the plugin is there, the recorder is `NativeVoiceRecorder`, an `EventTarget` over the Capacitor plugin `MindRoomVoiceRecorder` (`AVAudioRecorder`, AAC `.m4a`). Each recording has an ID and its own file, and the plugin counts its pages so that an answer for a page that is gone records nothing. The file reaches the page with `Capacitor.convertFileSrc` and `fetch`; levels arrive as a `level` event.

**Tech Stack:** TypeScript, vitest, Capacitor 8.5.2, Swift (AVFoundation), Mac Catalyst.

**Spec:** `docs/baspowers/specs/2026-11-18-mac-native-voice-recorder-design.md`

## Global Constraints

- iPhone, iPad, Android and the web keep the web path: every existing test under `src/app/composer/voice/` passes without edits, except the iPhone case of `microphoneAccess.test.ts` (Task 2).
- No new dependency, no new string, no new setting.
- Names and values: plugin `MindRoomVoiceRecorder`; `start` resolves `{ id }` (a UUID); `pause`, `resume`, `stop`, `cancel` take `{ id }` and act only on that recording; `stop` resolves `{ path }`; event `level` with `{ level }` (0 to 1, linear); codes `PERMISSION_DENIED`, `NO_MICROPHONE`, `START_FAILED`, `NOT_RECORDING`; MIME type `audio/mp4`; AAC, 1 channel, 16_000 Hz, 32_000 bit/s; level interval 0.08 s; file `voice-recorder/<id>.m4a` in the temporary folder; the fetch of the file gives up after 5_000 ms.
- Mac-only Swift sits inside `#if targetEnvironment(macCatalyst)`: the iOS routing test host compiles every file of `ios/App/App/` for iOS.
- Every command runs in `nix develop` (`nix develop -c just ...`); run `nix develop -c just install` once first. Strict flags and type-aware lint cover tests too.
- Commits: `git -c commit.gpgsign=false commit --trailer "Assisted-by: MindRoom DevAgent:<your model id> <https://github.com/mindroom-ai/mindroom>"`, files added by explicit path, no em dashes in docs, comments or commit messages. Never `git stash`. Use `trash`, not `rm`.
- Mac work runs only on the MacBook M2, never on battery; the work MacBook is off limits.

## Review Focus

- Discard while the microphone prompt is still up: the recorder that starts afterwards is stopped, no microphone stays open (Task 2, "stops a native recorder whose start outlived the recording").
- A stop that outlives the session's 5 s deadline, then a new recording: the late stop, fetch and cancel of the first carry its ID and cannot read, stop or delete the second (Task 1, "leaves the next recording alone"; Task 2, "keeps the next recording").
- The window closes or the page reloads while recording, or while the microphone prompt is up: the microphone is released, and the prompt's answer records nothing (Task 3 contract test; Task 4 probe and manual check).
- A pause or resume the native recorder refuses: the recording ends with "stopped unexpectedly" instead of a wrong duration (Task 1, "ends the recording when a native ... fails"; Task 2, "reports a native recording that ended by itself").
- A Mac without a microphone, or a denied one: the existing messages, and system settings instead of "iPhone settings" (Tasks 1 and 2).

---

### Task 1: The web side of the plugin

**Files:**
- Create: `src/app/native/nativeVoiceRecorder.ts`
- Test: `src/app/native/nativeVoiceRecorder.test.ts`

**Interfaces:**
- Produces:

```ts
export const isNativeVoiceRecorderAvailable: () => boolean;
/** Asks for the microphone and starts recording. Rejects with an Error named as getUserMedia names it. */
export const startNativeVoiceRecorder: () => Promise<NativeVoiceRecorder>;
export class NativeVoiceRecorder extends EventTarget {
  state: 'inactive' | 'recording' | 'paused'; // 'recording' at first
  readonly mimeType: 'audio/mp4';
  level(): number; // the newest level event, 0 before the first
  pause(): void;
  resume(): void;
  stop(): void; // raises 'dataavailable' (an Event with `data: Blob`) when there is audio, then 'stop'
}
```

- [ ] **Step 1: Write the failing tests**

```ts
import { Capacitor } from '@capacitor/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isNativeVoiceRecorderAvailable, startNativeVoiceRecorder } from './nativeVoiceRecorder';

const plugin = vi.hoisted(() => ({
  start: vi.fn(), pause: vi.fn(), resume: vi.fn(), stop: vi.fn(), cancel: vi.fn(),
  addListener: vi.fn(), remove: vi.fn(),
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
  const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(response as Response));
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
const audio = (body = 'voice'): Partial<Response> => ({ ok: true, blob: async () => new Blob([body]) });
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
    expect([recorder.state, recorder.mimeType, recorder.level()]).toEqual(['recording', 'audio/mp4', 0]);
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

  it.each(['pause', 'resume'] as const)('ends the recording when a native %s fails', async (method) => {
    plugin[method].mockRejectedValue({ code: 'NOT_RECORDING' });
    const recorder = await startNativeVoiceRecorder();
    const { seen } = watch(recorder);
    recorder[method]();
    await vi.waitFor(() => expect(seen).toEqual(['stop after cancel']));
    expect(recorder.state).toBe('inactive');
    expect(plugin.cancel).toHaveBeenCalledWith({ id: 'a' });
    expect(plugin.remove).toHaveBeenCalledOnce();
    expect(plugin.stop).not.toHaveBeenCalled();
  });

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
    ['the read is given up', () => vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('slow', 'TimeoutError'))))],
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
```

- [ ] **Step 2: Run them and see them fail**

Run: `nix develop -c just test src/app/native/nativeVoiceRecorder.test.ts`
Expected: FAIL, `./nativeVoiceRecorder` cannot be resolved.

- [ ] **Step 3: Implement `src/app/native/nativeVoiceRecorder.ts`**

Follow `nativeQuickCapture.ts`: a plugin type (`start` resolves `{ id: string }`; `pause`, `resume`, `cancel` take `{ id }` and resolve nothing; `stop` takes `{ id }` and resolves `{ path: string }`; `addListener('level', ...)` resolves a `PluginListenerHandle`), registered lazily with `registerPlugin<MindRoomVoiceRecorderPlugin>('MindRoomVoiceRecorder')`. `startNativeVoiceRecorder` adds the `level` listener, then calls `start`; on a rejection it removes the listener and throws `Object.assign(new Error(message), { name })` with the name of the rejection's `code` (`PERMISSION_DENIED` is `NotAllowedError`, `NO_MICROPHONE` is `NotFoundError`, anything else `NotReadableError`). The recorder keeps the `id` and passes it to every plugin call.

One private ending, used by every way out, runs once: remove the `level` listener, call plugin `cancel({ id })` (not awaited), raise `stop`. `pause()` and `resume()` set `state` and call the plugin without awaiting; when the call rejects and `state` is not `inactive`, they set `inactive` and run the ending. `stop()` does nothing when `state` is `inactive`; else it sets `inactive`, then in order: plugin `stop({ id })`, `fetch(Capacitor.convertFileSrc(path), { signal: AbortSignal.timeout(5_000) })`, when `response.ok` and the blob is not empty a `dataavailable` event (`Object.assign(new Event('dataavailable'), { data: blob })`); then, also after any failure, the ending.

- [ ] **Step 4: Run the tests**

Run: `nix develop -c just test src/app/native/nativeVoiceRecorder.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 5: Commit**

`git add src/app/native/nativeVoiceRecorder.ts src/app/native/nativeVoiceRecorder.test.ts`, message `feat(native): web side of the Mac voice recorder plugin`.

---

### Task 2: The session records through it, and the Mac's blocked message

**Files:**
- Modify: `src/app/composer/voice/voiceCaptureSession.ts` (`:1-16` imports, `:85-104` `Generation`, `:147-165` `closeAudio`, `:210-253` sampling and analyser, `:254-258` `finishStop` signature, `:311-388` `start`)
- Modify: `src/app/composer/voice/microphoneAccess.ts:5-17`
- Test: `src/app/composer/voice/voiceCaptureSession.test.ts`, `src/app/composer/voice/microphoneAccess.test.ts`

**Interfaces:**
- Consumes: `isNativeVoiceRecorderAvailable`, `startNativeVoiceRecorder`, `NativeVoiceRecorder` (Task 1); `analyserRmsToMatrixPoint` (`src/app/lib/audioWaveform.ts:81`); `isMacOS` (`src/app/lib/user-agent.ts:23`).
- Produces: no new export. `createVoiceCaptureSession` behaves as before wherever `getUserMedia` and `MediaRecorder` exist.

- [ ] **Step 1: Write the failing session tests**

Add to `voiceCaptureSession.test.ts`, beside the other mocks and helpers:

```ts
const native = vi.hoisted(() => ({ available: vi.fn(() => false), start: vi.fn() }));
vi.mock('../../native/nativeVoiceRecorder', () => ({
  isNativeVoiceRecorderAvailable: native.available,
  startNativeVoiceRecorder: native.start,
}));

class NativeRecorder extends EventTarget {
  state: RecordingState = 'recording';
  mimeType = 'audio/mp4';
  level = () => 0.25;
  pause = vi.fn(() => { this.state = 'paused'; });
  resume = vi.fn(() => { this.state = 'recording'; });
  stop = vi.fn(() => { this.state = 'inactive'; });
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
```

In `beforeEach`: `native.available.mockReset().mockReturnValue(false); native.start.mockReset();`. Then a new `describe('voice capture session on the native recorder', ...)`:

```ts
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

it('discards a native recording', async () => {
  const recorder = withoutWebCapture();
  const session = capture();
  await session.start();
  const discarded = session.discard();
  recorder.deliver();
  expect(await discarded).toBe(false);
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
  expect(session.getSnapshot().errorMessage).toBe('Voice recording is not supported in this browser.');
});
```

- [ ] **Step 2: Write the failing message tests**

In `microphoneAccess.test.ts` add `afterEach(() => vi.unstubAllGlobals())` and

```ts
const device = (userAgent: string, platform: string, maxTouchPoints: number) =>
  vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints });
```

Start the existing iOS case with `device('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 'iPhone', 5);` (Node reports a Mac on a Mac). Add:

```ts
it('sends Mac app users to the system settings, not to iPhone settings', () => {
  vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
  vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
  device('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', 0);
  expect(getMicrophoneAccessErrorMessage({ name: 'NotAllowedError' })).toBe(
    'Microphone access is blocked. Allow microphone access for this site/app in your browser or system settings and try again.'
  );
});
```

- [ ] **Step 3: Run both files and see the new tests fail**

Run: `nix develop -c just test src/app/composer/voice/voiceCaptureSession.test.ts src/app/composer/voice/microphoneAccess.test.ts`
Expected: the nine new tests FAIL (the native ones with "not supported in this browser" or `false`, the Mac one with the iPhone text); the existing ones PASS.

- [ ] **Step 4: Change `voiceCaptureSession.ts`**

- Add the type and use it for `Generation.recorder` and the `recorder` parameter of `finishStop`:

```ts
/** What the session drives: a MediaRecorder, or the Mac app's native recorder. */
type VoiceRecorder = Pick<MediaRecorder, 'state' | 'mimeType' | 'pause' | 'resume' | 'stop'> &
  Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
```

- Add `Generation.readLevel?: () => number` (the level now, as a Matrix waveform point). `sample()` and `startTimers()` test and call `generation.readLevel` where they test and read the analyser and buffer today; `setupAnalyser` assigns it once the buffer exists (`getByteTimeDomainData` then `timeDomainDataToWaveformPoint`); `closeAudio` clears it.
- In `start()`: `const webCapture = !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== 'undefined'; const native = !webCapture && isNativeVoiceRecorderAvailable();`. The unsupported branch runs when neither holds.
- In the `try`, with `native`: `const recorder = await startNativeVoiceRecorder();` then, if `!owns(generation)`, `recorder.stop()` and `return false`; else `generation.recorder = recorder` and `generation.readLevel = () => analyserRmsToMatrixPoint(recorder.level())`. Without `native`, today's lines from `getUserMedia` to `setupAnalyser` run unchanged. The two listeners then attach as today for both (take `event: Event` and read `data` as a `BlobEvent`); `recorder.start(VOICE_RECORDER_TIMESLICE_MS)` runs for the web recorder only; the lines from `generation.startedAt = now()` on are shared.

- [ ] **Step 5: Change `getBlockedMicrophoneMessage`**

The iPhone text is returned when `nativePlatform === 'ios' && !isMacOS()`; the Mac app falls through to the last return.

- [ ] **Step 6: Run the whole voice folder and the type checks**

Run: `nix develop -c just test src/app/composer/voice` then `nix develop -c just typecheck` and `nix develop -c just strict`
Expected: PASS, with `useVoiceRecorder.test.ts` and `VoiceRecorderDialog.test.ts` unedited; 0 type errors.

- [ ] **Step 7: Commit**

`git add` the four files, message `feat(voice): record through the native recorder where the web view has no media capture`.

---

### Task 3: The Swift plugin

**Files:**
- Create: `ios/App/App/MindRoomVoiceRecorderPlugin.swift`
- Modify: `ios/App/App/MindRoomBridgeViewController.swift:42` (after the Quick Capture registration)
- Modify: `ios/App/App/SceneDelegate.swift:85` (before `QuickCapture.stopPage(of: window)`)
- Modify: `ios/App/App.xcodeproj/project.pbxproj` (file reference, group, both Sources phases)
- Modify: `src/app/native/macCatalystShell.test.ts:65-70`, `docs/development.md:104`
- Test: `src/app/native/nativeVoiceRecorderIOSContract.test.ts`

**Interfaces:**
- Consumes: the names and values of Global Constraints; Task 1's wrapper is the caller.
- Produces: `MindRoomVoiceRecorderPlugin` with `func cancelRecording()` (main queue: the page is gone; raises the page's token, stops a live recording, deletes the folder), which `SceneDelegate` calls.

- [ ] **Step 1: Write the failing contract test**

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const pluginSource = read('ios/App/App/MindRoomVoiceRecorderPlugin.swift');
const bridgeSource = read('ios/App/App/MindRoomBridgeViewController.swift');
const sceneSource = read('ios/App/App/SceneDelegate.swift');
const projectSource = read('ios/App/App.xcodeproj/project.pbxproj');
const wrapperSource = read('src/app/native/nativeVoiceRecorder.ts');

describe('MindRoomVoiceRecorderPlugin native contract', () => {
  it('is the plugin the web side registers, with its methods and its level event', () => {
    expect(pluginSource).toContain('public let jsName = "MindRoomVoiceRecorder"');
    expect(wrapperSource).toContain("('MindRoomVoiceRecorder')");
    ['start', 'pause', 'resume', 'stop', 'cancel'].forEach((method) => {
      expect(pluginSource).toContain(
        `CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`
      );
      expect(pluginSource).toContain(`@objc func ${method}(_ call: CAPPluginCall)`);
    });
    expect(pluginSource).toContain('notifyListeners("level", data: ["level": level])');
    expect(pluginSource).toContain('call.resolve(["id": id])');
    expect(pluginSource).toContain('call.resolve(["path": ');
  });

  it('keeps each recording in a file of its own ID, a UUID, and acts only on the ID it is given', () => {
    expect(pluginSource).toContain('"\\(id).m4a"');
    expect(pluginSource).toContain('UUID(uuidString: id)');
    ['pause', 'resume', 'stop'].forEach((method) =>
      expect(pluginSource).toMatch(
        new RegExp(`@objc func ${method}\\(_ call: CAPPluginCall\\) \\{[\\s\\S]*?live\\.id == call\\.getString\\("id"\\)[\\s\\S]*?"NOT_RECORDING"`)
      )
    );
    expect(pluginSource).toMatch(/guard live\.recorder\.record\(\) else \{\s*discardLive\(\)/);
  });

  it('records nothing for a page that went away under the microphone prompt', () => {
    expect(pluginSource).toMatch(
      /let epoch = self\.epoch\s*AVCaptureDevice\.requestAccess\(for: \.audio\)[\s\S]*?DispatchQueue\.main\.async \{[\s\S]*?guard epoch == self\.epoch else[\s\S]*?setActive\(true\)/
    );
    expect(pluginSource).toMatch(/func cancelRecording\(\) \{\s*epoch \+= 1/);
  });

  it('leaves no file and no active audio session behind a start that fails', () => {
    expect(pluginSource).toMatch(
      /attempt\?\.stop\(\)\s*try\? FileManager\.default\.removeItem\(at: url\)[\s\S]*?setActive\(false[\s\S]*?"START_FAILED"/
    );
  });

  it('rejects with the codes the web side names', () => {
    ['PERMISSION_DENIED', 'NO_MICROPHONE', 'START_FAILED', 'NOT_RECORDING'].forEach((code) =>
      expect(pluginSource).toContain(`"${code}"`)
    );
    ['PERMISSION_DENIED', 'NO_MICROPHONE'].forEach((code) => expect(wrapperSource).toContain(code));
  });

  it('asks for the microphone and records mono AAC at 16 kHz and 32 kbit/s, as the Watch does', () => {
    expect(pluginSource).toContain('AVCaptureDevice.requestAccess(for: .audio)');
    expect(pluginSource).toMatch(
      /AVFormatIDKey: kAudioFormatMPEG4AAC,\s*AVSampleRateKey: 16_000,\s*AVNumberOfChannelsKey: 1,\s*AVEncoderBitRateKey: 32_000/
    );
    expect(pluginSource).toContain('withTimeInterval: 0.08');
  });

  it('is on the main bridge of the Mac app only, compiled by both of its targets', () => {
    expect(bridgeSource).toMatch(
      /#if targetEnvironment\(macCatalyst\)\n(?:\s*\/\/.*\n)*\s*if !\(self is QuickCaptureViewController\) \{\n\s*bridge\?\.registerPluginInstance\(MindRoomVoiceRecorderPlugin\(\)\)\n\s*\}\n#endif/
    );
    expect(
      projectSource.match(/MindRoomVoiceRecorderPlugin\.swift in Sources \*\/,/g)
    ).toHaveLength(2);
  });

  it('releases the microphone when its page goes away and forgets a recording left behind', () => {
    expect(pluginSource).toContain('name: .capacitorWebViewNavigationStarted');
    expect(pluginSource).toMatch(/override public func load\(\) \{[\s\S]*?clearFolder\(\)/);
    expect(sceneSource).toMatch(
      /plugin\(withName: "MindRoomVoiceRecorder"\) as\? MindRoomVoiceRecorderPlugin\)\?\.cancelRecording\(\)[\s\S]*QuickCapture\.stopPage\(of: window\)/
    );
  });
});
```

In `macCatalystShell.test.ts`, inside 'keeps AppKit, Carbon and ScreenCaptureKit inside Mac-only blocks', add:

```ts
expect(
  outsideMacOnly(readSource('../../../ios/App/App/MindRoomVoiceRecorderPlugin.swift')).trim()
).toBe('');
```

- [ ] **Step 2: Run and see them fail**

Run: `nix develop -c just test src/app/native/nativeVoiceRecorderIOSContract.test.ts src/app/native/macCatalystShell.test.ts`
Expected: FAIL, `MindRoomVoiceRecorderPlugin.swift` does not exist.

- [ ] **Step 3: Write `MindRoomVoiceRecorderPlugin.swift`**

The whole file sits between `#if targetEnvironment(macCatalyst)` and `#endif` (imports `AVFoundation`, `Capacitor`). The model is `ios/Watch/MindRoomWatch/Model/Recorder.swift`; the shape is `MindRoomQuickCapturePlugin.swift`.

```swift
@objc(MindRoomVoiceRecorderPlugin)
public class MindRoomVoiceRecorderPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MindRoomVoiceRecorderPlugin"
    public let jsName = "MindRoomVoiceRecorder"
    public let pluginMethods: [CAPPluginMethod]   // start, pause, resume, stop, cancel
    private static var folder: URL                // temporaryDirectory/voice-recorder
    private static func clearFolder()
    private static func file(of id: String) -> URL?   // folder/"\(id).m4a"; nil unless UUID(uuidString: id) != nil
    private var live: (id: String, recorder: AVAudioRecorder)?
    private var meter: Timer?
    private var epoch = 0                         // the page this plugin serves; raised when it goes away
    override public func load()                   // clearFolder(); observes page loads
    @objc func start(_ call: CAPPluginCall)
    @objc func pause(_ call: CAPPluginCall)
    @objc func resume(_ call: CAPPluginCall)
    @objc func stop(_ call: CAPPluginCall)
    @objc func cancel(_ call: CAPPluginCall)
    private func discardLive()                    // ends the timer, stops and forgets `live`, deletes its file, deactivates the audio session
    func cancelRecording()                        // epoch += 1; discardLive(); clearFolder()
    @objc private func pageWillLoad()             // cancelRecording()
}
```

- Every method hops to `DispatchQueue.main` before it touches `live`, `meter` or `epoch`.
- `load()`: `NotificationCenter.default.addObserver(self, selector: #selector(pageWillLoad), name: .capacitorWebViewNavigationStarted, object: bridge?.webView)`.
- `start` reads the token before the prompt and compares it after, on the main queue both times:

```swift
DispatchQueue.main.async {
    let epoch = self.epoch
    AVCaptureDevice.requestAccess(for: .audio) { granted in
        DispatchQueue.main.async {
            guard epoch == self.epoch else { return call.reject("The page is gone", "START_FAILED") }
            // granted, a microphone, discardLive(), the audio session, the recorder, the timer
        }
    }
}
```

  After the guard: not granted rejects `PERMISSION_DENIED`; `AVCaptureDevice.default(for: .audio) == nil` rejects `NO_MICROPHONE`; then `discardLive()`, `let id = UUID().uuidString`, the audio session as `Recorder.swift:31-33` (`.record`, `setActive(true)`), the folder created, `AVAudioRecorder(url: file(of: id), settings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 16_000, AVNumberOfChannelsKey: 1, AVEncoderBitRateKey: 32_000])`, `isMeteringEnabled = true`, `record()`. `live` is set only after `record()` answers true, so a failed attempt cleans up from local scope, not through `discardLive()`: keep `let url = file(of: id)` and `var attempt: AVAudioRecorder?` outside the `do`; on a throw or `record()` returning false, `attempt?.stop()`, `try? FileManager.default.removeItem(at: url)`, deactivate the audio session (`Recorder.swift:89`), and reject `START_FAILED`. Else set `live`, start `meter` (`Timer.scheduledTimer(withTimeInterval: 0.08, repeats: true)`, `[weak self]`) and `call.resolve(["id": id])`.
- The timer, only while `live.recorder.isRecording`: `updateMeters()`, `let level = pow(10, recorder.averagePower(forChannel: 0) / 20)`, `notifyListeners("level", data: ["level": level])`.
- `pause`, `resume`, `stop` start with `guard let live = self.live, live.id == call.getString("id") else { return call.reject("No such recording", "NOT_RECORDING") }`.
- `pause`: `live.recorder.pause()`, resolve. `resume`: `guard live.recorder.record() else { discardLive(); return call.reject("Could not resume", "NOT_RECORDING") }`, resolve.
- `stop`: stop the recorder, end the timer, deactivate the audio session (`Recorder.swift:89`), forget `live`, keep the file, `call.resolve(["path": live.recorder.url.path])`.
- `cancel`: when `live?.id` is the call's `id`, `discardLive()`; else delete `file(of: id)` when there is one. Resolve. It never touches another recording's file and never raises `epoch`.

- [ ] **Step 4: Register it, cancel on window close, add it to the project**

`MindRoomBridgeViewController.capacitorDidLoad`, after the Quick Capture plugin's line:

```swift
#if targetEnvironment(macCatalyst)
        // Mac Catalyst's WebKit has no media capture. Only the main window records voice.
        if !(self is QuickCaptureViewController) {
            bridge?.registerPluginInstance(MindRoomVoiceRecorderPlugin())
        }
#endif
```

`SceneDelegate.sceneDidDisconnect`, directly before `QuickCapture.stopPage(of: window)`:

```swift
            // Its recording ends with it: the blank page below loads past the bridge.
            ((window.rootViewController as? CAPBridgeViewController)?.bridge?
                .plugin(withName: "MindRoomVoiceRecorder") as? MindRoomVoiceRecorderPlugin)?.cancelRecording()
```

`project.pbxproj`, copying the six lines of `MacScreenshot.swift` (`:31`, `:55`, `:189`, `:343`, `:743`, `:785`): file reference `5A0000000000000000000001`, build file `5A0000000000000000000002` in the `App` Sources phase (`:728`), build file `5A0000000000000000000003` in the `AppStoreMac` Sources phase (`:771`), and the reference in the group after `MacScreenshot.swift`.

- [ ] **Step 5: Document it**

`docs/development.md`, the **Mac** bullet: one sentence that voice messages record through `MindRoomVoiceRecorderPlugin` (`src/app/native/nativeVoiceRecorder.ts`), because Mac Catalyst's WebKit has no media capture, and that calls are unavailable there for the same reason.

- [ ] **Step 6: Run the native tests**

Run: `nix develop -c just test src/app/native`
Expected: PASS, including `iosSceneLifecycle.test.ts`, `macCatalystShell.test.ts` and `macStorePreflight.test.ts` (the preflight already requires both microphone entitlements, `scripts/macos-store-preflight.mjs:56-67`; it does not change).

- [ ] **Step 7: Commit**

`git add` the seven files by path, message `feat(mac): native voice recorder plugin for Mac Catalyst`.

---

### Task 4: Check and prove it on the MacBook M2

**Files:** none committed, unless the Mac build finds a defect (fix it in the file of Task 3 and commit).

**Interfaces:**
- Consumes: the branch head with Tasks 1 to 3.

- [ ] **Step 1: The full local check**

Run: `nix develop -c just check`
Expected: every recipe passes.

- [ ] **Step 2: Find the M2 on power**

Read `~/repos/MACHINES.md` and the skill `working-across-machines`. Run: `ssh -A -o BatchMode=yes pc.local '~/repos/machines.sh' | tail -15`
Expected: the `basnijholt-macbook-pro-m2` line ends with `on AC power`. `ON BATTERY` or unreachable: stop and report; do not use another Mac.

- [ ] **Step 3: Put the branch on the M2 and build both targets**

Push the branch, then through `ssh -A pc.local 'ssh macbook-m2 ...'` check it out in a worktree of the M2's mindroom-chat checkout and run, in it: `npm ci`, `npm run build:ios`, `just watch-sdk --fetch`, `npx cap sync ios`, then

```bash
xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination 'platform=macOS,variant=Mac Catalyst' -derivedDataPath build/mac-voice \
  CODE_SIGNING_ALLOWED=NO build
```

and the same command with `-scheme AppStoreMac`.
Expected: `** BUILD SUCCEEDED **` twice. A failure counts against this branch unless the same command fails the same way at `origin/main`.

- [ ] **Step 4: Probe the real plugin**

On the M2's worktree only, never committed: insert this block in `MindRoomBridgeViewController.viewDidAppear`, directly before its `#if DEBUG`, and build the `App` scheme again.

```swift
#if DEBUG && targetEnvironment(macCatalyst)
        if let probe = ProcessInfo.processInfo.environment["MINDROOM_VOICE_PROBE"] {
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                let script = """
                const call = (method, options = {}) => window.Capacitor.nativePromise('MindRoomVoiceRecorder', method, options);
                const wait = (ms) => new Promise((done) => setTimeout(done, ms));
                const failed = (error) => `failed ${error.code || error.message || error}`;
                // As startNativeVoiceRecorder: the page names the start, then asks.
                const start = () => {
                  const nonce = `${Date.now()}-${Math.random()}`;
                  window.mindroomVoiceStart = nonce;
                  return Promise.race([
                    call('start', { nonce }),
                    wait(30000).then(() => { throw { code: 'PROMPT_PENDING' }; }),
                  ]);
                };
                try {
                  // A page that still loads is not asked for the microphone.
                  if (document.readyState !== 'complete') await new Promise((done) => addEventListener('load', done));
                  await wait(500);
                  // twice: an older start is still waiting when the newer one asks.
                  const older = mode === 'twice' ? start().then(() => 'recorded', failed) : undefined;
                  const { id } = await start();
                  await wait(1500);
                  const { level } = await call('level', { id });
                  await wait(1500);
                  const { path } = await call('stop', { id });
                  // As NativeVoiceRecorder.deliver reads the file.
                  const response = await fetch(window.Capacitor.convertFileSrc(path), { signal: AbortSignal.timeout(5000) });
                  const size = !response.ok && response.status !== 0 ? 0 : (await response.blob()).size;
                  return `${size > 0 ? 'ok' : 'failed NO_AUDIO'} bytes=${size} status=${response.status} level=${level}`
                    + (older ? ` older=${await older}` : '') + ` path=${path}`;
                } catch (error) {
                  return failed(error);
                }
                """
                self?.webView?.callAsyncJavaScript(script, arguments: ["mode": probe], in: nil, in: .page) { result in
                    NSLog("MindRoom voice probe: %@", String(describing: result))
                }
                // reload: the page reloads while the microphone prompt is up.
                if probe == "reload" {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self?.webView?.reload() }
                }
            }
        }
#endif
```

Run: `open -n --env MINDROOM_VOICE_PROBE=1 --stderr /tmp/voice-probe.log build/mac-voice/Build/Products/Debug-maccatalyst/MindRoom.chat.app`, wait 45 s, `grep 'MindRoom voice probe' /tmp/voice-probe.log` (an empty log: `log show --last 2m --predicate 'eventMessage CONTAINS "MindRoom voice probe"'`), then `afinfo <path>` with the path it printed.
Expected: `ok bytes=` above 2000 with `status=0` or `status=200` (the file read by the wrapper's rule) and a `level=` between 0 and 1, and `afinfo` reports `1 ch,  16000 Hz` AAC with an estimated duration between 2.7 and 3.3 s. This run is the control: the runs below mean nothing until it answers `ok`. Other answers:

| Answer | Meaning | Do |
|---|---|---|
| `failed PROMPT_PENDING` | macOS waits for a click on the microphone prompt | report the probe as blocked on the prompt, not as passed; rerun after Bas clicks Allow on the M2 |
| `failed PERMISSION_DENIED` | denied before | `tccutil reset Microphone chat.mindroom.app`, rerun |
| anything else | a defect | fix in Task 3's file, commit, rebuild |

After every `failed` answer: `ls "$(getconf DARWIN_USER_TEMP_DIR)voice-recorder"` (or the folder of an earlier run's path) shows no `.m4a`, and the next run of the probe, once its cause is removed, answers `ok`: a failed start leaves no file and does not block the next one.

Then two starts under one prompt: stop the probe's app (below), `tccutil reset Microphone chat.mindroom.app`, launch again with `MINDROOM_VOICE_PROBE=twice`, click Allow.
Expected: `ok ... older=failed START_FAILED`: only the newer start records, and it is delivered whole.

Then the page that goes away under the prompt: stop the probe's app, `tccutil reset Microphone chat.mindroom.app`, launch again with `MINDROOM_VOICE_PROBE=reload`. The prompt appears and the page reloads 2 s later. After a click on Allow, wait 5 s: `ls` of the folder of the first run's path.
Expected: no `.m4a` in it, and no microphone indicator in the menu bar. A file there means the start outlived its page: a defect. Without a click on the prompt, report this run as not done, not as passed.

Afterwards: list the probe's app with `pgrep -af '[b]uild/mac-voice/.*/MacOS/'` in one call and `kill <that PID>` in the next (never by name: Bas's own MindRoom may run there; the bracket keeps the remote shell out of the match), `git checkout -- ios/App/App/MindRoomBridgeViewController.swift`, and `git status --short` shows no tracked change.

- [ ] **Step 5: Hand the manual check to Bas**

Report the two builds and the probe's answer verbatim, and this list for Bas's Mac, on a build of the branch: press record and click Allow; the waveform moves; pause and resume; send; the message plays on the Mac, on iPhone, and in the web client in Chromium and in Firefox, with the recorded length; record and discard; with the microphone denied in System Settings the blocked message names system settings; reload the window while recording and the microphone indicator goes out; close the window while recording and it goes out too; when the reload run of Step 4 was not done, press record with the permission reset, reload or close the window under the prompt, click Allow, and the indicator stays off. The pull request's screenshot of the recording capsule on the Mac comes from this check.
