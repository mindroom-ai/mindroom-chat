# The Mac app on Electron

Decided by Bas on 2026-11-21: the Mac app moves from Mac Catalyst to Electron. iPhone, iPad and Android stay
on Capacitor. On his M5 (120 Hz) a bare Electron shell ran at about 118 fps beside the Catalyst app, which is
capped at 60. The test shell had a plain macOS title bar; the real app keeps the hidden one: traffic lights
over the app, a draggable strip, content below the buttons. Design only; the plan is
`docs/baspowers/plans/2026-11-21-electron-mac-app.md`. Revised after eight review rounds (Opus 5.5, GPT-6.2
Astra, Gemini 4 Neon); the origin, the loopback sign-in and the IPC model are accepted by all.

## What the code says (`origin/main` 43db54c99)

- **Catalyst Mac code:** 2,937 lines of Swift in `ios/App/App/*.swift`, about 1,340 of them Mac only, plus
  `ios/MacSupport` (223) and `ios/MacUpdater` (93). Web code asks Capacitor whether it is native at 34
  places in 27 files (answered from bridge objects, not the address); every Mac feature sits behind a
  module in `src/app/native/`.
- **Backend origin:** the MindRoom backend (`~/repos/dev/mindroom` 8bf0f9d54) takes a bundled app's calls
  only from `capacitor://localhost` (`api/main.py:106,189`, `origins.py:119-121`). The page reads its own
  protocol in `compactThreadCardViewModel.ts:327`, `matrix/mediaUrl.ts:36`,
  `useMediaAuthentication.ts:15` and `connections/openConnections.ts:90`; none means "Capacitor is here".
- **Title bar and window today:** Catalyst's default title bar is cleared by `env(safe-area-inset-top)`
  at 11 places and in the PopOut clamp of `patches/folds+2.7.3.patch:35`. The Catalyst app ends a voice
  recording when its window closes (`SceneDelegate.swift:83-88`) and walks history on mouse buttons 3 and
  4 (`AppDelegate.swift:34`). `CheckedMessageLink.tsx:50-69,90-95` cancels the first click on a misleading
  link, asks, and then clicks the link from script.
- **Scripts and canvases:** `index.html:12-16` leaves `script-src` open because canvases run agent
  scripts inline in `srcdoc` frames (`CanvasPanel.tsx:246`, `InlineCanvasFrame.tsx:142`), which inherit
  the page's policy. `useCanvasHost.ts:449-454` treats a second `load` of that frame as an escape, and
  `InlineCanvasFrame.tsx:139,312,338-341` changes the document without changing the frame's key. A canvas
  names the libraries Chat serves by absolute address (`canvasLibraries.ts:27-35`).
  `scripts/frame-headers.json` already sets a `Content-Security-Policy` (`frame-ancestors`).
- **Media:** without a service worker the page puts the access token in media URLs
  (`matrix/mediaUrl.ts:35,103,127`), as the phone and the Catalyst app do today; copying a selection
  across an image then carries it (`text/html`, seen in the run of `/tmp/copy-test/`).
- **Sign-in:** native apps send `mindroom://auth/...` as the SSO redirect and open it after `await`s
  (`SSOLogin.tsx:122`, which knows the homeserver; `nativeSso.ts:219` does not take it yet). Sign in with
  Apple is native on iPhone and iPad only; the Catalyst app already uses browser SSO for it
  (`MindRoomAuthPlugin.swift:75-80`). A homeserver must be HTTPS unless its host is local
  (`cs-api.ts:74-80`). `ssoReturn.ts` guards the return: a random `ssoNonce`, noted with its homeserver,
  claimed once, valid 30 minutes. Cloudflare Access is not wired on `main`: 8ec7e9ec8 deleted the
  never-mounted `CloudflareAccessGate`, and `discoverCloudflareAccess` (`cloudflareAccess.ts:84`) has no
  caller outside tests, so no app starts an Access sign-in today.
- **Encryption state:** `RecoveryState.ready` (`recoveryState.ts:39`) means only that this device is
  verified. The backup's count of keys to upload is no proof: `KeyBackupTile.tsx:64` starts it at 0, and
  the SDK reports 0 also when reading the keys failed (`matrix-js-sdk/src/rust-crypto/backup.ts:435-453`);
  `CryptoApi` has no count bound to a backup version. `LocalKeyBackup.tsx` exports room keys to an
  encrypted file. A session the server logged out removes its own local data (`ClientRoot.tsx:505-516`).
- **Push:** the Catalyst session's APNs pusher outlives the move, and every Apple device registers with
  the same `app_id` and the name "MindRoom iOS" (`iosPush.ts:215,224`): a Mac's cannot be told from a phone's.
- **Release:** `release.yml:69` calls `macos.yml`, which also starts on `release: published`
  (`macos.yml:23-24`), builds `MindRoom Chat.app` (`chat.mindroom.app`, team `DNA6966LGZ`) into
  `MindRoom-Chat.dmg` (25.5 MB) and moves the Sparkle feed forward; it never rebuilds a tag that has a DMG
  (`macos.yml:71-88`). `macos-updater-info-plist.sh:16-23` writes no updater keys when
  `MINDROOM_UPDATE_FEED_URL` is empty. An install from before the rename is still `MindRoom.app`
  (`docs/ios-release.md:85`), also the name of the backend's menu bar app.
- **Packages read** (under `/tmp/electron-src/`): Electron 45.4.1's `setWindowOpenHandler` details have no
  frame and no user-gesture field; `app-command` is Windows and Linux only. electron-builder 26.18.0 skips
  notarization with a warning when it finds no credentials (`mac/MacTargetHelper.js:256-269`).
  electron-updater 6.8.11 (`MacUpdater.js:28-33,86-115`, `Provider.js:22-25`) picks the `arm64` files on
  arm64, downloads differentially against the ZIP kept from the previous update, and finds the old
  blockmap by swapping the version in the URL. Sparkle 2.10.1 hides "Skip This Version" only for
  `criticalUpdate && !majorUpgrade` (`SUUpdateAlert.m:470`); `minimumAutoupdateVersion` makes a major one.
- **Tried here** (Electron 45.3.2, Linux; `/tmp/origin-test/`, `/tmp/csp-test/`, `/tmp/csp-test2/`,
  `/tmp/sw-test/`, `/tmp/media-test/`):
  - A page served as `capacitor://localhost` has that origin, a secure context, `localStorage` and
    IndexedDB; `fetch` and WebSocket send that `Origin`. `storage.persist()` needs `persistent-storage`.
  - Under `script-src 'self' 'sha256-...' 'wasm-unsafe-eval'; worker-src 'self' blob:` inline, injected
    and remote scripts, inline handlers, `eval` and a `srcdoc` frame's inline script are blocked; bundled
    scripts, the hashed inline one, WebAssembly, a blob worker and the bridge work.
  - A frame page whose header has `sandbox allow-scripts allow-forms` has an opaque origin with or without
    the attribute, runs inline scripts also after `document.write`, and fires `load` twice. Opened as the
    main frame it still gets the bridge: its IPC has the app's URL but `senderFrame.origin` `"null"`.
    `webRequest.onBeforeRequest` sees a request's `resourceType` and can cancel it; `protocol.handle`
    requests carry no `Sec-Fetch-Dest`.
  - `webRequest.onBeforeSendHeaders` added `Authorization` to a cross-origin `fetch`, `<img>` and
    `<video>` request (with `Range`; playback untried) with no preflight; a caller's own header was
    visible to it; `details.frame` told main frame from subframes; `details.id` stayed the same across
    a redirect, and the added header was not carried to the other origin.

## Decisions

| Question                      | Choice                                                                                                                       | Confidence |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ---------- |
| Code and page                 | `electron/` in this repository; the bundled `dist`, in the signed archive                                                    | 85%        |
| Origin                        | `capacitor://localhost`, the origin the iPhone, iPad and Catalyst apps have                                                  | 90%        |
| **Script policy**             | bundled scripts only on the privileged page, before any signed build; canvases in a sandboxed frame page with its own policy | 80%        |
| **Media authorization**       | main adds the `Authorization` header; no token in any media URL                                                              | 80%        |
| Shell detection               | `src/app/lib/nativeShell.ts` and a typed preload bridge                                                                      | 85%        |
| SSO return                    | a loopback listener (RFC 8252), guarded by `ssoReturn.ts`                                                                    | 80%        |
| Cloudflare Access, `/connect` | as on `main`: no Access sign-in; no link scheme, no restricted entitlement                                                   | 85%        |
| Packaging                     | electron-builder; our script notarizes the DMG and writes the feed file                                                      | 75%        |
| Updates                       | electron-updater, per-architecture ZIPs with blockmaps, feed moved by each release                                           | 80%        |
| Bundle ID                     | final `chat.mindroom.app`; the beta is a separate app with its own profile                                                   | 85%        |
| Move of current users         | one Sparkle update that asks first; they sign in again; nothing is deleted                                                   | 85%        |

Bundled, not the remote URL the test shell loaded: it starts offline, ships shell and page as one tested
release, and never hands the bridge to whatever a server returns.

**The origin** holds the session and the crypto store, so it is fixed once the first build ships. Electron
serves the bundle under the scheme `capacitor` and the host `localhost`: every backend that works with the
iPhone app then works with the Mac app, with no backend change. Cost: none, it is a name. Risks: a server
cannot tell the Mac app from the phone by origin (the app's bound token is the proof, as today), and the
name misleads a reader, so only `nativeShell.ts` says which shell runs. P2's e2e repeats the test on the pin.

**The script policy.** The IPC checks tell the main frame from other frames, not bundled code from a
script injected into the main frame, and that frame holds the bridge. So every bundled HTML document is
served with `script-src 'self' <hashes of its own inline scripts> 'wasm-unsafe-eval'; worker-src 'self'
blob:`, in the one `Content-Security-Policy` header that also carries the `frame-ancestors` of the
requested route (`/connect` and `/invite` stay unframeable). No `'unsafe-eval'`, ever. Canvases would inherit that policy as `srcdoc` frames, so in the desktop app their frame
loads the bundled `/canvas-frame.html` by `src`. That page allows inline scripts and is fenced four ways:
its own header carries `sandbox allow-scripts allow-forms` (an opaque origin whoever embeds it); a
request for it, or for `/pdf-frame.html`, as a main frame is cancelled; IPC requires the sender's
`origin`, not only its URL, to be the app's; its loader takes one message, only from its parent window
with the app's origin, and the host takes "ready" only from that frame's window with origin `null`. The
web and the phone keep `srcdoc`. Cost: about 180 lines in P2b, before the signed beta. If the canvas
part passes about 170 lines, canvases show without scripts in the desktop beta, with a line that says so
(10 lines); the main page's policy is strict either way.

**The SSO return:** a login token is a bearer credential, so its way back must not be claimable. The
app listens on `http://127.0.0.1:<port>`: it works in the user's own browser, in a checkout and in the
beta, in about 140 lines. The listener is bound at the first sign-in and kept until Quit, so nobody else
can take the port while a browser tab may still return to it; each sign-in is a random path that expires.
Residual risk: after Quit the port is free, and a tab that returns then gives its single-use, short-lived
token to whatever local process bound that port next. Other price: a homeserver that does not allowlist
`127.0.0.1` shows its confirmation page (the Tuwunel fork, 74a430565, can allowlist). Rejected: a
`mindroom://` scheme (any app can claim it) and a universal link (the beta needs its own domain).

**Cloudflare Access** has no sign-in in any app on `main`, so the Electron app has none and adds no
notice. The app claims no link scheme, pairing links (`/connect`) open in the browser, and the final app
needs no restricted entitlement and no provisioning profile.

## Architecture

```
electron/main/   index.ts, bundleProtocol.ts, mainWindow.ts, windowState.ts, security.ts, ipc.ts,
                 mediaAuth.ts, authCallback.ts, menu.ts; later updater.ts, quickCapture.ts, helper.ts
electron/        preload.ts, build.mjs (esbuild, the script hashes, canvas-frame.html),
                 builder.config.cjs, entitlements.mac.plist, entitlements.helper.plist, native/helper.swift
src/app/lib/     desktopBridge.ts (the bridge's type), nativeShell.ts
```

`npm run build:desktop` is `npm run build:ios` (the Catalyst app's `dist` and `config.json`), then
`electron/build.mjs`. Electron is pinned exactly. `just strict` and `just lint` cover `electron/`.

### Loading

- The scheme `capacitor` is registered before the app is ready with `standard`, `secure`, `corsEnabled`,
  `stream` and `supportFetchAPI`, without `allowServiceWorkers`. The handler answers only the host
  `localhost`: a file of `dist` when the path names one inside it, 404 for a missing file under `/assets/`
  or `/_capacitor_`, and `index.html` for anything else (routes hold Matrix IDs with dots). It reads files
  itself and never loads a `file:` URL. An HTML answer has one `Content-Security-Policy` header: the
  resolved file's script policy joined with `framingHeaders()` of the requested path
  (`scripts/frame-headers.mjs:29-40`); `/canvas-frame.html` has its own.
- `dist` is packed inside `app.asar`. electron-builder's `electronFuses` turn on embedded archive
  integrity, loading only from the archive and cookie encryption, and turn off `ELECTRON_RUN_AS_NODE`,
  Node options, inspector arguments and the extra privileges of `file:`. The beta and the final app have
  separate profiles: `MindRoom Chat Beta` and `MindRoom Chat`. The page asks for persistent storage at
  startup, so the crypto store is never evicted.

### Shell detection

`src/app/lib/nativeShell.ts` (layer 0): `isBundledApp()` (Capacitor or Electron) replaces the general
`Capacitor.isNativePlatform()` checks; `isCapacitorApp()` stays for Capacitor's own plugins;
`desktopBridge()` is `window.mindroomDesktop` or undefined, and only this module reads that global (lint
rule). Capacitor reports the platform `web` in Electron, so `isNativeApp()` (`nativeSso.ts:88-89`) also
takes the bridge alone as enough; else SSO would take the web path. Each `native/*.ts` module keeps its
exports and chooses the transport inside. A sign-in from the Electron app is the device "MindRoom
Desktop"; the Catalyst app's is "MindRoom macOS".

### The bridge

One object per window, typed by `DesktopBridge`; members arrive with their phase. A call that can fail
resolves to `{ ok: true, value }` or `{ ok: false, code }`, because a thrown error loses its `code` across
IPC. Members: `onShellEvent` (full screen, zoom, window hidden, history); `setMediaSession(session)`; no
call that opens a URL;
`startSignIn({ homeserver, callback })` and `openSignIn(url)`; `appUrl` (the SSO return, in the shape
Capacitor's App plugin has); `screenShare`; `showMainWindow()`; `setBadge(count)`; `update?` (`status`,
`install`); `quickCapture?` (`hide`, `openScreenRecordingSettings`, `captureScreenshot?`).

### Security rules

- Context isolation and the renderer sandbox on, Node integration off, no `webview`.
- **Scripts:** the policy above, on every bundled HTML document; an e2e run fails on a violation it did
  not expect.
- **IPC:** every handler names the window it serves (main or Quick Capture) and rejects a call unless the
  sender is that window's `WebContents`, the frame is its current main frame, the frame's `origin` is
  `capacitor://localhost` (a sandboxed or failed page reports `null`), and its path is not a frame page,
  as judged by the protocol handler's own path resolution, which the navigation guard uses too.
  Arguments are validated per channel. `captureScreenshot` exists only in the Quick Capture window, which
  cannot leave `/quick-capture/`.
- **Leaving the app:** `setWindowOpenHandler` denies every popup, and P2 has no way out at all. P3 adds two
  narrow ones. `desktop:open-external` takes `http(s)` and `mailto` and refuses a Matrix media path or a
  URL with an `access_token`. The page cannot call it: only the preload sends it, for a trusted
  (`isTrusted`) `click` or middle-button `auxclick` that the page did not cancel, on an outside link or on
  a button marked `data-open-external` (a misleading link's Open button, the three `window.open` buttons).
  `desktop:open-sign-in` opens only a URL that main validated: HTTPS, or HTTP for a local host (the rule
  of `cs-api.ts:74-80`, as on the web and the phone); no credentials; the SSO endpoint of the homeserver
  named at `startSignIn`; exactly one `redirectUrl`, equal to the callback main stored.
- **Navigation:** a top-level navigation away from the origin, or to a frame page, is cancelled. A
  subframe (canvas, PDF viewer, embed) may navigate inside itself; its URLs are never forwarded outside.
- **Permissions:** both the check and the request handler, only for the main window's main frame:
  `media`, `notifications`, `clipboard-sanitized-write`, `fullscreen`, `persistent-storage`, on macOS 15
  or later `display-capture`, and `local-network`, `local-network-access`, `loopback-network` (local
  backends, LAN homeservers). Subframes get none.
- **Media authorization:** in the desktop app no media URL holds the token, so nothing copied, dragged or
  shown in a `title` can carry it. Main's `onBeforeSendHeaders` adds `Authorization` only to a first-hop
  `GET` that has none, from one of our windows' main frames, whose URL is media of that window's active
  account's homeserver (`validMediaRequest`). It never changes a header the caller sent (the SDK's own on
  `/sync`, explicit per-account media tokens), never adds one on a redirected hop, and gives subframes
  and canvases none. The page pushes its active session over IPC on every change and asks for
  authenticated media only once main has stored it, in memory only.
- **Canvases** are sandboxed by their frame page's own header (`allow-scripts allow-forms`): an opaque
  origin, no preload, and IPC rejects subframes.

## Features

New production lines, tests apart; "M2" is a check on the MacBook M2's screen. In all about 2,290 lines
over fourteen pull requests, each at most about 300, then one that only deletes about 2,800; the plan's
table has the exact sizes.

| Feature                  | Approach                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Lines | Test                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----: | --------------------------------------------------------------------------------------------------------------------- |
| Hidden title bar         | `titleBarStyle: 'hidden'`, `trafficLightPosition {12, 8}`; a 28 px strip: `--app-inset-top` replaces the 11 inset uses and the PopOut clamp, a `[data-titlebar-drag]` element drags, `#portalContainer` is `no-drag`; 0 in full screen                                                                                                                                                                                                                       |    65 | e2e: `#root` at 28 px, a dialog button and a menu inside the strip take clicks; M2 screenshot beside the Catalyst app |
| Window state             | bounds and full screen saved; restored only onto a display that exists; minimum 400 by 500                                                                                                                                                                                                                                                                                                                                                                   |    45 | unit: off-screen bounds; e2e: relaunch keeps the size                                                                 |
| Close and Quit           | the red button hides the window and the page keeps syncing (`backgroundThrottling: false`); a voice recording in progress is parked as a recovered recording and the microphone released (`parkLiveVoiceRecording`); the Dock shows the window; ⌘Q quits                                                                                                                                                                                                     |    30 | e2e: closed while recording, no live track, the draft is back on reopen; a message arrives meanwhile                  |
| Menus                    | App, Edit, View, Window, Help; no New Window, no Reload; context menu with spelling, Cut, Copy, Paste, Copy Link                                                                                                                                                                                                                                                                                                                                             |    80 | e2e: template; right click in the composer                                                                            |
| Back and Forward buttons | macOS gives Electron no event for mouse buttons 3 and 4 (`app-command` is Windows and Linux only), so the page walks its history on their `mouseup`, in the main window, as the Catalyst app does                                                                                                                                                                                                                                                            |    10 | e2e: CDP mouse `back` goes back exactly once                                                                          |
| Zoom                     | the page keeps its ⌘+, ⌘−, ⌘0 handler; the View items carry the same keys and send a `zoom` event                                                                                                                                                                                                                                                                                                                                                            |    20 | e2e: one key press is exactly one step, from the menu too                                                             |
| File save, drops, voice  | `FileSaver` downloads through Electron's save panel; drops are the page's own; the web recorder                                                                                                                                                                                                                                                                                                                                                              |    15 | e2e: download, Chromium's fake microphone; M2: drop from Finder, Photos, a screenshot thumbnail                       |
| Calls, screen share      | LiveKit in the page; `setDisplayMediaRequestHandler` with the system picker on macOS 15 or later; below it `browserSharesScreens()` hides the button. Chromium's capture helpers get the audio input and camera entitlements                                                                                                                                                                                                                                 |    30 | e2e: join step, a subframe's request denied; M2 (packaged): microphone, camera, share one window                      |
| Quick Capture            | a second window of type `panel`, 360 by 460, frameless, popover vibrancy, floating, on every Space; `globalShortcut` Control+Option+Space; `/quick-capture/` in the same profile; screenshot buttons only when the bridge has `captureScreenshot`                                                                                                                                                                                                            |   170 | e2e: toggle, hide, channel; M2: over another app and a full-screen Space, the keyboard goes back                      |
| Screenshot               | Before the panel shows, the signed Swift helper notes the frontmost app and window with `NSWorkspace.frontmostApplication` and `CGWindowListCopyWindowInfo` (never `SCShareableContent`, which may prompt at every toggle; a toggle from our own menu sees our own app). `window` captures exactly that target with the logic of `MacScreenshot.swift` and fails if it is gone; `screen` is the widget's display without this app's windows, excluded by PID |   200 | unit: result mapping; M2: both modes, TextEdit in front, target closed, denied permission, no prompt on toggle        |
| Notifications            | the web path, also with the window closed; a click shows the window; Dock badge, cleared on sign-out. If sync stalls while hidden, `powerSaveBlocker('prevent-app-suspension')`. After Quit nothing arrives on the Mac; the first-run text says so                                                                                                                                                                                                           |    95 | e2e, own timeout: after five hidden minutes a message notifies once and its click opens the thread                    |

**To prove on the M2:** a `panel` window gives the keyboard back (else `app.hide()` while the main window
is hidden); Chromium keeps a file promise's file; the helper's capture counts as the app's for the Screen
Recording permission.

## Sign-in and links

- **SSO.** `SSOLogin.tsx:122` passes the homeserver to `openNativeSsoBrowser`, which calls
  `startSignIn({ homeserver, callback })` with the route and query of its return address, the `ssoNonce`
  among them. Main returns `http://127.0.0.1:<port>/auth/<random><callback>` and stores it; the page puts
  it in `redirectUrl` and calls `openSignIn`, which main validates as in "Security rules" before
  `shell.openExternal`. A return is delivered only when it is a `GET`, its `Host` is the listener's own,
  its path is the stored one, and its query is the stored one plus exactly one `loginToken`, no parameter
  twice. Anything else gets 404 and changes nothing. A path dies after one valid return, after 30 minutes,
  or at the next sign-in; the listener itself stays until Quit. A valid return gets a page that says to go
  back, brings the app forward (`showMainWindow`, `app.focus({ steal: true })`) and reaches the page as
  the `mindroom://auth/...` address it already parses. `ssoReturn.ts` still decides.
- **Sign in with Apple** goes through this browser sign-in, as it already does in the Catalyst app.
  **Cloudflare Access and `/connect`** are not in the desktop app (see "Decisions" and "Later").

## Release and updates

- **Build:** electron-builder signs the app with the hardened runtime, notarizes and staples it, then makes
  one universal DMG and one ZIP per architecture with its blockmap. `entitlementsInherit` gives the
  helpers JIT, audio input and camera; the app has no restricted entitlement. Our script signs, notarizes
  and staples the DMG and writes `latest-mac.yml` from the final bytes. Before any upload it checks the
  Developer ID signature, the stapled ticket and Gatekeeper's verdict (`spctl --type open` for the DMG,
  `--type execute` for the app unpacked from each ZIP), since electron-builder can skip notarization and
  still succeed. `extendInfo`
  carries the usage texts of `ios/App/App/Info.plist`, local network included, and
  `NSAudioCaptureUsageDescription` for the system picker's audio.
- **Updater:** electron-updater checks at launch and hourly, downloads in the background, installs on
  quit; the existing "new version" card and the app menu offer the restart. **Feed:** `latest-mac.yml` on
  a fixed prerelease tag with absolute URLs under `download/vYYYY.M.N/`, so the version swap finds the old
  blockmap across tags. `scripts/macos-publish-appcast.sh` publishes both feeds under today's rule: one
  run at a time, never backwards.
- **Stopping a rollout** is a runbook, not a switch in a workflow variable: GitHub fixes `vars` when a run
  is queued. Upload the asset `PAUSED` to each feed tag; the publish script, which already lists that
  release's assets under its lock right before it writes, then writes nothing and tells no tap, and fails
  closed when it cannot read the list. Wait until no publisher runs, then put the last good
  `latest-mac.yml` and `appcast.xml` back with `gh release upload --clobber`, revert the tap's cask commit,
  and mark the bad release a prerelease (`gh release edit --prerelease`), so `macApp.ts:25-40` stops
  offering its DMG. An update a Mac already downloaded still installs at its next quit: that Mac is
  recovered by hand. Decided in P6's PR.

## Migration

> **Superseded (Bas, 2026-11-22):** the Catalyst Mac app has no users, so there is no backward compatibility. No migration, notice, move card, rollback DMG or Sparkle hand-over is built; the Electron app ships under the final names from its first signed DMG and the Catalyst Mac code is deleted once Bas has it installed. The text below is kept as the record of the earlier plan.

Chromium cannot read WebKit's storage, so the session and the crypto store do not carry over. **The old
app's data is never deleted or touched** (`~/Library/WebKit/chat.mindroom.app` and
`~/Library/Caches/chat.mindroom.app` on the M2): Electron cannot see which accounts live only there.

1. **Notice (Catalyst app), per account.** A card says the next update is a new app and a new sign-in. An
   account is safe to move only when an encrypted key export was saved. The backup's progress is advisory:
   no public SDK call says that the current backup version holds every key. Another verified device is not
   enough. "Export keys" is offered in every state; "I understand the risk" hides the card for a day. The
   same release makes the Catalyst app register its pusher as "MindRoom macOS", whatever the config names.
2. **Rollback DMG, made first.** While `macos.yml` exists, a manual input builds the last Catalyst release
   with `build-macos-app.sh --no-updater` (it passes `MINDROOM_UPDATE_FEED_URL=` to `xcodebuild`, so the
   app never starts the updater), signed and notarized, onto the fixed tag `mac-catalyst-archive` as
   `MindRoom-Chat-Catalyst.dmg`. Installed, it opens the old data again.
3. **Handoff release.** The Electron app ships as `MindRoom Chat.app` in `MindRoom-Chat.dmg`, bundle ID
   `chat.mindroom.app`, same team, with `SUPublicEDKey`. Its Sparkle item has
   `sparkle:minimumAutoupdateVersion`, so Sparkle asks instead of installing silently. That makes it a
   major upgrade, whose window keeps "Skip This Version" and "Remind Me Later": declining leaves the
   Catalyst app as it was, and the notice with its download link reaches those who skip. The recovery
   warning is in the item's notes, the release notes and the cask's caveats. `desktop.yml` becomes the one
   DMG publisher and owns the Sparkle feed; `macos.yml` keeps its manual run.
4. **First run (Electron).** Sign in, verify, restore from the backup or import the export. The rollback
   DMG is linked before sign-in too (the signed-out screen and Help), since Sparkle replaced the old app. A
   card stays until the session has a working backup and the user confirms that old messages read. Nothing
   signs the old session out. In the final app only, once the user confirms the move, the card removes
   the pushers named "MindRoom macOS", never a phone's (else banners double), and links Settings,
   Sessions, with the warning that signing out "MindRoom macOS" deletes that account's data in the old
   app and ends the way back. Once every account moved, it names the old folders, which the user may
   delete by hand; the cask's `zap` never lists them (an uninstall must not erase another account's keys).
5. **Getting a Mac back:** to the previous Electron release, its DMG; to Catalyst, the rollback DMG. The
   rehearsals are in the plan's P13.

## Testing

Unit tests (vitest, Node) cover the pure parts of `electron/main` and the bridge transports. e2e
(`e2e/electron/`, Playwright `_electron`, own config) runs the unpackaged shell over a production `dist`
on macOS: `macos-26` for specs without a homeserver, the M2 for all and for packaged checks.

## Risks

- **Update size.** A full download is about 110 MB per architecture (estimate) against 25 MB today; the
  first update after a DMG install is full, later ones differential. P6 measures; no size is a gate.
- **We ship the browser:** Chromium fixes arrive only with an Electron bump, monthly. **Minimum macOS** is
  13.3 today. **Licenses:** electron-builder must pass `just license-check`.

## Questions for Bas

Standing unless Bas objects: sign in again (Astra 95, Opus 80, Neon 85%); no push after Quit at first (85,
75, 80%); Mac App Store later (90, 75, 90%); Intel Macs supported (90, 70, 80%). Open: **how long the
Sparkle feed follows releases** after the cutover (I recommend six months, 70%); **is the Catalyst app
live on the Mac App Store?** (if so, P14 keeps `AppStoreMac` until a `mas` build replaces it).

## Later, not in this plan

- **Cloudflare Access** support is a separate decision, for every app at once: nothing mounts it today.
- **`/connect` as a universal link:** `continue-activity` (`NSUserActivityTypeBrowsingWeb`,
  `details.webpageURL`) registered in `will-finish-launching`, exact origin and route, queued until the
  renderer is ready; no `open-url`. It brings the associated-domain entitlement and a profile.
- **APNs after Quit** (about 200 lines). **Mac App Store:** Electron's `mas` build (about 200 lines, one
  to two weeks of review). **The watch's Handoff.** A main-process diagnostics store. Not in scope at
  all: Windows and Linux, a new title bar design.
