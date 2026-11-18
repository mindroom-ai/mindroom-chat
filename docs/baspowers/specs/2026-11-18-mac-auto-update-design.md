# Mac app: automatic updates with a Reload card

Date: 2026-11-18. Path: architectural (a new native subsystem, a new release artifact, a new secret).

## Understanding

Bas said: "in the macos app. can we add something such that it self-updates automatically. and then shows a reload button like in the browser, when clicked, it updates itself and installs the pre-downloaded version".

- **Outcome:** the Developer ID Mac app (the DMG, also what Homebrew installs) downloads each new release by itself, in the background. Once a release is downloaded and checked, the app shows the card the browser shows ("A new version of MindRoom is available." with Reload). Reload quits the app, installs the downloaded version and opens it again. A user who never presses it gets the update the next time the app quits.
- **For:** everyone who runs the Mac app outside the App Store, Bas first: releases follow every green push to `main` (283 in November so far, 12 today), and today the app only changes when someone installs a DMG again.
- **Success:** no dialog, no settings, no manual download. The card looks and reads as in the browser.
- **Assumed, not said:** no settings toggle, no channel picker, no release notes, no "Check for Updates" menu item. The Mac App Store app and iOS keep updating through the Store.

## What the code says

- **Release route.** `release.yml` cuts a release after every green push and calls `macos.yml` with its tag (`secrets: inherit`). `macos.yml:133-148` runs `scripts/build-macos-app.sh --sign` with `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` both `YYYY.M.N`; the script archives scheme `App` for Mac Catalyst (`:86-93`), exports with Developer ID (`:112-117`), notarizes and staples the app and then the DMG (`:126-133`). `macos.yml:149-153` attaches `MindRoom.dmg`, `:154-185` asks the Homebrew tap to follow while the release is still the newest. Pull requests build unsigned and publish nothing (`:96-100`).
- **The gap.** Today's 12 releases got their DMG 8 to 20 minutes after they were published (GitHub releases API, 2026-11-18). The newest release had no DMG for 24% of 08:33 to 18:05 UTC, and for 58% of the 14:55 to 18:05 burst. `src/app/native/macApp.ts:17-22` already works around this for the download links (#584).
- **Not sandboxed.** `ios/App/App/App-macOS.entitlements` has no `com.apple.security.app-sandbox`; `App-macOS-AppStore.entitlements:5` has it.
- **The brief's claim that `MindRoomMacSupport.bundle` is in both apps is wrong.** Only `AppStoreMac` embeds it: its build phases list "Embed Native Mac Support" (`project.pbxproj:506-520`), `App`'s do not (`:419-431`). `MacWindowingStore.swift:47` compiles only with `MINDROOM_MAC_APP_STORE`. The Developer ID app links no AppKit at all and reaches it through the Objective-C runtime (`MacWindowing.swift:6-7`).
- **One Info.plist for both apps and iOS.** `App` and `AppStoreMac` both use `App/Info.plist` (`project.pbxproj:1007`, `:1037`, `:1242`, `:1280`). Each target has its own Sources list, and `MindRoomBridgeViewController.swift` is in both.
- **The browser's update path never fires in the app.** `appUpdate.ts:85-102` compares `version.json` of the page's origin with the running build; in the app that file is bundled (`capacitor.config.ts:7`), so they are always equal. The card (`NewVersionNotice.tsx:36-50`) shows `getReadyVersion()` and its button calls `reloadForNewVersion()`. `PartUnavailable.tsx:35`, `AppErrorBoundary.tsx:27` and `client-sdk/core.ts:46-50` call the same function and all handle its rejection.
- **The card is mounted above the router** (`App.tsx:106-109`), so the Quick Capture window's page would show it too.
- **Patterns to follow.** A platform filter on a dependency and an embed (`platformFilter = ios`, `project.pbxproj:36`, `:804`). A pinned download before the build (`scripts/watch/build-sdk.sh --fetch`, `build-macos-app.sh:80`). A debug acceptance fixture behind an environment variable (`MindRoomBridgeViewController.swift:64-99`). Script tests that run the real script with stubbed tools (`macCatalystRelease.test.ts:13-107`).

## Approaches

1. **Sparkle 2 in a new macOS plug-in bundle that only `App` embeds (chosen).** Sparkle is the standard Mac updater: it checks a feed, downloads, verifies an EdDSA signature, replaces the app and opens it again. Its documentation describes this exact setup for Mac Catalyst: "inside an AppKit bundle plug-in that is loaded by the Catalyst application using a shared PlugIn protocol" [1]. Its automatic mode has the hook the card needs: `updater(_:willInstallUpdateOnQuit:immediateInstallationBlock:)` [2].
2. **A hand-written updater.** Download, signature and notarization check, atomic swap, a helper that outlives the app to open the new one, authorization when the folder is not writable. All of it is security-critical and all of it exists in Sparkle. Rejected.
3. **Sparkle inside `MindRoomMacSupport.bundle` with a Store exclusion.** That bundle is the Store app's, the one place an updater must never be, and the Developer ID app does not load it. Rejected.
4. **Sparkle's own update window instead of the card.** Less code (no plugin, no JS), but Bas asked for the browser's card. Sparkle's window stays as the fallback for the one case that needs a password (below).

How Sparkle gets into the project:

| Way | Verdict |
|---|---|
| **Pinned release tarball, fetched by a script (chosen)** | `Sparkle-2.10.1.tar.xz`, sha256 `1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27`, holds `Sparkle.framework` and `bin/generate_appcast`. The bundle target links and embeds the framework with ordinary build phases, which is Sparkle's documented manual setup, "This applies to the setup for the plug-in target as well" [1]. Builds that do not build the bundle (iOS, the Store app, Xcode Cloud) never download it. Same shape as the watch SDK fetch. |
| Swift package in the project | Xcode would resolve it for every build of the project, iOS and Store included. Whether Xcode embeds a package's binary framework into a plug-in bundle (and not the app) is not something I could confirm. The signing tools would sit in DerivedData. |
| CocoaPods `Sparkle` | The Podfile is `platform :ios`; the pod is macOS only, and CocoaPods adds no embed step to a bundle target. |

## Design

### Behavior

- The app checks the feed when it starts (if the last check is more than an hour old) and every hour while it runs. Nothing shows while it checks or downloads.
- A newer release is downloaded, its EdDSA signature is checked before it is unpacked, and Sparkle's installer is staged. Then the card appears in the main window: same text, same Reload button, same dismiss as in the browser.
- **Reload:** the button spins and says "Updating…", the app quits, the new version is installed and opens. If the app is still running 10 seconds later, the button returns.
- **Dismiss:** the card stays away until the app restarts. The update installs when the app quits.
- After an update is staged Sparkle stops checking until the app restarts [2]. So a long-running app installs the staged version, not the newest; the restarted app finds the newest on its next check and shows the card again. With one release every half hour this is the price of downloading at most one 28 MB DMG per run.
- The Quick Capture window shows no card: it is a 360 by 460 panel, and the main window has it.
- Debug builds and builds without the feed setting have no updater: a local build (`CFBundleVersion` 33) would otherwise replace itself with the release.

### Architecture

| File | Role |
|---|---|
| `scripts/fetch-sparkle.sh` | Downloads the pinned tarball, checks its sha256, unpacks `Sparkle.framework`, `bin/` and `LICENSE` into `ios/MacUpdater/Sparkle/` (git-ignored). A no-op when that version is there. |
| `ios/MacUpdater/MindRoomMacUpdaterProtocol.swift` | The two calls the app makes: `start(onReady:)` and `install() -> Bool`. Compiled into `App` and the bundle. |
| `ios/MacUpdater/MindRoomMacUpdater.swift`, `Info.plist` | The bundle (`chat.mindroom.app.mac-updater`, principal class `MindRoomMacUpdater`): owns the `SPUUpdater`, is its delegate, keeps the immediate-install block. |
| `ios/App/App/MacUpdater.swift` | Catalyst side: loads the bundle from `Contents/PlugIns`, starts it, keeps the ready version, logs it, posts a notification. |
| `ios/App/App/MindRoomUpdatePlugin.swift` | Capacitor plugin `MindRoomUpdate`: event `ready` `{ version }`, method `install()`. |
| `src/app/native/nativeUpdate.ts` | `watchNativeUpdate()`: listens for `ready` and hands the version and the install call to `appUpdate.ts`. |
| `src/app/config/appUpdate.ts` | `offerAppUpdate(version, install)`; `reloadForNewVersion()` installs when an app update is offered. |
| `scripts/macos-updater-info-plist.sh` | Build phase of `App`: writes the updater's Info.plist keys into the built Mac app. |
| `scripts/macos-appcast.sh` | Makes the signed `appcast.xml` for one DMG with Sparkle's `generate_appcast`. |

Data flow: `AppDelegate` calls `MacUpdater.start()` at launch, before any page exists, so a broken page cannot stop an update. Sparkle downloads and stages; its delegate call hands over the version and the install block; `MacUpdater` posts `MindRoomUpdateReady`; the plugin raises `ready`, and answers every page that starts listening with the version already staged, so a page that loads later or is reloaded hears it too (Capacitor's kept events reach only the first listener, `CAPPlugin.m:44-66`); `watchNativeUpdate` calls `offerAppUpdate`; the card shows. Reload calls `reloadForNewVersion()`, which calls the plugin's `install()`, which runs the block: Sparkle asks the app to quit, installs and relaunches.

### Where Sparkle links

A new target `MindRoomMacUpdater` (`com.apple.product-type.bundle`, `SDKROOT = macosx`, deployment target 13.3, like `MindRoomMacSupport`). It links `Sparkle.framework`, embeds it in its own `Contents/Frameworks` (Code Sign On Copy) and has `LD_RUNPATH_SEARCH_PATHS = @loader_path/../Frameworks`. Target `App` depends on it and embeds it in `Contents/PlugIns`, both with `platformFilter = maccatalyst`, so iOS builds skip it. `AppStoreMac` gets neither. Sparkle's host bundle is `Bundle.main`, which inside the plug-in is the app. Sparkle's tools expect this layout: `generate_appcast` looks for the framework "inside another framework or plug-in" (`generate_appcast/ArchiveItem.swift:285`).

The bundle uses `SPUUpdater` with `SPUStandardUserDriver`, not `SPUStandardUpdaterController`: the controller shows a modal alert when the updater cannot start (`SPUStandardUpdaterController.m:78-101`), and here a failed start is only logged.

### Info.plist keys

Only the built Mac `App` gets them. They cannot live in `App/Info.plist`, which the Store app and iOS share. A Run Script phase of `App` runs `scripts/macos-updater-info-plist.sh` after the Info.plist is processed and before signing. It does nothing unless `IS_MACCATALYST = YES` and the build setting `MINDROOM_UPDATE_FEED_URL` is set; then `MINDROOM_UPDATE_PUBLIC_KEY` must be a 44-character base64 key, or the build fails. Both settings exist only in `App`'s Release configuration.

| Key | Value | Why |
|---|---|---|
| `SUFeedURL` | `https://github.com/mindroom-ai/mindroom-chat/releases/download/mac-appcast/appcast.xml` | The feed (below) |
| `SUPublicEDKey` | Bas's public key | Sparkle reads it only from the host's Info.plist |
| `SUEnableAutomaticChecks` | true | No "check automatically?" question on the second launch [3] |
| `SUAutomaticallyUpdate` | true | Download and stage without asking [3] |
| `SUScheduledCheckInterval` | 3600 | Sparkle's minimum; releases come many times a day |
| `SUVerifyUpdateBeforeExtraction` | true | The DMG is not mounted before its signature is checked; a lost key can still be replaced, because the DMG is signed with Developer ID [3] |

### Feed

- **What:** a one-item `appcast.xml` for the release's DMG, made by Sparkle's `generate_appcast`. The tool mounts the DMG and reads the item from the app itself: `sparkle:version` from `CFBundleVersion` (`YYYY.M.N`), the short version, `LSMinimumSystemVersion`, the length. It signs the DMG's bytes with the private key, so it runs after the DMG is stapled. The enclosure is `https://github.com/mindroom-ai/mindroom-chat/releases/download/<tag>/MindRoom.dmg`. No release notes.
- **Versions order correctly.** Sparkle's comparator compares the numbers between the dots as numbers (`SUStandardVersionComparator.m:196-218`): `2026.11.9 < 2026.11.10 < 2026.12.0`. The e2e updates from `2026.11.9` to `2026.11.10`.
- **DMG, not zip.** Sparkle takes a DMG [4], and the release's one artifact keeps one checksum for Homebrew. The window layout of #580 is irrelevant to Sparkle: it copies the volume, ignores the Applications link (`Autoupdate/SUInstaller.m:49-73`) and finds the app by file name or, for a renamed app such as Homebrew's `MindRoom Chat.app`, by bundle identifier (`:102-110`).
- **Where: one prerelease, `mac-appcast`, whose `appcast.xml` is replaced** (`gh release upload --clobber`) once a release's DMG is up and that release is still the newest, the condition the cask update already uses (`macos.yml:154-166`). The job creates the prerelease when it is missing. The feed therefore always names a DMG that exists.
- **Rejected: `releases/latest/download/appcast.xml`.** Two lines less, but that URL is a 404 from the moment a release is published until its DMG is up: 24% of today, 58% of the afternoon. A failed check is silent (below) and the next one is an hour later, so the app would lag by hours exactly when releases are frequent.
- **Rejected: the tap repository or chat.mindroom.chat.** Another repository's workflow, or a manual web publish.
- **A stale or replayed feed is harmless:** Sparkle only offers a version above the running one, and the DMG's signature is what is trusted, not the feed.

### JS seam

`appUpdate.ts` gains one export and one branch:

- `offerAppUpdate(version, install)` sets `newVersion` and `readyVersion` to `version`, keeps `install`, and notifies. The card appears through the existing `getReadyVersion()`; nothing in `NewVersionNotice.tsx` changes.
- `reloadForNewVersion()`, when an install is kept: `await install()`, wait `timeoutMs` (10 s), then reject. The app quits within moments of `install()`, so reaching the rejection means the install did not start; every caller already turns a rejection back into a pressable button. Without a kept install the function is unchanged.

So `PartUnavailable`, `AppErrorBoundary` and the plugin API `reloadForNewVersion` install a staged update when there is one (a restart into the new version is what each of them wants) and reload the page as before when there is none.

`src/app/native/nativeUpdate.ts` is the only file that knows the plugin; `config` stays below `native` in the layers. `src/index.tsx` calls `watchNativeUpdate()` beside `watchForNewVersion()`. The plugin is registered on the main window's bridge only, so the Quick Capture page finds no plugin and offers nothing.

### Signing

- **What Sparkle checks.** With `SUVerifyUpdateBeforeExtraction`, the DMG must carry a valid EdDSA signature of the installed app's public key before it is opened (`SUUpdateValidator.m:60-98`). The fallback, for a replaced key, is a DMG signed with Developer ID by the installed app's team. After unpacking, an update whose Apple signature is broken is refused (`:193-208`). The Apple signature is a second gate, not a second required one: Sparkle's rule is "Either DSA must be valid, or Apple Code Signing must be valid" (`:371-375`).
- **Sparkle's helpers.** The framework carries `Autoupdate`, `Updater.app` and two XPC services (unused without a sandbox), ad-hoc signed with the hardened runtime. Embedding re-signs only the framework. "Xcode does re-sign these services and helpers, preserves the Hardened Runtime ... when you Archive and Export an application for notarization" [5], which is what `build-macos-app.sh` does. The framework sits one level deeper than usual (in the plug-in), so the script checks it: after the export, each of the five must be signed by team `DNA6966LGZ`, or the build stops before notarization. `generate_appcast` validates the app's nested signatures again, and notarization is the third gate.
- **If that check fails on the first signed release:** sign the helpers in a script phase of the bundle target with Sparkle's documented commands [5] (no `--deep`), and release again.

### The Store app stays updater-free

- `AppStoreMac` has no dependency on the updater target, no embed phase and no Info.plist phase. `MacUpdater.swift` and `MindRoomUpdatePlugin.swift` are in `App`'s Sources only, and their contents and every use of them compile only with `targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE`.
- `scripts/macos-store-preflight.mjs` fails on a Store artifact that has a path containing `Sparkle` or `MindRoomMacUpdater`, an Info.plist key shaped like Sparkle's (`SU` and a capitalized word), or the strings `SPUUpdater` or `MindRoomMacUpdater` in a binary. `macos.yml` already archives the Store app and runs the preflight on every Mac pull request.

### Errors

| Case | What happens |
|---|---|
| Offline, feed missing, GitHub down, a bad feed | The check fails, Sparkle logs it, nothing shows (the automatic driver has no error UI; the scheduled one shows errors only after it showed an update, `SPUScheduledUpdateDriver.m:104-106`). Next check in an hour. |
| DMG with a wrong or missing signature | Refused before it is mounted, logged, nothing shows. |
| The user cannot write the app's folder (a standard account, an app an administrator installed) | Sparkle cannot install silently (`InstallerLauncher/SUInstallerLauncher.m:469-471`) and falls back to its own window, which offers the update and has macOS ask for an administrator. No card. Accepted: an app dragged to `/Applications` or installed by Homebrew is owned by the user. |
| App opened from the DMG, or translocated by Gatekeeper | Sparkle refuses to update a read-only location (`SPUBasicUpdateDriver.m:70-82`). In the background that is silent: the app works and never updates until it is moved to Applications. |
| Reload pressed, the app does not quit | After 10 s the button returns. The update still installs on quit. |
| The install fails after the app quit | Sparkle's installer puts the new app in place only after it validated it; the old app stays. Not exercised by the e2e. |
| The bundle or Sparkle fails to load or start | One log line; the app runs without updates. |

### Bootstrap, Homebrew

- Apps installed before this ships have no updater. Each needs the first DMG that carries it installed by hand, once (or `brew upgrade --cask mindroom-chat`).
- Follow-up in `mindroom-ai/homebrew-tap` (another repository, not part of this work): `auto_updates true` in the cask, so `brew upgrade` leaves a self-updated app alone.

### Keys and secrets

Bas's steps, on his Mac, before the pull request can merge:

1. `curl -fsSL https://github.com/sparkle-project/Sparkle/releases/download/2.10.1/Sparkle-2.10.1.tar.xz | tar -xJ -C /tmp ./bin/generate_keys`
2. `/tmp/bin/generate_keys --account mindroom-chat` puts the private key in his login keychain and prints the public key. He sends the public key (it is not secret); it goes into `MINDROOM_UPDATE_PUBLIC_KEY`.
3. `/tmp/bin/generate_keys --account mindroom-chat -x /tmp/sparkle.key`, then `gh secret set SPARKLE_ED_PRIVATE_KEY --repo mindroom-ai/mindroom-chat < /tmp/sparkle.key`, then delete the file.

Fail closed:

- A signed release without the secret stops in the workflow's first step, before the build.
- `scripts/macos-appcast.sh` fails unless the feed it made has a `sparkle:edSignature`. `generate_appcast` leaves it out, with only a warning, when the app has no `SUPublicEDKey` or the private key is not its pair (`generate_appcast/Appcast.swift:199-209`). So a missing key, a wrong key and an app without the updater all end without a feed, and the job fails before anything is uploaded.
- Pull request builds are unsigned and make no feed.
- The private key reaches only the feed step, on standard input, never an Xcode build.

## Testing

- **Vitest, JS seam:** `appUpdate.test.ts` (the offer makes the version ready at once; a reload installs and does not reload the page; a reload whose install did not quit rejects; no offer leaves the browser path alone), `nativeUpdate.test.ts` with a fake plugin.
- **Vitest, contracts:** the plugin's name, method, event and main-bridge registration; the project (the updater target is embedded by `App` only, behind `platformFilter = maccatalyst`; the feed and key settings are in Release only); the Store preflight's new check.
- **Vitest, scripts** (real scripts, stubbed tools, as `macCatalystRelease.test.ts`): the fetch checks the checksum; the Info.plist script writes six keys only for a Mac build with a feed and refuses a bad key; the feed script refuses a feed without a signature; the build script fetches Sparkle, checks the helpers' team and makes no feed unsigned.
- **Swift contract** (`scripts/test-macos-support.sh`, run by `macos.yml` on pull requests): the updater bundle compiles against the pinned Sparkle, loads through its protocol, and `install()` is false with nothing staged.
- **Pull request CI:** the unsigned Release archive must contain the bundle, the framework and `SUPublicEDKey`; the Store archive must pass the preflight.
- **End to end on the MacBook M2** (Debug builds, a throwaway key, `python3 -m http.server`, a scratch folder, `MINDROOM_UPDATE_ACCEPTANCE=1` to press Reload, since ssh cannot click): v1 `2026.11.9`, installed under Homebrew's name `MindRoom Chat.app`, fetches the feed and the DMG without any window, the card appears, Reload ends in a running `2026.11.10`; a second run without the press installs on quit.
- **Not provable without Developer ID:** that Xcode's export signs the helpers inside the plug-in, that notarization accepts the app, that the hardened app loads the bundle and the framework, the Developer ID fallback, and the real feed URL's redirects. The first signed release is the final check. If it fails, the job fails before it publishes anything, that release has no DMG, and the fix is the fallback above or a revert.
- **No screenshot from the Mac app:** ssh has no Screen Recording permission. The card is the browser's component, unchanged.

## Size

Product lines, without tests and the project file: Swift about 150, TypeScript about 55, shell and the preflight about 115, workflow about 25: about 345. The project file grows by about 140 lines, tests by about 300, docs by about 40. Six tasks, one pull request.

## Open questions, with the default taken

1. **Feed location:** the `mac-appcast` prerelease (taken), or `releases/latest/download/appcast.xml` with the gap above.
2. **Check interval:** 3600 s, Sparkle's minimum (taken).
3. **A "Check for Updates…" menu item:** none (taken).
4. **No write permission:** Sparkle's own window with the administrator prompt (taken), rather than no update at all.
5. **A signed dry run before merging** (a workflow input that builds, signs and notarizes a branch and publishes nothing): none (taken); the first release is the check.
6. **Homebrew `auto_updates true`:** follow-up in the tap.
7. **The `mac-appcast` tag:** one tag that is not a version. `scripts/calver.mjs` ignores it; whether an Xcode Cloud workflow starts on it once is not checked.

## Sources

1. https://sparkle-project.org/documentation/programmatic-setup/ ("Create an Updater in Mac Catalyst")
2. https://github.com/sparkle-project/Sparkle/blob/2.10.1/Sparkle/SPUUpdaterDelegate.h (lines 421-440), `Sparkle/SPUAutomaticUpdateDriver.m` (104-129)
3. https://sparkle-project.org/documentation/customization/
4. https://sparkle-project.org/documentation/publishing/
5. https://sparkle-project.org/documentation/sandboxing/ ("Code Signing")

Source lines of Sparkle are of tag 2.10.1 (https://github.com/sparkle-project/Sparkle/tree/2.10.1).
