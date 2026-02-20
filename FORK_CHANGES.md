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
No uncommitted changes documented.

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
- Updated `serve.py` to serve runtime-config from env.
- Updated base-path bootstrap in `index.html` to prefer `/runtime-config.js` so root
  deployments don’t infer a nested segment and load JS assets as HTML after login.

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

Why:
- Stated in commit subject.

### feat(tool-trace): render MindRoom tool tags and metadata
Files changed:
- `src/app/components/RenderMessageContent.tsx`
- `src/app/components/message/mindroomBlocks.test.ts`
- `src/app/components/message/mindroomBlocks.ts`
- `src/app/components/message/mindroomToolTrace.test.ts`
- `src/app/components/message/mindroomToolTrace.ts`
- `src/app/plugins/react-custom-html-parser.tsx`
- `src/app/styles/CustomHtml.css.ts`
- `src/app/utils/sanitize.ts`

What changed:
- Rendered MindRoom tool tags and metadata with collapsible UI and sanitizer support.

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

### feat(ios): store session credentials in iOS Keychain
Files changed:
- `package.json`
- `src/app/state/secureStorage.ts` (NEW)
- `src/app/state/sessions.ts`
- `src/index.tsx`
- `src/client/initMatrix.ts`
- `src/app/pages/client/ClientRoot.tsx`
- `ios/App/Podfile`
- `ios/App/Podfile.lock`

What changed:
- Added `capacitor-secure-storage-plugin` for iOS Keychain storage of Matrix session credentials.
- Created platform-aware secure storage abstraction with in-memory cache for synchronous reads.
- Migrated session credential storage from localStorage to secureStorage (Keychain on native, localStorage on web).
- Added hydration step before React mount to populate cache from Keychain/localStorage.
- Added Keychain cleanup on all logout paths.

Why:
- iOS WKWebView localStorage is not hardware-protected and is lost on app deletion. Apple expects auth tokens in the Keychain.

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

# Runbook

# MindRoom Cinny Fork: Setup + High-Level Implementation Plan

## Canonical Agent Entry Point

This file is the canonical, living implementation runbook for this fork.

Rules:
- All agents should read this document first before making any code changes.
- All agents may update this document as work progresses (design updates, decisions, risks, status, and validation notes).
- This document must remain valid after context compaction by keeping current status, next actions, and implementation sequence in one place.
- After each logical implementation step, the authoring agent must request an independent review pass from a separate agent workflow when available; if unavailable in tooling, run an explicit second independent self-review pass before merge.
- Commit frequently in small logical units and run validation before each commit.

## 1. Setup Verification (Done)

### Repository status
- Current workspace is already a clone of the requested fork.
- `origin` remote:
  - `https://github.com/mindroom-ai/mindroom-cinny.git`
- Active branch during investigation:
  - `cinny-fork-plan`

### Build/run verification performed
- Production build:
  - Command: `npm run build`
  - Result: success (Vite build completed, `dist/` generated).
- Dev server smoke test:
  - Command: `npm run start -- --host 127.0.0.1 --port 4173`
  - Result: success (`http://127.0.0.1:4173/` served).

### Practical local run instructions
1. `git clone https://github.com/mindroom-ai/mindroom-cinny.git`
2. `cd mindroom-cinny`
3. `npm ci`
4. `npm run build`
5. `npm run start`

## 2. Cinny Architecture Summary

### Tech stack and patterns
- Frontend: React 18 + TypeScript + Vite.
- Matrix SDK: `matrix-js-sdk@38.2.0`.
- State: Jotai atoms + React context providers.
- UI system: `folds` component library + `@vanilla-extract/css` styles.
- Editor: Slate (`slate`, `slate-react`, `slate-history`).
- Message HTML pipeline: `sanitize-html` + `html-react-parser` + custom parser transforms.

### Room page composition (current)
- Router resolves room path `:roomIdOrAlias/:eventId?/` from `src/app/pages/paths.ts`.
- Route providers resolve selected room and provide context:
  - `src/app/pages/client/home/RoomProvider.tsx`
  - `src/app/pages/client/direct/RoomProvider.tsx`
  - `src/app/pages/client/space/RoomProvider.tsx`
- Main room feature composition:
  - `src/app/features/room/Room.tsx` -> `RoomView`.
  - `src/app/features/room/RoomView.tsx` renders:
    - `RoomViewHeader`
    - `RoomTimeline`
    - `RoomInput`
    - activity/following area.

### Message rendering pipeline (current)
1. `RoomTimeline` iterates timeline items and renders each Matrix event.
2. For `m.room.message`, latest edit is resolved via:
   - `getEditedEvent` in `src/app/utils/room.ts` (uses relations container + latest `m.replace`).
3. `RenderMessageContent` (`src/app/components/RenderMessageContent.tsx`) selects renderer by `msgtype`.
4. Text/emote/notice renderers call `RenderBody` (`src/app/components/message/RenderBody.tsx`).
5. `RenderBody` sanitizes HTML via `sanitizeCustomHtml` (`src/app/utils/sanitize.ts`) and parses it with `getReactCustomHtmlParser` (`src/app/plugins/react-custom-html-parser.tsx`).

### Message edit (`m.replace`) behavior (critical for streaming)
- Relation/edit events are not directly rendered in timeline:
  - `reactionOrEditEvent` in `src/app/utils/room.ts`.
- Rendered events are continuously re-resolved against latest replacement event:
  - `RoomTimeline` calls `getEditedEvent(...)` and uses `m.new_content` when present.
- Live updates propagate via room timeline listeners:
  - `RoomEvent.Timeline`, `RoomEvent.Redaction`, `RoomEvent.TimelineRefresh` in `RoomTimeline`.
- This is the key reason Cinny can keep up with edit-driven pseudo-streaming better than stale-cached rendering paths.

## 3. Existing Thread Support (Current State + Limitations)

### What exists today
- Thread relations are already created when composing replies-in-thread:
  - `RoomTimeline.handleReplyClick(..., startThread=true)` seeds reply draft with `m.thread` relation.
  - `RoomInput` sends thread relation (`rel_type: m.thread`, `event_id`, `is_falling_back: false`) in `m.relates_to`.
- Thread-related UI cues exist:
  - `ThreadIndicator` in `src/app/components/message/Reply.tsx`.
  - `Reply in Thread` action in `src/app/features/room/message/Message.tsx`.
- SDK thread metadata is consumed minimally:
  - `mEvent.threadRootId` and `mEvent.replyEventId` are read for badges/preview.

### What does not exist (gap)
- No thread route or thread-local room state.
- No dedicated thread timeline view.
- Clicking thread indicator currently just opens the referenced event in the main room timeline (`handleOpenEvent`), not a thread experience.
- No use of SDK thread APIs (`room.getThread`, `thread.getUnfilteredTimelineSet`, `mx.getThreadTimeline`) in app code.
- No thread list sidebar or thread-focused unread model.

## 4. Existing Autocomplete/Mention System (Relevant for Feature 3)

### Current autocomplete mechanism
- In `RoomInput`, `onKeyUp` computes query from previous word range:
  - `getPrevWorldRange` + `getAutocompleteQuery`.
- Supported prefixes today:
  - `#`, `@`, `:`, `/` from `src/app/components/editor/autocomplete/autocompleteQuery.ts`.
- Popup components:
  - `RoomMentionAutocomplete`, `UserMentionAutocomplete`, `EmoticonAutocomplete`, `CommandAutocomplete`.
- Shared popup shell:
  - `AutocompleteMenu`.

### Existing command behavior
- Slash command autocomplete is implemented (`/command`), not `!command`.
- It inserts a Slate `BlockType.Command` inline element.
- On submit, `RoomInput` checks `getBeginCommand(editor)` and executes mapped command handlers from `useCommands`.
- This is interception behavior (not plain text send), which differs from your `!` requirement.

## 5. Feature 1 Plan: Thread-First UX (Critical)

### 5.1 Architecture overview (current subsystem)
- Rendering is room-first and timeline-first in `RoomView` + `RoomTimeline`.
- Input is shared and reply-thread relation is represented in reply draft atom (`roomIdToReplyDraftAtomFamily`).
- Navigation currently supports room/event context only (`eventId` route param).
- SDK already exposes full thread primitives (`Room#getThread`, `Thread#getUnfilteredTimelineSet`, `MatrixClient#getThreadTimeline`) but app does not use them.

### 5.2 Files to modify
- `src/app/pages/paths.ts`
  - Extend room search params for thread context (recommended: `threadId`).
- `src/app/pages/pathSearchParam.ts`
  - Parse `threadId` from URL search params.
- `src/app/hooks/useRoomNavigate.ts`
  - Add optional thread navigation helper while preserving existing room/event navigation.
- `src/app/features/room/Room.tsx`
  - Read thread context from URL and pass into `RoomView`.
- `src/app/features/room/RoomView.tsx`
  - Branch between main timeline and full-width thread view.
- `src/app/features/room/RoomTimeline.tsx`
  - Update thread indicator/reply-in-thread click behavior to enter thread view state/route.
- `src/app/features/room/RoomInput.tsx`
  - Support forced thread context when inside thread view (default relation + persistent thread root).
- `src/app/features/room/RoomViewHeader.tsx`
  - Add breadcrumb/back from thread view to room timeline.

### 5.3 New files to create
- `src/app/features/room/thread/ThreadView.tsx`
  - Full-width thread page body replacing main timeline.
- `src/app/features/room/thread/ThreadTimeline.tsx`
  - Thread-specific virtualized timeline.
- `src/app/features/room/thread/ThreadHeader.tsx`
  - Root message summary + back navigation.
- `src/app/features/room/thread/useThreadTimeline.ts`
  - Timeline loading/pagination helpers around SDK `Thread` timeline set.
- Optional:
  - `src/app/features/room/thread/ThreadList.tsx` (sidebar list of active threads).

### 5.4 Implementation approach
1. Introduce URL-level thread context (`threadId` search param) so view is deep-linkable and back-button-safe.
2. Wire UI entry points:
   - `ThreadIndicator` click
   - `Reply in Thread` action
   - both should set thread context instead of just jumping to event.
3. Build `ThreadView` container in `RoomView` to replace main `RoomTimeline` area when thread context exists.
4. Resolve thread model:
   - Prefer `room.getThread(threadId)`.
   - If missing, bootstrap via root event lookup and SDK timeline loading path.
5. Build thread timeline renderer:
   - Reuse `Message` + `RenderMessageContent` stack to keep identical message behavior.
   - Pin/show root event at top, replies below.
   - Use thread timeline set pagination (`mx.getThreadTimeline` + virtual paginator integration).
6. Bind `RoomInput` to thread context:
   - In thread view, send as thread reply by default.
   - Keep normal reply semantics (`m.in_reply_to`) inside thread.
7. Add thread exit behavior:
   - back button in header
   - clear URL thread param
   - restore main room timeline state.
8. Optional thread sidebar:
   - start with `room.getThreads()` sorted by last reply timestamp.

### 5.5 Key decisions + recommendation
- Decision: route vs local state for thread mode.
  - Recommendation: URL search param (`threadId`) because it supports refresh/back/share and preserves room path compatibility.
- Decision: refactor `RoomTimeline` vs create thread-specific timeline component.
  - Recommendation: create `ThreadTimeline` first, then gradually extract shared timeline primitives to avoid destabilizing current room timeline.
- Decision: input behavior in thread view.
  - Recommendation: force thread relation by context (no manual “Reply in Thread” needed once inside).

### 5.6 Risks and unknowns
- SDK thread object availability may differ for older events until fetched.
- Thread pagination semantics differ from main timeline; edge cases around historical gaps likely.
- Read receipt/unread behavior is currently room-level and may not reflect thread-focused UX.
- Main timeline currently renders thread replies; introducing thread view may require policy on duplicate visibility.

### 5.7 Dependencies and parallelization
- Must do first: thread context model (URL param + navigation entry points).
- Then in sequence: `ThreadView` shell -> `ThreadTimeline` -> input binding.
- Parallelizable:
  - Breadcrumb/header work
  - Optional thread list sidebar
  - thread-specific styles.

## 6. Feature 2 Plan: Collapsible Tool Call Blocks (Critical)

### 6.1 Architecture overview (current subsystem)
- HTML body is sanitized by `sanitizeCustomHtml` and parsed by `getReactCustomHtmlParser`.
- Unknown tags are dropped by sanitizer today (tool tags are currently not preserved).
- Parser supports headings, code blocks, mentions, spoilers, links, images, but no custom `<tool>` class tags.
- Edit updates already work through `getEditedEvent` + `m.new_content`, so streamed tool blocks via edits can ride existing update path.

### 6.2 Files to modify
- `src/app/utils/sanitize.ts`
  - Allow custom tags (`tool`, `tool-group`, `think`, `debug`, `system`, `plan`, `analysis`, `research`).
- `src/app/plugins/react-custom-html-parser.tsx`
  - Add parser replacements for those tags -> collapsible React components.
- `src/app/styles/CustomHtml.css.ts`
  - Add styles for collapsible trace blocks, headers, inline/expanded result body.
- `src/app/components/message/RenderBody.tsx`
  - Keep parser path but ensure custom block rendering branch remains stable.
- `src/app/components/RenderMessageContent.tsx`
  - Accept/access event metadata (`io.mindroom.tool_trace`, `io.mindroom.long_text`) and pass into text renderer path.
- Render sites that call `RenderMessageContent`:
  - `src/app/features/room/RoomTimeline.tsx`
  - `src/app/features/room/room-pin-menu/RoomPinMenu.tsx`
  - `src/app/pages/client/inbox/Notifications.tsx`
  - `src/app/features/message-search/SearchResultGroup.tsx`
  - pass message event metadata context.

### 6.3 New files to create
- `src/app/components/message/mindroom/MindroomTraceBlock.tsx`
  - Generic collapsible block component (icon, label, collapsed-by-default).
- `src/app/components/message/mindroom/ToolBlock.tsx`
  - Implements newline protocol (pending/success/result modes).
- `src/app/components/message/mindroom/ToolGroupBlock.tsx`
  - Renders grouped tools and count summary.
- `src/app/components/message/mindroom/traceParsing.ts`
  - Helpers for splitting tool call text and classifying status.
- `src/app/hooks/useLongTextContent.ts`
  - Fetch/cache full long text from MXC when `io.mindroom.long_text` exists.

### 6.4 Implementation approach
1. Preserve custom tags through sanitizer.
2. Add parser handlers for custom tags in `getReactCustomHtmlParser`.
3. Implement collapsible block UI:
   - default collapsed
   - click to expand
   - spinner for pending
   - check icon for completed-without-output
   - inline arrow for short single-line output
   - `<pre>` for multiline output.
4. Implement `<tool-group>` as one parent collapsible containing child tool rows and count label.
5. Add non-tool tag mappings (`think`, `debug`, `system`, `plan`, `analysis`, `research`) to same block shell with different icon/label.
6. Add metadata plumbing:
   - parse `io.mindroom.tool_trace` from effective message content.
   - prefer metadata rendering when present, fallback to HTML tag rendering.
7. Add long-text support:
   - detect `io.mindroom.long_text`.
   - download full content via existing media helpers.
   - inline render full text (instead of attachment card) with loading/error states.
8. Verify with edit streaming:
   - simulate multiple `m.replace` updates and ensure blocks update without stale content.

### 6.5 Key decisions + recommendation
- Decision: add custom tags to shared sanitizer used by both message rendering and editor input.
  - Recommendation: split sanitizer responsibilities (`sanitizeMessageHtml` vs editor-input sanitizer) to reduce side effects in editor parsing.
- Decision: where to implement block logic.
  - Recommendation: parser-level replacement in `getReactCustomHtmlParser` for consistency with existing rendering pipeline and mention/link/spoiler handling.
- Decision: icon mapping (folds has no wrench/brain icon set).
  - Recommendation: map to closest existing icons (`Terminal`, `Bulb`, `Setting`, `Code`, `Search`, etc.) and keep labels explicit.

### 6.6 Risks and unknowns
- Sanitizer changes may affect HTML-to-editor conversion (`htmlToEditorInput`) if kept shared.
- Expand/collapse state may reset on every edit unless keyed carefully.
- Long text metadata schema may vary; need strict runtime guards.
- MXC fetch for encrypted attachments needs proper decryption path reuse.

### 6.7 Dependencies and parallelization
- Must do first: sanitizer + parser extension foundation.
- Then in sequence: block UI components -> metadata integration -> long text integration.
- Parallelizable:
  - UI styling + parser logic
  - metadata helper + long text fetch hook.

## 7. Feature 3 Plan: `!` Command Autocomplete (Medium)

### 7.1 Architecture overview (current subsystem)
- `RoomInput` computes autocomplete queries on keyup from previous word.
- Existing command autocomplete is slash-based and tied to executable command elements.
- Submit path executes slash commands via `useCommands` instead of sending them as plain text.

### 7.2 Files to modify
- `src/app/features/room/RoomInput.tsx`
  - Add `!` command query detection (beginning-of-message only).
  - Render new `!` command popup component.
  - Keep send path as plain text (no interception for `!`).
- Optional small helper updates:
  - `src/app/components/editor/utils.ts` for “is query at message start” utility.

### 7.3 New files to create
- `src/app/features/room/mindroomCommands.ts`
  - Static command catalog with syntax + description:
    - `!help`, `!schedule`, `!list_schedules`, `!cancel_schedule`, `!edit_schedule`, `!widget`, `!config`, `!hi`, `!skill`.
- `src/app/features/room/MindroomCommandAutocomplete.tsx`
  - UI list/filter/select component, reusing `AutocompleteMenu`.
- Optional:
  - `src/app/features/room/useMindroomCommandQuery.ts` for isolated query parsing logic.

### 7.4 Implementation approach
1. Define typed command metadata list.
2. Detect candidate query only when first token starts with `!` at message start.
3. Filter commands by typed suffix (`!sch` => `schedule`).
4. On select:
   - replace current token range with `!command ` plain text.
   - keep cursor after inserted command.
5. Do not create Slate `BlockType.Command` element for `!`.
6. Confirm submit path sends text unchanged through normal `mx.sendMessage` flow.

### 7.5 Key decisions + recommendation
- Decision: reuse existing prefix enum (`AutocompletePrefix`) vs separate detector.
  - Recommendation: separate detector in `RoomInput` to enforce “beginning of message only” cleanly and avoid affecting slash command behavior.
- Decision: command source.
  - Recommendation: static local config now, future upgrade path to server-provided capabilities if needed.

### 7.6 Risks and unknowns
- Current query logic is “previous word”, so strict start-of-message rule needs explicit guard.
- Multiline editor content may make “beginning” ambiguous; define as first non-whitespace token in editor plain text.
- Need to ensure `!` suggestions do not conflict with existing `/` command UX.

### 7.7 Dependencies and parallelization
- Must do first: command catalog + start-of-message query guard.
- Then: popup UI + insertion behavior.
- Parallelizable:
  - command metadata authoring
  - UI styling.

## 8. Cross-Feature Delivery Order

1. Thread-first UX foundation (`threadId` route/search state + entry points).
2. Tool block sanitizer/parser extension (required for immediate MindRoom rendering wins).
3. Thread timeline/input implementation.
4. Metadata-based tool trace + long text inline rendering.
5. `!` autocomplete.
6. Optional thread list sidebar.

## 8.1 Execution Workflow (Living Process)

Use this loop for every logical implementation step:
1. Pick one bounded step from section 8.
2. Implement only that step.
3. Update this report with:
   - what changed,
   - decisions made,
   - risks discovered,
   - next step.
4. Run validation gate:
   - `npm run typecheck`
   - `npm run build`
   - `npm run lint` (when passing in branch scope)
5. Run independent review:
   - preferred: separate agent/subagent review pass,
   - fallback: second independent self-review pass without reusing prior review notes.
6. Commit with a focused message.
7. Repeat.

Operational notes:
- Keep commits small and frequent.
- Add or update tests with each feature step when behavior changes.
- If review reveals many issues, perform another independent review round before continuing.

## 9. Validation Plan for Implementation Phase

- Unit/logic checks:
  - tool block parsing status classifier.
  - `!` query detector (start-of-message only).
- Manual QA scenarios:
  - Rapid `m.replace` updates on one message with changing tool tags.
  - Enter/exit thread view repeatedly and confirm breadcrumb/back behavior.
  - Send thread replies from thread view and main view.
  - Long text metadata fetch render and fallback behavior.
  - `!` autocomplete filtering/insertion and plain text send.
- Regression checks:
  - mentions, emojis, slash commands, URL previews, file rendering, edit source viewer.

## 10. Execution Status (Living)

### Step 1 completed: Thread route/state skeleton + entry points

Scope implemented:
- Added room URL thread context:
  - `src/app/pages/paths.ts`: `_RoomSearchParams.threadId`
  - `src/app/pages/pathSearchParam.ts`: parse `threadId`
- Added thread navigation helper:
  - `src/app/hooks/useRoomNavigate.ts`: `navigateRoomThread(roomId, threadId, eventId?, opts?)`
- Wired room/search state through room container:
  - `src/app/features/room/Room.tsx`: read search params and pass `threadId` to `RoomView`
  - `src/app/features/room/RoomView.tsx`: thread context banner + back action to clear thread mode
  - `src/app/features/room/RoomTimeline.tsx`: accept `threadId`, open thread root context, and use thread navigation on thread indicator / “Reply in Thread”
- Added explicit thread-indicator click metadata:
  - `src/app/components/message/Reply.tsx`: `data-thread-root-id`

Behavior now:
- Clicking `ThreadIndicator` enters URL thread mode.
- Clicking `Reply in Thread` seeds a thread reply draft and enters URL thread mode.
- Room view shows thread-mode context and a back control to return to normal room timeline URL.

Independent review notes:
- Ran independent review via separate agent workflow (`claude -p` over current diff).
- Valid issue found: thread focus effect could re-trigger repeatedly as callback identity changed.
- Fix applied:
  - `src/app/features/room/RoomTimeline.tsx`: added `openedThreadIdRef` guard to run thread focus open only once per `threadId` value.
- Additional review note (“`startThread` undefined”) was false positive; callback signature already includes `(evt, startThread = false)`.

Validation for this step:
- `npm run build`: pass.
- Targeted lint on changed files: no errors; existing warnings in `RoomTimeline.tsx` (pre-existing patterns like `console.warn` and non-null assertions).
- `npm run typecheck`: currently fails broadly on this branch due pre-existing repo-level TypeScript/matrix-js-sdk typing incompatibilities (not introduced by this step).

Next step:
- Implement actual thread timeline filtering/rendering (root + thread replies only) rather than room timeline focus-jump.

### Step 2 completed: Test runner baseline + first tests

Scope implemented:
- Added repo test runner scripts:
  - `package.json`
    - `test`: `vitest run`
    - `test:watch`: `vitest`
- Added Vitest config:
  - `vitest.config.ts` (node environment, `src/**/*.test.ts` include)
- Added first tests:
  - `src/app/pages/pathSearchParam.test.ts`
    - verifies default undefined values
    - verifies parsing of both `viaServers` and `threadId`

Dependency decision:
- Initially added `vitest@4`, but independent review flagged Vite major-version mismatch risk with repo `vite@5`.
- Adjusted to `vitest@2.1.8` (compatible with Vite 5), updating lockfile accordingly.

Validation for this step:
- `npm run test`: pass (2/2 tests).
- `npm run build`: pass.

Testing process now established:
1. Add focused tests with each logical feature step.
2. Run `npm run test` and `npm run build` before commit.
3. Keep reporting test additions and outcomes in this section.

### Step 3 completed: Thread-mode relation semantics in composer + uploads

Scope implemented:
- Added a shared relation builder for message send paths:
  - `src/app/features/room/composeMessageRelation.ts`
  - `getMessageRelation(replyEventId?, replyRelation?, threadId?)`
- Added unit tests for relation semantics:
  - `src/app/features/room/composeMessageRelation.test.ts`
- Wired thread context into input:
  - `src/app/features/room/RoomView.tsx` now passes `threadId` to `RoomInput`
  - `src/app/features/room/RoomInput.tsx`
    - applies `getMessageRelation(...)` for normal text send (`submit`)
    - applies `getMessageRelation(...)` for uploads (`handleSendUpload`)
    - shows thread-context input banner in thread mode even without reply draft
    - clears reply draft after upload send to avoid stale reply context

Behavior now:
- In thread mode, non-reply messages are sent as thread relations with fallback reply-to-root.
- Reply-in-thread messages preserve explicit reply target and mark `is_falling_back: false`.
- Upload messages now follow the same thread/reply relation rules as text messages.

Independent review notes:
- Separate-agent review identified one semantic issue:
  - `is_falling_back` needed to be `true` for thread-context sends without explicit reply target.
  - fixed in `composeMessageRelation.ts` and corresponding test updated.
- Follow-up review identified upload/reply-draft persistence risk:
  - fixed by clearing reply draft after upload send in `RoomInput.tsx`.

Validation for this step:
- `npm run test`: pass (7/7 tests).
- `npm run build`: pass.

Next step:
- Move from “thread context mode” to real thread timeline rendering (root + replies, thread-scoped scroll history) so the main timeline is replaced by an actual thread view.

### Step 4 completed: Thread-focused event rendering in timeline

Scope implemented:
- Added thread membership helper + tests:
  - `src/app/features/room/threadUtils.ts`
  - `src/app/features/room/threadUtils.test.ts`
- Updated `src/app/features/room/RoomTimeline.tsx` to thread-filter rendered items:
  - in thread mode, render only events that are either:
    - the thread root event (`eventId === threadId`), or
    - thread replies (`event.threadRootId === threadId`)
- Adjusted thread-mode timeline UX behavior:
  - hide room-level unread chips in thread mode
  - keep “Jump to Latest” control available
  - add thread-mode pagination sentinels (front/back anchors) without room placeholder blocks
  - guard event-open behavior in thread mode so non-thread targets are ignored
  - disable unread/focus-driven room-level auto-scroll behaviors in thread mode
  - avoid thread-mode `scrollToItem` coupling by keeping focus highlighting without forced paginator scroll

Behavior now:
- Entering thread mode replaces practical message content with thread-specific messages (root + replies), instead of showing the full mixed room timeline.
- Thread-mode input and timeline are now aligned: sends are thread-related and rendered output is thread-scoped.

Independent review notes:
- Separate-agent review flagged relation semantics and upload draft persistence in earlier steps; both fixed.
- Thread filtering review raised concerns around paginator/index coupling; mitigations added in `RoomTimeline.tsx`:
  - reduced room-level scroll/unread side effects in thread mode
  - introduced thread-mode sentinels and guarded open-event behavior.
- Remaining known risk: this is still a transitional implementation that filters from room timeline data rather than using SDK thread timeline objects (`room.getThread(...).getUnfilteredTimelineSet()`), so very long/old threads may need further hardening.

Validation for this step:
- `npm run test`: pass (10/10 tests).
- `npm run build`: pass.

Next step:
- Implement dedicated thread timeline data source using Matrix SDK thread APIs (instead of filtered room timeline), and then begin Feature 2 (`<tool>`, `<tool-group>`, `<think>...`) rendering pipeline.

---

### Step 5 completed: Dedicated SDK-backed thread timeline hardening

Scope implemented:
- Reworked `src/app/features/room/RoomTimeline.tsx` thread mode to use SDK thread data (`room.getThread(threadId)` / thread timeline set) instead of filtering virtualized room timeline items.
- Added thread-mode manual pagination controls:
  - `Load Older Messages` (backward pagination)
  - `Load Newer Messages` (forward pagination when a forward gap exists)
- Added thread-mode event index mapping and navigation hardening:
  - deterministic lookup by `eventId`
  - thread-scoped focus/highlight behavior
  - robust pending-open retry path after timeline fetch
  - stale thread guards to avoid cross-thread scroll/focus when navigation changes mid-flight.
- Replaced selector interpolation with safe DOM lookup helper for event elements (`data-message-id`) to avoid selector escaping edge cases.
- Reduced unnecessary thread refresh churn:
  - thread refresh tick only increments for thread-relevant timeline updates (thread events or relations targeting known thread events).

Behavior now:
- Entering thread mode renders root + thread replies from SDK thread structures directly.
- In-thread event opens and “jump to reply” behavior are more reliable for events that require timeline fetches first.
- Thread history gaps can be paged in both directions from the thread view.

Independent review notes:
- Ran multiple independent review passes with separate agent workflow (`claude -p`) on this step.
- First review surfaced multiple issues (focus/index coupling, selector handling, pagination gaps, stale-update risks); fixes were applied.
- Follow-up reviews found additional staleness and ordering concerns; additional guards and ordering stabilization were applied.
- Latest pass after fixes reported no crash/data-loss regressions; remaining notes were low-risk/performance-oriented.

Validation for this step:
- `npm run test`: pass (10/10 tests).
- `npm run build`: pass.
- `npm run typecheck`: fails at existing repo baseline (`matrix-js-sdk` import/type incompatibilities across many files; 918 lines in current run), not introduced by this step.

Next step:
- Start Feature 2 implementation: custom collapsible blocks for `<tool>`, `<tool-group>`, `<think>`, `<debug>`, `<system>`, `<plan>`, `<analysis>`, `<research>` in the HTML sanitizer/parser/render path.

---

### Step 6 completed: Feature 2 initial custom-tag rendering slice

Scope implemented:
- Added MindRoom tool-block protocol parser + tests:
  - `src/app/components/message/mindroomBlocks.ts`
  - `src/app/components/message/mindroomBlocks.test.ts`
  - protocol support implemented:
    - no newline -> pending
    - newline + empty tail -> completed
    - newline + non-empty tail -> completed with result
    - inline vs multiline result split.
- Extended sanitizer allow-list to preserve custom MindRoom tags:
  - `src/app/utils/sanitize.ts`
  - added: `tool`, `tool-group`, `think`, `debug`, `system`, `plan`, `analysis`, `research`.
- Extended custom HTML parser rendering:
  - `src/app/plugins/react-custom-html-parser.tsx`
  - added collapsible blocks (collapsed by default) for:
    - `<tool>`
    - `<tool-group>` (single grouped block with tool-call count)
    - `<think>`, `<debug>`, `<system>`, `<plan>`, `<analysis>`, `<research>`
  - added pending spinner/check status affordances for tool calls.
  - added inline result rendering for one-line tool results and block rendering for multiline results.
- Added dedicated styles for collapsible MindRoom blocks:
  - `src/app/styles/CustomHtml.css.ts`

Behavior now:
- MindRoom custom tags survive sanitization and render as structured collapsible UI blocks instead of plain/discarded text.
- `<tool-group>` renders as one wrapper block with grouped tool entries.
- Pending tool calls visibly show spinner status.

Independent review notes:
- Ran independent review passes via separate agent workflow (`claude -p`) on this slice.
- Addressed identified issues:
  - removed potential duplicate tool rendering path in `tool-group` handling,
  - replaced broad `name in` object check with safe `hasOwnProperty`,
  - stabilized tool-group item keys away from raw unbounded text.

Validation for this step:
- `npm run test`: pass (14/14 tests).
- `npm run build`: pass.
- `npm run typecheck`: fails at existing repo baseline (`matrix-js-sdk` typing/import incompatibilities), 919 lines in current run, not introduced by this step.

Next step:
- Continue Feature 2 with metadata-aware rendering (`io.mindroom.tool_trace`) and long-text inline rendering (`io.mindroom.long_text`), then add targeted rendering tests for parser/UI mapping.

---

### Step 7 completed: Feature 2 metadata fallback for `io.mindroom.tool_trace`

Scope implemented:
- Added metadata parser/merger utility:
  - `src/app/components/message/mindroomToolTrace.ts`
  - `buildMindroomToolTraceHtml(...)` converts structured `io.mindroom.tool_trace.events` into deterministic `<tool>` / `<tool-group>` HTML.
  - `mergeMindroomToolTraceIntoCustomBody(...)` merges generated tool-trace HTML into `formatted_body` only when explicit `<tool>` tags are not already present.
- Added focused tests:
  - `src/app/components/message/mindroomToolTrace.test.ts`
  - validates start/completed tool-trace conversion and merge behavior.
- Wired metadata fallback into text-like message rendering:
  - `src/app/components/RenderMessageContent.tsx`
  - `MsgType.Text`, `MsgType.Emote`, and `MsgType.Notice` now run through the metadata-aware content merger before calling existing `MText`/`MEmote`/`MNotice` renderers.

Behavior now:
- If backend sends `io.mindroom.tool_trace` metadata but no `<tool>` tags in `formatted_body`, client still renders tool blocks via generated HTML.
- If `<tool>` tags are already present, metadata fallback does not duplicate rendering.

Independent review notes:
- Separate-agent review pass (`claude -p`) on this diff returned **No findings**.

Validation for this step:
- `npm run test`: pass (18/18 tests).
- `npm run build`: pass.
- `npm run typecheck`: existing baseline failure remains (919 lines), unchanged by this step.

Next step:
- Implement `io.mindroom.long_text` inline expansion (download/fetch full text from MXC and render inline with fallback behavior).

---

### Step 8 completed: `io.mindroom.long_text` inline expansion (text messages)

Scope implemented:
- Added long-text metadata helpers + tests:
  - `src/app/components/message/mindroomLongText.ts`
  - `src/app/components/message/mindroomLongText.test.ts`
  - supports extraction of MXC URI from:
    - direct string metadata,
    - object metadata keys (`mxc_uri`, `mxc`, `uri`, `url`, `content_uri`) when MXC-formatted.
- Added async inline long-text renderer for text messages:
  - `src/app/components/message/MindroomLongTextText.tsx`
  - fetches full text from MXC (via authenticated `mxcUrlToHttp` + `downloadMedia`),
  - renders full text inline through existing `MText` + `RenderBody` pipeline,
  - keeps preview content as fallback if fetch fails,
  - shows lightweight loading indicator while full text is being fetched.
- Wired long-text handling into message rendering:
  - `src/app/components/RenderMessageContent.tsx`
  - `MsgType.Text` now checks `io.mindroom.long_text` metadata and switches to inline-expansion component when present.

Behavior now:
- Long AI responses sent as preview + `io.mindroom.long_text` metadata no longer require manual file download in text-message flow; full text is fetched and rendered inline.
- Existing formatting is preserved when fetched full text does not provide MindRoom custom tags.

Independent review notes:
- Initial independent review found one issue (formatted-body overwrite after full-text fetch).
- Fix applied in `MindroomLongTextText.tsx`:
  - preserve original `formatted_body` when fetched full text does not produce MindRoom-tagged HTML.
- Follow-up independent review returned **No findings**.

Validation for this step:
- `npm run test`: pass (23/23 tests).
- `npm run build`: pass.
- `npm run typecheck`: existing baseline failure remains (921 lines currently), not introduced by this step.

Next step:
- Extend long-text inline expansion to additional message types/metadata envelopes if backend emits them outside `MsgType.Text`, and add integration-style UI tests for combined tool-tag + tool-trace + long-text scenarios.

---

### Step 9 completed: Feature 3 `!` command autocomplete (start-of-message)

Scope implemented:
- Added MindRoom command catalog:
  - `src/app/features/room/mindroomCommands.ts`
  - command entries included:
    - `!help`, `!schedule`, `!list_schedules`, `!cancel_schedule`, `!edit_schedule`, `!widget`, `!config`, `!hi`, `!skill`.
- Added dedicated autocomplete query detector:
  - `src/app/features/room/mindroomCommandQuery.ts`
  - enforces:
    - command starts with `!`,
    - selection is collapsed,
    - command token is at beginning of message (only leading whitespace allowed before token).
- Added MindRoom autocomplete popup component:
  - `src/app/features/room/MindroomCommandAutocomplete.tsx`
  - filtered search, tab-to-complete, click-to-complete.
  - insertion behavior writes plain text (`!command `) into editor (no slash-command element/interception).
- Integrated into room input flow:
  - `src/app/features/room/RoomInput.tsx`
  - `!` query path is evaluated before existing `#/@/:/` paths.
  - renders `MindroomCommandAutocomplete` when `!` query is active.

Tests added:
- `src/app/features/room/mindroomCommands.test.ts`
- `src/app/features/room/mindroomCommandQuery.test.ts`

Behavior now:
- Typing `!` at the beginning of a message opens MindRoom command suggestions.
- Typing `!sch` narrows to matching commands.
- Selecting a suggestion inserts plain message text and still sends as regular text message content.

Independent review notes:
- Separate-agent review pass (`claude -p`) reported **No findings** for this step.

Validation for this step:
- `npm run test`: pass (27/27 tests).
- `npm run build`: pass.
- `npm run typecheck`: existing baseline failure remains (921 lines), unchanged by this step.

Next step:
- Add integration coverage for command insertion + send path (ensuring no slash-command interception occurs for `!`), and extend long-text inline expansion to non-text message paths if backend uses them.

---

### Step 10 completed: Finalization coverage for long-text + command insertion flow

Scope implemented:
- Extended long-text inline expansion coverage:
  - `src/app/components/RenderMessageContent.tsx`
  - `io.mindroom.long_text` now drives inline expansion for:
    - `MsgType.Text`
    - `MsgType.Emote`
    - `MsgType.Notice`
    - `MsgType.File` (rendered inline as text when long-text metadata is present, avoiding file-card-first UX).
- Generalized long-text renderer:
  - `src/app/components/message/MindroomLongTextText.tsx`
  - now supports text/emote/notice rendering modes (`MindroomLongTextKind`), preserving existing message-style semantics.
- Added deterministic long-text content resolver:
  - `src/app/components/message/mindroomLongText.ts`
  - `resolveMindroomLongTextContent(...)` centralizes merge behavior and preserves original `formatted_body` when fetched full text is plain text.
- Added integration-style pipeline tests:
  - `src/app/components/message/mindroomPipeline.test.ts`
  - validates combined behavior of:
    - tool-trace fallback HTML merge,
    - long-text resolution and precedence.
- Added command insertion helper + test coverage:
  - `src/app/features/room/mindroomCommandQuery.ts` (`insertMindroomCommand(...)`)
  - `src/app/features/room/mindroomCommandQuery.test.ts` now verifies insertion is plain text (`!command `), not slash-command element/interception.

Behavior now:
- Long-text metadata rendering is consistent across all text-like paths, including file-envelope long-text previews.
- Combined tool-trace + long-text precedence behavior is covered by tests.
- `!` command autocomplete insertion is explicitly validated as plain text.

Independent review notes:
- Independent review pass (`claude -p`) on this step returned **No findings**.

Validation for this step:
- `npm run test`: pass (32/32 tests).
- `npm run build`: pass.
- `npm run typecheck`: baseline failure persists (927 lines in current run); no new failure category introduced by this step.

Next step:
- Manual QA in a real Matrix room with rapid `m.replace` streams (thread mode + tool tags + tool-trace metadata + long-text metadata together) to confirm runtime UX under production-like timing.

---

### Step 11 completed: CI publish-on-commit Docker workflow

Scope implemented:
- Added push-based Docker publish workflow:
  - `.github/workflows/docker-publish-push.yml`
  - triggers on every branch push (every commit) and manual dispatch.
- New workflow behavior:
  - logs in to `ghcr.io` with `GITHUB_TOKEN`,
  - builds multi-arch image (`linux/amd64`, `linux/arm64`),
  - publishes tags via metadata action:
    - `commit-<sha>`
    - `<branch-name>`
    - `latest` on default branch only.
- Added per-ref concurrency guard to prevent duplicate in-flight publishes on rapid commit bursts.

Behavior now:
- Every pushed commit to a branch publishes a Docker image to:
  - `ghcr.io/<owner>/<repo>`
- Existing release workflow image publish remains unchanged for release-time publishing.

Independent review notes:
- Ran independent self-review pass for workflow triggers/tags/permissions.
- No blocking issues found; workflow is isolated from release deploy pipeline and does not require Docker Hub secrets.

Validation for this step:
- `npm run test`: pass (32/32 tests).
- `npm run build`: pass.

Next step:
- Optional: add Docker Hub push-on-commit support behind secrets with conditional login if dual-registry parity with release workflow is needed.

---

### Step 12 completed: Registry alignment to GHCR-only

Scope implemented:
- Updated release image publish job to GitHub Container Registry only:
  - `.github/workflows/prod-deploy.yml`
  - removed Docker Hub login and Docker Hub image metadata target.
  - publish job now pushes only `ghcr.io/${{ github.repository }}`.
- Commit-push publish workflow from Step 11 already targets GHCR only, so push and release paths are now consistent.

Behavior now:
- On every commit push: image is published to GHCR.
- On published release: image is published to GHCR (no Docker Hub dependency/secrets).

Independent review notes:
- Performed independent self-review of workflow triggers, permissions, registry auth and metadata targets.
- No blocking misconfiguration found; both workflows use `packages: write` and `GITHUB_TOKEN` for GHCR push.

Validation for this step:
- `npm run test`: pass (32/32 tests).
- `npm run build`: pass.

Next step:
- Optional: add a README section documenting GHCR tags (`commit-<sha>`, branch name, and `latest` for default branch on push workflow).

---

### Step 13 completed: Subpath + SSO-proxy robustness (Matrix fetch, SW toggle, auth flows)

Scope implemented:
- Centralized Matrix client factory with same-origin credentialed fetch:
  - `src/client/matrixClientFactory.ts`
  - `src/client/matrixClientFactory.test.ts`
- Replaced direct Matrix `createClient` callsites:
  - `src/client/initMatrix.ts`
  - `src/app/components/AuthFlowsLoader.tsx`
  - `src/app/pages/auth/login/loginUtil.ts`
  - `src/app/pages/auth/SSOLogin.tsx`
  - `src/app/pages/auth/reset-password/PasswordResetForm.tsx`
  - `src/app/pages/auth/register/PasswordRegisterForm.tsx`
- Auth flow loader now recoverable with retry UI:
  - `src/app/components/AuthFlowsLoader.tsx`
  - `src/app/components/AuthFlowsLoader.test.ts`
- Runtime-configurable service worker (default OFF):
  - `public/runtime-config.js`
  - `docker-entrypoint.d/99-runtime-config.sh`
  - `serve.py`
  - `src/app/utils/runtimeConfig.ts`
  - `src/app/utils/runtimeConfig.test.ts`
  - `src/index.tsx`
- Dev deps for test rendering:
  - `package.json`
  - `package-lock.json`

Behavior now:
- Same-origin Matrix API requests include cookies, cross-origin requests do not.
- Auth flow loading errors render a recoverable error with retry, no hard crash.
- Service worker registration is gated by `window.__ENABLE_SERVICE_WORKER__` and defaults to disabled.

Independent review notes:
- Performed independent self-review pass across auth flows, Matrix client creation, and SW toggle.
- Follow-up fix added to normalize `APP_ENABLE_SERVICE_WORKER` values to valid JS booleans.

Validation for this step:
- `npm run lint`: failed (`yarn` not available in environment).
- `npm run check:eslint`: failed with existing repo lint errors (no new errors from this change).
- `npm run check:prettier`: failed with existing formatting warnings.
- `npm run typecheck`: failed with existing repo type errors (matrix-js-sdk type export issues and other pre-existing failures).
- `npm run test`: pass (43/43 tests).

Next step:
- Share PR for review and verify deployment runtime-config defaults.

---

### Step 14 completed: Welcome page icon guard + docs link tests

Scope implemented:
- Replaced invalid `Icons.Book` usage and added safe icon fallback:
  - `src/app/pages/client/WelcomePage.tsx`
- Added Welcome page render tests for docs button behavior and safe icons:
  - `src/app/pages/client/WelcomePage.test.tsx`

Behavior now:
- Welcome page uses valid Folds icons and falls back to `Icons.Info` if an invalid icon is provided.
- Docs button only renders when `docsUrl` is set.

Independent review notes:
- Performed independent self-review pass for icon usage, guard, and tests.
- No blocking issues found.

Validation for this step:
- `yarn typecheck`: failed (`yarn` not available in environment).
- `yarn test`: failed (`yarn` not available in environment).
- `yarn build`: failed (`yarn` not available in environment).
- `npm run test`: pass (61/61 tests).

Next step:
- Share PR for review and verify runtime behavior in production bundle.

---

This is a living implementation runbook (not only a plan). Keep it as the first entry point for all agents, and update it after each logical implementation step.

## Current Status (2026-02-20)
- Task: Fix Welcome page icon crash after login.
- Progress:
  - Replaced invalid icon usage with valid icon and safe fallback.
  - Added Welcome page tests for docs button behavior and safe icon usage.
- Validation:
  - `yarn typecheck`: failed (`yarn` not available in environment).
  - `yarn test`: failed (`yarn` not available in environment).
  - `yarn build`: failed (`yarn` not available in environment).
  - `npm run test`: pass (61/61 tests).
- Next steps:
  - Share PR for review and verify runtime behavior in production bundle.
