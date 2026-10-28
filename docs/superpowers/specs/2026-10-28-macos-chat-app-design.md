# MindRoom Chat for Mac, installable with Homebrew

## Understanding

Said:

- MindRoom Chat should be a Mac app that installs with Homebrew, beside the App Store app.
- It stays a separate app from MindRoom.app, the menu bar app that runs agents.
- MindRoom.app should integrate with it.

Assumed:

- Success is `brew install --cask mindroom-ai/tap/mindroom-chat` on any Mac with macOS 13.3 or later, Intel or Apple silicon, giving the same features as the iPhone app: sign-in (password, SSO, Sign in with Apple, Cloudflare Access), push notifications, file saving and `/connect` pairing links.
- Homebrew is the update channel. No in-app updater in the first version.
- The App Store listing stays as it is ("Designed for iPad" on Apple silicon Macs).

## Current state

- The App Store build runs on Apple silicon Macs only and cannot be installed by a cask or by `mas` (mas-cli/mas#321).
- `ios/App` is a Capacitor 8 project with about 1,200 lines of Swift: `MindRoomAuthPlugin` (`ASWebAuthenticationSession`, Sign in with Apple), `MindRoomFileSavePlugin`, diagnostics and `MindRoomBridgeViewController`.
  The Podfile holds only first-party Capacitor pods.
- MindRoom.app (`mindroom/macos/`) ships a Developer ID signed, notarized DMG from `release.yml` on `macos-latest`, updates through Sparkle, and has a cask in `mindroom-ai/homebrew-tap`, bumped by `update-mindroom-cask.yml` on a `repository_dispatch`.
- Chat releases come from `auto-mindroom-release.yml` on every push to `dev` (tags such as `v4.12.6-mindroom.268`).
- Pairing a local MindRoom runs from the runtime's side since #335.
  The runtime prints `https://chat.mindroom.chat/connect?code=ABCD-EFGH`, and chat approves it ([iOS pairing links](../../ios-pairing-links.md)).
  MindRoom.app still offers "Pair Hosted MindRoom...", which runs `mindroom connect --pair-code` with a code that chat no longer shows.

## Decisions

1. **Shell: a Mac Catalyst build of the existing `ios/App` target.**
   It reuses the Swift plugins, the `capacitor://localhost` storage origin, APNs push and the Xcode project.
   Catalyst builds cover arm64 and x86_64.
   Rejected: a WKWebView shell (Tauri or AppKit) would need new bridges for `window.Notification`, SSO and Cloudflare Access.
   Electron would add a 150–200 MB download and leave Chromium patching to us.
2. **Bundle ID: `chat.mindroom.app`, the same as iOS** (`DERIVE_MACCATALYST_PRODUCT_BUNDLE_IDENTIFIER = NO`).
   The push gateway `appId`, the apple-app-site-association `appIDs`, Sign in with Apple and the APNs topic all stay unchanged.
   A later Mac App Store Catalyst build would become a universal purchase.
   Cost: a Mac that also has the App Store iPad app has two apps with one bundle ID, and universal links may open either one.
   The docs say to use one or the other.
3. **Distribution: Developer ID signed and notarized DMG on each chat GitHub release, plus a `mindroom-chat` cask in `mindroom-ai/homebrew-tap`.**
   The repository is public, so macOS runners cost nothing.
4. **Updates: `brew upgrade` only.**
   Sparkle is AppKit and does not link into a Catalyst app.
5. **MindRoom.app stays a separate app** that opens the chat app and hands it pairing links (see Integration).

## Sub-projects

| #   | Repo                        | Content                                                                                            | Order                     |
| --- | --------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------- |
| 1   | mindroom-chat, homebrew-tap | Catalyst build, Mac-specific behavior, release job, `mindroom-chat` cask                           | First; gated by the spike |
| 2   | mindroom                    | MindRoom.app opens the chat app, switches to link pairing, and its cask depends on `mindroom-chat` | After 1 ships a cask      |

This spec details sub-project 1 and fixes the contract that sub-project 2 depends on.
Sub-project 2 gets its own plan in the mindroom repository.

## Sub-project 1: the chat app

### Phase 0: spike gates

- **G1, compile:** an unsigned Catalyst archive (`-destination 'generic/platform=macOS,variant=Mac Catalyst'`, `CODE_SIGNING_ALLOWED=NO`) builds on a `macos-latest` runner with every pod.
  If a pod fails, patch it with `patch-package` (already used for npm patches).
  If that also fails, stop and write a WKWebView-shell spec instead.
- **G2, Apple account:** an Account Holder or Admin confirms that a Developer ID provisioning profile for `chat.mindroom.app` with Mac Catalyst can carry Push Notifications, Associated Domains and Sign in with Apple.
  Any capability that cannot ship is removed from the Mac entitlements, and its feature falls back to the web path.
- **G3, run:** on a real Mac, the build launches, signs in with a password and SSO, syncs, opens a thread, sends a message, and saves a file.

### Mac-specific behavior

- On Catalyst, `Capacitor.getPlatform()` returns `ios`, so every `isNativeIOS()` path (8 files) and every `getPlatform()` check (17 call sites) also runs on Mac.
- `MindRoomBridgeViewController` detects `ProcessInfo.processInfo.isMacCatalystApp` and:
  - sets `preferredContentMode` to `.desktop`, so the page sees a Mac Safari user agent rather than an iPhone one;
  - adds the user-agent token `MindRoomMac`.
- `nativeSso.ts` adds `isNativeMac()` next to `isNativeIOS()`, reading that token.
  Each existing caller is audited and kept or excluded on Mac:
  - kept: native SSO, Cloudflare Access, push, file save;
  - expected no-ops: keyboard resize, status bar, haptics;
  - to check: touch-only gestures and the iOS web-platform checks.
- `SceneDelegate` sets a minimum window size under `#if targetEnvironment(macCatalyst)`.
  Default Catalyst menus and title bar are kept.

### Release job

A `macos_app` job is added to `auto-mindroom-release.yml`, with `needs: release` and `runs-on: macos-latest`. It:

1. runs `npm ci`, `npm run build:ios`, `npx cap sync ios` and `pod install`;
2. archives for Mac Catalyst and exports with `method: developer-id`, using the Developer ID certificate and provisioning profile;
3. notarizes with `notarytool`, staples, and builds `MindRoom-Chat.dmg` with `hdiutil`;
4. uploads the DMG to the release with `gh release upload`;
5. sends `repository_dispatch` type `mindroom-chat-release` to `mindroom-ai/homebrew-tap`.

New repository secrets:

- the MindRoom.app signing set: `MACOS_CODESIGN_CERTIFICATE_BASE64`, `MACOS_CODESIGN_CERTIFICATE_PASSWORD`, `MACOS_KEYCHAIN_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`;
- `MACOS_PROVISIONING_PROFILE_BASE64`;
- the release bot GitHub App that mindroom uses to dispatch to the tap: `RELEASE_BOT_PRIVATE_KEY` and the `RELEASE_BOT_APP_ID` variable, with the app installed on `homebrew-tap`.

Today this repository has none of them.

`CFBundleShortVersionString` comes from the release tag's base version, as the iOS archive does.

### Cask

`Casks/mindroom-chat.rb`: `url` points at `.../mindroom-chat/releases/download/v#{version}/MindRoom-Chat.dmg`, with `app "MindRoom Chat.app"`, `depends_on macos: :ventura` (casks cannot name 13.3, the minimum that the iOS 16.4 deployment target implies for Catalyst), a `github_latest` livecheck, and `zap` entries for `~/Library/WebKit/chat.mindroom.app`, `~/Library/Caches/chat.mindroom.app` and `~/Library/Preferences/chat.mindroom.app.plist` (paths confirmed in G3).
The tap's update script and workflow take the cask name, repository and asset, so one script serves both casks.

### Docs

- README's Mac row lists `brew install --cask mindroom-ai/tap/mindroom-chat`.
- `ios-pairing-links.md` notes that the Mac app shares the association.
- The Runbook records each phase.

## Integration contract with MindRoom.app

- MindRoom.app finds the chat app with `NSWorkspace.shared.urlForApplication(withBundleIdentifier: "chat.mindroom.app")`.
  The shared bundle ID means the App Store iPad app on Apple silicon also matches.
- "Open chat.mindroom.chat" becomes "Open MindRoom Chat": it opens the app if found, otherwise the website in the browser.
- Pairing moves to the runtime-first flow from #335.
  MindRoom.app starts pairing through the runtime, takes the printed `https://chat.mindroom.chat/connect?code=…` link, and opens it with the chat app (`NSWorkspace.open(_:withApplicationAt:configuration:)`), otherwise in the browser.
  The user compares the code and approves in chat, as today.
  Sub-project 2 confirms which CLI command starts that flow without a terminal, and that a Catalyst app receives an `https` URL opened this way.
  If it does not, the fallback is a `mindroom://connect?code=` route in the chat's existing `mindroom` URL handler, limited to `/connect`.
- 🔒 MindRoom.app registers no URL scheme, and never `mindroom://`, which is chat's SSO callback scheme.
  Pairing always starts on the machine and is approved in signed-in chat, so no external link can trigger pairing.
- The `mindroom` cask gains `depends_on cask: "mindroom-ai/tap/mindroom-chat"`, so installing the full MindRoom also installs chat.
  The stale "Pair Hosted MindRoom..." item and its docs are replaced.

## Testing

- Unit: `isNativeMac()` detection, and each caller whose Mac branch changes.
- CI: an unsigned Catalyst compile job on pull requests that touch `ios/` or `capacitor.config.ts`.
- Tap CI: the existing `brew style`, `brew audit --online` and `brew install --dry-run` steps, run for `mindroom-chat`.
- Manual Mac checklist (G3 plus): push arrives with the app closed, a `/connect` link opens the app, Cmd+C/V in the composer, window resizing, and `brew uninstall --zap`.

## Out of scope

- Sparkle or any in-app updater.
- A Mac App Store Catalyst submission.
- Putting chat inside MindRoom.app.
- Windows and Linux builds.
- A chat menu bar item.
