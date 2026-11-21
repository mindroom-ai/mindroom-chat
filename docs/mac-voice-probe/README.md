# Mac voice recorder: the behaviour probe

What `ios/App/App/MindRoomVoiceRecorderPlugin.swift` does can only be checked on a Mac: the unit
tests read its source (`src/app/native/nativeVoiceRecorderIOSContract.test.ts`), they do not run
it. This probe runs the real plugin in a debug build and checks the files it leaves. Run it after
any change to the plugin.

- `patch.py` adds debug hooks to a checkout: a script in the page that drives the plugin as
  `nativeVoiceRecorder.ts` does, and switches in the plugin that stand in for what a test Mac
  cannot do (a tone for the microphone, a changed device, a writer that hangs). The hooks are
  never committed and never built into a release.
- `run.sh` starts that build once per case and prints, for each, what to expect, the app's log
  and the file's format, length and tone.

## Run it

On a Mac on mains power, in a worktree of this repository (not the one you work in):

1. Build the web part and the native projects once: `npm ci`, `npm run build:ios`,
   `just watch-sdk --fetch`, `npx cap sync ios`, `scripts/fetch-sparkle.sh`.
2. Both targets build without the hooks, the plugin without a warning:
   ```bash
   for scheme in App AppStoreMac; do
     xcodebuild -workspace ios/App/App.xcworkspace -scheme $scheme -configuration Debug \
       -destination 'platform=macOS,variant=Mac Catalyst' -derivedDataPath build/mac-voice \
       CODE_SIGNING_ALLOWED=NO build | grep -E 'BUILD|MindRoomVoiceRecorderPlugin.swift.*(warning|error)'
   done
   ```
3. `python3 docs/mac-voice-probe/patch.py "$PWD"`, then build the `App` scheme again.
4. `docs/mac-voice-probe/run.sh` (about five minutes; `run.sh 3 7` runs cases 3 and 7). It needs
   `ffmpeg` and `trash`, and the microphone permission of the build: a prompt that waits for a
   click shows as a timeout of the first case.
5. `git checkout -- ios/App/App`, and trash the worktree's `build/` and
   `~/Library/Application Support/MindRoomVoiceRecorder`.

## What the cases cover

Each case prints its own `expect:` line. Together:

- **Nothing but `forget` deletes.** A stop, a reload, a reload while recording, a `kill -9`, an
  interruption and a device that cannot be recorded all leave a file that a relaunch or a reload
  lists, with the account that recorded it. Discard (`forget`) leaves neither file nor lock.
- **The lock means "the writer is not done".** A second process does not list a live recording,
  nor one whose stop was answered while its writer still hangs or finishes. Listing makes no
  `.lock` file, and a file without one is not listed.
- **A recording that ended by itself can still be had.** After an interruption or a failed tap,
  `level` rejects `NOT_RECORDING` and `stop` still answers the file, also a second time.
- **A changed device does not end the recording.** The same format, another rate, stereo, a
  change during a pause, and a device that has no format for a moment: the file keeps its length
  and the 440 Hz pitch. One phase jump per change is the new converter starting.
- **A writer that hangs blocks nothing.** The level is answered within milliseconds, audio waits
  (up to 5 s of it) and is written once the writer goes on, and a stop is answered after 3 s as
  `incomplete` with what is on disk.

## What it does not cover

- The microphone: a test Mac has its lid closed and records silence, hence the tone.
- A device change made by macOS (AirPods or a headset taking over). The audio session of a
  Catalyst app shows one input, and changing the system's default input does not reach it: the
  probe stops the engine and posts the engine's notification itself, and makes up the new device's
  buffers. Try once by hand: record, connect AirPods, send, and listen.
- The page's own code (`nativeVoiceRecorder.ts`, `voiceCaptureSession.ts`): the probe's script
  calls the plugin directly. Their unit tests cover them.
