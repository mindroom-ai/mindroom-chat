# MindRoom on Apple Watch

Bas Nijholt asked on 2026-11-13 for an Apple Watch app: pick a default room, send voice messages into it, maybe look at threads, with a very simple UI. From mockups of fifteen use cases he chose v1 (home with one mic, recording, the sent thread, the room's threads, a thread, the room picker, a complication; a spoken agent name works as a mention) and v2 (approve a tool call, answer an agent's question, a finished run with Listen and Reply), and on 2026-11-14 chose that the watch handles end-to-end encrypted rooms itself (option B: matrix-rust-sdk on the watch), over a watch limited to unencrypted rooms or one that relays through the iPhone.

## Understanding

- A voice message is a new message in the default room; MindRoom transcribes it, and it becomes the root of a thread when an agent answers. This is Quick Capture's model (`2026-11-13-quick-capture-design.md`) with the voice in place of the keyboard.
- The watch is its own Matrix device. It talks to the homeserver over its own network, so it works when the iPhone is away, as long as the watch has Wi-Fi or cellular.
- The iPhone app signs the watch in and verifies it. Nobody types a password or a recovery key on the watch.

Assumptions (not said, chosen here):

- One account on the watch: the iPhone app's active account when the watch is connected. Connecting again with another account replaces it.
- The default room is chosen on the watch and stored there. It does not follow the Mac's Quick Capture room.
- Recording is AAC in an `.m4a` (`audio/mp4`): what the watch records natively. The web client and the backend's transcription both take it.
- The Action Button of the Ultra is out: watchOS gives third-party apps the Action Button only for workouts and dives. The complication, the Smart Stack widget and an App Shortcut ("Record in MindRoom", Siri) take its place.
- The watch app's strings come in the 18 languages of the iOS app's `Localizable.strings`.

## Scope

In (v1):

1. **Home:** the default room's name on top (a button: opens the room picker), one large mic button, and a line under it with the threads' state ("Threads · 2 need you"); scrolling down (Digital Crown) or tapping the line shows the threads.
2. **Recording:** waveform and timer; tap Send (or the Double Tap gesture) sends, the ✕ discards. Recording continues with the wrist down. Limit: 5 minutes.
3. **Sent:** the new thread: the voice message with MindRoom's transcript once the router posts it, then the agent's answer streaming in, with a haptic when the run finishes while the app is open.
4. **Threads:** the room's threads, newest activity first, at most 30: title (AI title, else the root's text or transcript), the newest reply's "Sender: text", and a state at the end: `Needs you` (pending approval or unanswered question), a spinner (an agent is streaming), a dot (new since last seen on the watch), else the time. A swipe resolves a thread.
5. **Thread:** the root, then the newest agent reply as plain text (Markdown stripped, tool calls counted as "N tools", user ids shown as names), with reply by voice and resolve; while it shows, Handoff offers the thread to the iPhone (watchOS cannot open the iPhone app from a button).
6. **Rooms:** joined rooms that are not spaces, most recently active first; a check on the default. Encrypted and unencrypted rooms alike.
7. **Complication and widget:** a circular complication that opens straight into recording, and a rectangular one and a Smart Stack widget with "2 need you · 1 running".
8. **App Shortcut:** "Record in MindRoom" opens the app recording.
9. **Connect:** a watch that is not signed in says "Open MindRoom on your iPhone: Settings, Privacy, Apple Watch" and waits; the iPhone's Settings > Privacy has an "Apple Watch" section (iOS app only) with Connect, the connected device, and Disconnect.

In (v2):

10. **Approve:** a pending `io.mindroom.tool_approval` in a thread shows as a card with the agent, the tool and every argument (scrollable, never cut), and Approve / Deny. Time-limited auto-approve options are left out on the watch.
11. **Answer:** an `io.mindroom.interactive` question shows its options as buttons; a tap sends the option's reaction.
12. **Run finished, Listen and Reply:** the thread's newest agent reply has Listen (read aloud on the watch's speaker or AirPods with `AVSpeechSynthesizer`) and Reply (voice); a haptic plays when an answer finishes while the thread is open.
13. **Notifications:** the iPhone's MindRoom notifications, forwarded to the watch by watchOS, show the watch app's own long look for the `MINDROOM_EVENT` category: the watch loads the event with its own client and shows the approval card, the question's options or the reply, with the matching action buttons. A tap anywhere else opens the thread in the watch app.

Out:

- Typing, dictation into text, emoji replies other than a question's options, images, and any room other than the default one being written to (reading other rooms happens only after switching the default).
- The watch's own push registration. watchOS forwards the iPhone's notifications when the iPhone is locked and the watch is worn; a pusher of the watch's own would show each notification twice in that case. Without the iPhone nearby, the watch learns of new events only while the app is open or refreshes in the background. Follow-up if needed: a watch pusher with matching `apns-collapse-id`s, which needs a change in Sygnal's configuration.
- An offline queue beyond what the SDK's persistent send queue gives: a message recorded without a network stays queued in the SDK's store and goes out when the network returns, shown as "Queued"; nothing else.
- Long voice memos with summaries, the morning brief, location stamps (ideas 13 to 15 of the mockups).
- Signing the watch in without the iPhone (QR login, password).
- Revoking time-limited auto-approvals on the watch.

## Architecture

```
iPhone (existing Capacitor app)                       Apple Watch (new, native SwiftUI)
 web: Settings > Apple Watch                            MindRoomWatch app
  - POST /login/get_token (UIA via ActionUIA)            - WatchLink (WCSession): receives credentials,
  - crypto.crossSignDevice(watch device)                   sends back device id
 native: MindRoomWatchPlugin (WCSession) <── WCSession ──> - Session: POST /login (m.login.token),
                                                             then matrix-rust-sdk restore_session
                                                           - SyncService (simplified sliding sync), RoomListService
                                                           - Timeline / ThreadListService of the default room
                                                           - MindRoomProtocol (pure Swift: parse MindRoom events)
                                                         MindRoomWatchWidgets (WidgetKit): reads an app group snapshot
```

### The Matrix SDK on the watch

- The SDK is patched by `ios/Watch/sdk/matrix-rust-sdk.patch`: a timeline filter `DefaultAndEventTypes` that keeps MindRoom's custom event types (the default filter drops them, and the FFI's `All` still applies it); `Room.load_or_fetch_event_json_with_relations`, an event and its relations as raw JSON (the typed FFI events drop MindRoom's content keys; the relations always come from the homeserver, since the event cache misses those that arrived while the watch did not sync); `SecretsBundleWithUserId.from_json`, to import the secrets bundle the iPhone sends; no full-text search index (`experimental-search`) and no Sentry; and a size profile (`opt-level = "z"`). The watch app must stay under Apple's 75 MB limit: the untrimmed SDK was 110 MB, the trimmed app 45 MB.
- `matrix-sdk-ffi` from matrix-rust-sdk (Apache-2.0), built by its own `cargo xtask swift build-framework` for `aarch64-apple-watchos` and `aarch64-apple-watchos-sim`; the app targets watchOS 11. `arm64_32` (Series 6 to 8, SE) is left out: aws-lc-sys, rustls' crypto, does not compile for it. Pinned to one SDK tag in `ios/Watch/sdk/version`.
- `scripts/watch/build-sdk.sh` clones the pinned tag, applies the patch, checks the linked crates' licenses (`scripts/watch/check_sdk_licenses.py`; `xxhash-rust`, BSL-1.0, allowed by name), builds the XCFramework and the generated Swift sources into `ios/Watch/MatrixRustSDK/` (a local Swift package; the build is git-ignored), and writes a checksum. The XCFramework is too large for git; CI and Xcode Cloud download it from a GitHub release asset named after the SDK tag (`ci_post_clone.sh`), which `scripts/watch/build-sdk.sh --publish` uploads. Publishing it is a release step the coordinator runs.
- Store: SQLite in the watch app's container (the SDK's `session_paths`), with a passphrase in the watch's Keychain.
- `NOTICE` names matrix-rust-sdk and the patch; `licenses/watch-sdk.txt` lists every linked crate with its license.

### Connecting a watch

1. Settings > Apple Watch on the iPhone shows the state from the plugin: no watch paired, the app not installed on the watch, not connected, or connected (device id, display name).
2. Connect: the web app calls `POST /_matrix/client/v1/login/get_token` with the active account, going through `ActionUIA` when the server asks for user-interactive auth (password or SSO, as device deletion does). The server must advertise `get_login_token` (`GET /login` flow `m.login.token`); otherwise the page says the homeserver cannot connect a watch.
3. The plugin sends `{ v: 1, kind: 'credentials', homeserverUrl, userId, loginToken, expiresAt }` with `WCSession.transferUserInfo` (queued, delivered when the watch app runs; `sendMessage` as well when the watch is reachable, for speed).
4. The watch posts `{ type: 'm.login.token', token, initial_device_display_name: 'MindRoom Apple Watch' }` to `/login`, then hands the access token and device id to the SDK's `restore_session`, which uploads the device's keys on first sync.
5. The watch answers `{ v: 1, kind: 'signedIn', userId, deviceId }`; the plugin raises a `watchSignedIn` event; the web app waits until the device's keys are visible (`getUserDeviceInfo`, up to 30 s) and cross-signs it (`crypto.crossSignDevice(deviceId)`), so the account's other devices and other people trust it. The iPhone needs its own cross-signing keys for this; when it has none, the page says to set up encryption first and leaves the watch unverified (it still works; other clients show it as unverified).
6. Then the web app sends `{ v: 1, kind: 'secrets', userId, bundle }`: the account's secrets bundle (`crypto.exportSecretsBundle()`: the private cross-signing keys and the key backup's key), as a QR-code sign-in hands a new device. The watch imports it (`SecretsBundleWithUserId.fromJson`, `importSecretsBundle`): it now trusts the account's identity and its other devices, and key backup turns on, so messages from before it signed in decrypt. Without a key backup there is no bundle; the page says so and the watch reads only what arrives after it signed in. (Asking the other devices for the backup key with `m.secret.request` does not work here: a device that was only cross-signed by another one does not trust the account's identity, so it refuses the answers.) 🔒 The bundle travels over WatchConnectivity, the encrypted link between the iPhone and its paired watch, and the watch keeps it in its passphrase-encrypted store.
7. Disconnect on the iPhone deletes the watch's device on the server (through interactive auth, as the Devices page does), so a lost watch keeps no session, and sends `{ kind: 'signOut' }`; the watch clears its store when it reads it. Only a sign-in this iPhone started (Connect) gets verified and the bundle.

A login token is valid for minutes and once; a credentials message the watch reads after `expiresAt` is ignored, and the watch says "Connect again from your iPhone".

### Watch app structure

| Unit | Role |
|---|---|
| `ios/Watch/MindRoomWatchKit/` (Swift package) | Pure, tested on macOS with `swift test`: `MindRoomProtocol` (parse the raw JSON of MindRoom events: `io.mindroom.tool_approval` and its `m.replace` status, `io.mindroom.tool_approval_response` content, `io.mindroom.interactive`, `io.mindroom.stream_status`, `io.mindroom.ai_run`, `io.mindroom.thread_summary`, the router's voice echo `com.mindroom.visible_router_voice_echo`, `com.mindroom.thread.tags` keys), `PlainText` (Markdown to plain text, tool trace count), `ThreadRow` (row state from a thread's events), `Waveform` (48 values 0 to 1024 from meter samples), `WatchLinkMessage` (the WCSession messages and their guards) |
| `ios/Watch/MindRoomWatch/` (watchOS app target) | SwiftUI screens (`HomeView`, `RecordingView`, `ThreadsView`, `ThreadView`, `RoomPickerView`, `ConnectView`, `ApprovalCard`, `QuestionOptions`), `MatrixSession` (login, restore, sync, sign out over the SDK), `RoomModel` (default room's thread list and threads as observable state), `Recorder` (AVAudioRecorder to m4a with metering), `Speaker` (AVSpeechSynthesizer), `WatchLink` (WCSession on the watch), `NotificationController` (long look for `MINDROOM_EVENT`), `AppShortcuts` |
| `ios/Watch/MindRoomWatchWidgets/` (WidgetKit extension) | Complications and the Smart Stack widget from a snapshot (`{ roomName, needsYou, running, updatedAt }`) the app writes into the app group `group.chat.mindroom.app` on each change |
| `ios/App/App/MindRoomWatchPlugin.swift` | iPhone side: WCSession, `status()`, `sendCredentials()`, `signOut()`, event `watchSignedIn`; the Handoff activity `chat.mindroom.open-thread` (room and thread id) opens the thread |
| `src/app/native/nativeWatch.ts` | The plugin's web wrapper and whether it is there |
| `src/app/account/watch/` (`WatchSettings.tsx`, `connectWatch.ts`) | The Settings page and the connect flow (get_token with UIA, send, cross-sign) |

Bundle ids: `chat.mindroom.app.watchkitapp` (app), `chat.mindroom.app.watchkitapp.widgets` (extension); the targets are added to `ios/App/App.xcodeproj` by `scripts/watch/add-watch-targets.rb` (xcodeproj gem), run once, its result committed. The watch app is a companion app embedded in the iOS app (`WKCompanionAppBundleIdentifier`) that also runs on its own (`WKRunsIndependentlyOfCompanionApp`).

### Sending

- A voice message: `Recorder` writes `voice-message-<ISO time>.m4a`; the room's live timeline sends it with the SDK's `send_voice_message` (it encrypts the file in an encrypted room and writes `org.matrix.msc3245.voice`, `org.matrix.msc1767.audio` with duration in ms and the waveform), as a new root in the room, or into the thread's timeline as a reply.
- Approve or deny: `room.send_raw('io.mindroom.tool_approval_response', { status, reason: null, m.relates_to: thread relation with m.in_reply_to the card })`, the same content the web client sends.
- An answer: an `m.reaction` with the option's key on the question event (`room.send_raw`, the web client's content).
- Resolve: `send_state_event_raw('com.mindroom.thread.tags', JSON.stringify([rootId, 'resolved']), { set_by, set_at })`; reopening sends `{}`.

### Reading

- `SyncService` with the SDK's simplified sliding sync (the homeserver advertises `org.matrix.simplified_msc3575`), started when the app comes forward and stopped when it goes to the background, plus a background app refresh every 30 minutes that syncs once and writes the widget snapshot.
- Threads: the room's `ThreadListService` (server `/threads`), first page of 30, refreshed with `reset()` and `paginate()` whenever the live room timeline changes (debounced 1 s); each row comes from `load_or_fetch_event_json_with_relations(root)`, which `MindRoomWatchKit.ThreadSnapshot` turns into the title, the newest answer, pending approvals and open questions. The user's own messages that no thread holds yet (just sent, queued, failed) come from the live timeline. Resolved threads: the room's `com.mindroom.thread.tags` state, read with one `GET /rooms/{id}/state` on each list refresh, hidden from the list.
- A thread: the same raw-JSON read of the root and its relations, again on each change of a thread-focused timeline (which leaves approval cards out) and every 5 s while the thread is open.
- "New since last seen" is local: the watch stores the newest event id per thread when the thread is opened.

### Notifications

- The iPhone pusher's `default_payload` gains `aps.category: 'MINDROOM_EVENT'` (`src/app/notifications/push/iosPush.ts`); the iPhone needs no registration for it, and the watch app provides the category's long look.
- The watch's `NotificationController` (`WKUserNotificationHostingController`) reads `room_id` and `event_id` from the payload, loads the event with `load_or_fetch_event` in its own client and shows the approval card, the question or the reply as plain text, and sets `notificationActions` to Approve/Deny, the options, or Listen/Reply.
- An action on a forwarded notification reaches the watch app's `UNUserNotificationCenterDelegate`, which sends the response. Which app receives actions on forwarded notifications is checked on the device first (plan task 1); if it is the iPhone app, the long look keeps only the default action (open the thread in the watch app), where the same buttons are.
- An agent's streamed reply pushes once, when it starts (edits do not notify); the long look shows the reply as far as it has come.
- Notifications need iOS push turned on in the deployment's config (`push.ios`); without it the watch shows these only in the app.

## Error handling

- Not connected, or the session revoked (`M_UNKNOWN_TOKEN` from the SDK): the watch clears its store and shows Connect.
- No network: home shows "No connection"; recording still works and sending queues in the SDK's send queue ("Queued" on the row), which retries when the network returns.
- A failed upload or send that the SDK gives up on: the thread row shows "Not sent", with Retry and Delete as swipe actions. A send that failed for want of a network stays "Queued": the room's send queue is turned on again when sync runs and when the app comes forward.
- The microphone refused: home says so with the path to Settings on the watch.
- An approval answered elsewhere first (the card's status is no longer `pending`): the card shows the outcome and no buttons.
- Decryption failures show "Encrypted message" in place of text; the thread still opens.
- iPhone: `get_token` refused or not offered, UIA cancelled, no watch, watch app missing, cross-signing unavailable: each a line on the Apple Watch page.

## Testing

- `MindRoomWatchKit`: `swift test` on macOS, one test file per parser with fixtures copied from the event shapes the web client's tests use (approval pending/approved/expired, interactive with emoji keys, ai_run and stream_status from `m.new_content`, thread summary, voice echo, thread tags), the plain text and waveform functions, and the link message guards.
- Web: vitest for `connectWatch` (get_token, the UIA path, the wait for keys, cross-signing, each error) and `WatchSettings` (jsdom, each state), `nativeWatch`, and the pusher's category.
- iPhone native: the source contract tests of `ios/Tests/` gain the plugin's methods and the Handoff activity.
- e2e against an agent stack with a stub model (`just agent-stack <n> up`): `scripts/watch/e2e.py` mints a login token as the iPhone does, reinstalls a DEBUG build in a watchOS simulator and drives it through DEBUG launch hooks that call the same model methods as the buttons: a voice message (a generated tone) gets an agent reply in its thread, `#approve` is approved, `#ask` is answered, the newest thread is resolved; each is checked on the homeserver and in the app's log, in an unencrypted and in an encrypted room.
- By hand on Bas's watch (Series and watchOS version noted in the pull request): connect from the iPhone, a voice message in an encrypted room with a real agent answer, the complication, a forwarded approval notification and its actions, airplane mode on the iPhone with the watch on Wi-Fi.
