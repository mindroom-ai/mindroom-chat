# Mac app audio calls (native LiveKit) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:executing-plans. One Gemini 4 Neon implementer runs the whole plan in this worktree, because the tasks share one seam and one Mac build loop; DevAgent runs the reviews afterwards.

**Goal:** The Mac app (Mac Catalyst) places and joins audio calls through a native LiveKit plugin, and says honestly when it cannot.

**Architecture:** `RoomCall` keeps MatrixRTC membership, keys and state, and talks to media through a `CallMedia` interface. `WebCallMedia` is today's `livekit-client` code, moved. `NativeCallMedia` drives the Catalyst-only Capacitor plugin `MindRoomCall` (LiveKit Swift SDK 2.19.0) and reads its state by polling a snapshot.

**Tech Stack:** TypeScript, React, vitest, `livekit-client` 2.24.1, matrix-js-sdk MatrixRTC, Capacitor 8 (iOS), Swift 5 mode, LiveKit Swift SDK 2.19.0 through Swift Package Manager, Xcode 26.

**Spec:** `docs/baspowers/specs/2026-11-21-mac-native-calls-design.md`. Read it first; this plan argues from it.

## Global Constraints

- Work only in the worktree your brief names, on branch `feat/mac-native-calls` (from `origin/main` `e97db060d`). Never work in another checkout.
- Never `git stash`. Never push to `origin`. Never open a pull request. Never force anything. Commit after every task step that says so (`git -c commit.gpgsign=false commit`), files added by explicit path, never `git add -A`.
- Every commit ends with your own trailer: `--trailer "Assisted-by: MindRoom DevAgent:<your model id> <https://github.com/mindroom-ai/mindroom>"` (the dispatch brief gives the model id).
- Run `nix develop -c just format <the TypeScript and JSON files you changed>` before each commit.
- Edit files with `edit_file`. Set `timeout` on every shell call. Never search `/`. Delete with `trash` (`nix shell nixpkgs#trash-cli --command trash-put <path>`), never `rm`, in this worktree.
- No em dashes in code comments, docs or commit messages. No private data, host names or secrets in any committed file.
- Everything Mac-only in Swift sits inside `#if targetEnvironment(macCatalyst)`: the iOS routing test host compiles every file of `ios/App/App/`.
- LiveKit Swift SDK exactly `2.19.0`. No other new dependency, no `Podfile` change, no npm package.
- The web call path must behave as before: `src/app/calls/RoomCall.test.ts` is its oracle (Task 2 leaves it untouched, Task 3 may only add lines to it).
- Version 1 is audio only. Do not add video, screen sharing, device choice or transcript capture to the native path.
- The plugin never logs a token or a key and never calls `notifyListeners`.
- Gates, all run inside `nix develop` from the worktree root:
  - `nix develop -c just typecheck` : 0 errors
  - `nix develop -c just strict` : 0 errors
  - `NODE_OPTIONS=--max-old-space-size=6144 nix develop -c just lint` : 0 problems
  - `nix develop -c just test <files>` : the focused files named per task
  - `nix develop -c just script-tests` and `nix develop -c just license-check` : pass (Task 6 and Task 7)
  - Swift: the Mac builds of Task 1 step 5, repeated in Task 7.
- **Mac access.** The dispatch brief gives `MAC_SSH`, a command prefix that runs one shell command on the build Mac (Xcode 26.6, AC power, nobody at its screen). `$MAC_SSH '<cmd>'` runs `<cmd>` there; `$MAC_SSH 'cat > <path>' < <file>` copies a file there. On the Mac use only your own worktree `~/repos/worktrees/mindroom-chat-mac-native-calls` (made from the clone `~/repos/dev/mindroom-chat`), your own DerivedData under `/tmp/mac-native-calls-*`, and the probe folder `/tmp/mac-call-probe`. Kill only processes you started, by PID. Check `pmset -g batt` says AC power before every build. Never click a permission prompt of any bundle ID but your probe's. Never launch the app under `chat.mindroom.app`.
- **Stop rule.** Where a step says STOP, commit what you have, write the result in your final report, and end. Do not work around a failed gate.

## Review Focus

1. A page reload or window close while `connect` or the microphone prompt is pending: no native session stays connected and no microphone opens (Task 3 tests "a connect that answers after silence starts no polling"; Task 5 contract test "ends the session on every way out"; Task 7 lifecycle runs).
2. The own key's index changes during a call (someone leaves): the Mac must encrypt with the new index (Task 3 test "passes own for this device's key"; Task 5 contract "moves the sending index only for the own key"; Task 1 scenario S4).
3. A member reaches the media server after `setMembers` was sent: it must be subscribed to, and allowed to subscribe, without another call from the page (Task 5 contract "applies members again when the room changes"; Task 7 run "late joiner").
4. One failed `snapshot` must not end a call, and a lost session must (Task 3 tests "ignores a snapshot that fails otherwise" and "a lost session disconnects once").
5. Sound turned off before the first remote track arrives on the web path: the track starts muted (Task 2 test "a track attached while sound is off starts muted").

---

## File map

| File | Role |
|---|---|
| `src/app/calls/callMedia.ts` (new) | `CallMedia`, `CallMediaHost`, `CallMediaParticipant` types |
| `src/app/calls/webCallMedia.ts` (new) | `WebCallMedia`, `webCallMediaSupported`: the `livekit-client` code moved out of `RoomCall.ts` |
| `src/app/calls/nativeCallMedia.ts` (new) | `NativeCallMedia`: plugin calls and snapshot polling |
| `src/app/native/nativeCall.ts` (new) | plugin types, `getNativeCallPlugin`, `isNativeCallAvailable`, `isMacApp`, `nativeCallErrorCode` |
| `src/app/calls/RoomCall.ts` | uses `CallMedia`; picks the backend |
| `src/app/calls/callSupport.ts` | `callMediaKind`, `callUnsupportedProblem` |
| `src/app/calls/CallPanel.tsx`, `agent/agentCaller.ts`, `transcription/CallTranscription.tsx` | hidden controls, the Mac text |
| `src/app/i18n/locales/additions/*.json` (17) | `featureUi.calls.problems.macApp` |
| `ios/App/App/MindRoomCallPlugin.swift` (new) | the plugin |
| `ios/App/App/MindRoomBridgeViewController.swift`, `SceneDelegate.swift`, `MindRoomVoiceRecorderPlugin.swift` | registration, window close, recorder guard |
| `ios/App/App.xcodeproj/project.pbxproj`, `ios/App/App.xcworkspace/xcshareddata/swiftpm/Package.resolved` | the package and the new source file |
| `src/app/native/nativeCallIOSContract.test.ts` (new) | pins the Swift and project sources |
| `NOTICE`, `licenses/LiveKit-notices.txt`, `docs/development.md` | licenses and docs |

---

### Task 1: Spike with a hard stop gate: link the SDK and prove encrypted audio both ways

Nothing else is built until this task's gate passes. The package integration is product code and
is committed on the branch. The probe (Swift file, scripts) lives on a local branch
`probe/mac-native-calls` that is never merged.

**Files:**
- Modify: `ios/App/App.xcodeproj/project.pbxproj`
- Create: `ios/App/App.xcworkspace/xcshareddata/swiftpm/Package.resolved` (generated on the Mac)
- Create: `src/app/native/nativeCallIOSContract.test.ts`
- Probe branch only: `ios/App/App/MindRoomCallProbe.swift`, `scripts/mac-call-probe/{web-peer.mjs,scenario.mjs,verdict.mjs,run.sh,allow.applescript}`, one line in `ios/App/App/AppDelegate.swift`, project entries for the probe file
- Modify at the end: `docs/baspowers/specs/2026-11-21-mac-native-calls-design.md` (a `## Spike results` section)

**Interfaces:**
- Produces: the `LiveKit` package product linked into `App` and `AppStoreMac` for Mac Catalyst only; the measured facts later tasks rely on (API names compile, HKDF interop, whether the Store sandbox needs `com.apple.security.network.server`).

- [ ] **Step 1: Write the failing contract test for the package**

`src/app/native/nativeCallIOSContract.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const projectSource = read('ios/App/App.xcodeproj/project.pbxproj');

describe('LiveKit Swift package', () => {
  it('is pinned to exactly 2.19.0', () => {
    expect(projectSource).toMatch(
      /isa = XCRemoteSwiftPackageReference;\s*repositoryURL = "https:\/\/github\.com\/livekit\/client-sdk-swift";\s*requirement = \{\s*kind = exactVersion;\s*version = 2\.19\.0;\s*\};/
    );
    const resolved = JSON.parse(
      read('ios/App/App.xcworkspace/xcshareddata/swiftpm/Package.resolved')
    ) as { pins: Array<{ identity: string; state: { version?: string } }> };
    const version = (identity: string) =>
      resolved.pins.find((pin) => pin.identity === identity)?.state.version;
    expect(version('client-sdk-swift')).toBe('2.19.0');
    expect(version('webrtc-xcframework')).toBe('150.7871.04');
    expect(version('livekit-ffi-xcframework')).toBe('0.13.1');
  });

  it('is linked by both Mac targets, for Mac Catalyst only', () => {
    const links = projectSource.match(
      /\/\* LiveKit in Frameworks \*\/ = \{isa = PBXBuildFile; platformFilter = maccatalyst; productRef = [0-9A-F]{24} \/\* LiveKit \*\/; \};/g
    );
    expect(links).toHaveLength(2);
    expect(projectSource.match(/productName = LiveKit;/g)).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `nix develop -c just test src/app/native/nativeCallIOSContract.test.ts`
Expected: FAIL, 2 failed (no package reference; `Package.resolved` missing).

- [ ] **Step 3: Add the package to the project file**

Edit `ios/App/App.xcodeproj/project.pbxproj` by hand, with these exact object IDs:

1. In `/* Begin PBXBuildFile section */` add:
   ```
   		5B0000000000000000000007 /* LiveKit in Frameworks */ = {isa = PBXBuildFile; platformFilter = maccatalyst; productRef = 5B0000000000000000000005 /* LiveKit */; };
   		5B0000000000000000000008 /* LiveKit in Frameworks */ = {isa = PBXBuildFile; platformFilter = maccatalyst; productRef = 5B0000000000000000000006 /* LiveKit */; };
   ```
2. In the Frameworks phase `504EC3011FED79650016851F` (target `App`) add `5B0000000000000000000007 /* LiveKit in Frameworks */,` to `files`; in `44BA7BBFD74FEA3EDCCF0A8B` (target `AppStoreMac`) add `5B0000000000000000000008 /* LiveKit in Frameworks */,`.
3. In the `PBXNativeTarget` blocks named `App` and `AppStoreMac`, after the `name = ...;` line add `packageProductDependencies = ( <ID> /* LiveKit */, );` in the project file's own multi-line style, with `5B0000000000000000000005` for `App` and `5B0000000000000000000006` for `AppStoreMac`.
4. In the project object's `packageReferences` list add `5B0000000000000000000004 /* XCRemoteSwiftPackageReference "client-sdk-swift" */,`.
5. Before `/* Begin XCSwiftPackageProductDependency section */` add:
   ```
   /* Begin XCRemoteSwiftPackageReference section */
   		5B0000000000000000000004 /* XCRemoteSwiftPackageReference "client-sdk-swift" */ = {
   			isa = XCRemoteSwiftPackageReference;
   			repositoryURL = "https://github.com/livekit/client-sdk-swift";
   			requirement = {
   				kind = exactVersion;
   				version = 2.19.0;
   			};
   		};
   /* End XCRemoteSwiftPackageReference section */

   ```
6. In the `XCSwiftPackageProductDependency` section add two entries, `5B0000000000000000000005` and `5B0000000000000000000006`, each:
   ```
   		<ID> /* LiveKit */ = {
   			isa = XCSwiftPackageProductDependency;
   			package = 5B0000000000000000000004 /* XCRemoteSwiftPackageReference "client-sdk-swift" */;
   			productName = LiveKit;
   		};
   ```

Commit: `git add ios/App/App.xcodeproj/project.pbxproj src/app/native/nativeCallIOSContract.test.ts && git -c commit.gpgsign=false commit -m "Mac app: link the LiveKit Swift SDK for Mac Catalyst" --trailer "..."`.

- [ ] **Step 4: Make the Mac worktree and resolve the package**

```bash
git format-patch --stdout e97db060d..HEAD > /tmp/mac-native-calls/branch.patch
$MAC_SSH 'pmset -g batt | head -1; mkdir -p /tmp/mac-call-probe'
$MAC_SSH 'cat > /tmp/mac-call-probe/branch.patch' < /tmp/mac-native-calls/branch.patch
$MAC_SSH 'cd ~/repos/dev/mindroom-chat && git fetch -q origin && git worktree add --detach ~/repos/worktrees/mindroom-chat-mac-native-calls e97db060d && cd ~/repos/worktrees/mindroom-chat-mac-native-calls && git -c user.name=probe -c user.email=probe@localhost -c commit.gpgsign=false am -q --3way /tmp/mac-call-probe/branch.patch && git log --oneline -1'
```

Expected: `Now drawing from 'AC Power'` and the commit of Step 3. For every later transfer repeat
the patch with `git -C <Mac worktree> checkout -q --detach e97db060d` before `git am`.

- [ ] **Step 5: Build both Mac targets and check the iOS build stays free of LiveKit**

Write `/tmp/mac-native-calls/build.sh`, copy it to `/tmp/mac-call-probe/build.sh`, and run it
detached (`nohup bash /tmp/mac-call-probe/build.sh <scheme> <dd suffix> [extra xcodebuild settings] > /tmp/mac-call-probe/build-<suffix>.log 2>&1 &`), polling the log tail for `BUILD_DONE` or `error:`:

```bash
#!/bin/bash
set -eo pipefail
export PATH=/opt/homebrew/bin:/run/current-system/sw/bin:/usr/bin:/bin:/usr/sbin:/sbin
export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8
scheme=$1; suffix=$2; shift 2
cd ~/repos/worktrees/mindroom-chat-mac-native-calls
[ -d node_modules ] || npm ci
[ -d dist ] || npm run build:ios
[ -d ios/Watch/MatrixRustSDK ] || bash scripts/watch/build-sdk.sh --fetch
[ -d ios/MacUpdater/Sparkle/Sparkle.framework ] || scripts/fetch-sparkle.sh
[ -d ios/App/Pods ] || npx cap sync ios
destination='platform=macOS,variant=Mac Catalyst'
[ "$suffix" = ios ] && destination='generic/platform=iOS'
xcodebuild -workspace ios/App/App.xcworkspace -scheme "$scheme" -configuration Debug \
  -destination "$destination" -derivedDataPath "/tmp/mac-native-calls-dd-$suffix" \
  CODE_SIGNING_ALLOWED=NO "$@" build | tail -40
echo BUILD_DONE
```

Runs: `App mac`, `AppStoreMac store`, `App ios`. Then:

```bash
$MAC_SSH 'find /tmp/mac-native-calls-dd-mac/Build/Products/Debug-maccatalyst -maxdepth 4 -name "LiveKitWebRTC.framework" | head -2; du -sh /tmp/mac-native-calls-dd-mac/Build/Products/Debug-maccatalyst/MindRoom.chat.app'
$MAC_SSH 'find /tmp/mac-native-calls-dd-ios/Build/Products -iname "*LiveKit*" | head'
$MAC_SSH 'cat ~/repos/worktrees/mindroom-chat-mac-native-calls/ios/App/App.xcworkspace/xcshareddata/swiftpm/Package.resolved' > ios/App/App.xcworkspace/xcshareddata/swiftpm/Package.resolved
```

Expected: both Mac builds end with `** BUILD SUCCEEDED **`; the first `find` prints the framework
inside the app; the second prints nothing. Create the `swiftpm` directory locally first.

- Gate G1: a Mac build fails to resolve or link the package: **STOP**.
- If the iOS build cannot be made for a reason that has nothing to do with LiveKit, note
  "iOS exclusion not verified locally" for the spike results and go on. If it builds and the
  second `find` prints anything: **STOP**.

Run: `nix develop -c just test src/app/native/nativeCallIOSContract.test.ts` : PASS (2 tests).
Commit `Package.resolved` ("Mac app: pin the LiveKit package versions").

- [ ] **Step 6: Write the probe on the branch `probe/mac-native-calls`**

`git switch -c probe/mac-native-calls`. Everything in this step is committed there only
("PROBE, never merge"), then `git switch feat/mac-native-calls`.

**6a. `ios/App/App/MindRoomCallProbe.swift`**, added to the `App` and `AppStoreMac` targets'
sources the way `MindRoomVoiceRecorderPlugin.swift` is (IDs `5C0000000000000000000001` file
reference, `...02` and `...03` build files), and started from
`AppDelegate.application(_:didFinishLaunchingWithOptions:)` with
`MindRoomCallProbe.startIfAsked()` inside `#if targetEnvironment(macCatalyst)`:

```swift
#if targetEnvironment(macCatalyst)
import AVFoundation
import LiveKit
import UIKit

/// Interop probe, never merged (docs/baspowers/plans/2026-11-21-mac-native-calls.md, Task 1).
final class MindRoomCallProbe: NSObject, AudioRenderer, @unchecked Sendable {
    struct Scenario: Decodable {
        struct Key: Decodable { let identity: String; let index: Int32; let key: String }
        let url: String
        let token: String
        let identity: String
        let encrypted: Bool
        let keys: [Key]
        let rotateOwnToIndex: Int32?
        let rotateAtSeconds: Double?
        let toneHz: Double
        let seconds: Double
    }

    private static var shared: MindRoomCallProbe?

    /// Runs when launched with `-MindRoomCallProbe <base64 of the scenario JSON>`.
    static func startIfAsked() {
        guard let encoded = UserDefaults.standard.string(forKey: "MindRoomCallProbe"),
              let data = Data(base64Encoded: encoded),
              let scenario = try? JSONDecoder().decode(Scenario.self, from: data) else { return }
        let probe = MindRoomCallProbe(scenario)
        shared = probe
        Task { await probe.run() }
    }

    private let scenario: Scenario
    private let lock = NSLock()
    private var crossings = 0
    private var samples = 0
    private var sumSquares: Float = 0
    private var lastPositive = false
    private var sampleRate = 48_000.0
    private var rendered = Set<ObjectIdentifier>()

    private init(_ scenario: Scenario) { self.scenario = scenario }

    private func say(_ text: String) { NSLog("call-probe: %@", text) }

    private func run() async {
        var keyProvider: BaseKeyProvider?
        if scenario.encrypted {
            let provider = BaseKeyProvider(options: KeyProviderOptions(
                sharedKey: false, ratchetWindowSize: 10, failureTolerance: 10, keyRingSize: 256,
                keyDerivationAlgorithm: .hkdf))
            for key in scenario.keys {
                guard let data = Data(base64Encoded: key.key) else { continue }
                provider.setKey(keyData: data, participantId: key.identity, index: key.index)
            }
            provider.setCurrentKeyIndex(0)
            keyProvider = provider
        }
        let options = keyProvider.map {
            RoomOptions(encryptionOptions: EncryptionOptions(keyProvider: $0, encryptionType: .gcm))
        } ?? RoomOptions()
        let room = Room(delegate: nil, connectOptions: ConnectOptions(autoSubscribe: false), roomOptions: options)
        do {
            try await room.connect(url: scenario.url, token: scenario.token)
            say("connected")
            let granted = await AVCaptureDevice.requestAccess(for: .audio)
            say("microphone granted=\(granted)")
            try await room.localParticipant.setMicrophone(enabled: true)
            say("category=\(AVAudioSession.sharedInstance().category.rawValue) engineRunning=\(AudioManager.shared.isEngineRunning)")
        } catch {
            say("failure(\(error))")
            exit(1)
        }
        let started = Date()
        var rotated = false
        while Date().timeIntervalSince(started) < scenario.seconds {
            AudioManager.shared.mixer.capture(appAudio: tone(seconds: 1))
            for participant in room.remoteParticipants.values {
                for publication in participant.audioTracks {
                    guard let remote = publication as? RemoteTrackPublication else { continue }
                    if !remote.isSubscribed { try? await remote.set(subscribed: true) }
                    if let track = remote.track as? RemoteAudioTrack, rendered.insert(ObjectIdentifier(track)).inserted {
                        track.add(audioRenderer: self)
                    }
                }
            }
            if !rotated, let index = scenario.rotateOwnToIndex, let at = scenario.rotateAtSeconds,
               Date().timeIntervalSince(started) >= at {
                keyProvider?.setCurrentKeyIndex(index)
                rotated = true
                say("rotated to \(index)")
            }
            try? await Task.sleep(nanoseconds: 1_000_000_000)
            report(second: Int(Date().timeIntervalSince(started)))
        }
        await room.disconnect()
        try? await Task.sleep(nanoseconds: 1_500_000_000)
        say("after disconnect engineRunning=\(AudioManager.shared.isEngineRunning) state=\(room.connectionState == .disconnected)")
        exit(0)
    }

    /// One second of a sine at the scenario's frequency, mono float at 48 kHz.
    private func tone(seconds: Double) -> AVAudioPCMBuffer {
        let format = AVAudioFormat(standardFormatWithSampleRate: 48_000, channels: 1)!
        let frames = AVAudioFrameCount(48_000 * seconds)
        let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: frames)!
        buffer.frameLength = frames
        let channel = buffer.floatChannelData![0]
        for frame in 0..<Int(frames) {
            channel[frame] = Float(0.5 * sin(2 * Double.pi * scenario.toneHz * Double(frame) / 48_000))
        }
        return buffer
    }

    /// Decoded remote audio, before playout.
    func render(pcmBuffer: AVAudioPCMBuffer) {
        lock.lock()
        defer { lock.unlock() }
        sampleRate = pcmBuffer.format.sampleRate
        for frame in 0..<Int(pcmBuffer.frameLength) {
            let value: Float
            if let floats = pcmBuffer.floatChannelData {
                value = floats[0][frame]
            } else if let ints = pcmBuffer.int16ChannelData {
                value = Float(ints[0][frame]) / 32_768
            } else {
                return
            }
            sumSquares += value * value
            let positive = value >= 0
            if positive != lastPositive { crossings += 1 }
            lastPositive = positive
            samples += 1
        }
    }

    private func report(second: Int) {
        lock.lock()
        let (count, squares, crossed) = (samples, sumSquares, crossings)
        samples = 0; sumSquares = 0; crossings = 0
        lock.unlock()
        let rms = count > 0 ? (squares / Float(count)).squareRoot() : 0
        let hz = count > 0 ? Double(crossed) / 2 / (Double(count) / sampleRate) : 0
        say("heard second=\(second) hz=\(Int(hz)) rms=\(String(format: "%.4f", rms))")
    }
}
#endif
```

If `RoomOptions(encryptionOptions:)` is ambiguous to the compiler, add
`dataStreamOptions: DataStreamOptions()` as the first argument. Any other compile error against
the SDK is a finding: fix the probe from the SDK source at tag `2.19.0`, and write the corrected
API name into the spike results, because Task 5 uses the same calls.

**6b. `scripts/mac-call-probe/web-peer.mjs <scenario.json>`**: the browser peer. It serves, on
`127.0.0.1:29790`, `node_modules/livekit-client/dist/livekit-client.umd.js`,
`node_modules/livekit-client/dist/livekit-client.e2ee.worker.js` and one HTML page; launches
Chromium headless through `@playwright/test`'s `chromium` with
`args: ['--autoplay-policy=no-user-gesture-required']`; calls `window.run(scenario)`; prints every
page `console.log` line; exits after `scenario.seconds + 3` seconds. The page:

```js
window.run = async (s) => {
  const LK = window.LivekitClient;
  class Keys extends LK.BaseKeyProvider {
    constructor() { super({ ratchetWindowSize: 10, keyringSize: 256 }); }
    async set(key, index, identity) {
      const raw = Uint8Array.from(atob(key), (c) => c.charCodeAt(0));
      this.onSetEncryptionKey(await LK.createKeyMaterialFromBuffer(raw.buffer), identity, index);
    }
  }
  const keys = s.encrypted ? new Keys() : undefined;
  const room = new LK.Room(
    keys ? { encryption: { keyProvider: keys, worker: new Worker('/livekit-client.e2ee.worker.js') } } : {}
  );
  const own = s.keys.filter((k) => k.identity === s.identity);
  const ctx = new AudioContext();
  room.on(LK.RoomEvent.TrackSubscribed, (track, _publication, participant) => {
    if (track.kind !== 'audio') return;
    track.attach(); // Chromium feeds a remote track to Web Audio only while an element plays it.
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 4096;
    ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])).connect(analyser);
    const bins = new Float32Array(analyser.frequencyBinCount);
    const wave = new Float32Array(analyser.fftSize);
    let second = 0;
    setInterval(() => {
      analyser.getFloatFrequencyData(bins);
      analyser.getFloatTimeDomainData(wave);
      const peak = bins.indexOf(Math.max(...bins));
      const rms = Math.sqrt(wave.reduce((sum, v) => sum + v * v, 0) / wave.length);
      second += 1;
      console.log(`heard second=${second} from=${participant.identity} hz=${Math.round((peak * ctx.sampleRate) / analyser.fftSize)} rms=${rms.toFixed(4)}`);
    }, 1000);
  });
  if (keys) {
    await room.setE2EEEnabled(true);
    for (const k of s.keys.filter((key) => key.identity !== s.identity)) await keys.set(k.key, k.index, k.identity);
    await keys.set(own[0].key, own[0].index, s.identity);
  }
  await room.connect(s.url, s.token);
  if (keys) await keys.set(own[0].key, own[0].index, s.identity); // as RoomCall does after connecting
  const oscillator = ctx.createOscillator();
  oscillator.frequency.value = s.toneHz;
  const gain = ctx.createGain();
  gain.gain.value = 0.5;
  const out = ctx.createMediaStreamDestination();
  oscillator.connect(gain).connect(out);
  oscillator.start();
  await room.localParticipant.publishTrack(out.stream.getAudioTracks()[0], { source: LK.Track.Source.Microphone });
  console.log('connected');
  if (keys && s.rotateOwnToIndex !== undefined) {
    const next = own.find((k) => k.index === s.rotateOwnToIndex);
    setTimeout(() => void keys.set(next.key, next.index, s.identity).then(() => console.log(`rotated to ${next.index}`)), s.rotateAtSeconds * 1000);
  }
};
```

**6c. `scripts/mac-call-probe/scenario.mjs <name> <out dir>`** writes `<out dir>/native.json` and
`<out dir>/web.json` (and `web2.json` for `s0`), in the `Scenario` shape above. Fixed values:
room `!probe:probe.test`; identities `@mac:probe.test:MACPROBE`, `@web:probe.test:WEBPROBE`
(`@web2:probe.test:WEBPROBE2` in `s0`); tones 440 Hz for the Mac (and `web2`), 880 Hz for `web`;
`seconds: 24`; `url` from `PROBE_LIVEKIT_URL` (default `ws://127.0.0.1:29297`); tokens signed as
`e2e/rtc/authorization-service.mjs` signs them (`signToken`, same claims) with
`PROBE_LIVEKIT_KEY` (default `devkey`) and `PROBE_LIVEKIT_SECRET` (default
`mindroom-client-e2e-livekit-secret-0123456789`, the value in `scripts/e2e-rtc.sh`). Keys are 16
random bytes, base64. Each side's `keys` lists the other's keys first and its own last.

| Name | Peers | Encrypted | Keys |
|---|---|---|---|
| `s0` | web and web2, no Mac | yes | index 0 each, both sides agree |
| `s1` | Mac and web | yes | index 0 each, both sides agree |
| `s2` | Mac and web | yes | web holds a different random key for the Mac |
| `s3` | Mac and web | yes | the Mac holds a different random key for web |
| `s4` | Mac and web | yes | index 0 and 1 for each identity, both sides agree; both have `rotateOwnToIndex: 1`, `rotateAtSeconds: 10` |
| `s5` | Mac and web | no | none |

**6d. `scripts/mac-call-probe/verdict.mjs <name> <web log> <native log>`** reads the `heard`
lines and prints one line per check and a last line `VERDICT <name> PASS` or `FAIL`. "Hears X Hz"
means at least 5 samples with `rms >= 0.003` and `|hz - X| <= 40` in the window; "silent" means
every sample in the window has `rms < 0.001` and there are at least 5 samples. Windows are
seconds 4 to 20, and for `s4` seconds 13 to 20 (after the rotation).

| Name | web must | Mac must |
|---|---|---|
| `s0` | hear 440 (web2's log: hear 880) | not used |
| `s1`, `s4`, `s5` | hear 440 | hear 880 |
| `s2` | be silent | hear 880 |
| `s3` | hear 440 | be silent |

For every scenario with the Mac it also requires the native log lines `microphone granted=true`,
`category=AVAudioSessionCategoryPlayAndRecord engineRunning=true` and
`after disconnect engineRunning=false state=true`, and for `s4` a `rotated to 1` line in both logs.

**6e. `scripts/mac-call-probe/run.sh <name> <app path>`** (on the Mac, from the worktree root):
makes `/tmp/mac-call-probe/<name>/`, runs `scenario.mjs`, starts `web-peer.mjs` in the background
with its output in `web.log`, starts the app's binary
(`"<app>/Contents/MacOS/$(defaults read "<app>/Contents/Info" CFBundleExecutable)" -MindRoomCallProbe "$(base64 < native.json | tr -d '\n')" > native.log 2>&1 &`),
runs `osascript scripts/mac-call-probe/allow.applescript` every 2 s for the first 14 s, waits 32 s
in all, kills by PID what is still running, and runs `verdict.mjs`. For `s0` it starts two web
peers (the second on port 29791) and no app.

**6f. `scripts/mac-call-probe/allow.applescript`**: clicks Allow on the microphone prompt, which
belongs to the `UserNotificationCenter` process:

```applescript
tell application "System Events"
  if exists process "UserNotificationCenter" then
    tell process "UserNotificationCenter"
      if exists window 1 then
        if exists button "Allow" of window 1 then click button "Allow" of window 1
      end if
    end tell
  end if
end tell
```

It is only ever run while your probe is the only app asking. If the button has another name on
this macOS, list the buttons (`get name of every button of window 1`) and use that name.

In `scenario.mjs` an identity's own keys are listed by rising index, so `own[0]` is index 0.

- [ ] **Step 7: Start the rig and prove it with two browsers (S0)**

Transfer the probe branch (`git format-patch --stdout e97db060d..probe/mac-native-calls`, then
`checkout --detach e97db060d` and `git am` on the Mac as in Step 4). On the Mac, from the
worktree root, with `PATH=/opt/homebrew/bin:/run/current-system/sw/bin:$PATH`:

```bash
npx playwright install chromium
scripts/e2e-rtc.sh 97 up          # LiveKit in Docker on ws://127.0.0.1:29297, key devkey
bash scripts/mac-call-probe/run.sh s0 none
```

Expected last line: `VERDICT s0 PASS`. This proves the rig (server, tokens, the browser peer,
frame encryption between two `livekit-client` peers) before the Mac app is judged with it.

If S0 fails because media does not connect through Docker's network on the Mac (both logs say
`connected`, every `rms` is 0): stop the slot (`scripts/e2e-rtc.sh 97 down`), run a native server
instead (`brew install livekit`, then
`nohup livekit-server --dev --bind 127.0.0.1 --node-ip 127.0.0.1 > /tmp/mac-call-probe/livekit.log 2>&1 &`),
and export `PROBE_LIVEKIT_URL=ws://127.0.0.1:7880 PROBE_LIVEKIT_KEY=devkey PROBE_LIVEKIT_SECRET=secret`
for every run. Uninstall it in the cleanup (`brew uninstall livekit`) and say so in the report.
If S0 still fails: **STOP** (the rig, not the SDK, is broken; report the logs).

- [ ] **Step 8: Build the probe app and run the gate scenarios**

Build: `build.sh App probe PRODUCT_BUNDLE_IDENTIFIER=chat.mindroom.callprobe` (a fresh bundle ID
gets a fresh microphone prompt, which `allow.applescript` answers). The app is
`/tmp/mac-native-calls-dd-probe/Build/Products/Debug-maccatalyst/MindRoom.chat.app`. Then, one
at a time:

```bash
for name in s1 s2 s3 s4 s5; do bash scripts/mac-call-probe/run.sh $name "$APP" | tail -8; done
```

Expected: `VERDICT s1 PASS`, `s2 PASS`, `s3 PASS`, `s4 PASS`, `s5 PASS`.

| Gate | Scenario | Meaning |
|---|---|---|
| G2 | `s1` | per-participant HKDF keys interoperate both ways; microphone path under `.playAndRecord`; engine stops after disconnect |
| G3 | `s2`, `s3` | a wrong key gives silence: the audio really is encrypted with the per-participant key |
| G4 | `s4` | changing the sending key index works both ways |
| G5 | `s5` | unencrypted rooms work |

Reading failures:
- No `connected` in `native.log`: the connection failed; the `failure(...)` line says why.
- `microphone granted=false`: the prompt was not answered; fix `allow.applescript` and rerun under
  `PRODUCT_BUNDLE_IDENTIFIER=chat.mindroom.callprobe3` (a new ID asks again). Not a gate failure.
- Only the Mac's tone is missing on the web side in `s1` **and** `s5`: the test tone, not the
  encryption, is the suspect. Add `try? AudioManager.shared.setVoiceProcessingEnabled(false)` before
  `room.connect` in the probe, rebuild, rerun, and record that the tone needed it.
- `s5` passes and `s1` fails in either direction after that: the encryption does not
  interoperate. **STOP.**
- `s2` or `s3` is not silent: frames are readable without the right key. **STOP.**
- `s4` fails while `s1` passes: key index changes do not work. **STOP.**
- `category=` is not `AVAudioSessionCategoryPlayAndRecord`, or the engine still runs after the
  disconnect: **STOP.**

- [ ] **Step 9: The sandboxed Store build (G6) decides the network entitlement**

Build `build.sh AppStoreMac storeprobe PRODUCT_BUNDLE_IDENTIFIER=chat.mindroom.callprobe2`, copy
the built `.app` (`find /tmp/mac-native-calls-dd-storeprobe/Build/Products/Debug-maccatalyst -maxdepth 1 -name '*.app'`)
to `/tmp/mac-call-probe/Sandboxed.app`, and sign it ad hoc so the sandbox applies:

```bash
cat > /tmp/mac-call-probe/sandbox.entitlements <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.app-sandbox</key><true/>
<key>com.apple.security.network.client</key><true/>
<key>com.apple.security.device.microphone</key><true/>
<key>com.apple.security.device.audio-input</key><true/>
</dict></plist>
PLIST
app=/tmp/mac-call-probe/Sandboxed.app
find "$app/Contents" -depth \( -name '*.framework' -o -name '*.bundle' -o -name '*.dylib' \) -exec codesign --force --sign - {} \;
codesign --force --sign - --entitlements /tmp/mac-call-probe/sandbox.entitlements "$app"
codesign -d --entitlements :- "$app" 2>/dev/null | grep -c app-sandbox      # 1
bash scripts/mac-call-probe/run.sh s1 "$app" | tail -8
```

- `VERDICT s1 PASS`: the Store app needs no new entitlement. Record "network.server: not needed".
- FAIL: add `<key>com.apple.security.network.server</key><true/>` to the entitlements file, sign
  again, rerun `s1`. PASS now: record "network.server: needed"; Task 6 adds it to the Store
  entitlements. Still FAIL: **STOP**.

- [ ] **Step 10: Record the results, clean the rig, commit**

Append `## Spike results` to the spec: the date, macOS and Xcode versions, one row per gate
(G1 to G6) with PASS and the measured `hz` and `rms` of one sample each way, the size of
`LiveKitWebRTC.framework` in the app (`du -sh`), "network.server: needed" or "not needed", the
iOS exclusion result, and any API name the probe had to correct. No host names.

Cleanup on the Mac: `scripts/e2e-rtc.sh 97 down` (or stop the native server by PID and
`brew uninstall livekit`); kill leftover probe processes by PID. Keep the worktree, the
DerivedData folders and `/tmp/mac-call-probe` for Task 7.

Run: `nix develop -c just test src/app/native/nativeCallIOSContract.test.ts` : PASS.
Commit: `git add docs/baspowers/specs/2026-11-21-mac-native-calls-design.md && git -c commit.gpgsign=false commit -m "Mac calls: record the interop spike's results" --trailer "..."`.

**The gate:** go on to Task 2 only with G1 to G6 all PASS.

---

### Task 2: The media seam and the web backend (a move, no behaviour change)

**Files:**
- Create: `src/app/calls/callMedia.ts`, `src/app/calls/webCallMedia.ts`, `src/app/calls/webCallMedia.test.ts`
- Modify: `src/app/calls/RoomCall.ts`
- Must not change: `src/app/calls/RoomCall.test.ts`

**Interfaces:**
- Produces: `CallMedia`, `CallMediaHost`, `CallMediaParticipant` exactly as in the spec's "The seam: exact types"; and from `webCallMedia.ts`:
  ```ts
  export const webCallMediaSupported = (encrypted: boolean): boolean;
  export class WebCallMedia implements CallMedia {
    constructor(options: { encrypted: boolean; roomId: string; host: CallMediaHost });
  }
  ```

- [ ] **Step 1: Baseline**

Run: `nix develop -c just test src/app/calls/RoomCall.test.ts`. Note the number of passing tests (N).

- [ ] **Step 2: Write the failing tests** in `src/app/calls/webCallMedia.test.ts` (`// @vitest-environment jsdom`; mock `livekit-client`, `livekit-client/e2ee-worker?worker` and `./callKeyProvider` with the same fakes `RoomCall.test.ts` defines at its top, copied)

```ts
const host = (members: string[] = []): CallMediaHost => ({
  isMember: (identity) => members.includes(identity),
  onChange: vi.fn(), onParticipantConnected: vi.fn(), onPhase: vi.fn(),
  onDisconnected: vi.fn(), onDevice: vi.fn(),
});

it('answers as no media does before it connects, and its setters do nothing', async () => {
  const media = new WebCallMedia({ encrypted: false, roomId: '!r:calls.test', host: host() });
  expect(media.connected()).toBe(false);
  expect(media.participant('@a:calls.test:A', false)).toBeUndefined();
  expect(media.audioBlocked()).toBe(false);
  expect(media.screenShare()).toBe(false);
  expect(media.microphoneTrack()).toBeUndefined();
  media.setMembers(new Set(['@a:calls.test:A']));
  media.setSound(false);
  media.silence();
  await expect(media.setDevice('audioinput', 'mic')).resolves.toBeUndefined();
  await expect(media.disconnect()).resolves.toBeUndefined();
  media.dispose();
  expect(fakes.rooms).toHaveLength(0);
});

it('answers false and connects nothing when the call stopped while encryption was turned on', async () => {
  const media = new WebCallMedia({ encrypted: true, roomId: '!r:calls.test', host: host() });
  const connected = await media.connect(
    { url: 'wss://sfu.calls.test', jwt: 'jwt' },
    { devices: {}, stopped: () => true }
  );
  expect(connected).toBe(false);
  expect(fakes.rooms[0].connect).not.toHaveBeenCalled();
});

it('a track attached while sound is off starts muted', async () => {
  const identity = '@a:calls.test:A';
  const media = new WebCallMedia({ encrypted: false, roomId: '!r:calls.test', host: host([identity]) });
  await media.connect({ url: 'wss://sfu.calls.test', jwt: 'jwt' }, { devices: {}, stopped: () => false });
  media.setSound(false);
  const element = document.createElement('audio');
  const track = { kind: 'audio', attachedElements: [], attach: () => element, detach: () => [element] };
  fakes.rooms[0].emit('TrackSubscribed', track, {}, { identity }); // the fake names events by their enum keys
  expect(element.muted).toBe(true);
  expect(document.querySelector('[data-call-audio="!r:calls.test"]')?.contains(element)).toBe(true);
});
```

Run: `nix develop -c just test src/app/calls/webCallMedia.test.ts` : FAIL (module not found).

- [ ] **Step 3: Create `callMedia.ts`** with the three types, copied from the spec.

- [ ] **Step 4: Create `webCallMedia.ts` by moving code out of `RoomCall.ts`**

Move, do not rewrite. What goes where:

| From `RoomCall.ts` | To `WebCallMedia` |
|---|---|
| fields `media`, `keyProvider`, `worker`, `audioHost` | private fields `room`, `keyProvider`, `worker`, `audioHost`; plus `sound = true` and `changed = () => this.host.onChange()` |
| `:542` `new MatrixRtcKeyProvider()` | constructor, only when `encrypted` |
| `:401`, `:600` `setParticipantKey` | `setKey(key, index, identity)`: `await this.keyProvider?.setParticipantKey(key, index, identity)` (`own` unused) |
| `:564-583` worker, `new MediaRoom(...)`, `watchMedia`, `setE2EEEnabled`, `connect` | `connect(grant, { devices, stopped })`, same order and options; `if (stopped()) return false` where `:582` returns; `return true` after `room.connect` |
| `:347-379` `watchMedia` | private `watch(room)`: `TrackSubscribed` uses `this.host.isMember(participant.identity)`; `ParticipantConnected` calls `host.onParticipantConnected(participant.identity)`; `Reconnecting` and `Reconnected` call `host.onPhase('reconnecting')` and `host.onPhase('connected')`; `Disconnected` calls `host.onDisconnected()`; `ActiveDeviceChanged` calls `host.onDevice(kind, deviceId)`; every `this.refresh` becomes `this.changed` |
| `:251-259` local track published and unpublished | the same, with `this.changed` |
| `:299-316` `attachAudio`, `detachAudio` | the same; `element.muted = !this.sound`; the host element's `dataset.callAudio` is the `roomId` option |
| `:328-345` `followMembers` | `setMembers(identities)`: nothing without a room; else the same two halves with `identities` |
| `:229`, `:231`, `:245-248`, `:284-288` reads | `audioBlocked()`, `screenShare()`, `microphoneTrack()`, `connected()`, `participant(identity, local)` (undefined without a room, or for a remote identity that is not there) |
| `:604`, `:609`/`:633`, `:646-655`, `:669`, `:677` | `setMicrophone`, `setCamera`, `setScreenShare` (with its options), `setDevice` (`await this.room?.switchActiveDevice(...)`), `resumeAudio`; each rejects as the LiveKit call does and resolves without a room |
| `:660-663` | `setSound(on)`: stores `sound`, mutes or unmutes the audio elements |
| `:687-692` | `silence()`: the `Restarted` listeners off, the audio host removed |
| `:698` `media?.disconnect(true)` | `disconnect()`: `await this.room?.disconnect(true)` |
| `:702-703` | `dispose()`: terminate the worker |

`webCallMediaSupported(encrypted)` is `isBrowserSupported() && (!encrypted || isE2EESupported())`.

- [ ] **Step 5: Make `RoomCall.ts` use the seam**

- Fields: `private media?: CallMedia;` replaces `media`, `keyProvider`, `worker`, `audioHost`.
- A private field holds the host, made once:
  ```ts
  private readonly mediaHost: CallMediaHost = {
    isMember: (identity) => this.memberIdentities().has(identity),
    onChange: () => this.refresh(),
    onParticipantConnected: (identity) => {
      this.keyPeers.add(identity);
      this.resendOwnKey();
      this.refresh();
    },
    onPhase: (phase) => this.update({ phase }),
    onDisconnected: () => this.fail('connection'),
    onDevice: (kind, deviceId) => {
      this.update({ devices: { ...this.state.devices, [kind]: deviceId } });
      this.refresh();
    },
  };
  ```
- `refresh`, `readParticipants`: read through `this.media` (`connected()`, `audioBlocked()`, `screenShare()`, `microphoneTrack()`, `participant(key, local)`), with `!!this.media?.connected()` for the local `connected` and `false`/`undefined` where there is no media.
- `followMembers()`: `this.media?.setMembers(this.memberIdentities());`.
- `onKey`: `this.media?.setKey(key, keyIndex, participantIdentity, participantIdentity === this.identity).catch(() => undefined);`.
- `join()`: the check at `:507` becomes `if (!webCallMediaSupported(this.encrypted) || !deviceId)`. At `:542` (in place of the key provider): `const media: CallMedia = new WebCallMedia({ encrypted: this.encrypted, roomId: room.roomId, host: this.mediaHost }); this.media = media;`. The block `:562-587` becomes:
  ```ts
  try {
    const connected = await media.connect(grant, {
      devices: this.state.devices,
      stopped: () => this.stopped,
    });
    // The teardown of a call left meanwhile disconnected this media already; it stays so.
    if (!connected) return;
  } catch {
    this.fail('service');
    return;
  }
  ```
  The rest of `join` uses `media.disconnect()`, `media.setKey(own.key, own.index, this.identity, true)`, `media.setMicrophone(...)`, `media.setCamera(true)`.
- `setMicrophone`, `setCamera`, `setScreenShare`: `const media = this.media; if (!media || this.state.phase === 'connecting') return;` then the backend call with today's `catch`. `setSound`: `this.media?.setSound(on); this.update({ sound: on });`. `setDevice`, `resumeAudio`: through `this.media?`.
- `teardown()`, in this order: the three `session.off`; `const media = this.media; this.media = undefined; media?.silence();` the `microphoneTrack` update; `try { ... await Promise.allSettled([media?.disconnect(), membership]); } finally { media?.dispose(); ...the lock... }`.
- Remove the imports `RoomCall.ts` no longer uses. `CallVideoTrack` keeps its `livekit-client` type import.

- [ ] **Step 6: Verify the move**

Run: `nix develop -c just test src/app/calls/RoomCall.test.ts src/app/calls/webCallMedia.test.ts`
Expected: PASS, `RoomCall.test.ts` with the same N tests, `webCallMedia.test.ts` with 3.
Run: `git diff --stat -- src/app/calls/RoomCall.test.ts` : prints nothing.
If a `RoomCall.test.ts` test fails, the move changed behaviour: fix `webCallMedia.ts` or `RoomCall.ts`, never the test.
Run: `nix develop -c just test src/app/calls` : PASS. Then `just typecheck`, `just strict`, `just lint` as in Global Constraints: clean.

- [ ] **Step 7: Commit**

`git add src/app/calls/callMedia.ts src/app/calls/webCallMedia.ts src/app/calls/webCallMedia.test.ts src/app/calls/RoomCall.ts` and commit "Calls: RoomCall reaches media through a backend interface".

---

### Task 3: The native backend and its wiring into `RoomCall`

**Files:**
- Create: `src/app/native/nativeCall.ts`, `src/app/native/nativeCall.test.ts`, `src/app/calls/nativeCallMedia.ts`, `src/app/calls/nativeCallMedia.test.ts`
- Modify: `src/app/calls/callSupport.ts`, `src/app/calls/callSupport.test.tsx`, `src/app/calls/RoomCall.ts`
- Modify, additions only: `src/app/calls/RoomCall.test.ts`

**Interfaces:**
- Consumes: `CallMedia`, `CallMediaHost` (Task 2).
- Produces:
  ```ts
  // src/app/native/nativeCall.ts
  export type NativeCallSnapshot = {
    state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
    local: { speaking: boolean; microphone: boolean };
    participants: Array<{ identity: string; speaking: boolean; microphone: boolean }>;
  };
  export type MindRoomCallPlugin = {
    connect(options: { nonce: string; url: string; token: string; encrypted: boolean }): Promise<{ id: string }>;
    setKey(options: { id: string; identity: string; index: number; key: string; own: boolean }): Promise<void>;
    setMembers(options: { id: string; identities: string[] }): Promise<void>;
    setSound(options: { id: string; on: boolean }): Promise<void>;
    setMicrophone(options: { id: string; on: boolean }): Promise<void>;
    snapshot(options: { id: string }): Promise<NativeCallSnapshot>;
    disconnect(options: { id: string }): Promise<void>;
  };
  /** `registerPlugin<MindRoomCallPlugin>('MindRoomCall')`, once. */
  export const getNativeCallPlugin: () => MindRoomCallPlugin;
  /** `isNativeIOS() && Capacitor.isPluginAvailable('MindRoomCall')`. */
  export const isNativeCallAvailable: () => boolean;
  /** The Mac app is the iOS app under Mac Catalyst: `isNativeIOS() && isMacOS()`. */
  export const isMacApp: () => boolean;
  /** The `code` of a plugin rejection, undefined for anything else. */
  export const nativeCallErrorCode: (error: unknown) => string | undefined;

  // src/app/calls/callSupport.ts (added)
  export type CallMediaKind = 'web' | 'native';
  export const callMediaKind: () => CallMediaKind | undefined;

  // src/app/calls/nativeCallMedia.ts
  export const NATIVE_CALL_POLL_MS = 250;
  export class NativeCallMedia implements CallMedia {
    constructor(options: { encrypted: boolean; host: CallMediaHost; plugin?: MindRoomCallPlugin });
  }
  ```
  `isNativeIOS` is in `src/app/native/nativeSso.ts`, `isMacOS` in `src/app/lib/user-agent.ts`.

- [ ] **Step 1: Write the failing tests**

`src/app/native/nativeCall.test.ts` (mock `@capacitor/core` as `nativeVoiceRecorder.test.ts` does):
- `'is available only in the iOS shell with the plugin registered'`: native `ios` with `isPluginAvailable('MindRoomCall')` true gives `true`; the plugin missing, platform `android`, and the web each give `false`.
- `'reads the code of a plugin rejection'`: `nativeCallErrorCode({ code: 'NOT_CONNECTED' })` is `'NOT_CONNECTED'`; `nativeCallErrorCode(new Error('x'))` and `nativeCallErrorCode(undefined)` are `undefined`.

`src/app/calls/callSupport.test.tsx`, a new `describe('callMediaKind')` (mock `../native/nativeCall`):
- `'is web where the browser has WebRTC'` (stub `window.RTCPeerConnection` as a function and `navigator.mediaDevices.getUserMedia`; the plugin's availability does not matter).
- `'is native where only the plugin is there'`, `'is undefined with neither'`.

`src/app/calls/nativeCallMedia.test.ts` (`vi.useFakeTimers()`; a fake plugin of `vi.fn`s whose `connect` resolves `{ id: 's1' }` and whose `snapshot` resolves `{ state: 'connected', local: { speaking: false, microphone: false }, participants: [] }` unless a test replaces it; `grant = { url: 'wss://sfu.calls.test', jwt: 'jwt' }`; `go = { devices: {}, stopped: () => false }`):

| Test name | Asserts |
|---|---|
| `'names its start on the page and connects with the grant'` | `connect(grant, go)` resolves `true`; `plugin.connect` got `{ nonce, url: 'wss://sfu.calls.test', token: 'jwt', encrypted: true }` with `nonce` a string equal to `globalThis.mindroomCallStart`; `connected()` is `true` |
| `'connects nothing when the call already stopped'` | with `stopped: () => true` it resolves `false` and `plugin.connect` was not called |
| `'keeps keys, members and sound until the session has an id, then sends them in order'` | before `connect`: `setKey(new Uint8Array([1, 2, 3]), 4, '@a:calls.test:A', false)`, `setMembers(new Set(['@a:calls.test:A']))`, `setSound(false)`; no plugin call yet. After `connect`: `plugin.setKey` got `{ id: 's1', identity: '@a:calls.test:A', index: 4, key: 'AQID', own: false }`, `plugin.setMembers` got `{ id: 's1', identities: ['@a:calls.test:A'] }`, `plugin.setSound` got `{ id: 's1', on: false }`, and their `mock.invocationCallOrder` rises in that order |
| `'passes own for this device\'s key'` | after `connect`, `setKey(key, 0, '@me:calls.test:ME', true)` reaches the plugin with `own: true` |
| `'reports a new participant, changes and phases from snapshots'` | snapshots in turn: (1) one participant `A` with `microphone: true`: `host.onParticipantConnected` called once with `A`, `host.onChange` called, `participant(A, false)` equals `{ speaking: false, microphone: true }`; (2) the same again: no further host call; (3) `state: 'reconnecting'`: `host.onPhase('reconnecting')`, `connected()` false; (4) `state: 'connected'`: `host.onPhase('connected')`; (5) `local.speaking: true`: `participant('@me:calls.test:ME', true)` equals `{ speaking: true, microphone: false }` |
| `'a lost session disconnects once'` | `snapshot` rejects `{ code: 'NOT_CONNECTED' }`: `host.onDisconnected` called once; after 2 more seconds of timers `plugin.snapshot` was called no more. The same for a snapshot with `state: 'disconnected'` |
| `'ignores a snapshot that fails otherwise'` | `snapshot` rejects `new Error('busy')` once: `host.onDisconnected` not called, and the next tick asks again |
| `'asks for one snapshot at a time'` | `snapshot` never settles: after 1000 ms it was called once |
| `'a microphone the Mac refuses rejects with its code'` | `plugin.setMicrophone` rejects `{ code: 'PERMISSION_DENIED' }`: `setMicrophone(true)` rejects with an object whose `code` is `'PERMISSION_DENIED'`; before `connect`, `setMicrophone(true)` resolves and calls nothing |
| `'has no camera, screen share, devices or microphone track'` | `setCamera(true)` rejects; `setCamera(false)`, `setScreenShare(true)`, `setDevice('audioinput', 'x')`, `resumeAudio()` resolve; `screenShare()` and `audioBlocked()` are `false`; `microphoneTrack()` is `undefined` |
| `'silence stops the polling'` | after `connect` and `silence()`, 1000 ms of timers call `plugin.snapshot` no more |
| `'a connect that answers after silence starts no polling, and the next disconnect ends the session'` | `plugin.connect` pending; `silence()`; `await disconnect()` calls no plugin method; resolve the connect: `connect` resolves `true`; 1000 ms of timers call no `snapshot`; `await disconnect()` calls `plugin.disconnect({ id: 's1' })` |

`src/app/calls/RoomCall.test.ts`: append (no existing line changes; `git diff --numstat` must show 0 deletions) a hoisted `nativeFakes = vi.hoisted(() => ({ kind: undefined as 'web' | 'native' | undefined, mac: false, plugin: <fake plugin as above> }))`, a `vi.mock('./callSupport', async (importOriginal) => ({ ...(await importOriginal<typeof import('./callSupport')>()), callMediaKind: () => nativeFakes.kind }))`, a `vi.mock('../native/nativeCall', async (importOriginal) => ({ ...(await importOriginal<typeof import('../native/nativeCall')>()), getNativeCallPlugin: () => nativeFakes.plugin, isMacApp: () => nativeFakes.mac }))`, and `describe('RoomCall in the Mac app', ...)` that sets `nativeFakes.kind = 'native'` before each test and `undefined` after, built with the helpers the file's other tests use:

| Test name | Asserts |
|---|---|
| `'connects the plugin with the grant and makes no LiveKit room'` | after `join()`: `plugin.connect` got an object containing `{ url: 'wss://sfu.calls.test', token: 'jwt' }`; `fakes.rooms` is empty; `fakes.workers` is empty; phase `connected` |
| `'joins with the camera off whatever it was asked'` | `video: true`: `getState().camera` is `false` and `joinRTCSession` got `callIntent: 'audio'` |
| `'hands keys to the plugin, marking this device\'s own'` | an `EncryptionKeyChanged` for another identity reaches `plugin.setKey` with `own: false`; this call's own key with `own: true` |
| `'tells the plugin the members after a membership change'` | `plugin.setMembers` got the identities of the session's memberships |
| `'fails with a connection problem when the native session is lost'` | `plugin.snapshot` rejects `{ code: 'NOT_CONNECTED' }`; after `NATIVE_CALL_POLL_MS` of fake timers: phase `failed`, problem `connection`, `plugin.disconnect` called with the session's `id` |
| `'goes on listening when the microphone is refused'` | `plugin.setMicrophone` rejects `{ code: 'PERMISSION_DENIED' }`: phase `connected`, `microphone` false, problem `device` |

Run: `nix develop -c just test src/app/native/nativeCall.test.ts src/app/calls/nativeCallMedia.test.ts src/app/calls/callSupport.test.tsx src/app/calls/RoomCall.test.ts`
Expected: the new tests FAIL (missing modules and exports); every earlier `RoomCall.test.ts` test still passes.

- [ ] **Step 2: Implement `nativeCall.ts`** as the Interfaces block says, in the shape of `src/app/native/nativeVoiceRecorder.ts:22-34`.

- [ ] **Step 3: Add `callMediaKind` to `callSupport.ts`**, with the body the spec gives under "Which backend" (`callUnsupportedProblem` comes in Task 4).

- [ ] **Step 4: Implement `NativeCallMedia`**

- `connect`: `if (options.stopped()) return false;` then `const nonce = randomUuid(); Object.assign(globalThis, { mindroomCallStart: nonce });` then `plugin.connect({ nonce, url: grant.url, token: grant.jwt, encrypted })`; store `id`; set the last snapshot to connected with nobody; send the kept operations in order; start the interval (`window.setInterval`, `NATIVE_CALL_POLL_MS`) unless `silence()` ran; return `true`. A rejection passes through.
- Kept operations: one private `send(operation: (id: string) => Promise<void>): Promise<void>` that runs the operation when the `id` is known and otherwise keeps it and resolves. `setKey` encodes with `encodeBase64` from `matrix-js-sdk/lib/base64`. `setMembers` and `setSound` swallow rejections (`.catch(() => undefined)`).
- `setMicrophone(on)`: resolves without an `id`; else `await plugin.setMicrophone({ id, on })`.
- The poll: skip while one is pending; compare with the last snapshot as the spec's "Native backend" lists; store the new one. `connected()` is `id !== undefined && last.state === 'connected'`.
- `participant(identity, local)`: `local` gives `last.local` once there is an `id`; otherwise the entry of that identity; never `video` or `screen`.
- `silence()`: clear the interval, mark silenced. `disconnect()`: with an `id`, `await plugin.disconnect({ id }).catch(() => undefined)`. `dispose()`: nothing.

- [ ] **Step 5: Wire it into `RoomCall.ts`**

- Constructor: `camera: callMediaKind() === 'native' ? false : options.video ?? false`.
- `join()`: `const native = callMediaKind() === 'native';` and the check becomes `if (!deviceId || (!native && !webCallMediaSupported(this.encrypted)))`. Where Task 2 makes the backend: `native ? new NativeCallMedia({ encrypted: this.encrypted, host: this.mediaHost }) : new WebCallMedia({ ... })`.

- [ ] **Step 6: Verify**

Run the four test files of Step 1: PASS. `git diff --numstat e97db060d -- src/app/calls/RoomCall.test.ts` shows `0` in the deletions column. `nix develop -c just test src/app/calls src/app/native` : PASS. `just typecheck`, `just strict`, `just lint`: clean.

- [ ] **Step 7: Commit** the seven files: "Calls: a native media backend for the Mac app".

---

### Task 4: The Mac text, and the controls the Mac app hides

**Files:**
- Modify: `src/app/calls/RoomCall.ts` (`CallProblem`, the refusal), `src/app/calls/callSupport.ts`, `src/app/calls/CallPanel.tsx`, `src/app/calls/agent/agentCaller.ts`, `src/app/calls/transcription/CallTranscription.tsx`, the 17 files `src/app/i18n/locales/additions/*.json`
- Tests: `src/app/calls/callSupport.test.tsx`, `src/app/calls/CallPanel.window.test.tsx`, `src/app/calls/agent/agentCallFailure.test.tsx`, `src/app/calls/transcription/CallTranscription.test.tsx`, `src/app/calls/RoomCall.test.ts` (additions only)

**Interfaces:**
- Consumes: `callMediaKind`, `isMacApp` (Task 3).
- Produces: `export const callUnsupportedProblem = (): 'macApp' | 'browser'` in `callSupport.ts`; `CallProblem` and `AgentCallError` each with the new member `'macApp'`; the locale key `featureUi.calls.problems.macApp`.

- [ ] **Step 1: Write the failing tests**

- `callSupport.test.tsx`: `'tells the Mac app its own problem, and a browser the WebRTC one'`: `isMacApp` true gives `'macApp'`, false gives `'browser'`.
- `RoomCall.test.ts` (append to `describe('RoomCall in the Mac app')`): `'fails with the Mac problem where the Mac app has no plugin'`: `nativeFakes.kind = undefined`, `fakes.browserSupported = false`, `nativeFakes.mac = true` (reset after): after `join()` the problem is `'macApp'`. The file's existing test of an unsupported browser keeps expecting `'browser'`.
- `agent/agentCallFailure.test.tsx`: its `vi.mock('../callSupport', ...)` gains `callMediaKind: () => (support.browser ? 'web' : undefined)` and `callUnsupportedProblem: () => (support.mac ? 'macApp' : 'browser')` (add `mac: false` to its `support` object). New test `'names the Mac app when it cannot call'`: `support.browser = false; support.mac = true`: the caller's `error` is `'macApp'`, and `AGENT_CALL_ERROR_KEYS.macApp` is `'featureUi.calls.problems.macApp'`.
- `CallPanel.window.test.tsx`: its `vi.mock('./callSupport', ...)` becomes controllable (`callMediaKind: () => media.kind`, `callUnsupportedProblem: () => media.problem`, defaults `'web'` and `'browser'`). New tests:
  - `'shows no camera or device control in a native call'`: `media.kind = 'native'`, a joined call: no control labelled `featureUi.call.controls.startCamera` or `stopCamera`, none labelled `featureUi.calls.devices.title`; the microphone, sound and end controls are there.
  - `'offers no camera or devices before joining in the Mac app'`: the prescreen with `media.kind = 'native'`: the same two absent, Join present.
  - `'says calls are not available in the Mac app'`: `media.kind = undefined; media.problem = 'macApp'`: the prescreen shows the text of `featureUi.calls.problems.macApp` and no Join button.
  (Use the labels the way the file's other tests find controls.)
- `CallTranscription.test.tsx`: mock `../callSupport` with `callMediaKind: () => kind.value`; new test `'stays out of a native call, which has no microphone track for it'`: `kind.value = 'native'`, a room call that the file's other tests transcribe: the transcriber class was not constructed and `callTranscriptionAtom` stays `undefined`.

Run them: the new tests FAIL.

- [ ] **Step 2: Add the locale key** to all 17 overlays, inside `featureUi.calls.problems`, after `untrustedService`:

| File | `"macApp"` |
|---|---|
| `en.json` | `Calls are not available here in the Mac app. Update the app, or call from a browser.` |
| `nl.json` | `Bellen is hier in de Mac-app niet beschikbaar. Werk de app bij, of bel vanuit een browser.` |
| `de.json` | `Anrufe sind hier in der Mac-App nicht verfügbar. Aktualisiere die App oder rufe über einen Browser an.` |
| `es.json` | `Las llamadas no están disponibles aquí en la app para Mac. Actualiza la app o llama desde un navegador.` |
| `fr.json` | `Les appels ne sont pas disponibles ici dans l'app Mac. Mettez l'app à jour ou appelez depuis un navigateur.` |
| `it.json` | `Le chiamate non sono disponibili qui nell'app per Mac. Aggiorna l'app o chiama da un browser.` |
| `pt.json` | `As chamadas não estão disponíveis aqui no app para Mac. Atualize o app ou ligue por um navegador.` |
| `ru.json` | `Звонки недоступны здесь, в приложении для Mac. Обновите приложение или позвоните из браузера.` |
| `tr.json` | `Aramalar Mac uygulamasında burada kullanılamıyor. Uygulamayı güncelleyin veya bir tarayıcıdan arayın.` |
| `id.json` | `Panggilan tidak tersedia di sini di aplikasi Mac. Perbarui aplikasi, atau lakukan panggilan dari browser.` |
| `ja.json` | `Mac アプリのこの画面では通話を利用できません。アプリをアップデートするか、ブラウザから通話してください。` |
| `ko.json` | `Mac 앱의 이 화면에서는 통화를 사용할 수 없습니다. 앱을 업데이트하거나 브라우저에서 통화하세요.` |
| `zh.json` | `Mac 应用的此处无法使用通话。请更新应用，或在浏览器中通话。` |
| `zh-TW.json` | `Mac App 的此處無法使用通話。請更新 App，或在瀏覽器中通話。` |
| `ar.json` | `المكالمات غير متاحة هنا في تطبيق Mac. حدِّث التطبيق أو اتصل من متصفح.` |
| `hi.json` | `Mac ऐप में यहाँ कॉल उपलब्ध नहीं हैं। ऐप अपडेट करें, या ब्राउज़र से कॉल करें।` |
| `bn.json` | `Mac অ্যাপে এখানে কল উপলব্ধ নয়। অ্যাপটি আপডেট করুন, অথবা ব্রাউজার থেকে কল করুন।` |

In each file match the form of address (formal or informal "you") of that file's `featureUi.calls.problems.service` string, changing only the verb forms if they differ.

- [ ] **Step 3: Implement**

- `callSupport.ts`: `callUnsupportedProblem` as in the spec.
- `RoomCall.ts`: `CallProblem` gains `/** The Mac app without its call plugin (a window that has none, a failed start). */ | 'macApp'`; the refusal in `join()` becomes `this.fail(callUnsupportedProblem())`.
- `CallPanel.tsx`: `PROBLEM_KEYS.macApp = 'featureUi.calls.problems.macApp'`. The prescreen's first blocker becomes `if (!callMediaKind()) blocker = t(PROBLEM_KEYS[callUnsupportedProblem()]);`. With `const audioOnly = callMediaKind() === 'native';` in `JoinedCall` and in `CallPrescreen`, render the camera `CallControl` (`:253-262`, `:531-541`) and the `DeviceControl` (`:286-289`, `:542-547`) only when `!audioOnly`. Remove the `browserSupportsCalls` import if nothing else there uses it.
- `agent/agentCaller.ts`: `AgentCallError` gains `'macApp'`; `AGENT_CALL_ERROR_KEYS.macApp = 'featureUi.calls.problems.macApp'`; the check at `:176` becomes `if (!callMediaKind()) { setError(callUnsupportedProblem()); return false; }`. Wherever the compiler then reports a missing `'macApp'` case, treat it as `'browser'` is treated.
- `transcription/CallTranscription.tsx:109-113`: `if (active?.kind !== 'room' || callMediaKind() === 'native') return null;` with a one-line comment that the Mac app's call has no microphone track to transcribe.

- [ ] **Step 4: Verify**

Run: `nix develop -c just test src/app/calls src/app/i18n src/app/native` : PASS. `just typecheck`, `just strict`, `just lint`: clean. `nix develop -c just format <the files you changed>` and commit the result with them.

- [ ] **Step 5: Commit**: "Mac app: honest text where calls cannot work; hide camera, devices and transcript capture in native calls".

---

### Task 5: The plugin `MindRoomCallPlugin`

**Files:**
- Create: `ios/App/App/MindRoomCallPlugin.swift`
- Modify: `ios/App/App/MindRoomBridgeViewController.swift:47-52`, `ios/App/App/SceneDelegate.swift:83-90`, `ios/App/App/MindRoomVoiceRecorderPlugin.swift`, `ios/App/App.xcodeproj/project.pbxproj`
- Test: `src/app/native/nativeCallIOSContract.test.ts` (extend)

**Interfaces:**
- Consumes: the `MindRoomCallPlugin` TypeScript type (Task 3): same method names, argument names and codes. The LiveKit names the probe compiled (Task 1; use any name the spike results corrected).
- Produces: the registered plugin `MindRoomCall`; `MindRoomCallPlugin.liveSessions` (static, read by the recorder); `func close()` (called by `SceneDelegate`).

- [ ] **Step 1: Extend the contract test** (it fails: the file does not exist)

Add to `nativeCallIOSContract.test.ts`, reading `ios/App/App/MindRoomCallPlugin.swift`, `MindRoomBridgeViewController.swift`, `SceneDelegate.swift`, `MindRoomVoiceRecorderPlugin.swift` and `src/app/native/nativeCall.ts`, with a `body(method)` helper as in `nativeVoiceRecorderIOSContract.test.ts:10-14`:

| Test name | Asserts on the sources |
|---|---|
| `'is the plugin the web side registers, with its methods'` | `public let jsName = "MindRoomCall"`; the wrapper holds `('MindRoomCall')`; each of `connect`, `setKey`, `setMembers`, `setSound`, `setMicrophone`, `snapshot`, `disconnect` has its `CAPPluginMethod(name: "<m>", returnType: CAPPluginReturnPromise)` and `@objc func <m>(_ call: CAPPluginCall)` |
| `'is compiled for Mac Catalyst only, in both Mac targets'` | the file starts with `#if targetEnvironment(macCatalyst)` and ends with `#endif`; `import LiveKit` comes after the `#if`; the project has exactly 2 `MindRoomCallPlugin.swift in Sources` build files |
| `'is registered on the main window only, inside the Catalyst block'` | the bridge source matches `/#if targetEnvironment\(macCatalyst\)[\s\S]*?if !\(self is QuickCaptureViewController\) \{[\s\S]*?registerPluginInstance\(MindRoomCallPlugin\(\)\)[\s\S]*?\}\s*#endif/` |
| `'keys frames as the web client and the agent do'` | the plugin contains `KeyProviderOptions(` followed by `sharedKey: false`, `ratchetWindowSize: 10`, `failureTolerance: 10`, `keyRingSize: 256`, `keyDerivationAlgorithm: .hkdf` in that order (one regex); `EncryptionOptions(keyProvider:` ; `ConnectOptions(autoSubscribe: false)` |
| `'moves the sending index only for the own key'` | `body('setKey')` matches `/setKey\(keyData: key, participantId: identity, index: Int32\(index\)\)\s*if call\.getBool\("own"\) == true \{\s*session\.keyProvider\?\.setCurrentKeyIndex\(Int32\(index\)\)/`; `setCurrentKeyIndex` appears once in the file |
| `'connects only for the newest start of the page that is still loaded'` | the wrapper side: `nativeCallMedia.ts` matches `/Object\.assign\(globalThis, \{ mindroomCallStart: nonce \}\);[\s\S]*?\.connect\(\{ nonce,/`. `body('connect')`: before `evaluateJavaScript("window.mindroomCallStart")` it has `!self.closed`, `!webView.isLoading` and `let generation = self.generation` and no `Room(`; after it, a guard with `generation == self.generation`, `!self.closed`, `!webView.isLoading` and `(newest as? String) == nonce` comes before `self.endLive()` and `Room(` |
| `'gives up a connect that a page load, a closed window or a newer start overtook'` | `body('connect')` matches `/guard self\.live === session else \{\s*return call\.reject\("The page is gone", "START_FAILED"\)/` after `try await room.connect(url: url, token: token)` |
| `'opens the microphone only for the session that asked, after the prompt'` | `body('setMicrophone')` matches `/AVCaptureDevice\.requestAccess\(for: \.audio\)[\s\S]*?guard self\.live === session else \{\s*return call\.reject\("No such call", "NOT_CONNECTED"\)[\s\S]*?"PERMISSION_DENIED"[\s\S]*?"NO_MICROPHONE"/`, and `setMicrophone(enabled: on)` appears once in the file |
| `'ends the session on every way out'` | the file has exactly one `room.disconnect()`, inside `private func endLive()`; `endLive()` is called in `body('disconnect')`, in `pageWillLoad`, in `body('connect')` (before the new room and in the failed connect); `close()` sets `closed = true` and calls `pageWillLoad()`; `load()` observes `.capacitorWebViewNavigationStarted` and `.capacitorWebViewTerminated`; the scene source matches `/plugin\(withName: "MindRoomCall"\) as\? MindRoomCallPlugin\)\?\.close\(\)[\s\S]*?QuickCapture\.stopPage\(of: window\)/` |
| `'applies members again when the room changes'` | the delegate class implements `participantDidConnect`, `didPublishTrack publication: RemoteTrackPublication`, `didSubscribeTrack` and `roomDidReconnect`, each calling `roomChanged(room)`; `apply(` contains `setTrackSubscriptionPermissions(\s*allParticipantsAllowed: false` and `set(subscribed:` |
| `'answers only for the live session'` | each of `body('setKey')`, `body('setMembers')`, `body('setSound')`, `body('setMicrophone')`, `body('snapshot')` contains `guard let session = self.session(call) else { return }`, and `session(_ call:` rejects with `"NOT_CONNECTED"` |
| `'sets no audio session category, logs nothing and notifies no listeners'` | the plugin matches none of `/setCategory\(|setActive\(|NSLog|print\(|CAPLog|os_log|notifyListeners\(/` |
| `'the voice recorder leaves the audio session alone during a call'` | the recorder source contains `MindRoomCallPlugin.liveSessions == 0` exactly 4 times, and still `try session.setCategory(.playAndRecord, mode: .default)` once |

Run: `nix develop -c just test src/app/native/nativeCallIOSContract.test.ts` : the new tests FAIL.

- [ ] **Step 2: Write `ios/App/App/MindRoomCallPlugin.swift`**

```swift
#if targetEnvironment(macCatalyst)
import AVFoundation
import Capacitor
import LiveKit

/// Carries a call's audio for the Mac app, whose WebKit has no WebRTC
/// (`src/app/calls/nativeCallMedia.ts`). Membership and media keys stay with the page. A session
/// belongs to the page that started it and ends with it.
@objc(MindRoomCallPlugin)
public class MindRoomCallPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "MindRoomCallPlugin"
    public let jsName = "MindRoomCall"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "connect", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setKey", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMembers", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setSound", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setMicrophone", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "snapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "disconnect", returnType: CAPPluginReturnPromise)
    ]

    /// The sessions live in the app (main queue): the voice recorder leaves the audio session
    /// alone meanwhile.
    static private(set) var liveSessions = 0

    private final class Session {
        let id = UUID().uuidString
        let room: Room
        let keyProvider: BaseKeyProvider?
        /// The media identities of the call's members; nobody until the page names them.
        var members = Set<String>()
        var sound = true

        init(room: Room, keyProvider: BaseKeyProvider?) {
            self.room = room
            self.keyProvider = keyProvider
        }
    }

    /// Tells the plugin that who is in the room, or what they publish, changed.
    private final class Events: NSObject, RoomDelegate, @unchecked Sendable {
        weak var plugin: MindRoomCallPlugin?

        func room(_ room: Room, participantDidConnect participant: RemoteParticipant) { plugin?.roomChanged(room) }
        func room(_ room: Room, participant: RemoteParticipant, didPublishTrack publication: RemoteTrackPublication) { plugin?.roomChanged(room) }
        func room(_ room: Room, participant: RemoteParticipant, didSubscribeTrack publication: RemoteTrackPublication) { plugin?.roomChanged(room) }
        func roomDidReconnect(_ room: Room) { plugin?.roomChanged(room) }
    }

    private let events = Events()
    private var live: Session?
    /// Its window closed: it connects nothing more.
    private var closed = false
    /// The page loads begun: a start asked before the newest one connects nothing.
    private var generation = 0
    /// LiveKit's calls, one after another in the order the page made them.
    private var chain = Task<Void, Never> {}

    override public func load() {
        events.plugin = self
        NotificationCenter.default.addObserver(
            self, selector: #selector(pageWillLoad), name: .capacitorWebViewNavigationStarted,
            object: bridge?.webView
        )
        NotificationCenter.default.addObserver(
            self, selector: #selector(pageWillLoad), name: .capacitorWebViewTerminated,
            object: bridge?.webView
        )
    }

    private func enqueue(_ work: @escaping () async -> Void) {
        let previous = chain
        chain = Task {
            await previous.value
            await work()
        }
    }

    /// The live session a call names, or a rejection (main queue).
    private func session(_ call: CAPPluginCall) -> Session? {
        guard let live, live.id == call.getString("id") else {
            call.reject("No such call", "NOT_CONNECTED")
            return nil
        }
        return live
    }

    /// The one way out (main queue): a leave, a page load, a closed window, a newer start and a
    /// failed connect all end the session here. The SDK deactivates the audio session once its
    /// engine has stopped.
    private func endLive() {
        guard let session = live else { return }
        live = nil
        Self.liveSessions -= 1
        enqueue { await session.room.disconnect() }
    }

    fileprivate func roomChanged(_ room: Room) {
        DispatchQueue.main.async {
            guard let session = self.live, session.room === room else { return }
            self.apply(session)
        }
    }

    /// Only the call's members are subscribed to and may subscribe to this device's tracks, and
    /// they are heard while sound is on (main queue).
    private func apply(_ session: Session) {
        let room = session.room
        var permissions = [ParticipantTrackPermission]()
        var subscriptions = [(RemoteTrackPublication, Bool)]()
        var volumes = [(RemoteAudioTrack, Double)]()
        for participant in room.remoteParticipants.values {
            let member = participant.identity.map { session.members.contains($0.stringValue) } ?? false
            if member, let sid = participant.sid?.stringValue {
                permissions.append(ParticipantTrackPermission(participantSid: sid, allTracksAllowed: true))
            }
            for publication in participant.audioTracks {
                guard let remote = publication as? RemoteTrackPublication else { continue }
                if remote.isSubscribed != member { subscriptions.append((remote, member)) }
                if let track = remote.track as? RemoteAudioTrack {
                    volumes.append((track, session.sound ? 1 : 0))
                }
            }
        }
        enqueue {
            for (publication, subscribed) in subscriptions {
                try? await publication.set(subscribed: subscribed)
            }
            volumes.forEach { $0.0.volume = $0.1 }
            try? await room.localParticipant.setTrackSubscriptionPermissions(
                allParticipantsAllowed: false, trackPermissions: permissions
            )
        }
    }

    @objc func connect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            // A closed or loading page connects nothing.
            guard !self.closed, let webView = self.bridge?.webView, !webView.isLoading,
                  let nonce = call.getString("nonce"), let url = call.getString("url"),
                  let token = call.getString("token") else {
                return call.reject("The page is gone", "START_FAILED")
            }
            let generation = self.generation
            // The page names its newest start, and the page loaded now is asked for it: an older
            // start of this page, and a start of a page since replaced, connect nothing.
            webView.evaluateJavaScript("window.mindroomCallStart") { newest, _ in
                guard generation == self.generation, !self.closed, !webView.isLoading,
                      (newest as? String) == nonce else {
                    return call.reject("The page is gone", "START_FAILED")
                }
                self.endLive()
                var keyProvider: BaseKeyProvider?
                if call.getBool("encrypted") == true {
                    // As the web client and MindRoom's agents key frames (callKeyProvider.ts).
                    keyProvider = BaseKeyProvider(options: KeyProviderOptions(
                        sharedKey: false, ratchetWindowSize: 10, failureTolerance: 10,
                        keyRingSize: 256, keyDerivationAlgorithm: .hkdf
                    ))
                }
                let options = keyProvider.map {
                    RoomOptions(encryptionOptions: EncryptionOptions(keyProvider: $0, encryptionType: .gcm))
                } ?? RoomOptions()
                // Nothing is subscribed to until the page names the call's members.
                let room = Room(
                    delegate: self.events, connectOptions: ConnectOptions(autoSubscribe: false),
                    roomOptions: options
                )
                let session = Session(room: room, keyProvider: keyProvider)
                self.live = session
                Self.liveSessions += 1
                self.enqueue {
                    do {
                        try await room.connect(url: url, token: token)
                    } catch {
                        DispatchQueue.main.async {
                            if self.live === session { self.endLive() }
                            call.reject("Could not connect the call", "CONNECT_FAILED")
                        }
                        return
                    }
                    DispatchQueue.main.async {
                        // A page load, a closed window or a newer start ended it meanwhile.
                        guard self.live === session else {
                            return call.reject("The page is gone", "START_FAILED")
                        }
                        call.resolve(["id": session.id])
                    }
                }
            }
        }
    }

    @objc func setKey(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let session = self.session(call) else { return }
            guard let identity = call.getString("identity"), let index = call.getInt("index"),
                  let key = call.getString("key").flatMap({ Data(base64Encoded: $0) }) else {
                return call.reject("Not a key", "BAD_KEY")
            }
            session.keyProvider?.setKey(keyData: key, participantId: identity, index: Int32(index))
            if call.getBool("own") == true {
                session.keyProvider?.setCurrentKeyIndex(Int32(index))
            }
            call.resolve()
        }
    }

    @objc func setMembers(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let session = self.session(call) else { return }
            session.members = Set(call.getArray("identities", String.self) ?? [])
            self.apply(session)
            call.resolve()
        }
    }

    @objc func setSound(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let session = self.session(call) else { return }
            session.sound = call.getBool("on") ?? true
            self.apply(session)
            call.resolve()
        }
    }

    @objc func setMicrophone(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let session = self.session(call) else { return }
            let on = call.getBool("on") ?? false
            let publish = {
                self.enqueue {
                    do {
                        try await session.room.localParticipant.setMicrophone(enabled: on)
                        call.resolve()
                    } catch {
                        call.reject("The microphone could not be used", "MICROPHONE_FAILED")
                    }
                }
            }
            guard on else { return publish() }
            AVCaptureDevice.requestAccess(for: .audio) { granted in
                DispatchQueue.main.async {
                    // A page load, a closed window, a leave or a newer start under the prompt.
                    guard self.live === session else {
                        return call.reject("No such call", "NOT_CONNECTED")
                    }
                    guard granted else {
                        return call.reject("Microphone access is denied", "PERMISSION_DENIED")
                    }
                    guard AVCaptureDevice.default(for: .audio) != nil else {
                        return call.reject("No microphone", "NO_MICROPHONE")
                    }
                    publish()
                }
            }
        }
    }

    /// The call as it is now. The page asks at its own pace: a listener would be notified here
    /// while the bridge queue adds and removes listeners.
    @objc func snapshot(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let session = self.session(call) else { return }
            let room = session.room
            let state: String
            switch room.connectionState {
            case .connected: state = "connected"
            case .reconnecting: state = "reconnecting"
            case .connecting: state = "connecting"
            default: state = "disconnected"
            }
            let participants: [[String: Any]] = room.remoteParticipants.values.compactMap { participant in
                guard let identity = participant.identity?.stringValue else { return nil }
                return [
                    "identity": identity, "speaking": participant.isSpeaking,
                    "microphone": participant.isMicrophoneEnabled()
                ]
            }
            call.resolve([
                "state": state,
                "local": [
                    "speaking": room.localParticipant.isSpeaking,
                    "microphone": room.localParticipant.isMicrophoneEnabled()
                ],
                "participants": participants
            ])
        }
    }

    @objc func disconnect(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.live?.id == call.getString("id") { self.endLive() }
            call.resolve()
        }
    }

    /// The page is going, or its process ended (main queue): its call ends, and a start or a
    /// microphone prompt still on its way connects nothing.
    @objc private func pageWillLoad() {
        generation += 1
        endLive()
    }

    /// The window closed (main queue), for good.
    func close() {
        closed = true
        pageWillLoad()
    }
}
#endif
```

The code above is the design; it has not been compiled. Where the compiler disagrees (Swift
concurrency warnings promoted to errors, an argument label), make the smallest change that keeps
the contract test's assertions true, and say what changed in the report.

- [ ] **Step 3: Register, close, guard the recorder, add the file to the project**

- `MindRoomBridgeViewController.swift`, inside the existing block at `:47-52`: after the recorder's line add `bridge?.registerPluginInstance(MindRoomCallPlugin())`, and change the comment to "Mac Catalyst's WebKit has no media capture and no WebRTC. Only the main window records voice and makes calls."
- `SceneDelegate.swift`, before the recorder's `close()` at `:86-87`: `((window.rootViewController as? CAPBridgeViewController)?.bridge?.plugin(withName: "MindRoomCall") as? MindRoomCallPlugin)?.close()`, with the comment "Its call ends with it, as its recording does."
- `MindRoomVoiceRecorderPlugin.swift`: wrap the two session lines of `start` in `if MindRoomCallPlugin.liveSessions == 0 { ... }` (keeping the lines themselves as they are), and put `if MindRoomCallPlugin.liveSessions == 0 { ... }` around each of the three `try? ...setActive(false, options: .notifyOthersOnDeactivation)` lines; one comment at the first: "A call owns the audio session while it runs (MindRoomCallPlugin)."
- `project.pbxproj`: add `MindRoomCallPlugin.swift` exactly as `MindRoomVoiceRecorderPlugin.swift` is listed (lines with `5A0000000000000000000001` to `...03`), with IDs `5B0000000000000000000001` (file reference), `5B0000000000000000000002` (`App` sources) and `5B0000000000000000000003` (`AppStoreMac` sources).

- [ ] **Step 4: Verify without a Mac**

Run: `nix develop -c just test src/app/native` : PASS, including `nativeVoiceRecorderIOSContract.test.ts`, `macCatalystShell.test.ts` and `macCatalystBuildConfig.test.ts` unchanged. `just strict`, `just lint`: clean.

- [ ] **Step 5: Build on the Mac**

Transfer the branch (Task 1 Step 4) and run `build.sh App mac` and `build.sh AppStoreMac store`.
Expected: `** BUILD SUCCEEDED **` twice. Also run the iOS routing host, which compiles every file
of `ios/App/App/` without LiveKit: `$MAC_SSH 'cd ~/repos/worktrees/mindroom-chat-mac-native-calls && /usr/bin/env -i HOME=$HOME PATH=/usr/bin:/bin:/usr/sbin:/sbin /bin/bash scripts/test-ios-routing.sh 2>&1 | tail -5'` : passes.

- [ ] **Step 6: Commit** the five files and the test: "Mac app: MindRoomCall plugin on the LiveKit Swift SDK".

---

### Task 6: Licenses, docs, and the Store entitlement if the spike asked for it

**Files:**
- Create: `licenses/LiveKit-notices.txt`
- Modify: `NOTICE`, `docs/development.md:104`
- Only if the spike recorded "network.server: needed": `ios/App/App/App-macOS-AppStore.entitlements`, `scripts/macos-store-preflight.mjs:57-66`, `src/app/native/macStorePreflight.test.ts`

- [ ] **Step 1: Check the Rust crates inside LiveKitFFI**

On the Mac (it has rustup; `export PATH=$HOME/.cargo/bin:$PATH`), in `/tmp/mac-call-probe/rust-sdks`: `git clone --depth 1 --branch livekit-ffi/v0.13.1 https://github.com/livekit/rust-sdks`, then `cargo metadata --format-version 1 --filter-platform aarch64-apple-ios-macabi > metadata.json`. With a short Python script, walk the normal (not dev, not build) dependencies from the package whose manifest is `livekit-ffi/Cargo.toml` and print `name version license` per crate, sorted. Every license expression must be satisfiable with: MIT, MIT-0, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Zlib, Unicode-3.0, Unicode-DFS-2016, CC0-1.0, BlueOak-1.0.0, MPL-2.0 (an OR needs one side, an AND both; the rule of `scripts/watch/check_sdk_licenses.py`). A crate outside the list, or a GPL, AGPL or LGPL license anywhere: **STOP** and report the crate.

- [ ] **Step 2: Write the notices**

`licenses/LiveKit-notices.txt`: the Apache-2.0 text once (from the SDK's `LICENSE`), the SDK's `NOTICE`, the `LICENSE` file inside `LiveKitWebRTC.xcframework` (in the Mac's DerivedData under `SourcePackages/artifacts/`), and the crate list of Step 1 under the heading "Rust crates linked into LiveKitFFI 0.13.1".

`NOTICE`, a section after "Sparkle (Mac app updater)" in the same shape:

```
LiveKit (Mac app calls)
  LiveKit Swift SDK 2.19.0, Copyright 2023 LiveKit, Inc., Apache License 2.0
  (https://github.com/livekit/client-sdk-swift), with the binaries it pins:
  LiveKitWebRTC 150.7871.04 (https://github.com/livekit/webrtc-xcframework, a
  build of WebRTC, BSD 3-Clause, Copyright The WebRTC project authors, with the
  third-party parts its license file names) and LiveKitFFI 0.13.1
  (https://github.com/livekit/rust-sdks, Apache License 2.0, and the Rust
  crates it links). The Mac apps link them unmodified through Swift Package
  Manager. License texts: licenses/LiveKit-notices.txt.
```

- [ ] **Step 3: Docs**

`docs/development.md:104`: replace "calls are unavailable there for the same reason" with: "calls carry audio only there, through `MindRoomCallPlugin` on the LiveKit Swift SDK (`src/app/calls/nativeCallMedia.ts`, `src/app/native/nativeCall.ts`; the package is linked for Mac Catalyst only, so iPhone and iPad builds do not contain it), for the same reason".

- [ ] **Step 4: The Store entitlement, only when needed**

If the spike results say "network.server: needed": add `<key>com.apple.security.network.server</key><true/>` after the `network.client` entry of `App-macOS-AppStore.entitlements`; add `'com.apple.security.network.server'` to the required list in `scripts/macos-store-preflight.mjs:57-66`; add it to the fixture and the required-keys list in `macStorePreflight.test.ts` (`:32`, `:127`), with a new assertion that a build without it is reported. Otherwise change none of the three.

- [ ] **Step 5: Verify and commit**

Run: `nix develop -c just script-tests`, `nix develop -c just license-check`, `nix develop -c just test src/app/native` : PASS. Commit: "Mac app calls: notices and docs".

---

### Task 7: Prove the real plugin on the Mac, then run every gate

**Files:**
- Probe branch only: `scripts/mac-call-probe/plugin-run.sh`, a second mode in `MindRoomCallProbe.swift`
- Modify: the spec (a `## Mac verification results` section)

- [ ] **Step 1: Give the probe a plugin mode**

Rebase the probe branch onto the feature branch (`git switch probe/mac-native-calls && git rebase feat/mac-native-calls`, then back). Add to the probe: when launched with `-MindRoomCallPluginProbe <base64 JSON>` (the same scenario shape plus `"steps": [...]`), it waits until the main window's web view has finished loading, then runs a script in the page with `webView.callAsyncJavaScript(_:arguments:in:in:)` that drives `window.Capacitor.Plugins.MindRoomCall` exactly as `NativeCallMedia` does (sets `window.mindroomCallStart`, `connect`, `setKey` per key with `own` for its own, `setMembers`, `setMicrophone`, a `snapshot` every 250 ms), and logs `call-probe: plugin <step> <JSON result or error code>`. The 440 Hz tone and the audio renderer stay native, attached through the plugin's room (make `MindRoomCallPlugin`'s `live` session readable by the probe on the probe branch only).

Steps the scenario can name, each logged with `engineRunning=<Bool>` two seconds after it:

| Step | Does | Expected log |
|---|---|---|
| `call` | connect, keys, members, microphone on, 12 s, `disconnect` | tones both ways (`verdict.mjs`), then `engineRunning=false` |
| `mute` | during a call `setMicrophone(false)`, 4 s, `setMicrophone(true)` | the browser's `rms` drops under 0.001 and comes back; snapshot `local.microphone` false then true |
| `late-joiner` | the browser peer starts 6 s after the Mac | the browser still hears 440 Hz: permissions and subscription were applied when it connected |
| `non-member` | `setMembers` without the browser's identity | both sides silent; then `setMembers` with it: both hear |
| `sound-off` | `setSound(false)`, 4 s, `setSound(true)` | the Mac's renderer still decodes (it sits before playout), so check `volume` of the remote track: 0 then 1 |
| `reload-in-call` | `webView.reload()` during a call | `engineRunning=false`; the old `id`'s `snapshot` is not answered (the page is gone); a `connect` from the new page works |
| `reload-under-prompt` | under a fresh bundle ID: `setMicrophone(true)`, then `webView.reload()` before `allow.applescript` clicks | after Allow: no microphone publication, `engineRunning=false` |
| `twice` | two `connect` calls 50 ms apart from one page | exactly one resolves with an `id`; the other rejects `START_FAILED`; one session lives |
| `stale-nonce` | `connect` with a `nonce` that is not `window.mindroomCallStart` | rejects `START_FAILED`; nothing connects |
| `bad-token` | `connect` with a token signed with a wrong secret | rejects `CONNECT_FAILED`; `engineRunning=false`; `liveSessions` is 0 |
| `close-window` | `UIApplication.shared.requestSceneSessionDestruction` of the main scene during a call | `engineRunning=false` |
| `voice-message` | during a call with the microphone on, drive `MindRoomVoiceRecorder` `start`, 2 s, `stop` | the recording has audio (`afinfo`), and the browser still hears 440 Hz afterwards |

- [ ] **Step 2: Run them**

Start the rig as in Task 1 Step 7. Build `App` with `PRODUCT_BUNDLE_IDENTIFIER=chat.mindroom.callprobe4` (and `...callprobe5` for `reload-under-prompt`), run every step in an encrypted scenario, and `call` also unencrypted and in the ad hoc signed sandboxed `AppStoreMac` build (Task 1 Step 9, with the entitlement set the spike found necessary).

Expected: every row as in the table. A row that fails is a defect in the plugin or the backend: fix it on the feature branch with a failing contract or unit test first, rebuild, rerun that row and `call`. If a row cannot be made to pass, commit, **STOP**, and report it.

- [ ] **Step 3: Record and clean up**

Append `## Mac verification results` to the spec: one line per row (PASS, or what was seen), the macOS and Xcode versions, and the list "left for a person at the Mac" copied from the spec's "Only Bas can check". Commit.

On the Mac: stop the rig; kill your probes by PID; move `/tmp/mac-native-calls-dd-*` and `/tmp/mac-call-probe` to `~/.Trash/mac-native-calls-cleanup/`; `git -C ~/repos/dev/mindroom-chat worktree remove --force ~/repos/worktrees/mindroom-chat-mac-native-calls`; confirm with `git -C ~/repos/dev/mindroom-chat worktree list`. Report the probe bundle IDs, whose microphone permissions stay in System Settings until someone removes them. Keep the local branch `probe/mac-native-calls`; do not merge it.

- [ ] **Step 4: Every gate, on the final commit**

```bash
nix develop -c just typecheck                                        # 0 errors
nix develop -c just strict                                           # 0 errors
NODE_OPTIONS=--max-old-space-size=6144 nix develop -c just lint      # 0 problems
nix develop -c just test src/app/calls src/app/native src/app/i18n   # all pass
nix develop -c just script-tests                                     # pass
nix develop -c just license-check                                    # pass
git diff --numstat e97db060d -- src/app/calls/RoomCall.test.ts       # deletions column is 0
git status --short                                                   # empty
```

- [ ] **Step 5: Report**

In the final message: the head commit; the spike table; the Mac verification table; added and removed production lines (`git diff --stat e97db060d -- src ios ':!*.test.*'`); every STOP reached or deviation from this plan, with its reason; what a person must still check by ear.
