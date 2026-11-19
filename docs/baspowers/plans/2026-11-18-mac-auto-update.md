# Mac app automatic updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development (seven tasks with separate review surfaces: Sparkle API use, project wiring and Store isolation, the JS seam, the release's `appcast.xml`, the feed job, a Mac run, the key; a mistake in the release pipeline stops every release's DMG).

**Goal:** The Developer ID Mac app downloads each release by itself and shows the browser's "new version" card, whose Reload installs it and opens it again.

**Architecture:** Sparkle 2 lives in a new macOS plug-in bundle that only target `App` embeds, and only on Mac Catalyst. The app starts it at launch; the page asks a Capacitor plugin whether Sparkle has staged an update; then the existing card shows, and its Reload runs Sparkle's immediate-install block. The Mac workflow attaches a one-item `appcast.xml`, whose DMG enclosure is EdDSA-signed, to each release; a job of its own, one at a time, copies its release's to the prerelease `mac-appcast`, which is the feed, unless the feed already names that release or a newer one.

**Tech Stack:** Swift (UIKit Catalyst app, AppKit plug-in bundle), Sparkle 2.10.1, Capacitor 8, TypeScript (strict), vitest, bash, GitHub Actions.

**Spec:** `docs/baspowers/specs/2026-11-18-mac-auto-update-design.md`. Read it first: it holds the reasons, the Sparkle source references and the error table.

## Global Constraints

- Repo `AGENTS.md`: commands in `nix develop`; `just typecheck` and `just strict` 0 errors; `NODE_OPTIONS=--max-old-space-size=6144 just lint`; `just format <paths>` on the TypeScript you change; tests beside their subject; no em dashes; add files by explicit path; `git -c commit.gpgsign=false commit --trailer "Assisted-by: MindRoom DevAgent:<model id> <https://github.com/mindroom-ai/mindroom>"`. Never `git stash`.
- Sparkle is pinned: version `2.10.1`, `Sparkle-2.10.1.tar.xz`, sha256 `1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27`.
- Names, verbatim: bundle `MindRoomMacUpdater.bundle`, identifier `chat.mindroom.app.mac-updater`, principal class `MindRoomMacUpdater`; plugin `MindRoomUpdate`, methods `status` (resolves `{ version?: string }`; no version: no update is staged) and `install`, rejection code `NOT_READY`, no events; the page asks every 60 000 ms while shown; concurrency group `mac-appcast`; build settings `MINDROOM_UPDATE_FEED_URL` and `MINDROOM_UPDATE_PUBLIC_KEY`; secret `SPARKLE_ED_PRIVATE_KEY`; prerelease tag `mac-appcast`; feed `https://github.com/mindroom-ai/mindroom-chat/releases/download/mac-appcast/appcast.xml`.
- Info.plist keys of the built Mac `App`, and nowhere else: `SUFeedURL` (string, the feed), `SUPublicEDKey` (string), `SUEnableAutomaticChecks` (bool YES), `SUAutomaticallyUpdate` (bool YES), `SUScheduledCheckInterval` (integer 3600), `SUVerifyUpdateBeforeExtraction` (bool YES).
- The Store app and iOS never contain the updater: new Swift in `ios/App/App` and every use of it compiles only under `#if targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE`, and is in target `App`'s Sources only.
- The workflow signs nothing but a release tag: no dispatch input, mode or branch build that reaches the signing secrets ships. The one signed build before the merge (Task 7) is a throwaway.
- No new user-facing text, no stored dismissal, no settings, no menu item. `NewVersionNotice.tsx` changes in its comment only.
- Tests assert behavior (a function's result, a script's effect on stubbed tools). Text assertions on Swift, the project file and the workflow are for what cannot run on Linux, and name the fewest strings that pin the contract.
- `project.pbxproj` is edited by hand: new 24-hex-digit ids, entries modelled on `MindRoomMacSupport`'s, no reformatting.
- The private key is Bas's. Never generate, read or store the real one; Task 5 uses a throwaway key.
- Mac work runs on the MacBook M2 only: `export SSH_AUTH_SOCK=$(ls -t ~/.ssh/agent/s.* | head -1)`, then `ssh -A pc.local 'ssh macbook-m2 ...'` (pipe scripts: `cat x.sh | ssh -A pc.local 'ssh macbook-m2 bash -s'`). First `ssh -A pc.local '~/repos/machines.sh'`; before every build `pmset -g batt` must say AC Power, else stop and report. Own worktree `~/repos/worktrees/mindroom-chat-mac-update`, DerivedData `/tmp/mac-update-dd`, run folders `/tmp/mac-update-run*`. Commits reach the M2 without GitHub, as in this workspace's earlier Mac tasks (for example a `refs/wip/mac-auto-update` ref on pc that the M2 fetches). Another agent uses `/tmp/mac-voice-dd` and `/tmp/qc-dd`: touch neither, and kill only your own PIDs. The M5 and the work MacBook are off limits.

## Review Focus

- An older release's run that reaches the feed job last, a stale or repeated run, and a public URL that lags must never move the feed backwards or delete it without need (Task 5, script tests).
- A page that loads or reloads after the update was staged must still get the card, and a staged update that Sparkle gives up must take the card away (Task 3, `nativeUpdate.test.ts`; Task 6, run A).
- Reload with a bridge that never answers, or an app that does not quit, must give the button back after 10 s and stay pressable; only a current `NOT_READY` may clear the offer, never a late or other rejection (Task 3, `appUpdate.test.ts`).
- A Debug build, an iOS build and a build without the feed setting must get no updater keys, or a local build replaces itself with the release (Task 2, script test and M2 step; Task 7, project test).
- An `appcast.xml` for another version, another URL, with a second item or without a signature must never reach a release (Task 4, script tests).

---

### Task 1: The pinned Sparkle and the updater bundle's code

**Files:**
- Create: `scripts/fetch-sparkle.sh`, `ios/MacUpdater/MindRoomMacUpdaterProtocol.swift`, `ios/MacUpdater/MindRoomMacUpdater.swift`, `ios/MacUpdater/Info.plist`, `ios/MacUpdaterTests/Contract.swift`, `licenses/Sparkle-MIT.txt`, `src/app/native/macUpdaterScripts.test.ts`
- Modify: `.gitignore`, `NOTICE`, `scripts/test-macos-support.sh`, `docs/development.md` (the **Mac** bullet: `scripts/fetch-sparkle.sh` joins the steps before `xcodebuild`)

**Interfaces:**
- Produces: `scripts/fetch-sparkle.sh` (no arguments, run from anywhere) leaves `ios/MacUpdater/Sparkle/Sparkle.framework`, `ios/MacUpdater/Sparkle/bin/generate_appcast`, `ios/MacUpdater/Sparkle/LICENSE` and `ios/MacUpdater/Sparkle/.version` (content `2.10.1`).
- Produces, in `MindRoomMacUpdaterProtocol.swift`:

```swift
@objc(MindRoomMacUpdaterProtocol)
protocol MindRoomMacUpdaterProtocol: NSObjectProtocol {
    /// Starts Sparkle's scheduled checks. `onChange` runs on the main thread with the version
    /// (`CFBundleShortVersionString`) of an update that is downloaded and waits to be installed,
    /// and with nil when Sparkle gave that update up.
    func start(onChange: @escaping (String?) -> Void)
    /// Quits the app, installs the waiting update and opens it. False when none waits.
    func install() -> Bool
}
```

- [ ] **Step 1: Write the failing script tests** in `src/app/native/macUpdaterScripts.test.ts`, with the fixture style of `macCatalystRelease.test.ts:13-107`: `fixture()` makes a temporary root with the real scripts copied in and stub tools on `PATH` that append `{ command, args }` to `TEST_LOG`, and returns `{ root, run(script, env?) }`, where `run` returns the spawn result plus `commands`. Stub `curl` writes `garbage` to its `-o` path; stub `shasum` prints `0000  file`.

```ts
it('refuses a download whose checksum differs and leaves nothing behind', () => {
  const { root, run } = fixture();
  const result = run('scripts/fetch-sparkle.sh');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('checksum');
  expect(existsSync(join(root, 'ios/MacUpdater/Sparkle'))).toBe(false);
  expect(result.commands.find(({ command }) => command === 'curl')?.args).toContain(
    'https://github.com/sparkle-project/Sparkle/releases/download/2.10.1/Sparkle-2.10.1.tar.xz'
  );
});
it('downloads nothing when the pinned version is there', () => {
  const { root, run } = fixture();
  mkdirSync(join(root, 'ios/MacUpdater/Sparkle'), { recursive: true });
  writeFileSync(join(root, 'ios/MacUpdater/Sparkle/.version'), '2.10.1\n');
  const result = run('scripts/fetch-sparkle.sh');
  expect(result.status).toBe(0);
  expect(result.commands).toEqual([]);
});
```

- [ ] **Step 2: Run them, expect failure** (`just test src/app/native/macUpdaterScripts.test.ts`: the script does not exist).
- [ ] **Step 3: Write `scripts/fetch-sparkle.sh`.** `set -euo pipefail`; exit 0 when `.version` holds the pinned version; `curl -fsSL --retry 3 -o` into a `mktemp -d` folder removed by a trap; compare `shasum -a 256 | cut -d' ' -f1` with the pin and fail with a message that contains `checksum`; only then replace `ios/MacUpdater/Sparkle` with `tar -xJf ... ./Sparkle.framework ./bin ./LICENSE` and write `.version` last. Add `ios/MacUpdater/Sparkle/` to `.gitignore` under a comment naming the script.
- [ ] **Step 4: Run the tests, expect PASS.**
- [ ] **Step 5: Write the bundle.** `ios/MacUpdater/Info.plist`: a copy of `ios/MacSupport/Info.plist` with `CFBundleName` and `NSPrincipalClass` `MindRoomMacUpdater`. `MindRoomMacUpdater.swift`: `@objc(MindRoomMacUpdater) final class MindRoomMacUpdater: NSObject, MindRoomMacUpdaterProtocol, SPUUpdaterDelegate`.
  - `start(onChange:)`: once only; keeps `onChange`; creates `SPUUpdater(hostBundle: .main, applicationBundle: .main, userDriver: SPUStandardUserDriver(hostBundle: .main, delegate: nil), delegate: self)` and calls `try updater.start()`, logging a thrown error with `NSLog` (no alert: spec "Where Sparkle links").
  - `updater(_:willInstallUpdateOnQuit:immediateInstallationBlock:) -> Bool`: keeps the block, calls `onChange(item.displayVersionString)`, returns `true`.
  - `updater(_:didFinishUpdateCycleFor:error:)`: when a block is kept, drops it and calls `onChange(nil)`. Sparkle runs no cycle while a staged update waits, so a finished cycle means that update's session is over and its block, which holds its driver weakly, does nothing any more.
  - `install() -> Bool`: runs the kept block and returns `true`, or returns `false` without one. The block stays kept while its cycle lives: Sparkle allows calling it again if the quit was cancelled.
- [ ] **Step 6: Write the Swift contract** `ios/MacUpdaterTests/Contract.swift` in the style of `ios/MacSupportTests/Contract.swift` (its `require` helper, `@main struct Contract`, the bundle path as the one argument): the bundle loads, its principal class is a `MindRoomMacUpdaterProtocol`, and `install()` is `false`. It does not call `start`. It prints `PASS: updater bundle loading and an install with nothing staged`.
- [ ] **Step 7: Extend `scripts/test-macos-support.sh`** after its existing run: call `scripts/fetch-sparkle.sh`; build `build/mac-support-tests/MindRoomMacUpdater.bundle` from the two updater sources with `-F ios/MacUpdater/Sparkle -framework Sparkle -Xlinker -rpath -Xlinker "$repo_root/ios/MacUpdater/Sparkle"` and the same target triple; copy and fill its Info.plist as the script does for the support bundle (identifier `chat.mindroom.app.mac-updater`); compile the protocol with the new contract into `build/mac-support-tests/updater-contract`; run it with the bundle path.
- [ ] **Step 8: Run it on the M2** (worktree at this commit, `npm ci` not needed): `scripts/test-macos-support.sh`. Expected: both `PASS:` lines.
- [ ] **Step 9: License.** `licenses/Sparkle-MIT.txt` is `ios/MacUpdater/Sparkle/LICENSE` of 2.10.1, unchanged. `NOTICE` gets an entry "Sparkle (Mac app updater)" in the style of its neighbours: the Developer ID Mac app embeds Sparkle 2.10.1 (https://github.com/sparkle-project/Sparkle), MIT License, with the components its license file lists; fetched by `scripts/fetch-sparkle.sh`; license text `licenses/Sparkle-MIT.txt`.
- [ ] **Step 10: Commit** the files above by path: `feat(macos): the updater bundle and its pinned Sparkle`.

### Task 2: `App` embeds and starts the updater; the Store app stays free of it

**Files:**
- Create: `scripts/macos-updater-info-plist.sh`, `ios/App/App/MacUpdater.swift`, `src/app/native/macCatalystUpdater.test.ts`
- Modify: `ios/App/App.xcodeproj/project.pbxproj`, `ios/App/App/AppDelegate.swift`, `scripts/build-macos-app.sh`, `scripts/macos-store-preflight.mjs`, `src/app/native/macStorePreflight.test.ts`, `src/app/native/macCatalystRelease.test.ts`, `src/app/native/macUpdaterScripts.test.ts`

**Interfaces:**
- Consumes: Task 1's protocol, sources and `scripts/fetch-sparkle.sh`.
- Produces, in `MacUpdater.swift` (whole file under the compile condition of Global Constraints):

```swift
enum MacUpdater {
    /// The staged update's version. Main thread only.
    private(set) static var readyVersion: String?
    /// Loads Contents/PlugIns/MindRoomMacUpdater.bundle and starts it. Does nothing in an app
    /// whose Info.plist has no SUFeedURL. Logs "MindRoom update ready: <version>" when one is
    /// staged and "MindRoom update withdrawn" when it is given up.
    static func start()
    /// Installs the staged update and restarts. False when none is staged.
    static func install() -> Bool
}
```

- Produces: `scripts/macos-updater-info-plist.sh`, which reads `IS_MACCATALYST`, `MINDROOM_UPDATE_FEED_URL`, `MINDROOM_UPDATE_PUBLIC_KEY`, `TARGET_BUILD_DIR`, `INFOPLIST_PATH` from the environment.
- Produces: `export const macStoreUpdaterProblems = ({ paths, infoKeys, strings }: { paths: string[]; infoKeys: string[]; strings: string[] }): string[]` in `scripts/macos-store-preflight.mjs` (JSDoc types, as its neighbours).

- [ ] **Step 1: Write the failing tests.**

In `macUpdaterScripts.test.ts` (stub `plutil` records its arguments; `KEY` is 43 base64 characters and `=`):

```ts
const env = { IS_MACCATALYST: 'YES', MINDROOM_UPDATE_FEED_URL: 'https://example.invalid/appcast.xml',
  MINDROOM_UPDATE_PUBLIC_KEY: KEY, TARGET_BUILD_DIR: '/b', INFOPLIST_PATH: 'A.app/Contents/Info.plist' };
it('writes the six keys into the built Mac app, also a second time', () => {
  const { run } = fixture();
  run('scripts/macos-updater-info-plist.sh', env);
  const result = run('scripts/macos-updater-info-plist.sh', env);
  expect(result.status).toBe(0);
  expect(result.commands.slice(-6).map(({ args }) => args)).toEqual([
    ['-replace', 'SUFeedURL', '-string', env.MINDROOM_UPDATE_FEED_URL, '/b/A.app/Contents/Info.plist'],
    ['-replace', 'SUPublicEDKey', '-string', KEY, '/b/A.app/Contents/Info.plist'],
    ['-replace', 'SUEnableAutomaticChecks', '-bool', 'YES', '/b/A.app/Contents/Info.plist'],
    ['-replace', 'SUAutomaticallyUpdate', '-bool', 'YES', '/b/A.app/Contents/Info.plist'],
    ['-replace', 'SUScheduledCheckInterval', '-integer', '3600', '/b/A.app/Contents/Info.plist'],
    ['-replace', 'SUVerifyUpdateBeforeExtraction', '-bool', 'YES', '/b/A.app/Contents/Info.plist'],
  ]);
});
it.each([{ IS_MACCATALYST: 'NO' }, { IS_MACCATALYST: '' }, { MINDROOM_UPDATE_FEED_URL: '' }])(
  'writes nothing for %o', (override) => {
    const result = fixture().run('scripts/macos-updater-info-plist.sh', { ...env, ...override });
    expect(result.status).toBe(0);
    expect(result.commands).toEqual([]);
  });
it('fails the build for a feed without a valid public key', () => {
  const result = fixture().run('scripts/macos-updater-info-plist.sh', { ...env, MINDROOM_UPDATE_PUBLIC_KEY: 'short' });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('MINDROOM_UPDATE_PUBLIC_KEY');
  expect(result.commands).toEqual([]);
});
```

In `macStorePreflight.test.ts`:

```ts
it('rejects any trace of the updater', () => {
  expect(macStoreUpdaterProblems({ paths: ['Contents/MacOS/MindRoom.chat'], infoKeys: ['CFBundleName', 'SUPPORTED'], strings: ['uiWindow'] })).toEqual([]);
  expect(macStoreUpdaterProblems({
    paths: ['Contents/PlugIns/MindRoomMacUpdater.bundle/Contents/Frameworks/Sparkle.framework/Sparkle'],
    infoKeys: ['SUFeedURL'], strings: ['SPUUpdater'],
  })).toHaveLength(3);
});
```

In the new `macCatalystUpdater.test.ts` (reads `project.pbxproj` and the Swift sources as text; write a helper that returns one target's `PBXNativeTarget` block by name):
  - the `MindRoomMacUpdater` target's settings: `PRODUCT_BUNDLE_IDENTIFIER = "chat.mindroom.app.mac-updater"`, `SDKROOT = macosx`, `MACOSX_DEPLOYMENT_TARGET = 13.3`, `@loader_path/../Frameworks` in `LD_RUNPATH_SEARCH_PATHS`;
  - `App`'s block lists the phases `Embed Mac Updater` and `Add the updater's Info.plist keys` and a dependency whose `PBXTargetDependency` has `platformFilter = maccatalyst`; the build file `MindRoomMacUpdater.bundle in Embed Mac Updater` has `platformFilter = maccatalyst`;
  - `AppStoreMac`'s block names neither phase, and no build file of its Sources phase is `MacUpdater.swift` or `MindRoomMacUpdaterProtocol.swift`;
  - `MacUpdater.swift` starts with `#if targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE`; `AppDelegate.swift` contains `MacUpdater.start()` between `#if !MINDROOM_MAC_APP_STORE` and its `#endif`.

In `macCatalystRelease.test.ts`: the fixture gets a recording stub `scripts/fetch-sparkle.sh` (as it has for `scripts/watch/build-sdk.sh`), and the test at `:110` also expects `fetch-sparkle.sh` to run before `npx cap sync ios`.

- [ ] **Step 2: Run them, expect failure.**
- [ ] **Step 3: Write `scripts/macos-updater-info-plist.sh`.** Exit 0 unless `IS_MACCATALYST` is `YES` and the feed URL is non-empty. The key must match `^[A-Za-z0-9+/]{43}=$`, else print an `error:` line naming `MINDROOM_UPDATE_PUBLIC_KEY` and exit 1. Then the six `plutil -replace` calls of the test, on `"$TARGET_BUILD_DIR/$INFOPLIST_PATH"`.
- [ ] **Step 4: Edit `project.pbxproj`.**
  - Group `MacUpdater` (`path = ../MacUpdater`) with the two Swift files, `Info.plist` and a file reference `Sparkle/Sparkle.framework` (`lastKnownFileType = wrapper.framework`).
  - Target `MindRoomMacUpdater`: a copy of `MindRoomMacSupport`'s target and both configurations with `INFOPLIST_FILE = ../MacUpdater/Info.plist`, the identifier and product name above, `FRAMEWORK_SEARCH_PATHS = ("$(inherited)", "$(SRCROOT)/../MacUpdater/Sparkle")`, `LD_RUNPATH_SEARCH_PATHS = ("$(inherited)", "@loader_path/../Frameworks")`. Phases: Sources (both files), Frameworks (`Sparkle.framework`), Resources (empty), Copy Files `Embed Frameworks` (`dstSubfolderSpec = 10`, `ATTRIBUTES = (CodeSignOnCopy, RemoveHeadersOnCopy, )`).
  - Target `App`: a `PBXTargetDependency` on it with `platformFilter = maccatalyst`; a Copy Files phase `Embed Mac Updater` (`dstSubfolderSpec = 13`) whose build file has `platformFilter = maccatalyst` and `ATTRIBUTES = (CodeSignOnCopy, RemoveHeadersOnCopy, )`; a Run Script phase `Add the updater's Info.plist keys` after it, `shellScript = "\"${SRCROOT}/../../scripts/macos-updater-info-plist.sh\"\n"`, `inputPaths = ("$(TARGET_BUILD_DIR)/$(INFOPLIST_PATH)", )`, `alwaysOutOfDate = 1`; `MindRoomMacUpdaterProtocol.swift` and `MacUpdater.swift` in its Sources.
  - `AppStoreMac`: nothing.
- [ ] **Step 5: Write `MacUpdater.swift`** to the interface above, loading the bundle as `MacWindowingStore.swift:58-67` loads the support bundle (`builtInPlugInsURL`, `principalClass`, cast to the protocol); a bundle that fails to load is one `NSLog`. `AppDelegate.application(_:didFinishLaunchingWithOptions:)` calls `MacUpdater.start()` inside its Catalyst block, under `#if !MINDROOM_MAC_APP_STORE`.
- [ ] **Step 6: `scripts/build-macos-app.sh`:** `scripts/fetch-sparkle.sh` right after the watch SDK fetch (`:80`), with a comment that the updater bundle links it.
- [ ] **Step 7: The Store preflight.** `macStoreUpdaterProblems` returns one problem for each of: a path that contains `Sparkle` or `MindRoomMacUpdater`; an Info.plist key that matches `/^SU[A-Z][a-z]/` (Sparkle's keys, not `SUPPORTED`); a string that contains `SPUUpdater` or `MindRoomMacUpdater`. `inspectMacStoreArtifact` passes it every path under the app (relative, recursive), the keys of the app's Info.plist and the `strings` output it already reads for both binaries, and adds the result to `problems`.
- [ ] **Step 8: Run the vitest files of Step 1, expect PASS;** then `just typecheck`, `just strict`, `just lint`.
- [ ] **Step 9: Build on the M2** (after `npm ci`, `npm run build:ios`, `scripts/watch/build-sdk.sh --fetch`, `scripts/fetch-sparkle.sh`, `npx cap sync ios`):

```bash
build() { xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination 'platform=macOS,variant=Mac Catalyst' -derivedDataPath /tmp/mac-update-dd CODE_SIGNING_ALLOWED=NO build; }
app=/tmp/mac-update-dd/Build/Products/Debug-maccatalyst/MindRoom.chat.app
build && test -d "$app/Contents/PlugIns/MindRoomMacUpdater.bundle/Contents/Frameworks/Sparkle.framework" \
  && ! plutil -extract SUFeedURL raw -o - "$app/Contents/Info.plist"
mkdir -p /tmp/mac-update-run
printf 'MINDROOM_UPDATE_FEED_URL = http:/$()/127.0.0.1:8765/appcast.xml\nMINDROOM_UPDATE_PUBLIC_KEY = %s\n' \
  AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA= > /tmp/mac-update-run/probe.xcconfig
XCODE_XCCONFIG_FILE=/tmp/mac-update-run/probe.xcconfig build && plutil -p "$app/Contents/Info.plist" | grep -c '"SU'
```

Expected: both builds succeed, the first app has no `SUFeedURL` (the bundle is there but never started), the last line prints `6`, and `plutil -p` shows the six values of Global Constraints.
- [ ] **Step 10: Commit:** `feat(macos): the app embeds and starts the updater outside the Store`.
- [ ] **Step 11: The real artifacts without it, on the M2, at that commit** (the Store script needs a clean, committed checkout). Record each output for the pull request.
  - Store: `MARKETING_VERSION=2026.11.9 CURRENT_PROJECT_VERSION=1 scripts/build-macos-store.sh --unsigned` ends with `structure checks passed`. With `store=build/mac-app-store/MindRoomChat.xcarchive/Products/Applications/MindRoom.chat.app`: `find "$store" -iname '*sparkle*' -o -iname '*MacUpdater*'` prints nothing, `plutil -p "$store/Contents/Info.plist" | grep -c '"SU[A-Z][a-z]'` prints `0`, `otool -L "$store/Contents/MacOS/MindRoom.chat" | grep -ci sparkle` prints `0`.
  - The preflight's wiring: with `$app` of Step 9, `ditto "$store" /tmp/mac-update-run/Tampered.app`, `ditto "$app/Contents/PlugIns/MindRoomMacUpdater.bundle" /tmp/mac-update-run/Tampered.app/Contents/PlugIns/MindRoomMacUpdater.bundle`, then `node scripts/macos-store-preflight.mjs /tmp/mac-update-run/Tampered.app 2026.11.9 1 "$(git rev-parse HEAD)" --structure-only` exits 1 and names the updater.
  - iOS: `xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Release -destination 'generic/platform=iOS' -derivedDataPath /tmp/mac-update-dd CODE_SIGNING_ALLOWED=NO build`; in `/tmp/mac-update-dd/Build/Products/Release-iphoneos/MindRoom.chat.app` the same `find` prints nothing and `plutil -p Info.plist | grep -c '"SU[A-Z][a-z]'` prints `0`.

### Task 3: The plugin and the card

**Files:**
- Create: `ios/App/App/MindRoomUpdatePlugin.swift`, `src/app/native/nativeUpdate.ts`, `src/app/native/nativeUpdate.test.ts`, `src/app/native/nativeUpdateIOSContract.test.ts`
- Modify: `ios/App/App/MindRoomBridgeViewController.swift`, `ios/App/App.xcodeproj/project.pbxproj` (the plugin in `App`'s Sources), `src/app/config/appUpdate.ts`, `src/app/config/appUpdate.test.ts`, `src/index.tsx`, `src/index.test.ts` (mock the new module as it mocks `appUpdate`), `src/app/native/macCatalystUpdater.test.ts` (the Store Sources check also names `MindRoomUpdatePlugin.swift`), `docs/client-plugins.md`, comments in `src/app/shell/NewVersionNotice.tsx`, `src/app/ui/PartUnavailable.tsx` and `src/client-sdk/core.ts`

**Interfaces:**
- Consumes: `MacUpdater.readyVersion`, `MacUpdater.install()` (Task 2).
- Produces, in `appUpdate.ts`:

```ts
export type AppUpdate = { version: string; install: () => Promise<void> };
/** The update the app itself downloaded and can install, or none (any more). */
export const setAppUpdate = (update?: AppUpdate): void
```

- Produces, in `nativeUpdate.ts`: `export const NATIVE_UPDATE_POLL_MS = 60_000`, `export const isNativeUpdateAvailable = (): boolean` and `export const watchNativeUpdate = (target: Window = window): (() => void)`.

- [ ] **Step 1: Write the failing tests.**

`appUpdate.test.ts`, a new `describe('an update the app itself downloaded')` (with the file's `loadAppUpdate`; `never` is `() => new Promise<void>(() => undefined)`, `notReady` is `() => Object.assign(new Error('No update is ready'), { code: 'NOT_READY' })`, `v10` is `'2026.11.10'`):

```ts
it('is ready at once, tells the card once, and leaves when it is withdrawn', async () => {
  const { getNewVersion, getReadyVersion, setAppUpdate, subscribeToNewVersion } = await loadAppUpdate();
  const listener = vi.fn();
  subscribeToNewVersion(listener);
  setAppUpdate({ version: v10, install: never });
  setAppUpdate({ version: v10, install: never });
  expect([getNewVersion(), getReadyVersion()]).toEqual([v10, v10]);
  expect(listener).toHaveBeenCalledOnce();
  setAppUpdate();
  setAppUpdate();
  expect([getNewVersion(), getReadyVersion()]).toEqual([undefined, undefined]);
  expect(listener).toHaveBeenCalledTimes(2);
});
it.each([['never answers', never], ['answers, and the app stays', async () => undefined]])(
  'bounds the whole attempt when the install %s, shares it, and can try again', async (_name, answer) => {
    const { getReadyVersion, setAppUpdate, reloadForNewVersion } = await loadAppUpdate();
    const install = vi.fn(answer);
    const reload = vi.fn();
    setAppUpdate({ version: v10, install });
    const started = Date.now();
    const attempts = [reloadForNewVersion({ timeoutMs: 30, reload }), reloadForNewVersion({ timeoutMs: 30, reload })];
    await expect(Promise.all(attempts)).rejects.toThrow('did not restart');
    expect(Date.now() - started).toBeLessThan(1000);
    expect(install).toHaveBeenCalledOnce();
    expect(getReadyVersion()).toBe(v10);
    await expect(reloadForNewVersion({ timeoutMs: 30, reload })).rejects.toThrow('did not restart');
    expect(install).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });
it('forgets an update the app says is not ready, and reloads the page from then on', async () => {
  const { getReadyVersion, setAppUpdate, reloadForNewVersion } = await loadAppUpdate();
  const reload = vi.fn();
  setAppUpdate({ version: v10, install: () => Promise.reject(notReady()) });
  await expect(reloadForNewVersion({ timeoutMs: 60_000, reload })).rejects.toThrow('No update is ready');
  expect(getReadyVersion()).toBeUndefined();
  await reloadForNewVersion({ timeoutMs: 10, reload });
  expect(reload).toHaveBeenCalledOnce();
});
it('keeps the update after any other rejection', async () => {
  const { getReadyVersion, setAppUpdate, reloadForNewVersion } = await loadAppUpdate();
  setAppUpdate({ version: v10, install: () => Promise.reject(new Error('bridge')) });
  await expect(reloadForNewVersion({ timeoutMs: 60_000, reload: vi.fn() })).rejects.toThrow('bridge');
  expect(getReadyVersion()).toBe(v10);
});
it('lets nothing an old attempt hears clear a newer offer', async () => {
  const { getReadyVersion, setAppUpdate, reloadForNewVersion } = await loadAppUpdate();
  const refusals: (() => void)[] = [];
  const install = () => new Promise<void>((_, reject) => { refusals.push(() => reject(notReady())); });
  // Timed out, then replaced, then refused.
  setAppUpdate({ version: v10, install });
  await expect(reloadForNewVersion({ timeoutMs: 20, reload: vi.fn() })).rejects.toThrow('did not restart');
  setAppUpdate({ version: '2026.11.11', install: never });
  refusals[0]!();
  // Replaced while it ran, then refused before its timeout.
  setAppUpdate({ version: '2026.11.12', install });
  const attempt = reloadForNewVersion({ timeoutMs: 60_000, reload: vi.fn() });
  setAppUpdate({ version: '2026.11.13', install: never });
  refusals[1]!();
  await expect(attempt).rejects.toThrow('No update is ready');
  expect(getReadyVersion()).toBe('2026.11.13');
});
```

`nativeUpdate.test.ts`, with the `@capacitor/core` mock and `setAvailable` of `nativeWatch.test.ts:13-35` (plugin `{ status: vi.fn(), install: vi.fn() }`), `vi.mock('../config/appUpdate', () => ({ setAppUpdate: vi.fn() }))`, `// @vitest-environment jsdom` and fake timers. `shown(visible)` sets `document.visibilityState` and dispatches `visibilitychange`; `settle` is `() => vi.advanceTimersByTimeAsync(0)`.

```ts
it('asks nothing without the plugin: a browser, iOS, the Quick Capture window', async () => {
  setAvailable(false);
  watchNativeUpdate()();
  await vi.advanceTimersByTimeAsync(NATIVE_UPDATE_POLL_MS);
  expect(plugin.status).not.toHaveBeenCalled();
  expect(setAppUpdate).not.toHaveBeenCalled();
});
it('takes an update that was staged before the page started', async () => {
  setAvailable(true);
  plugin.status.mockResolvedValue({ version: '2026.11.10' });
  const stop = watchNativeUpdate();
  await settle();
  expect(setAppUpdate).toHaveBeenLastCalledWith({ version: '2026.11.10', install: expect.any(Function) });
  await vi.mocked(setAppUpdate).mock.lastCall![0]!.install();
  expect(plugin.install).toHaveBeenCalledOnce();
  stop();
});
it('follows staging and withdrawal while shown, rests while hidden, and stops', async () => {
  setAvailable(true);
  plugin.status.mockResolvedValue({});
  const stop = watchNativeUpdate();
  await settle();
  expect(setAppUpdate).toHaveBeenLastCalledWith(undefined);
  plugin.status.mockResolvedValue({ version: '2026.11.10' });
  await vi.advanceTimersByTimeAsync(NATIVE_UPDATE_POLL_MS);
  expect(setAppUpdate).toHaveBeenLastCalledWith({ version: '2026.11.10', install: expect.any(Function) });
  // A failed question changes nothing.
  plugin.status.mockRejectedValue(new Error('bridge'));
  await vi.advanceTimersByTimeAsync(NATIVE_UPDATE_POLL_MS);
  expect(setAppUpdate).toHaveBeenCalledTimes(2);
  shown(false);
  plugin.status.mockResolvedValue({ version: '' });
  await vi.advanceTimersByTimeAsync(3 * NATIVE_UPDATE_POLL_MS);
  expect(plugin.status).toHaveBeenCalledTimes(3);
  shown(true);
  await settle();
  expect(setAppUpdate).toHaveBeenLastCalledWith(undefined);
  stop();
  await vi.advanceTimersByTimeAsync(NATIVE_UPDATE_POLL_MS);
  shown(true);
  expect(plugin.status).toHaveBeenCalledTimes(4);
});
```

`nativeUpdateIOSContract.test.ts` (sources as text, as `nativeWatchIOSContract.test.ts`):

```ts
expect(pluginSource.trimStart().startsWith('#if targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE')).toBe(true);
expect(pluginSource).toContain('public let jsName = "MindRoomUpdate"');
['status', 'install'].forEach((method) => {
  expect(pluginSource).toContain(`CAPPluginMethod(name: "${method}", returnType: CAPPluginReturnPromise)`);
  expect(pluginSource).toContain(`@objc func ${method}(_ call: CAPPluginCall)`);
});
expect(pluginSource).toContain('call.reject("No update is ready", "NOT_READY")');
// No events: Capacitor's listener table is not safe to notify from another queue.
expect(pluginSource).not.toMatch(/notifyListeners|addListener/);
// The Quick Capture window shows no card.
expect(bridgeSource).toContain(
  'if !(self is QuickCaptureViewController) { bridge?.registerPluginInstance(MindRoomUpdatePlugin()) }'
);
```

- [ ] **Step 2: Run them, expect failure.**
- [ ] **Step 3: `appUpdate.ts`.** Two module variables: the set `AppUpdate`, and the running install attempt (a promise).
  - `setAppUpdate(update)`: an update whose version is not the set one's is kept, `newVersion` and `readyVersion` become its version, and it notifies; one with the set version is ignored (the kept object identifies the offer); none, when one is set, forgets it, clears `newVersion` and `readyVersion` if they are its version, and notifies.
  - `reloadForNewVersion`, first thing while an update is set: return the running attempt, else start one for that update and forget it when it settles.
  - An attempt creates one timer that rejects with `new Error('The app did not restart for its update')` after `timeoutMs`, awaits `Promise.race` of that rejection and `update.install()` followed by that rejection, and clears the timer when the race settles. In the race's own rejection handler, and nowhere else: when the error's `code` is `'NOT_READY'` and `update` is still the set object, `setAppUpdate()`; then rethrow.
  - Extend the header comment with one paragraph: the Mac app's page never differs from its `version.json`; its updater sets the update instead, a reload for it restarts the app, and the timeout gives the button back without taking the request back.
- [ ] **Step 4: `nativeUpdate.ts`.** `isNativeUpdateAvailable` as `nativeWatch.ts:64-67` for `MindRoomUpdate`. `watchNativeUpdate` returns a no-op when unavailable. Else a `check` that does nothing while `target.document.visibilityState` is `'hidden'`, and otherwise takes `plugin.status()` and calls `setAppUpdate({ version, install: () => plugin.install() })` for a non-empty string `version`, `setAppUpdate(undefined)` otherwise, and nothing when the call rejects. It runs once at the start, on the document's `visibilitychange`, and on `target.setInterval(check, NATIVE_UPDATE_POLL_MS)`; the returned function removes the listener and the interval. Comment: asked, not told (the spec's "Asking, not events").
- [ ] **Step 5: `src/index.tsx`:** after the `new version watch` step, `runSafely('app update watch', () => { watchNativeUpdate(); })` with a comment naming `native/nativeUpdate.ts`.
- [ ] **Step 6: `MindRoomUpdatePlugin.swift`,** whole file under the compile condition, `import Capacitor` inside it: `@objc(MindRoomUpdatePlugin) public class MindRoomUpdatePlugin: CAPPlugin, CAPBridgedPlugin` with `identifier = "MindRoomUpdatePlugin"`, the `jsName` and methods of the contract test, and nothing else. Both methods hop to `DispatchQueue.main` (plugin calls arrive on the bridge's queue; `MacUpdater` is main thread only): `status` resolves `["version": version]` for `MacUpdater.readyVersion`, else `[:]`; `install` resolves when `MacUpdater.install()` is true, else the rejection of the contract test.
- [ ] **Step 7: Register it** in `capacitorDidLoad`, after the Quick Capture plugin and before the Store-only `return`, under the compile condition, with the line of the contract test. Add the file to `App`'s Sources in `project.pbxproj`.
- [ ] **Step 8: Words.** `NewVersionNotice.tsx`'s doc comment gains: in the Mac app the card appears once the app has downloaded an update, and Reload installs it and restarts the app. `PartUnavailable.tsx`, at its `reload`: in the Mac app with a downloaded update this restarts the app, also from Retry's own reload when this page would lose nothing; the Quick Capture window is not asked. `client-sdk/core.ts`'s `reloadForNewVersion` comment and its line in `docs/client-plugins.md` gain: in the Mac app with a downloaded update it restarts the app into it, and rejects when the app did not restart.
- [ ] **Step 9: Run** the three test files and `src/index.test.ts`, `src/app/shell/NewVersionNotice.test.tsx`, `src/app/ui/PartUnavailable.test.tsx`, `src/app/shell/AppErrorBoundary.test.tsx`, `src/client-sdk/core.test.ts`: PASS. `just typecheck`, `just strict`, `just lint`: clean.
- [ ] **Step 10: Commit:** `feat(macos): a downloaded update shows the new version card`.

### Task 4: Each release's `appcast.xml`, and the checks of the signed app

**Files:**
- Create: `scripts/macos-appcast.sh`
- Modify: `scripts/build-macos-app.sh`, `.github/workflows/macos.yml`, `src/app/native/macUpdaterScripts.test.ts`, `src/app/native/macCatalystRelease.test.ts`, `src/app/native/macCatalystUpdater.test.ts`

**Interfaces:**
- Produces: `scripts/macos-appcast.sh <dmg> <download-url-prefix> <version> <appcast-path>`, the private key on standard input. Exit 0 only with an `appcast.xml` at `<appcast-path>` that has exactly one enclosure, whose `url` is `<download-url-prefix>MindRoom.dmg`, whose `length` is the DMG's size, with a non-empty `sparkle:edSignature`, in an item with `<sparkle:version><version></sparkle:version>`.
- Produces: every release with a `MindRoom.dmg` also has the `appcast.xml` that signs it (Task 5 relies on it).

- [ ] **Step 1: Write the failing tests.**

`macUpdaterScripts.test.ts`. The fixture has a recording stub `scripts/fetch-sparkle.sh` and a stub `ios/MacUpdater/Sparkle/bin/generate_appcast` that records its arguments and standard input and writes `process.env.TEST_FEED` to the path after `-o`. `run` grows two optional parameters: the script's arguments and its standard input. `python3` is not stubbed in this fixture: the script's check runs for real. The DMG file holds `dmg` (3 bytes).

```ts
const args = ['MindRoom.dmg', 'https://example.invalid/v2026.11.10/', '2026.11.10', 'appcast.xml'];
const item = ({ version = '2026.11.10', url = 'https://example.invalid/v2026.11.10/MindRoom.dmg', length = 3, signature = 's1g=' } = {}) =>
  `<item><title>${version}</title><sparkle:version>${version}</sparkle:version><enclosure url="${url}" length="${length}" type="application/octet-stream" sparkle:edSignature="${signature}"/></item>`;
// What generate_appcast writes: RSS with Sparkle's namespace.
const feed = (...items: string[]) =>
  `<?xml version="1.0" standalone="yes"?>\n<rss xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle" version="2.0"><channel><title>MindRoom</title>${items.join('')}</channel></rss>\n`;
it('makes the feed in a fresh folder, with the key from standard input only', () => {
  const { root, run } = fixture();
  writeFileSync(join(root, 'appcast.xml'), 'stale');
  const result = run('scripts/macos-appcast.sh', { TEST_FEED: feed(item()) }, args, 'KEY');
  expect(result.status, result.stderr).toBe(0);
  const tool = result.commands.find(({ command }) => command === 'generate_appcast')!;
  expect(tool.args.slice(0, 4)).toEqual(['--ed-key-file', '-', '--download-url-prefix', args[1]]);
  expect(tool.args[tool.args.indexOf('-o') + 1]).not.toBe(join(root, 'appcast.xml'));
  expect(tool.stdin).toBe('KEY');
  expect(result.stdout + result.stderr).not.toContain('KEY');
  expect(readFileSync(join(root, 'appcast.xml'), 'utf8')).toBe(feed(item()));
});
it.each([
  ['no signature (no SUPublicEDKey, or another key)', feed(item({ signature: '' }))],
  ['another version', feed(item({ version: '2026.11.9' }))],
  ['another URL', feed(item({ url: 'https://example.invalid/v2026.11.9/MindRoom.dmg' }))],
  ['another length', feed(item({ length: 4 }))],
  ['a second item', feed(item(), item({ version: '2026.11.9' }))],
  ['no item', feed()],
  ['no XML', 'Warning: could not sign'],
])('refuses %s and leaves no appcast', (_name, text) => {
  const { root, run } = fixture();
  const result = run('scripts/macos-appcast.sh', { TEST_FEED: text }, args, 'KEY');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('appcast');
  expect(existsSync(join(root, 'appcast.xml'))).toBe(false);
});
it('refuses to run without a key', () => {
  const result = fixture().run('scripts/macos-appcast.sh', {}, args, '');
  expect(result.status).not.toBe(0);
  expect(result.commands.some(({ command }) => command === 'generate_appcast')).toBe(false);
});
```

`macCatalystRelease.test.ts`: the `codesign` stub answers `-dv` on stderr with `TeamIdentifier=${process.env.TEST_TEAM ?? 'DNA6966LGZ'}` and `CodeDirectory v=20500 flags=${process.env.TEST_FLAGS ?? '0x10000(runtime)'}`. The signed lifecycle test (`:174`) expects, before the first `notarytool`: one `codesign --verify --deep --strict` on the exported app, then six `codesign -dv` calls, on `Contents/PlugIns/MindRoomMacUpdater.bundle/Contents/MacOS/MindRoomMacUpdater` and, under that bundle's `Contents/Frameworks/Sparkle.framework/Versions/B`, on `Sparkle`, `Autoupdate`, `Updater.app`, `XPCServices/Installer.xpc` and `XPCServices/Downloader.xpc`. New tests: `TEST_TEAM: 'OTHER'`, `TEST_FLAGS: '0x0(none)'` and `TEST_FAIL: 'codesign:--verify'` each fail the run with no `notarytool` call. An unsigned run never runs `scripts/macos-appcast.sh` (stub it, recording).

`macCatalystUpdater.test.ts`, on the text of `macos.yml`:

```ts
// The private key is named in the check that it exists and in one step's environment.
expect(workflow.match(/secrets\.SPARKLE_ED_PRIVATE_KEY/g)).toHaveLength(2);
expect(workflow).toContain("HAS_SPARKLE_KEY: ${{ secrets.SPARKLE_ED_PRIVATE_KEY != '' }}");
expect(workflow).toContain('| env -u SPARKLE_ED_PRIVATE_KEY scripts/macos-appcast.sh ');
// The DMG goes up last: a release that has it has the appcast.xml that signs it.
const upload = workflow.slice(workflow.indexOf('- name: Attach the appcast and the DMG to the release\n'));
expect(upload.indexOf('build/macos/appcast.xml --clobber')).toBeGreaterThan(-1);
expect(upload.indexOf('build/macos/appcast.xml --clobber')).toBeLessThan(upload.indexOf('build/macos/MindRoom.dmg'));
```

- [ ] **Step 2: Run them, expect failure.**
- [ ] **Step 3: Write `scripts/macos-appcast.sh`.** It runs from the repository root, as the other scripts do. Read the key from standard input and fail without one before anything else. Run `scripts/fetch-sparkle.sh`. In a `mktemp -d` folder (removed by a trap) make `in/` with a copy of the DMG alone, and run `generate_appcast --ed-key-file - --download-url-prefix "$2" -o "$folder/appcast.xml" "$folder/in"` with the key piped in (`printf '%s'`, never an argument or the environment). Check the result with a few lines of `python3` and `xml.etree.ElementTree` (Python already builds the DMG): the channel has exactly one `item`; its `{http://www.andymatuschak.org/xml-namespaces/sparkle}version` text is `$3`; it has exactly one `enclosure`, whose `url` is `$2MindRoom.dmg`, whose `length` is the DMG's size, and whose `{...sparkle}edSignature` is not empty. On any miss or parse error, print `The appcast is not this release's signed enclosure (<what missed>): the app has no SUPublicEDKey, the private key is not its pair, or the DMG is another build's.` and exit 1. The minimum macOS version is not checked (the spec's "Keys and secrets"), and no second signature check is added: the pinned tool signs only with the pair of the app's key. Only then remove `$4` if it exists and move the checked file there.
- [ ] **Step 4: `scripts/build-macos-app.sh`, signed path,** after `test -d "$app"` and before the first `notarize`: `codesign --verify --deep --strict "$app"`; then for each of the six paths of the test, read `codesign -dv --verbose=4 "$app/$path" 2>&1` into a variable and fail with `<path> is not signed by team DNA6966LGZ with the hardened runtime` unless one line is exactly `TeamIdentifier=DNA6966LGZ` and the `flags=` value contains `runtime`. Comment: Xcode's export should re-sign Sparkle's helpers (the spec's source 5); this proves it did, in the plug-in too, before Apple is asked.
- [ ] **Step 5: `.github/workflows/macos.yml`, job `dmg`.**
  - A first step `Check the update key` (`if: env.RELEASE_TAG`), with the `HAS_SPARKLE_KEY` env of the test: fails with `::error::The secret SPARKLE_ED_PRIVATE_KEY is missing: a release must not ship without its update feed` unless it is `true`.
  - New step `Make the appcast` (`if: env.RELEASE_TAG`) after the build, with `SPARKLE_ED_PRIVATE_KEY: ${{ secrets.SPARKLE_ED_PRIVATE_KEY }}` and `VERSION: ${{ steps.release.outputs.version }}` in its env only: `printf '%s' "$SPARKLE_ED_PRIVATE_KEY" | env -u SPARKLE_ED_PRIVATE_KEY scripts/macos-appcast.sh build/macos/MindRoom.dmg "https://github.com/$GITHUB_REPOSITORY/releases/download/v$VERSION/" "$VERSION" build/macos/appcast.xml`.
  - `Attach the DMG to the release` becomes `Attach the appcast and the DMG to the release`: `gh release upload "$RELEASE_TAG" build/macos/appcast.xml --clobber --repo "$GITHUB_REPOSITORY"`, then the existing DMG line. Comment: the DMG, never replaced, goes last, so a release that has it has the `appcast.xml` that signs it; `--clobber` replaces one a failed earlier run left.
  - `pull_request.paths` gains `scripts/fetch-sparkle.sh`, `scripts/macos-appcast.sh`, `scripts/macos-publish-appcast.sh` and `scripts/macos-updater-info-plist.sh`.
- [ ] **Step 6: Run** the three vitest files: PASS. `just lint`, `just strict`: clean.
- [ ] **Step 7: Commit:** `feat(macos): every release carries its signed appcast`.


### Task 5: The feed job

**Files:**
- Create: `scripts/macos-publish-appcast.sh`, `src/app/native/macPublishAppcast.test.ts`
- Modify: `.github/workflows/macos.yml`, `src/app/native/macCatalystUpdater.test.ts`, `docs/ios-release.md`

**Interfaces:**
- Consumes: Task 4's releases (a `MindRoom.dmg` implies its `appcast.xml`).
- Produces: `scripts/macos-publish-appcast.sh <tag>` (environment: `GH_TOKEN`, `GITHUB_REPOSITORY`). Exit 0 when the feed on `mac-appcast` names `<tag>` or a newer release, or `<tag>` is not ready; exit 1 when it could not find that out or could not publish.
- Its only calls to GitHub, which the test's stub answers:
  - `gh release view <release> --repo <repo> --json assets --jq '.assets[] | select(.state == "uploaded") | .name'`
  - `gh release download <release> --repo <repo> --pattern appcast.xml --dir <dir>`
  - `gh release create mac-appcast --repo <repo> --prerelease --title 'Mac app update feed' --notes <text>`
  - `gh release upload mac-appcast <file> --clobber --repo <repo>`
  - `curl -fsSL https://github.com/<repo>/releases/download/mac-appcast/appcast.xml`

- [ ] **Step 1: Write the failing tests** in `macPublishAppcast.test.ts`. The fixture is a temporary folder that plays GitHub, `github/<release>/<asset>`, with the real script and three stubs on `PATH`, each logging its call:
  - `gh`: `view` prints the asset names of the release's folder, or fails with `release not found` on stderr when the folder is missing, or with `HTTP 502` when `TEST_FAIL` is `view:<release>`; `download` copies; `create` makes the folder; `upload` deletes the asset and then copies the file, except that the first `TEST_UPLOAD_FAILS` uploads fail after the delete.
  - `curl`: prints the feed's asset, except that the first `TEST_URL_LAGS` calls print `old`.
  - `sleep`: returns at once.
  `appcast(version)` is Task 4's `feed(item({ version }))`; `release(tag, assets)` makes `github/<tag>/` with those assets, an `appcast.xml` being `appcast(tag.slice(1))`; `ready(tag)` is `release(tag, ['MindRoom.dmg', 'appcast.xml'])`; `live(version?)` makes `github/mac-appcast/` with that feed (none: an empty release); `feedNow()` reads the feed asset or `undefined`; `uploads(result)` counts the logged `upload` calls.

```ts
it.each([
  ['the first feed, on a prerelease it creates', undefined, 'v2026.11.10', {}, 1, '2026.11.10'],
  ['a feed lost by a failed replacement', 'none', 'v2026.11.10', {}, 1, '2026.11.10'],
  ['a newer release', '2026.11.9', 'v2026.11.10', {}, 1, '2026.11.10'],
  ['a newer month', '2026.11.99', 'v2026.12.0', {}, 1, '2026.12.0'],
  ['an older release whose run finishes last', '2026.11.10', 'v2026.11.9', {}, 0, '2026.11.10'],
  ['the same release again', '2026.11.10', 'v2026.11.10', {}, 0, '2026.11.10'],
  ['an upload that fails once', '2026.11.9', 'v2026.11.10', { TEST_UPLOAD_FAILS: '1' }, 2, '2026.11.10'],
  ['a URL that lags', '2026.11.9', 'v2026.11.10', { TEST_URL_LAGS: '3' }, 1, '2026.11.10'],
])('%s', (_name, before, tag, env, uploadCount, after) => {
  const github = fixture();
  if (before !== undefined) github.live(before === 'none' ? undefined : before);
  github.ready(tag);
  const result = github.run(tag, env);
  expect(result.status, result.stderr).toBe(0);
  expect(github.uploads(result)).toBe(uploadCount);
  expect(github.feedNow()).toBe(appcast(after));
});
it.each([
  ['has no DMG yet', ['appcast.xml']],
  ['has no appcast', ['MindRoom.dmg']],
])('writes nothing for a release that %s', (_name, assets) => {
  const github = fixture();
  github.live('2026.11.9');
  github.release('v2026.11.10', assets);
  const result = github.run('v2026.11.10');
  expect(result.status).toBe(0);
  expect(github.uploads(result)).toBe(0);
});
it.each([
  ['the feed cannot be read', { TEST_FAIL: 'view:mac-appcast' }, 0, '2026.11.9'],
  ['every upload fails', { TEST_UPLOAD_FAILS: '9' }, 3, undefined],
  ['the URL never serves it', { TEST_URL_LAGS: '999' }, 1, '2026.11.10'],
])('fails, without another write, when %s', (_name, env, uploadCount, after) => {
  const github = fixture();
  github.live('2026.11.9');
  github.ready('v2026.11.10');
  const result = github.run('v2026.11.10', env);
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain('::error::');
  expect(github.uploads(result)).toBe(uploadCount);
  expect(github.feedNow()).toBe(after === undefined ? undefined : appcast(after));
});
```

`macCatalystUpdater.test.ts`, on the `feed:` job's text in `macos.yml`, and on the whole workflow:

```ts
expect(feed).toContain('needs: dmg');
// Also after a dmg job that failed at the tap: the DMG is up then.
expect(feed).toContain("if: ${{ !cancelled() && needs.dmg.result != 'skipped' && (inputs.tag || github.event.release.tag_name) }}");
expect(feed).toMatch(/concurrency:\n\s+group: mac-appcast\n\s+cancel-in-progress: false/);
expect(feed).toContain('scripts/macos-publish-appcast.sh "$RELEASE_TAG"');
expect(feed).not.toContain('secrets.');
// Nothing but a release tag signs or writes: no other input, and every writing step asks for the tag.
expect(Object.keys(parsed.on.workflow_dispatch.inputs)).toEqual(['tag']);
writingSteps(parsed.jobs.dmg).forEach((step) => expect(step.if).toMatch(/env\.RELEASE_TAG|steps\.newest\.outputs\.newest/));
```

(`parsed` is the workflow read with the `yaml` package of `package.json`; `writingSteps` are the steps whose `run` holds `gh release upload`, `gh release create` or `homebrew-tap`.)

- [ ] **Step 2: Run them, expect failure.**
- [ ] **Step 3: Write `scripts/macos-publish-appcast.sh`** to the spec's rule ("Feed", the numbered list), with the calls above and a `mktemp -d` folder removed by a trap:
  1. `<tag>`'s asset names must include `MindRoom.dmg` and `appcast.xml`, else say `The feed stays: <tag> has no DMG with its appcast.` and exit 0. Download its `appcast.xml`.
  2. `mac-appcast`'s asset names. When that call fails: with `release not found` on its stderr, create the prerelease; otherwise print the error as `::error::` and exit 1.
  3. When it has `appcast.xml`: download it; identical bytes (`cmp -s`): say so, exit 0; read each file's `<sparkle:version>` with `sed`; when `sort -V` puts the feed's version last, say `The feed stays at <version>.` and exit 0.
  4. Upload with `--clobber`, up to three times, 10 s apart; all failed: `::error::The update feed could not be published and may be missing. Re-run this job: it needs no rebuild.` and exit 1.
  5. Then only read: up to 24 times, 5 s apart, until `curl`'s output is the new file (`cmp -s -`): say `The feed is now <tag>.` and exit 0; never: `::error::The feed was uploaded, but its URL does not serve it yet.` and exit 1.
  Every "say" goes to standard output and to `$GITHUB_STEP_SUMMARY` when that is set.
- [ ] **Step 4: The `feed` job in `macos.yml`,** after `dmg`: name `Publish the update feed`; `needs`, `if` and `concurrency` of the test; `runs-on: ubuntu-24.04`; `timeout-minutes: 10`; `permissions: contents: write`; env `RELEASE_TAG` as the `dmg` job's. A comment as `image.yml:125-130`: one at a time across every release's run; it publishes its release only above what the feed names, so the order runs finish in does not matter, and a re-run repairs a failed publication without a rebuild. Steps: `actions/checkout@v7` (`persist-credentials: false`), then `scripts/macos-publish-appcast.sh "$RELEASE_TAG"` with `GH_TOKEN: ${{ github.token }}`. The workflow's header comment gains the appcast and the feed.
- [ ] **Step 5: `docs/ios-release.md`,** a subsection `### Updates` at the end of "Mac DMG", from the spec: what the app does; each release's `appcast.xml` and the feed on `mac-appcast` (the rule, one job at a time, independent of the tap, the accepted limits); recovery (a feed job that failed: **Re-run failed jobs**, or the next release; an `appcast.xml` without a DMG: re-run the `dmg` job, after deleting a `starter` DMG by hand if the upload left one; a DMG is never replaced); the six keys and where they come from; the secret (also in the list of secrets); how Bas made the key and how a lost key is replaced (the spec's "Signing"); the fail-closed points; that a change to signing, the updater bundle or Sparkle's version needs one signed build before it merges, and how this one was made (Task 7); the one manual install; the Homebrew follow-up; that builds without the feed setting never start the updater; that a later rise of the minimum macOS version needs a second item in the feed. In "Mac DMG", "publish nothing" for a failed job is true only before the first upload; say so.
- [ ] **Step 6: Run** the vitest files of this task: PASS. `bash -n scripts/macos-publish-appcast.sh`; `just lint`, `just strict`: clean.
- [ ] **Step 7: Commit:** `feat(macos): one serialized job publishes the update feed`.

### Task 6: End to end on the MacBook M2 (functional, not production signing)

No file of the branch changes. The harness lives in the M2's worktree only: one commit there, `test-only: update acceptance harness`, never fetched back.

- [ ] **Step 1: Prepare the M2** (Global Constraints first). Worktree at the branch head; apply the harness in `AppDelegate.application(_:didFinishLaunchingWithOptions:)`, inside the Catalyst block, active only when the environment has `MINDROOM_HARNESS_SCRIPT`:
  - it skips `MacScreenshot.clearFolder()`, the hot key, the front-process follower and the mouse monitor, so the test app touches nothing another MindRoom on this Mac shares;
  - two `DispatchSource.makeSignalSource` sources on the main queue (after `signal(SIGUSR1, SIG_IGN)` and `signal(SIGUSR2, SIG_IGN)`), kept in static variables. `SIGUSR1`: read the file that variable names, evaluate it in the main window's web view (`(QuickCapture.mainScene?.windows.first?.rootViewController as? CAPBridgeViewController)?.webView`), and `NSLog("MindRoom harness: %@", ...)` the result or the error. `SIGUSR2`: what the Quit menu item does: `terminate:` sent to `NSApplication.sharedApplication` through the Objective-C runtime, as `MacWindowing.swift:26-56` reaches AppKit.
  Then `npm ci`; `npm run build:ios`; `scripts/watch/build-sdk.sh --fetch`; `scripts/fetch-sparkle.sh`; `npx cap sync ios`; and, as one script whose `trap ... EXIT` kills the server, the sampler and the app by PID and removes `$run`:

```bash
run=$(mktemp -d /tmp/mac-update-run.XXXXXX); mkdir -p "$run/v1" "$run/v2" "$run/feed" "$run/feed-c" "$run/app"
id=chat.mindroom.app.updatetest   # never chat.mindroom.app: its defaults and Sparkle cache belong to other runs on this Mac
port=8765; bin=ios/MacUpdater/Sparkle/bin; installed="$run/app/MindRoom Chat.app"   # the name Homebrew installs
! nc -z 127.0.0.1 "$port" || { echo "port $port is taken"; exit 1; }
within() { local end=$((SECONDS + $1)); shift; until "$@"; do ((SECONDS < end)) || { echo "timed out: $*"; exit 1; }; sleep 0.5; done; }
openssl rand -base64 32 > "$run/test.key"; openssl rand -base64 32 > "$run/other.key"
public=$(RUN="$run" xcrun swift - <<'SWIFT'
import CryptoKit
import Foundation
let path = ProcessInfo.processInfo.environment["RUN"]! + "/test.key"
let text = try! String(contentsOfFile: path).trimmingCharacters(in: .whitespacesAndNewlines)
print(try! Curve25519.Signing.PrivateKey(rawRepresentation: Data(base64Encoded: text)!).publicKey.rawRepresentation.base64EncodedString())
SWIFT
)
printf 'MINDROOM_UPDATE_FEED_URL = http:/$()/127.0.0.1:%s/appcast.xml\nMINDROOM_UPDATE_PUBLIC_KEY = %s\n' "$port" "$public" > "$run/e2e.xcconfig"
build() { XCODE_XCCONFIG_FILE="$run/e2e.xcconfig" xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination 'platform=macOS,variant=Mac Catalyst' -derivedDataPath /tmp/mac-update-dd CODE_SIGNING_ALLOWED=NO \
  "MARKETING_VERSION=$1" "CURRENT_PROJECT_VERSION=$1" build; }
take() { ditto /tmp/mac-update-dd/Build/Products/Debug-maccatalyst/MindRoom.chat.app "$1" &&
  plutil -replace CFBundleIdentifier -string "$id" "$1/Contents/Info.plist" && codesign --force --deep --sign - "$1"; }
build 2026.11.9  && take "$run/v1/MindRoom Chat.app"
build 2026.11.10 && take "$run/v2/MindRoom.chat.app"
# The release's own DMG recipe (build-macos-app.sh pack_dmg): MindRoom.app beside the Applications link.
python3 -m venv "$run/venv" && "$run/venv/bin/pip" install --quiet --disable-pip-version-check --require-hashes --only-binary :all: -r scripts/macos-dmg/requirements.txt
"$run/venv/bin/dmgbuild" -s scripts/macos-dmg/settings.py -D "app=$run/v2/MindRoom.chat.app" MindRoom "$run/feed/MindRoom.dmg"
scripts/macos-appcast.sh "$run/feed/MindRoom.dmg" "http://127.0.0.1:$port/" 2026.11.10 "$run/feed/appcast.xml" < "$run/test.key"
# Run C's feed: the same DMG, its enclosure signed with another key.
cp "$run/feed/MindRoom.dmg" "$run/feed-c/" && other=$("$bin/sign_update" --ed-key-file "$run/other.key" -p "$run/feed/MindRoom.dmg")
sed "s|sparkle:edSignature=\"[^\"]*\"|sparkle:edSignature=\"$other\"|" "$run/feed/appcast.xml" > "$run/feed-c/appcast.xml"
served() { curl -fsS "http://127.0.0.1:$port/appcast.xml" | cmp -s - "$1/appcast.xml"; }
serve() { python3 -m http.server "$port" --bind 127.0.0.1 --directory "$1" > "$run/http.log" 2>&1 & server=$!
  within 10 served "$1"; : > "$run/http.log"; }   # this check's own request is not the app's
running() { pid=$(pgrep -f "$installed/Contents/MacOS/"); }
start() { trash "$installed" 2>/dev/null; ditto "$run/v1/MindRoom Chat.app" "$installed"; defaults delete "$id" 2>/dev/null
  open -n --env "MINDROOM_HARNESS_SCRIPT=$run/eval.js" --stderr "$run/$1.log" "$installed"; within 20 running
  xcrun swift "$run/windows.swift" "$pid" > "$run/$1.windows" & sampler=$!; }
ask() { printf '%s' "$1" > "$run/eval.js"; kill -USR1 "$pid"; sleep 2; grep 'MindRoom harness:' "$run/$2.log" | tail -1; }
version() { /usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$installed/Contents/Info.plist"; }
logged() { grep -q "$1" "$2"; }
```

Expected: `grep -c '<sparkle:version>2026.11.10</sparkle:version>' "$run/feed/appcast.xml"` prints `1`; the two feeds differ only in the signature. `$run/windows.swift <pid>`: every half second it prints, when it changed, the sorted `layer width x height` of the on-screen windows (`CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)`) whose `kCGWindowOwnerPID` is that PID or whose owner is named `Updater` or `Autoupdate`; its first line is the baseline. Check first that, started over ssh, it lists a running app's main window; if not, start it with `launchctl asuser "$(id -u)"`; if that lists nothing either, report the "no other window" checks as not made.
- [ ] **Step 2: Run A: silent staging, the card, a reloaded page, Reload.** `serve "$run/feed"`; `start a`. In order, each with its output recorded:
  1. `within 180 logged 'MindRoom update ready: 2026.11.10' "$run/a.log"`; `http.log` has `GET /appcast.xml` and `GET /MindRoom.dmg` with 200; `a.windows` holds its baseline alone: the main window.
  2. Within 70 s (the page asks once a minute), `ask "document.querySelector('[data-new-version-card]')?.innerText ?? 'no card'" a` logs the card's text with `Reload`.
  3. `ask 'location.reload()' a`, wait 10 s, repeat 2: the card again, at once (a page that starts asks).
  4. `version` prints `2026.11.9` and `running` still finds the same `$pid`: nothing was installed yet.
  5. `first=$pid`; `ask "document.querySelector('[data-new-version-card] button').click()" a`. Within a minute: `version` prints `2026.11.10`; `running` finds one PID that is not `$first`; `ls "$run/app"` is `MindRoom Chat.app` alone.
- [ ] **Step 3: Run B: install on a normal quit.** Kill run A's app and sampler by PID. `start b`; `within 180 logged 'MindRoom update ready: 2026.11.10' "$run/b.log"`; wait 30 s; `version` prints `2026.11.9`. `kill -USR2 "$pid"` (Quit). Within a minute: `version` prints `2026.11.10` and `running` finds nothing.
- [ ] **Step 4: Run C: another key's signature.** Kill the sampler and `$server`; `serve "$run/feed-c"`; `start c`; `within 180 logged 'GET /MindRoom.dmg' "$run/http.log"`; wait 90 s: `c.log` has no `MindRoom update ready`; `ask` of 2 logs `no card`; `c.windows` holds its baseline alone; `version` prints `2026.11.9`.
- [ ] **Step 5: Clean up.** Let the trap run; `defaults delete "$id"`; `trash ~/Library/Caches/"$id"`; drop the harness commit. Leave `/tmp/mac-voice-dd` and `/tmp/qc-dd` alone.
- [ ] **Step 6: Report** the commands and outputs of Steps 1 to 4 for the pull request's description, under the heading the spec's "Testing" gives it: functional only, ad-hoc signed, loopback, no screenshot. A step whose expectation fails is a finding to fix in its owning task, not to work around here.

### Task 7: Bas's key turns the updater on; one signed build before the merge

Blocked until Bas has sent the public key and confirmed that the secret `SPARKLE_ED_PRIVATE_KEY` is set (the spec's "Keys and secrets"). Every other task is independent of it.

**Files:**
- Modify: `ios/App/App.xcodeproj/project.pbxproj`, `scripts/build-macos-app.sh`, `src/app/native/macCatalystUpdater.test.ts`, `src/app/native/macCatalystRelease.test.ts`

- [ ] **Step 1: Failing tests.** `macCatalystUpdater.test.ts`: `App`'s Release configuration has `MINDROOM_UPDATE_FEED_URL` equal to the feed of Global Constraints and a `MINDROOM_UPDATE_PUBLIC_KEY` that matches `/^[A-Za-z0-9+/]{43}=$/`; its Debug configuration and every other target have neither. `macCatalystRelease.test.ts` (the `plutil` stub answers `-extract <key> raw` from `TEST_PLIST`, a JSON object that defaults to the six values of Global Constraints with the fixture's key; the fixture's archived and exported apps gain the folder `Contents/PlugIns/MindRoomMacUpdater.bundle/Contents/Frameworks/Sparkle.framework`): an unsigned run with `SUScheduledCheckInterval: '86400'` in `TEST_PLIST`, one without `SUPublicEDKey`, and one whose archived app lacks that folder each fail before `dmgbuild`.
- [ ] **Step 2: The project.** Both settings in `App`'s Release configuration, the key exactly as Bas sent it.
- [ ] **Step 3: `scripts/build-macos-app.sh`:** a function that takes an app and fails, naming what is wrong, unless that folder exists, `plutil -extract <key> raw -o -` on its Info.plist gives the feed URL, `true`, `true`, `3600` and `true` for the five fixed keys, and `SUPublicEDKey` is 44 characters. Called on the archived app before the unsigned `pack_dmg` and on the exported app before the signature checks. Comment: every Mac build of this script carries the updater, so a pull request proves the embed and the keys on the real archive.
- [ ] **Step 4: Run** `just typecheck`, `just strict`, `NODE_OPTIONS=--max-old-space-size=6144 just lint`, `just test`: clean and PASS.
- [ ] **Step 5: Commit:** `feat(macos): turn the updater on for release builds`. On the pull request, the **Mac app** workflow must pass: it archives the Store app (preflight: no updater) and the unsigned Release app (the check of Step 3).
- [ ] **Step 6: One signed build, before the merge, with Bas's go-ahead for this exact commit** (it uses the signing secrets). Nothing of it ships: no file of the pull request changes.
  - Push a scratch branch `smoke/mac-auto-update`: the pull request's head plus one commit, `throwaway: signed build that publishes nothing`, that cuts `.github/workflows/macos.yml` down: `workflow_dispatch` without inputs as the only trigger; no `feed` job; no step that holds `gh release`, `gh api` or `RELEASE_TAG`; the signing steps unconditional; the version from `git fetch --tags --quiet "https://github.com/$GITHUB_REPOSITORY.git"` and `node scripts/calver.mjs latest` (without its `v`) for `MARKETING_VERSION`, `CURRENT_PROJECT_VERSION` and the appcast step; and, after `Make the appcast`, two steps:
    - `Open the notarized app`: `defaults delete chat.mindroom.app SULastCheckTime` (may fail); `hdiutil attach build/macos/MindRoom.dmg -nobrowse -readonly -mountpoint "$RUNNER_TEMP/dmg"`, detached by a trap; `ditto` its `MindRoom.app` to `$RUNNER_TEMP`; `spctl --assess --type execute` it; `open -n` it and take its PID with `pgrep -f "$RUNNER_TEMP/MindRoom.app/Contents/MacOS/"`; within 60 s `defaults read chat.mindroom.app SULastCheckTime` must succeed, else fail; kill that PID.
    - `actions/upload-artifact@v7`: `build/macos/MindRoom.dmg` alone (its `appcast.xml` names a URL that will hold other bytes), `retention-days: 3`.
  - `gh workflow run macos.yml --repo mindroom-ai/mindroom-chat --ref smoke/mac-auto-update`, as Bas. It must pass: `codesign --verify --deep --strict` and the team and runtime of the six executables on the export, notarization of the app and the DMG, an `appcast.xml` signed with the real key for the public key in the project, and the notarized app starting its updater. Link the run in the pull request, say what it proves and what it does not (the spec's "Signing"), download the DMG, and delete the branch.
  - If the signature check fails, apply the spec's "If the export leaves a helper unsigned" in `build-macos-app.sh` on the pull request, rebuild the scratch branch from the new head and run again. Do not merge without a green run.
  - Instead, if Bas prefers his own Mac: `scripts/fetch-sparkle.sh` and `scripts/build-macos-app.sh --sign` there with the signing variables of `docs/ios-release.md` and the newest release's version, then the `Open the notarized app` commands by hand.

## After the merge (Bas)

1. Install the DMG of the signed build by hand: this is the one manual install. It carries the then newest release's version, so the first release after the merge is an update for it.
2. That release's **Mac app** run attaches its `appcast.xml` and DMG, and its `feed` job creates `mac-appcast`. Within about an hour the card appears in the installed app; Reload opens the new version. This is the signed end-to-end check of the installer and the feed.
3. If a release's `dmg` job fails, the feed keeps naming the last release it published. If only its `feed` job fails, re-run that job.
4. Follow-up in `mindroom-ai/homebrew-tap`: `auto_updates true`.
