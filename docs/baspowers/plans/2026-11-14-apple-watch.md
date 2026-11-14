# MindRoom on Apple Watch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:executing-plans (Native): every task builds and runs on the MacBook M2 over SSH with one simulator and one test homeserver, and the tasks lean on each other's Swift types, so one implementer holding the context beats a fresh one per task; a fresh reviewer checks the whole branch at the end.

**Goal:** A native watchOS app that records voice messages into a default room, shows that room's threads, and answers approvals and questions, end-to-end encrypted, signed in and verified by the iPhone app.

**Architecture:** SwiftUI watch app over matrix-rust-sdk's `matrix-sdk-ffi`, built by this repository's script from a pinned SDK tag with a small patch; MindRoom's event formats parsed in a pure Swift package tested on macOS; the iPhone app (web + one Capacitor plugin) mints a login token, hands it over WatchConnectivity and cross-signs the new device.

**Tech Stack:** Swift 5 language mode, SwiftUI, watchOS 10+, WidgetKit, AVFoundation, WatchConnectivity, matrix-rust-sdk `matrix-sdk-ffi` 0.19.1 (Apache-2.0), Capacitor 7 plugin, React + TypeScript (web side), vitest, XCTest/XCUITest, XcodeGen-free `xcodeproj` gem script.

**Spec:** `docs/baspowers/specs/2026-11-14-apple-watch-design.md`

## Global Constraints

- watchOS deployment target 10.0; architectures `arm64` and `arm64_32` for devices, `arm64` for the simulator.
- Thinned watch app (app + widget extension) under 75 MB installed size (App Store limit); budget 70 MB, checked by `scripts/watch/size-check.sh`.
- Bundle ids: `chat.mindroom.app.watchkitapp`, `chat.mindroom.app.watchkitapp.widgets`; app group `group.chat.mindroom.app`; team `DNA6966LGZ`.
- SDK: matrix-rust-sdk tag `matrix-sdk-ffi-0.19.1`, patched only by `ios/Watch/sdk/matrix-rust-sdk.patch`; features `bundled-sqlite,unstable-msc4274` plus the TLS provider task 1 settles; never `sentry`, never `experimental-search`.
- Every Rust crate linked into the watch app has a license from AGENTS.md's list (MIT, Apache-2.0, BSD, ISC, 0BSD, Zlib, Unicode, CC0, BlueOak, MPL-2.0 unmodified); `scripts/watch/check-sdk-licenses.py` fails otherwise.
- Event formats exactly as the web client writes and reads them (spec "Sending", the web client's `src/app/matrix/protocol/toolApproval.ts`, `aiRun.ts`, `threadSummary.ts`, `transcribingPlaceholder.ts`, `src/app/event-store/threads/threadTags.ts`).
- Login token handover message: `{ v: 1, kind: 'credentials', homeserverUrl, userId, loginToken, expiresAt }`; reply `{ v: 1, kind: 'signedIn', userId, deviceId }`; `{ v: 1, kind: 'signOut' }`.
- Device display name `MindRoom Apple Watch`; notification category `MINDROOM_EVENT`; Handoff activity `chat.mindroom.open-thread`.
- Recording: AAC `.m4a`, `audio/mp4`, 16 kHz mono 32 kbps, file name `voice-message-<ISO time with : and . as ->.m4a`, at most 5 minutes; waveform 48 values 0 to 1024 (the SDK scales the `Float` 0 to 1 input).
- Thread list: first page of 30; timelines use the patched filter `.defaultAndEventTypes(eventTypes: ["io.mindroom.tool_approval", "io.mindroom.tool_approval_response"])`.
- Commits unsigned (`git -c commit.gpgsign=false commit`), files added by path, no em dashes; Lane C rules for every new TypeScript file (`just strict`, `just lint`).

## Settled by the spike (2026-11-14, watchOS 26.5 simulator, Tuwunel `v1.9.4-mindroom.43`)

- `POST /login/get_token` asks for UIA (`m.login.password` worked), then returns a 120 s token; `/login` with `m.login.token` gives the watch its device; `Client.restoreSession` takes it.
- Encrypted room: the watch decrypts another device's message and sends an encrypted voice message whose content carries `org.matrix.msc3245.voice`, `org.matrix.msc1767.audio` (`duration` ms, waveform 0 to 1024) and `file`.
- The SDK's default timeline filter hides custom event types and `TimelineFilter.all` keeps it; the patch adds `TimelineFilter.defaultAndEventTypes`. With it a card shows as `MsgLikeKind.other` with its JSON in `lazyProvider.debugInfo().originalJson`; an `m.replace` of a card arrives as a second `other` item.
- `ThreadListService.paginate()` is a no-op once the end is reached; refresh with `reset()` then `paginate()`, or follow `subscribeToItemsUpdates`.
- `sendStateEventRaw` writes `com.mindroom.thread.tags`. Memory after all of it: 25 MB.
- Untrimmed device binary: 110 MB stripped, over the limit; task 1 trims it.

## Review Focus

1. A login token that expired before the watch read it (watch app installed later): the watch must say "Connect again from your iPhone", not spin.
2. An approval answered on another device while the watch shows the card: the card shows the outcome, the buttons go, and a late tap sends nothing.
3. A voice message recorded with no network: it stays queued across an app relaunch and goes out once online, once.
4. The iPhone's account has no cross-signing keys: connect still finishes, the page says the watch stays unverified.
5. The default room is left or upgraded while the watch has it: home opens the room picker, not an empty list.

---

### Task 1: SDK build, size and licenses

**Files:**
- Create: `ios/Watch/sdk/version` (`matrix-sdk-ffi-0.19.1` and its commit `b18166c68bb958a21f0bca8b2d8320cb53583362`), `ios/Watch/sdk/matrix-rust-sdk.patch`, `ios/Watch/sdk/checksum`, `ios/Watch/MatrixRustSDK/Package.swift`, `scripts/watch/build-sdk.sh`, `scripts/watch/check-sdk-licenses.py`, `scripts/watch/test_check_sdk_licenses.py`, `scripts/watch/size-check.sh`
- Modify: `.gitignore` (`ios/Watch/MatrixRustSDK/MatrixSDKFFI.xcframework/`, `ios/Watch/MatrixRustSDK/Sources/`), `justfile` (`watch-sdk`, add the new test to `script-tests`), `NOTICE`

**Interfaces:**
- Produces: the local Swift package `MatrixRustSDK` (product `MatrixRustSDK`) at `ios/Watch/MatrixRustSDK`; `TimelineFilter.defaultAndEventTypes(eventTypes: [String])`.

- [ ] **Step 1:** Write `matrix-rust-sdk.patch` as one `git diff` against the pinned commit: the `DefaultAndEventTypes` variant (configuration.rs) and its `event_filter` arm (room/mod.rs), as applied in the spike; `experimental-search` dropped from the `matrix-sdk` dependency's features; xtask `FFI_FEATURES` and `--no-default-features`; profile `watch-release` (inherits `small-release-stripped`, `opt-level = "z"`, `codegen-units = 1`).
- [ ] **Step 2:** TLS provider. `rustls-aws-lc-rs` links `aws-lc-sys` (license includes `OpenSSL`, not on the list). Switch to rustls with the `ring` provider (`ring` 0.17: `Apache-2.0 AND ISC`): enable `reqwest`'s `rustls-no-provider` path, add `rustls` with `ring` to `matrix-sdk-ffi`, and install the provider once in `ClientBuilder::build` (`rustls::crypto::ring::default_provider().install_default()`, ignoring "already installed"). Add these hunks to the patch.
- [ ] **Step 3:** `scripts/watch/build-sdk.sh [--fetch|--publish]`: clones the tag into `$XDG_CACHE_HOME/mindroom-watch-sdk/<commit>`, checks the commit, applies the patch, runs `cargo xtask swift build-framework --profile watch-release --target aarch64-apple-watchos --target arm64_32-apple-watchos --target aarch64-apple-watchos-sim --watchos-deployment-target 10.0 --components-path ios/Watch/MatrixRustSDK` with the nightly toolchain and `rust-src` (arm64_32 needs `-Zbuild-std`) and an empty `RUSTC_WRAPPER`, zips the XCFramework and writes its sha256 to `ios/Watch/sdk/checksum`. `--publish` uploads the zip with `gh release upload watch-sdk-<tag>-<patch sha256 first 12>` (run only on the coordinator's word); `--fetch` downloads that asset and refuses a checksum mismatch.
- [ ] **Step 4:** Test of the license checker first: `scripts/watch/test_check_sdk_licenses.py` (unittest) feeds made-up `cargo metadata` JSON: `MIT OR Apache-2.0` passes, `Apache-2.0 AND ISC` passes, `ISC AND (Apache-2.0 OR ISC) AND OpenSSL` fails naming the crate, `MPL-2.0` passes, a missing license fails. Run it: fails (no module).
- [ ] **Step 5:** `check-sdk-licenses.py <sdk dir>` runs `cargo metadata --format-version 1 --filter-platform aarch64-apple-watchos` for `matrix-sdk-ffi` with the build's features, walks the resolved graph from it (normal dependencies only), parses each SPDX expression (an `OR` passes when one side passes) and exits 1 listing offenders. Unit test passes; the real run over the patched SDK passes.
- [ ] **Step 6:** Build on m2; `size-check.sh <app>` thins with `xcrun bitcode_strip`-free `lipo -thin arm64` and `arm64_32` copies of the built watch app, sums the bundle per architecture, fails above 70 MB. Run against the spike app rebuilt with the trimmed framework. Expected: under 70 MB for both. If not: drop `experimental-widgets` next (patch `widget.rs` out), measure again; record the numbers in the commit message.
- [ ] **Step 7:** `NOTICE`: matrix-rust-sdk (Apache-2.0) and a line that the watch app's Rust dependencies are listed in `licenses/watch-sdk.txt`, which `check-sdk-licenses.py --write` generates (crate, version, license). Commit.

### Task 2: MindRoomWatchKit, the protocol package

**Files:**
- Create: `ios/Watch/MindRoomWatchKit/Package.swift` (library `MindRoomWatchKit`, platforms watchOS 10, macOS 13; no dependencies), `Sources/MindRoomWatchKit/{Approval.swift, Question.swift, AgentRun.swift, ThreadSummary.swift, VoiceEcho.swift, ThreadTags.swift, PlainText.swift, Waveform.swift, ThreadRow.swift, WatchLinkMessage.swift}`, one test file per source in `Tests/MindRoomWatchKitTests/`, fixtures in `Tests/MindRoomWatchKitTests/Fixtures/*.json` copied from the shapes in the web client's tests (`src/app/matrix/protocol/*.test.ts`).
- Modify: `justfile` (`watch-kit-test`: `swift test --package-path ios/Watch/MindRoomWatchKit`, macOS only)

**Interfaces (all take the event's raw JSON as `[String: Any]` from `JSONSerialization`):**
- `struct ApprovalCard { eventId, threadId, toolName, agentName: String?; arguments: [(key: String, value: String)]; argumentsTruncated: Bool; status: ApprovalStatus; expiresAt: Date? }`, `enum ApprovalStatus { pending, approved, denied, expired }`; `ApprovalCard.parse(_ event:) -> ApprovalCard?`; `ApprovalCard.applying(edits: [[String: Any]], now: Date) -> ApprovalCard` (newest `m.replace` `m.new_content.status` wins; pending past `expiresAt` is `expired`); `approvalResponseContent(cardId: String, threadId: String, approve: Bool) -> [String: Any]` (exact web shape: `status`, `reason: NSNull()`, `m.relates_to` with `rel_type m.thread`, `event_id` thread root, `is_falling_back true`, `m.in_reply_to.event_id` card).
- `struct Question { eventId; text: String; options: [(key: String, label: String)] }`, `Question.parse(_ event:, latestEdit:)` (reads `io.mindroom.interactive` from `m.new_content` first; keys that are not digits; label from `option_labels`).
- `enum RunState { streaming, finished, stopped, none }`, `RunState.of(_ event:, latestEdit:)` (`io.mindroom.stream_status` `pending|streaming` is streaming; `ai_run` with `version 1` and `completed|cached` finished; `cancelled|error|interrupted` stopped).
- `ThreadSummary.title(from notices: [[String: Any]]) -> String?` (newest `io.mindroom.thread_summary` with `version 1`; edit body wins).
- `VoiceEcho.transcript(_ event:, latestEdit:) -> (voiceEventId: String, text: String?)?` (`com.mindroom.visible_router_voice_echo`, `m.in_reply_to`; `Router agent is transcribing…` is `nil` text).
- `ThreadTags.resolvedRoots(state: [[String: Any]]) -> Set<String>` (type `com.mindroom.thread.tags`, key `["$root","resolved"]` with non-empty content, plus the legacy `$root` key with `tags.resolved`, minus pinned).
- `PlainText.of(markdown: String) -> String` (drops Markdown marks, keeps line breaks, removes MindRoom tool-call lines and returns their count separately: `PlainText.withToolCount(_:) -> (text: String, tools: Int)`).
- `Waveform.bars(from levels: [Float], count: Int = 48) -> [Float]` (dB meter samples to 0...1, averaged into `count` buckets).
- `enum ThreadRowState { needsYou, running, unread, idle(Date), queued, failed }`, `ThreadRowState.of(latest: [String: Any]?, latestEdit: [String: Any]?, pendingApproval: Bool, openQuestion: Bool, lastSeenEventId: String?, sendFailed: Bool, queued: Bool)`; order: failed, queued, needsYou, running, unread, idle.
- `enum WatchLinkMessage: Equatable { credentials(homeserverUrl: URL, userId: String, loginToken: String, expiresAt: Date), signedIn(userId: String, deviceId: String), signOut }` with `init?(dictionary:)` (requires `v == 1`, valid URL, `@user:server` id) and `dictionary`.

- [ ] **Step 1:** Write the tests, one file per type: each fixture case of the Interfaces above, plus Review Focus 2 (`ApprovalCard.applying` with an `approved` edit returns `.approved`; an expired pending card returns `.expired`), and the link message guards (wrong `v`, missing token, malformed user id return `nil`; an `expiresAt` in the past still parses: Task 4 decides).
- [ ] **Step 2:** `just watch-kit-test` on m2. Expected: FAIL to compile (types missing).
- [ ] **Step 3:** Implement each type in its file.
- [ ] **Step 4:** `just watch-kit-test`. Expected: all pass.
- [ ] **Step 5:** Commit.

### Task 3: Xcode targets

**Files:**
- Create: `scripts/watch/add-watch-targets.rb`, `ios/Watch/MindRoomWatch/{MindRoomWatchApp.swift, Info.plist, MindRoomWatch.entitlements, Assets.xcassets (app icon from ios/App/App/Assets.xcassets/AppIcon), Localizable.xcstrings}`, `ios/Watch/MindRoomWatchWidgets/{Widgets.swift, Info.plist, MindRoomWatchWidgets.entitlements}`
- Modify: `ios/App/App.xcodeproj/project.pbxproj` (generated by the script, committed), `ios/App/App/App.entitlements` (app group), `ios/App/ci_scripts/ci_post_clone.sh` (`scripts/watch/build-sdk.sh --fetch`)

- [ ] **Step 1:** `add-watch-targets.rb` (xcodeproj gem, run with the nix ruby + `pod` Bundler preamble the iOS routing test uses): adds target `MindRoomWatch` (watchOS app, bundle id above, `WKCompanionAppBundleIdentifier chat.mindroom.app`, `WKRunsIndependentlyOfCompanionApp YES`, `NSMicrophoneUsageDescription`), target `MindRoomWatchWidgets` (WidgetKit extension embedded in it), the local packages `MatrixRustSDK` and `MindRoomWatchKit` on the app target, an "Embed Watch Content" phase in `App`; idempotent (a second run changes nothing).
- [ ] **Step 2:** Placeholder `MindRoomWatchApp` showing "MindRoom" so the targets build.
- [ ] **Step 3:** Build `App` for the iOS simulator and `MindRoomWatch` for the watch simulator on m2 (`env -i ... xcodebuild`, `ARCHS=arm64` for the simulator). Expected: both succeed; `scripts/test-ios-routing.sh` still passes.
- [ ] **Step 4:** Commit.

### Task 4: Connecting (watch side)

**Files:**
- Create: `ios/Watch/MindRoomWatch/Session/{WatchLink.swift, MatrixSession.swift, SessionStore.swift, TokenLogin.swift}`, `ios/Watch/MindRoomWatch/Views/ConnectView.swift`
- Test: `ios/Watch/MindRoomWatchKit/Tests/MindRoomWatchKitTests/TokenLoginRequestTests.swift` (request building lives in the kit: `TokenLoginRequest.make(homeserverUrl:token:) -> URLRequest`, `TokenLoginRequest.parse(data:status:) throws -> (accessToken, deviceId, userId)`)

**Interfaces:**
- `@MainActor final class MatrixSession: ObservableObject { enum State { signedOut, connecting, expired, signedIn(Client), failed(String) }; @Published var state; func connect(_ credentials: WatchLinkMessage) async; func restore() async; func signOut() async }`
- `SessionStore`: Keychain item `chat.mindroom.watch.session` (`Session` fields as JSON) and `chat.mindroom.watch.store-passphrase` (32 random bytes, base64); data path `Application Support/matrix/<userId hash>`, cache path `Caches/matrix/<userId hash>`; `ClientBuilder` gets `.sessionPassphrase(...)` and `.slidingSyncVersionBuilder(.discoverNative)`.
- `WatchLink`: `WCSessionDelegate`; delivers `credentials` to `MatrixSession.connect` from `didReceiveUserInfo` and `didReceiveMessage`; sends `signedIn` with `transferUserInfo`; `signOut` calls `MatrixSession.signOut`.

- [ ] **Step 1:** Kit tests for `TokenLoginRequest`: body is `{"type":"m.login.token","token":…,"initial_device_display_name":"MindRoom Apple Watch"}` to `<hs>/_matrix/client/v3/login`; a 403 `M_FORBIDDEN` maps to `.expired`; Review Focus 1: credentials with `expiresAt` in the past give `.expired` without a request (`TokenLoginRequest.isExpired(_:now:)`). Run: FAIL.
- [ ] **Step 2:** Implement in the kit; tests pass.
- [ ] **Step 3:** `MatrixSession` and `SessionStore` and `WatchLink`; `M_UNKNOWN_TOKEN` from the SDK (sync state `error` with that code, or `ClientError` on any call) clears the store and returns to `signedOut`. DEBUG builds also accept credentials from the launch environment (`MINDROOM_WATCH_E2E_CREDENTIALS`, the link message as JSON) for Task 10.
- [ ] **Step 4:** `ConnectView` copy: "Open MindRoom on your iPhone: Settings, Apple Watch" / "Connect again from your iPhone" (expired).
- [ ] **Step 5:** Run on the watch simulator with the e2e credentials against an `e2e-slot` homeserver (as the spike's `spike-run.sh`): signed in, sync running, relaunch restores without credentials. Commit.

### Task 5: Connecting (iPhone side)

**Files:**
- Create: `ios/App/App/MindRoomWatchPlugin.swift`, `src/app/native/nativeWatch.ts` + `.test.ts`, `src/app/account/watch/connectWatch.ts` + `.test.ts`, `src/app/account/watch/WatchSettings.tsx` + `.test.tsx`
- Modify: the settings page list (`src/app/settings/settingsMenu.ts`, `settingsSearchIndex.ts`), `src/app/i18n/locales/additions/*.json` (18 files), `ios/App/App/MindRoomBridgeViewController.swift` (register the plugin), `ios/App/App/AppDelegate.swift` (Handoff `chat.mindroom.open-thread` to the route `/<roomId>/thread/<threadId>` as push taps do), `ios/Tests/` source contracts, `src/app/notifications/push/iosPush.ts` (`aps.category: 'MINDROOM_EVENT'`) + its test, `docs/configuration.md` (the pusher's category)

**Interfaces:**
- Plugin `MindRoomWatch`: `status(): Promise<{ paired: boolean; installed: boolean; reachable: boolean }>`, `sendCredentials(message: WatchCredentials): Promise<void>`, `signOut(): Promise<void>`, event `watchSignedIn` `{ userId, deviceId }` (kept until a listener reads it: `pendingSignIns(): Promise<{ userId, deviceId }[]>`).
- `connectWatch(mx: MatrixClient, plugin: NativeWatch, runUia: UiaRunner): Promise<ConnectResult>`, `ConnectResult = { kind: 'sent' } | { kind: 'unsupported' } | { kind: 'cancelled' } | { kind: 'failed'; reason: string }`; `verifyWatch(mx, deviceId, { timeoutMs: 30_000 }): Promise<'verified' | 'no-cross-signing' | 'timeout'>`.
- Store of the connected device: `watchDevice:<userId>` in `localStorage` through `preferences` (cleared at sign-out like `quickCaptureRoom`).

- [ ] **Step 1:** vitest for `connectWatch`: `GET /login` without `get_login_token` gives `unsupported`; `get_token` 401 with flows runs `runUia` and retries with its auth dict; a cancelled UIA gives `cancelled`; success sends `{ v: 1, kind: 'credentials', homeserverUrl, userId, loginToken, expiresAt: now + expires_in_ms }`. For `verifyWatch`: keys appear after two polls then `crossSignDevice(deviceId)` is called; Review Focus 4: `getCrossSigningStatus().privateKeysCachedLocally.selfSigningKey === false` gives `no-cross-signing` and no call; no keys in 30 s gives `timeout`. Run: FAIL.
- [ ] **Step 2:** Implement with `ActionUIA`'s runner and `mx.http.authedRequest` for `get_token` (`/_matrix/client/v1`); `mx.getCrypto().crossSignDevice`.
- [ ] **Step 3:** `WatchSettings` (jsdom tests: no watch, app missing, not connected, connecting, connected with device id and Disconnect, each error line) and its settings entry; strings in all 18 additions files.
- [ ] **Step 4:** Swift plugin with `WCSession` (activate at launch; `transferUserInfo` always, `sendMessage` too when reachable); contract tests in `ios/Tests/` for the method names.
- [ ] **Step 5:** Key backup on the watch: after `verifyWatch` returns `verified`, the watch's `Encryption.verificationState()` becomes `.verified`; check whether the SDK then requests the backup secret by itself (`Encryption.backupState()` turns `.enabled` within 60 s). If it does not, `MatrixSession` calls the FFI's secret-request or `waitForBackupUploadSteadyState`-family API the generated bindings offer; if none exists, add a patch hunk exposing `matrix_sdk::encryption::Encryption::request_missing_secrets` (or the crypto machine's `query_missing_secrets_from_other_sessions`). Proof: a message sent in the room before the watch signed in decrypts on the watch after verification (simulator, web client in Playwright as the other device).
- [ ] **Step 6:** `just test`, `just strict`, `just lint`, `just typecheck`; build `App` on m2. Commit.

### Task 6: Home, recording, rooms, threads, thread (v1 screens)

**Files:**
- Create: `ios/Watch/MindRoomWatch/Model/{DefaultRoom.swift, RoomList.swift, RoomModel.swift, ThreadModel.swift, Recorder.swift, Sender.swift, SeenStore.swift}`, `ios/Watch/MindRoomWatch/Views/{HomeView.swift, RecordingView.swift, RoomPickerView.swift, ThreadsView.swift, ThreadView.swift}`

**Interfaces:**
- `DefaultRoom`: `UserDefaults` key `defaultRoom:<userId>`; cleared when the room is left or tombstoned (Review Focus 5: `RoomModel` reports `.roomGone`, home opens the picker).
- `RoomList`: `RoomListService` all rooms, spaces dropped, by recency, `[(id, name, isEncrypted)]`.
- `RoomModel(room: Room)`: `@Published rows: [ThreadRowViewData]` from `ThreadListService` (`subscribeToItemsUpdates`, `reset()`+`paginate()` on appear), resolved roots from one `GET /_matrix/client/v3/rooms/{id}/state` with the session's token (`ThreadTags.resolvedRoots`); `func resolve(_ root: String, _ resolved: Bool) async throws`.
- `ThreadModel(room:, root:)`: thread-focused timeline with the patched filter; publishes root, newest agent reply (`PlainText.withToolCount`), transcript (`VoiceEcho`), pending `ApprovalCard`, open `Question`, `RunState`.
- `Recorder`: `start() throws`, `stop() -> (url: URL, duration: TimeInterval, waveform: [Float])`, `cancel()`; 5-minute cap stops and keeps the take; `AVAudioSession` category `.record`; metering every 100 ms.
- `Sender.sendVoice(on timeline: Timeline, take:) async throws` (`sendVoiceMessage`, `audio/mp4`, `inReplyTo nil`; a reply uses the thread timeline).

- [ ] **Step 1:** Screens per spec items 1 to 6, Digital Crown scroll from home to threads, swipe to resolve, Double Tap (`.handGestureShortcut(.primaryAction)`) on Send, haptic `.success` when a sent thread's `RunState` becomes `finished` while open, Handoff `NSUserActivity` on `ThreadView`.
- [ ] **Step 2:** Review Focus 3: kill the app after recording offline (simulator network off via the slot's homeserver stopped), relaunch, start the homeserver: the message is sent once (`/messages` shows one voice event). Record the steps and result in the commit message.
- [ ] **Step 3:** Run by hand in the simulator against an `e2e-slot` homeserver with a MindRoom agent (`just agent-stack <n> up`, stub model): pick a room, record (the simulator's microphone input), see the transcript echo and the agent's answer, open the thread, resolve it, and see it resolved in the web app. Screenshots with `simctl io screenshot`. Commit.

### Task 7: Approvals, questions, Listen and Reply (v2 in the app)

**Files:**
- Create: `ios/Watch/MindRoomWatch/Views/{ApprovalCardView.swift, QuestionView.swift}`, `ios/Watch/MindRoomWatch/Model/Speaker.swift`
- Modify: `ThreadView.swift`, `ThreadModel.swift` (`approve(_ card:, _ yes: Bool) async throws` via `room.sendRaw("io.mindroom.tool_approval_response", approvalResponseContent(...))`; `answer(_ q:, key:)` via `timeline.toggleReaction`)

- [ ] **Step 1:** Card: agent, tool, every argument in a scroll view (truncated arguments say so), Approve and Deny; buttons hidden unless `.pending`; a tap disables both until the card's next state (Review Focus 2). Question: one button per option. Listen: `AVSpeechSynthesizer` speaks the reply's plain text; a second tap stops it.
- [ ] **Step 2:** Against the agent stack with an approval rule (`tool_approval.rules` on a stub tool) and the interactive stub scenario: approve from the watch, the agent continues; deny, the agent says so; answer a question, the agent continues; approve on the web first, the watch card shows "Approved" without buttons. Commit.

### Task 8: Complication, widget, App Shortcut, background refresh

**Files:**
- Create: `ios/Watch/MindRoomWatch/Model/Snapshot.swift` (app group `UserDefaults` key `snapshot`: `{ roomName, needsYou, running, updatedAt }`), `ios/Watch/MindRoomWatch/AppShortcuts.swift` (`RecordIntent`, opens the app in recording), `ios/Watch/MindRoomWatchWidgets/{Complications.swift, SmartStackWidget.swift}`
- Modify: `MindRoomWatchApp.swift` (`.backgroundTask(.appRefresh("sync"))` every 30 minutes: one sync pass, snapshot, `WidgetCenter.shared.reloadAllTimelines()`), `RoomModel.swift` (writes the snapshot on change)

- [ ] **Step 1:** Circular complication (mic glyph, deep link `mindroom-watch://record`), rectangular and Smart Stack (room name, "2 need you · 1 running", or "All quiet"); the URL opens `RecordingView`.
- [ ] **Step 2:** Simulator: add the complication to a face (`simctl` screenshot), tap opens recording; the App Shortcut appears in Shortcuts. Commit.

### Task 9: Notifications on the watch

**Files:**
- Create: `ios/Watch/MindRoomWatch/Notifications/{NotificationController.swift, NotificationView.swift, NotificationActions.swift}`
- Modify: `MindRoomWatchApp.swift` (`WKNotificationScene(controller: NotificationController.self, category: "MINDROOM_EVENT")`, `UNUserNotificationCenter` delegate)

- [ ] **Step 1:** On a real iPhone and watch (simulators do not forward): first check where an action on a forwarded notification is delivered, with a throwaway action logging to the watch's console. Write the answer into the spec's Notifications section.
- [ ] **Step 2:** `NotificationController.didReceive`: `room_id`, `event_id` from `userInfo`; `room.loadOrFetchEventWithRelations(eventId)`; card, question or reply; `notificationActions` = Approve/Deny (`.destructive` on Deny), the options, or Listen/Reply (foreground). Actions call Task 7's methods (or, if Step 1 found actions go to the iPhone, keep only the default action).
- [ ] **Step 3:** Test with a simulated push file (`xcrun simctl push <watch udid> chat.mindroom.app.watchkitapp payload.apns`) carrying `aps.category`, `room_id` and `event_id` of a seeded card: the long look shows the card and its actions. Commit.

### Task 10: e2e on the simulator, docs

**Files:**
- Create: `scripts/watch/e2e.sh`, `ios/Watch/UITests/WatchFlowTests.swift`, `e2e/watch/seed-watch.ts` (Playwright helper: registers the account in an `e2e-slot`, makes the room, mints the login token with UIA, seeds an approval card and a question as the agent stack's stub does)
- Modify: `README.md` (Apple Watch line), `docs/development.md` (building the SDK, running the watch e2e), `docs/architecture.md` (`ios/Watch/` in "Placement and naming"), `AGENTS.md` commands table (`just watch-sdk`, `just watch-kit-test`, `scripts/watch/e2e.sh`)

- [ ] **Step 1:** `e2e.sh <slot>`: `e2e-slot` up, seed, build the watch app (DEBUG), boot a watch simulator, launch with `MINDROOM_WATCH_E2E_CREDENTIALS`, run `WatchFlowTests` (pick the room, record 2 s, the voice message appears in `/messages` decrypted by the seeding client; approve the card, its response event appears; answer the question, the reaction appears; resolve, the state event appears), tear down.
- [ ] **Step 2:** Run it on m2. Expected: all tests pass. Docs. Commit.

### Task 11: By hand on Bas's watch, pull request

- [ ] **Step 1:** Ask Bas for his watch model and watchOS version; build signed for device with the team; install through the iPhone app (TestFlight or Xcode).
- [ ] **Step 2:** Spec "Testing" by-hand list; photos or screen recordings of each, attached to the pull request (`gh pr create --attach`).
- [ ] **Step 3:** `scripts/push-gate.sh` and the overlap check; push; open the PR.
