# MindRoom Soft-Reset Recommit Plan

> **For agentic workers:** Do not execute this plan until the reset window is explicitly approved.
> This document prepares the clean-history strategy only. It does not authorize `git reset`,
> `git rebase`, squashing, or commits.

**Goal:** Rebuild the current MindRoom tree as a small, reviewable commit stack grouped by file
ownership and future rebase risk.

**Baseline:** The inspected fork head is `e1d7c390` on top of upstream `v4.11.1` (`6a05ff58`).
The current diff from `v4.11.1` to head contains 1,074 changed files: 460
`src/app/mindroom/**` files, 374 other `src/**` files, 48 `e2e/**` files, 52 `android/**` files,
41 `ios/**` files, and smaller workflow, docs, script, package, and branding sets.

**Constraint:** Preserve feature behavior. During the later reset/recommit, use pathspec staging,
`git diff --cached --name-only`, and targeted validation after every group. Do not edit
`package-lock.json` except in the dependency/base group.

## Pre-Reset Checks

- Confirm the intended base before rewriting history. The current runbook recommends rebasing to
  upstream `v4.12.2` before rewriting, because v4.12.2 already changes call, dependency, sanitizer,
  and editor surfaces that overlap this fork.
- Save a safety ref before any reset: `git branch backup/mindroom-before-clean-history HEAD`.
- Capture inventory:
  - `git diff --name-status v4.11.1..HEAD > /tmp/mindroom-clean-history-files.txt`
  - `node scripts/report-non-mindroom-source-diff.mjs v4.11.1 HEAD`
  - `git merge-tree --write-tree --messages --merge-base 6a05ff58 upstream/dev HEAD`
- If this linked worktree resolves plain `git` commands to the git metadata directory, export the
  explicit worktree before running inventory commands:
  `GIT_WORK_TREE=/Users/bas.nijholt/.codex/worktrees/94b2/mindroom-cinny`.
- Keep current `FORK_CHANGES.md`, `REBASE_PROBLEMS.md`, and this plan available while staging.
- Use `git diff --cached --check` before each commit and the group-specific command below after
  staging, before committing.

## Commit Groups

### 1. Upstream base and dependency adoption

**Purpose:** Put dependency, build, runtime, and upstream-version adoption in one early commit so
later feature commits do not repeatedly carry lockfile/config churn.

**Include file globs:**

- `package.json`
- `package-lock.json`
- `patches/**`
- `.npmrc`
- `.node-version`
- `vite.config.js`
- `vitest.config.ts`
- `tsconfig.json`
- `build.config.ts`
- `index.html`
- `public/runtime-config.js`
- `docker-entrypoint.d/**`
- `docker-nginx.conf`
- `netlify.toml`
- `Dockerfile`
- `config.json` only if the team decides it remains a fork-owned runtime policy file

**Must not include:**

- `src/app/mindroom/**`
- `src/app/features/room/**`
- `src/app/components/editor/**`
- `src/app/components/message/**`
- `android/**`
- `ios/**`
- `.github/workflows/**`
- Docs other than a minimal dependency note in `FORK_CHANGES.md`

**Expected validation command:**

`npm run typecheck && npm test && npm run build`

**Likely conflict risk:** High. `package.json`, `package-lock.json`, `config.json`, `Dockerfile`,
and Vite/PWA settings overlap upstream v4.12.2 dependency and runtime changes. Resolve this group
before any source-feature staging.

### 2. MindRoom namespace core, thread model, and cache

**Purpose:** Establish fork-owned Matrix/thread/cache behavior under the MindRoom namespace before
mounting it from upstream-adjacent files.

**Include file globs:**

- `src/app/mindroom/cache/**`
- `src/app/mindroom/client/**`
- `src/app/mindroom/cross-room-threads/**`
- `src/app/mindroom/recent-threads/**`
- `src/app/mindroom/routing/**`
- `src/app/mindroom/sidebar/**`
- `src/app/mindroom/threads/**`
- `src/app/mindroom/notifications/**`
- `src/app/mindroom/settings/**`
- `src/app/mindroom/local-mindroom/**`
- `scripts/migrate-thread-tags.mjs`

**Must not include:**

- `src/app/features/room/**` compatibility re-exports
- `src/app/pages/**` route/sidebar mount points
- `src/app/components/**` generic UI seams
- `src/app/plugins/**` generic parsers/renderers
- `e2e/**` live browser specs
- `android/**` or `ios/**`

**Expected validation command:**

`npm test -- src/app/mindroom/threads src/app/mindroom/cache src/app/mindroom/cross-room-threads src/app/mindroom/recent-threads src/app/mindroom/routing src/app/mindroom/sidebar src/app/mindroom/notifications src/app/mindroom/settings src/app/mindroom/local-mindroom && npm run typecheck`

**Likely conflict risk:** Low to medium. The files are fork-owned, but later upstream rebases can
break APIs consumed from Matrix SDK, room state hooks, and routing helpers.

### 3. Narrow upstream integration seams

**Purpose:** Mount MindRoom behavior into Cinny through small, auditable seams while keeping
upstream-owned implementations easy to restore or rebase.

**Include file globs:**

- `src/app/features/room/Room.tsx`
- `src/app/features/room/RoomTimeline.tsx`
- `src/app/features/room/RoomView.tsx`
- `src/app/features/room/RoomViewHeader.tsx`
- `src/app/features/room/RoomInput.tsx`
- `src/app/features/room/message/Message.tsx`
- `src/app/features/room/room-pin-menu/**`
- `src/app/pages/App.tsx`
- `src/app/pages/Router.tsx`
- `src/app/pages/client/**`
- `src/app/pages/path*.ts`
- `src/app/pages/routeSessionGuards*`
- `src/app/hooks/router/**`
- `src/app/components/BackRouteHandler.tsx`
- `src/app/components/ReactQueryDevtoolsToggle*`
- `src/app/components/ServerConfigsLoader*`
- `src/app/features/settings/about/About.tsx`
- `src/app/state/settings.ts`

**Must not include:**

- Full MindRoom implementations from `src/app/mindroom/**`
- Generic editor/parser/render changes
- Native app folders
- Lockfile or dependency changes
- Broad upstream component rewrites not required to mount MindRoom

**Expected validation command:**

`npm test -- src/app/features/room src/app/pages src/app/hooks/router src/app/state/settings.test.ts src/app/components/ReactQueryDevtoolsToggle.test.ts src/app/components/ServerConfigsLoader.test.ts && npm run typecheck`

**Likely conflict risk:** Very high. `Room.tsx`, `RoomTimeline.tsx`, `RoomViewHeader.tsx`,
`WelcomePage.tsx`, `AuthFooter.tsx`, `About.tsx`, `Search.tsx`, and `settings.ts` overlap
upstream v4.12.2. The room files are currently tiny re-export seams, but upstream added call-session
behavior that must be consciously ported into MindRoom-owned room/header code.

### 4. Message rendering, tool calls, and long text

**Purpose:** Keep MindRoom message content, tool-call visibility, AI run rendering, edit metadata,
long text, approvals, and playback display together.

**Include file globs:**

- `src/app/mindroom/messages/**`
- `src/app/mindroom/message-search/**`
- `src/app/components/message/**`
- `src/app/components/RenderMessageContent.tsx`
- `src/app/plugins/react-custom-html-parser.tsx`
- `src/app/plugins/react-custom-html-parser.test.ts`
- `src/app/plugins/math.tsx`
- `src/app/plugins/markdown/**` only for message-rendering semantics
- `src/app/utils/editEvent.ts`
- `src/app/utils/reactionAnnotations.ts`
- `src/app/utils/sanitize.ts`
- `src/app/styles/CustomHtml.css.ts`
- `src/app/styles/Text.css.ts`

**Must not include:**

- `src/app/components/editor/**` composer serialization changes unless they are staged as a
  separate paste-marker seam with explicit review
- `src/app/mindroom/room-input/**`
- `src/app/mindroom/voice/**` recording UI
- `src/app/pages/**`
- `package-lock.json`

**Expected validation command:**

`npm test -- src/app/mindroom/messages src/app/mindroom/message-search src/app/components/message src/app/plugins/react-custom-html-parser.test.ts src/app/components/RenderMessageContent.tsx && npm run typecheck`

**Likely conflict risk:** High. `src/app/plugins/react-custom-html-parser.tsx`,
`src/app/plugins/markdown/block/parser.ts`, `src/app/plugins/markdown/block/rules.ts`,
`src/app/utils/sanitize.ts`, and `src/app/styles/CustomHtml.css.ts` overlap upstream v4.12.2
sanitizer/editor changes.

### 5. Composer, commands, paste, and voice capture

**Purpose:** Group input-side behavior: command palette and slash commands, paste attachment
markers, room input send sessions, voice recording, uploads, and editor serialization.

**Include file globs:**

- `src/app/mindroom/command-palette/**`
- `src/app/mindroom/commands/**`
- `src/app/mindroom/room-input/**`
- `src/app/mindroom/voice/**`
- `src/app/components/editor/**`
- `src/app/state/room/roomInputDrafts.ts`
- `src/app/state/upload*`
- `src/app/utils/audioWaveform*`
- `src/app/utils/voiceMessage*`
- `src/app/utils/findAndReplace.ts`
- `src/app/utils/regex.ts`
- `src/app/plugins/text-area/**`

**Must not include:**

- Message display components outside editor/input concerns
- Native iOS/Android permission/config files
- Generic room/thread implementations
- Lockfile changes

**Expected validation command:**

`npm test -- src/app/mindroom/command-palette src/app/mindroom/commands src/app/mindroom/room-input src/app/mindroom/voice src/app/components/editor src/app/state/upload.test.ts src/app/utils/audioWaveform.test.ts src/app/utils/voiceMessage.test.ts && npm run typecheck`

**Likely conflict risk:** High. `src/app/components/editor/input.ts`,
`src/app/components/editor/output.ts`, editor Slate element types, markdown parsing, and sanitizer
allowlists are generic upstream surfaces. Keep this commit narrow and review generated HTML/plain
text contracts carefully.

### 6. Native iOS and Android

**Purpose:** Keep Capacitor shells, native SSO, push, status bar, mobile permissions, and store
metadata in one mobile-owned slice.

**Include file globs:**

- `android/**`
- `ios/**`
- `capacitor.config.ts`
- `src/app/mindroom/native/**`
- `src/app/mindroom/auth/**`
- `src/app/pages/auth/SSOLogin.tsx`
- `src/app/pages/auth/SSOLogin.test.ts`
- `src/app/pages/auth/ssoProviders*`
- `src/index.tsx` only for native callback/bootstrap wiring
- `scripts/ios-phone.mjs`
- `scripts/generate-ios-icons.sh`
- `scripts/seed-ios-sim-session.sh`

**Must not include:**

- Web-only auth UI changes unrelated to native SSO
- Release workflow YAML
- App Store or Play automation scripts that do not run inside native builds
- Thread/message/cache behavior

**Expected validation command:**

`npm test -- src/app/mindroom/native src/app/mindroom/auth src/app/pages/auth/SSOLogin.test.ts src/app/pages/auth/ssoProviders.test.ts && bash -n ios/App/ci_scripts/ci_pre_xcodebuild.sh && npm run appstore:preflight && npm run typecheck`

**Likely conflict risk:** Medium. Native folders are fork-owned additions, but `src/index.tsx`,
auth SSO surfaces, package dependencies, and generated native project files are sensitive to
upstream dependency changes and platform tooling.

### 7. Push and release automation

**Purpose:** Isolate CI, container, tunnel, App Store, Play, and release-tag automation from product
source commits.

**Include file globs:**

- `.github/workflows/**`
- `.github/dependabot.yml`
- `.github/renovate.json`
- `.github/PULL_REQUEST_TEMPLATE.md`
- `.github/SECURITY.md`
- `justfile`
- `scripts/appstore-preflight.mjs`
- `scripts/ios-xcode-project.mjs`
- `scripts/fork_release_tag.py`
- `scripts/test-e2e-*.sh`
- `scripts/e2e-matrix-*.sh`
- `scripts/with-mindroom-tunnel.sh`
- `scripts/create-mindroom-e2e-account.sh`
- `scripts/ensure-e2e-account.sh`
- `serve.py`

**Must not include:**

- `package-lock.json` unless a workflow-only dependency change is impossible to avoid
- Native project files
- Product source under `src/**`
- Public branding assets

**Expected validation command:**

`npx prettier --check .github/workflows scripts/appstore-preflight.mjs scripts/ios-xcode-project.mjs && bash -n scripts/test-e2e-mindroom.sh scripts/test-e2e-docker-matrix.sh scripts/e2e-matrix-up.sh scripts/e2e-matrix-down.sh scripts/with-mindroom-tunnel.sh`

**Likely conflict risk:** Medium to high. `prod-deploy.yml` and PR workflows already overlap
upstream. Keep fork release workflows separate from upstream deployment workflows when possible.

### 8. Tests, docs, and guardrails

**Purpose:** Add documentation, E2E coverage, test infrastructure, and history-maintenance tools
after the behavior-owning commits are staged.

**Include file globs:**

- `AGENTS.md`
- `FORK_CHANGES.md`
- `REBASE_PROBLEMS.md`
- `docs/**`
- `.docs/**`
- `e2e/**`
- `playwright.config.ts`
- `src/vitest.setup.ts`
- `src/**/*.test.ts`
- `src/**/*.test.tsx`
- `src/**/*.spec.ts`
- `scripts/report-non-mindroom-source-diff.mjs`
- `.claude/**`

**Must not include:**

- Behavior source files only because a nearby test needs them
- `package-lock.json`
- Native binary assets
- Workflow behavior changes

**Expected validation command:**

`npm test && npm run test:e2e -- --list && npx prettier --check AGENTS.md FORK_CHANGES.md REBASE_PROBLEMS.md docs .docs e2e scripts/report-non-mindroom-source-diff.mjs && git diff --check`

**Likely conflict risk:** Low for fork-owned docs and E2E specs, medium for README/runbook churn.
`FORK_CHANGES.md` is intentionally large and should stay append-only during the rewrite.

## Highest-Risk Files for the Later Rewrite

1. `package-lock.json` - combines upstream dependency upgrades, fork mobile/test dependencies, and
   SDK patch-package state.
2. `src/app/features/room/Room.tsx` - currently a tiny seam, but upstream v4.12.2 added call-session
   behavior in the original room shell.
3. `src/app/features/room/RoomViewHeader.tsx` - currently a tiny seam, but upstream v4.12.2 changed
   call/header behavior that must not be lost.
4. `src/app/components/editor/input.ts` and `src/app/components/editor/output.ts` - paste marker and
   math support sit in generic editor serialization paths that upstream also changed.
5. `src/app/styles/CustomHtml.css.ts` - MindRoom math/custom HTML styling overlaps upstream
   sanitizer/rendering changes and can fail typecheck when theme tokens drift.

## Recommended Cleanup-Patch Integration Order

1. Dependency/base cleanup first: package, lockfile, Vite, patch-package, sanitizer dependency, and
   config policy decisions.
2. Restore or shrink upstream-owned room seam cleanup next: `features/room/Room*`,
   `RoomViewHeader`, `RoomTimeline`, and any call-session ports into `src/app/mindroom/threads/**`.
3. Editor/render seam cleanup: consolidate paste marker, math, sanitizer, markdown, and
   `CustomHtml.css.ts` integration points.
4. MindRoom namespace internal cleanup: thread/cache/message/command modules that no longer require
   upstream file edits.
5. Native and release cleanup after source seams stabilize, because these depend on package/config
   decisions.
6. Tests/docs/guardrails last, with `npm test`, `npm run typecheck`, `npm run lint`,
   `npm run build`, `git diff --check`, and targeted live Playwright specs for room/thread flows.
