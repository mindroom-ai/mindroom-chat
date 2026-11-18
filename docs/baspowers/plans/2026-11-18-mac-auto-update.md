# Mac app automatic updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development (six tasks with separate review surfaces: Sparkle API use, project wiring and Store isolation, the JS seam, the release pipeline, a Mac run; a mistake in the release pipeline stops every release's DMG).

**Goal:** The Developer ID Mac app downloads each release by itself and shows the browser's "new version" card, whose Reload installs it and opens it again.

**Architecture:** Sparkle 2 lives in a new macOS plug-in bundle that only target `App` embeds, and only on Mac Catalyst. The app starts it at launch; when Sparkle has staged an update, a Capacitor plugin tells the page, the existing card shows, and its Reload runs Sparkle's immediate-install block. The Mac workflow signs a one-item `appcast.xml` for each DMG and replaces it on the prerelease `mac-appcast`.

**Tech Stack:** Swift (UIKit Catalyst app, AppKit plug-in bundle), Sparkle 2.10.1, Capacitor 8, TypeScript (strict), vitest, bash, GitHub Actions.

**Spec:** `docs/baspowers/specs/2026-11-18-mac-auto-update-design.md`. Read it first: it holds the reasons, the Sparkle source references and the error table.

## Global Constraints

- Repo `AGENTS.md`: commands in `nix develop`; `just typecheck` and `just strict` 0 errors; `NODE_OPTIONS=--max-old-space-size=6144 just lint`; `just format <paths>` on the TypeScript you change; tests beside their subject; no em dashes; add files by explicit path; `git -c commit.gpgsign=false commit --trailer "Assisted-by: MindRoom DevAgent:<model id> <https://github.com/mindroom-ai/mindroom>"`. Never `git stash`.
- Sparkle is pinned: version `2.10.1`, `Sparkle-2.10.1.tar.xz`, sha256 `1a856d2a9edb8e628de88121d7be04cf0e2167f8641650b78fca00b14244cf27`.
- Names, verbatim: bundle `MindRoomMacUpdater.bundle`, identifier `chat.mindroom.app.mac-updater`, principal class `MindRoomMacUpdater`; plugin `MindRoomUpdate`, event `ready` with `{ version: string }`, method `install`, rejection code `NOT_READY`; build settings `MINDROOM_UPDATE_FEED_URL` and `MINDROOM_UPDATE_PUBLIC_KEY`; secret `SPARKLE_ED_PRIVATE_KEY`; prerelease tag `mac-appcast`; feed `https://github.com/mindroom-ai/mindroom-chat/releases/download/mac-appcast/appcast.xml`.
- Info.plist keys of the built Mac `App`, and nowhere else: `SUFeedURL` (string, the feed), `SUPublicEDKey` (string), `SUEnableAutomaticChecks` (bool YES), `SUAutomaticallyUpdate` (bool YES), `SUScheduledCheckInterval` (integer 3600), `SUVerifyUpdateBeforeExtraction` (bool YES).
- The Store app and iOS never contain the updater: new Swift in `ios/App/App` and every use of it compiles only under `#if targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE`, and is in target `App`'s Sources only.
- No new user-facing text. `NewVersionNotice.tsx` changes in its comment only.
- `project.pbxproj` is edited by hand: new 24-hex-digit ids, entries modelled on `MindRoomMacSupport`'s, no reformatting.
- The private key is Bas's. Never generate, read or store the real one; Task 5 uses a throwaway key.
- Mac work runs on the MacBook M2 only: `export SSH_AUTH_SOCK=$(ls -t ~/.ssh/agent/s.* | head -1)`, then `ssh -A pc.local 'ssh macbook-m2 ...'` (pipe scripts: `cat x.sh | ssh -A pc.local 'ssh macbook-m2 bash -s'`). First `ssh -A pc.local '~/repos/machines.sh'`; before every build `pmset -g batt` must say AC Power, else stop and report. Own worktree `~/repos/worktrees/mindroom-chat-mac-update`, DerivedData `/tmp/mac-update-dd`, run folder `/tmp/mac-update-run`. Commits reach the M2 without GitHub, as in this workspace's earlier Mac tasks (for example a `refs/wip/mac-auto-update` ref on pc that the M2 fetches). Another agent uses `/tmp/mac-voice-dd` and `/tmp/qc-dd`: touch neither, and kill only your own PIDs. The M5 and the work MacBook are off limits.

## Review Focus

- A page that loads or reloads after the update was staged must still get the card: the plugin answers each new listener with the staged version (Task 3, contract test).
- Reload pressed while the app cannot quit, or the native side refusing the install, must give the button back, not spin forever or reload the page (Task 3, `appUpdate.test.ts`).
- A Debug build, an iOS build and a build without the feed setting must get no updater keys, or a local build replaces itself with the release (Task 2, script test; Task 6, project test).
- A release that is no longer the newest must not move the feed, and a feed without a signature must never be uploaded (Task 4, workflow contract and script test).
- An app installed under another name (Homebrew's `MindRoom Chat.app`) must update in place (Task 5 runs v1 under that name).

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
    /// Starts Sparkle's scheduled checks. `onReady` runs on the main thread with the version
    /// (`CFBundleShortVersionString`) of an update that is downloaded and waits to be installed.
    func start(onReady: @escaping (String) -> Void)
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
  - `start(onReady:)`: once only; keeps `onReady`; creates `SPUUpdater(hostBundle: .main, applicationBundle: .main, userDriver: SPUStandardUserDriver(hostBundle: .main, delegate: nil), delegate: self)` and calls `try updater.start()`, logging a thrown error with `NSLog` (no alert: spec "Where Sparkle links").
  - `updater(_:willInstallUpdateOnQuit:immediateInstallationBlock:) -> Bool`: keeps the block, calls `onReady(item.displayVersionString)`, returns `true`.
  - `install() -> Bool`: runs the kept block and returns `true`, or returns `false` without one. The block stays kept: Sparkle allows calling it again if the quit was cancelled.
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
    static let readyNotification = Notification.Name("MindRoomUpdateReady")
    private(set) static var readyVersion: String?
    /// Loads Contents/PlugIns/MindRoomMacUpdater.bundle and starts it. Does nothing in an app
    /// whose Info.plist has no SUFeedURL. Logs "MindRoom update ready: <version>" when one is staged.
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

Expected: both builds succeed, the first app has no `SUFeedURL`, the last line prints `6`. Then, with the work committed, `MARKETING_VERSION=2026.11.9 CURRENT_PROJECT_VERSION=1 scripts/build-macos-store.sh --unsigned` ends with `structure checks passed`.
- [ ] **Step 10: Commit:** `feat(macos): the app embeds and starts the updater outside the Store`.

### Task 3: The plugin and the card

**Files:**
- Create: `ios/App/App/MindRoomUpdatePlugin.swift`, `src/app/native/nativeUpdate.ts`, `src/app/native/nativeUpdate.test.ts`, `src/app/native/nativeUpdateIOSContract.test.ts`
- Modify: `ios/App/App/MindRoomBridgeViewController.swift`, `ios/App/App.xcodeproj/project.pbxproj` (the plugin in `App`'s Sources), `src/app/config/appUpdate.ts`, `src/app/config/appUpdate.test.ts`, `src/index.tsx`, `src/index.test.ts` (mock the new module as it mocks `appUpdate`), `src/app/native/macCatalystUpdater.test.ts` (the Store Sources check also names `MindRoomUpdatePlugin.swift`), comments in `src/app/shell/NewVersionNotice.tsx` and `src/client-sdk/core.ts`

**Interfaces:**
- Consumes: `MacUpdater.readyNotification`, `MacUpdater.readyVersion`, `MacUpdater.install()` (Task 2).
- Produces, in `appUpdate.ts`: `export const offerAppUpdate = (version: string, install: () => Promise<void>): void`.
- Produces, in `nativeUpdate.ts`: `export const isNativeUpdateAvailable = (): boolean` and `export const watchNativeUpdate = async (): Promise<() => void>`.

- [ ] **Step 1: Write the failing tests.**

`appUpdate.test.ts`, a new `describe('an update the app itself downloaded')` (with the file's `loadAppUpdate`):

```ts
it('is ready at once and tells the card once', async () => {
  const { getNewVersion, getReadyVersion, offerAppUpdate, subscribeToNewVersion } = await loadAppUpdate();
  const listener = vi.fn();
  subscribeToNewVersion(listener);
  offerAppUpdate('2026.11.10', async () => undefined);
  offerAppUpdate('2026.11.10', async () => undefined);
  expect(getNewVersion()).toBe('2026.11.10');
  expect(getReadyVersion()).toBe('2026.11.10');
  expect(listener).toHaveBeenCalledOnce();
});
it('installs instead of reloading the page, and rejects when the app is still there', async () => {
  const { offerAppUpdate, reloadForNewVersion } = await loadAppUpdate();
  const install = vi.fn(async () => undefined);
  const reload = vi.fn();
  offerAppUpdate('2026.11.10', install);
  await expect(reloadForNewVersion({ timeoutMs: 10, reload })).rejects.toThrow();
  expect(install).toHaveBeenCalledOnce();
  expect(reload).not.toHaveBeenCalled();
});
it('rejects at once when the app refuses the install', async () => {
  const { offerAppUpdate, reloadForNewVersion } = await loadAppUpdate();
  const reload = vi.fn();
  offerAppUpdate('2026.11.10', () => Promise.reject(new Error('NOT_READY')));
  await expect(reloadForNewVersion({ timeoutMs: 60_000, reload })).rejects.toThrow('NOT_READY');
  expect(reload).not.toHaveBeenCalled();
});
```

`nativeUpdate.test.ts`, with the `@capacitor/core` mock and `setAvailable` of `nativeWatch.test.ts:13-35` (plugin `{ install: vi.fn(), addListener: vi.fn() }`) and `vi.mock('../config/appUpdate', () => ({ offerAppUpdate: vi.fn() }))`:

```ts
it('does nothing outside the Mac app', async () => {
  setAvailable(false);
  (await watchNativeUpdate())();
  expect(plugin.addListener).not.toHaveBeenCalled();
});
it('offers the update the app reports, with the plugin install, and stops', async () => {
  setAvailable(true);
  const remove = vi.fn();
  plugin.addListener.mockImplementation(async (_event: string, callback: (update: unknown) => void) => {
    callback({});
    callback({ version: '2026.11.10' });
    return { remove };
  });
  const stop = await watchNativeUpdate();
  expect(plugin.addListener).toHaveBeenCalledWith('ready', expect.any(Function));
  expect(offerAppUpdate).toHaveBeenCalledOnce();
  expect(offerAppUpdate).toHaveBeenCalledWith('2026.11.10', expect.any(Function));
  await vi.mocked(offerAppUpdate).mock.calls[0]![1]();
  expect(plugin.install).toHaveBeenCalledOnce();
  stop();
  expect(remove).toHaveBeenCalled();
});
```

`nativeUpdateIOSContract.test.ts` (sources as text, as `nativeWatchIOSContract.test.ts`):

```ts
expect(pluginSource.trimStart().startsWith('#if targetEnvironment(macCatalyst) && !MINDROOM_MAC_APP_STORE')).toBe(true);
expect(pluginSource).toContain('public let jsName = "MindRoomUpdate"');
expect(pluginSource).toContain('CAPPluginMethod(name: "install", returnType: CAPPluginReturnPromise)');
expect(pluginSource).toContain('@objc func install(_ call: CAPPluginCall)');
expect(pluginSource).toContain('notifyListeners("ready", data: ["version": version])');
// Capacitor keeps an event only for the first listener: a reloaded page must hear it too.
expect(pluginSource).toContain('override public func addListener(_ call: CAPPluginCall)');
expect(pluginSource).toContain('call.reject("No update is ready", "NOT_READY")');
// The Quick Capture window shows no card.
expect(bridgeSource).toContain(
  'if !(self is QuickCaptureViewController) { bridge?.registerPluginInstance(MindRoomUpdatePlugin()) }'
);
```

- [ ] **Step 2: Run them, expect failure.**
- [ ] **Step 3: `appUpdate.ts`.** A module variable keeps the install. `offerAppUpdate` keeps it, and when `version` is not already the ready one sets `newVersion` and `readyVersion` to it and notifies. `reloadForNewVersion`, first thing when an install is kept: `await` it, wait `timeoutMs`, then throw `new Error('The app did not restart for its update')`. Extend the file's header comment with one paragraph: the Mac app's page never differs from its `version.json`; its updater offers the update instead.
- [ ] **Step 4: `nativeUpdate.ts`,** in the shape of `nativeWatch.ts:56-104`: `isNativeUpdateAvailable` (native platform, `ios`, `isPluginAvailable('MindRoomUpdate')`); `watchNativeUpdate` returns a no-op stop when unavailable, else adds a `ready` listener that calls `offerAppUpdate(version, () => plugin.install())` for an event whose `version` is a non-empty string, and returns a function that removes it.
- [ ] **Step 5: `src/index.tsx`:** after the `new version watch` step, `runSafely('app update watch', () => { watchNativeUpdate().catch(() => undefined); })` with a comment naming `native/nativeUpdate.ts`.
- [ ] **Step 6: `MindRoomUpdatePlugin.swift`,** whole file under the compile condition, `import Capacitor` inside it: `@objc(MindRoomUpdatePlugin) public class MindRoomUpdatePlugin: CAPPlugin, CAPBridgedPlugin` with `identifier = "MindRoomUpdatePlugin"`, the `jsName` and method of the contract test. `load()` observes `MacUpdater.readyNotification` on the main queue and calls `notifyListeners("ready", data: ["version": version])` for the ready version (remove the observer in `deinit`). `addListener` calls `super`, then resolves that call with `["version": version]` when a version is ready. `install` runs on the main queue: `MacUpdater.install()` resolves, else the rejection of the contract test.
- [ ] **Step 7: Register it** in `capacitorDidLoad`, after the Quick Capture plugin and before the Store-only `return`, under the compile condition, with the line of the contract test. Add the file to `App`'s Sources in `project.pbxproj`.
- [ ] **Step 8: Comments.** `NewVersionNotice.tsx`'s doc comment gains: in the Mac app the card appears once the app has downloaded an update, and Reload installs it and restarts the app. `client-sdk/core.ts`'s `reloadForNewVersion` comment gains the same sentence about a downloaded update.
- [ ] **Step 9: Run** the three test files and `src/index.test.ts`, `src/app/shell/NewVersionNotice.test.tsx`, `src/app/ui/PartUnavailable.test.tsx`, `src/app/shell/AppErrorBoundary.test.tsx`, `src/client-sdk/core.test.ts`: PASS. `just typecheck`, `just strict`, `just lint`: clean.
- [ ] **Step 10: Commit:** `feat(macos): a downloaded update shows the new version card`.

### Task 4: The signed feed in the Mac workflow

**Files:**
- Create: `scripts/macos-appcast.sh`
- Modify: `scripts/build-macos-app.sh`, `.github/workflows/macos.yml`, `src/app/native/macUpdaterScripts.test.ts`, `src/app/native/macCatalystRelease.test.ts`, `src/app/native/macCatalystUpdater.test.ts`, `docs/ios-release.md`

**Interfaces:**
- Produces: `scripts/macos-appcast.sh <dmg> <download-url-prefix> <appcast-path>`, the private key on standard input. Exit 0 only with a feed at `<appcast-path>` that carries a `sparkle:edSignature`.

- [ ] **Step 1: Write the failing tests.**

`macUpdaterScripts.test.ts` (the fixture has a recording stub `scripts/fetch-sparkle.sh` and a stub `ios/MacUpdater/Sparkle/bin/generate_appcast` that records its arguments and standard input and writes `process.env.TEST_FEED` to the path after `-o`):

```ts
const args = ['MindRoom.dmg', 'https://example.invalid/v2026.11.10/', 'appcast.xml'];
it('signs the feed with the key from standard input', () => {
  const { root, run } = fixture();
  writeFileSync(join(root, 'MindRoom.dmg'), 'dmg');
  const result = run('scripts/macos-appcast.sh', { TEST_FEED: '<enclosure sparkle:edSignature="s"/>' }, args, 'KEY');
  expect(result.status, result.stderr).toBe(0);
  const tool = result.commands.find(({ command }) => command === 'generate_appcast')!;
  expect(tool.args.slice(0, 6)).toEqual(['--ed-key-file', '-', '--download-url-prefix', args[1], '-o', 'appcast.xml']);
  expect(tool.stdin).toBe('KEY');
  expect(result.stdout + result.stderr).not.toContain('KEY');
});
it('refuses a feed without a signature', () => {
  const { root, run } = fixture();
  writeFileSync(join(root, 'MindRoom.dmg'), 'dmg');
  const result = run('scripts/macos-appcast.sh', { TEST_FEED: '<enclosure/>' }, args, 'KEY');
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain('SUPublicEDKey');
  expect(existsSync(join(root, 'appcast.xml'))).toBe(false);
});
it('refuses to run without a key', () => {
  const result = fixture().run('scripts/macos-appcast.sh', {}, args, '');
  expect(result.status).not.toBe(0);
  expect(result.commands.some(({ command }) => command === 'generate_appcast')).toBe(false);
});
```

(`run` grows two optional parameters: the script's arguments and its standard input.)

`macCatalystRelease.test.ts`: the `codesign` stub answers `-dv` with `TeamIdentifier=${process.env.TEST_TEAM ?? 'DNA6966LGZ'}` on stderr. The signed lifecycle test (`:174`) expects five `codesign -dv` calls, on `.../Sparkle.framework/Versions/B/Sparkle`, `Autoupdate`, `Updater.app`, `XPCServices/Installer.xpc` and `XPCServices/Downloader.xpc` under `Contents/PlugIns/MindRoomMacUpdater.bundle/Contents/Frameworks`, before the first `notarytool`. A new test: `TEST_TEAM: 'OTHER'` fails the run with `Sparkle` in stderr and no `notarytool` call. A new test: an unsigned run never runs `scripts/macos-appcast.sh` (stub it, recording).

`macCatalystUpdater.test.ts`, on the text of `macos.yml`:

```ts
expect(workflow).toContain("HAS_SPARKLE_KEY: ${{ secrets.SPARKLE_ED_PRIVATE_KEY != '' }}");
const steps = ['Build, sign and notarize', 'Make the update feed', 'Attach the DMG to the release',
  'Check that the release is the newest', 'Ask the tap to update its cask', 'Publish the update feed'];
const at = steps.map((name) => workflow.indexOf(`- name: ${name}\n`));
expect(at.every((index) => index >= 0)).toBe(true);
expect(at).toEqual([...at].sort((a, b) => a - b));
const feed = workflow.slice(workflow.indexOf('- name: Publish the update feed\n'));
expect(feed).toContain("if: steps.newest.outputs.newest == 'true'");
expect(feed).toContain('gh release upload mac-appcast build/macos/appcast.xml --clobber');
// Only the feed step sees the private key.
expect(workflow.match(/secrets\.SPARKLE_ED_PRIVATE_KEY(?! != '')/g)).toHaveLength(1);
```

- [ ] **Step 2: Run them, expect failure.**
- [ ] **Step 3: Write `scripts/macos-appcast.sh`.** It runs from the repository root, as the other scripts do, so relative paths are relative to it. Read the key from standard input and fail without one before anything else. Run `scripts/fetch-sparkle.sh`. Copy the DMG alone into a `mktemp -d` folder (removed by a trap) and run `generate_appcast --ed-key-file - --download-url-prefix "$2" -o "$3" "$folder"` with the key piped in (`printf '%s'`, never an argument or the environment). Unless the feed contains `sparkle:edSignature="`, delete it and fail with: `The feed has no EdDSA signature: the app has no SUPublicEDKey, or the private key is not its pair.`
- [ ] **Step 4: `scripts/build-macos-app.sh`, signed path,** after `test -d "$app"` and before the first `notarize`: for each of the five paths of the test, read `codesign -dv --verbose=4` into a variable and fail with `Sparkle's <path> is not signed by team DNA6966LGZ` unless a line is exactly `TeamIdentifier=DNA6966LGZ`. Comment: Xcode's export re-signs Sparkle's helpers (the spec's source 5); this proves it did, inside the plug-in too.
- [ ] **Step 5: `.github/workflows/macos.yml`.**
  - "Check the release" gets the `HAS_SPARKLE_KEY` env of the test and, first in its script, fails with `::error::The secret SPARKLE_ED_PRIVATE_KEY is missing: a release must not ship without its update feed` unless it is `true`.
  - New step `Make the update feed` (`if: env.RELEASE_TAG`) after the build, with `SPARKLE_ED_PRIVATE_KEY: ${{ secrets.SPARKLE_ED_PRIVATE_KEY }}` in its env only: `printf '%s' "$SPARKLE_ED_PRIVATE_KEY" | scripts/macos-appcast.sh build/macos/MindRoom.dmg "https://github.com/$GITHUB_REPOSITORY/releases/download/$RELEASE_TAG/" build/macos/appcast.xml`.
  - New step `Publish the update feed` after `Ask the tap to update its cask`, with the `if` of the test and `GH_TOKEN: ${{ github.token }}`: create the prerelease when `gh release view mac-appcast` fails (`gh release create mac-appcast --prerelease --title 'Mac app update feed' --notes 'appcast.xml is the feed the Mac app reads for its updates. It is replaced with every release.'`), then the upload line of the test, both with `--repo "$GITHUB_REPOSITORY"`.
  - `pull_request.paths` gains `scripts/fetch-sparkle.sh`, `scripts/macos-appcast.sh` and `scripts/macos-updater-info-plist.sh`. The header comment says what the feed is and when it moves.
- [ ] **Step 6: `docs/ios-release.md`,** a subsection `### Updates` at the end of "Mac DMG", from the spec: what the app does, the feed and its prerelease, the six keys and where they come from, the secret (also in the list of secrets), how Bas made the key and how a lost key is replaced (a Developer ID signed DMG is accepted, so a release with a new `SUPublicEDKey` reaches every app), the three fail-closed points, the one manual install, the Homebrew follow-up, and that Debug builds have no updater.
- [ ] **Step 7: Run** the three vitest files: PASS. `just lint`, `just strict`: clean.
- [ ] **Step 8: Commit:** `feat(macos): every release signs and publishes its update feed`.

### Task 5: End to end on the MacBook M2

**Files:**
- Modify: `ios/App/App/MindRoomBridgeViewController.swift`, `src/app/native/nativeUpdateIOSContract.test.ts`

**Interfaces:**
- Produces: in Debug Mac builds, `MINDROOM_UPDATE_ACCEPTANCE=1` makes the main window's bridge press the card's Reload once it exists and log `MindRoom update acceptance: pressed Reload`.

- [ ] **Step 1: The fixture.** Contract test first: `bridgeSource` contains `MINDROOM_UPDATE_ACCEPTANCE` after a `#if DEBUG` line and the log line above. Then, in `viewDidAppear` before the file-save fixture's `guard`, under `#if DEBUG` and the compile condition: with that environment value, not in a `QuickCaptureViewController`, once per controller, a one-second repeating timer evaluates `(() => { const button = document.querySelector('[data-new-version-card] button'); if (!button) return false; button.click(); return true; })()`; on `true` it logs and stops. Commit: `test(macos): an acceptance fixture presses the update card's Reload`.
- [ ] **Step 2: Prepare the M2** (Global Constraints first). Worktree at the branch head; `npm ci`; `npm run build:ios`; `scripts/watch/build-sdk.sh --fetch`; `scripts/fetch-sparkle.sh`; `npx cap sync ios`. Then:

```bash
run=/tmp/mac-update-run; mkdir -p $run/v1 $run/v2 $run/feed $run/app
openssl rand -base64 32 > $run/test.key
public=$(xcrun swift - <<'SWIFT'
import CryptoKit
import Foundation
let text = try! String(contentsOfFile: "/tmp/mac-update-run/test.key").trimmingCharacters(in: .whitespacesAndNewlines)
print(try! Curve25519.Signing.PrivateKey(rawRepresentation: Data(base64Encoded: text)!).publicKey.rawRepresentation.base64EncodedString())
SWIFT
)
printf 'MINDROOM_UPDATE_FEED_URL = http:/$()/127.0.0.1:8765/appcast.xml\nMINDROOM_UPDATE_PUBLIC_KEY = %s\n' "$public" > $run/e2e.xcconfig
build() { XCODE_XCCONFIG_FILE=$run/e2e.xcconfig xcodebuild -workspace ios/App/App.xcworkspace -scheme App -configuration Debug \
  -destination 'platform=macOS,variant=Mac Catalyst' -derivedDataPath /tmp/mac-update-dd CODE_SIGNING_ALLOWED=NO \
  MARKETING_VERSION=$1 CURRENT_PROJECT_VERSION=$1 build; }
built=/tmp/mac-update-dd/Build/Products/Debug-maccatalyst/MindRoom.chat.app
build 2026.11.9  && ditto "$built" "$run/v1/MindRoom Chat.app"
build 2026.11.10 && ditto "$built" "$run/v2/MindRoom.chat.app"
codesign --force --deep --sign - "$run/v1/MindRoom Chat.app" "$run/v2/MindRoom.chat.app"
hdiutil create -volname MindRoom -srcfolder $run/v2 -format UDZO -ov $run/feed/MindRoom.dmg
scripts/macos-appcast.sh $run/feed/MindRoom.dmg http://127.0.0.1:8765/ $run/feed/appcast.xml < $run/test.key
(cd $run/feed && nohup python3 -m http.server 8765 --bind 127.0.0.1 > $run/http.log 2>&1 & echo $! > $run/http.pid)
```

Expected: `appcast.xml` has one item with `sparkle:version="2026.11.10"` and a `sparkle:edSignature`.
- [ ] **Step 3: Run A, Reload.**

```bash
ditto "$run/v1/MindRoom Chat.app" "$run/app/MindRoom Chat.app"
defaults delete chat.mindroom.app SULastCheckTime 2>/dev/null || true
open -n --env MINDROOM_UPDATE_ACCEPTANCE=1 --stderr $run/a.log "$run/app/MindRoom Chat.app"
```

Expected within three minutes, each recorded with its output: `http.log` has `GET /appcast.xml` and `GET /MindRoom.dmg` with 200; `a.log` has `MindRoom update ready: 2026.11.10` and then `MindRoom update acceptance: pressed Reload`; `/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$run/app/MindRoom Chat.app/Contents/Info.plist"` prints `2026.11.10`; `pgrep -f "$run/app/MindRoom Chat.app/Contents/MacOS/"` prints a PID other than the first launch's (the app was opened again). Between the two log lines, a `CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID)` listing (a five-line `xcrun swift -` script) shows one layer-0 window owned by `MindRoom.chat` and none owned by `Updater`: nothing but the main window was shown.
- [ ] **Step 4: Run B, install on quit.** Kill run A's app by PID, replace `$run/app/MindRoom Chat.app` with the v1 copy, delete `SULastCheckTime` again, `open -n --stderr $run/b.log` it without the environment value. When `b.log` has `MindRoom update ready: 2026.11.10`, wait 30 seconds, check that the app still runs as `2026.11.9` (no install without a quit), then `kill -TERM` its PID. Expected within a minute: `CFBundleVersion` of the app is `2026.11.10`, and no process runs from `$run/app`.
- [ ] **Step 5: Clean up.** Kill the http server and your app by PID; `defaults delete chat.mindroom.app SULastCheckTime`. Leave `/tmp/mac-voice-dd` and `/tmp/qc-dd` alone.
- [ ] **Step 6: Report** the commands and outputs of Steps 2 to 4 for the pull request's description, with the limits the spec's "Testing" names (no Developer ID, no screenshot). A step whose expectation fails is a finding to fix in its owning task, not to work around here.

### Task 6: Bas's key turns the updater on

Blocked until Bas has sent the public key and confirmed that the secret `SPARKLE_ED_PRIVATE_KEY` is set (the spec's "Keys and secrets"). Every other task is independent of it.

**Files:**
- Modify: `ios/App/App.xcodeproj/project.pbxproj`, `scripts/build-macos-app.sh`, `src/app/native/macCatalystUpdater.test.ts`, `src/app/native/macCatalystRelease.test.ts`

- [ ] **Step 1: Failing tests.** `macCatalystUpdater.test.ts`: `App`'s Release configuration has `MINDROOM_UPDATE_FEED_URL` equal to the feed of Global Constraints and a `MINDROOM_UPDATE_PUBLIC_KEY` that matches `/^[A-Za-z0-9+/]{43}=$/`; its Debug configuration and every other target have neither. `macCatalystRelease.test.ts`: an unsigned run with `TEST_FAIL: 'plutil:-extract'` exits 9 before `dmgbuild`; a run whose archived app lacks `Contents/PlugIns/MindRoomMacUpdater.bundle/Contents/Frameworks/Sparkle.framework` fails before `dmgbuild` (the fixture's archived app gains that folder for the passing tests).
- [ ] **Step 2: The project.** Both settings in `App`'s Release configuration, the key exactly as Bas sent it.
- [ ] **Step 3: `scripts/build-macos-app.sh`:** a function that takes an app and fails unless that folder exists and `plutil -extract SUPublicEDKey raw -o - "$app/Contents/Info.plist"` succeeds; called on the archived app before the unsigned `pack_dmg` and on the exported app before the helpers' check. Comment: every Mac build of this script carries the updater, so a pull request proves the embed and the keys.
- [ ] **Step 4: Run** `just typecheck`, `just strict`, `NODE_OPTIONS=--max-old-space-size=6144 just lint`, `just test`: clean and PASS.
- [ ] **Step 5: Commit:** `feat(macos): turn the updater on for release builds`. On the pull request, the **Mac app** workflow must pass: it archives the Store app (preflight: no updater) and the unsigned Release app (the check of Step 3).

## After the merge (Bas)

1. The first release's **Mac app** run is the final check of signing and notarization. If it fails, that release has no DMG and nothing was published: fix by the spec's "Signing" fallback, or revert.
2. Install that release's DMG by hand once (the bootstrap), open it, and wait for the next release: the card appears within about an hour of its DMG; Reload opens the new version.
3. Follow-up in `mindroom-ai/homebrew-tap`: `auto_updates true`.
