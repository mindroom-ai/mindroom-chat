# Native voice recorder for the Mac app: design

Date: 2026-11-18. Branch: `fix/mac-voice-recording`. Path: architectural (a new native plugin and a
new seam in the capture session).

## Problem

In the Mac app (Mac Catalyst) the record button answers "Voice recording is not supported in this
browser." (`src/app/composer/voice/voiceCaptureSession.ts:319-324`). The Catalyst build of WebKit is
compiled without media capture: `navigator.mediaDevices`, `MediaRecorder`, `MediaStream` and
`RTCPeerConnection` are `undefined` (proven 2026-11-18 on a MacBook M2, macOS 26.5.2; no
preference turns them on). The microphone itself is allowed: `NSMicrophoneUsageDescription`
(`ios/App/App/Info.plist:106`) and the `audio-input` entitlement
(`ios/App/App/App-macOS.entitlements:11`, `App-macOS-AppStore.entitlements:11-13`).

## Goal

Recording a voice message works in the Mac app as it does on iPhone and the web: record, live
waveform, pause and resume, discard, send, a failed send parked with Retry. Bas chose a native
recorder plugin; the button is not hidden as a stopgap.

Success: on the Mac app, record, pause, resume and send produce a voice message that plays on Mac,
iPhone and web with the right length; a denied microphone shows the blocked message; iPhone, iPad,
Android and web run exactly the code they run today.

Said by Bas: native plugin, no stopgap, lean, one pull request. Assumed here: the system default
input device, no new settings, no new strings.

## What the code assumes today

Every assumption about `MediaRecorder` and `MediaStream` lives in one file.

- `voiceCaptureSession.ts` owns the phases, generations, timers and the result
  `CapturedVoiceRecording { file, duration, waveform }`. It touches the browser in these places:
  the support check (`:319`), `getUserMedia` and `new MediaRecorder` (`:334-362`), the
  `dataavailable` and `stop` listeners and `recorder.start(timeslice)` (`:363-374`), the analyser
  (`:238-253`) sampled every 80 ms (`:210-237`, `src/app/lib/audioWaveform.ts:5`), `recorder.state`
  (`:129`, `:390-392`), `pause()` and `resume()` (`:438-468`), `stop()` with a 5 s deadline
  (`:410-416`), and the file built from the chunks with `recorder.mimeType` (`:292-302`).
- The session's elapsed time is its own clock (`:138-140`); the recorder never reports a duration.
- Everything after the session takes a `File`: `voiceSendDraftController.ts:12-17`,
  `savedVoiceDraft.ts:70-77` and `:109` (bytes, name and type into IndexedDB),
  `useVoiceRecorder.ts`, `VoiceRecorderDialog.tsx`. `VoiceRecordingCapsule.tsx:74-79` takes
  `waveform` and `sampleCount`. `voiceCaptureDiagnostics.ts` takes phases. None of them knows
  where the audio came from.
- `voiceRecorderMime.ts:1-8` prefers Ogg Opus, then `audio/mp4`; `:30` names an `audio/mp4` file
  `.m4a`. The Watch sends `audio/mp4` (`ios/Watch/MindRoomWatch/Model/Recorder.swift:105`), and
  `audio/mp4` is a playable type (`src/app/lib/mimeTypes.ts:12`). WebKit's `MediaRecorder` records
  MP4 and WebM but, as far as is known, no Ogg, so iPhone picks `audio/mp4` from this list too
  (not checked on a device here). An AAC `.m4a` is therefore already what Apple devices send.
- A denied microphone becomes `getMicrophoneAccessErrorMessage` (`microphoneAccess.ts:19-51`) by
  the error's `name`. In a native app on platform `ios` the text says "in iPhone settings"
  (`microphoneAccess.ts:12-14`), and the Mac app reports platform `ios`.
- Native plugins are a Swift class registered in
  `MindRoomBridgeViewController.capacitorDidLoad` (`:37-48`), a wrapper in `src/app/native/`, and a
  contract test that reads the Swift source (`src/app/native/native*IOSContract.test.ts`).
  `captureScreenshot` already moves a file from the app's temporary folder to the page with
  `Capacitor.convertFileSrc` and `fetch` (`src/app/native/nativeQuickCapture.ts:71-78`), and
  `MacScreenshot.swift:22-29` clears its folder before each capture.
- The iOS routing test host compiles every file of `ios/App/App/` for plain iOS
  (`scripts/ios-routing-test-project.rb:50-52`), so Mac-only Swift sits inside
  `#if targetEnvironment(macCatalyst)` (`MacScreenshot.swift:3`, checked by
  `macCatalystShell.test.ts:65-70`). Two targets compile these files: `App` and `AppStoreMac`
  (`project.pbxproj:728` and `:771`).
- Quick Capture has its own input without voice (`src/app/quick-capture/CaptureInput.tsx`; only
  `RoomInput.tsx:414` uses `useRoomInputVoice`).

## Approaches

**A. The native recorder behind the session's recorder contract (chosen).** The session keeps a
recorder of a small type: the part of `MediaRecorder` it already drives. A `MediaRecorder` is one
without an adapter; the Mac app's native recorder is a second one, an `EventTarget` that raises
the same two events. `start()` gets one branch for how the recorder is obtained, and the level for
the waveform comes from a function instead of the analyser directly. About 30 changed lines in the
session; the web path keeps its order of operations, which 2,450 lines of tests pin (for example
`useVoiceRecorder.test.ts:577` and `:1337`: no recorder is built after an unmount during
`getUserMedia`).

**B. Both paths behind a `VoiceRecorderBackend` with `start()`.** The web code (stream, analyser,
chunks, the stop deadline) moves into a web backend beside the native one. Symmetric, but it moves
about 120 lines whose exact ordering the tests pin, to change nothing people see, on the platforms
that work today. Rejected for this pull request; the contract type of A is the first step if it is
ever wanted.

**C. Polyfill `navigator.mediaDevices` and `MediaRecorder` on the Mac.** The session stays
untouched, but a fake `MediaStream` cannot feed an `AnalyserNode` (no waveform), and every other
feature check (calls: `src/app/calls/callSupport.ts:6-9`) would believe media capture exists.
Rejected.

A separate native session or hook is rejected too: it would copy the phases, generations and stop
handling.

On the native side `AVAudioRecorder` is chosen (the Watch's `Recorder.swift` is the model). A tap
on `AVAudioEngine` streaming PCM over the bridge would be far more code and traffic for the same
file.

## Design

### The seam: `voiceCaptureSession.ts`

```ts
/** What the session drives: a MediaRecorder, or the Mac app's native recorder. */
type VoiceRecorder = Pick<MediaRecorder, 'state' | 'mimeType' | 'pause' | 'resume' | 'stop'> &
  Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
```

- `Generation.recorder` has this type. `Generation.readLevel?: () => number` returns the level now
  as a Matrix waveform point; `sample()` and `startTimers()` use it instead of the analyser and
  buffer. `setupAnalyser` sets it (the analyser read plus `timeDomainDataToWaveformPoint`),
  `closeAudio` clears it.
- `start()`: `webCapture` is today's check (`getUserMedia` and `MediaRecorder` exist);
  `native = !webCapture && isNativeVoiceRecorderAvailable()`. Neither: today's unsupported
  message. Web capture always wins, so a later WebKit with media capture on the Mac uses the web
  path by itself.
- In the `try`: with `native`, `await startNativeVoiceRecorder()` returns a recorder that is
  already recording; if the generation lost ownership meanwhile, `recorder.stop()` and return
  `false`; else it becomes `generation.recorder`, and `generation.readLevel` is
  `analyserRmsToMatrixPoint(recorder.level())`. Without `native`, today's lines run unchanged. The
  listeners attach as today; `recorder.start(VOICE_RECORDER_TIMESLICE_MS)` runs on the web path
  only.
- Nothing else changes: `finishStop` builds the file from the one chunk the native recorder
  delivers and its `mimeType` (`audio/mp4`, so `.m4a`), `retire` stops a live recorder, the 5 s
  stop deadline covers a native stop that never answers ("No audio data was captured."), the
  session's clock gives the duration.

### The wrapper: `src/app/native/nativeVoiceRecorder.ts`

- `isNativeVoiceRecorderAvailable(): boolean`: a native platform, platform `ios`, and
  `Capacitor.isPluginAvailable('MindRoomVoiceRecorder')` (the shape of
  `isNativeQuickCaptureAvailable`).
- `startNativeVoiceRecorder(): Promise<NativeVoiceRecorder>`: listens for `level`, calls the
  plugin's `start`, which resolves the recording's `{ id }`, and resolves the recorder of that ID.
  A rejection becomes an `Error` whose `name` is the one `getUserMedia` would give: code
  `PERMISSION_DENIED` is `NotAllowedError`, `NO_MICROPHONE` is `NotFoundError`, anything else
  `NotReadableError`.
- `NativeVoiceRecorder extends EventTarget`: `state` (`recording` at first), `mimeType`
  `'audio/mp4'`, `level()` (the newest level, 0 to 1 linear), `pause()`, `resume()`, `stop()`.
  Every plugin call it makes carries its `id`.
- `pause()` and `resume()` set `state` at once and call the plugin, as `MediaRecorder` does. A
  rejection ends the recording unless it has stopped already: `state` becomes `inactive`, the
  recording is cancelled, and `stop` is raised without audio, which the session reports as
  "Voice recording stopped unexpectedly. Please record again." (`voiceCaptureSession.ts:272-284`).
  The session's clock and the native recorder can then never disagree in silence.
- `stop()` sets `state` to `inactive` at once and removes the `level` listener, then: plugin `stop`
  resolves `{ path }`; the file is fetched from `Capacitor.convertFileSrc(path)` with
  `AbortSignal.timeout(5_000)`, the length of the session's stop deadline; a non-empty answer is
  raised as `dataavailable` with `data` (a `Blob`); then, also after any failure, plugin `cancel`
  deletes this recording's file, and `stop` is raised. A second `stop()` does nothing.

Discard takes the same road: the session stops the recorder and drops the chunk. Reading a local
file of at most a few megabytes to drop it costs less than a second stop method.

### The plugin: `ios/App/App/MindRoomVoiceRecorderPlugin.swift`

`jsName` `MindRoomVoiceRecorder`. The whole file is inside
`#if targetEnvironment(macCatalyst)`. All recorder work runs on the main queue (plugin calls arrive
on Capacitor's bridge queue, in order). At most one recording is live; it has an ID (a UUID) and
its own file. Every method but `start` takes `{ id }` and acts only on the recording of that ID.

| Method | Does | Resolves or rejects |
|---|---|---|
| `start` | asks for the microphone, discards a live recording left over, records into a new file | `{ id }`; `PERMISSION_DENIED`, `NO_MICROPHONE`, `START_FAILED` |
| `pause` | `AVAudioRecorder.pause()` | nothing; `NOT_RECORDING` when `id` is not live |
| `resume` | `AVAudioRecorder.record()`; when it answers `false`, discards the recording | nothing; `NOT_RECORDING` |
| `stop` | stops, keeps the file | `{ path }`; `NOT_RECORDING` when `id` is not live |
| `cancel` | stops the recording when `id` is live; deletes the file of `id` | nothing |

Event `level`: `{ level }`, every 80 ms while recording and not paused (12.5 a second, the
session's sample interval): `updateMeters()`, then `pow(10, averagePower(forChannel: 0) / 20)`,
the linear level that `analyserRmsToMatrixPoint` (`audioWaveform.ts:81-84`) takes. An event pushed
one way is cheaper than a call and an answer per sample; the session's own 80 ms timer reads the
newest value, so the live glide of `VoiceWaveform` is unchanged.

- **Permission**: `AVCaptureDevice.requestAccess(for: .audio)`, the macOS call for the microphone;
  it prompts the first time and answers `false` at once when denied or restricted.
  `AVCaptureDevice.default(for: .audio) == nil` is `NO_MICROPHONE` (a Mac mini without one).
- **The page's token**: the plugin counts its pages in `epoch`, which `cancelRecording()` raises
  (a page load, the window closing). `start` reads `epoch` on the main queue before it asks for
  the microphone, and compares it on the main queue when the answer arrives, before the audio
  session is activated: an answer for a page that is gone rejects `START_FAILED` and records
  nothing.
- **Format**: AAC in an `.m4a`, mono, 16 kHz, 32 kbit/s, the Watch's settings
  (`Recorder.swift:36-39`): one proven configuration for every native MindRoom recorder, at the
  bitrate of the web path (`voiceCaptureSession.ts:18`). About 240 KB a minute.
- **Audio session**: as the Watch does (`Recorder.swift:31-33`, `:89`): category `.record`, active
  while recording, inactive after.
- **File**: `voice-recorder/<id>.m4a` in the app's temporary folder. An `id` that is not a UUID
  names no file. `cancel` deletes the file of its `id` only, which the page calls once it has
  fetched it. The whole folder is cleared when the plugin loads (a recording left by a crash or a
  quit) and by `cancelRecording()` (the page that could fetch from it is gone).
- **Transfer**: `convertFileSrc` and `fetch`, as `captureScreenshot` does from the same temporary
  folder: no base64 (a third larger, through the JSON bridge) and no new mechanism.

### Lifetime

- **Another app in front, the window hidden or minimized**: recording goes on; a Mac app is not
  suspended. The session's clock reads the time of day, so slower timers in a hidden page only
  thin the waveform samples.
- **The page reloads or WebKit's process dies**: the plugin observes Capacitor's
  `capacitorWebViewNavigationStarted` for its web view (posted for every real document load,
  `WebViewDelegationHandler.swift:45-49`; a recovery from a crash reloads) and calls
  `cancelRecording()`. The page that held the recording is gone, so nothing is told.
- **The window closes**: `SceneDelegate.sceneDidDisconnect` blanks the page with the navigation
  delegate removed (`SceneDelegate.swift:85`, `QuickCaptureSceneDelegate.swift:262-267`), which
  the observer cannot see, so it calls the bridge's `cancelRecording()` first.
- **Either happens while the microphone prompt is up**: the page's token no longer matches when
  the prompt is answered, so no recorder is made.
- **A stop that outlives the session's 5 s deadline**: the session finishes without audio and may
  start the next recording. The late stop, fetch and cancel of the first carry its ID and its own
  file, so they cannot read, stop or delete the second; its events reach no listener
  (`voiceCaptureSession.ts:259-263`). The fetch gives up after 5 s by itself.
- **The app quits**: the process releases the microphone; the file goes when the plugin next
  loads.
- **The recorder stops by itself** (the input device vanishes): not detected while recording. A
  pause or resume that fails ends the recording with "stopped unexpectedly"; otherwise stop sends
  what the file holds, and an empty or missing file is "No audio data was captured.".
- **Discard during the permission prompt**: the session retires the generation; when `start`
  resolves it stops the recorder, which deletes the file.

### Gate

- Web: the native path is taken only when web capture is missing and the plugin is there.
- Swift: the plugin is registered only inside `#if targetEnvironment(macCatalyst)`, and only on
  the main bridge (not on `QuickCaptureViewController`, which records no voice), so
  `isPluginAvailable` is false on iPhone and iPad and they keep the web path. One bridge means one
  plugin owns the folder.
- The file joins both targets' sources, `App` and `AppStoreMac`.

### The blocked message on the Mac

`getBlockedMicrophoneMessage` gives the iPhone text only when the platform is `ios` and the device
is not a Mac (`isMacOS()` of `src/app/lib/user-agent.ts`). The Mac app then gets the existing
"in your browser or system settings" text, which is true there and already translated.

### Docs

`docs/development.md`, the Mac bullet (`:104`): voice messages record through
`MindRoomVoiceRecorderPlugin` (`src/app/native/nativeVoiceRecorder.ts`) because Mac Catalyst's
WebKit has no media capture, and calls are unavailable there for the same reason.

## Out of scope

- **Calls on the Mac.** `RTCPeerConnection` is missing too. The call panel already explains it
  ("Your browser does not support WebRTC", `src/app/calls/CallPanel.tsx:450-452`). A native call
  stack is a project of its own; whether to hide the call buttons on the Mac is a follow-up.
- iPhone, iPad, Android, the web and the Watch: unchanged.
- An input device picker, a recording length limit, Quick Capture voice.

## Testing

- `nativeVoiceRecorder.test.ts` with a fake plugin: availability; the three error names; level
  events reach `level()`; pause and resume carry the ID; stop raises `dataavailable` then `stop`
  and cancels its ID; a failed stop, a failed or aborted fetch and an empty file raise `stop`
  alone and still cancel; a second stop is ignored; a rejected pause or resume ends the recording,
  and one rejected after the stop changes nothing; recording A stops with a slow fetch, B starts,
  A's fetch settles: only A's ID is stopped and cancelled, B still records and reads levels.
- `voiceCaptureSession.test.ts`: the native path with a fake native recorder (capture to an
  `audio/mp4` `.m4a` file with waveform; pause; discard; a denied start; ownership lost during
  start stops the recorder; web capture present ignores the plugin; a native stop that passes the
  5 s deadline fails, the next recording starts, the first answers late and the second is sent
  whole; a recorder that ends by itself shows "stopped unexpectedly"). Every existing session and
  hook test passes untouched.
- `microphoneAccess.test.ts`: the Mac app gets the system settings text; iPhone keeps its own.
- `nativeVoiceRecorderIOSContract.test.ts`: the plugin's name, methods, event, codes and settings;
  a file per recording ID, a UUID; the page's token read before the permission request, compared
  before the audio session is activated, raised by `cancelRecording()`; `resume` checks
  `record()`; Mac-only body; registration inside the Catalyst block and off the Quick Capture
  bridge; the window-close cancel; both targets compile the file.
- Swift has no unit test host for Mac Catalyst here (the routing host is iOS), so the token and
  the scoping are pinned in source by the contract test and proven at run time on the Mac.
- On the MacBook M2 (never on battery): a Debug Catalyst build of `App` and of `AppStoreMac`, and a
  probe that drives the real plugin through the bridge (start, 3 s, stop, fetch) and prints the
  file, which `afinfo` decodes. A second run of the probe reloads the page while the microphone
  prompt is up: after Allow, no file appears and the microphone indicator stays off. The probe is
  a patch applied to the M2's checkout and not committed. Both runs need a click on the prompt;
  without one the probe reports that it waits on the prompt.
- `scripts/macos-store-preflight.mjs` already requires both microphone entitlements (`:56-67`);
  its tests run unchanged.
- Final manual check on Bas's Mac: Allow, record, pause, resume, send; the message plays on the
  Mac, on iPhone, and in the web client in Chromium and in Firefox; discard; deny and see the
  message; reload while recording and see the microphone indicator go out.

## Size

Product code, tests excluded: about 290 lines. Swift about 145 (plugin 135 with the recording IDs,
the page's token and the checked transitions; registration and the window-close cancel 8; two
project entries). TypeScript about 145 (wrapper 113 with the IDs, the bounded fetch and the failed
transitions; session 30; blocked message 2). Tests about 400. One pull request, four tasks.

## Open questions, with the default taken

1. **The blocked message on the Mac**: the existing "browser or system settings" text (default),
   or a Mac text naming System Settings, Privacy & Security, Microphone, in 17 locales.
2. **Call buttons on the Mac**: left as they are, with the panel's explanation (default), or
   hidden. Follow-up.
3. **A length limit**: none, as on the web (default); the Watch stops at 5 minutes.
4. **Sample rate**: 16 kHz as the Watch (default), or 24 kHz as the web path asks of the browser.
5. **A recorder that stops by itself while recording**: send what was captured (default), or
   detect it and report "stopped unexpectedly" as the web path does.

## To confirm on the Mac

Not run here, checked by the M2 task: `AVAudioRecorder` with these settings and the `.record`
audio session on Mac Catalyst; the microphone prompt from `AVCaptureDevice.requestAccess`, and
that a page reloaded under it records nothing; the fetch of the recording from the temporary
folder in the sandboxed Store build. Playback of the `.m4a` in Chromium and Firefox depends on
their AAC decoders, as it does for iPhone and Watch messages today; the manual check covers it.
