# Mac Voice Recording Survives a Kill: Implementation Plan

**Goal:** On Mac Catalyst a voice recording is on disk within about a second and survives `kill -9`,
and the web side can list and forget the files a killed app left behind.

**Spec:** `docs/baspowers/specs/2026-11-20-voice-recording-journal-design.md`, section "Mac Catalyst".
The web journal is another branch; nothing here wires orphans into the UI.

**Tech Stack:** Swift (AVFoundation: `AVAudioEngine`, `AVAssetWriter`), TypeScript, vitest.

## Task 1: The plugin writes a fragmented `.m4a` in Application Support

File: `ios/App/App/MindRoomVoiceRecorderPlugin.swift`, its contract test
`src/app/native/nativeVoiceRecorderIOSContract.test.ts`.

- `AVAudioRecorder` writes its `moov` only at stop, so a killed app leaves an unreadable file. A
  small `Recording` class instead taps `AVAudioEngine`'s input node and appends each buffer to an
  `AVAssetWriter` (`.m4a`, AAC mono 16 kHz 32 kbit/s, as before) with `movieFragmentInterval` 1 s.
  Timestamps count the frames written, so a pause (the engine paused) leaves no gap. The level is
  the RMS of the newest buffer.
- Folder: Application Support/`MindRoomVoiceRecorder`/ (the sibling of `MindRoomDiagnostics`; the
  Developer ID build is not sandboxed, so a bare `voice-recorder` would sit among other apps' folders).
- No wipe at load. A page load, a window close and a start over a live recording finish the live
  file and keep it.
- `orphans()` resolves `{recordings: [{id, path, startedAt}]}`: the UUID `.m4a` files that are not
  being written.
- Fallback (linear PCM CAF, AAC at stop) only if the kill test in Task 3 shows the fragmented file
  unreadable.

After three review rounds, the rule the code and its contract test follow (the spec's Mac section):
native code deletes a file only for `forget({id})` (and what a failed start wrote), and never
infers from the page's lifecycle that a file may go; `cancel`, `keep` and the listener tracking are
gone. The lock (`<id>.lock`, an exclusive `flock` owned by one object) means "the writer is not
done": held from the start until `finishWriting` completed or the writer failed, so `orphans()`
(lock first, then `lstat` under it) also lists a stopped recording until JS forgets it, and never
one a window or process still writes. A device change or interruption only asks, from its
notification, for the end on the main queue (tap, engine, then audio session, in one function);
`level`, `pause`, `resume` and `stop` then reject `NOT_RECORDING`. Buffers the writer is not ready
for wait in a queue of 64 that is handed on whenever the writer is ready again (key-value
observation, also during a pause); an overflow or a failed append ends the recording and finishes
what the writer took; times are the exact sum of each buffer's length at its own rate. In JS the
capture session forgets on Discard (unread) and after it built the file for Send; every other way
out keeps the file.

## Task 2: The web side lists and forgets them

File: `src/app/native/nativeVoiceRecorder.ts`, its test.

- `listNativeVoiceOrphans()`: `[]` off the Mac app; else each orphan read as `deliver` reads a file
  (the same helper), as a `File` of type `audio/mp4`, skipping one it cannot read.
- `forgetNativeVoiceRecording(id)`: the plugin's `forget`.
- `NativeVoiceRecorder.forget()`, which `voiceCaptureSession.ts` calls on Discard and after Send's
  file is built.

## Task 3: Prove it on the MacBook M2

As Task 4 of `2026-11-18-mac-native-voice-recorder.md` (M2 on AC power only, worktree of its
`~/repos/mindroom-client`, `npm ci`, `npm run build:ios`, `just watch-sdk --fetch`,
`npx cap sync ios`, `xcodebuild` of `App` and `AppStoreMac`). A debug probe (never committed) in
`MindRoomBridgeViewController.viewDidAppear` starts a recording; after about 10 s the app is killed
with `kill -9 <pid>`. Then: the file is in Application Support, `afinfo` and `ffprobe` report about
10 s, and on relaunch a second probe mode logs `orphans()` listing it and the page reading it.
A microphone prompt that waits for a click: stop and report.

## Task 4: Verify and push

`npx vitest run src/app/native/nativeVoiceRecorder*`, `just typecheck`, `just strict`,
`NODE_OPTIONS=--max-old-space-size=6144 just lint`, the M2 builds; push the branch, no pull request.
