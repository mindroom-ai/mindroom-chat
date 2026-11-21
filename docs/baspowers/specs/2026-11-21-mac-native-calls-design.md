# Audio calls in the Mac app through the LiveKit Swift SDK: design

Date: 2026-11-21. Branch `feat/mac-native-calls`, from `origin/main` `e97db060d`.
Plan: `docs/baspowers/plans/2026-11-21-mac-native-calls.md`.

## Problem

In the Mac app (Mac Catalyst, a Capacitor `WKWebView`) the agent call button answers
"Voice call error: Your browser does not support WebRTC." The message is correct and useless:
Catalyst's WebKit is built without `RTCPeerConnection`, `navigator.mediaDevices` and
`MediaRecorder`, and no preference turns them on (verified on macOS 26.5.2 for the voice recorder,
`docs/baspowers/specs/2026-11-18-mac-native-voice-recorder-design.md`). Voice messages already go
through a Catalyst-only native plugin (`ios/App/App/MindRoomVoiceRecorderPlugin.swift`). Calls need
the same move for live media.

## Decision and scope

Decided, not reopened here:

- The Mac app makes real calls. MatrixRTC membership, call state, media keys over Olm and the
  call service grant stay in JavaScript. A Catalyst-only Capacitor plugin built on the LiveKit
  Swift SDK carries the media.
- `RoomCall` talks to media through one interface with two backends: the browser's
  (`livekit-client`, today's code moved, behaviour unchanged) and the native one.
- Version 1 is audio only. Video, screen sharing, device choice and this device's part in a room
  call's live transcript are out of scope, and their controls are hidden in the Mac app.
- Where calls still cannot work in the Mac app (no plugin: the Quick Capture window, a failed
  registration), the message says so instead of blaming a browser.
- It must work with web clients (`livekit-client` 2.24.1 with its `e2ee-worker`) and with the
  MindRoom agent (Python LiveKit SDK), in encrypted and unencrypted rooms.

## Current flow

All paths are in this repository at `e97db060d` unless they name another one.

| Step | Where |
|---|---|
| "Can this device call?" is `RTCPeerConnection` plus `getUserMedia` | `src/app/calls/callSupport.ts:6-9` |
| Agent call button refuses with error `browser` | `src/app/calls/agent/agentCaller.ts:176-179`, copy key `:73` |
| Prescreen blocks Join with the WebRTC text | `src/app/calls/CallPanel.tsx:451-452` |
| `RoomCall.join` refuses with problem `browser` | `src/app/calls/RoomCall.ts:507-510`, copy key `CallPanel.tsx:135` |
| Membership listeners, leftover withdrawal, service choice, grant | `RoomCall.ts:511-538`, `rtcFocus.ts:127-137`, `:164-192` |
| Key provider made, membership announced (`joinRTCSession`) | `RoomCall.ts:542-560` |
| Worker, LiveKit room, events, frame encryption on, connect | `RoomCall.ts:562-592` |
| Members only: subscription permissions and audio elements | `RoomCall.ts:328-345` |
| Own key set again after connect, microphone, camera | `RoomCall.ts:596-616` |
| Keys from the session to the provider; own key sent again | `RoomCall.ts:387-441`, `callKeyProvider.ts:14-24`, `:47-82` |
| Participants for the tiles | `RoomCall.ts:269-297` |
| Teardown | `RoomCall.ts:681-707` |
| Page reload: the call is remembered on `pagehide` and taken up again | `src/app/calls/CallFeatures.tsx:49`, `callResume.ts` |
| Room call transcript reads the microphone `MediaStreamTrack` | `src/app/calls/transcription/CallTranscription.tsx:26`, `:109-113` |
| Device menu reads `navigator.mediaDevices.enumerateDevices` | `src/app/calls/CallControls.tsx:99-125` |
| Native plugins registered per bridge; the recorder only on the main window | `ios/App/App/MindRoomBridgeViewController.swift:41-61` |
| A closed window ends its recorder | `ios/App/App/SceneDelegate.swift:83-90` |

How the web side keys frames (`callKeyProvider.ts:14-24` and `livekit-client` 2.24.1):
`sharedKey: false`, ratchet salt `LKFrameEncryptionKey`, `ratchetWindowSize: 10`,
`failureTolerance: 10` (the default), `keyringSize: 256`, `keySize: 128`. A key arrives as raw
bytes with an index (0 to 255) and a participant identity `<user id>:<device id>`. The bytes are
imported as HKDF material (`createKeyMaterialFromBuffer`,
`node_modules/livekit-client/src/e2ee/utils.ts:61-68`) and the AES-GCM 128 key is derived with
HKDF-SHA-256, the salt above and 128 zero bytes of info (`utils.ts:70-115`).

How the agent keys frames (MindRoom backend, `src/mindroom/matrix_rtc/voice_agent.py:501-506`,
`:544`): `ratchet_window_size=10`, `key_ring_size=256`,
`key_derivation_function=rtc.KeyDerivationFunction.HKDF`,
`key_provider.set_key(identity, key, index)`. The agent already works with the web client, so
HKDF with these values is the format to match.

## Verified facts about the native SDK

LiveKit Swift SDK `2.19.0` (`https://github.com/livekit/client-sdk-swift`, commit `43c1c0870`,
Apache-2.0). Paths below are in that repository.

- **Platforms.** `Package.swift`: `.macCatalyst(.v14)`, swift-tools 6.1 (Xcode 16.3 or newer; the
  build Mac has Xcode 26.6). Its binary dependencies are pinned exactly:
  `webrtc-xcframework` `150.7871.04` and `livekit-ffi-xcframework` `0.13.1`. Both release zips
  hold an `ios-arm64_x86_64-maccatalyst` slice (read from the zips' directories).
- **Distribution.** Swift Package Manager. CocoaPods is not an option: the trunk's newest
  `LiveKitClient` is 2.0.18, `LiveKitFFI` is not on the trunk, and the SDK's README calls its
  CocoaPods support deprecated. The project already mixes CocoaPods (Capacitor) with Swift
  packages (`ios/App/App.xcodeproj/project.pbxproj:1586-1613`).
- **Per-participant keys with HKDF.** `Sources/LiveKit/E2EE/KeyProvider.swift`:
  `KeyDerivationAlgorithm.hkdf` (`:32-37`), `KeyProviderOptions(sharedKey:ratchetSalt:ratchetWindowSize:uncryptedMagicBytes:failureTolerance:keyRingSize:discardFrameWhenCryptorNotReady:keyDerivationAlgorithm:)`
  (`:57-64`), `BaseKeyProvider(options:)` (`:140`),
  `setKey(keyData:participantId:index:)` (`:168`), `setCurrentKeyIndex(_:)` (`:229`). In
  non-shared mode `setKey` does not move the index the local participant encrypts with;
  `setCurrentKeyIndex` does (`CHANGELOG.md:18`).
- **The derivation matches.** The WebRTC build's frame cryptor
  (`webrtc-sdk/webrtc`, branch `m150_release`, `api/crypto/frame_crypto_transformer.cc:236-257`)
  derives with HKDF-SHA-256, the ratchet salt and 128 zero bytes of info, to 128 bits: the same
  inputs as `livekit-client`. A frame without a key is dropped and not counted against the
  failure tolerance (`:548-562`, `:774-787`).
- **Room.** `Room(delegate:connectOptions:roomOptions:)` (`Sources/LiveKit/Core/Room.swift:277`),
  `connect(url:token:connectOptions:roomOptions:)` (`:385`), `disconnect()` (`:530`),
  `connectionState` (`:87`), `remoteParticipants` (`:63`), `localParticipant` (`:123`).
  `RoomOptions(... encryptionOptions:)` (`Sources/LiveKit/Types/Options/RoomOptions.swift:90-104`),
  `EncryptionOptions(keyProvider:encryptionType:)` (`Sources/LiveKit/E2EE/Options.swift:108`).
- **Participants.** `Participant.identity?.stringValue`, `sid?.stringValue`, `isSpeaking`,
  `audioTracks`, `isMicrophoneEnabled()` (`Sources/LiveKit/Participant/Participant.swift:31-39`,
  `:82`, `:311`); `LocalParticipant.setMicrophone(enabled:)` (`LocalParticipant.swift:455`);
  `setTrackSubscriptionPermissions(allParticipantsAllowed:trackPermissions:)` (`:194`), sent
  again by the SDK after a reconnect (`Sources/LiveKit/Core/Room+EngineDelegate.swift:32-41`);
  `ParticipantTrackPermission(participantSid:allTracksAllowed:)`
  (`Sources/LiveKit/Types/ParticipantTrackPermission.swift:38`). It takes a participant **sid**,
  not an identity, so only devices already on the media server can be named.
- **Remote audio** plays by itself once subscribed. `ConnectOptions(autoSubscribe: false)`
  (`Sources/LiveKit/Types/Options/ConnectOptions.swift:99`) subscribes to nothing until
  `RemoteTrackPublication.set(subscribed:)`
  (`Sources/LiveKit/TrackPublications/RemoteTrackPublication.swift:63`) asks.
  `RemoteAudioTrack.volume` (0 mutes, `Sources/LiveKit/Track/Remote/RemoteAudioTrack.swift:37`).
- **Audio session.** Mac Catalyst compiles the `os(iOS)` branches, so the SDK configures
  `AVAudioSession` itself (`Sources/LiveKit/Audio/AudioSessionEngineObserver.swift`): `.playback`
  while it only plays, `.playAndRecord` with mode `.videoChat` from the first recording until
  the engine stops (`:254-260`, `Sources/LiveKit/Types/AudioSessionConfiguration.swift:58-60`),
  never `.record`, and `setActive(false, options: .notifyOthersOnDeactivation)` when playout and
  recording have both stopped (`:196-204`).
- **Devices.** Input and output choice is `os(macOS)` only
  (`Sources/LiveKit/Audio/Manager/AudioManager.swift:236-279`), so not on Catalyst: the system
  default devices are used.
- **Delegate.** `RoomDelegate` (`Sources/LiveKit/Protocols/RoomDelegate.swift`):
  `room(_:participantDidConnect:)` (`:98`), `room(_:participant:didPublishTrack:)` for a remote
  participant (`:143`), `room(_:participant:didSubscribeTrack:)` (`:158`),
  `roomDidReconnect(_:)` (`:56`).

## Architecture

```
RoomCall (membership, keys, state)          src/app/calls/RoomCall.ts
   |  CallMedia interface                   src/app/calls/callMedia.ts
   +-- WebCallMedia  (livekit-client)       src/app/calls/webCallMedia.ts
   +-- NativeCallMedia (polls the plugin)   src/app/calls/nativeCallMedia.ts
          |  Capacitor bridge               src/app/native/nativeCall.ts
          MindRoomCallPlugin (LiveKit Swift SDK)   ios/App/App/MindRoomCallPlugin.swift
```

`src/app/native` is a lower layer than `src/app/calls` (`.eslintrc.cjs:91-109`), so the plugin's
typed wrapper lives in `native/` and knows nothing of calls; the backend that speaks `CallMedia`
lives in `calls/`.

### Which backend

`src/app/calls/callSupport.ts` gains:

```ts
/** What carries a call's media here: the browser's WebRTC, the Mac app's plugin, or nothing. */
export type CallMediaKind = 'web' | 'native';
export const callMediaKind = (): CallMediaKind | undefined => {
  if (browserSupportsCalls()) return 'web';
  return isNativeCallAvailable() ? 'native' : undefined;
};
/** The problem a device that cannot call is told. */
export const callUnsupportedProblem = (): 'macApp' | 'browser' => (isMacApp() ? 'macApp' : 'browser');
```

`browserSupportsCalls()` keeps its meaning (WebRTC in this web view). The native backend is used
only where WebRTC is missing and the plugin is registered, which is the Mac app's main window.
iPhone and iPad have WebRTC and keep the web backend.

### The seam: exact types (`src/app/calls/callMedia.ts`)

```ts
import type { SfuGrant } from './rtcFocus';
import type { CallDeviceKind, CallDevices, CallVideoTrack } from './RoomCall';

/** One device on the media server, as a tile reads it. */
export type CallMediaParticipant = {
  speaking: boolean;
  microphone: boolean;
  video?: CallVideoTrack;
  screen?: CallVideoTrack;
};

/** What a media backend asks of, and tells, the call that owns it. */
export type CallMediaHost = {
  /** Whether the media identity is a member of the call now. */
  isMember(identity: string): boolean;
  /** Something a tile or the panel shows changed. */
  onChange(): void;
  /** A device joined the media server. */
  onParticipantConnected(identity: string): void;
  onPhase(phase: 'reconnecting' | 'connected'): void;
  /** The media server dropped this device for good. */
  onDisconnected(): void;
  onDevice(kind: CallDeviceKind, deviceId: string): void;
};

/** A call's media connection. Every method is safe before `connect` and after `disconnect`. */
export interface CallMedia {
  setKey(key: Uint8Array, index: number, identity: string, own: boolean): Promise<void>;
  /** False when `stopped()` turned true before the connection was made; rejects when it fails. */
  connect(
    grant: SfuGrant,
    options: { devices: CallDevices; stopped: () => boolean }
  ): Promise<boolean>;
  connected(): boolean;
  participant(identity: string, local: boolean): CallMediaParticipant | undefined;
  /** Only these devices are heard, and only they receive this device's tracks. */
  setMembers(identities: ReadonlySet<string>): void;
  setMicrophone(on: boolean): Promise<void>;
  setCamera(on: boolean): Promise<void>;
  setScreenShare(on: boolean): Promise<void>;
  screenShare(): boolean;
  setSound(on: boolean): void;
  setDevice(kind: CallDeviceKind, deviceId: string): Promise<void>;
  audioBlocked(): boolean;
  resumeAudio(): Promise<void>;
  microphoneTrack(): MediaStreamTrack | undefined;
  /** Stops what the page itself holds (listeners, audio elements, polling); synchronous. */
  silence(): void;
  disconnect(): Promise<void>;
  /** After `disconnect` settled: lets go of the rest (the encryption worker). */
  dispose(): void;
}
```

The interface is wide on purpose: each member is one place where `RoomCall` touches
`livekit-client` today, so the web backend is a move, not a redesign.

### Web backend: the equivalence rules

`WebCallMedia` (`webCallMedia.ts`) receives the code of `RoomCall.ts:299-316` (audio elements),
`:328-345` (members), `:347-379` (events), `:564-583` (worker, room, encryption, connect) and the
`livekit-client` calls of the setters. The rules that keep the web path as it is:

1. `src/app/calls/RoomCall.test.ts` (954 lines) passes **unedited**. It mocks `livekit-client`,
   the worker module and `./callKeyProvider` by module, so it exercises the moved code through
   `RoomCall` and is the oracle for this refactor.
2. The backend is made where the key provider is made today (`RoomCall.ts:542`), with a
   `MatrixRtcKeyProvider` only for an encrypted room. Its LiveKit room and worker are made inside
   `connect`, in today's order: worker, room, event handlers, `setE2EEEnabled(true)`, the
   `stopped()` check (answering `false` without connecting), `connect`.
3. Before its room exists every read answers as "no media" does today (`connected()` false,
   `participant()` undefined, `audioBlocked()` false, `screenShare()` false, `microphoneTrack()`
   undefined) and every setter does nothing.
4. `RoomCall.join` refuses exactly as today unless the native backend applies:
   `!deviceId || (!native && !webCallMediaSupported(encrypted))`, where
   `webCallMediaSupported` is `isBrowserSupported() && (!encrypted || isE2EESupported())`.
5. Teardown keeps its order: `silence()` (the `Restarted` listeners and the audio host), the
   `microphoneTrack` update, then `disconnect()` beside the membership leave, then `dispose()`
   (the worker) in `finally`.
6. Event handlers stay attached to the LiveKit room after teardown, as today; they reach
   `RoomCall` through the host, whose `fail` and `refresh` already ignore a stopped call.

### Native backend (`nativeCallMedia.ts`)

- **No events from native.** The page polls `snapshot({ id })` every 250 ms and compares it
  with the last one. The recorder taught this: a `notifyListeners` from the main queue raced the
  listener changes Capacitor makes on its bridge queue, and its `level` became a polled method.
  Polling also needs no ordering rules and loses nothing over a reload. A hidden window's timers
  slow to about one a second, which only delays the speaking rings.
- From two snapshots: a new identity is `onParticipantConnected`; `connected` to `reconnecting`
  is `onPhase('reconnecting')`, back is `onPhase('connected')`; state `disconnected`, or a
  `snapshot` rejected with `NOT_CONNECTED`, is `onDisconnected` once and ends the polling; any
  other difference is `onChange`. Other rejections are ignored (the next poll asks again).
- Until `connect` answered with the session `id`, `setKey`, `setMembers` and `setSound` are kept
  and sent in order right after it. A frame that arrives before its key is dropped by the
  cryptor and not held against the key, so nothing is lost by sending keys after the connect.
- `setCamera(true)` rejects; `setCamera(false)`, `setScreenShare`, `setDevice` and `resumeAudio`
  resolve without doing anything; `screenShare()` and `audioBlocked()` are false;
  `microphoneTrack()` is undefined; `participant()` never has `video` or `screen`.
- `silence()` ends the polling. `disconnect()` calls the plugin when the `id` is known; a
  `connect` that answers after `silence()` starts no polling, and `RoomCall` then calls
  `disconnect()` again (as it does today for a call left while connecting), which ends the native
  session.

## The plugin (`MindRoomCallPlugin`, JS name `MindRoomCall`)

Catalyst-only (`#if targetEnvironment(macCatalyst)` around the whole file, `import LiveKit`
inside it), registered on the main window's bridge only, like the recorder. One live session at
a time. Every method returns a promise; rejections carry `code`.

| Method | Arguments | Resolves | Rejects with |
|---|---|---|---|
| `connect` | `{ nonce: string, url: string, token: string, encrypted: boolean }` | `{ id: string }` (a UUID) | `START_FAILED`, `CONNECT_FAILED` |
| `setKey` | `{ id, identity: string, index: number, key: string, own: boolean }` (`key` is base64) | nothing | `NOT_CONNECTED`, `BAD_KEY` |
| `setMembers` | `{ id, identities: string[] }` | nothing | `NOT_CONNECTED` |
| `setSound` | `{ id, on: boolean }` | nothing | `NOT_CONNECTED` |
| `setMicrophone` | `{ id, on: boolean }` | nothing | `NOT_CONNECTED`, `PERMISSION_DENIED`, `NO_MICROPHONE`, `MICROPHONE_FAILED` |
| `snapshot` | `{ id }` | `NativeCallSnapshot` | `NOT_CONNECTED` |
| `disconnect` | `{ id }` | nothing, also for an unknown `id` | never |

```ts
export type NativeCallSnapshot = {
  state: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  local: { speaking: boolean; microphone: boolean };
  participants: Array<{ identity: string; speaking: boolean; microphone: boolean }>;
};
```

`NOT_CONNECTED` means the `id` is not the live session's: it ended, or another start replaced it.

Native rules:

- All plugin state lives on the main queue. LiveKit's async calls run one after another in a
  serial chain, in the order the page made them, so permissions are set before the microphone
  publishes and a key before the audio it protects.
- The room connects with `autoSubscribe: false`, and the session starts with no members and
  sound on: nothing is subscribed to, nobody is heard and nobody may subscribe until
  `setMembers` names the call's members. One native function then subscribes to the audio tracks
  of members only (video is never subscribed to), sets every subscribed audio track's `volume`
  to 1 while sound is on, else 0, and sends
  `setTrackSubscriptionPermissions(allParticipantsAllowed: false, ...)` with the sids of the
  members present. It runs on `setMembers` and `setSound`, and again when a participant
  connects, publishes a track, a track is subscribed, and after a reconnect, without waiting
  for the page.
- `setMicrophone(on: true)` asks `AVCaptureDevice.requestAccess(for: .audio)` first. After the
  prompt it goes on only if the session is still the live one.
- The plugin never logs the token or a key, and has no `notifyListeners`.

## Media keys

1. matrix-js-sdk's session hands `RoomCall.onKey` a raw key, its index and the participant
   identity (`RoomCall.ts:387-403`). Unchanged.
2. `RoomCall` calls `media.setKey(key, index, identity, identity === own identity)`.
3. Web: `MatrixRtcKeyProvider.setParticipantKey`, as today.
4. Native: `setKey({ id, identity, index, key: base64, own })`. The plugin decodes the bytes and
   calls `keyProvider.setKey(keyData:participantId:index:)`; for `own` it also calls
   `keyProvider.setCurrentKeyIndex(index)`, which is what makes the microphone encrypt with that
   index.
5. The provider is `BaseKeyProvider(options: KeyProviderOptions(sharedKey: false,
   ratchetWindowSize: 10, failureTolerance: 10, keyRingSize: 256,
   keyDerivationAlgorithm: .hkdf))`, with the default salt `LKFrameEncryptionKey`, inside
   `RoomOptions(encryptionOptions: EncryptionOptions(keyProvider:, encryptionType: .gcm))`. An
   unencrypted room passes no encryption options and receives no keys.
6. After the connect `RoomCall` sets its own key once more (`RoomCall.ts:596-601`); natively that
   repeats step 4 and changes nothing.
7. Sending the own key to the others (`sendCallKey`, `resendOwnKey`) stays in JavaScript. A new
   participant in a snapshot triggers the resend that `ParticipantConnected` triggers on the web.

Keys cross the Capacitor bridge inside the app's own process boundary, as they cross to the
encryption worker on the web. They are never written to disk or a log.

## Lifecycle

The session belongs to the page that started it. Native media must never outlive that page: a
live microphone with no page to show or end it is the failure to prevent.

| Event | What happens |
|---|---|
| `connect` while the page is loading or the window closed | `START_FAILED`; nothing connects. |
| `connect` from a page since replaced, or an older `connect` of this page | The page names its newest start in `window.mindroomCallStart` and passes the same `nonce`. The plugin reads the name back from the loaded page before it connects and refuses a mismatch with `START_FAILED`. |
| A second `connect` while a session is live | The live session is ended first (newest wins); its `id` answers `NOT_CONNECTED` from then on. |
| The page reloads, navigates, or its WebKit process dies, at any time | The plugin observes `capacitorWebViewNavigationStarted` and `capacitorWebViewTerminated` for its web view, raises its navigation generation and ends the session. A `connect` or a microphone prompt in flight compares the generation (and the live `id`) when it resumes and stops. The reloaded page takes the call up again through `callResume`, with a new session. |
| The window closes | `SceneDelegate.sceneDidDisconnect` calls the plugin's `close()` before it blanks the page: the session ends and the plugin refuses every later `connect`. |
| The microphone prompt is open and any of the above happens | After the answer the session is no longer the live one: `NOT_CONNECTED`, no microphone. |
| Permission denied, or no input device | `PERMISSION_DENIED` or `NO_MICROPHONE`; `RoomCall` shows "Your microphone or camera could not be used." and the call goes on, listening. |
| Leave, or the 5 s leave timeout | `silence()` ends polling, `disconnect({ id })` ends the session beside the membership leave; the call is over for the panel after the leave or its timeout either way. |
| The connection drops | The SDK reconnects by itself (`reconnecting`, then `connected`); permissions and volumes are applied again. When it gives up the state is `disconnected`: `RoomCall` fails with `connection` and its teardown calls `disconnect`. |
| The connect fails (bad grant, no network) | `CONNECT_FAILED`; the plugin has already ended the session. `RoomCall` fails with `service`. |
| The app quits | The process ends; the membership lapses through its delayed leave event, as when a browser tab is killed. |
| The Quick Capture window | Has no plugin and no call. A call UI there would show the Mac text below. |

Every way out goes through one native function that takes the live session and calls
`room.disconnect()`. There is no path that drops the session without it.

### Audio session

The plugin sets no category. The SDK does: `.playback` while only listening, `.playAndRecord`
(mode `.videoChat`) from the first time the microphone is on until the engine stops, never
`.record`, and it deactivates the session (`.notifyOthersOnDeactivation`) when the engine stops,
which `room.disconnect()` causes. So "deactivated on every exit" follows from "every exit
disconnects", and the Mac checks below prove it per exit.

One interaction: the voice recorder sets `.playAndRecord` with mode `.default` and deactivates
the session when it stops, which during a call would retune or silence the call. While a call
session is live the recorder leaves the audio session alone (it neither sets the category nor
activates or deactivates). Known limit: if the microphone was never on in that call, the
recording may fail to start, with the existing "Microphone is unavailable right now" text.

## What the Mac app hides, and the fallback text

With the native backend (`callMediaKind() === 'native'`):

- **Camera**: the prescreen's and the call's camera toggles are not rendered
  (`CallPanel.tsx:531-541`, `:253-262`), and `RoomCall` starts with the camera off whatever it
  was asked (a video ring answered on the Mac joins with audio; the resume record keeps
  `camera: false`).
- **Devices**: the device menu is not rendered (`CallPanel.tsx:286-289`, `:542-547`). The system
  default input and output are used.
- **Screen sharing**: already hidden, since `browserSharesScreens()` is false there.
- **Room call transcript**: `CallTranscription` does not start the transcriber for a native
  call, so the Pause and Transcript controls never appear. Calls with an agent keep their live
  transcript: it is posted by the agent and needs no microphone track.
- Remote cameras and screens are not shown: a remote device appears as an audio tile.

Without any backend in the Mac app (`callMediaKind() === undefined && isMacApp()`), the three
places that say "Your browser does not support WebRTC" (`agentCaller.ts:73`, `CallPanel.tsx:135`,
`:452`) show a new text instead. `CallProblem` and `AgentCallError` each gain the member
`macApp`; both map to one key:

- Key: `featureUi.calls.problems.macApp`, in `src/app/i18n/locales/additions/<code>.json` for all
  17 app languages (the repository's rule for new keys; `localeAdditions.test.ts` requires every
  overlay to have exactly the English overlay's keys).
- English: "Calls are not available here in the Mac app. Update the app, or call from a browser."

Browsers keep today's text.

## Integration

- **Package.** An `XCRemoteSwiftPackageReference` to `https://github.com/livekit/client-sdk-swift`
  with `kind = exactVersion; version = 2.19.0`, product `LiveKit`, linked by the `App` target
  (Developer ID app) and the `AppStoreMac` target, each with `platformFilter = maccatalyst`, so
  the iPhone and iPad build of `App` neither links nor embeds it. `Package.resolved` is committed
  at `ios/App/App.xcworkspace/xcshareddata/swiftpm/Package.resolved` (Xcode Cloud does not
  resolve versions itself). The `Podfile` is untouched.
- **Entitlements.** Microphone: both Mac targets have `com.apple.security.device.audio-input`.
  The Store target is sandboxed with `com.apple.security.network.client` only. WebRTC binds UDP
  sockets, which a sandbox may refuse without `com.apple.security.network.server`. The spike
  measures this with an ad hoc signed, sandboxed build; if media connects only with the server
  entitlement, it is added to `App-macOS-AppStore.entitlements` (see Open questions).
- **Licenses.** LiveKit Swift SDK and LiveKitFFI: Apache-2.0. LiveKitWebRTC: WebRTC's BSD-3-Clause
  license with its third-party notices, packaged under MIT. All are on the allowlist. `NOTICE`
  gains a section and `licenses/` the texts, as for Sparkle. The Rust crates inside the prebuilt
  LiveKitFFI are listed once from `livekit/rust-sdks` at tag `livekit-ffi/v0.13.1` and checked
  against the allowlist; a crate outside it stops the work. `just license-check` covers npm
  packages only and is unaffected.
- **Docs.** `docs/development.md:104` (the Mac bullet) says calls run through
  `MindRoomCallPlugin`, audio only.

## Out of scope and known limits

- Video (sending and showing), screen sharing, input and output device choice in the Mac app.
- This device's speech in a room call's live transcript. Its words are missing from that
  transcript; the others' appear in the room afterwards as today.
- CallKit, system call UI, calls that survive the window or the page.
- iPhone, iPad, Android and browsers: unchanged, on the web backend.
- A voice message recorded while a call starts or ends may be cut short.
- Echo cancellation and levels are the SDK's defaults (Apple voice processing).

## Tests

- `RoomCall.test.ts`, unedited: the web path.
- `webCallMedia`: no test file of its own; rule 1 above.
- `nativeCallMedia.test.ts` with a fake plugin and fake timers: the nonce on the page and in
  `connect`; keys, members and sound kept until the `id` and sent in order; base64 and `own`; the
  snapshot differences (new participant, phases, disconnect once, `NOT_CONNECTED`, a transient
  rejection ignored); microphone rejections reach the caller with their code; `silence` stops
  polling; `disconnect` before and after the `id`; a connect that answers after `silence`.
- `RoomCall.native.test.ts`: with `callMediaKind` native, a join connects the plugin with the
  grant, never the LiveKit room; the camera is off for a video start; a key reaches `setKey`
  with `own`; a membership change reaches `setMembers`; a plugin `NOT_CONNECTED` fails the call
  with `connection`; no backend on the Mac fails with `macApp`.
- `callSupport.test.tsx`: the kind for WebRTC, plugin only, neither; the problem on and off the Mac.
- `CallPanel` and agent tests: no camera or device control and no transcriber for a native call;
  the Mac text in the prescreen, the failed panel and the agent notice.
- `nativeCallIOSContract.test.ts` reads the Swift and project sources: plugin name and methods;
  Catalyst-only body; registered inside the Catalyst block and not on the Quick Capture bridge;
  the window-close call; the key provider's five values; `setCurrentKeyIndex` only for `own`;
  the nonce read before connecting; the generation and live-`id` checks after each wait; one
  function ends a session and every exit calls it; no `notifyListeners`, no logging; the package
  pinned exactly with the Catalyst filter in both targets; the recorder's guard.
- Locale tests (`localeAdditions.test.ts`, `englishResources.test.ts`) cover the new key.
- No e2e spec: Playwright has no Catalyst web view. The Mac checks stand in for it.

## Mac verification

**Task 1 gate, before any product code** (a probe app under a throwaway bundle ID, a local
`livekit-server`, and a headless Chromium peer running `livekit-client` 2.24.1 with its
`e2ee-worker`, all on one Mac; details in the plan):

- G1. The SDK links: Debug Catalyst builds of `App` and `AppStoreMac` succeed, and an iOS build
  of `App` holds no LiveKit framework.
- G2. Encrypted room, per-participant HKDF keys: the browser hears the Mac's 440 Hz test tone
  and the Mac hears the browser's 880 Hz tone (decoded audio measured on each side). With the
  microphone on, the audio session category is `.playAndRecord`; after the disconnect the audio
  engine has stopped.
- G3. Negative control: with a wrong key for the sender, each side measures silence.
- G4. Changing the sending key index on each side keeps the tones.
- G5. Unencrypted room: both tones.
- G6. G2 again in an ad hoc signed, sandboxed Store build, which also decides the network
  entitlement.

The rig is first proven with two browser peers. Any gate failing stops the work with a report.
The test tone is mixed into the microphone path by the probe, because the test Mac's lid is
closed and its microphone hears nothing; real speech is for a person to check.

**The implementer self-tests over ssh, after the product code**: the real plugin driven through
the bridge by the probe: a call against the local server with the browser peer (tones both
ways, encrypted and not); mute and unmute; a reload during the microphone prompt and during a
call (the engine stops, the old `id` answers `NOT_CONNECTED`); two connects close together (one
session survives); window close; a bad token; a voice message recorded during a call. After each
exit: engine stopped.

**Only Bas can check**, on a build with the lid open or an external microphone: a call with a
MindRoom agent and a call with a browser, in an encrypted and an unencrypted room, heard both
ways; no echo on speakers; AirPods as input and output; the microphone indicator goes out after
Leave, after closing the window and after a reload; the camera, device and transcript controls
are absent; a video ring is answered with audio.

## Size

Production lines added, tests and documents excluded: about 960, of which about 250 are
`RoomCall.ts` code moved into the web backend (`RoomCall.ts` shrinks by about as much).
Swift plugin 260; project file, registration, window close, recorder guard 55; seam types and
web backend 310; native backend and plugin wrapper 230; support, hidden controls, fallback text
and 17 locale lines 85; `NOTICE` and docs 20. Inside the 1,000 to 1,500 estimate.

## Open questions, with the default taken

1. **Store sandbox**: if the spike shows media needs `com.apple.security.network.server`, add it
   to the Store entitlements (default), or ship calls in the Developer ID app only and show the
   Mac text in the Store app.
2. **A video ring on the Mac**: answer with audio (default), or show that video is not available
   before answering.
3. **Room call transcripts**: this device stays out silently (default), or the panel says its
   words are not transcribed.

## Spike results

Date: 2026-11-21. Environment: macOS 26.5.2 (25F84), Xcode 26.6 (17F113), LiveKit Swift SDK 2.19.0
(`webrtc-xcframework` `150.7871.4` in `Package.resolved`, `livekit-ffi-xcframework` `0.13.1`),
local native `livekit-server` 1.13.11 (Docker bridge WebRTC ICE failed in `s0`; native server
passed `s0` 17/17 both ways: web 445 Hz rms=0.3578, web2 879 Hz rms=0.3494).

| Gate | Result | Evidence (one sample each way) |
|---|---|---|
| G1 | PASS | `App` and `AppStoreMac` Debug Catalyst built (`LiveKitWebRTC.framework`: 27M; `App` bundle: 116M). iOS `App` build (`generic/platform=iOS`) succeeded with no LiveKit framework or binary (only the existing web bundle asset `livekit-client.e2ee.worker-*.js`). |
| G2 (`s1`) | PASS | Web heard 445 Hz rms=0.3456 (17/17); Mac heard 879 Hz rms=0.357 (16/16). `microphone granted=true`, `category=AVAudioSessionCategoryPlayAndRecord engineRunning=true`, `after disconnect engineRunning=false state=true`. |
| G3 (`s2`, `s3`) | PASS | `s2` (wrong Mac key on web): web silent (17/17, maxRms=0.0000), Mac heard 879 Hz rms=0.349 (17/17). `s3` (wrong web key on Mac): web heard 445 Hz rms=0.346 (17/17), Mac silent (17/17, maxRms=0.0000). |
| G4 (`s4`) | PASS | Both sides rotated to key index 1 at 10 s; post-rotation window (13..20 s): web heard 445 Hz rms=0.3454 (8/8), Mac heard 880 Hz rms=0.3513 (7/7). |
| G5 (`s5`) | PASS | Unencrypted room: web heard 445 Hz rms=0.3459 (17/17), Mac heard 879 Hz rms=0.3579 (17/17). |
| G6 (`s1` sandboxed) | PASS | Without `com.apple.security.network.server`: failed (`Code=202`, transport failed). With `com.apple.security.network.server`: web heard 445 Hz rms=0.3458 (17/17), Mac heard 880 Hz rms=0.3506 (16/16), audio session and disconnect checks passed. |

- **Store entitlement**: `network.server: needed`.
- **iOS exclusion**: verified locally (`generic/platform=iOS` build succeeded; zero LiveKit frameworks in `Debug-iphoneos`).
- **SDK API names**: every API name in the design compiled unchanged against LiveKit Swift SDK 2.19.0. Probe-only adjustments: injected the test tone via `AudioManager.shared.capturePostProcessingDelegate` (default voice processing kept enabled), handled interleaved stereo PCM in the probe's `AudioRenderer` (`48000 Hz`, 2 ch interleaved int16), ad hoc signed the probe bundle for dyld library validation, and launched via `open -n` for TCC.
