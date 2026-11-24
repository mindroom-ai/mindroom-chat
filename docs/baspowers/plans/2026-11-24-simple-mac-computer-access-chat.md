# Simple Mac Computer Access (MindRoom Chat) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with `baspowers:subagent-driven-development`. Steps use checkbox (`- [ ]`) syntax.

**Execution:** `baspowers:subagent-driven-development` - 6 cleanly separated tasks across packaging, Electron main, Olm protocol/relay, React UI, app wiring, and Playwright Electron e2e/screenshots benefit from fresh `gemini4_neon@xhigh` implementers and independent reviews per task.

**Goal:** Deliver 2-click Mac Computer Access (Full Access + Choose limits...) and Browser-to-Mac Olm pairing relay inside `MindRoom Chat.app` as one clean, self-contained PR on `mindroom-chat`.

**Architecture:** Bundle the signed, notarized `MindRoom Desktop Helper.app` (`arm64`, Team ID `DNA6966LGZ`, identifier `chat.mindroom.desktophelper`) inside `MindRoom Chat.app/Contents/Helpers/` via an `afterPack` hook while keeping `MindRoom-Chat.dmg` universal and keeping `MindRoom-Chat-x64-mac.zip` free of the arm64 helper. Electron main owns helper lifecycle, mode-0600 Full Access consent (`userData/desktop-access-consent.json`), menu-bar Tray kill switch, Login Item toggle, `noteGesture()`-gated IPC, and a non-focus-stealing floating shell-approval window. The renderer (`src/app/desktop-access/`, layered between `account` and `room`) orchestrates Olm to-device pairing (`setup_request.v1` -> `setup_offer.v1` -> `pair` -> `pairing_confirm.v1` -> `pairing_confirmed.v1`), silent MSC3882 login token minting (with SSO fallback), live 1 s Accessibility polling, Screen Recording reuse / 1-click relaunch, Settings -> This Mac, and Browser-to-Mac Olm `pair_invite.v1` relay.

**Tech Stack:** Electron 45, electron-builder 26, TypeScript (strict), React 18, Jotai, `@vanilla-extract/css`, `folds`, `matrix-js-sdk` Rust crypto, Vitest, Playwright Electron.

**Spec:** `~/repos/dev/mindroom/docs/baspowers/specs/2026-11-23-simple-mac-computer-access-design.md` (merged into `mindroom` `main` via PR #4318).

## Global Constraints

- No em dashes in docs, comments, or commit messages (`mindroom-chat` `AGENTS.md`).
- No copyleft code; no new dependencies outside the license allowlist.
- Every TypeScript file (including `electron/**`, `src/**`, `e2e/**`, tests) compiles with 0 errors under `just strict` and `just typecheck` and passes `just lint` (type-aware ESLint, logical CSS sides, `GlassPrimitives`, `directional.tsx`, domain layering in `eslint.config.mjs`).
- Only `src/app/lib/nativeShell.ts` may read `window.mindroomDesktop` directly.
- Never register `CFBundleURLTypes` in `electron/builder.config.cjs` (`src/app/native/desktopBuildConfig.test.ts`).
- Single-writer consent rule: `native_config.json` never stores live `full_control` or `shell_auto_approve` grants. Only `userData/desktop-access-consent.json` (mode `0600`) stores per-controller Full Access consent, written only after main-process `noteGesture()` + IPC validation.
- Every sensitive IPC mutation (`login`, `pair`, `finishSetup`, `updateLimits`, `removeController`, `revokeAll`, `requestPermission`, `relaunch`, `pickFolder`) requires main-process `noteGesture()` from the main window (`desktop:access-decide-shell` is also authorized for the shell approval window).
- Live 2nd-agent pairing never stops an already-running bridge when saved capabilities already cover the requested mode (`upsert_controller` + `pair` + `grant_control`/`grant_shell` run live).
- All 17 `src/app/i18n/locales/additions/*.json` files must contain the exact same key set as `additions/en.json` (`localeAdditions.test.ts`).
- Any module-level Jotai atom must be created with `atom` from `jotai` and cleared in `src/app/shell/accountState.ts` on sign-out (`accountState.test.ts`).
- Every commit uses `git -c commit.gpgsign=false commit` with trailer `Assisted-by: MindRoom DevAgent:<model id> <https://github.com/mindroom-ai/mindroom>`. Never `git add -A` or `git stash`. Never run `env`, `printenv`, or `set`.

## Review Focus

1. **Unconsented controller grant escalation on startup or 2nd-agent pairing:** Main process must re-grant `grant_control`/`grant_shell` ONLY for `controller_key` entries present in `desktop-access-consent.json`, never omitting `controller_key` on grant calls (which would target `controllers[0]`), and never upgrading a restricted controller to Full Access. Pinned by Task 2 tests.
2. **Spoofed Olm pairing or browser relay events:** Both `setup_offer.v1`/`pairing_confirmed.v1` (from an agent) and `pair_invite.v1`/`pair_invite_result.v1`/`pair_invite_confirmed.v1` (from the user's own browser) must verify `encryptionInfo.sender`, device ownership (`deviceSignedByOwner`), and exact `nonce` matching before trusting any field. Pinned by Task 3 tests.
3. **Helper packaging & signature preservation:** `afterPack.cjs` must copy `MindRoom Desktop Helper.app` into `Contents/Helpers/` for `Arch.universal` and final `Arch.arm64` (never `Arch.x64`, never `-arm64-temp`), `mac.signIgnore` must prevent `@electron/osx-sign` from clobbering PyInstaller signatures, and `--sign` must fail closed if the pinned helper is missing or fails SHA-256 / `DNA6966LGZ` verification. Pinned by Task 1 tests.
4. **Cross-account state leakage on sign-out/switch:** `desktopAccessModalAtom` and relay subscriptions must reset cleanly on sign-out so a second account never inherits a pending consent sheet or browser invite. Pinned by Task 3 & Task 5 tests.
5. **Shell approval window safety:** The floating shell approval window must open non-focus-stealing (`showInactive`), enforce a 1 s arming delay on Approve buttons, display control characters/newlines visibly escaped, and reject unauthorized senders. Pinned by Task 2, Task 4, and Task 6 tests.

---

### Task 1: Packaging, Helper Pin, & Build Verification

**Files:**
- Create: `scripts/desktop-helper-pin.json`
- Create: `scripts/fetch-desktop-helper.mjs`
- Create: `electron/afterPack.cjs`
- Modify: `electron/builder.config.cjs`
- Modify: `scripts/build-desktop-app.sh`
- Modify: `.github/workflows/desktop.yml`
- Modify: `src/app/native/desktopBuildConfig.test.ts`

**Interfaces:**
- Produces:
  - `scripts/desktop-helper-pin.json` (`{ repo, tag, asset, sha256, bundleId, teamId }`)
  - `scripts/fetch-desktop-helper.mjs` CLI (`--pin`, `--out`, `--local-app` / `MINDROOM_DESKTOP_HELPER_APP`) + exported `verifyAndExtractHelper`
  - `electron/afterPack.cjs` (`module.exports = async function afterPack(context)`)
  - Staged helper at `build/electron/MindRoom Desktop Helper.app` copied to `<app>/Contents/Helpers/MindRoom Desktop Helper.app` on `arm64` and `universal` builds

- [ ] **Step 1: Add failing tests in `src/app/native/desktopBuildConfig.test.ts`**
  - Assert `electron/builder.config.cjs` sets `afterPack: 'electron/afterPack.cjs'`, `mac.signIgnore` matching `Contents/Helpers/MindRoom Desktop Helper.app`, keeps `MindRoom-Chat.dmg` universal and `CFBundleURLTypes` absent, and still passes real `app-builder-lib` schema validation in both unsigned and signed modes.
  - Test `electron/afterPack.cjs` directly: copies helper for `Arch.arm64` and `Arch.universal`, skips `Arch.x64` and `-arm64-temp` directories, fails closed when `MINDROOM_DESKTOP_SIGN=1` and helper is missing, succeeds silently when `MINDROOM_DESKTOP_SIGN=0` and helper is absent.
  - Test `scripts/fetch-desktop-helper.mjs` SHA-256 verification fails closed on hash mismatch and succeeds on matching tar.gz.
  - Extend `build-desktop-app.sh` fail-closed tests: `--sign` fetches helper, verifies helper signature/team/identifier, and `--verify-only` checks `Contents/Helpers/MindRoom Desktop Helper.app` is present & validly signed in `arm64` ZIP and absent in `x64` ZIP.
- [ ] **Step 2: Run `nix develop --command npx vitest run src/app/native/desktopBuildConfig.test.ts` and verify tests fail**
- [ ] **Step 3: Implement `scripts/desktop-helper-pin.json`, `scripts/fetch-desktop-helper.mjs`, `electron/afterPack.cjs`, and updates to `electron/builder.config.cjs`, `scripts/build-desktop-app.sh`, `.github/workflows/desktop.yml`**
  - Use the published `mindroom` release tag and SHA-256 from `MindRoom-Desktop-Helper-arm64.tar.gz.sha256` (if the release upload is still running during Task 1, wire exact format and update the SHA-256 once `v2026.11.568` finishes).
  - Never alter `homebrew-tap` dispatch, `MindRoom-Chat.dmg` artifact name, or `macos-publish-appcast.sh` requirements.
- [ ] **Step 4: Run `nix develop --command npx vitest run src/app/native/desktopBuildConfig.test.ts` and `just strict` / `just lint` on changed files**
- [ ] **Step 5: Commit Task 1**

---

### Task 2: Electron Main Process - Helper Supervisor, Consent Store, Tray Kill Switch, Login Item, & Shell Approval Window

**Files:**
- Create: `electron/main/desktopAccessConsent.ts`
- Create: `electron/main/desktopAccessConsent.test.ts`
- Create: `electron/main/desktopBridgeProcess.ts`
- Create: `electron/main/desktopBridgeProcess.test.ts`
- Create: `electron/main/desktopAccessTray.ts`
- Create: `electron/main/shellApprovalWindow.ts`
- Create: `electron/main/desktopAccess.ts`
- Create: `electron/main/desktopAccess.test.ts`
- Modify: `src/app/lib/desktopBridge.ts`
- Modify: `src/app/lib/nativeShell.ts`
- Modify: `electron/preload.ts`
- Modify: `electron/main/security.ts`
- Modify: `electron/main/mainWindow.ts`
- Modify: `electron/main/index.ts`

**Interfaces:**
- Consumes: Task 1's bundled `Contents/Helpers/MindRoom Desktop Helper.app/Contents/MacOS/MindRoom Desktop Helper`
- Produces:
  - `DesktopAccessBridge` on `window.mindroomDesktop.desktopAccess` and `desktopBridge()?.desktopAccess` in `src/app/lib/nativeShell.ts`, plus `shellApproval` on `window.mindroomDesktop.shellApproval` (for `/shell-approval/` window):
    - `status(): Promise<DesktopResult<DesktopAccessSnapshot>>`
    - `login(request: DesktopAccessLoginRequest): Promise<DesktopResult<DesktopAccessSnapshot>>`
    - `pair(request: DesktopAccessPairRequest): Promise<DesktopResult<DesktopAccessPairResult>>`
    - `finishSetup(request: DesktopAccessFinishSetupRequest): Promise<DesktopResult<DesktopAccessSnapshot>>`
    - `updateLimits(request: DesktopAccessUpdateLimitsRequest): Promise<DesktopResult<DesktopAccessSnapshot>>`
    - `removeController(controllerKey: string): Promise<DesktopResult<DesktopAccessSnapshot>>`
    - `revokeAll(): Promise<DesktopResult<DesktopAccessSnapshot>>`
    - `requestPermission(permission: 'accessibility' | 'screen_recording'): Promise<DesktopResult<DesktopAccessSnapshot>>`
    - `relaunch(): Promise<DesktopResult<void>>`
    - `listInstalledApps(): Promise<DesktopResult<InstalledMacApp[]>>`
    - `pickFolder(): Promise<DesktopResult<string | null>>`
    - `decideShell(request: DesktopShellDecisionRequest): Promise<DesktopResult<DesktopAccessSnapshot>>`
    - `killShellHandle(handle: string): Promise<DesktopResult<DesktopAccessSnapshot>>`
    - `openSettings?` / `desktop:shell-event` `{ type: 'desktop-access-status' }` and `{ type: 'open-desktop-access-settings' }`
  - `MINDROOM_DESKTOP_HELPER_BIN` env override (unpackaged/test only) for spawning a fake NDJSON helper in unit and Playwright Electron e2e tests.

- [ ] **Step 1: Write failing unit tests for `desktopAccessConsent.ts`, `desktopBridgeProcess.ts`, and `desktopAccess.ts`**
  - Consent store: atomic `0600` writes, corrupt JSON fails closed to empty, per-controller full-access set/clear/revokeAll, `managedLoginItem` tracking.
  - Bridge process: NDJSON framing (`hello`, pushed `status`, `request_id` correlation, error responses, request timeouts, clean `stop()` shutdown, process exit recovery).
  - Desktop access orchestrator:
    - Re-applies `grant_control({until_revoked: true, scope: 'computer', controller_key})` + `grant_shell({until_revoked: true, controller_key})` ONLY for consented `controller_key`s (never omitting `controller_key`, never granting unconsented controllers).
    - Live 2nd-agent pairing skips `stop()`/`start()` when bridge is running and capabilities already satisfy the mode; stops/configures/starts only when capabilities change or bridge is stopped.
    - Rejects sensitive IPC actions with `NO_USER_GESTURE` unless `noteGesture()` ran within 10 s; consumes gesture on sensitive calls.
    - `revokeAll` clears consent, calls `revoke_control` + `revoke_shell` + `stop`, restores login item if we added it.
    - `shell.pending` opens `shellApprovalWindow` with `showInactive()` and closes/hides it when pending clears.
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement Electron main modules, preload, `desktopBridge.ts`, `nativeShell.ts`, `security.ts` (`/shell-approval/`), `mainWindow.ts`, `index.ts`**
  - Keep `desktopAccess.ts` clean and concise (target <= 300 lines; helper modules <= 250 lines each).
  - Scan `/Applications`, `/System/Applications`, `~/Applications` via `plutil -convert json -o -` excluding `MINDROOM_APP_IDS` (`chat.mindroom.app` + Electron helpers, `chat.mindroom.menubar`, `chat.mindroom.desktophelper`).
  - Use `systemPreferences.isTrustedAccessibilityClient(false)` on darwin for instant Accessibility status checks (zero helper roundtrip needed when polling every 1 s) and merge with helper's `permissions.screen_recording`.
  - When `screen_recording` transitions from granted-on-disk vs process-effective (or after `request_permission('screen_recording')`), surface `relaunchRequired` cleanly so the UI can show **Relaunch to activate screen control**.
- [ ] **Step 4: Run `vitest run electron/main/` + `just strict` + `just lint` on changed files**
- [ ] **Step 5: Commit Task 2**

---

### Task 3: Renderer Protocol, Olm Transport, MSC3882 Login Token, & Browser-to-Mac Relay

**Files:**
- Modify: `eslint.config.mjs` (add `['desktop-access']` layer between `account` and `room`)
- Create: `src/app/navigation/desktopAccessModal.ts`
- Modify: `src/app/shell/accountState.ts` (reset `desktopAccessModalAtom` on sign-out)
- Create: `src/app/desktop-access/desktopPairingProtocol.ts`
- Create: `src/app/desktop-access/desktopPairingProtocol.test.ts`
- Create: `src/app/desktop-access/desktopOlmTransport.ts`
- Create: `src/app/desktop-access/desktopOlmTransport.test.ts`
- Create: `src/app/desktop-access/mintDesktopLoginToken.ts`
- Create: `src/app/desktop-access/mintDesktopLoginToken.test.ts`
- Create: `src/app/desktop-access/desktopAccessController.ts`
- Create: `src/app/desktop-access/desktopAccessController.test.ts`
- Create: `src/app/desktop-access/browserPairRelay.ts`
- Create: `src/app/desktop-access/browserPairRelay.test.ts`

**Interfaces:**
- Consumes:
  - `desktopBridge()?.desktopAccess` from `src/app/lib/nativeShell.ts`
  - `sendEncryptedToDeviceRequest` from `src/app/matrix/runtimeToDeviceTransport.ts`
  - `signedModelDevices` from `src/app/matrix/runtimeDeviceTrust.ts`
  - `deviceSignedByOwner` from `src/app/matrix/matrix-crypto.ts`
  - `UiaRunner`, `AuthenticationCancelled` from `src/app/account/uia/useAuthenticatedAction.tsx`
- Produces:
  - `desktopAccessModalAtom`, `openDesktopAccessModal`, `closeDesktopAccessModal` in `src/app/navigation/desktopAccessModal.ts`
  - `useDesktopAccessSnapshot({ pollAccessibility })`
  - `pairAgentOnThisMac(mx, params, runUia, onStep)`
  - `disconnectAgentFromThisMac(mx, controllerKey, agentUserId, agentName)`
  - `useRegisteredMacDevices(mx)` and `relayPairToMac(mx, targetMacDevice, agentUserId, agentName, onState)`
  - `DesktopMacRelayFeature` + `incomingPairInviteAtom` (registered in `accountState.ts`!)

- [ ] **Step 1: Write failing unit tests for protocol parsers, Olm transport, MSC3882 login token, controller orchestration, and browser relay**
  - Protocol: exact `v: 1` serialization/validation for all 6 Phase 1 events + 3 relay events + deterministic 6-digit SAS code.
  - Olm transport: rejects unencrypted, wrong sender, mismatched nonce, unsigned/unknown device; resolves verified `{ offer, controller: { userId, deviceId, ed25519 } }`.
  - MSC3882: mints login token via UIA; returns `unsupported` on Cloudflare Access or missing `get_login_token`; returns `cancelled` on `AuthenticationCancelled`.
  - Controller: full 2-click flow (reuse existing matching session, silent MSC3882 login when missing, SSO fallback when MSC3882 unsupported, `eligible: false` error surfacing, 2nd-agent live pairing).
  - Browser relay: rejects invites from other users or unsigned devices; completes happy path (`pair_invite.v1` -> local approve -> `pair_invite_result.v1` -> `pairing_confirm.v1` -> `pair_invite_confirmed.v1`).
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement files and update `eslint.config.mjs` + `src/app/shell/accountState.ts`**
- [ ] **Step 4: Run `vitest run src/app/desktop-access/ src/test/layering.test.ts src/app/shell/accountState.test.ts` + `just typecheck` + `just strict`**
- [ ] **Step 5: Commit Task 3**

---

### Task 4: UI - 2-Click Consent Sheet, Choose Limits..., Zero-Nag TCC Row, Shell Approval Window, & This Mac Settings

**Files:**
- Create: `src/app/desktop-access/desktopAccess.css.ts`
- Create: `src/app/desktop-access/PermissionsRow.tsx`
- Create: `src/app/desktop-access/ChooseLimitsForm.tsx`
- Create: `src/app/desktop-access/DesktopAccessModal.tsx`
- Create: `src/app/desktop-access/DesktopAccessModal.test.tsx`
- Create: `src/app/desktop-access/IncomingPairInviteModal.tsx`
- Create: `src/app/desktop-access/ShellApprovalView.tsx`
- Create: `src/app/desktop-access/ShellApprovalView.test.tsx`
- Create: `src/app/desktop-access/ThisMacSettingsPage.tsx`
- Create: `src/app/desktop-access/ThisMacSettingsPage.test.tsx`

**Interfaces:**
- Consumes: Task 3 hooks & controllers, `GlassPrimitives`, `Modal500`, `SettingsPageFrame`, `SettingsSection`, `SettingTile`, `useAuthenticatedAction`, `useMacAppDownloadUrl`.
- Produces:
  - `DesktopAccessModalRenderer` (mounts modal when `desktopAccessModalAtom` is open)
  - `IncomingPairInviteModal` (mounts local consent sheet when a browser sends `pair_invite.v1`)
  - `ShellApprovalView` (rendered at `/shell-approval/`)
  - `ThisMacSettingsPage` (Settings -> This Mac page component)

- [ ] **Step 1: Write failing component tests (`DesktopAccessModal.test.tsx`, `ShellApprovalView.test.tsx`, `ThisMacSettingsPage.test.tsx`)**
  - `DesktopAccessModal`: single-agent room opens directly on consent sheet with exact Full Access disclosure + **Allow Full Access** / **Choose limits...** / **Cancel**; multi-agent room shows agent picker first; clicking **Allow Full Access** triggers pairing and shows Shell-ready banner + live Accessibility row + Screen Recording relaunch button; browser mode shows **Send to <Mac>** with 6-digit SAS code or **Download MindRoom Chat for Mac**.
  - `ShellApprovalView`: renders visibly escaped control chars/newlines, keeps Approve buttons disabled during 1 s arming delay, enables them after 1 s and invokes `decideShell`.
  - `ThisMacSettingsPage`: lists paired agents with Full Access / Restricted badges, permissions row, running shell handles with Stop, and **Revoke All Access**.
- [ ] **Step 2: Run tests to verify failure**
- [ ] **Step 3: Implement UI components and `.css.ts` styles (using `folds` tokens and logical CSS properties only)**
- [ ] **Step 4: Run `vitest run src/app/desktop-access/` + `just typecheck` + `just strict` + `just lint` on changed files**
- [ ] **Step 5: Commit Task 4**

---

### Task 5: App Integration - Room Header, `/desktop`, Settings Registry, Shell Mounting, & All 17 Locales

**Files:**
- Modify: `src/app/room/RoomViewHeader.tsx`
- Modify: `src/app/room/Room.tsx`
- Modify: `src/app/composer/commands/useCommands.ts`
- Modify: `src/app/preferences/settingsRegistry.ts`
- Modify: `src/app/navigation/settingsPages.ts`
- Modify: `src/app/settings/settingsMenu.ts`
- Modify: `src/app/settings/Settings.tsx`
- Modify: `src/app/settings/useSettingsContext.ts`
- Modify: `src/app/shell/ClientShell.tsx`
- Modify: `src/app/shell/ClientNonUIFeatures.tsx`
- Modify: `src/app/shell/Router.tsx`
- Modify: `src/app/i18n/locales/additions/en.json` and all 16 sibling `src/app/i18n/locales/additions/*.json` files
- Modify/Add tests: `src/app/preferences/settingsRegistry.test.ts` (if needed), `src/app/composer/commands/useCommands.test.ts` (bare `/desktop` vs `/desktop status`), `src/app/room/` header test for Give Mac Access action.

**Interfaces:**
- Consumes: Task 3 & Task 4 exports.
- Produces: Complete end-to-end app integration across Electron desktop and Web Browser Chat.

- [ ] **Step 1: Add failing tests for `/desktop` interception (bare `/desktop` opens native Mac Access modal in desktop app; `/desktop status` still passes through as `!desktop status`) and verify locale/registry test expectations**
- [ ] **Step 2: Wire Room Header (`macAccess` action with active green dot when any agent in the room is paired), `/desktop`, Settings -> This Mac, Shell renderers, `/shell-approval/` route, and all 17 locale addition JSON files**
  - Wire `desktop:shell-event` `{ type: 'open-desktop-access-settings' }` (from Tray menu) to open Settings -> This Mac.
- [ ] **Step 3: Run `vitest run src/app/i18n/localeAdditions.test.ts src/app/preferences/settingsRegistry.test.ts src/app/settings/settingsSearchIndex.test.ts src/app/shell/accountState.test.ts src/test/layering.test.ts src/app/composer/commands/useCommands.test.ts` + `just typecheck` + `just strict` + `just lint`**
- [ ] **Step 4: Commit Task 5**

---

### Task 6: Electron Playwright E2E, Visual Verification Screenshots, Pin Finalization, & Full Gates

**Files:**
- Create: `e2e/electron/desktop-access.spec.ts`
- Create: `e2e/helpers/fakeDesktopHelper.mjs` (minimal fake NDJSON helper for deterministic Electron e2e tests)
- Modify: `e2e/helpers/electronApp.ts` (support optional `desktopHelperBin` option passing `MINDROOM_DESKTOP_HELPER_BIN`)
- Update: `scripts/desktop-helper-pin.json` (confirm real signed `v2026.11.568` SHA-256 if not already pinned in Task 1)

- [ ] **Step 1: Write `e2e/helpers/fakeDesktopHelper.mjs` and `e2e/electron/desktop-access.spec.ts`**
  - Verify real Electron main + preload + renderer:
    - `noteGesture()` enforcement from renderer DevTools/evaluate without click/key gesture fails with `NO_USER_GESTURE`.
    - Consent file created with mode `0600` on Full Access and cleared on Revoke All.
    - Settings -> This Mac and shell-approval floating window (`/shell-approval/`) render cleanly and enforce 1 s arming delay.
- [ ] **Step 2: Run Electron e2e on macOS runner (`m5-2` or `m2`, on AC power), plus full local checks (`just typecheck`, `just strict`, `just lint`, `just test`, `npx vite build`, `just bundle-report`)**
- [ ] **Step 3: Capture clean placeholder-data screenshots (Room Header button, 2-click Full Access consent sheet, Choose limits... view, Shell-ready + TCC permissions row, Settings -> This Mac, Shell Approval window, Browser relay sheet), inspect every PNG with `view_file`**
- [ ] **Step 4: Commit Task 6**
