# MindRoom Cinny Fork — Changes Since 073a9f5786d676b9e98b98bd3f03e49d0324bb3b

This document enumerates every change after the fork base commit
`073a9f5786d676b9e98b98bd3f03e49d0324bb3b`, with evidence-backed summaries.
It now also includes the runbook content in the Runbook section below.

Rules followed:

- No guessing. If the reason is not explicit in the commit message, diff, or
  the Runbook section in this file, it is marked TODO.
- Each change lists files touched and the visible behavior impact from the diff.

## How To Regenerate

- Commit list: `git log --reverse --format="%H %ad %s" 073a9f5..HEAD`
- Per-commit diff: `git show <sha>`

## Working Tree (Not Yet Committed)

Working tree status (2026-03-23):

- No tracked working-tree changes were present at task start.
- Local untracked scratch file `.claude/TASK.md` is present.

What changed (uncommitted):

- None tracked at task start.

Validation (uncommitted):

- Not applicable at task start.

## Commit-by-Commit Changes

### docs: add agent runbook and fork change log

Files changed:

- `AGENTS.md`
- `CLAUDE.md`
- `FORK_CHANGES.md`
- `README.md`

What changed:

- Added agent entrypoint docs and established this fork’s change log/runbook.

Why:

- Stated in commit subject and runbook content.

### chore(brand): rebrand and set MindRoom homeserver defaults

Files changed:

- `config.json`
- `index.html`
- `public/favicon.ico`
- `public/manifest.json`
- `public/res/svg/mindroom-text.svg`
- `public/res/svg/mindroom.svg`
- `src/app/components/splash-screen/SplashScreen.tsx`
- `src/app/features/settings/about/About.tsx`
- `src/app/features/settings/notifications/SystemNotification.tsx`
- `src/app/pages/auth/AuthLayout.tsx`
- `src/app/pages/auth/login/PasswordLoginForm.tsx`
- `src/app/pages/auth/login/TokenLogin.tsx`
- `src/app/pages/auth/register/PasswordRegisterForm.tsx`
- `src/app/pages/client/ClientNonUIFeatures.tsx`
- `src/app/pages/client/WelcomePage.tsx`

What changed:

- Rebranded logos/manifest/assets to MindRoom and updated default homeserver list.

Why:

- Stated in commit subject.

### chore(devserver): add SPA-aware static server

Files changed:

- `serve.py`

What changed:

- Added an SPA-aware static file server for local deployment.

Why:

- Stated in commit subject.

### feat(base-path): support subpath deployments

Files changed:

- `build.config.ts`
- `Dockerfile`
- `docker-entrypoint.d/99-runtime-config.sh`
- `docker-nginx.conf`
- `index.html`
- `public/runtime-config.js`
- `README.md`
- `serve.py`
- `src/index.tsx`
- `src/app/components/ClientConfigLoader.tsx`
- `src/app/hooks/usePathWithOrigin.ts`
- `src/app/i18n.ts`
- `src/app/pages/Router.tsx`
- `src/app/pages/pathUtils.ts`
- `src/app/plugins/pdfjs-dist.ts`
- `src/app/utils/basePath.ts`
- `src/app/utils/basePathShared.ts`
- `src/app/utils/basePath.test.ts`
- `src/app/components/ClientConfigLoader.test.ts`
- `vite.config.js`

What changed:

- Added runtime-configurable base path and relative-asset build default for subpath deployments.
- Wired base path into config loading, router, i18n, pdf worker, and service worker.
- Added nginx and Docker entrypoint support for `/mindroom` without rebuilds.
- Added tests for base-path normalization and config URL composition.
- Updated `serve.py` to serve runtime-config from env and inject deployment-correct
  `<base href>` / runtime-config script paths into `index.html` at startup.
- Simplified `index.html` bootstrap to static placeholders (`<base href="/">`,
  `<script src="/runtime-config.js">`) with no client-side base-path inference
  (`document.write`/XHR/`eval` avoided).

Why:

- Required for serving the app from `/mindroom` without proxy rewrite hacks.

### feat(sidebar): allow hiding explore/add space

Files changed:

- `config.json`
- `src/app/hooks/useClientConfig.ts`
- `src/app/pages/client/SidebarNav.tsx`

What changed:

- Added config toggles to hide Explore Community and Add Space buttons.

Why:

- Stated in commit subject.

### chore(brand): refresh logo assets and split favicon sources

Files changed:

- `.docs/APP_STORE_COMPLIANCE.md`
- `FORK_CHANGES.md`
- `.docs/ios-build.md`
- `public/favicon.ico`
- `public/res/android/android-chrome-36x36.png`
- `public/res/android/android-chrome-48x48.png`
- `public/res/android/android-chrome-72x72.png`
- `public/res/android/android-chrome-96x96.png`
- `public/res/android/android-chrome-144x144.png`
- `public/res/android/android-chrome-192x192.png`
- `public/res/android/android-chrome-256x256.png`
- `public/res/android/android-chrome-384x384.png`
- `public/res/android/android-chrome-512x512.png`
- `public/res/apple/apple-touch-icon-57x57.png`
- `public/res/apple/apple-touch-icon-60x60.png`
- `public/res/apple/apple-touch-icon-72x72.png`
- `public/res/apple/apple-touch-icon-76x76.png`
- `public/res/apple/apple-touch-icon-114x114.png`
- `public/res/apple/apple-touch-icon-120x120.png`
- `public/res/apple/apple-touch-icon-144x144.png`
- `public/res/apple/apple-touch-icon-152x152.png`
- `public/res/apple/apple-touch-icon-167x167.png`
- `public/res/apple/apple-touch-icon-180x180.png`
- `public/res/branding/mindroom-favicon.png`
- `public/res/branding/mindroom-favicon-source.png`
- `src/app/pages/client/ClientNonUIFeatures.tsx`

What changed:

- Switched browser favicon and notification icon usage to an optimized MindRoom favicon PNG, and kept a separate master PNG for web/PWA icon generation.
- Kept native iOS AppIcon and splash generation on the opaque square branding source and clarified that split in the docs.

Why:

- Used a dedicated favicon helper PNG at the time for browser/favicon asset generation.

### fix(brand): switch favicon and PWA assets back to the transparent logo source

Files changed:

- `.docs/APP_STORE_COMPLIANCE.md`
- `FORK_CHANGES.md`
- `.docs/ios-build.md`
- `public/favicon.ico`
- `public/res/android/android-chrome-36x36.png`
- `public/res/android/android-chrome-48x48.png`
- `public/res/android/android-chrome-72x72.png`
- `public/res/android/android-chrome-96x96.png`
- `public/res/android/android-chrome-144x144.png`
- `public/res/android/android-chrome-192x192.png`
- `public/res/android/android-chrome-256x256.png`
- `public/res/android/android-chrome-384x384.png`
- `public/res/android/android-chrome-512x512.png`
- `public/res/apple/apple-touch-icon-57x57.png`
- `public/res/apple/apple-touch-icon-60x60.png`
- `public/res/apple/apple-touch-icon-72x72.png`
- `public/res/apple/apple-touch-icon-76x76.png`
- `public/res/apple/apple-touch-icon-114x114.png`
- `public/res/apple/apple-touch-icon-120x120.png`
- `public/res/apple/apple-touch-icon-144x144.png`
- `public/res/apple/apple-touch-icon-152x152.png`
- `public/res/apple/apple-touch-icon-167x167.png`
- `public/res/apple/apple-touch-icon-180x180.png`
- `public/res/branding/mindroom-favicon.png`
- `public/res/branding/mindroom-favicon-source.png`

What changed:

- Rebuilt browser favicon, notification icon, and web/PWA icon assets from the existing transparent `mindroom-logo.png` asset.
- Dropped the redundant `mindroom-favicon-source.png` helper file once the transparent repo-local logo became the single favicon/PWA source.

Why:

- Browser favicon and web app icon formats support alpha, so the transparent logo is the correct source asset.

### feat(welcome): refine landing actions and attribution

Files changed:

- `config.json`
- `src/app/hooks/useClientConfig.ts`
- `src/app/pages/client/WelcomePage.tsx`

What changed:

- Simplified welcome actions to Source + Docs and added attribution links.

Why:

- Stated in commit subject.

### feat(auth): simplify server wording and footer links

Files changed:

- `src/app/pages/auth/AuthFooter.tsx`
- `src/app/pages/auth/AuthLayout.tsx`
- `src/app/pages/auth/login/Login.tsx`
- `src/app/pages/auth/ServerPicker.tsx`
- `config.json`
- `src/app/hooks/useClientConfig.ts`

What changed:

- Replaced “Homeserver” with “Server” wording and simplified footer attribution.
- Renamed “Homeserver List” to “Server List.”
- Added an auth config flag to hide the server picker when only one server is allowed.

Why:

- Stated in commit subject.

### feat(thread): add thread mode, relations, and indicators

Files changed:

- `package.json`
- `package-lock.json`
- `src/app/components/message/Reply.css.ts`
- `src/app/components/message/Reply.tsx`
- `src/app/features/room/Room.tsx`
- `src/app/features/room/RoomInput.tsx`
- `src/app/features/room/RoomTimeline.tsx`
- `src/app/features/room/RoomView.tsx`
- `src/app/features/room/composeMessageRelation.test.ts`
- `src/app/features/room/composeMessageRelation.ts`
- `src/app/features/room/message/Message.tsx`
- `src/app/features/room/threadUtils.test.ts`
- `src/app/features/room/threadUtils.ts`
- `src/app/hooks/useRoomNavigate.ts`
- `src/app/pages/pathSearchParam.test.ts`
- `src/app/pages/pathSearchParam.ts`
- `src/app/pages/paths.ts`
- `vitest.config.ts`

What changed:

- Added URL thread context, thread-aware input relations, and thread timeline filtering.
- Added thread UI indicators and tests (Vitest baseline included here).
- Included live thread badge corrections:
  - root/reply classification now handles `threadRootId === eventId` correctly.
  - fallback reply counts are derived from loaded timeline events when SDK thread
    support metadata/events are unavailable at runtime.

Why:

- Stated in commit subject.

### feat(tool-trace): switch cinny to tool-ref v2 markers

Files changed:

- `src/app/components/RenderMessageContent.tsx`
- `src/app/components/message/mindroomBlocks.test.ts`
- `src/app/components/message/mindroomBlocks.ts`
- `src/app/components/message/mindroomLongText.test.ts`
- `src/app/components/message/mindroomLongText.ts`
- `src/app/components/message/mindroomPipeline.test.ts`
- `src/app/components/message/mindroomToolTrace.test.ts`
- `src/app/components/message/mindroomToolTrace.ts`
- `src/app/plugins/react-custom-html-parser.test.ts`
- `src/app/plugins/react-custom-html-parser.tsx`
- `src/app/utils/sanitize.ts`

What changed:

- Removed legacy `<tool>` / `<tool-group>` rendering and sanitizer allowlisting.
- Adopted v2 marker contract in rendered HTML:
  - `🔧 <code>tool_name</code> [N]`
  - `🔧 <code>tool_name</code> [N] ⏳`
- Marker parsing is metadata-backed via `io.mindroom.tool_trace.events[N - 1]` only.
- Parser handles marker prefixes at the start of `p`/`div`/`li` even when trailing content exists in the same block (for example `<br />Done`).
- For completed single-line results, the header keeps inline preview (`-> result`) and expanded dropdown body now also includes the result text for copyability.

Why:

- Stated in commit subject.

### feat(long-text): inline expand MindRoom long text

Files changed:

- `src/app/components/RenderMessageContent.tsx`
- `src/app/components/message/MindroomLongTextText.tsx`
- `src/app/components/message/mindroomLongText.test.ts`
- `src/app/components/message/mindroomLongText.ts`
- `src/app/components/message/mindroomPipeline.test.ts`

What changed:

- Added long-text metadata expansion with tests.

Why:

- Stated in commit subject.

### fix(long-text): hydrate v2 sidecars, drop legacy paths, and download originals

Files changed:

- `src/app/components/RenderMessageContent.tsx`
- `src/app/components/message/MindroomLongTextText.test.ts`
- `src/app/components/message/MindroomLongTextText.tsx`
- `src/app/components/message/mindroomLongText.test.ts`
- `src/app/components/message/mindroomLongText.ts`
- `src/app/components/message/mindroomPipeline.test.ts`
- `src/app/features/room/message/Message.tsx`

What changed:

- Added large-message v2 hydration from sidecar JSON (`io.mindroom.long_text.version=2`, `encoding=matrix_event_content_json`).
- Hydration supports both unencrypted (`content.url`) and encrypted (`content.file.url`) sidecars; encrypted downloads reuse existing `downloadEncryptedMedia` + `decryptFile` path.
- Added in-memory hydration cache keyed by sidecar MXC URI.
- Hydrated sidecar payloads with edit wrappers are normalized to `m.new_content` render shape so edited long messages do not fall into broken rendering.
- Tool-trace parser options for long-text messages are now computed from hydrated content, so v2 tool markers resolve against hydrated `io.mindroom.tool_trace`.
- Removed pre-v2 MindRoom long-text compatibility paths; only v2 JSON sidecar metadata is recognized.
- Added message context-menu action to download original long-text sidecars (including encrypted sidecars), with deterministic sanitized filenames.
- On fetch/parse/decrypt failure, rendering safely falls back to preview content.

Why:

- Required to restore full-fidelity rendering for oversized v2 messages (`formatted_body`, mentions, and tool-trace metadata).

### feat(commands): add MindRoom ! autocomplete

Files changed:

- `src/app/features/room/MindroomCommandAutocomplete.tsx`
- `src/app/features/room/RoomInput.tsx`
- `src/app/features/room/mindroomCommandQuery.test.ts`
- `src/app/features/room/mindroomCommandQuery.ts`
- `src/app/features/room/mindroomCommands.test.ts`
- `src/app/features/room/mindroomCommands.ts`

What changed:

- Added MindRoom `!` command autocomplete and tests.

Why:

- Stated in commit subject.

### ci: publish GHCR images on push and release

Files changed:

- `.github/workflows/docker-publish-push.yml`
- `.github/workflows/prod-deploy.yml`

What changed:

- Published GHCR images on push and release.

Why:

- Stated in commit subject.

### Add iOS app via Capacitor

Files changed:

- `capacitor.config.ts`
- `.docs/ios-build.md`
- `ios/.gitignore`
- `ios/App/App.xcodeproj/project.pbxproj`
- `ios/App/App.xcworkspace/xcshareddata/IDEWorkspaceChecks.plist`
- `ios/App/App/AppDelegate.swift`
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png`
- `ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json`
- `ios/App/App/Assets.xcassets/Contents.json`
- `ios/App/App/Assets.xcassets/Splash.imageset/Contents.json`
- `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png`
- `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png`
- `ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png`
- `ios/App/App/Base.lproj/LaunchScreen.storyboard`
- `ios/App/App/Base.lproj/Main.storyboard`
- `ios/App/App/Info.plist`
- `ios/App/Podfile`
- `package-lock.json`
- `package.json`

What changed:

- Added Capacitor iOS scaffolding and build notes.

Why:

- Stated in commit subject.

### feat(ai-run): add subtle hover details for message run metadata

Files changed:

- `src/app/components/message/mindroomAiRun.ts` (NEW)
- `src/app/components/message/mindroomAiRun.test.ts` (NEW)
- `src/app/components/message/mindroomLongText.ts`
- `src/app/components/message/mindroomLongText.test.ts`
- `src/app/features/room/message/Message.tsx`
- `src/app/features/room/message/styles.css.ts`

What changed:

- Added parsing helpers for `io.mindroom.ai_run` metadata (version 1) from live content and `m.new_content`.
- Added a small message-header info affordance (shown on hover/focus) with tooltip details for status/model/tokens/context/tools/run id.
- Preserved `io.mindroom.ai_run` during long-text sidecar hydration so metadata survives v2 long-message rendering paths.
- Added unit tests for metadata parsing and long-text hydration metadata preservation.

Why:

- Stated in commit subject and product requirement to keep AI diagnostics available but unobtrusive.

### fix(long-text): ignore or unwrap non-content sidecar JSON payloads

Files changed:

- `src/app/components/message/mindroomLongText.ts`
- `src/app/components/message/mindroomLongText.test.ts`

What changed:

- Hardened long-text sidecar parsing so hydration only accepts JSON that resolves to message-content-like payloads.
- Added unwrapping support for event-envelope shapes (`{ content: ... }`) and debug snapshot wrappers (`<== MAIN_EVENT ==>`, `<== REPLACEMENT_EVENT_N ==>`) by selecting the latest replacement content when present.
- Sidecar payloads that do not contain usable message content now fall back to preview content instead of being rendered as `Broken message`.
- Added regression tests covering envelope unwrapping, snapshot replacement selection, and invalid-object rejection.

Why:

- Prevents hydrated long-text rendering from replacing valid preview text with `Broken message` when the sidecar JSON is an event/debug wrapper rather than raw Matrix message content.

### fix(thread): prevent main-room scroll jumps from thread-only live activity

Files changed:

- `src/app/features/room/RoomTimeline.tsx`

What changed:

- Main timeline live-event handling now detects thread-only activity (thread replies and relation events targeting thread replies) and skips auto-scroll-to-bottom in the main room timeline.
- Thread view auto-scroll now occurs only when a new thread reply arrives and the thread viewport is already at the exact bottom.

Why:

- Prevents disruptive forced scroll-to-bottom in the main room while users read older history, while keeping expected auto-scroll behavior scoped to the active thread view.

### feat(accounts): add multi-account session foundation

Files changed:

- `FORK_CHANGES.md`
- `src/app/components/ClientConfigLoader.tsx`
- `src/app/features/room/RoomTimeline.test.ts`
- `src/app/features/room/RoomTimeline.tsx`
- `src/app/features/room/roomEventCache.ts`
- `src/app/features/room/roomEventCache.test.ts`
- `src/app/features/room/threadEventCache.ts`
- `src/app/features/room/threadEventCache.test.ts`
- `src/app/features/settings/notifications/SystemNotification.tsx`
- `src/app/hooks/useIOSPushEnabled.ts`
- `src/app/hooks/useSessionStore.ts`
- `src/app/pages/Router.tsx`
- `src/app/pages/auth/addAccount.test.ts`
- `src/app/pages/auth/addAccount.ts`
- `src/app/pages/auth/login/Login.tsx`
- `src/app/pages/auth/login/PasswordLoginForm.tsx`
- `src/app/pages/auth/login/TokenLogin.tsx`
- `src/app/pages/auth/login/loginUtil.ts`
- `src/app/pages/auth/register/PasswordRegisterForm.tsx`
- `src/app/pages/auth/register/Register.tsx`
- `src/app/pages/auth/register/registerUtil.ts`
- `src/app/pages/client/ClientLayout.tsx`
- `src/app/pages/client/ClientNonUIFeatures.tsx`
- `src/app/pages/client/ClientRoot.tsx`
- `src/app/pages/client/SpecVersions.test.ts`
- `src/app/pages/client/SpecVersions.tsx`
- `src/app/pages/client/sidebar/SettingsTab.tsx`
- `src/app/state/sessions.test.ts`
- `src/app/state/sessions.ts`
- `src/app/state/settings.ts`
- `src/app/utils/iosPush.test.ts`
- `src/app/utils/iosPush.ts`
- `src/app/utils/mediaUrl.test.ts`
- `src/app/utils/mediaUrl.ts`
- `src/app/utils/roomAvatar.test.ts`
- `src/client/initMatrix.test.ts`
- `src/client/initMatrix.ts`
- `src/index.tsx`

What changed:

- Replaced the old fallback single-session boot/session path with a persisted multi-account session registry keyed by normalized `baseUrl + userId`.
- Switched Matrix sync/crypto stores and custom room/thread cache databases to session-scoped names so accounts no longer share persistence.
- Updated auth completion and routing so login/register can either create the first account or add another account without destroying the existing one.
- Updated app boot so `ClientRoot` starts from the active stored session and can switch between stored sessions cleanly.
- Replaced the bottom single-avatar Settings trigger with a first-pass account rail:
  - active avatar still opens Settings,
  - inactive avatars switch account,
  - `+` opens auth in add-account mode.
- Persisted per-account last visited route and last-known profile/avatar metadata to make switching faster and more recognizable.
- Made service-worker session posting, authenticated media fallback, and native iOS push local state read/write the active session instead of singleton global keys.
- Added focused regression tests for the session registry, add-account URL helpers, session-aware media/push helpers, namespaced Matrix init, and updated smoke tests for `SpecVersions`/`RoomTimeline`.

Why:

- Required to start multi-account support cleanly without session, cache, media-auth, or push-state leakage between accounts.

### feat(accounts): add inactive account removal actions

Files changed:

- `FORK_CHANGES.md`
- `src/app/pages/client/sidebar/AccountSwitcher.test.ts`
- `src/app/pages/client/sidebar/AccountSwitcher.tsx`
- `src/app/pages/client/sidebar/SettingsTab.tsx`
- `src/client/initMatrix.test.ts`
- `src/client/initMatrix.ts`

What changed:

- Added an account manager modal off the active bottom-sidebar avatar.
- Kept inactive avatars as direct fast-switch shortcuts, while moving management actions into the modal.
- Added inactive-account `Remove from Device` support that deletes only that session's local data and leaves the active account running.
- Added focused tests for the account manager UI and the inactive-account cleanup path.

Why:

- Completes the first usable account-management loop from the multi-account plan without forcing users into destructive global logout/cache-clear flows.

### test(accounts): add router and client switching regressions

Files changed:

- `FORK_CHANGES.md`
- `src/app/pages/Router.tsx`
- `src/app/pages/client/ClientRoot.test.ts`
- `src/app/pages/routeSessionGuards.test.ts`
- `src/app/pages/routeSessionGuards.ts`

What changed:

- Extracted the session-aware route gating decisions into pure helpers for root/auth/protected routes.
- Added focused tests covering:
  - signed-in root redirect,
  - add-account access to auth routes,
  - protected-route login redirects with and without an active session,
  - `ClientRoot` switching from one active session to another and stopping the old client.

Why:

- Hardens the multi-account boot/switching flow so the highest-risk session-routing and client-lifecycle edges are locked down by tests.

### test(accounts): add route restoration regressions

Files changed:

- `FORK_CHANGES.md`
- `src/app/pages/client/ClientLayout.test.ts`
- `src/app/pages/client/ClientLayout.tsx`
- `src/app/pages/client/sessionRouteRestore.test.ts`
- `src/app/pages/client/sessionRouteRestore.ts`
- `src/app/pages/client/sidebar/SettingsTab.test.ts`
- `src/app/pages/client/sidebar/SettingsTab.tsx`

What changed:

- Extracted route persistence/restore helpers so last-known account paths are validated and reused consistently instead of being rebuilt ad hoc.
- Updated `ClientLayout` to persist the exact active-account route, including search and hash, through the shared helper.
- Updated account switching in `SettingsTab` to restore each account's stored in-app route when valid and to fall back to `/home` when the stored path is missing or external.
- Added focused tests covering:
  - exact route persistence with `pathname + search + hash`,
  - valid vs invalid stored restore paths,
  - inactive-account switch navigation using the stored last path.

Why:

- Hardens multi-account switching so "return me to where I was in that account" is explicitly tested and cannot silently regress into home-only or unsafe external redirects.

### fix(accounts): stabilize session store snapshots

Files changed:

- `FORK_CHANGES.md`
- `src/app/state/sessions.test.ts`
- `src/app/state/sessions.ts`

What changed:

- Changed the session store snapshot readers used by `useSyncExternalStore` to cache and reuse parsed session-store objects while the underlying localStorage value is unchanged.
- Stabilized `getSessionStore()`, `getActiveSession()`, and `listSessions()` so they no longer allocate fresh objects/arrays on every read with identical backing data.
- Added regression coverage proving unchanged storage returns referentially stable session store, active-session, and session-list snapshots.

Why:

- Fixes a multi-account regression where unstable `useSyncExternalStore` snapshots could trigger React rerender loops (`Minified React error #185`) during login/session activation, which surfaced most obviously on Google/GitHub SSO return.

### fix(auth): skip spurious OIDC validation errors when metadata is unavailable

Files changed:

- `FORK_CHANGES.md`
- `src/app/components/ServerConfigsLoader.test.ts`
- `src/app/components/ServerConfigsLoader.tsx`

What changed:

- Stopped `ServerConfigsLoader` from calling `validateAuthMetadata(...)` when `mx.getAuthMetadata()` failed and returned no fulfilled payload.
- Kept auth-metadata validation/logging for the real malformed-payload case only, instead of turning fetch failures like `404 /_matrix/client/unstable/org.matrix.msc2965/auth_metadata` into a misleading secondary OIDC validation error.
- Added regression coverage proving rejected auth-metadata fetches still return capabilities/media config and do not emit fake OIDC validation noise.

Why:

- Fixes misleading add-account / startup console noise where missing delegated-auth metadata on the homeserver was being logged as `Configured OIDC OP does not support required functions` even though no auth metadata had been returned to validate.

### fix(auth): preserve add-account auth query params during server normalization

Files changed:

- `FORK_CHANGES.md`
- `src/app/pages/auth/AuthLayout.tsx`
- `src/app/pages/auth/authRouteUtils.test.ts`
- `src/app/pages/auth/authRouteUtils.ts`

What changed:

- Extracted auth-route path building into a pure helper so auth URL normalization is no longer rebuilt ad hoc inside `AuthLayout`.
- Changed `AuthLayout` to preserve the current auth-route search params and hash when it rewrites `/login`, `/register`, or `/reset-password` to include the canonical `:server` segment.
- Added regression coverage proving query params like `?addAccount=1` survive that server-normalization step.

Why:

- Fixes the real add-account redirect bug on active sessions: `?addAccount=1` was being dropped during auth-route normalization, which made the router immediately treat the page as a normal auth route and bounce the user back into the already-active account.

### fix(client): avoid bootstrap context dependency in server config loading

Files changed:

- `FORK_CHANGES.md`
- `src/app/components/ServerConfigsLoader.test.ts`
- `src/app/components/ServerConfigsLoader.tsx`
- `src/app/pages/client/ClientRoot.test.ts`
- `src/app/pages/client/ClientRoot.tsx`

What changed:

- Split `ServerConfigsLoader` so it can run either from the Matrix client context or from an explicit `mx` prop without touching `useMatrixClient()`.
- Changed `ClientRoot` to pass its already-initialized `mx` instance directly into `ServerConfigsLoader` during bootstrap.
- Added regression coverage proving `ServerConfigsLoader` can load configs without any Matrix client context when an explicit client instance is provided.
- Tightened `ClientRoot` test coverage so the bootstrap path now fails if `ClientRoot` stops passing that explicit `mx` prop.

Why:

- Fixes the add-account SSO regression where the protected route could hit `ServerConfigsLoader` before the Matrix client context was reliably available, throwing `MatrixClient not initialized!` immediately after successful second-account login.

### fix(client): require explicit Matrix client for server config bootstrap

Files changed:

- `FORK_CHANGES.md`
- `src/app/components/ServerConfigsLoader.test.ts`
- `src/app/components/ServerConfigsLoader.tsx`

What changed:

- Removed the `ServerConfigsLoader` fallback path that tried to read `useMatrixClient()` from context when no explicit client was passed.
- Made `ServerConfigsLoader` bootstrap-only: it now requires an explicit `mx` prop and only loads capabilities/media/auth metadata from that concrete client instance.
- Updated the loader tests to reflect that stricter contract.

Why:

- The prior bootstrap fix was incomplete: even though `ClientRoot` passed `mx`, the context-backed loader branch still existed in production and could remain the crash path. Removing that branch eliminates the exact `MatrixClient not initialized!` failure mode instead of trying to route around it.

### fix(client): avoid reinitializing on session metadata writes

Files changed:

- `FORK_CHANGES.md`
- `e2e/helpers/auth.ts`
- `e2e/multi-account.spec.ts`
- `src/app/pages/client/ClientRoot.test.ts`
- `src/app/pages/client/ClientRoot.tsx`

What changed:

- Narrowed `ClientRoot` bootstrap dependencies to the fields that actually define a Matrix client instance (`sessionId`, `baseUrl`, `userId`, `deviceId`, `accessToken`) instead of the whole active-session object.
- Added a regression test proving harmless session metadata updates like `lastKnownPath`, display-name caching, and `lastUsedAt` changes do not tear down and recreate the client.
- Hardened the live multi-account Playwright flow so it samples the shell for several seconds after second-account login and fails if the app starts flickering back to the `Heating up` splash.

Why:

- Fixes the live multi-account regression where adding a second account could cause `ClientRoot` to restart the client repeatedly whenever sidebar/profile/route persistence wrote session metadata back to storage, producing a visible loop between the normal room list and the `Heating up` splash.

### test(e2e): expand live multi-account validation

Files changed:

- `.docs/E2E_TESTING.md`
- `FORK_CHANGES.md`
- `e2e/account-logout.spec.ts`
- `e2e/account-switching.spec.ts`
- `e2e/helpers/accounts.ts`
- `e2e/helpers/browserDiagnostics.ts`

What changed:

- Added real browser helpers for reading the session store, switching accounts, removing inactive accounts, logging out the active account, and capturing browser diagnostics during live runs.
- Added a route-restore/reload/removal flow covering per-account last-path persistence, switching between stored accounts, surviving a full reload, and removing an inactive account.
- Added a logout flow covering active-account logout fallback to the remaining stored account and final logout back to the auth shell.
- Expanded the local testing guide with the larger one-off multi-account matrix and the current expected local-browser diagnostic noise.

Why:

- Gives the branch meaningful live validation beyond simple login/add-account smoke tests, so multi-account behavior can be exercised against the real homeserver before relying on it.

### test(e2e): expand live browser validation matrix

Files changed:

- `.docs/E2E_TESTING.md`
- `FORK_CHANGES.md`
- `.docs/LIVE_BROWSER_VALIDATION.md`
- `e2e/account-multitab.spec.ts`
- `e2e/account-offline.spec.ts`
- `e2e/account-relogin.spec.ts`
- `e2e/account-storage.spec.ts`
- `e2e/account-three-account.spec.ts`
- `e2e/deployed-auth-shell.spec.ts`
- `e2e/env.ts`
- `e2e/helpers/accounts.ts`
- `e2e/helpers/storage.ts`
- `scripts/test-e2e-mindroom.sh`
- `src/app/state/sessions.test.ts`
- `src/app/state/sessions.ts`
- `src/client/initMatrix.test.ts`
- `src/client/initMatrix.ts`

What changed:

- Added one-off Playwright coverage for same-account re-login, three-account switching, IndexedDB/localStorage cleanup, multi-tab propagation, homeserver outage handling, and deployed auth-shell route validation.
- Added third-account disposable provisioning support to the local SSH-backed test runner.
- Added browser-side storage inspection helpers so live runs can verify that logout and inactive-account removal actually clear the intended session data.
- Added an explicit helper for the real browser IndexedDB names used by the session-scoped sync and crypto stores, and updated inactive-session cleanup to delete those actual names.
- Recorded the full one-off validation matrix, observed diagnostics, and blocked deployment cases in `.docs/LIVE_BROWSER_VALIDATION.md`.
- Expanded `.docs/E2E_TESTING.md` so the router usage guide and live-run instructions cover the larger matrix and current deployed `chat.lab` auth-shell behavior.

Why:

- The earlier harness proved the basic password/add-account flow, but it did not yet exercise the broader web behaviors that can regress in a multi-account client: re-login dedupe, three-account state, multi-tab propagation, session-store cleanup, outage recovery, and route-specific deployed auth behavior. That broader pass also exposed a real cleanup bug where inactive-session removal targeted the constructor store name instead of the actual Chromium IndexedDB sync database name.

### docs(repo): move fork-added operational docs into .docs

Files changed:

- `.docs/APP_STORE_COMPLIANCE.md`
- `.docs/APP_STORE_SUBMISSION_PACKET.md`
- `.docs/E2E_TESTING.md`
- `.docs/LIVE_BROWSER_VALIDATION.md`
- `.docs/MULTI_ACCOUNT_PLAN.md`
- `.docs/ios-build.md`
- `FORK_CHANGES.md`
- `README.md`

What changed:

- Moved the fork-added operational/reference docs out of the repository root into `.docs/`.
- Kept `FORK_CHANGES.md` at the root as the fork runbook/change log.
- Kept the upstream root docs (`README.md`, `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `LICENSE`) unchanged in place.
- Left `AGENTS.md` and `CLAUDE.md` at the root as tool instruction entrypoints rather than ordinary project notes.
- Rewrote root-level references so README and the runbook point at the new `.docs/*` locations.

Why:

- Keeps the repository root closer to upstream and reduces top-level documentation clutter while preserving a clear home for fork-specific operational notes.

### fix(sidebar): enlarge local MindRoom tab icon

Files changed:

- `FORK_CHANGES.md`
- `src/app/pages/client/sidebar/MindroomTab.tsx`

What changed:

- Increased the local MindRoom sidebar logo render size from `22x22` to `36x36`
  inside the existing `42x42` sidebar avatar so the shortcut better matches the
  visual weight of the other sidebar icons.
- Updated the runbook working-tree section to reflect the current post-commit
  local state.

Why:

- The previous `22x22` raster render made the MindRoom logo appear undersized in
  the sidebar button.

### feat(sidebar): add local MindRoom link badge

Files changed:

- `FORK_CHANGES.md`
- `src/app/pages/client/sidebar/MindroomTab.css.ts`
- `src/app/pages/client/sidebar/MindroomTab.test.ts`
- `src/app/pages/client/sidebar/MindroomTab.tsx`

What changed:

- Added a small top-left circular link badge to the local MindRoom sidebar
  shortcut using the existing `SidebarItemBadge` positioning.
- Reused the shared `Icons.Link` glyph instead of introducing a custom inline
  SVG for the indicator.
- Added focused test coverage that the shortcut renders the link badge
  alongside the MindRoom logo.
- Updated the runbook working-tree section to reflect the current post-commit
  local state.

Why:

- The local MindRoom shortcut opens connection-related settings, so the badge
  gives it a clearer visual cue distinct from unread-count badges.

### fix(settings): hide local mindroom when disabled

Files changed:

- `FORK_CHANGES.md`
- `src/app/features/settings/Settings.tsx`
- `src/app/features/settings/index.ts`
- `src/app/features/settings/settingsMenu.test.ts`
- `src/app/features/settings/settingsMenu.ts`
- `src/app/features/settings/settingsPages.ts`

What changed:

- Moved settings page/menu derivation into small helper modules so `Settings`
  can filter menu items from a single definition while preserving the existing
  page order and icons.
- Hid the `Settings -> Local MindRoom` entry when `sidebar.showMindRoom` is
  `false`, matching the existing sidebar shortcut gating.
- Added fallback logic so an initial settings request for `Local MindRoom`
  resolves to `General` when that page is disabled, preventing an empty
  settings body.
- Added focused tests for menu filtering and initial-page resolution,
  including the explicit `GeneralPage` enum case.
- Updated the runbook behavior notes to document that `sidebar.showMindRoom`
  now hides both the sidebar shortcut and the settings page entry.

Why:

- Local-only deployments need one config flag to remove the entire Local
  MindRoom UI surface cleanly, not just the sidebar shortcut.

### feat(e2e): CINNY-012 live test skill

Files changed:

- `.claude/skills/cinny-live-test/skill.md` (NEW)
- `.claude/skills/cinny-live-test/run-live-tests.sh` (NEW)
- `e2e/live/smoke.spec.ts` (NEW)
- `e2e/live/login.spec.ts` (NEW)
- `e2e/live/rooms.spec.ts` (NEW)
- `e2e/live/threads.spec.ts` (NEW)
- `e2e/live/seed-fixture-room.mjs` (NEW)
- `PLAN-DEBATE.md` (NEW)
- `.claude/REPORT.md`

What changed:

- Added a Claude Code skill for running Playwright live tests against the deployed
  Cinny instance at `http://localhost:8090` with `https://mindroom.chat` as homeserver.
- Tier 1 smoke tests (4): app title, auth shell, SSO providers, no critical console errors.
- Tier 2 login tests (3): password login, shell stability, session persistence.
- Tier 2 room tests (3): room list renders, room navigation, no app errors.
- Tier 3 thread tests (4): thread overview, numeric counts, thread navigation, summary card.
- Idempotent fixture seeder for thread/summary test data via Matrix CS API.
- Runner script with Nix Chromium fallback, credential resolution chain, and auto-registration.
- All tests gracefully skip when prerequisites (credentials, fixture room) are missing.

Why:

- Mock-heavy tests were insufficient for thread/edit/streaming behavior; the skill
  provides reproducible live browser validation against the real app and homeserver.

# Runbook

## Purpose

This runbook documents the fork in a reader-focused way: motivation, behavior, implementation details, and current risks.

MindRoom priorities for this fork:

- Reliable edit rendering for streaming-style responses.
- Thread-first navigation and composition.
- Clear visibility of tool-call metadata in messages.
- Stable deployment under both root and subpath hosting.

## Core Requirements

- Message edits (`m.replace`) must resolve to the latest content in timeline rendering.
- Thread context must be deep-linkable and refresh-safe.
- MindRoom metadata fields (`io.mindroom.tool_trace`, `io.mindroom.long_text`) must be rendered usefully.
- One build artifact should support runtime base-path configuration.

## Architecture Map

- Routing and URL model:
  - `src/app/pages/Router.tsx`
  - `src/app/pages/paths.ts`
  - `src/app/pages/pathSearchParam.ts`
- Room feature composition:
  - `src/app/features/room/Room.tsx`
  - `src/app/features/room/RoomView.tsx`
  - `src/app/features/room/RoomTimeline.tsx`
  - `src/app/features/room/RoomInput.tsx`
  - `src/app/features/room/VoiceRecorderDialog.tsx`
- Message rendering pipeline:
  - edit resolution and timeline filtering in `src/app/utils/room.ts` and `src/app/features/room/RoomTimeline.tsx`
  - content rendering in `src/app/components/RenderMessageContent.tsx`
  - HTML sanitization/parsing in `src/app/utils/sanitize.ts` and `src/app/plugins/react-custom-html-parser.tsx`
- Deployment/runtime config:
  - `index.html`
  - `serve.py`
  - `docker-entrypoint.d/99-runtime-config.sh`
  - `docker-nginx.conf`
- iOS packaging/compliance:
  - `ios/App/App/Info.plist`
  - `.docs/ios-build.md`
  - `.docs/APP_STORE_COMPLIANCE.md`

## Implemented Behavior

### Edit Rendering For Streaming

- Timeline rendering resolves message edits against latest replacement content.
- Edit resolution now prefers SDK-tracked `MatrixEvent.replacingEvent()` before
  timeline relation fallback, avoiding stale relation subsets overriding newer
  edits in long/thread timelines.
- Relation fallback tie-breaking now prefers the later relation when edit
  timestamps match, preventing "first edit sticks" behavior under rapid streams.
- In thread view, when replacement state is missing, the client now fetches
  latest `m.replace` relations for loaded thread messages and applies them to
  events, reducing stale first-edit renders on long historical threads.
- Edit/reaction relation events are not directly shown as separate timeline entries.
- This keeps streamed edit updates visible as a single evolving message body.

### Thread-First UX

- Thread context is URL-driven via `threadId` search param.
- Entering/leaving thread mode is route-safe (refresh/share/back button compatible).
- `RoomTimeline` supports thread timeline loading via SDK thread APIs, with fallback handling when server/thread metadata is incomplete.
- `RoomInput` composes thread relations by context so replies inside thread view stay in-thread by default.

Thread badge behavior:

- Root-vs-reply classification treats `threadRootId === eventId` as a root event (not a reply).
- Reply count source priority:
  1. server-bundled thread metadata in event unsigned relations,
  2. SDK thread model length,
  3. fallback count derived from loaded room timeline events.
- In main timeline message cards, the thread summary chip is rendered below message content (not in the reply-preview row).
- When thread participant senders are available from SDK thread events or loaded timeline fallback, the thread summary chip includes a compact avatar stack.

Thread summary preview (CINNY-003b, upgraded in CINNY-003c):

- When MindRoom sends an AI thread summary event (`m.notice` with `io.mindroom.thread_summary` metadata), the summary is displayed as a styled summary **card** (using the same `MindroomThreadSummaryCard` component as in-thread rendering) above the `ThreadIndicator` chip in the room-level timeline view.
- The room-level card uses `compact` mode: full (unclamped) summary text, no reply-count chip (the `ThreadIndicator` below already shows reply count + participant avatars).
- Card shows "AI summary" label and generated-at timestamp when available (from v1 metadata format). The message-count chip is only shown in the in-thread (non-compact) variant. Falls back to body-only display for simple boolean flag format.
- Summary text is edit-aware: prefers `m.new_content.body` for streamed/edited summaries.
- Data sources follow the SDK-first-then-fallback pattern: first checks SDK thread model events, then falls back to loaded room timeline events via a `useMemo` map (`threadSummaryInfoMap`), then falls back to a persistent IndexedDB cache (`cachedSummaryMap`) that survives page reloads and room re-entry (CINNY-003g).
- IndexedDB cache (`mindroom-thread-summary-cache`) stores `{roomId, threadRootId, summaryText, generatedTs, messageCount}` per thread. Write-through: summaries discovered via SDK or timeline are persisted immediately. Live summary events arriving via sync also update the cache. Cache is deleted on logout/cache-clear alongside other session caches.
- Only renders in room-level view (not inside thread view) and only for thread root events with replies.
- Threads without a summary event show the existing behavior unchanged.
- When a summary exists, the thread root message body is CSS-clipped (~2 lines max-height) with a gradient fade and "[open thread]" link, preserving full markdown/HTML rendering (CINNY-003f). Overflow detection uses a layout-effect ref comparison so the link only appears when content is actually truncated.

### MindRoom Sidebar Shortcut

- The left sidebar now supports a dedicated MindRoom button rendered with the MindRoom logo.
- The button opens Settings directly to a new **Local MindRoom** onboarding page (`Settings -> Local MindRoom`) instead of deep-linking to external docs.
- Sidebar visibility remains deployment-configurable via `config.json` using `sidebar.showMindRoom`.
- When `sidebar.showMindRoom` is `false`, the Local MindRoom settings entry is also hidden so deployments can remove the feature surface cleanly instead of only hiding the sidebar shortcut.

### Local MindRoom Onboarding UI

- Added a first-class local provisioning UX in Settings:
  - generate short-lived pair code (`POST /v1/local-mindroom/pair/start`),
  - display copyable command (`uvx mindroom connect --pair-code <CODE>`),
  - poll status (`GET /v1/local-mindroom/pair/status?pair_code=...`) until `connected`/`expired`,
  - list linked installations (`GET /v1/local-mindroom/connections`),
  - revoke linked installation with confirmation (`DELETE /v1/local-mindroom/connections/{id}`).
- API requests default to the active session homeserver origin, with optional override via `sidebar.mindRoomProvisioningUrl`, and always use `credentials: omit`.
- Browser provisioning calls include `X-Matrix-Access-Token` only when provisioning origin matches the active homeserver origin; cross-origin overrides are allowed but token forwarding is blocked by default with an in-UI warning.
- On native platforms, the provisioning client now uses Capacitor native HTTP instead of raw browser `fetch`, avoiding iOS webview transport/CORS failures that previously surfaced as `Load failed` for pair-code generation and linked-installation loading.
- Transport failures are normalized to a clearer provisioning-specific error message instead of leaking the raw browser/webview exception text.
- Flow handles pending, connected, expired, and network/API error states with retry affordances.
- Added unit tests for helper logic and provisioning API client wrappers.
- If the Local MindRoom feature is disabled in config, settings requests targeting that page now fall back to `General` rather than rendering a blank settings body.

### Tool Metadata Visibility

- Tool-call UI renders from v2 formatted-body markers:
  - `🔧 <code>tool_name</code> [N]`
  - `🔧 <code>tool_name</code> [N] ⏳`
- Consecutive tool-call marker blocks are collapsed into a single expandable `N tool calls` block to reduce timeline noise during long tool sequences.
- Marker metadata lookup is strict and index-based: `io.mindroom.tool_trace.events[N - 1]`.
- No legacy `<tool>` / `<tool-group>` compatibility is kept in sanitizer or parser paths.
- Marker prefixes at the start of a block element continue to render as tool blocks even when trailing content follows in the same block.
- Expanded tool dropdown now shows result text even for single-line inline results to support copy workflows.

### AI Run Metadata Visibility

- Messages carrying `io.mindroom.ai_run` render a compact info icon in the header on hover/focus.
- The icon opens a tooltip with model/token/context/tool-count/status/run-id details for quick diagnostics without adding timeline noise.
- Long-message v2 hydration preserves `io.mindroom.ai_run` so metadata remains visible when rendering from sidecar content.

### Large Message v2 Hydration

- `io.mindroom.long_text` v2 sidecars are hydrated from full JSON content payloads (`encoding=matrix_event_content_json`).
- Sidecar fetch supports both plain and encrypted attachments.
- Hydration result is cached in-memory by sidecar MXC URI.
- For edit wrappers, hydration normalizes render content to `m.new_content` with fallbacks so final body/formatted body stay renderable.
- Long-text rendering computes tool-trace parser options from hydrated content (not preview content), enabling correct v2 tool metadata mapping on oversized messages.
- Legacy/pre-v2 MindRoom long-text sidecar formats are no longer supported in this fork.
- Message context menu exposes "Download Original" for long-text sidecars, using safe deterministic filenames.
- Hydration failures degrade safely to preview content without crashing message rendering.

### MindRoom Command UX

- `RoomInput` includes `!` command autocomplete.
- Autocomplete triggers only at message start semantics (first command token), so normal punctuation in the middle of text does not open command suggestions.

### Voice Messages

- `RoomInput` exposes a microphone action that starts recording immediately inside the composer UI using `MediaRecorder`/`getUserMedia` when available.
- After stopping, the composer shows inline preview controls (play/re-record/discard/add to uploads) instead of using a separate recording modal for the main flow.
- Recorded audio is added to the existing upload queue, so upload progress, encryption handling, and send flow remain shared with normal attachments.
- Sent recordings are emitted as `m.audio` messages with voice-message metadata (`m.voice` / `org.matrix.msc3245.voice`, plus stable/unstable audio detail keys carrying duration).
- Incoming voice-tagged audio messages render in the existing audio player UI, with a voice badge and duration fallback from voice metadata when present.
- Recorder error handling now surfaces actionable iPhone guidance for insecure contexts / blocked mic access in a popup; Capacitor iOS builds include an `NSMicrophoneUsageDescription` usage string.
- Recorder MIME selection now prefers `audio/ogg;codecs=opus` first, with automatic fallback to other browser-supported formats (`audio/ogg`, `audio/mp4`, `audio/webm`, `audio/mpeg`) when needed.

### Base-Path Deployment Robustness

- `index.html` uses static placeholders for base/runtime config:
  - `<base href="/" />`
  - `<script src="/runtime-config.js"></script>`
- `serve.py` patches those placeholders at startup from `APP_BASE_PATH`, then serves patched HTML for SPA routes.
- Runtime config also exposes service-worker enablement (`APP_ENABLE_SERVICE_WORKER`, default enabled in container entrypoint runtime config).
- Service-worker media auth request matching now validates same-origin and media path presence, so both root-based and subpath-prefixed media URLs are accepted for authenticated fetches.
- Authenticated media is enabled only when both homeserver spec support is present and runtime service-worker support is actually available/enabled.
- This avoids client-side base-path inference logic and avoids `document.write`, synchronous XHR, or `eval` for base-path bootstrap.

### Auth/Storage Hardening

- Matrix client creation is centralized with same-origin credentialed fetch behavior.
- Auth flow loading was made recoverable (retry path instead of hard failure UX).
- Add-account auth routes now show a shared "Back to current account" action when an active session exists, restoring the session's last in-app route (or home) so native iOS users are not trapped on the secondary login screen.
- On startup, when config enforces exactly one homeserver, stale stored `cinny_hs_base_url` is reconciled to that configured homeserver to avoid unusable-server auth errors from legacy localStorage values.
- Current session storage remains localStorage-based in this branch; native Keychain-backed storage is a TODO gap for iOS hardening.

### iOS App Store Hardening

- `Info.plist` now removes broad `NSAllowsArbitraryLoads` and keeps local-network access explicit via `NSAllowsLocalNetworking`.
- iOS permission usage descriptions now include microphone, camera, photo-library read, and photo-library add prompts to cover voice/media flows.
- `ITSAppUsesNonExemptEncryption=false` is declared in plist to simplify export-compliance submission flow for standard-exempt crypto use.
- Auth discovery now enforces secure homeserver URLs:
  - `https://` is required for non-local hosts.
  - `http://` is allowed only for local-network hosts (`localhost`, `.local`, private/link-local IP ranges, loopback).
- Registration UI is controlled by runtime config via `auth.allowRegistration`; current config enables registration and requires Apple provider visibility with `auth.requireAppleProvider`.
- Auth footer now supports configurable App Store-facing links (`supportUrl`, `privacyPolicyUrl`, `termsUrl`).
- Account settings now include a visible account deletion/deactivation entry point, with local Matrix UIA-capable deactivation and OIDC account-management portal fallback.
- SSO provider rendering is Apple-aware:
  - Apple providers are detected from `brand`, `id`, and `name`.
  - Apple providers are prioritized to the top of the list and use explicit Apple labels (`Sign in with Apple` / `Sign up with Apple`).
  - Icon-only SSO rendering is avoided when Apple is present to keep label visibility.
- On native iOS, login/register SSO now opens inside Capacitor Browser
  (`SFSafariViewController`) and the in-app browser is closed when the custom
  scheme callback returns to the app, avoiding Safari handoff during App Review.
- Added `scripts/appstore-preflight.mjs` (`npm run appstore:preflight`) to verify critical iOS/config compliance gates before archive.
- Added `scripts/generate-ios-icons.sh` (`npm run ios:icons`) and generated full iPhone/iPad AppIcon slot assets from a single 1024 source icon.
- App Store preflight now validates icon-slot completeness and required icon file presence.
- Added `.docs/APP_STORE_SUBMISSION_PACKET.md` with paste-ready App Review notes and metadata checklist.
- Added `.docs/APP_STORE_COMPLIANCE.md` as a release gate checklist and linked iOS build preflight steps in `.docs/ios-build.md`.

## Operational Notes

- Recommended local validation:
  - `npm run test`
  - `npm run build`
  - `npm run test -- src/app/utils/room.test.ts src/app/matrixRelationsRace.test.ts`
- `npm run typecheck` currently fails due pre-existing repository-wide type issues (not introduced by recent fork deltas).
- If deploying behind strict subpath-only ingress/proxy rules, ensure runtime config and assets resolve under your routing policy, or apply equivalent server-side HTML base/script injection in the serving layer.
- Before shipping iOS builds, run the full checklist in `.docs/APP_STORE_COMPLIANCE.md` and verify App Store Connect metadata URLs (support/privacy/terms) are public and final.

## Current Snapshot (2026-03-15)

- Thread mode, tool-ref v2 rendering, long-message v2 hydration, and `!` autocomplete are implemented.
- Edit rendering hardening now prioritizes SDK replacement state over relation
  scans in UI helpers, improving streamed edit stability in long threads.
- Thread timeline loading now backfills missing latest edits (`m.replace`) per
  loaded thread message when server responses omit replacement aggregation.
- Room/thread persistent caches now preserve and reapply latest edit state for
  cached events, so refreshes do not regress heavily edited messages back to
  their first visible revision when relation aggregation is missing on reload.
- Thread supplemental cache hydration now also replays cached redactions and
  reaction relations, so thread-only cached state stays closer to the live SDK
  view before network reconciliation finishes.
- When thread edit backfill repairs a stale cached message from server
  `m.replace` relations, the repaired event state is now persisted back into the
  thread cache so the same stale first revision does not keep returning on the
  next refresh.
- Thread cache pagination now ignores the thread root when computing cached
  "older messages" state, so reaching the top of a thread no longer leaves a
  bogus `Load Older Messages` button visible just because the root event exists.
- Add-account auth flows now expose an in-app return path back to the active
  session, preventing native iOS users from getting stranded on login when they
  decide not to finish adding a second account.
- Direct deep links into thread view now retry thread edit backfill after the
  initial thread tail finishes loading, and backfill attempt tracking is tied
  to `MatrixEvent` instances instead of event IDs. This avoids a first-load race
  where early backfill ran against provisional thread events, later thread
  hydration replaced those event objects, and the replacement instances were
  incorrectly treated as "already attempted" until leaving and re-entering the
  thread.
- Direct thread refreshes now also revalidate messages that already have a
  provisional SDK `replacingEvent()` once the thread tail has settled, so a
  stale first edit does not "win" just because the SDK attached it early before
  the full thread relation slice arrived.
- Direct thread opens now hold back the initial live thread render until the
  thread cache hydration attempt completes, rendering cached thread events first
  when available and otherwise showing a short loading state. This avoids the
  visible flash where a direct thread URL could briefly paint an older
  provisional edit/body before cached or fully reconciled thread data replaced
  it.
- Thread render merging now uses one canonical duplicate-event policy instead of
  raw "last writer wins": when the same event id arrives from cache, the SDK
  thread model, or relation/backfill fetches, the renderer keeps the richer
  version (for example the one with the newer applied edit or redaction) so a
  stale duplicate instance does not temporarily overwrite the corrected one
  during thread pagination.
- Thread render-state assembly is now extracted behind
  `useThreadRenderState.ts` instead of being inlined inside `RoomTimeline.tsx`.
  That hook owns the fallback thread event buffer, duplicate-event merge rules,
  initial cache-first render mode, and thread event index map, leaving
  `RoomTimeline` responsible for pagination/UI orchestration rather than the
  low-level thread event assembly details.
- The extracted thread render-state hook now has focused hook-level tests for
  cache-first fallback rendering, preserving a corrected fallback event over a
  stale live duplicate after hydration, and reset behavior. That raises
  confidence that the refactor preserved the important thread render semantics.
- The first extraction of `useThreadRenderState.ts` briefly introduced a
  runtime temporal-dead-zone bug because `RoomTimeline.tsx` referenced values
  returned from the hook in callbacks/effect dependencies before the hook call
  itself. That has been fixed by moving the hook initialization above those
  callback definitions.
- `RoomTimeline.test.ts` now includes a smoke render regression test for that
  initialization-order bug. The test renders the real `RoomTimeline` component
  with heavy dependency mocking and would fail again if thread render-hook
  return values were referenced before the `useThreadRenderState(...)` call.
- When late thread edit/relation reconciliation lands while the user is already
  at or near the bottom of a thread, the thread view now re-pins to the latest
  reply instead of leaving the viewport visibly above the bottom after message
  heights change.
- Thread view scroll state now uses thread-specific live-end detection: opening a thread and thread-scoped `Jump to Latest` both paginate forward to the newest loaded reply batch before scrolling to bottom, and live replies stick more reliably when the user is already near the bottom.
- Room-mode thread-root focus now force-centers explicit focus scrolls,
  retries DOM lookup on animation frames until the focused event element
  renders, and suppresses virtual-paginator observer pagination while that
  focus scroll is in progress.
- Main timeline thread summary chips render below message body and show participant avatars when available.
- Base-path bootstrap is server-driven for the local SPA server (`serve.py`) and no longer depends on fragile client-side inference.
- Service-worker media auth matching handles both root and subpath media endpoints on the same origin, reducing `M_MISSING_TOKEN` failures under subpath deployments.
- Voice message recording/sending is available in room input, recorded uploads now default to Ogg/Opus when supported by `MediaRecorder`, and voice-tagged incoming audio messages render/play in the existing audio controls.

## Active Investigation (2026-03-21)

- ISSUE-023 implementation is complete.
- Root cause was in the custom thread cache path: stale `~...` local-echo rows
  persisted under the old event ID, later `$...` confirmed rows stored
  separately, and cold-start render dedup couldn't link them without transaction
  metadata.
- Fix applied in two layers:
  1. `threadEventCache.ts`: `normalizeCachedThreadEvents()` now filters out
     `~`-prefixed local echo events (both reply events and rootEvent).
     `saveThreadEventsToCache()` skips `~`-prefixed rootEvent on write.
  2. `useThreadRenderState.ts`: `buildResolveConfirmedId()` now accepts an
     optional events array and builds a fallback txnId→eventId map from
     `unsigned.transaction_id` when `room.getEventForTxnId()` returns undefined
     (cold reload). Resolver is wired into both `buildThreadEvents()` and
     `setSupplementalThreadEvents()`.
- Tests added: 3 new cache filter tests, 2 new render state dedup tests.
  All 37 tests pass (13 cache + 7 render state + 17 render utils).
- Remaining ISSUE-023 product decision:
  the base dedup fix does not preserve "send -> kill -> reload -> unsent reply
  still visible" on this branch, so NOT_SENT reload persistence needs separate
  explicit follow-up work if it is required for shipment.
- AI run metadata (`io.mindroom.ai_run`) is surfaced via a subtle per-message hover tooltip in the timeline header.
- Long-message handling is v2-only; users can download the original long-text sidecar directly from the message menu.
- iOS submission posture has been hardened: stricter ATS behavior, explicit media permission strings, secure homeserver URL enforcement, registration-enabled flow, and Apple-aware SSO provider handling.
- Native iOS login/register SSO now stays inside the app via Safari View
  Controller instead of handing the user to Safari.
- iOS app icon assets are now generated for all standard iPhone/iPad slots, and preflight checks enforce icon completeness before archive.
- Native iOS push plumbing is now present in the app and iOS project, but default runtime config still leaves push disabled until a real APNs/Sygnal deployment is configured.
- Branding assets now use repo-local PNG sources under `public/res/branding/`, with the transparent `mindroom-logo.png` used for in-app branding plus favicon/PWA generation, the optimized `mindroom-favicon.png` used for browser/runtime favicon updates, and the square logo driving native iOS icon/splash generation.
- Submission docs now include a checklist plus a paste-ready App Store metadata/review-notes packet.
- Left sidebar now includes a MindRoom shortcut button (logo icon) that opens Local MindRoom onboarding.
- Release automation now supports per-commit `dev` tagging in `v<base_version>-mindroom.<n>` format with base-version-aware incrementing.
- Startup homeserver capability probing (`/_matrix/client/versions`) now times out after 12s and aborts timed-out fetches, the connecting splash includes a cancel path back to sign-in/server selection, and the connection-error dialog now includes an app-scoped `Clear Cache and Reload` recovery action for stale browser cache cases.
- Active-session bootstrap is now stable against non-client session metadata writes: updating per-account last-path/profile cache data no longer tears down and recreates the current `MatrixClient`, which previously caused visible `Heating up`/room-list flicker right after second-account login.
- Live browser validation now covers password login, direct auth-router entry, add-account, route restore across account switching, reload persistence, inactive-account removal, active-account logout fallback, and final logout back to the auth shell when using the local SSH-tunneled homeserver.
- Live external readiness checks now look healthier than the older 2026-02-26 snapshot:
  - `https://mindroom.chat/_matrix/client/v3/login` currently returns `m.login.sso` and an Apple provider (`id=chat.mindroom.matrix.apple`, `name=Apple`, `brand=appleoidc`).
  - `https://docs.mindroom.chat/support`, `/privacy`, and `/terms` currently resolve over HTTPS and return HTTP 200.
  - Xcode project build settings currently declare `MARKETING_VERSION=4.10.3` and `CURRENT_PROJECT_VERSION=2`.
- Remaining known product gap: no dedicated thread list sidebar or thread-specific unread model yet.
- Remaining iOS hardening gap: session credentials are still localStorage-based in this branch (Keychain migration is still pending).

## Active Task Log (2026-03-23)

Current task:

- resolve the leftover CINNY-015-on-`dev` merge conflicts in
  `FORK_CHANGES.md`, `src/app/features/room/RoomTimeline.test.ts`, and
  `src/app/features/room/RoomTimeline.tsx`.

### fix: resolve merge conflicts (CINNY-015 onto dev) (2026-03-23)

**Status:** Complete.

**Problem:** A previous merge/cherry-pick of CINNY-015 onto local `dev`
left unresolved conflict markers in the runbook and the room-timeline source /
tests. The task is to reconcile the newer `dev` timeline changes with the
CINNY-015 filter-aware thread-exit scroll work without dropping either side.

**Worktree changes:**

- `FORK_CHANGES.md`
  - kept both historical task-log entries from the conflicting sides and
    recorded this cleanup slice with the final validation outcome.
- `src/app/features/room/RoomTimeline.test.ts`
  - kept both sets of room-timeline test additions: the older
    helper/anchor/filter coverage and the CINNY-015 room-focus regressions.
- `src/app/features/room/RoomTimeline.tsx`
  - reconciled the `dev` helper exports with the CINNY-015 filter-aware
    room-focus targeting, latest-filtered-event tracking, and
    observer-based DOM focus handling.

**Validation:**

- `grep -rn "<<<<<<<" src/` ✅
  no unresolved conflict markers remain under `src/`.
- `npx vitest run src/app/features/room/RoomTimeline.test.ts --pool forks --poolOptions.forks.singleFork` ✅
- `npx vite build` ✅
- `npx vitest run` ✅
- `npm run typecheck` ⚠️
  still fails with the existing repository-wide Matrix SDK / Jotai typing
  issues already noted elsewhere in this runbook; this merge did not introduce
  a new typecheck regression in the touched files.
- `git diff --check` ✅

**Review:**

- Independent second self-review completed against the merged diff and the
  validation output because subagents were not authorized in this session.

### CINNY-015: reapply filter-aware thread-exit scroll on latest `dev` (2026-03-23)

**Status:** Complete.

**Problem:** The requested `cinny-015-r2` follow-up commits (`8d2b4630`,
`ea138d52`) targeted the local `dev` branch at `804f112a`, but this worktree
started on `origin/dev` at `5ed95f37`. That older base was missing the
post-CINNY-008 room thread-filter stack entirely, so the first step was to
fast-forward this branch to local `dev` before reapplying the round-2
filter-aware room-focus fixes on the current code shape.

**Worktree changes:**

- branch state
  - fast-forwarded `cinny-015-r2b` from `5ed95f37` to local `dev`
    `804f112a` with `git merge --ff-only dev` so the timeline code matched the
    expected CINNY-008 review-fix base.
- `src/app/features/room/RoomTimeline.tsx`
  - added `getRoomEventFocusTarget()` so room-mode event focus derives its
    index/count from the active `threadFilteredEvents` list instead of the raw
    renderable room list,
  - kept the existing anchor-selection logic from CINNY-008
    (`getTimelineTargetAnchor()` / `getUnreadTargetAnchor()`) and applied the
    filter-aware focus targeting on top of that newer path,
  - integrated filter auto-reset into the room-focus load path so hidden room
    targets still switch the room filter back to `all`,
  - replaced the bounded RAF retry loop with a `MutationObserver` plus a
    2000 ms safety timeout for room-focus DOM arrival,
  - cached the latest `threadFilteredEvents` in `threadFilteredEventsRef` and
    removed the filtered-list dependency from the room-focus effects so
    unrelated live room updates no longer retrigger the explicit focus scroll.
- `src/app/features/room/RoomTimeline.test.ts`
  - stabilized the mocked `useAlive()` and ignored-user list identities so the
    new regression measures the real room-focus dependencies,
  - replaced the old retry-helper assertions with focused coverage for
    filter-aware room-focus index derivation and filter auto-reset,
  - added a regression proving an unrelated room rerender after `Jump to
    Unread` does not add another room-focus `scrollToItem(...)` call.
- `FORK_CHANGES.md`
  - recorded the base correction, implementation details, validation, and
    review outcome for this slice.
- `REPORT.md`
  - added a close-out report for CINNY-015 round 2 on the latest `dev` base.

**Validation:**

- `npx vitest run src/app/features/room/RoomTimeline.test.ts --pool forks --poolOptions.forks.singleFork` ✅
- `npx vitest run` ✅

**Review:**

- Independent second self-review completed against the final diff and the
  validation output because subagents were not authorized in this session.

### CINNY-008: squash-merge conflict-marker audit for `804f112a` (2026-03-23)

**Status:** Audit, validation, and independent second self-review completed.

**Problem:** A follow-up audit was requested for squash commit `804f112a`
because `RoomTimeline.test.ts` and `RoomTimeline.tsx` were reported as still
containing unresolved merge conflict markers. The task was to verify the
committed files, reconstruct the original `dev` vs `cinny008-review` conflict
state, and confirm that both sides of each hunk survived the squash merge.

**Worktree changes:**

- `FORK_CHANGES.md`
  - recorded this audit and validation slice.
- `src/app/features/room/RoomTimeline.test.ts`
  - audited the five synthetic merge hunks produced by `git merge-tree`
    between `266a3316` and `a93f5f5b`; the committed file already keeps both
    the `dev` placeholder/cache harness pieces and the review-side paginator /
    render / event-mock fixes, so no code change was required.
- `src/app/features/room/RoomTimeline.tsx`
  - audited the two synthetic merge hunks from the same merge reconstruction;
    the committed file already keeps both the `dev` live-expand reset behavior
    and the review-side renderable-entry / non-renderable rerender behavior,
    so no code change was required.

**Validation:**

- `git grep -n '<<<<<<<\|=======\|>>>>>>>' 804f112a -- src/app/features/room/RoomTimeline.test.ts src/app/features/room/RoomTimeline.tsx` ✅
  no literal conflict markers in the committed files.
- `git merge-tree --messages --merge-base bd6776ca87f3dc7a5c74f7521d1530af94fed83c 266a3316 a93f5f5b` ✅
  reproduces content conflicts in exactly those two files, and the resulting
  seven conflict hunks were checked against the committed resolution.
- `npm test` ✅
- `npm run build` ✅
- `git diff --check` ✅

**Review:**

- Independent second self-review completed against the reconstructed merge
  hunks, the current committed file contents, and the validation results
  because subagents were not authorized in this session.

**Commit:**

- `git commit --amend --no-edit`

### CINNY-008: rebase & squash merge onto `dev` (2026-03-23)

**Status:** Rebase, conflict resolution, validation, squash preparation, and
independent second self-review completed.

**Problem:** `dev` advanced by three room-timeline commits after the CINNY-008
review-fix stack forked from `bd6776ca`. Both lines of work edited
`RoomTimeline.tsx` and `RoomTimeline.test.ts`, so the review fixes had to be
rebased onto `266a3316` without losing:

- CINNY-008 review behavior (`hidden anchor`, live non-renderable re-render,
  unread divider placement, permalink filter reset hardening, off-slice false
  positives, deferred tri-state rechecks, fresh-timeline post-load filter
  bypass),
- `dev` behavior from CINNY-013d / CINNY-016 / CINNY-017 (collapsible message
  live expansion, null room backward-token preservation, live thread-filter
  updates).

**Worktree changes:**

- `src/app/features/room/RoomTimeline.tsx`
  - resolved the round-1 rebase conflicts by keeping the live collapsible
    message tracking / pagination-token work from `dev` and layering the
    CINNY-008 renderable-entry anchor, unread-divider, and room-filter-reset
    fixes on top,
  - preserved the broader CINNY-008 non-renderable live re-render path so
    edits/reactions/redactions still trigger room-mode repainting while the
    newer collapsible-message expand-once hooks continue to function.
- `src/app/features/room/RoomTimeline.test.ts`
  - merged the CINNY-008 review regression coverage with the existing
    `dev` cache / collapsible / live-thread-filter test harness,
  - restored the paginator mock's render-by-default behavior so pre-existing
    room-start/cache tests continue to render `RoomIntro` / placeholders after
    the combined suite lands.
- `src/app/features/room/RoomTimelineCollapsible.test.ts`
  - added the missing `loadCachedRoomPaginationToken(...)` room-cache mock so
    the rebased `RoomTimeline` API surface matches the full-suite harness.
- `FORK_CHANGES.md`
  - recorded this rebase/squash integration slice in the runbook.

**Validation:**

- `npm test` ✅
- `npm run build` ✅
- `git diff --check` ✅

**Review:**

- Independent second self-review completed against the final `dev..HEAD` diff,
  the conflict resolutions in `RoomTimeline.tsx` / `RoomTimeline.test.ts`, and
  the full validation results because subagents were not authorized in this
  session.

### CINNY-008: round 5 review follow-up (2026-03-23)

**Status:** Fix, coverage, validation, and independent review completed for
this slice.

**Problem:** The Round 4 deferred room-filter recheck still reused
pre-`await loadEventTimeline(...)` memo data. `handleOpenEvent(...)` called
`shouldResetRoomThreadFilterForEvent(...)` again immediately after the load,
but that second call still saw stale `threadFilteredEvents` and the old
`threadReplyCountMap`. Fallback-only thread roots that only become identifiable
from newly loaded reply counts could therefore still be misclassified as
non-thread-root events and incorrectly reset the active room filter to `all`.

**Worktree changes:**

- `src/app/features/room/RoomTimeline.tsx`
  - added a post-load room-filter reset helper that computes the thread-root
    decision directly from the freshly loaded permalink timelines instead of
    reusing pre-render memo state,
  - changed `loadEventTimeline(...)` to return the loaded linked timelines to
    the room-mode `handleOpenEvent(...)` caller,
  - updated the deferred room-mode recheck to use the freshly loaded timeline
    reply counts plus `room.findEventById(...)` and current filter refs,
    preserving the active filter for fallback-only thread roots that still
    match it after load,
  - kept the safe default of not resetting when the target event still cannot
    be found after the load completes.
- `src/app/features/room/RoomTimeline.test.ts`
  - added coverage for an unloaded fallback-only thread root whose root status
    is discoverable only after the permalink load pulls in the root plus a
    reply,
  - keeps `findEventById(...)` returning `undefined` before the load resolves
    so the regression exercises the stale post-load recheck path rather than a
    pre-seeded room lookup.

**Validation:**

- `npm test -- --run src/app/features/room/RoomTimeline.test.ts` ✅
- `npm test` ✅
- `npm run build` ✅
- `npm run typecheck` ❌
  pre-existing repo-wide baseline, unchanged by this slice.
- `npx eslint src/app/features/room/RoomTimeline.tsx src/app/features/room/RoomTimeline.test.ts` ❌
  pre-existing file-level lint baseline in these files; the slice-specific
  helper placement issue was corrected and no new lint issue remained from this
  change.
- `git diff --check` ✅

**Review:**

- Four independent Codex subagent reviews completed with no findings across:
  - the post-load `RoomTimeline.tsx` logic,
  - the fallback-only regression test realism / failure-before-fix behavior,
  - room-thread-filter / permalink behavioral regression scan,
  - runbook / validation / report accuracy.

**Commit:**

- `fix(room): CINNY-008 round 5 review findings`

### CINNY-008: round 4 review follow-up (2026-03-23)

**Status:** Fix, coverage, and validation completed for this slice.

**Problem:** The Round 3 room-thread-filter reset guard still collapsed
`matchesRoomThreadFilter(...) === undefined` into "reset to `all`". That was
still wrong for unloaded unresolved thread roots with no local metadata:
permalink / router opens could clear the active `unresolved` room filter
before `getEventTimeline(...)` had loaded the target timeline.

**Worktree changes:**

- `src/app/features/room/RoomTimeline.tsx`
  - changed `shouldResetRoomThreadFilterForEvent(...)` to preserve the
    tri-state reset result so locally unknown targets return `undefined`
    instead of forcing an immediate room-filter reset,
  - updated the room-mode `handleOpenEvent(...)` path to defer room-filter
    resets for that unknown case until after `loadEventTimeline(...)` /
    `mx.getEventTimeline(...)` loads the target timeline,
  - if the post-load recheck proves the target is actually hidden by the
    active room filter, resets back to `all` while preserving the freshly
    loaded target timeline instead of snapping back to the latest live slice.
- `src/app/features/room/RoomTimeline.test.ts`
  - fixed the existing unloaded-target regression harness so
    `findEventById(...)` keeps returning `undefined` until
    `getEventTimeline(...)` resolves,
  - added coverage that an unloaded unresolved thread root with no preloaded
    resolution / reply-count / thread metadata keeps the active `unresolved`
    filter while its target timeline loads.

**Validation:**

- `npx vitest run src/app/features/room/RoomTimeline.test.ts --no-coverage` ✅
- `npm test` ✅
- `npm run build` ✅
- `npm run typecheck -- --pretty false` ❌
  pre-existing repo-wide baseline, unchanged by this slice.
- `npx eslint src/app/features/room/RoomTimeline.tsx src/app/features/room/RoomTimeline.test.ts` ❌
  pre-existing file-level lint baseline in these files; no new lint issue kept
  from this slice.
- `git diff --check` ✅

**Review:**

- Independent second self-review completed against the deferred reset path, the
  post-load recheck, the timeline-preservation guard, and the unloaded
  unresolved-root regression because subagents were not authorized in this
  session.

**Commit:**

- `fix(room): CINNY-008 round 4 review findings`

### CINNY-008: round 3 review follow-up (2026-03-23)

**Status:** Fix + coverage added in worktree; ready to commit.

**Problem:** The Round 2 room-thread-filter reset guard treated "not present
in the currently loaded filtered slice" as equivalent to "hidden by the active
filter". Opening an older matching thread root via permalink / `eventId`
therefore reset the filter to `all` even when the target still matched the
active `resolved` / `unresolved` filter.

**Worktree changes:**

- `src/app/features/room/RoomTimeline.tsx`
  - tightened `shouldResetRoomThreadFilterForEvent(...)` so it no longer uses
    `threadFilteredEvents` as the sole source of truth for hidden-vs-matching
    decisions,
  - added metadata-aware matching checks that consult `room.findEventById(...)`,
    `room.getThread(...)`, thread-resolution state, and loaded fallback reply
    counts before deciding whether a room-level thread filter must be reset,
  - preserved the existing reset behavior for targets that are actually hidden
    by the active room filter while avoiding false-positive resets for matching
    thread roots that are simply outside the currently loaded slice.
- `src/app/features/room/RoomTimeline.test.ts`
  - added component coverage that mounting `RoomTimeline` with an `eventId`
    pointing at an unloaded resolved thread root keeps the active `resolved`
    filter intact while still loading the target timeline.

**Validation:**

- `npx vitest run src/app/features/room/RoomTimeline.test.ts --no-coverage` ✅
- `npm test` ✅
- `npm run build` ✅
- `npm run typecheck -- --pretty false` ❌
  pre-existing repo-wide `matrix-js-sdk` / Jotai / React typing baseline,
  unchanged by this slice.
- `npx eslint src/app/features/room/RoomTimeline.tsx src/app/features/room/RoomTimeline.test.ts` ❌
  pre-existing file-level lint baseline in these files; no new lint error kept
  from this slice.
- `git diff --check` ✅

**Review:**

- Independent second self-review completed against the filter-reset helper, the
  unloaded-target regression path, and the final worktree diff because
  subagents were not authorized in this session.

### CINNY-008: round 2 review follow-up (2026-03-23)

**Status:** Fix + coverage added in worktree; ready to commit.

**Round 2 verdict:** Reviewer C's permalink/thread-filter issue is
pre-existing, not introduced by `39b88ee1`.

**Why this is pre-existing:**

- Parent commit `bd6776ca` already used a direct `eventId` effect that called
  `setTimeline(getEmptyTimeline())` + `loadEventTimeline(eventId)` instead of
  routing through `handleOpenEvent()`.
- The room-thread-filter reset guard
  (`shouldResetRoomThreadFilterForEvent(...)`) already lived only inside
  `handleOpenEvent()` on `bd6776ca`; `39b88ee1` did not remove or bypass it.
- `39b88ee1` changed anchor selection for hidden targets/unread fallbacks, but
  it did not introduce the direct-router `eventId` path that bypassed the room
  filter reset.

**Worktree changes:**

- `src/app/features/room/RoomTimeline.tsx`
  - routed router/deep-link `eventId` handling through the existing
    `handleOpenEvent()` path via a ref-backed effect so permalink opens now
    honor the room thread-filter reset guard just like in-app event jumps,
  - kept the change narrowly scoped to the `eventId` path; no new timeline
    anchor math was introduced here.
- `src/app/features/room/RoomTimeline.test.ts`
  - added direct coverage for `getTimelineTargetAnchor()` falling back to the
    closest renderable entry when every candidate target is still hidden,
  - added direct coverage for `getUnreadTargetAnchor()` falling back to the
    last renderable entry when the read-up-to event lies beyond all visible
    entries,
  - added component coverage that mounting `RoomTimeline` with `eventId` while
    a room-level thread filter is active switches the filter back to `all`
    before loading the permalink target.

**Validation:**

- `npx vitest run src/app/features/room/RoomTimeline.test.ts --no-coverage` ✅
- `npm test` ✅
- `npm run build` ✅
- `npm run typecheck -- --pretty false` ❌
  pre-existing repo-wide `matrix-js-sdk` / Jotai / React typing baseline,
  unchanged by this slice.
- `npx eslint src/app/features/room/RoomTimeline.tsx src/app/features/room/RoomTimeline.test.ts` ❌
  pre-existing file-level lint baseline in these files; no new lint error kept
  from this slice.
- `git diff --check` ✅

**Review:**

- Independent second self-review completed against the exact `bd6776ca` vs
  `39b88ee1` code paths and the final worktree diff because subagents were not
  authorized in this session.

Previous task:

- CINNY-015 thread back-button scroll fix.

### CINNY-015: thread back-button scroll fix (2026-03-22)

**Status:** Initial retry commit complete; follow-up room-centering /
pagination-suppression slice ready to commit. Separate `dom.ts` coordinate fix
still pending.

**Problem:** Exiting a thread highlighted the thread root message in room mode
without reliably scrolling it into view. The room-mode `scrollToItem`
layout-effect path only made a single attempt, so when the virtualized range
already included the target index but the DOM node was not rendered on the
first layout pass, the highlight animation could run off-screen.

**Changes:**

- `src/app/features/room/RoomTimeline.tsx`
  - added room-mode retry constants plus `getNextRoomFocusRetry()` so the
    retry decision is testable,
  - carried the focused `eventId` in `focusItem`,
  - added a bounded room-only retry loop (16 ms delay, max 10 attempts) for
    focused room-event scrolls,
  - keyed retries to the current `eventId` and cleared pending timers on
    context change / unmount,
  - kept the existing thread-mode retry path separate and unchanged.
- `src/app/features/room/RoomTimeline.test.ts`
  - added regression coverage for the room-mode retry state progression.
- `e2e/live/cinny015-thread-exit-scroll.spec.ts`
  - added a bespoke live browser test that seeds a >300-message room, deep-links
    into thread view, exits via the thread banner back button, and asserts the
    thread root is back inside the viewport in room mode.

**Commit:**

- `9120e902` — `fix(scroll): retry room-mode event-target scroll on DOM miss (CINNY-015)`

**Validation:**

- `npx vitest run src/app/features/room/RoomTimeline.test.ts --no-coverage` ✅
- `npm run build` ✅
- `npm run typecheck -- --pretty false` ❌
  pre-existing repo-wide `matrix-js-sdk` / Jotai / React typing failures;
  baseline unchanged by this task.
- `npx eslint src/app/features/room/RoomTimeline.tsx src/app/features/room/RoomTimeline.test.ts` ❌
  pre-existing file-level lint failures in those files; baseline unchanged by
  this task.
- `git diff --check -- src/app/features/room/RoomTimeline.tsx src/app/features/room/RoomTimeline.test.ts` ✅
- `bash .claude/skills/cinny-live-test/run-live-tests.sh smoke` ✅
- `E2E_BASE_URL=http://localhost:8090 E2E_HOMESERVER=http://localhost:8008 E2E_USERNAME=e2e-test-bot E2E_PASSWORD=e2e-test-pw-2026 bash .claude/skills/cinny-live-test/run-live-tests.sh cinny015-thread-exit-scroll.spec.ts` ✅
  - screenshot: `test-results/cinny015-thread-exit-scroll.png`

**Review:**

- Independent second self-review completed against the committed fix and the
  live-spec diff because subagents were not authorized in this session.

### CINNY-015: explicit centering + pagination suppression follow-up (2026-03-22)

**Status:** Ready to commit.

**Problem:** The initial room-mode retry commit (`9120e902`) fixed the DOM-miss
case but still re-ran `scrollToItem()` on each retry, still used
`stopInView: true` for the initial explicit focus scroll, and allowed
virtual-paginator observer pagination to fire while that focus scroll was
settling. That left room for browser-back/thread-exit focus to stop short or
fight pagination.

**Working tree changes:**

- `src/app/features/room/RoomTimeline.tsx`
  - added `isContinuingRoomFocusRetry()` and
    `getRoomFocusScrollToItemOptions()` helpers so the room focus behavior is
    explicit and unit-testable,
  - changed the initial room focus scroll to use `stopInView: false`,
  - switched the retry loop to `requestAnimationFrame`,
  - only retries the DOM lookup/final centering after the initial
    `scrollToItem()` call instead of re-running `scrollToItem()` every frame,
  - suppresses virtual-paginator observer pagination during active room focus
    scrolls and clears suppression after final centering or cancellation.
- `src/app/hooks/useVirtualPaginator.ts`
  - added optional `shouldSuppressPagination()` support so observer-driven
    pagination can be paused during explicit focus scrolls.
- `src/app/features/room/RoomTimeline.test.ts`
  - kept retry-state coverage for `getNextRoomFocusRetry()`,
  - added helper-level coverage for the explicit `stopInView: false` focus
    scroll options,
  - added helper-level coverage that changing `eventId` cancels continuation of
    a pending room-focus retry.
- `src/app/hooks/useVirtualPaginator.test.ts`
  - added focused coverage that observer-driven pagination is skipped while
    suppression is active and resumes when suppression clears.
- `e2e/live/threads.spec.ts`
  - added a live browser regression that uses browser back from thread view and
    asserts the fixture thread root is back inside the viewport in room mode.

**Validation:**

- `npx vitest run src/app/features/room/RoomTimeline.test.ts --pool forks --poolOptions.forks.singleFork` ✅
- `npx vitest run src/app/hooks/useVirtualPaginator.test.ts --pool forks --poolOptions.forks.singleFork` ✅
- `npx vitest run --pool forks --poolOptions.forks.singleFork` ✅
- `npm run build` ✅
- `npx tsc --noEmit` ❌
  pre-existing repo-wide `matrix-js-sdk` / Jotai / React typing failures;
  baseline unchanged by this task.
- `git diff --check` ✅
- Live Playwright/browser validation not run in this session because the
  required credentials/environment were not provided.

**Review:**

- Independent second self-review completed against the working-tree diff
  because subagents were not authorized in this session.

### CINNY-012: Cinny Live Test Skill (2026-03-21)

**Status:** Phase 4 complete. All test tiers implemented.

**Problem:** Mock-heavy tests have not been sufficient for thread/edit behavior;
we need a reproducible live browser test workflow against the real app and real
homeserver behavior.

**Key investigation findings:**

- The lightest working runtime in this container is repo-local
  `npx playwright` (`1.58.2`) driving the already-installed user-profile
  Chromium at `~/.nix-profile/bin/chromium`.
- Playwright's cached Chromium fails here with missing shared libraries
  (`libglib-2.0.so.0`), so the skill should not rely on bundled browsers in
  this NixOS container.
- `https://mindroom.chat/_matrix/client/v3/login` currently advertises
  `m.login.password` in addition to SSO flows, so password-based browser login
  is possible when credentials exist.
- Public registration remains token-gated:
  `POST https://mindroom.chat/_matrix/client/v3/register` returns only
  `m.login.registration_token`.
- Existing SSH-based disposable-account provisioning is not usable in this
  container yet because `ssh mindroom` is blocked by host-key / public-key
  setup.

**Output:**

- Added `PLAN.md` with the recommended runtime approach, proposed skill
  structure, scenario matrix, edge cases, and risks.

### CINNY-008: Room Scroll Count-vs-Render Mismatch (2026-03-21)

**Status:** Complete.

**Problem:** The virtual paginator counted ALL timeline events but
`renderResolvedEvent` returned `null` for most (thread replies, reactions,
edits). With 95%+ invisible events, only ~4 messages rendered in an 80-event
window, causing infinite skeleton loading.

**Solution:** Pre-filter timeline events so the paginator operates on renderable
events only.

**Changes in `src/app/features/room/RoomTimeline.tsx`:**

1. Added `isRenderableEvent()` predicate and `getRenderableEvents()` helper
   (~L254-284) that mirror `renderResolvedEvent`'s null-return guards.
2. Memoized `renderableEvents` / `filteredLength` in the component (~L831-847).
3. Wired paginator `count` from `eventsLength` → `filteredLength`; updated
   `eventRenderer` to look up `renderableEvents[item]` instead of raw timeline
   index.
4. Updated `getInitialTimeline()` to accept optional filter params so initial
   range is computed in filtered space.
5. Guarded live-event range bump (`ct.range.start + 1, end + 1`) behind
   `isRenderableEvent` check.
6. Converted `loadEventTimeline` callback, `handleOpenEvent`, and unread
   scroll-to logic from raw `absoluteIndex` to filtered index.
7. Updated `recalibrateTimelinePagination` to accept filter opts and compute
   offsets in filtered space; plumbed through `useTimelinePagination` via a ref.
8. Kept raw `eventsLength` and `getTimelinesEventsCount` for cache persistence
   and pagination token management (unchanged).
9. Thread rendering path (`threadEvents.map()`) untouched.
10. `useVirtualPaginator.ts` not modified.

**Validation:**

- `npm run typecheck` — no new errors (only pre-existing matrix-js-sdk import
  warnings).
- `npm run build` — successful.
- `npm run lint --quiet` — no errors in changed file.

**Independent review update (2026-03-22):**

- External review report written to `REVIEW-A.md`.
- Verdict: `CHANGES REQUIRED`.
- Findings summary: 2 MAJOR issues and 1 MINOR issue remain in the filtered
  room-timeline path:
  - non-renderable live room events at bottom no longer trigger a repaint,
  - deep-links to filtered-out events can fall back to filtered index `0`,
  - cached back-pagination still has a filter-snapshot/settings race.

**Round 1 fixer update (2026-03-22):**

- Mapped non-renderable room targets back to visible anchors using raw timeline
  absolute indices. Hidden thread replies now prefer the loaded thread root;
  hidden edit/reaction/redaction targets prefer their associated visible event;
  unread targets fall forward to the next visible event when the receipt event
  itself is filtered out.
- Restored room-mode live-bottom repainting for non-renderable events
  (edits/reactions/redactions) with a no-op `setTimeline` update so visible
  relation-backed UI refreshes without shifting the filtered range.
- Changed unread divider placement to compare raw absolute indices from the
  loaded timeline instead of rendered-only predecessor ids, so hidden
  read-receipt targets still produce a visible `New Messages` boundary.
- Aligned room thread overview counts and room thread filtering with the same
  fallback reply-count map used by the visible thread indicator, so fallback-only
  thread roots are no longer omitted from `All / Resolved / Unresolved`.
- Added focused regression coverage in
  `src/app/features/room/RoomTimeline.test.ts` for:
  - `isRenderableEvent()`,
  - fallback-only thread roots,
  - hidden target anchor mapping,
  - hidden unread anchors/dividers,
  - live non-renderable bottom re-rendering.

Validation completed for this fixer slice:

- `npm test -- src/app/features/room/RoomTimeline.test.ts`
- `npm test`
- `npm run build`
- `git diff --check`

Validation notes:

- `npm run typecheck` still fails on the pre-existing repo-wide baseline of
  `matrix-js-sdk` and Jotai typing errors outside this slice.
- `npm run lint --quiet` is not runnable in this container because the script
  shells out to `yarn` and `yarn` is not installed. A targeted
  `npx eslint src/app/features/room/RoomTimeline.tsx src/app/features/room/RoomTimeline.test.ts`
  run also reports a large pre-existing lint baseline in `RoomTimeline.tsx`.

Independent self-review note:

- Completed a second self-review against the final diff after validation.
  Checks focused on:
  - preserving paginator math in filtered space,
  - avoiding focus retries on hidden targets that can never render,
  - keeping unread-scroll behavior unchanged for visible receipts while fixing
    hidden-receipt anchors,
  - ensuring fallback-only thread-root detection now matches the visible thread
    indicator path rather than introducing a new divergent predicate.

Previous task:

- CINNY-003 frontend support for MindRoom thread summary events.

Requested behavior:

- Render events carrying `io.mindroom.thread_summary` as compact summary cards in
  the timeline instead of plain notices.
- Keep backward compatibility with the legacy `msgtype: "m.thread.summary"`
  variant by checking the metadata field independent of `msgtype`.
- Prefer summary text in the room thread overview list when a loaded thread
  contains a summary event.

Planned implementation shape:

- Add a shared parser/helper for `io.mindroom.thread_summary` content so
  timeline rendering and thread-list preview logic reuse one metadata contract.
- Add a dedicated message renderer for the summary card using existing `folds`
  tokens and `vanilla-extract` styling, keeping the card compact and visually
  distinct but low-noise.
- Hook `RenderMessageContent.tsx` to dispatch to the summary card before normal
  msgtype-specific branches so both `m.notice` and legacy msgtypes render
  through one path.
- Update `RoomThreadOverview.tsx` to scan loaded thread events for the latest
  summary event and use its text as the preview when available.

Validation / review plan for this slice:

- Add focused unit coverage for summary metadata parsing.
- Extend thread overview tests for summary-preview selection.
- Run targeted tests plus `npm run build`.
- Do an explicit second self-review after implementation because no separate
  review agent is being used in this turn.

Implementation status (worktree, 2026-03-21):

- Added `src/app/components/message/mindroomThreadSummary.ts` to parse
  `io.mindroom.thread_summary` from top-level or `m.new_content` payloads and
  normalize summary text, generated timestamp, and message count.
- Added `src/app/components/message/mindroomThreadSummaryCard.css.ts` and
  `MindroomThreadSummaryCard` in `MsgTypeRenderers.tsx` to render a compact AI
  summary card with a subtle label, message-count badge, and generated-at time.
- Updated `RenderMessageContent.tsx` to route any event carrying summary
  metadata through the summary card before normal `msgtype` branches, which
  keeps `m.notice` and legacy `m.thread.summary` events on the same renderer.
- Updated `RoomThreadOverview.tsx` to prefer the latest loaded summary-event
  text for thread previews instead of the root-message fallback when available.
- Added focused tests in:
  - `src/app/components/message/mindroomThreadSummary.test.ts`
  - `src/app/components/RenderMessageContent.test.ts`
  - `src/app/features/room/RoomThreadOverview.test.ts`

Validation completed for this slice:

- `npm test -- src/app/components/message/mindroomThreadSummary.test.ts src/app/components/RenderMessageContent.test.ts src/app/features/room/RoomThreadOverview.test.ts`
- `npm run build`

Validation note:

- `npm run typecheck` still fails on a large pre-existing repo baseline unrelated
  to this slice (numerous `matrix-js-sdk` export/type errors and Jotai typing
  issues across untouched files). No new typecheck regression was isolated to
  the thread-summary files during this task.

Independent review note:

- Completed a second self-review against the final diff after validation. Main
  checks were:
  - summary detection stays metadata-driven rather than `msgtype`-driven,
  - edited/wrapper payloads (`m.new_content`) are handled in both renderer and
    thread-preview paths,
  - thread overview falls back to existing root preview behavior when no summary
    event is loaded,
  - summary card styling stays within existing `folds` / `vanilla-extract`
    patterns and remains compact.

Review follow-up status (worktree, 2026-03-21):

- Fixed the code-review regression where edited summary events lost
  `io.mindroom.thread_summary` metadata during render-time edit resolution.
- Added `getLatestMessageContent()` in `src/app/utils/room.ts` so edited content
  keeps the edited body while selectively carrying forward missing MindRoom
  metadata keys from the original event instead of blindly reusing all original
  content fields.
- Routed `RoomTimeline.tsx`, `RoomPinMenu.tsx`, `Notifications.tsx`, and
  `RoomThreadOverview.tsx` through that helper so edited summaries continue to
  render as summary cards outside the main timeline too.
- Updated `src/app/components/message/mindroomThreadSummary.ts` so when an event
  includes `m.new_content`, summary text prefers the edited body over stale
  `io.mindroom.thread_summary.summary` text while still falling back to original
  metadata when the replacement content omits it.
- Added regression coverage for:
  - summary detection when `m.new_content` lacks summary metadata,
  - edited summary text winning over stale metadata summary text,
  - thread overview previewing the edited summary body when replacement content
    omits metadata.

Validation completed for review follow-up:

- `npm test -- --run mindroomThreadSummary.test.ts RenderMessageContent.test.ts RoomThreadOverview.test.ts`
- `npm run build`
- `npm run typecheck`
  - still fails on the existing repo baseline unrelated to this slice
    (`matrix-js-sdk` export/type mismatches, Jotai typing issues, and other
    long-standing errors across untouched files).
- `npm run lint`
  - cannot complete in this workspace because the repo script invokes `yarn`
    and `yarn` is not installed here (`sh: line 1: yarn: command not found`).

Independent review follow-up note:

- Completed a second self-review after the fix pass. Main checks were:
  - the new edited-content helper preserves only missing MindRoom metadata and
    does not keep stale formatting/body fields from the original event,
  - summary text now follows the edited body whenever `m.new_content` is
    present,
  - summary rendering and thread-preview behavior stay aligned across timeline,
    notifications, and pinned-message surfaces,
  - the new regressions fail against the reviewed bug shape and pass with the
    final implementation.

## CINNY-006 Frontend Slice (2026-03-21)

- Added the room-level thread overview / resolve-unresolve frontend slice in this
  worktree, including:
  - `RoomThreadOverview` with unresolved/resolved/all filters and per-thread actions.
  - room thread list/resolution helpers and focused tests.
  - resolved-state styling on thread summary chips.
- Fixed the thread overview layout regression by rendering `RoomThreadOverview`
  above the scroll container in `src/app/features/room/RoomTimeline.tsx`, so
  backward pagination no longer pushes it out of view.
- Compacted the overview container into a toolbar-like header by reducing outer
  spacing, lowering the height cap to `min(18vh, 12rem)`, tightening thread-row
  density, and keeping internal vertical scrolling in
  `src/app/features/room/RoomThreadOverview.css.ts`.
- Enabled Matrix SDK thread support during client bootstrap in
  `src/client/initMatrix.ts`, so room thread loading/counts can use the SDK
  thread model instead of staying empty in thread-support-disabled mode.
- While thread discovery is still incomplete, zero-count filter chips now render
  `-` instead of `0` to avoid implying a confirmed empty result before loading settles.
- Investigation confirmed room thread loading stalled because app code never
  called `room.createThreadsTimelineSets()` before `room.fetchRoomThreads()` in
  server-side list mode.
- Investigation also confirmed the current overview placement test only proves
  the component is outside the inner `Scroll`; a real sticky wrapper/test is
  still a separate follow-up if the product wants browser-level stickiness
  verified.
- Validation status:
  - Passed: `npx vitest run` (`64` files / `313` tests)
  - Passed: `npm run build`
  - Passed: `git diff --check`
  - Known pre-existing baseline: `npm run typecheck -- --pretty false` still fails with broad repo-wide `matrix-js-sdk` named-export/type errors and unrelated React/Jotai typing issues outside the CINNY-006 files touched here.
- Follow-up status (worktree, 2026-03-21):
  - Committed `104080f3` (`fix(threads): call createThreadsTimelineSets before fetchRoomThreads`) after validating `npx vitest run src/app/features/room/roomThreadList.test.ts` and `npm run build`.
  - That fix now bootstraps `room.createThreadsTimelineSets()` before the first server-side thread fetch and resets stale SDK thread listeners when a room had already latched `threadsReady` without timeline sets.
  - Tightened `RoomThreadOverview.tsx` so the title, loading summary, and filter chips sit inline when space allows, which keeps the overview closer to a compact toolbar than a separate panel.
  - Removed the extra "loading more threads" row once thread entries are already visible; the inline summary text now carries that state instead.
- Validation follow-up (worktree, 2026-03-21):
  - Passed: `npx vitest run src/app/features/room/RoomThreadOverview.test.ts src/app/features/room/RoomTimeline.test.ts`
  - Passed: `npm run build`
  - Passed: `git diff --check`
  - Known pre-existing baseline: `npm run typecheck -- --pretty false` still fails with broad repo-wide `matrix-js-sdk` named-export/type errors and unrelated React/Jotai typing issues outside the CINNY-006 files touched here; no new errors were isolated to `RoomThreadOverview.tsx` or `RoomThreadOverview.css.ts`.
  - Known workspace limitation: `npm run lint` cannot complete here because the repo script shells out to `yarn`, and `yarn` is not installed (`sh: line 1: yarn: command not found`).
- Independent review follow-up note:
  - Completed a second self-review after the compact-UI pass. Main checks were:
    - filter labels/counts and per-thread actions stayed unchanged,
    - the overview still relies on the existing placement/sticky behavior and only changed its internal density,
    - the smaller height cap still preserves internal scrolling instead of clipping thread entries,
    - loading/error states still surface clearly without the removed secondary loading row.
- Resilience follow-up (worktree, 2026-03-21):
  - `src/app/features/room/roomThreadList.ts` now treats thread timeline-set bootstrap as best effort. `ensureThreadTimelineSets()` warns when SDK thread support is disabled, when `createThreadsTimelineSets()` throws, and when the SDK leaves `threadsTimelineSets` empty, instead of throwing before the first fetch.
  - `loadRoomThreads()` now catches `room.fetchRoomThreads()` failures and leaves the overview on sync-derived `room.getThreads()` data instead of surfacing a Retry-only empty state.
  - `roomThreadListIsComplete()` now treats missing thread timeline sets as locally complete so sync-derived thread lists do not stay stuck in an incomplete/loading state.
  - Removed the older `threadsReady` / thread-listener reset recovery hack from `roomThreadList.ts`; that workaround is no longer needed once the bootstrap failure path is non-fatal.
- Validation follow-up (worktree, 2026-03-21):
  - Passed: `npx vitest run src/app/features/room/roomThreadList.test.ts`
  - Passed: `npm run build`
  - Passed: `git diff --check -- src/app/features/room/roomThreadList.ts src/app/features/room/roomThreadList.test.ts`
  - Known pre-existing baseline: `npm run typecheck -- --pretty false` still fails with broad repo-wide `matrix-js-sdk` named-export/type errors and unrelated React/Jotai typing issues outside this thread-list change.
  - Known workspace limitation: `npm run lint` still cannot complete here because the repo script shells out to `yarn`, and `yarn` is not installed (`sh: line 1: yarn: command not found`).
- Independent review follow-up note:
  - Completed a second self-review after the resilience patch. Main checks were:
    - warnings only replace the fatal bootstrap path,
    - server-side pagination remains unchanged when a live thread timeline exists,
    - missing timeline sets now fall back to sync-derived completeness instead of hanging in a loading state,
    - the obsolete wedged-room recovery code and its focused test were removed together.

## CINNY-006b Thread Filter Planning (2026-03-22)

- Planning-only work in this worktree. No implementation was done for CINNY-006b in this step.
- Investigation findings:
  - Room message visibility is derived from `getRenderableEvents(...)` in
    `src/app/features/room/RoomTimeline.tsx`, and that filtered event list also
    drives initial range setup, pagination recalibration, event jumps, and final
    render output.
  - The main room timeline still suppresses thread replies, so the recommended
    first pass treats the new resolved/unresolved filter as a filter over
    thread-root room messages already shown in the main room view, not as a
    request to inject reply events into room view.
  - `RoomThreadOverview.tsx` currently owns the selected filter locally, while
    `useRoomThreadResolutionMap(...)` in
    `src/app/features/room/useRoomThreadResolution.ts` already provides the
    resolved/unresolved status keyed by thread root ID.
- Recommended plan recorded in `PLAN.md`:
  - Move selected filter ownership into `RoomTimeline` and default it to `all`
    so normal room behavior remains unchanged until the user opts into a filter.
  - Convert `RoomThreadOverview` into a controlled toolbar-only component that
    keeps the existing counts/loading state but drops the separate thread list
    panel/body.
  - Add shared thread-filter matching helpers in
    `src/app/features/room/threadUtils.ts`.
  - Thread the active room-thread filter through all `RoomTimeline.tsx` paths
    that already depend on `getRenderableEvents(...)`.
  - Add focused tests for the matcher, the controlled toolbar, and the filtered
    room timeline behavior.
- Next step:
  - Implement the planned room timeline filter wiring and validate with focused
    Vitest coverage plus build/typecheck checks.
- Validation (planning slice, 2026-03-22):
  - Passed: `git diff --check -- PLAN.md FORK_CHANGES.md`
  - Passed: `npm run build`
  - Known pre-existing baseline: `npm run typecheck -- --pretty false` still
    fails with broad repo-wide `matrix-js-sdk` named-export/type errors, React
    JSX return-type mismatches, and Jotai atom typing issues outside this
    planning-only documentation change.
  - Known workspace limitation: `npm run lint` still cannot complete here
    because the repo script shells out to `yarn`, and `yarn` is not installed
    (`sh: line 1: yarn: command not found`).
- Independent review follow-up note:
  - Completed a second self-review after writing the plan. Main checks were:
    - the plan routes the filter through the same room-timeline code paths that
      already own pagination/range math,
    - the largest product assumption (thread-root-only filtering vs surfacing
      replies in room view) is called out explicitly as a risk/open question,
    - the plan recommends `all` as the default to preserve existing room-open
      behavior,
    - navigation/unread-jump ambiguity under active filters is documented as a
      required product decision before implementation.

## CINNY-006b Thread Filter Implementation (2026-03-22)

- Implemented the room timeline thread filter in
  `src/app/features/room/RoomTimeline.tsx`:
  - added local `threadFilter` state with `all` as the default,
  - derived `threadFilteredEvents` from the existing renderable room events plus
    `useRoomThreadResolutionMap(room)`,
  - switched the room paginator/event renderer to the filtered event array while
    keeping thread-view rendering unchanged,
  - clamped the visible room range against the filtered event count so filter
    changes do not leave the room timeline pointed past the new array bounds.
- Converted `src/app/features/room/RoomThreadOverview.tsx` into a controlled,
  toolbar-only component:
  - removed the separate thread list body and per-thread action rows,
  - kept the existing thread-count loading/error sources,
  - made filter chips controlled via `filter` / `onFilterChange` props from
    `RoomTimeline`.
- Removed now-unused list/panel body styles from
  `src/app/features/room/RoomThreadOverview.css.ts`.
- Updated focused tests:
  - `src/app/features/room/RoomThreadOverview.test.ts` now covers controlled
    chip state/callbacks, placeholder counts, and retry UI.
  - `src/app/features/room/RoomTimeline.test.ts` now checks that the overview
    receives the default `all` filter and change handler from `RoomTimeline`.
- Validation (implementation slice, 2026-03-22):
  - Passed:
    `npx vitest run src/app/features/room/RoomThreadOverview.test.ts src/app/features/room/RoomTimeline.test.ts`
  - Passed: `npm run build`
  - Passed:
    `git diff --check -- src/app/features/room/RoomThreadOverview.tsx src/app/features/room/RoomThreadOverview.css.ts src/app/features/room/RoomTimeline.tsx src/app/features/room/RoomThreadOverview.test.ts src/app/features/room/RoomTimeline.test.ts`
- Independent review follow-up note:
  - Completed a second self-review after the implementation pass. Main checks
    were:
    - the overview is now a controlled toolbar and no longer owns hidden local
      filter state,
    - room-view indices/pagination read from the filtered event array instead of
      the unfiltered one,
    - thread-view rendering and thread pagination paths were left untouched,
    - the filtered room range is clamped so toggling the filter does not render
      stale out-of-bounds indices.

## Thread Cache Plan (2026-03-08)

Problem statements this plan is solving:

- Problem 1: opening a long thread can jump near the bottom and then visibly append more replies a moment later because the current thread-open path still walks network pagination toward the live end after first render.
- Problem 2: fetched thread relation pages are not treated as an app-owned persistent archive, so reopening the same long thread may require downloading replies again even though the user already viewed them before.
- Problem 3: the current thread view does not guarantee "show cached content first, reconcile with network second," which makes the app feel worse than mobile chat apps that are primarily local-first.
- Problem 4: thread history growth is currently constrained by whatever the Matrix SDK sync store happens to keep in memory/sync state; the product goal for MindRoom mobile/web is much more aggressive local retention, closer to "download everything locally until browser/device quota says stop."

Desired product behavior:

- Opening a thread should render locally cached replies immediately when available.
- After the cached render, the app should fetch only the latest reply slice needed to reconcile the tail, instead of walking the entire thread from the root to the newest reply.
- Replies loaded from thread view should be persisted into an app-owned IndexedDB archive so reopening the thread reuses them.
- Older cached thread replies should be used before issuing network pagination requests.
- Cache policy should default to "very large / effectively unbounded within platform quota" for now. A user-facing size cap/cleanup setting is a future follow-up, not a prerequisite for the local-first behavior change.

Implementation sequence for this branch:

1. Add a dedicated IndexedDB-backed thread reply cache module.
   - Store raw thread reply events keyed by room/thread/event id.
   - Keep enough metadata to query the latest cached slice quickly and to fetch older cached pages later.
   - Add focused tests for merge/order/dedupe behavior.
2. Change thread open to be cache-first.
   - Hydrate thread view from cached replies immediately.
   - Stop relying on full forward pagination to reach the tail on open.
   - Reconcile with a latest network slice fetch and merge/persist the results.
3. Change thread pagination to be cache-aware.
   - On "Load Older Messages," consume older cached replies first.
   - Only hit the network when the local archive does not have the requested older slice.
   - Persist any newly fetched older replies back into the archive.
4. Follow-up work after the above is stable:
   - optional cache-size/cleanup setting in UI,
   - broader room-level archival strategy beyond thread relation pages,
   - instrumentation for cache-hit/cache-miss behavior on mobile.

Status as of 2026-03-08:

- Step 1 is committed in `08ef697a` (`feat(thread-cache): add persistent thread reply archive`).
- Step 2 and Step 3 are committed in `3b1d72ef` (`feat(thread): hydrate from local cache before server pagination`).
- Additional broader-cache work is now split:
  - committed in `0f1331d1` (`feat(cache): raise persisted room timeline archive limit`) to lift the SDK's own saved `/sync` retention ceiling,
  - committed in `8c24cc5f` (`feat(room-cache): add persistent room history archive`) to add an app-owned room-event archive for paginated main-timeline history that the SDK does not persist itself,
  - in the current working tree to teach the main room timeline to use that archive before network scrollback.

Execution notes:

- Keep commits isolated by concern: plan/docs, cache infrastructure, cache-first thread open/latest-tail reconcile, cache-aware older pagination.
- Validate each step with targeted tests plus `npm run build` when feasible.
- Preserve current behavior for targeted event opens inside a thread: those should still open the requested event, not auto-jump to the latest reply.

Thread open follow-up (2026-03-08):

- Problem:
  - Plain thread opens could still render the top of the thread briefly and only then jump to the bottom.
  - Root cause: cached/live thread events can render before the async "open at latest reply" flow finishes and schedules the final bottom scroll.
- Fix direction:
  - Keep an explicit "thread open to latest is still pending" state for non-targeted thread opens.
  - While that state is active, pin the first cached/live thread render to bottom in a `useLayoutEffect` before paint.
  - Clear that pending state once the async thread-open reconciliation completes, leaving targeted thread/event opens unchanged.
- Validation:
  - Add focused unit coverage for the bottom-pin gate.
  - Re-run thread render/timing tests plus `npm run build`.

## Multi-Account Support Plan (2026-03-08)

Detailed design document:

- `.docs/MULTI_ACCOUNT_PLAN.md`

Problem statements this plan is solving:

- Problem 1: the app is still single-session at boot. Routing and startup gate on `getFallbackSession()` in `src/app/pages/Router.tsx` and `src/app/pages/client/ClientRoot.tsx`, so there is no first-class concept of "stored accounts" or "active account".
- Problem 2: the bottom sidebar avatar is only a Settings trigger (`src/app/pages/client/sidebar/SettingsTab.tsx`), so there is no UI surface for "switch account", "add account", or "show me which account I am using".
- Problem 3: core persistence is singleton-scoped, not account-scoped. Current storage/db names such as `cinny_access_token`, `web-sync-store`, `crypto-store`, `mindroom-room-event-cache`, and `mindroom-thread-event-cache` would collide across accounts.
- Problem 4: several integrations still assume one global account session, including service-worker media auth (`src/index.tsx`, `src/sw.ts`) and iOS push profile/token helpers (`src/app/utils/iosPush.ts`).
- Problem 5: a naive "render multiple avatars and swap the client object" implementation would be fragile and hard to maintain because almost the whole app reads one `MatrixClient` from context and assumes it is the active singleton.

Desired product behavior:

- The sidebar should show the active account clearly and expose a fast account switcher at the bottom.
- Users should be able to add multiple Matrix accounts, including accounts on different homeservers.
- Switching accounts should feel fast and preserve each account's own navigation state when possible.
- Logging out one account should not destroy other stored accounts.
- Room/thread caches, SDK sync stores, crypto stores, and per-account push/session state should be isolated so accounts do not leak into each other.

Chosen architecture for phase 1:

- Support multiple stored accounts, but only one active `MatrixClient` at a time.
- Keep the existing "one active client in React context" mental model for the rest of the app.
- Do not try to run multiple live Matrix clients simultaneously in the same UI process for the first version.

Why this is the right first design:

- It matches the current app architecture, where nearly all hooks/components depend on one active `MatrixClient`.
- It avoids a large second-order rewrite of unread state, notifications, crypto, and room lists.
- It is more battery-friendly and easier to reason about on iOS.
- It still solves the main product need: fast account switching with separate avatars and per-account persistence.

Non-goals for the first multi-account release:

- No simultaneous multi-account sync in one foreground UI session.
- No merged cross-account inbox/unread counters.
- No cross-account search.
- No background hydration of every stored account's room/thread caches beyond what the homeserver push pipeline already provides.

Recommended data model:

- Introduce a real persisted session registry, for example:
  - `MultiAccountStore = { version: 1, activeSessionId?: string, sessions: StoredSession[] }`
  - `StoredSession = { sessionId, baseUrl, userId, deviceId, accessToken, refreshToken?, expiresInMs?, lastUsedAt, lastKnownDisplayName?, lastKnownAvatarUrl? }`
- `sessionId` should be a stable opaque identifier derived from `{baseUrl,userId,deviceId}` or generated once and persisted.
- Deliberately do not migrate the old fallback single-session keys. The first multi-account build may log existing users out once; they can sign in again cleanly.

Storage and cache isolation plan:

- Namespace every session-bound persistence layer:
  - Matrix sync store: `web-sync-store::<sessionId>`
  - Matrix crypto store: `crypto-store::<sessionId>`
  - room cache DB: `mindroom-room-event-cache::<sessionId>`
  - thread cache DB: `mindroom-thread-event-cache::<sessionId>`
  - iOS push profile/tag state: per-session keys instead of one global key
  - any access-token lookup helpers should read the active session record, not `cinny_access_token` directly
- Keep existing user-scoped UI preference atoms (`navToActivePath`, opened folders, closed categories) keyed by `userId`; they already align reasonably well with account switching.
- Do not preserve legacy singleton store names. Multi-account support should start with session-scoped store names only.

Boot and switching model:

1. App boot resolves the session registry, not `getFallbackSession()`.
2. If there is no stored account, route to auth as today.
3. If there is an active account, load exactly one `MatrixClient` for that session and provide it via `MatrixClientProvider`.
4. When switching accounts:
   - persist current account metadata/navigation state,
   - stop the active client cleanly,
   - load the target session's client with its own store names,
   - push the new active session to the service worker/native helpers,
   - navigate to that account's last path or a safe default (`/home`).

Sidebar/UI design:

- Replace the single bottom avatar/settings trigger with an account rail.
- Proposed bottom section:
  - active account avatar button
  - up to 2-4 recent secondary avatars stacked or listed underneath
  - `+` button for `Add account`
- Interaction model:
  - clicking the active avatar opens account menu/settings
  - clicking another avatar switches immediately to that account
  - long-press/right-click/menu opens account actions (`Switch`, `Open settings`, `Logout this account`, later `Remove from device`)
- On mobile, keep the same concept but use a popover or bottom sheet instead of relying on hover.

Auth/add-account flow:

- Add an `Add account` entry point that reuses the existing login/register screens but does not destroy the current stored account.
- After successful login/register:
  - append or update the session registry entry,
  - set the new account active,
  - return to the main app shell.
- Keep first-account login behavior unchanged for users who only ever use one account.

Logout/removal semantics:

- `Logout this account` should remove only the selected session's tokens/stores/caches/pusher registration.
- If the removed account was active and other accounts remain, switch to the most recently used remaining account.
- Add a separate destructive action later for `Remove all accounts and local data`.
- Current global `window.localStorage.clear()` and `delete all indexedDB databases` behavior must be replaced with per-session cleanup plus an optional global wipe path.

Service worker / media auth / push implications:

- Service-worker media auth should source its credentials from the active session registry entry, not raw global localStorage keys.
- On account switch, immediately push the new active session to the service worker.
- iOS push helpers need to become session-aware:
  - store pusher/profile metadata per session,
  - disable pusher only for the account being logged out,
  - allow multiple Matrix accounts to keep server-side pusher registrations if the user wants notifications from each.

Implementation sequence:

1. Session registry layer.
   - Add `MultiAccountStore`.
   - Add helpers for `getActiveSession`, `putSession`, `removeSession`, `setActiveSession`.
   - Remove the old fallback-session boot assumption instead of preserving it.
2. Session-scoped store naming.
   - Teach Matrix init, room cache, and thread cache code to use session-specific store names.
   - Replace global logout/cache-clearing with session-aware cleanup helpers.
3. Client boot/switching shell.
   - Update `Router.tsx` and `ClientRoot.tsx` to boot from the active session registry entry.
   - Add a switching state machine so changing accounts is a first-class transition, not a full "pretend logout/login" hack.
4. Sidebar/UI.
   - Replace the current bottom settings avatar with an account rail / account menu.
   - Add `Add account`, `Switch account`, and `Logout this account` flows.
5. Native/service integration follow-through.
   - Update service-worker session posting.
   - Update iOS push/session-bound helpers.
   - Audit any remaining direct reads of `cinny_access_token`, `cinny_user_id`, `cinny_device_id`, and `cinny_hs_base_url`.
6. Hardening.
   - Regression tests for migration, switching, per-session cleanup, and route restoration.
   - Optional follow-up: move native iOS credentials out of localStorage into Keychain-backed storage.

Estimated size:

- Session registry + migration + store names: medium-large, roughly 250-500 lines of production code plus tests.
- Boot/switching shell: medium-large, roughly 200-400 lines plus tests.
- Sidebar/account UI: medium, roughly 150-300 lines plus tests.
- Push/service/auth cleanup and hardening: medium, roughly 150-300 lines plus tests.
- Total pragmatic first version: roughly 1 to 2 weeks of careful work, depending on how much UI polish and migration coverage we want in the first pass.

Recommended first implementation commit after this design:

- `feat(accounts): add persisted session registry`

That is the correct first step because it creates the account model without carrying a fallback compatibility layer. Once that exists, the rest of the feature can be built as isolated commits instead of one tangled rewrite.

Status as of 2026-03-08:

- The first implementation slice is now done:
  - persisted session registry,
  - session-scoped SDK stores and room/thread caches,
  - active-session boot in router/client init,
  - add-account auth entry path,
  - first-pass bottom account rail,
  - session-aware service-worker/media auth wiring,
  - session-aware iOS push local state.
- The next account-management slice is also now done:
  - active avatar opens an account manager modal,
  - inactive accounts can be removed from device without affecting the active one.
- The next hardening slice is also now done:
  - route-session guards are covered by focused tests,
  - `ClientRoot` active-session switching is covered by focused tests.
- The next route-restoration hardening slice is now also done:
  - active-account route persistence is covered explicitly,
  - account switching reuses only validated in-app stored paths,
  - invalid or missing stored paths fall back to `/home`.
- A follow-up stability fix is also now done:
  - session-store snapshots used by `useSyncExternalStore` are referentially stable while storage is unchanged,
  - SSO/session-activation no longer risks React rerender loops from freshly parsed session objects on every snapshot read.
- A follow-up auth/bootstrap noise fix is also now done:
  - missing delegated-auth metadata no longer gets re-labeled as a fake OIDC validation failure by `ServerConfigsLoader`,
  - add-account / startup logs stay focused on the real transport result instead of a secondary misleading validation error.
- A follow-up auth-routing fix is also now done:
  - auth-route normalization preserves `?addAccount=1` instead of stripping it,
  - add-account login/register flows can now stay on the auth page even when another session is already active.
- A follow-up client-bootstrap fix is also now done:
  - `ClientRoot` passes its concrete `mx` instance directly into `ServerConfigsLoader`,
  - server-config bootstrap no longer depends on `useMatrixClient()` at that seam,
  - second-account SSO login no longer crashes on `MatrixClient not initialized!` before the protected client shell finishes booting.
- A follow-up tightening fix is also now done:
  - `ServerConfigsLoader` no longer has any context fallback path,
  - bootstrap server-config loading requires an explicit `mx` instance,
  - the prior `ServerConfigsLoader` context-wrapper crash path is removed entirely instead of being left dormant in the bundle.
- A follow-up multi-account crypto-store fix is also now done:
  - Rust crypto IndexedDB is now session-scoped too, via an explicit `cryptoDatabasePrefix` passed to `initRustCrypto(...)`,
  - second-account login no longer reuses the default shared `matrix-js-sdk::matrix-sdk-crypto*` wasm store and crash with "the account in the store doesn't match the account in the constructor",
  - session-aware cleanup paths now also delete the matching Rust crypto IndexedDB databases, so logout/remove-account/clear-cache stays symmetric with initialization.
- A follow-up rust-crypto hardening fix is now also done:
  - active rust-crypto prefixes are now keyed by both `sessionId` and `deviceId`, so re-authing the same account on a different device does not reopen the previous device's wasm store,
  - live-client cleanup fallbacks now derive the same session/device-scoped prefix from `MatrixClient` identity when local session storage is missing,
  - cleanup also deletes the older session-only rust-crypto database names so the current device-scoped path remains compatible with prior session-only store naming.
- A local Playwright harness is now also in place for auth and multi-account verification:
  - `@playwright/test` is wired up with NixOS-friendly system Chromium detection in `playwright.config.ts`,
  - `scripts/with-mindroom-tunnel.sh` tunnels local `127.0.0.1:8808` to the remote `ssh mindroom` homeserver on `localhost:8008`,
  - `scripts/create-mindroom-e2e-account.sh` provisions disposable test accounts directly on the remote homeserver via its registration token,
  - `scripts/test-e2e-mindroom.sh` combines provisioning, tunneling, and Playwright execution into one command,
  - `e2e/password-login.spec.ts` and `e2e/auth-router.spec.ts` give stable password-login and direct-router smoke coverage,
  - `e2e/multi-account.spec.ts` now verifies that the add-account flow stays on the active explicit homeserver instead of jumping back to the default server.
- Auth router handling is now tightened further:
  - add-account mode is preserved through reset-password links and reset-password completion,
  - the register fallback path that redirects back to login also preserves `?addAccount=1`,
  - the account-switcher add-account action now preserves the active session's homeserver in its login route,
  - a dedicated router smoke spec now covers direct login/register/reset-password route entry with explicit homeserver segments.
- Detailed local-run instructions now live in `.docs/E2E_TESTING.md`, including literal router URLs, SSH/tunnel assumptions, and recommended agent workflows.
- A more exhaustive one-off live browser validation pass is now also done and recorded in `.docs/LIVE_BROWSER_VALIDATION.md`:
  - local Chromium coverage now includes same-account re-login, three-account switching, multi-tab propagation, storage cleanup inspection, and homeserver outage recovery,
  - deployed `chat.lab.mindroom.chat` auth-route shells are validated directly even though full deployed login remains SSO-gated,
  - one real browser-found bug was fixed during this pass: inactive-session cleanup now deletes the real browser IndexedDB sync-store name instead of the constructor alias.
- Validation completed for this slice:
  - full `npm run test`,
  - `npm run build`,
  - targeted eslint pass on touched files,
  - a full local live browser batch (`12` Playwright tests) against the SSH-tunneled homeserver,
  - deployed auth-shell Playwright coverage against `https://chat.lab.mindroom.chat`.
- Still intentionally not finished in this slice:
  - broader account-management polish beyond the first modal/rail,
  - full deployed authenticated multi-account coverage is still blocked by SSO-only login without provider credentials,
  - native iOS/Safari-specific multi-account behavior is still not covered by the browser harness,
  - later per-account push/account management UX improvements.

Recommended next implementation commit:

- `test(e2e): cover SSO add-account and deployed authenticated flows`

## Review Hardening (2026-03-09)

Resolved review blockers from the zero-tolerance PR pass and follow-up typed review:

- `src/client/initMatrix.ts`
  - removed the `.ts` crypto-api import suffix,
  - narrowed `clearLoginData()` to app-owned IndexedDB stores only,
  - awaited database deletion completion before reload,
  - cleared per-session nav/push/cache state during full login-data reset.
- `src/app/components/ServerConfigsLoader.tsx`
  - replaced root `matrix-js-sdk` imports with stable lib-path type imports,
  - kept the explicit-`mx` bootstrap seam,
  - fixed the regression tests around auth-metadata failure handling.
- `src/app/utils/iosPush.ts`
  - restored compatibility with the legacy global `settings.nativePushNotifications`
    value when no per-session iOS push preference exists yet.
- `src/app/state/sessions.ts`
  - allowed cached display name / avatar URL / avatar data URL fields to be
    explicitly cleared instead of sticking forever via `??`.
- `src/app/pages/client/sidebar/SettingsTab.tsx`
  - clears cached avatar thumbnail data when the active account removes its
    avatar.
- `src/app/pages/client/ClientRoot.tsx`
  - redirects to login if the active session disappears, avoiding the
    last-account multitab `Heating up` dead-end.
- Follow-up hardening after the next review pass:
  - `src/client/initMatrix.ts`
    - `clearLoginData()` now also deletes the legacy unscoped `crypto-store`
      IndexedDB used by older builds, so upgraded users do not retain stale
      crypto state after a full login-data reset.
  - `src/client/initMatrix.test.ts`
    - removed stale `lastUsedAt` bootstrap fields from `initClient()` tests
      after narrowing `ClientBootstrapSession`,
    - fixed the IndexedDB mock request callback typing by invoking `onsuccess`
      with an actual `IDBOpenDBRequest` receiver,
    - extended the login-data reset coverage to assert deletion of the legacy
      plain `crypto-store` database.
- Final cleanup hardening before merge:
  - `src/client/initMatrix.ts`
    - `clearLoginData()` now treats legacy unscoped SDK databases as app-owned
      only when this app's old `cinny_*` auth footprint is still present,
      avoiding same-origin deletion of another Matrix app's generic SDK stores,
    - logout/reset flows now explicitly purge legacy `cinny_*` session keys.
  - `src/app/state/sessions.ts`
    - clearing or rewriting the session registry also removes legacy
      `cinny_*` session keys so stale auth material does not survive reset.
  - `src/app/pages/client/sessionRouteRestore.ts`
    - rejects malformed protocol-relative paths like `//evil.com` and falls
      back to `/home` instead of treating them as valid in-app restore targets.
  - `src/client/initMatrix.test.ts`
    - added coverage for legacy-key logout/reset cleanup,
    - added coverage that shared-origin generic SDK databases are not deleted
      unless this app's legacy auth state is actually present.
  - `src/app/state/sessions.test.ts`
    - added coverage that clearing the session registry also removes legacy
      `cinny_*` keys.
  - `src/app/pages/client/sessionRouteRestore.test.ts`
    - added regression coverage for protocol-relative restore paths.

Validation for this hardening slice:

- Passed: `npm run test` (`57` files / `276` tests)
- Passed: `npm run build`
- Passed (targeted): `npm run test -- src/app/pages/client/sessionRouteRestore.test.ts src/app/state/sessions.test.ts src/client/initMatrix.test.ts`
- Passed (targeted): `npx eslint src/app/pages/client/sessionRouteRestore.ts src/app/pages/client/sessionRouteRestore.test.ts src/app/state/sessions.ts src/app/state/sessions.test.ts src/client/initMatrix.ts src/client/initMatrix.test.ts`
- Passed (live browser): `E2E_CREATE_SECOND_ACCOUNT=1 ./scripts/test-e2e-mindroom.sh e2e/account-storage.spec.ts`
- Passed: `git diff --check`
- Passed (filtered): `npm run typecheck -- --pretty false` no longer reports the
  review-targeted errors for:
  - `src/client/initMatrix.ts`
  - `src/client/initMatrix.test.ts`
  - `src/app/pages/client/sessionRouteRestore.ts`
  - `src/app/pages/client/sessionRouteRestore.test.ts`
  - `src/app/state/sessions.ts`
  - `src/app/state/sessions.test.ts`
  - `src/app/components/ServerConfigsLoader.tsx`
  - `src/app/components/ServerConfigsLoader.test.ts`

## Extra Live Validation (2026-03-09)

Additional browser validation completed after the merge-readiness pass:

- `e2e/account-storage.spec.ts`
  - now seeds legacy `cinny_*` localStorage keys plus unrelated same-origin
    IndexedDB databases before account removal / final logout,
  - passed locally against the SSH-tunneled homeserver,
  - confirmed in a real browser that:
    - legacy `cinny_*` keys are removed by destructive cleanup,
    - session-owned IndexedDB databases are removed,
    - unrelated same-origin IndexedDB databases are preserved.
- I also probed last-account multitab logout with a temporary stricter auth-shell
  regression. That exploratory run showed the second tab reaches the auth shell,
  but on the local tunnel setup the server picker falls back to the configured
  default (`mindroom.chat`) rather than preserving `http://127.0.0.1:8808`.
  I treated that as an observation, not a merge-blocking bug, and did not keep
  the temporary regression.
- `e2e/account-deactivation.spec.ts`
  - now exercises Settings -> Account -> Delete / Deactivate for the active
    account with the password-based UIA flow,
  - passed locally against the SSH-tunneled homeserver,
  - confirmed in a real browser that:
    - only the active account is removed locally after deactivation,
    - the remaining stored account stays signed in,
    - the deactivated account can no longer log in afterward.

## Submission Readiness Check (2026-02-26, macOS/Xcode)

Validation performed on macOS (Xcode + CocoaPods + ImageMagick available):

- Passed:
  - `npm install`
  - `npm run test` (24 files / 103 tests)
  - `npm run build`
  - `npm run ios:icons`
  - `npm run appstore:preflight`
  - `npx cap sync ios` (including `pod install`)
  - `xcodebuild ... build` for iOS Release (no signing)
  - `xcodebuild ... archive` for iOS Release (no signing)
  - iOS Simulator build + install + launch smoke test (`com.mindroom.app` launched successfully)
- Verified:
  - `config.json` enables registration and requires Apple provider in auth flow.
  - `docs.mindroom.chat` homepage is reachable over HTTPS.
  - App Store preflight script catches auth URL/plist/icon gate requirements before archive.

Submission blockers / follow-ups before App Store submission (updated 2026-03-09):

- Signed distribution progress:
  - App Store Connect app record `Mindroom AI` was created for bundle ID `chat.mindroom.app`.
  - Signed Xcode Organizer upload succeeded on 2026-03-09.
  - Physical-device TestFlight smoke testing is still unchecked in `.docs/APP_STORE_COMPLIANCE.md`.
- App Store Connect metadata is still incomplete:
  - `.docs/APP_STORE_SUBMISSION_PACKET.md` now reflects the created App Store app name (`Mindroom AI`) and a conservative App Privacy draft.
  - Reviewer access still needs real credentials or a one-time registration token inserted at submission time.
  - Final App Privacy answers still need confirmation against real hosted production/server logging behavior.
- Final submission version/build chosen for the uploaded build:
  - Uploaded build uses `MARKETING_VERSION=4.10.3` and `CURRENT_PROJECT_VERSION=2`.
  - Any subsequent upload still needs a higher build number.
- Native push remains optional, not a current submission blocker:
  - The app can ship with `push.ios.enabled=false`.
  - If native push is intended for the first App Store build, APNs credentials and a live Sygnal-compatible push gateway still need to be configured and verified on a physical iPhone before upload.
- Remaining non-review hardening gap:
  - Session credentials still live in localStorage; Keychain-backed storage is still pending work for a stronger iOS security posture.

Non-blocking notes observed during validation:

- `actool` warns that `AppIcon-512@2x.png` is an unassigned child in `AppIcon.appiconset` (source image kept alongside generated slots); archive still succeeds.
- Re-running `npm run ios:icons` modified tracked icon PNG binaries in-place (expected regeneration side effect during preflight).
- Native iOS AppIcon + Splash asset catalog images were refreshed from `public/res/svg/mindroom.svg` (opaque PNG render for AppIcon source + regenerated icon slots + splash PNG replacement).
- Xcode/CocoaPods build-script sandbox denial (`Pods-App-frameworks.sh`) was resolved by setting `ENABLE_USER_SCRIPT_SANDBOXING = NO` in the iOS app project build settings.
- Real-device iPhone testing exposed a room-composer overlap with the iOS predictive/autocorrect bar; switched Capacitor Keyboard resize mode from `body` to `native` in `capacitor.config.ts`, ran `npx cap sync ios`, and confirmed on-device that the composer now stays above the keyboard suggestion bar.
- Additional real-device iPhone smoke checks passed: account deactivation flow works, camera permission prompt works, and photo library permission prompt works (Apple SSO/report-block still pending on a suitable homeserver).
- Native iOS branding assets were re-generated again from `~/Downloads/mindroom-logo.png` (non-square source padded to square 1024 icon canvas), then `npm run ios:icons` + `npx cap sync ios` were re-run.
- iOS Capacitor media auth gap diagnosed: `navigator.serviceWorker` is unavailable on `capacitor://localhost`, so the `src/sw.ts` authenticated-media fix cannot run in-app. Added a Capacitor fallback that still enables authenticated media URL generation and appends the access token query param on authenticated media URLs in `mxcUrlToHttp`, restoring image/audio loading on iOS without service workers.
- Added a mobile left-edge swipe-back gesture for screens using `BackRouteHandler`, plus thread-aware priority in room view: on thread screens, the first swipe exits the thread (matching the thread banner arrow), and a subsequent swipe uses the normal room/page back action (matching the room header arrow).
- Native iOS AppIcon and Splash assets were regenerated again after replacing `~/Downloads/mindroom-logo.png` (new square source art), fixing the app icon fill/padding issue by producing opaque full-bleed icon outputs.

## Checkpoint (2026-02-27, Apple Developer Program Active)

Status update:

- Apple Developer Program enrollment is now active for the project owner account.
- Local iOS web/native sync pipeline was re-run successfully on macOS:
  - `just ios-sync` (`npm run build`, `npm run ios:icons`, `npm run appstore:preflight`, `npx cap sync ios`) ✅
- Working tree is intentionally left with a local-only Xcode signing change:
  - `ios/App/App.xcodeproj/project.pbxproj` includes `DEVELOPMENT_TEAM=DNA6966LGZ` for local signing.
  - Keep this local unless team-signing defaults should be shared with all contributors.

Remaining mandatory steps before TestFlight/App Store submission:

- Xcode signing/distribution:
  - Select the final Apple team/signing profile in target Signing & Capabilities.
  - Archive and upload the signed build to TestFlight from Xcode Organizer.
- App Store Connect completion:
  - Insert the real reviewer credentials or one-time registration token in `.docs/APP_STORE_SUBMISSION_PACKET.md` / App Review Information.
  - Finalize App Privacy answers against real production/server behavior.
- Final release validation on a TestFlight build:
  - Login/Register
  - Apple SSO
  - Camera permission flow
  - Photo library permission flow
  - Microphone recording flow
  - Account deactivation flow from in-app Settings
  - Message send/receive and media rendering
  - If native push is enabled for release: APNs registration + background notification delivery

## Upstream PR Strategy (2026-03-07)

Do not try to upstream this fork as one PR. Upstream `CONTRIBUTING.md` explicitly asks for discussion before feature work and prefers small, reviewable pull requests.

Recommended candidate splits:

- Likely-upstreamable bugfix / hardening PRs:
  - Voice-recorder MIME preference cleanup and tests (`audio/ogg;codecs=opus` first, with browser fallbacks).
  - Generic iOS/App-Store hardening that is not MindRoom-branded:
    - stricter ATS/local-network policy,
    - permission strings,
    - configurable support/privacy/terms links,
    - account deactivation entry point,
    - Apple-aware SSO provider detection/order,
    - preflight/build docs where they are generally useful.
  - Generic mobile fixes such as Capacitor iOS authenticated-media fallback and keyboard/gesture polish, if maintainers want iOS wrapper support upstream.
- Keep fork-only unless maintainers explicitly ask for them:
  - MindRoom branding and default homeserver choices.
  - Local MindRoom onboarding/shortcut UI.
  - AI-run metadata, tool-trace rendering, long-message MindRoom payload handling, and other MindRoom-specific UX.
  - Hard requirements tied to MindRoom infrastructure, such as mandatory Apple-provider enforcement or Sygnal gateway defaults.

Required prep before any upstream PR:

- Resolve and commit the current iOS push work cleanly.
- Open maintainer discussion first for anything beyond a narrow bugfix.
- Split each candidate into the smallest independently testable branch/PR.
- Include tests and only the docs needed for that specific change.

## Investigation Log (2026-03-21)

### CINNY-011: thread reconnect gap on mobile

- Planning/investigation completed in `PLAN.md`.
- Status update:
  - Implemented the Plan B consensus fix in `src/app/features/room/RoomTimeline.tsx`.
  - `RoomEvent.TimelineRefresh` now refreshes the latest slice for the active thread, while the room timeline keeps its existing live-timeline reset behavior when no thread is open.
  - Replaced the pure same-thread in-flight drop with a coalesced rerun pattern so reconnect bursts still stay one request at a time without losing a later refresh that arrives while `/relations` is in flight.
  - The queued rerun is canceled if the active thread closes or changes before the in-flight refresh settles, so stale thread fetches are not replayed after the user leaves the thread.
  - Extracted the refresh wiring into `useThreadAwareTimelineRefresh` so the guarded callback can be regression-tested without mounting the full thread timeline bootstrap path.
  - Added focused regression tests in `src/app/features/room/RoomTimeline.test.ts` covering both the rapid reconnect rerun path and the thread-close-mid-refresh cancellation path.
- Validation:
  - `npx vitest run src/app/features/room/RoomTimeline.test.ts --no-coverage` ✅
  - `npx tsc --noEmit` ❌ existing repo-wide failures unrelated to this slice (Matrix SDK import/type surface, React JSX typing, and Jotai atom typing errors across many files).
  - `npm run build` ✅
- Review:
  - Second self-review completed against `git diff`, the updated regression tests, and `git diff --check`.
- Remaining validation:
  - Manual mobile lock/resume verification is still pending.

### CINNY-013: Universal Collapsible Long Messages

- Status: **Implemented**
- Ticket: CINNY-013
- Branch: `cinny-013-collapsible`

Summary: Replace thread-root-only `TruncatedThreadRootBody` with a universal
`CollapsibleMessage` component that collapses any text-based message exceeding
4.5em, with expand/collapse toggle.

Changes:

- Created `src/app/components/CollapsibleMessage.tsx`:
  - `useLayoutEffect` runs every render for synchronous overflow detection
    (handles streaming edits).
  - `ResizeObserver` via `useEffect` for async layout shifts (lazy images,
    font loading).
  - `+1` sub-pixel tolerance on `scrollHeight > clientHeight` comparison.
  - `overflow: hidden` and `maxHeight` only applied when collapsed.
  - Gradient fade overlay when collapsed and overflowing.
  - `[expand]`/`[collapse]` toggle link in accent color.
- Modified `src/app/features/room/RoomTimeline.tsx`:
  - Unencrypted renderer: replaced `TruncatedThreadRootBody` conditional with
    universal `CollapsibleMessage` wrapping. Media guard skips wrapping for
    `MsgType.Image` and `MsgType.Video`.
  - Encrypted renderer: same pattern — media guard + `CollapsibleMessage`.
  - Added `MsgType` import from `matrix-js-sdk`.
  - Replaced `TruncatedThreadRootBody` import with `CollapsibleMessage`.
- Deleted `src/app/components/TruncatedThreadRootBody.tsx` (replaced).

Key design decisions (from DEBATE.md hybrid plan):

- Integration at RoomTimeline.tsx call sites (not inside RenderMessageContent)
  for tree-stable component positioning during streaming edits.
- Media exclusion at the call site rather than universal wrapping to prevent
  images/videos being clipped at 72px.
- No `maxCollapsedHeight` prop — YAGNI, constant `4.5em` is sufficient.

Validation:

- `npx vitest run` — 66 files, 343 tests pass.
- `npm run build` — successful.
- `npm run typecheck` — no new errors (pre-existing matrix-js-sdk import
  warnings only).

### CINNY-013b: Enhanced CollapsibleMessage UX

- Status: **Implemented**
- Ticket: CINNY-013b
- Branch: `cinny-013b-ux`

Summary: Enhanced `CollapsibleMessage` with compact toggle icons, global
expand/collapse all, and scroll position preservation via CSS overflow-anchor.

Changes:

- Modified `src/app/components/CollapsibleMessage.tsx`:
  - Toggle text changed from `[expand]`/`[collapse]` to `[+]`/`[-]`.
  - Font size reduced to `0.75rem` with monospace font for compact appearance.
  - Added module-level event bus (`expandAllMessages`/`collapseAllMessages`)
    for global expand/collapse coordination.
  - Each instance subscribes via `useExpandAllListener` hook.
  - Added `overflow-anchor: none` on wrapper div for scroll preservation.
- Modified `src/app/features/room/RoomTimeline.tsx`:
  - Imported `expandAllMessages`/`collapseAllMessages` from CollapsibleMessage.
  - Added `allExpanded` state for toggle tracking.
  - Added `[+all]`/`[-all]` floating link at top-right of timeline area.

Key design decisions:

- Event bus pattern (Set of listener callbacks) instead of Jotai atom — simpler,
  no additional dependencies, no context provider needed.
- CSS `overflow-anchor: none` on collapsible wrappers + existing
  `overflow-anchor: auto` on scroll container — browser-native scroll anchoring
  is simpler and more reliable than manual scroll compensation.
- Individual `[+]`/`[-]` toggles work independently of `[+all]`/`[-all]`.

Validation:

- `npx vitest run` — 66 files, 350 tests pass.
- `npm run build` — successful.
- `npm run typecheck` — no new errors.

### CINNY-006b: thread filter review fixes

- Status update:
  - Main-room thread filters now render as a flat filtered list using an active
    range of `{ start: 0, end: filteredLength }`, instead of reusing the stored
    room paginator range.
  - While a room thread filter is active, paginator `onRangeChange` and live
    room events no longer mutate the stored room range, so non-matching live
    events cannot push filtered thread roots out of view.
  - Room-scoped jumps, including **Jump to Unread**, now reset the room thread
    filter to `all` before loading an event that is hidden by the active
    filter, ensuring the target becomes visible after the jump.
  - Added focused regressions in
    `src/app/features/room/RoomTimeline.test.ts` for resolution filtering,
    filtered-mode live-event stability, and jumping to hidden unread events.
- Validation:
  - `npx vitest run src/app/features/room/RoomTimeline.test.ts src/app/features/room/RoomThreadOverview.test.ts` ✅
  - `npm run build` ✅
- Review:
  - Second self-review completed against `git diff` and `git diff --check`.

### CINNY-013d: collapsible message exemptions planning (2026-03-22)

- Planning-only work in this step. No implementation was done.
- Recommended plan recorded in `PLAN.md`:
  - Pass merged message content into `CollapsibleMessage` and use the existing
    `hasMindroomThreadSummary(...)` helper so MindRoom thread summary cards are
    fully exempt from clipping/toggles.
  - Use the real Matrix `liveEvent` signal, but store it as a one-shot
    event-ID set in `RoomTimeline` so live messages mount expanded once and
    then collapse normally on later remounts/reloads.
  - Plumb the new `content`, `startExpanded`, and
    `onInitialExpandConsumed` props through both unencrypted and encrypted
    room-message render paths.
- Key edge cases called out in the plan:
  - edited summaries must use merged render content, not raw event content,
  - hidden thread-only activity in the main room timeline must not consume the
    one-shot expansion flag,
  - thread-view live replies should still get first-arrival expansion,
  - summary cards should ignore `[+all]` / `[-all]`.
- Next step:
  - Implement the plan in `CollapsibleMessage.tsx` and `RoomTimeline.tsx`, then
    validate with focused Vitest coverage plus build/typecheck checks.
- Validation (planning slice, 2026-03-22):
  - Passed: `git diff --check -- PLAN.md FORK_CHANGES.md`
  - Passed: `npm run build`
  - Known pre-existing baseline: `npm run typecheck -- --pretty false` still
    fails with broad repo-wide `matrix-js-sdk` named-export/type issues,
    React JSX return-type mismatches, and Jotai atom typing errors outside this
    planning-only documentation change.
  - Known workspace limitation: `npm run lint` remains blocked here because the
    repo lint script shells out to `yarn`, and `yarn` is not installed in this
    workspace.
- Review:
  - Second self-review completed against `git diff` and `git diff --check`.

### CINNY-013d: collapsible message exemptions implementation (2026-03-22)

- Implemented the planned collapse-mode exemptions in
  `src/app/components/CollapsibleMessage.tsx`:
  - added `collapseMode: 'default' | 'always-expanded' | 'initially-expanded'`,
  - added `onInitialExpandConsumed`,
  - kept summary-exempt messages fully expanded with no clipping, toggle,
    measurement observer, or global expand/collapse subscription,
  - made initially-expanded messages mount expanded once and then fall back to
    normal toggle behavior after the one-shot callback is consumed,
  - updated overflow detection so expanded live messages still show `[-]` once
    they exceed the collapsed height.
- Wired both room-message render sites in
  `src/app/features/room/RoomTimeline.tsx`:
  - added a one-shot `liveExpandOnceIds` ref keyed by event ID,
  - track only visible live text messages, skipping redactions, reactions,
    edits, hidden thread-only room activity, and thread-filtered-out room
    events,
  - resolve edited content before collapse-mode selection so edited MindRoom
    summaries stay exempt,
  - apply priority `always-expanded` > `initially-expanded` > `default` in both
    the unencrypted and encrypted room-message render paths.
- Added focused regression coverage:
  - `src/app/components/CollapsibleMessage.test.ts`
  - `src/app/features/room/RoomTimelineCollapsible.test.ts`
  - `src/app/components/message/mindroomThreadSummary.test.ts`
- Exported small `RoomTimeline` helper functions for live-collapse tracking so
  the thread-reply edge case can be tested directly without a brittle thread
  view harness.
- Validation (implementation slice, 2026-03-22):
  - Passed: `npx vitest run`
  - Passed: `npm run build`
  - Passed: `git diff --check`
  - Known pre-existing baseline: `npx tsc --noEmit --pretty false` still fails
    with the same broad repo-wide `matrix-js-sdk` named-export/type issues,
    React JSX return-type mismatches, Jotai atom typing failures, and existing
    `RoomTimeline.tsx` type errors outside this change slice.
- Review:
  - Second self-review completed against the final `git diff`,
    `git diff --check`, focused regression runs, and full validation output.

### CINNY-013d: review fixes for summary/live-edit exemptions (2026-03-23)

- Addressed the follow-up review items recorded in `REVIEW_FINDINGS.md` for the
  collapsible-message exemption work.
- Updated `src/app/components/message/mindroomThreadSummary.ts` so
  `hasMindroomThreadSummary(...)` now recognizes the legacy boolean
  `io.mindroom.thread_summary: true` shape in addition to the versioned object
  form.
- Updated `src/app/features/room/RoomTimeline.tsx` so live `m.replace` events
  resolve their target message ID into `liveExpandOnceIds` when the target is
  visible in the current timeline/thread view, and force a lightweight timeline
  refresh at live-end when that one-shot expansion needs to be applied to an
  already-mounted message.
- Updated `src/app/components/CollapsibleMessage.tsx` so
  `collapseMode="initially-expanded"` is consumed on prop transition as well as
  on initial mount, which is required for streaming-edit growth on existing
  rendered messages.
- Added regression coverage in:
  - `src/app/components/CollapsibleMessage.test.ts`
  - `src/app/components/message/mindroomThreadSummary.test.ts`
  - `src/app/features/room/RoomTimelineCollapsible.test.ts`
- Intentionally left the reconnect / `TimelineRefresh` bypass behavior
  unchanged for this slice, matching the review disposition that reconnect is
  acceptable as reload-like behavior.
- Validation:
  - Passed: `npx vitest run`
  - Passed: `npm run build`
  - Passed: `git diff --check`
- Review:
  - Second self-review completed against `git diff`, focused regression output,
    and the full validation commands above.

### feat: configurable pagination limit in Settings > Messages (CINNY-019)

Files changed:

- `src/app/state/settings.ts`
- `src/app/state/settings.test.ts` (new)
- `src/app/features/settings/general/General.tsx`
- `src/app/features/room/RoomTimeline.tsx`
- `src/app/features/room/RoomTimeline.test.ts`

What changed:

- Made the hardcoded `PAGINATION_LIMIT` (300) configurable via Settings > General > Messages.
- Added `paginationLimit` to the `Settings` interface with a default of 300 and minimum of 50.
- Exported `sanitizePaginationLimit()` for runtime validation of the setting.
- Added "Message Preload Limit" number input in the Messages section of General settings.
- Replaced all module-level constant usages in `RoomTimeline.tsx` with reactive values
  from `useSetting`, using refs inside callbacks to avoid stale closures.
- Updated `getInitialTimeline`, `getLatestTimelineRange`, `getVisibleTimelineRange`,
  and `getActiveTimelineRange` to accept `paginationLimit` as a parameter.
- Added unit tests for `sanitizePaginationLimit` covering edge cases.
- Updated existing `RoomTimeline.test.ts` mocks for the new setting.

Why:

- MindRoom agent conversations in threads can generate large message volumes.
  Users need to control how many messages are preloaded per batch to balance
  between context visibility and memory usage.
