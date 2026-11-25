# Linux Electron Desktop App Design

Date: 2026-11-25
Status: Approved (Bas Nijholt)

## Overview

Add first-class Linux desktop support to `mindroom-chat`'s Electron shell (`electron/`), matching the existing macOS Electron architecture while using native Linux window chrome, packaging `AppImage` and `.deb` artifacts for `x64` and `arm64`, enabling AppImage-only auto-updates via a dedicated `linux-feed` prerelease, and wiring Linux E2E, packaging verification, and releases into `.github/workflows/desktop.yml`.

## Scope and Non-Goals

In scope:
- Native Linux window chrome, icon, auto-hiding menu bar, and platform-appropriate application menu.
- Fixing Linux runtime defects found during audit: macOS-only top inset and drag strip leaking onto Linux, hidden auxiliary windows preventing app exit on Linux main-window close, and Quick Capture rendering transparent without macOS vibrancy.
- Packaging `AppImage` and `.deb` for both `x64` and `arm64` via `electron-builder` 26.18.0.
- AppImage-only auto-updates via a dedicated `linux-feed` prerelease (`latest-linux.yml` and `latest-linux-arm64.yml`), with `.deb` updates hard-disabled.
- PR E2E (`ubuntu-24.04` + Xvfb), PR Linux packaging smoke test (verifying `.deb` metadata, AppArmor profile, no macOS binaries, and packaged app boot), and independent macOS/Linux release and feed jobs in `.github/workflows/desktop.yml`.
- Updating `README.md`, `docs/ios-release.md`, and `desktopBuildConfig.test.ts` / `macPublishAppcast.test.ts` / `desktop-latest-yml.test.ts`.

Explicitly deferred (out of scope for this PR):
- `matrix:` / custom URL scheme deep links (will be designed and shipped cross-platform for both macOS and Linux together in a follow-up PR).
- Linux screen sharing in MatrixRTC calls (`supportsSystemScreenShare` stays `false` on Linux until Wayland PipeWire portal + X11 picker support is built; audio/video calls and voice recording already work via Chromium).
- Linux Computer Access / desktop helper (`desktopAccess` already reports `unsupported_platform` cleanly on Linux).
- `.tar.gz`, `.rpm`, Flatpak, or Snap packaging.

## Architecture and Decisions

### 1. Window Chrome, Insets, and Icons

- **Main window (`electron/main/mainWindow.ts`):**
  - Only pass `titleBarStyle: 'hidden'` and `trafficLightPosition: { x: 12, y: 8 }` when `process.platform === 'darwin'`.
  - On non-macOS (`process.platform !== 'darwin'`), use the native window frame, set `autoHideMenuBar: true` (Alt reveals the menu bar; keyboard shortcuts continue to fire), and pass `icon` pointing at the bundled PNG icon (`build/electron/icon.png` inside `app.asar`).
  - Pass `--mindroom-custom-titlebar=1` in `webPreferences.additionalArguments` only on `darwin`.
  - On `win.on('closed', ...)`: when `process.platform !== 'darwin' && !quitting`, call `app.quit()`. Calling `app.quit()` on `closed` (not `close`) preserves `will-prevent-unload` cancellation while ensuring hidden auxiliary windows (`quickCapture`, `shellApprovalWindow`) never trap the process as a headless zombie after the main window closes.
- **Desktop identity (`electron/main/index.ts`, `electron/build.mjs`, `electron/builder.config.cjs`):**
  - Copy `ios/App/App/Assets.xcassets/AppIcon.appiconset/Icon-Mac-512x512@2x.png` to `build/electron/icon.png` during `electron/build.mjs` so both dev and packaged `app.asar` have the icon available for `BrowserWindow({ icon })`.
  - Set `linux.executableName: 'mindroom-chat'`, `extraMetadata.desktopName: 'mindroom-chat.desktop'`, and `linux.desktop.entry.StartupWMClass: 'mindroom-chat'` so Wayland `app_id`, X11 `WM_CLASS`, and `.desktop` launcher integration match.
  - Keep `extraMetadata.productName: 'MindRoom Chat'` so `.deb` and `AppImage` share the same `userData` directory (`~/.config/MindRoom Chat`) and preserve Matrix sessions and Rust crypto storage when switching formats.
- **Renderer chrome (`electron/preload.ts`, `src/app/lib/desktopBridge.ts`, `src/app/lib/nativeShell.ts`, `src/app/shell/App.tsx`, `src/index.css`):**
  - Add `customTitlebar?: boolean` to `DesktopBridge` (exposed as `process.argv.includes('--mindroom-custom-titlebar=1')` in `electron/preload.ts`).
  - Add `hasCustomTitlebar(): boolean` in `src/app/lib/nativeShell.ts`.
  - In `markDesktopShell()`: set `data-shell="desktop"`, and toggle `data-custom-titlebar` on `<html>` based on `Boolean(bridge.customTitlebar)`.
  - Scope the 28 px top inset, drag strip, and portal no-drag overrides in `src/index.css` to `html[data-shell='desktop'][data-custom-titlebar]`.
  - Render `<div data-titlebar-drag="" aria-hidden="true" />` in `src/app/shell/App.tsx` only when `hasCustomTitlebar()` is true.

### 2. Quick Capture on Linux

- **Window (`electron/main/quickCapture.ts`):**
  - On `darwin`: keep `transparent: true`, `type: 'panel'`, `vibrancy: 'popover'`, and pass `--mindroom-quick-capture-vibrancy=1` in `webPreferences.additionalArguments`.
  - On non-`darwin`: set `transparent: false`, `backgroundColor: '#1A1A1A'`, omit `type`/`vibrancy`, pass `icon`, and do not pass `--mindroom-quick-capture-vibrancy=1`.
- **Bridge and styles (`electron/preload.ts`, `src/app/lib/desktopBridge.ts`, `src/app/quick-capture/QuickCapturePage.tsx`, `src/app/quick-capture/QuickCapturePage.css.ts`):**
  - Add `vibrancy?: boolean` on `DesktopQuickCaptureBridge` (`process.argv.includes('--mindroom-quick-capture-vibrancy=1')`).
  - Set `data-vibrancy={vibrancy || undefined}` on the root element in `QuickCapturePage.tsx`.
  - Scope the `backgroundColor: 'transparent !important'` rule in `QuickCapturePage.css.ts` to `[data-vibrancy]` instead of `[data-native]`, keeping `fontSize: '100% !important'` and `--app-inset-top: 0px` on `[data-native]`.
  - Make `Header` draggable (`WebkitAppRegion: 'drag'`) in native Quick Capture, with `WebkitAppRegion: 'no-drag'` on `RoomButton` so Linux users can reposition the frameless Quick Capture window.

### 3. Application Menu (`electron/main/menu.ts`)

- Parameterize `buildMenuTemplate(state, handlers, platform = process.platform)`.
- On `darwin`: preserve the existing `MindRoom / Edit / View / Window / Help` structure unchanged.
- On non-`darwin` (Linux): build standard `File / Edit / View / Window / Help`:
  - `File`: `{ role: 'close' }`, separator, `{ role: 'quit' }`.
  - `Edit`: `undo`, `redo`, separator, `cut`, `copy`, `paste`, `pasteAndMatchStyle`, `delete`, `selectAll`.
  - `View`: `Zoom In` (`CommandOrControl+Plus`), `Zoom Out` (`CommandOrControl+-`), `Actual Size` (`CommandOrControl+0`), separator, `togglefullscreen`.
  - `Window`: optional `Quick Capture` (`Control+Alt+Space`, keeping it reachable when Wayland blocks global shortcuts), separator, `minimize`, `close` (no macOS-only `zoom` or `front`).
  - `Help`: optional `Restart to Update` or `Check for Updates...` when enabled, separator, `{ role: 'about' }`.

### 4. Auto-Updater on Linux (`electron/main/updater.ts`, `electron/main/index.ts`, `electron/builder.config.cjs`)

- Add a pure helper `isUpdaterSupported({ isPackaged, platform, appImageEnv, resourcesPath, existsSync })` in `electron/main/updater.ts`:
  - Returns `false` if `!isPackaged`.
  - Returns `true` on `darwin`.
  - On `linux`: returns `true` only when `Boolean(appImageEnv?.trim())` AND `path.join(resourcesPath, 'package-type')` does NOT exist.
  - Returns `false` on all other platforms or install types (including `.deb`, even if `APPIMAGE` happens to be inherited in the environment).
- In `electron/main/index.ts`, gate BOTH `configureMainWindow({ updater })` and `startUpdater(...)` on `isUpdaterSupported(...)`. This ensures `.deb` installs never instantiate `DebUpdater` (which invokes `sudo dpkg -i` / `apt --allow-unauthenticated`) and never expose broken update UI in Settings > About or the menu.
- In `electron/builder.config.cjs`:
  - Move top-level `publish` into platform-specific `mac.publish` (`mac-feed`) and `linux.publish` (`linux-feed`), both with `provider: 'generic'` and `useMultipleRangeRequest: false`.
  - Keep `mac-feed` completely unchanged for existing macOS installations.

### 5. Packaging Configuration (`electron/builder.config.cjs`, `package.json`, `scripts/build-linux-desktop.sh`)

- Move `extraResources` (`mindroom-screenshot-helper`, `mindroom-trackpad-swipe.node`) from top-level under `mac:`.
- Add `"homepage": "https://github.com/mindroom-ai/mindroom-chat"` to `package.json` (and `linux.maintainer: 'MindRoom <support@mindroom.chat>'` and `linux.vendor: 'MindRoom'` in `electron/builder.config.cjs`) so `FpmTarget` builds `.deb` cleanly without warnings or errors.
- Add `linux` configuration in `electron/builder.config.cjs`:
  - `executableName: 'mindroom-chat'`
  - `icon: 'ios/App/App/Assets.xcassets/AppIcon.appiconset/Icon-Mac-512x512@2x.png'`
  - `category: 'Network'`
  - `maintainer: 'MindRoom <support@mindroom.chat>'`
  - `vendor: 'MindRoom'`
  - `desktop`: `{ entry: { Name: 'MindRoom Chat', Comment: 'Open-source Matrix client for MindRoom', Categories: 'Network;InstantMessaging;Chat;', StartupWMClass: 'mindroom-chat' } }`
  - `target`: `['AppImage', 'deb']`
  - `publish`: `{ provider: 'generic', url: 'https://github.com/mindroom-ai/mindroom-chat/releases/download/linux-feed', useMultipleRangeRequest: false }`
- Add `appImage: { artifactName: 'MindRoom-Chat-${arch}.AppImage' }` and `deb: { artifactName: 'MindRoom-Chat-${arch}.deb' }`. In `electron-builder` 26.18.0 (`getArtifactArchName`), `${arch}` expands deterministically to `x86_64` / `arm64` for `AppImage` and `amd64` / `arm64` for `deb`, producing `MindRoom-Chat-x86_64.AppImage`, `MindRoom-Chat-arm64.AppImage`, `MindRoom-Chat-amd64.deb`, and `MindRoom-Chat-arm64.deb`. `scripts/build-linux-desktop.sh` pins `--x64` / `--arm64` and verifies these exact filenames fail-closed.
- Keep `electronFuses` at top level (`runAsNode: false`, `enableCookieEncryption: true`, `enableNodeOptionsEnvironmentVariable: false`, `enableNodeCliInspectArguments: false`, `enableEmbeddedAsarIntegrityValidation: true`, `onlyLoadAppFromAsar: true`, `grantFileProtocolExtraPrivileges: false`, `resetAdHocDarwinSignature: !sign`). Verify packaged Linux launch in CI proves fuses + ASAR boot cleanly.
- Create `scripts/build-linux-desktop.sh`:
  - Supports `--arch <x64|arm64>` and optional `--verify-only` / `--skip-web-build`.
  - Runs `npm run build:desktop` (unless skipped), runs `npx electron-builder --linux AppImage deb --<arch> --config electron/builder.config.cjs --publish never`, verifies the `.AppImage`, `.AppImage.blockmap`, and `.deb` exist and are non-empty.
  - Verifies `.deb` contents with `dpkg-deb`: contains `.desktop` entry with `StartupWMClass=mindroom-chat`, contains AppArmor profile under `resources/apparmor-profile` (or `/etc/apparmor.d`), contains `resources/package-type` with `deb`, and contains NO macOS binaries (`mindroom-screenshot-helper`, `mindroom-trackpad-swipe.node`, `MindRoom Desktop Helper.app`).
  - Verifies `AppImage` extracted resources: `app-update.yml` points to `linux-feed`, contains NO `resources/package-type`, and contains NO macOS binaries.
  - Smoke-launches the extracted packaged binary under `xvfb-run` (with `--no-sandbox` in container/CI if needed) and verifies it boots without crashing.

### 6. Update Manifests and Feed Publisher (`scripts/desktop-latest-yml.mjs`, `scripts/macos-publish-appcast.sh`)

- Extend `scripts/desktop-latest-yml.mjs`:
  - Keep existing macOS CLI (`--version`, `--repo`, `--arm64`, `--x64`, `--out`) and `buildDesktopLatestYml(...)` 100% backwards-compatible.
  - Add `buildLinuxLatestYml({ version, releaseDate, repository, arch, file })` and CLI `--platform linux --arch <x64|arm64> --file <AppImage> --out <path>` generating `latest-linux.yml` (for `x64`, referencing `MindRoom-Chat-x86_64.AppImage`) and `latest-linux-arm64.yml` (for `arm64`, referencing `MindRoom-Chat-arm64.AppImage`) with absolute `https://github.com/<repo>/releases/download/v<version>/<filename>` URLs, SHA-512, and size.
- Extend `scripts/macos-publish-appcast.sh` with `--linux <tag>` mode (keeping `--desktop <tag>` for macOS untouched):
  - Targets feed prerelease `linux-feed`, requires all 8 Linux release assets (`MindRoom-Chat-x86_64.AppImage`, `MindRoom-Chat-x86_64.AppImage.blockmap`, `MindRoom-Chat-amd64.deb`, `MindRoom-Chat-arm64.AppImage`, `MindRoom-Chat-arm64.AppImage.blockmap`, `MindRoom-Chat-arm64.deb`, `latest-linux.yml`, `latest-linux-arm64.yml`).
  - Validates both `latest-linux.yml` and `latest-linux-arm64.yml` match `${tag#v}` and point to the exact `v<version>` AppImage URLs.
  - Honors `PAUSED` marker on `linux-feed`, checks monotonic CalVer per feed asset (self-healing if one asset landed before a prior failure), uploads with `--clobber` retry + readback + `curl` verification.

### 7. CI and Release Workflow (`.github/workflows/desktop.yml`, `.github/workflows/release.yml`)

- **PR checks (`pull_request`):**
  - Keep existing `e2e` job name `"Electron shell e2e (macOS)"` intact (for branch protection).
  - Add `e2e-linux` (`"Electron shell e2e (Linux)"`) on `ubuntu-24.04`: runs `npm run build:desktop`, runs `xvfb-run --auto-servernum --server-args="-screen 0 1280x800x24" env MINDROOM_E2E_NO_SANDBOX=1 npm run e2e:desktop -- --grep-invert @homeserver`, and runs `scripts/build-linux-desktop.sh --arch x64 --skip-web-build` (packaging + `.deb`/`AppImage` verification + packaged boot smoke test).
  - Add new Linux files (`scripts/build-linux-desktop.sh`, `src/app/quick-capture/QuickCapturePage.css.ts`, `src/app/quick-capture/QuickCapturePage.tsx`) to `pull_request.paths`.
- **Release jobs (independent tracks):**
  - Add optional `workflow_dispatch` input `platform` (`all` | `mac` | `linux`, default `all`).
  - Keep macOS `release` and `feed` jobs running independently (guarded by `inputs.platform != 'linux'`). Skip gracefully (exit 0, `skipped=true`) instead of failing if Mac artifacts already exist during a backfill.
  - Add Linux track (guarded by `inputs.platform != 'mac'`):
    - `build-linux` (matrix: `{ arch: x64, runner: ubuntu-24.04 }`, `{ arch: arm64, runner: ubuntu-24.04-arm }`, `permissions: contents: read`): checks release is published and lacks Linux assets, runs `scripts/build-linux-desktop.sh --arch ${{ matrix.arch }}` with `MARKETING_VERSION`, uploads arch outputs as workflow artifact.
    - `release-linux` (`ubuntu-24.04`, `needs: build-linux`, `permissions: contents: write`): downloads both arch artifacts, generates `latest-linux.yml` and `latest-linux-arm64.yml` via `scripts/desktop-latest-yml.mjs`, verifies release still lacks Linux assets, and attaches all 8 Linux assets in one `gh release upload` call (no `--clobber`).
    - `feed-linux` (`ubuntu-24.04`, `needs: release-linux`, `concurrency: { group: linux-desktop-feed, queue: max }`, `permissions: contents: write`): runs `scripts/macos-publish-appcast.sh --linux "$RELEASE_TAG"`.
  - Update `.github/workflows/release.yml` job label/comment from "Publish the Mac app" to "Publish desktop apps" (keeping the `macos` job id or updating `desktopBuildConfig.test.ts` cleanly).

## Testing Strategy

- **Unit tests:**
  - `electron/main/menu.test.ts`: test Linux (`platform: 'linux'`) vs macOS (`platform: 'darwin'`) menu structures, update items in Help on Linux, no forbidden roles or macOS-only roles on Linux, no adjacent/leading/trailing separators.
  - `electron/main/updater.test.ts`: test `isUpdaterSupported` across darwin, linux AppImage, linux `.deb` (with and without `APPIMAGE` env var), unpackaged, and win32.
  - `src/app/lib/nativeShell.test.ts` and `src/index.test.ts`: test `hasCustomTitlebar()` and `data-custom-titlebar` attribute toggling.
  - `src/app/quick-capture/QuickCapturePage.test.tsx`: test `data-vibrancy` set only when `quickCapture.vibrancy` is true.
  - `scripts/desktop-latest-yml.test.ts`: test `buildLinuxLatestYml` and `--platform linux` CLI for `x64` and `arm64`.
  - `src/app/native/macPublishAppcast.test.ts`: test `--linux` mode (`linux-feed`, 8 required assets, both YAML manifests, `PAUSED`, monotonic upgrade, partial-upload repair).
  - `src/app/native/desktopBuildConfig.test.ts`: test `builder.config.cjs` schema validation with `linux` + per-platform `publish` + `mac.extraResources`, Linux workflow wiring (`e2e-linux`, `build-linux`, `release-linux`, `feed-linux`).
- **Electron E2E (`e2e/electron/`):**
  - `e2e/electron/shell.spec.ts`: assert `28px` titlebar inset + drag strip on `darwin`, and `0px` top inset + no `[data-titlebar-drag]` on `linux`.
  - `e2e/electron/quick-capture.spec.ts`: assert Linux Quick Capture has opaque background (`!data-vibrancy`) AND regression test that opening Quick Capture, hiding it, and closing the main window exits the app cleanly on Linux without hanging.
  - `e2e/electron/menus.spec.ts`: verify Linux menu (`File / Edit / View / Window / Help`) and zoom shortcuts pass cleanly on Linux without double-stepping.
- **CI Packaging Smoke Test:**
  - Runs on `ubuntu-24.04` (PRs + releases) and `ubuntu-24.04-arm` (releases), validating `.deb` + `AppImage` contents and booting the packaged binary under Xvfb.
