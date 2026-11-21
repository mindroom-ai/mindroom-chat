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

After the review rounds, the rule the code follows (the spec's Mac section): native code deletes a
file only for `forget({id})` (and what a failed start wrote), and never infers from the page's
lifecycle that a file may go; `cancel`, `keep` and the listener tracking are gone. The lock
(`<id>.lock`, an exclusive `flock` owned by one object, holding the account that records) means
"the writer is not done": held from the start until `finishWriting` completed or the writer failed,
so `orphans()` (an existing lock first, then `lstat` under it) also lists a stopped recording until
JS forgets it, and never one a window or process still writes. The tap converts every buffer to
16 kHz mono, whatever the device delivers; a changed device (headphones that take over the
microphone) is tapped anew in its hardware format, once more after 250 ms when it has none yet, and
the engine started again unless the page paused it. An interruption, a device that cannot be
tapped, a failed append and more than 5 s of audio the writer did not take end the recording and
finish what the writer took; `level`, `pause` and `resume` then reject `NOT_RECORDING`, and `stop`
still answers the file. The tap and the level never wait for the writer's queue: buffers wait
under a small lock and go on whenever the writer is ready (key-value observation, also during a
pause), and a stop is answered after 3 s at the latest, `incomplete`. In JS a recording that ended
by itself shows as paused and can be sent; Discard forgets (unread); a sent recording is forgotten
once the server has it, a failed send once its copy is stored. What the plugin does is probed on a
Mac (`docs/mac-voice-probe/`); the contract test keeps the bridge's shape and these rules.

## Task 2: The web side lists and forgets them

File: `src/app/native/nativeVoiceRecorder.ts`, its test.

- `listNativeVoiceOrphans()`: `[]` off the Mac app; else each orphan read as `deliver` reads a file
  (the same helper), as a `File` of type `audio/mp4`, skipping one it cannot read.
- `forgetNativeVoiceRecording(id)`: the plugin's `forget`.
- `NativeVoiceRecorder.forget()`, which `voiceCaptureSession.ts` calls on Discard, and after a
  send through the recording's `forgetSource`.

## Task 3: Prove it on the MacBook M2

As Task 4 of `2026-11-18-mac-native-voice-recorder.md` (M2 on AC power only, worktree of its
`~/repos/mindroom-client`, `npm ci`, `npm run build:ios`, `just watch-sdk --fetch`,
`npx cap sync ios`, `xcodebuild` of `App` and `AppStoreMac`). The probe is
`docs/mac-voice-probe/` (its README): debug hooks that are never committed, and a script that runs
each case, the `kill -9` among them, and decodes the file it leaves.
A microphone prompt that waits for a click: stop and report.

## Task 4: Verify and push

`npx vitest run src/app/native/nativeVoiceRecorder*`, `just typecheck`, `just strict`,
`NODE_OPTIONS=--max-old-space-size=6144 just lint`, the M2 builds; push the branch, no pull request.
