# Linux Electron Desktop App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development (four focused tasks with clear interfaces across Electron main/renderer, packaging, feed/manifests, and CI; fresh Gemini 4 Neon `xhigh` implementers keep context crisp and avoid regressions across macOS and Linux).

**Goal:** Build, test, package, and release the Linux Electron desktop version of MindRoom Chat (`AppImage` and `.deb` for `x64` and `arm64`) with native Linux chrome, AppImage-only auto-updates via `linux-feed`, and Linux PR E2E + packaging verification.

**Architecture:** Gate macOS-only window chrome (`titleBarStyle: 'hidden'`, traffic lights, 28 px top inset, drag strip, Quick Capture vibrancy) behind explicit preload flags so Linux renders with native window frames, an auto-hiding `File/Edit/View/Window/Help` menu bar, an opaque draggable Quick Capture window, and clean shutdown when closing the main window. Move macOS `extraResources` and `publish` under `mac:`, add `linux` packaging + `linux-feed` update manifests/publisher, and wire independent macOS and Linux tracks in `.github/workflows/desktop.yml`.

**Tech Stack:** Electron 45.4.1, electron-builder 26.18.0, electron-updater 6.8.11, TypeScript (strict), React 19, Vanilla Extract, Vitest, Playwright Electron, GitHub Actions (`ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-26`).

**Spec:** `docs/baspowers/specs/2026-11-25-linux-electron-design.md`

## Global Constraints

- No em dashes (U+2014) in docs, comments, or commit messages (`AGENTS.md`).
- Unsigned commits (`git -c commit.gpgsign=false commit`) with `Assisted-by: MindRoom <display name>:<model id> <https://github.com/mindroom-ai/mindroom>` trailer; add files by explicit path, never `git add -A`.
- Strict TypeScript (`just typecheck`, `just strict`), type-aware ESLint (`just lint`), Vitest (`just test`), and license check (`just license-check`) must pass with 0 errors.
- Keep macOS packaging, signing/notarization, `mac-feed`, Homebrew tap dispatch, and `"Electron shell e2e (macOS)"` job name unchanged.
- Never instantiate `DebUpdater` on `.deb` installs; never register `matrix:` or custom URL schemes (`CFBundleURLTypes` / `MimeType`) in this PR.
- Soft size discipline: reuse existing primitives and scripts; keep tests focused on real invariants and user flows (~1:1 test:prod ratio).

## Review Focus

- `.deb` installed in an environment that inherits `APPIMAGE=/some/path` must still report `isUpdaterSupported(...) === false` because `resources/package-type` exists.
- Closing the main window on Linux after opening and hiding Quick Capture must exit the Electron process cleanly instead of hanging as a zombie, while `will-prevent-unload` can still cancel closing.
- Linux Quick Capture (`!vibrancy`) must NOT get `background-color: transparent !important`, and its header must allow dragging while keeping `RoomButton` clickable (`no-drag`).
- `scripts/macos-publish-appcast.sh --linux <tag>` must recover cleanly when one of the two Linux feed manifests (`latest-linux.yml` vs `latest-linux-arm64.yml`) landed on a prior partial failure and the job is re-run.
- `electron/builder.config.cjs` must pass real `app-builder-lib` `validateConfiguration` in both unsigned and signed modes with `mac.extraResources`, `mac.publish`, `linux.publish`, `appImage`, and `deb`.

---

### Task 1: Linux Electron Shell, Menu, Updater Gate, and Renderer Chrome

**Files:**
- Modify: `electron/build.mjs`
- Modify: `electron/preload.ts`
- Modify: `electron/main/index.ts`
- Modify: `electron/main/mainWindow.ts`
- Modify: `electron/main/menu.ts`
- Modify: `electron/main/quickCapture.ts`
- Modify: `electron/main/updater.ts`
- Modify: `src/app/lib/desktopBridge.ts`
- Modify: `src/app/lib/nativeShell.ts`
- Modify: `src/app/shell/App.tsx`
- Modify: `src/index.css`
- Modify: `src/app/quick-capture/QuickCapturePage.tsx`
- Modify: `src/app/quick-capture/QuickCapturePage.css.ts`
- Test: `electron/main/menu.test.ts`
- Test: `electron/main/updater.test.ts`
- Test: `src/app/lib/nativeShell.test.ts`
- Test: `src/index.test.ts`
- Test: `src/app/quick-capture/QuickCapturePage.test.tsx`

**Interfaces:**
- Produces:
  - `DesktopBridge.customTitlebar?: boolean` (`src/app/lib/desktopBridge.ts`, `electron/preload.ts`)
  - `DesktopQuickCaptureBridge.vibrancy?: boolean` (`src/app/lib/desktopBridge.ts`, `electron/preload.ts`)
  - `hasCustomTitlebar(): boolean` (`src/app/lib/nativeShell.ts`)
  - `buildMenuTemplate(state: MenuState, handlers?: MenuHandlers, platform?: NodeJS.Platform): Electron.MenuItemConstructorOptions[]` (`electron/main/menu.ts`)
  - `isUpdaterSupported(options: { isPackaged: boolean; platform: NodeJS.Platform; appImageEnv?: string; resourcesPath?: string; existsSync?: (p: string) => boolean }): boolean` (`electron/main/updater.ts`)
  - Bundled icon at `build/electron/icon.png` copied by `electron/build.mjs`

- [ ] **Step 1: Write unit tests for Linux menu, `isUpdaterSupported`, `customTitlebar`, and Quick Capture `data-vibrancy`**
  - `electron/main/menu.test.ts`: assert `platform: 'linux'` produces top labels `['File', 'Edit', 'View', 'Window', 'Help']`, puts `Check for Updates...` / `Restart to Update` in `Help`, omits macOS-only roles (`services`, `hide`, `hideOthers`, `unhide`, `zoom`, `front`) and forbidden roles, keeps `Zoom In/Out/Actual Size` in `View` and `Quick Capture` in `Window`, and has clean separators.
  - `electron/main/updater.test.ts`: test `isUpdaterSupported` returns `true` for packaged `darwin` and packaged `linux` with `APPIMAGE` and no `package-type` file; `false` for unpackaged, `linux` without `APPIMAGE`, `linux` with `package-type` present even when `APPIMAGE` is set, and `win32`.
  - `src/app/lib/nativeShell.test.ts` + `src/index.test.ts`: test `hasCustomTitlebar()` and `markDesktopShell()` setting/removing `data-custom-titlebar` according to `bridge.customTitlebar`.
  - `src/app/quick-capture/QuickCapturePage.test.tsx`: assert `data-vibrancy` is present when `quickCapture.vibrancy` is `true` and absent when `false` or omitted.

- [ ] **Step 2: Implement shell, preload, and renderer changes**
  - `electron/build.mjs`: copy `ios/App/App/Assets.xcassets/AppIcon.appiconset/Icon-Mac-512x512@2x.png` to `build/electron/icon.png`.
  - `electron/main/mainWindow.ts`: gate `titleBarStyle: 'hidden'`, `trafficLightPosition`, and `--mindroom-custom-titlebar=1` on `process.platform === 'darwin'`; on non-darwin set `autoHideMenuBar: true` and `icon: path.join(__dirname, 'icon.png')` (if it exists); in `win.on('closed')`, if `process.platform !== 'darwin' && !quitting`, call `app.quit()`.
  - `electron/main/quickCapture.ts`: on `darwin` keep `transparent: true`, `type: 'panel'`, `vibrancy: 'popover'`, and `--mindroom-quick-capture-vibrancy=1`; on non-darwin set `transparent: false`, `backgroundColor: '#1A1A1A'`, and `icon` (if present).
  - `electron/main/menu.ts`: add `platform: NodeJS.Platform = process.platform` parameter to `buildMenuTemplate`, returning standard `File / Edit / View / Window / Help` on non-darwin and unchanged macOS menu on darwin.
  - `electron/main/updater.ts` & `electron/main/index.ts`: add `isUpdaterSupported` and use it for both `configureMainWindow({ updater })` and `if (updaterSupported) updater = startUpdater(...)`; pass `process.platform` to `buildMenuTemplate`; call `if (process.platform === 'linux') app.setDesktopName('mindroom-chat.desktop')` before `app.whenReady()` (guarded by `typeof app.setDesktopName === 'function'`).
  - `electron/preload.ts`, `src/app/lib/desktopBridge.ts`, `src/app/lib/nativeShell.ts`, `src/app/shell/App.tsx`, `src/index.css`: wire `customTitlebar`, `hasCustomTitlebar()`, `data-custom-titlebar`, and scope the 28 px inset + drag strip + portal no-drag CSS to `html[data-shell='desktop'][data-custom-titlebar]`.
  - `src/app/quick-capture/QuickCapturePage.tsx` & `QuickCapturePage.css.ts`: wire `vibrancy` / `data-vibrancy`, scope transparent background override to `[data-vibrancy]`, add draggable `Header` + `no-drag` `RoomButton` in native Quick Capture.

- [ ] **Step 3: Run targeted tests, typecheck, and lint; commit**

---

### Task 2: Linux Packaging Config, Build/Verify Script, and Update Manifests

**Files:**
- Modify: `package.json`
- Modify: `electron/builder.config.cjs`
- Create: `scripts/build-linux-desktop.sh`
- Modify: `scripts/desktop-latest-yml.mjs`
- Modify: `scripts/macos-publish-appcast.sh`
- Test: `scripts/desktop-latest-yml.test.ts`
- Test: `src/app/native/macPublishAppcast.test.ts`
- Test: `src/app/native/desktopBuildConfig.test.ts`

**Interfaces:**
- Produces:
  - `scripts/build-linux-desktop.sh --arch <x64|arm64> [--skip-web-build]`
  - `buildLinuxLatestYml({ version, releaseDate, repository, arch, file })` and CLI `--platform linux --arch <x64|arm64> --file <path> --out <path>` in `scripts/desktop-latest-yml.mjs`
  - `scripts/macos-publish-appcast.sh --linux <tag>` publishing `latest-linux.yml` and `latest-linux-arm64.yml` to `linux-feed`

- [ ] **Step 1: Update and add unit tests**
  - `scripts/desktop-latest-yml.test.ts`: test `buildLinuxLatestYml` and CLI `--platform linux` for `x64` (`MindRoom-Chat-x86_64.AppImage`) and `arm64` (`MindRoom-Chat-arm64.AppImage`) including embedded `blockMapSize`, rejecting wrong arch/filename/version and missing/corrupt embedded blockmaps.
  - `src/app/native/macPublishAppcast.test.ts`: test `--linux <tag>` creating/updating `linux-feed` with both `latest-linux.yml` and `latest-linux-arm64.yml`, enforcing all 6 Linux assets and positive integer `blockMapSize`, honoring `PAUSED`, refusing downgrade, and repairing a half-published `linux-feed`.
  - `src/app/native/desktopBuildConfig.test.ts`: update `builder.config.cjs` assertions for `mac.extraResources`, `mac.publish`, `linux` (`executableName`, `maintainer`, `vendor`, `desktop`, `publish`, `target`), `appImage`, `deb`, `extraMetadata.desktopName`, and real `validateConfiguration` schema pass.

- [ ] **Step 2: Implement packaging config, build script, manifest generator, and feed publisher**
  - `package.json`: add `"homepage": "https://github.com/mindroom-ai/mindroom-chat"`.
  - `electron/builder.config.cjs`: move `extraResources` and `publish` under `mac:`; add `extraMetadata.desktopName: 'mindroom-chat.desktop'`, `linux`, `appImage` (with `executableArgs: []` to preserve Chromium sandboxing), and `deb`.
  - `scripts/build-linux-desktop.sh`: build & verify `AppImage` (validating its embedded blockmap trailer at EOF) and `.deb` for `--arch x64|arm64`, inspect `.deb` (`dpkg-deb -I/-c`: `.desktop` with `StartupWMClass=mindroom-chat`, `apparmor-profile`, `resources/package-type` = `deb`, zero macOS binaries), inspect extracted `AppImage` (`mindroom-chat.desktop` with `StartupWMClass=mindroom-chat`, `Name=MindRoom Chat`, and no `--no-sandbox`; `resources/app-update.yml` points to `linux-feed`, no `package-type`, zero macOS binaries), and smoke-launch the extracted packaged binary under `xvfb-run` (verifying it starts cleanly with fuses + ASAR).
  - `scripts/desktop-latest-yml.mjs`: add `buildLinuxLatestYml` and `--platform linux` CLI mode while keeping existing macOS behavior unchanged.
  - `scripts/macos-publish-appcast.sh`: add `--linux` mode targeting `linux-feed` with per-asset monotonic CalVer + retry/readback + curl check.

- [ ] **Step 3: Run unit tests, `bash -n`, typecheck, and lint; commit**

---

### Task 3: Electron E2E Updates, CI/Release Workflow, and Docs

**Files:**
- Modify: `e2e/electron/shell.spec.ts`
- Modify: `e2e/electron/menus.spec.ts`
- Modify: `e2e/electron/quick-capture.spec.ts`
- Modify: `.github/workflows/desktop.yml`
- Modify: `.github/workflows/release.yml`
- Modify: `src/app/native/desktopBuildConfig.test.ts`
- Modify: `docs/ios-release.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `scripts/build-linux-desktop.sh`, `scripts/desktop-latest-yml.mjs --platform linux`, `scripts/macos-publish-appcast.sh --linux`
- Produces: PR Linux E2E + packaging check and independent macOS/Linux release + feed jobs in `.github/workflows/desktop.yml`

- [ ] **Step 1: Update Electron E2E specs for cross-platform macOS + Linux verification**
  - `e2e/electron/shell.spec.ts`: assert `28px` titlebar inset + `[data-titlebar-drag]` + fullscreen toggle on `darwin`, and `0px` top inset + absent `[data-titlebar-drag]` on `linux`.
  - `e2e/electron/menus.spec.ts`: assert `File` on Linux vs `MindRoom` on macOS while keeping all zoom and forbidden-role checks.
  - `e2e/electron/quick-capture.spec.ts`: assert Linux Quick Capture omits `data-vibrancy` and has a non-transparent computed background, and add the Linux zombie-on-close regression test (open Quick Capture, hide it, close main window, verify process exits cleanly).

- [ ] **Step 2: Update `.github/workflows/desktop.yml`, `.github/workflows/release.yml`, workflow tests, and docs**
  - `.github/workflows/desktop.yml`:
    - Add `e2e-linux` (`Electron shell e2e (Linux)`) on `ubuntu-24.04` running offline Electron E2E under `xvfb-run` + `scripts/build-linux-desktop.sh --arch x64 --skip-web-build`.
    - Add optional `workflow_dispatch` `platform` input (`all`, `mac`, `linux`, default `all`).
    - Keep `release` and `feed` jobs for macOS (skipping cleanly with `skipped=true` when all 6 Mac assets are already uploaded on `workflow_dispatch`); add independent `build-linux` (`ubuntu-24.04` x64 + `ubuntu-24.04-arm` arm64, generating `latest-linux*.yml` with `blockMapSize`) -> `release-linux` (attaches all 6 Linux assets atomically without `--clobber`, skipping cleanly with `skipped=true` when already complete on `workflow_dispatch`) -> `feed-linux` (`concurrency: { group: linux-desktop-feed, queue: max }`, gated on `needs.release-linux.outputs.skipped != 'true'`).
    - Update `pull_request.paths` with new Linux scripts/files.
  - `.github/workflows/release.yml`: update `macos` job display name/comment to reflect publishing both macOS and Linux desktop apps (keep job id compatible or update `desktopBuildConfig.test.ts`).
  - `src/app/native/desktopBuildConfig.test.ts`: assert both macOS and Linux workflow wiring and guards.
  - `docs/ios-release.md` and `README.md`: document Linux AppImage/`.deb` releases, `linux-feed`, rollout pause runbook for `linux-feed`, and Linux platform support.

- [ ] **Step 3: Run full validation (`just typecheck`, `just strict`, `just lint`, unit tests, build, Electron E2E on Linux and macOS, screenshots); commit**
