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

Working tree status (2026-02-26):

- Modified:
  - `APP_STORE_COMPLIANCE.md` (NEW)
  - `APP_STORE_SUBMISSION_PACKET.md` (NEW)
  - `FORK_CHANGES.md`
  - `README.md`
  - `config.json`
  - `ios-build.md`
  - `ios/App/App/Info.plist`
  - `ios/App/App/Assets.xcassets/AppIcon.appiconset/Contents.json`
  - `ios/App/App/Assets.xcassets/AppIcon.appiconset/*` (generated icon PNG set)
  - `package.json`
  - `scripts/appstore-preflight.mjs` (NEW)
  - `scripts/generate-ios-icons.sh` (NEW)
  - `src/app/features/settings/about/About.tsx`
  - `src/app/cs-api.test.ts` (NEW)
  - `src/app/cs-api.ts`
  - `src/app/hooks/useClientConfig.ts`
  - `src/app/pages/auth/SSOLogin.tsx`
  - `src/app/pages/auth/ssoProviders.ts` (NEW)
  - `src/app/pages/auth/ssoProviders.test.ts` (NEW)
  - `src/app/pages/auth/AuthFooter.tsx`
  - `src/app/pages/auth/AuthLayout.tsx`
  - `src/app/pages/auth/login/Login.tsx`
  - `src/app/pages/auth/register/Register.tsx`

What changed (uncommitted):

- App Store compliance hardening pass:
  - tightened iOS ATS posture to local-network exception behavior (removed broad arbitrary loads),
  - added iOS camera/photo usage descriptions and export compliance plist key,
  - enforced HTTPS homeserver policy with local-network HTTP-only exception in discovery flow,
  - enabled in-app account creation with Apple-provider requirement flag in auth config,
  - added Apple-aware SSO provider handling (`Sign in with Apple` / `Sign up with Apple`, Apple-first ordering),
  - added optional support/privacy/terms link surfacing in auth footer,
  - added automated `npm run appstore:preflight` checks for high-risk App Store submission gates,
  - added full iOS AppIcon slot set generation and preflight validation,
  - added App Store submission metadata/review-notes packet template,
  - added reviewer-facing README context guidance in submission packet,
  - set `auth.privacyPolicyUrl` and `auth.termsUrl` runtime links in config,
  - rewrote `README.md` to be MindRoom-first (product positioning, fork deltas, iOS submission docs, and upstream attribution),
  - aligned visible in-app About version text with package version,
  - added explicit App Store submission checklist doc and iOS build preflight notes.

Validation (uncommitted):

- `npm run ios:icons` ✅ passed.
- `npm run appstore:preflight` ✅ passed.
- `npm run test` ✅ passed (24 files, 103 tests).
- `npm run build` ✅ passed.
- `npm run typecheck` ❌ fails with pre-existing repository-wide typing issues (matrix-js-sdk import/type surface mismatches and existing strictness violations).
- `npm run lint` ❌ fails with pre-existing repository-wide lint issues unrelated to this delta.

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
- `ios-build.md`
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
  - `ios-build.md`
  - `APP_STORE_COMPLIANCE.md`

## Implemented Behavior

### Edit Rendering For Streaming

- Timeline rendering resolves message edits against latest replacement content.
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

### Tool Metadata Visibility

- Tool-call UI renders from v2 formatted-body markers:
  - `🔧 <code>tool_name</code> [N]`
  - `🔧 <code>tool_name</code> [N] ⏳`
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
- On iOS clients, recorder MIME selection prefers `audio/mp4` first to improve playback compatibility in WebKit-based browsers.

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
- Added `scripts/appstore-preflight.mjs` (`npm run appstore:preflight`) to verify critical iOS/config compliance gates before archive.
- Added `scripts/generate-ios-icons.sh` (`npm run ios:icons`) and generated full iPhone/iPad AppIcon slot assets from a single 1024 source icon.
- App Store preflight now validates icon-slot completeness and required icon file presence.
- Added `APP_STORE_SUBMISSION_PACKET.md` with paste-ready App Review notes and metadata checklist.
- Added `APP_STORE_COMPLIANCE.md` as a release gate checklist and linked iOS build preflight steps in `ios-build.md`.

## Operational Notes

- Recommended local validation:
  - `npm run test`
  - `npm run build`
- `npm run typecheck` currently fails due pre-existing repository-wide type issues (not introduced by recent fork deltas).
- If deploying behind strict subpath-only ingress/proxy rules, ensure runtime config and assets resolve under your routing policy, or apply equivalent server-side HTML base/script injection in the serving layer.
- Before shipping iOS builds, run the full checklist in `APP_STORE_COMPLIANCE.md` and verify App Store Connect metadata URLs (support/privacy/terms) are public and final.

## Current Snapshot (2026-02-26)

- Thread mode, tool-ref v2 rendering, long-message v2 hydration, and `!` autocomplete are implemented.
- Main timeline thread summary chips render below message body and show participant avatars when available.
- Base-path bootstrap is server-driven for the local SPA server (`serve.py`) and no longer depends on fragile client-side inference.
- Service-worker media auth matching handles both root and subpath media endpoints on the same origin, reducing `M_MISSING_TOKEN` failures under subpath deployments.
- Voice message recording/sending is available in room input, and voice-tagged incoming audio messages render/play in the existing audio controls.
- AI run metadata (`io.mindroom.ai_run`) is surfaced via a subtle per-message hover tooltip in the timeline header.
- Long-message handling is v2-only; users can download the original long-text sidecar directly from the message menu.
- iOS submission posture has been hardened: stricter ATS behavior, explicit media permission strings, secure homeserver URL enforcement, registration-enabled flow, and Apple-aware SSO provider handling.
- iOS app icon assets are now generated for all standard iPhone/iPad slots, and preflight checks enforce icon completeness before archive.
- Submission docs now include a checklist plus a paste-ready App Store metadata/review-notes packet.
- Remaining known product gap: no dedicated thread list sidebar or thread-specific unread model yet.
- Remaining iOS hardening gap: session credentials are still localStorage-based in this branch (Keychain migration is still pending).

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

Submission blockers / follow-ups before App Store submission:

- Account deletion requirement still needs manual verification (risk reduced):
  - Added a visible in-app Settings → Account entry point for account deletion/deactivation, with local Matrix deactivation flow + OIDC account-management portal fallback.
  - Manual runtime verification is still required on the target homeserver(s) to confirm successful deactivation path and reviewer-visible UX.
- Apple SSO requirement not currently satisfied by configured default homeserver:
  - `config.json` requires Apple provider (`auth.requireAppleProvider: true`), but live login-flow probe on `https://matrix-dev.lab.nijho.lt/_matrix/client/v3/login` returned only password + appservice flows (no SSO providers).
  - Submission/test environment must expose an Apple identity provider (preferably with `brand=apple`) before TestFlight/App Review validation.
- Legal/support URLs are HTTPS-valid but not submission-final:
  - `config.json` currently points support/privacy/terms to the docs homepage (`https://docs.mindroom.chat/`) rather than dedicated final policy/support endpoints.
  - Probed likely routes (`/privacy`, `/terms`, `/support`) currently return 404.
- Xcode marketing/build version values need explicit submission bumping:
  - `Info.plist` defers to `$(MARKETING_VERSION)` and `$(CURRENT_PROJECT_VERSION)`; current resolved build settings/unsigned archive were `1.0` / `1`, not the web app version `4.10.3`.
  - Set intended App Store version/build in Xcode project settings before archive/upload.

Non-blocking notes observed during validation:

- `actool` warns that `AppIcon-512@2x.png` is an unassigned child in `AppIcon.appiconset` (source image kept alongside generated slots); archive still succeeds.
- Re-running `npm run ios:icons` modified tracked icon PNG binaries in-place (expected regeneration side effect during preflight).
- Native iOS AppIcon + Splash asset catalog images were refreshed from `public/res/svg/mindroom.svg` (opaque PNG render for AppIcon source + regenerated icon slots + splash PNG replacement).
- Xcode/CocoaPods build-script sandbox denial (`Pods-App-frameworks.sh`) was resolved by setting `ENABLE_USER_SCRIPT_SANDBOXING = NO` in the iOS app project build settings.
- Real-device iPhone testing exposed a room-composer overlap with the iOS predictive/autocorrect bar; switched Capacitor Keyboard resize mode from `body` to `native` in `capacitor.config.ts`, ran `npx cap sync ios`, and confirmed on-device that the composer now stays above the keyboard suggestion bar.
- Additional real-device iPhone smoke checks passed: account deactivation flow works, camera permission prompt works, and photo library permission prompt works (Apple SSO/report-block still pending on a suitable homeserver).
