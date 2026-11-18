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
- **Patterns to follow.** A platform filter on a dependency and an embed (`platformFilter = ios`, `project.pbxproj:36`, `:804`). A pinned download before the build (`scripts/watch/build-sdk.sh --fetch`, `build-macos-app.sh:80`). A job of its own, one at a time across every release's run, that moves a shared pointer to the newest release that is ready (`image.yml:125-187`, the image's `latest`). Script tests that run the real script with stubbed tools (`macCatalystRelease.test.ts:13-107`).

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
- A newer release is downloaded, the DMG's EdDSA signature is checked before it is opened, and Sparkle's installer is staged. Then the card appears in the main window: same text, same Reload button, same dismiss as in the browser.
- **Reload:** the button spins and says "Updating…", the app quits, the new version is installed and opens. If the app is still running 10 seconds after the press, whatever the reason, the button returns.
- **Dismiss:** as in the browser, the card stays away for the life of the page; a page that is loaded again shows it again. Dismissing changes nothing in Sparkle: the update installs when the app quits.
- While an update is staged Sparkle runs no further checks [2]. So a long-running app installs the staged version, not the newest; the restarted app finds the newest on its next check and shows the card again. With one release every half hour this is the price of downloading at most one 28 MB DMG per run.
- If Sparkle gives the staged update up (its installer died, say), the card goes away and Reload paths reload the page again, until Sparkle stages an update anew.
- The Quick Capture window shows no card: it is a 360 by 460 panel, and the main window has it.
- A build without the feed setting, every Debug build among them, carries the bundle but never starts it: a local build (`CFBundleVersion` 33) would otherwise replace itself with the release.

### Architecture

| File | Role |
|---|---|
| `scripts/fetch-sparkle.sh` | Downloads the pinned tarball, checks its sha256, unpacks `Sparkle.framework`, `bin/` and `LICENSE` into `ios/MacUpdater/Sparkle/` (git-ignored). A no-op when that version is there. |
| `ios/MacUpdater/MindRoomMacUpdaterProtocol.swift` | The two calls the app makes: `start(onChange:)` and `install() -> Bool`. Compiled into `App` and the bundle. |
| `ios/MacUpdater/MindRoomMacUpdater.swift`, `Info.plist` | The bundle (`chat.mindroom.app.mac-updater`, principal class `MindRoomMacUpdater`): owns the `SPUUpdater`, is its delegate, keeps the immediate-install block while its update cycle lives. |
| `ios/App/App/MacUpdater.swift` | Catalyst side: loads the bundle from `Contents/PlugIns`, starts it, keeps the staged version (main thread only), logs it, posts a notification. |
| `ios/App/App/MindRoomUpdatePlugin.swift` | Capacitor plugin `MindRoomUpdate`: event `change`, methods `status()` and `install()`. |
| `src/app/native/nativeUpdate.ts` | `watchNativeUpdate()`: listens for `change`, asks `status()` once, and hands the result to `appUpdate.ts`. |
| `src/app/config/appUpdate.ts` | `setAppUpdate(update?)`; `reloadForNewVersion()` installs while an app update is set. |
| `scripts/macos-updater-info-plist.sh` | Build phase of `App`: writes the updater's Info.plist keys into the built Mac app. |
| `scripts/macos-appcast.sh` | Makes and checks one release's `appcast.xml`: one item whose DMG enclosure carries the EdDSA signature. |
| `scripts/macos-appcast-release.mjs` | Picks, from GitHub's list of releases, the newest one whose DMG and `appcast.xml` are both up. |

Data flow: `AppDelegate` calls `MacUpdater.start()` at launch, before any page exists, so a broken page cannot stop an update. Sparkle downloads and stages; its delegate call hands over the version and the install block; `MacUpdater` posts `MindRoomUpdateChanged`; the plugin raises `change` `{ version }`; `watchNativeUpdate` calls `setAppUpdate`; the card shows. Reload calls `reloadForNewVersion()`, which calls the plugin's `install()`, which runs the block: Sparkle asks the app to quit, installs and relaunches. When the update cycle ends without an install (`updater(_:didFinishUpdateCycleFor:error:)` [2]), the bundle drops the block, which is dead by then (it holds its driver weakly, `SPUAutomaticUpdateDriver.m:112-119`), and the same path carries `change` `{}`.

**A page that loads later.** Capacitor keeps an event only for the first listener (`CAPPlugin.m:44-66`), so a page that starts or reloads after the update was staged asks: it adds its `change` listener, then calls `status()` once. Both answers go through the same function, and setting the same update twice is one notice. The plugin overrides nothing of Capacitor's: plugin methods arrive on the bridge's queue (`CapacitorBridge.swift:524-553`), so `status()` and `install()` hop to the main queue before they touch `MacUpdater`, and events are raised from the main queue as the app's other plugins raise theirs (`MindRoomWatchPlugin.swift:32-34`).

### Where Sparkle links

A new target `MindRoomMacUpdater` (`com.apple.product-type.bundle`, `SDKROOT = macosx`, deployment target 13.3, like `MindRoomMacSupport`). It links `Sparkle.framework`, embeds it in its own `Contents/Frameworks` (Code Sign On Copy) and has `LD_RUNPATH_SEARCH_PATHS = @loader_path/../Frameworks`. Target `App` depends on it and embeds it in `Contents/PlugIns`, both with `platformFilter = maccatalyst`, so iOS builds skip it. `AppStoreMac` gets neither. Sparkle's host bundle is `Bundle.main`, which inside the plug-in is the app. Sparkle's tools expect this layout: `generate_appcast` looks for the framework "inside another framework or plug-in" (`generate_appcast/ArchiveItem.swift:285`).

The bundle uses `SPUUpdater` with `SPUStandardUserDriver`, as `SPUStandardUpdaterController` itself does (`SPUStandardUpdaterController.m:47-56`), but not the controller: it shows a modal alert when the updater cannot start (`:78-101`), and here a failed start is only logged.

### Info.plist keys

Only the built Mac `App` gets them. They cannot live in `App/Info.plist`, which the Store app and iOS share. A Run Script phase of `App` runs `scripts/macos-updater-info-plist.sh` after the Info.plist is processed and before signing. It does nothing unless `IS_MACCATALYST = YES` and the build setting `MINDROOM_UPDATE_FEED_URL` is set; then `MINDROOM_UPDATE_PUBLIC_KEY` must be a 44-character base64 key, or the build fails. Both settings exist only in `App`'s Release configuration. The defaults are set here only, never again at run time.

| Key | Value | Why |
|---|---|---|
| `SUFeedURL` | `https://github.com/mindroom-ai/mindroom-chat/releases/download/mac-appcast/appcast.xml` | The feed (below) |
| `SUPublicEDKey` | Bas's public key | Sparkle reads it only from the host's Info.plist |
| `SUEnableAutomaticChecks` | true | No "check automatically?" question on the second launch [3] |
| `SUAutomaticallyUpdate` | true | Download and stage without asking [3] |
| `SUScheduledCheckInterval` | 3600 | Sparkle's minimum; releases come many times a day |
| `SUVerifyUpdateBeforeExtraction` | true | The DMG is not mounted before its signature is checked [3] |

### Feed

- **Each release's own `appcast.xml`,** made by Sparkle's `generate_appcast` and attached to the release beside its DMG. The tool mounts the DMG and reads the item from the app itself: `<sparkle:version>` from `CFBundleVersion` (`YYYY.M.N`), the short version, `LSMinimumSystemVersion`, the length. It signs the DMG's bytes with the private key, so it runs after the DMG is stapled. The enclosure is `https://github.com/mindroom-ai/mindroom-chat/releases/download/<tag>/MindRoom.dmg`. No release notes.
- **What is signed is the DMG enclosure, not the XML.** `SURequireSignedFeed` stays off, so the feed's own text is trusted as far as HTTPS and GitHub are. A feed that lies can at worst name a DMG, which is then checked against the installed app's key, and Sparkle only offers a version above the running one.
- **The feed the app reads is a copy of the newest ready release's `appcast.xml`,** on one prerelease, `mac-appcast`. A job of its own, `feed`, publishes it, one at a time across every run (concurrency group `mac-appcast`, the pattern of the image's `latest`, `image.yml:125-187`). Once it holds the group it reads GitHub's list of releases and takes the greatest `vYYYY.M.N` (not a draft, not a prerelease) whose `MindRoom.dmg` and `appcast.xml` are both uploaded; it downloads that `appcast.xml`, replaces the one on `mac-appcast`, and fetches the public URL until it serves the same bytes. It never looks at its own run's tag, so:
  - an older release's run that finishes last publishes the newer release's feed again, not its own;
  - a newer release without a DMG (still building, or failed) does not hold the feed back: the newest release that has both files is published;
  - a failed publication is repaired by **Re-run failed jobs** on that run, or by the next release's run, from files that are already up. It needs no rebuild.
- **The DMG is the mark that a release is ready.** The `dmg` job uploads `appcast.xml` first (replacing one a failed earlier run left) and `MindRoom.dmg` last; a DMG is never replaced, so a release that has a DMG has the `appcast.xml` that signs it.
- **Independent of Homebrew.** `feed` runs whenever the run was not cancelled, whether or not the `dmg` job's request to the tap succeeded.
- **Replacing is not atomic, and that is accepted.** `gh release upload --clobber` deletes the asset and then uploads it [6]; GitHub has no replace. For a 1 KB file that is a moment in which the URL is a 404: a silent failed check for an app that asks just then, and its next check is an hour later. The step tries the upload three times and fails loudly if the URL does not serve the new feed. The repository lets a published release's assets change: every release gets its DMG minutes after it is published.
- **The feed never goes backwards** as long as releases are not deleted: the greatest ready release only grows, and one job at a time reads it. So the job does not parse the live feed to compare.
- **Versions order correctly.** Sparkle's comparator compares the numbers between the dots as numbers (`SUStandardVersionComparator.m:196-218`): `2026.11.9 < 2026.11.10 < 2026.12.0`. The e2e updates from `2026.11.9` to `2026.11.10`.
- **DMG, not zip.** Sparkle takes a DMG [4], and the release's one artifact keeps one checksum for Homebrew. The window layout of #580 is irrelevant to Sparkle: it copies the volume, ignores the Applications link (`Autoupdate/SUInstaller.m:49-73`) and finds the app by file name (the installed app's, or its display name, here `MindRoom.app`) or by bundle identifier (`:81-110`). The installed app keeps its own name, also Homebrew's `MindRoom Chat.app`.
- **One item.** A release that raises the minimum macOS version leaves Macs below it without updates, also without the last release they could run; if that matters then, the feed must keep that release's item too.
- **Rejected: `releases/latest/download/appcast.xml`.** Less workflow, but that URL is a 404 from the moment a release is published until its DMG is up: 24% of today, 58% of the afternoon. A failed check is silent (below) and the next one is an hour later, so the app would lag by hours exactly when releases are frequent.
- **Rejected: the tap repository or chat.mindroom.chat.** Another repository's workflow, or a manual web publish.

### JS seam

`appUpdate.ts` gains one export and one branch:

- `setAppUpdate(update?: { version: string; install: () => Promise<void> })`. With an update it sets `newVersion` and `readyVersion` to its version and keeps it; without one it forgets it and that version. It notifies only when something changed. The card appears and leaves through the existing `getReadyVersion()`; nothing in `NewVersionNotice.tsx` changes.
- `reloadForNewVersion()`, while an update is set, makes one install attempt, which every caller shares until it ends. The attempt is bounded as a whole: 10 s (`timeoutMs`) from the press, whether the bridge never answers or the app does not quit, then it rejects and the update stays set, so a second press tries again (Sparkle's block may be called again after a cancelled quit [2]). An `install()` that rejects (the native side has no update any more, `NOT_READY`) forgets the update and rejects at once: the card leaves, and the next call reloads the page. Without an update set the function is unchanged.

What its callers do with it:

- The card and `AppErrorBoundary` give their button back on a rejection, as today.
- `PartUnavailable` (a part of the app failed to load) shows its "a reload is needed" state on a rejection. Its Retry reloads without asking when the page would lose nothing; with an update set that restarts the whole app. It asks only its own page, the main window; text typed into the Quick Capture window is not asked about. In the app every part comes from the bundle, so this path needs a broken bundle.
- The plugin API `reloadForNewVersion` (`client-sdk/core.ts:46-50`) passes the rejection on. In a browser it does not reject today; in the Mac app it now can, which `docs/client-plugins.md` will say.

`src/app/native/nativeUpdate.ts` is the only file that knows the plugin; `config` stays below `native` in the layers. `src/index.tsx` calls `watchNativeUpdate()` beside `watchForNewVersion()`. The plugin is registered on the main window's bridge only, so the Quick Capture page finds no plugin, sets nothing and keeps the ordinary reload.

### Signing

- **Two checks, of two things.** With `SUVerifyUpdateBeforeExtraction`:
  1. Before the DMG is opened, its enclosure signature must verify against the *installed* app's `SUPublicEDKey`. Only if that fails, Sparkle accepts a DMG that is itself signed with Developer ID by the installed app's team (`SUUpdateValidator.m:60-98`); `build-macos-app.sh:131` signs the DMG so.
  2. After unpacking: the new app must still have a key and a code signature (`:274-290`), its Apple signature must be valid (`:193-208`), and after the Developer ID fallback the enclosure signature must verify against the *new* app's key (`:210-232`).
- **So a lost key is replaced by** a release whose app carries the new public key and whose enclosure is signed with the new private key; the Developer ID signature of the DMG carries the trust across. Developer ID alone never rescues an enclosure without a valid signature.
- **Sparkle's helpers.** The framework carries `Autoupdate`, `Updater.app` and two XPC services (unused without a sandbox), ad-hoc signed with the hardened runtime. Embedding re-signs only the framework. "Xcode does re-sign these services and helpers, preserves the Hardened Runtime ... when you Archive and Export an application for notarization" [5], which is what `build-macos-app.sh` does. That sentence is about a framework in an app; here it sits one level deeper, in the plug-in, and nothing I read proves Xcode's export walks that far.
- **The build script checks the exported app before it notarizes:** `codesign --verify --deep --strict` on the app, and for the plug-in's executable, the framework's and each of the four helpers, that `codesign -dv` names team `DNA6966LGZ` and the `runtime` flag. `generate_appcast` validates the nested signatures again, and notarization is the last gate.
- **A signed smoke run before the merge** proves this without publishing: the **Mac app** workflow, run by hand on the branch with `smoke`, builds, signs, notarizes and staples that branch as the newest release's version, makes and checks its `appcast.xml` (which proves that the secret is the pair of the public key in the project), opens the notarized app on the runner and waits for Sparkle's first check (`SULastCheckTime` in the app's defaults, which only a loaded and started updater writes), and keeps the DMG as a run artifact. It uploads nothing to any release.
- **If the export leaves a helper unsigned:** sign inside out in the build script after the export, as Sparkle documents [5], never with `--deep`: the two XPC services (the Downloader keeping its entitlements), `Autoupdate`, `Updater.app`, the framework, the plug-in, then the app with its entitlements; then notarize.

### The Store app and iOS stay free of it

- `AppStoreMac` has no dependency on the updater target, no embed phase and no Info.plist phase. `MacUpdater.swift` and `MindRoomUpdatePlugin.swift` are in `App`'s Sources only, and their contents and every use of them compile only with `targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE`.
- `scripts/macos-store-preflight.mjs` fails on a Store artifact that has a path containing `Sparkle` or `MindRoomMacUpdater`, an Info.plist key shaped like Sparkle's (`SU` and a capitalized word), or the strings `SPUUpdater` or `MindRoomMacUpdater` in a binary. `macos.yml` already archives the Store app and runs the preflight on every Mac pull request.
- The real artifacts are compared once, on the M2: the Mac `App` Release archive has the plug-in, the framework and the six keys with their values; the Store archive and an iOS build have no such path and no `SU` key; the preflight rejects a Store app into which the plug-in was copied.

### Errors

| Case | What happens |
|---|---|
| Offline, feed missing, GitHub down, a bad feed | The check fails, Sparkle logs it, nothing shows (the automatic driver has no error UI; the scheduled one shows errors only after it showed an update, `SPUScheduledUpdateDriver.m:104-106`). Next check in an hour. |
| DMG whose enclosure signature is wrong or missing | Refused before it is mounted, logged, nothing shows. |
| The user cannot write the app's folder (a standard account, an app an administrator installed) | Sparkle cannot install silently (`InstallerLauncher/SUInstallerLauncher.m:469-471`) and falls back to its own window, which offers the update and has macOS ask for an administrator. No card. Accepted: an app dragged to `/Applications` or installed by Homebrew is owned by the user. |
| App opened from the DMG, or translocated by Gatekeeper | Sparkle refuses to update a read-only location (`SPUBasicUpdateDriver.m:70-82`). In the background that is silent: the app works and never updates until it is moved to Applications. |
| Reload pressed; the bridge does not answer, or the app does not quit | 10 s after the press the button returns and can be pressed again. The update still installs on quit. |
| Reload pressed; Sparkle gave the update up meanwhile | The press is refused at once, the card leaves, Reload paths reload the page. Sparkle checks again within the hour. |
| The install fails after the app quit | Sparkle's installer puts the new app in place only after it validated it; the old app stays. Not exercised by the e2e. |
| The bundle or Sparkle fails to load or start | One log line; the app runs without updates. |
| The feed's publication fails | The job fails; the feed is the previous one or, for a failure between delete and upload, missing. Re-run the failed job, or the next release repairs it. |

### Bootstrap, Homebrew

- Apps installed before this ships have no updater. Each needs a DMG that carries it installed by hand, once (or `brew upgrade --cask mindroom-chat`). The smoke run's DMG is such a DMG.
- Follow-up in `mindroom-ai/homebrew-tap` (another repository, not part of this work): `auto_updates true` in the cask, so `brew upgrade` leaves a self-updated app alone.

### Keys and secrets

Bas's steps, on his Mac, before the pull request can merge:

1. `curl -fsSL https://github.com/sparkle-project/Sparkle/releases/download/2.10.1/Sparkle-2.10.1.tar.xz | tar -xJ -C /tmp ./bin/generate_keys`
2. `/tmp/bin/generate_keys --account mindroom-chat` puts the private key in his login keychain and prints the public key. He sends the public key (it is not secret); it goes into `MINDROOM_UPDATE_PUBLIC_KEY`.
3. `/tmp/bin/generate_keys --account mindroom-chat -x /tmp/sparkle.key`, then `gh secret set SPARKLE_ED_PRIVATE_KEY --repo mindroom-ai/mindroom-chat < /tmp/sparkle.key`, then delete the file.

Fail closed:

- A signed build (a release or a smoke run) without the secret stops in the workflow's first step, before the build.
- `scripts/macos-appcast.sh` writes into a fresh folder (`generate_appcast` would otherwise extend a feed it finds, `generate_appcast/FeedXML.swift:214-237`) and passes the result on only if it has exactly one enclosure, with this release's DMG URL, this DMG's length, this version, and a non-empty EdDSA signature. `generate_appcast` leaves the signature out, with only a warning, when the app has no `SUPublicEDKey` or the private key is not its pair (`generate_appcast/Appcast.swift:199-209`). So a missing key, a wrong key and an app without the updater all end without an `appcast.xml`, and the job fails before it uploads anything to the release.
- Only the step that makes the `appcast.xml` gets the secret, and it hands it over on standard input with the variable removed from the script's environment (`env -u`). No Xcode build, and no pull request build, sees it.
- Pull request builds are unsigned, make no `appcast.xml`, and no step that writes to a release runs for them; the `feed` job does not run.

## Testing

- **Vitest, JS seam:** `appUpdate.test.ts` (setting an update makes it ready, once; clearing it clears the card; a reload installs and does not reload the page; an install that never answers rejects after the timeout and can be tried again; two reloads share one attempt; a refused install clears the update and the next reload reloads the page; without an update the browser path is untouched), `nativeUpdate.test.ts` with a fake plugin (staged before the page listens, while it listens, withdrawn; no plugin, as in the Quick Capture window).
- **Vitest, the feed's choice:** `newestUpdateRelease` on lists of releases: the older run finishing last, the newest release without a DMG or without an `appcast.xml`, a failed upload's `starter` asset, drafts, prereleases and `mac-appcast` itself.
- **Vitest, contracts:** the plugin's name, methods, event and main-bridge registration; the project (the updater target is embedded by `App` only, behind `platformFilter = maccatalyst`; the feed and key settings are in Release only); the Store preflight's new check; the workflow (the feed job's group and condition, the secret in one step).
- **Vitest, scripts** (real scripts, stubbed tools, as `macCatalystRelease.test.ts`): the fetch checks the checksum; the Info.plist script writes six keys only for a Mac build with a feed and refuses a bad key; the appcast script refuses a missing signature, another version, another URL, a second item and a missing key, and ignores a stale output file; the build script fetches Sparkle, verifies the exported app and makes no `appcast.xml` unsigned.
- **Swift contract** (`scripts/test-macos-support.sh`, run by `macos.yml` on pull requests): the updater bundle compiles against the pinned Sparkle, loads through its protocol, and `install()` is false with nothing staged.
- **Pull request CI:** the unsigned Release archive must contain the bundle, the framework and the six keys with their values; the Store archive must pass the preflight.
- **End to end on the MacBook M2, functional only** (Debug builds, ad-hoc signed, a throwaway key, a local server, a scratch folder, a test bundle identifier so that neither the defaults nor Sparkle's cache of `chat.mindroom.app` are touched, and a DMG made by the release's own `dmgbuild` recipe). A harness that exists only in the M2's worktree, never on the branch, lets ssh drive the app with signals: evaluate a script in the main page, and quit as the Quit menu item does. Runs, each a sequence of recorded checks:
  - A: v1 `2026.11.9`, installed as `MindRoom Chat.app`, fetches the feed and the DMG; a sampler of the window list sees no window but the main one from launch to staging; the page shows the card; the page is reloaded and shows it again; Reload is pressed; a new process runs `2026.11.10` from the same path.
  - B: the same up to staging, then Quit: the app at that path becomes `2026.11.10` and is not opened.
  - C: a feed whose enclosure signature is another key's: no card, no window, still `2026.11.9`.
- **The signed smoke run** (above) is the check of production signing, notarization and loading under the hardened runtime. Installed by hand, its DMG then updates itself to the first release after the merge: the signed end-to-end check.
- **Still unproven until that first release:** the feed job against the real repository, and the Developer ID fallback for a replaced key (never exercised).
- **No screenshot from the Mac app:** ssh has no Screen Recording permission. The card is the browser's component, unchanged; the e2e records its text from the page.

## Size

Product lines, without tests and the project file: Swift about 165, TypeScript about 70, shell about 135, the two `.mjs` about 45, workflow about 65: about 480 (345 before the review; the feed job, the checks of the `appcast.xml` and of the exported app, the smoke run and the status query are the growth). The project file grows by about 140 lines, tests by about 400, docs by about 50. Seven tasks, one pull request.

## Open questions, with the default taken

1. **Feed location:** the `mac-appcast` prerelease (taken), or `releases/latest/download/appcast.xml` with the gap above.
2. **Check interval:** 3600 s, Sparkle's minimum (taken).
3. **A "Check for Updates…" menu item:** none (taken).
4. **No write permission:** Sparkle's own window with the administrator prompt (taken), rather than no update at all.
5. **A scheduled repair of the feed:** none (taken); the next release's run or a re-run repairs it.
6. **Homebrew `auto_updates true`:** follow-up in the tap.
7. **The `mac-appcast` tag:** one tag that is not a version. `scripts/calver.mjs`, the image workflow, the tap and the download links ignore prereleases and tags of another form; whether an Xcode Cloud workflow starts on it once is not checked.

## Sources

1. https://sparkle-project.org/documentation/programmatic-setup/ ("Create an Updater in Mac Catalyst")
2. https://github.com/sparkle-project/Sparkle/blob/2.10.1/Sparkle/SPUUpdaterDelegate.h (lines 421-440 and 457-475), `Sparkle/SPUAutomaticUpdateDriver.m` (104-129)
3. https://sparkle-project.org/documentation/customization/
4. https://sparkle-project.org/documentation/publishing/
5. https://sparkle-project.org/documentation/sandboxing/ ("Code Signing")
6. https://cli.github.com/manual/gh_release_upload ("existing assets are deleted before new assets are uploaded")

Source lines of Sparkle are of tag 2.10.1 (https://github.com/sparkle-project/Sparkle/tree/2.10.1); those of Capacitor of 8.5.2 (https://github.com/ionic-team/capacitor/tree/8.5.2/ios/Capacitor/Capacitor).
