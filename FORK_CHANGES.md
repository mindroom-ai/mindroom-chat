# MindRoom Cinny Fork Changes

## Runbook

### Scope

- `dev` now keeps issue-backed history only.
- Old recovery/debugging branches were intentionally squashed out of mainline history.
- Use [docs/timeline-debugging-playbook.md](/Users/basnijholt/Code/dev/mindroom-cinny/docs/timeline-debugging-playbook.md) for future room/thread/search investigations instead of rebuilding long transient notes here.

### Current Feature Set On `dev`

- `CINNY-037`
  - Revokes blob URLs across media/file previews and cleans up `usePan` document listeners on unmount to stop client-side leaks during room and media navigation.
- `CINNY-038`
  - Recovers cached thread hydration and truncation behavior so cached thread opens prefer complete local thread data instead of thin slices.
- `CINNY-040`
  - Drops structural table whitespace parser nodes that polluted rendering.
- `CINNY-041`
  - Applies the safe subset only:
    - `CollapsibleMessage` overflow measurement now re-runs only when the semantic message identity changes, and no longer disables wrapper scroll anchoring.
    - Room overview refresh ignores non-thread `RoomEvent.Timeline` traffic while still refreshing for thread-targeted events and receipts.
- `CINNY-028`
  - Adds tri-state thread filters, tag filtering, natural sort, and `threadTags` migration.
- `CINNY-028b`
  - Shows thread status counts on filter/toggle icons.
- `CINNY-028c`
  - Adds the compact thread bar with info popover, presets, and search.
- `CINNY-028d`
  - Replaces the old compact text toggle with the icon-button version.
- `CINNY-030`
  - Persists thread filter state in `localStorage`.
- `CINNY-035`
  - Adds compact thread view with AI summaries and rich metadata.
  - Includes the compact-root follow-up behavior that now:
    - supplements roots from the server thread list,
    - hydrates previews from cached/local thread data,
    - and rejects nested threaded replies as fake top-level compact roots.
- `CINNY-035a`
  - Adds colored tag pills to compact thread cards.
- `CINNY-035b`
  - Makes the compact room view stretch to full available width.
- `CINNY-042`
  - Stabilizes long-text hydration identity.
- `CINNY-043`
  - Startup performance optimizations:
    - parallel IndexedDB + crypto initialization,
    - cached UI can render while sync catches up,
    - reduced sync/archive pressure during startup.
- `CINNY-024/CINNY-023`
  - Stabilizes search rendering and navigation.
  - Keeps search responsive while preserving richer message rendering than the earlier plain-preview stopgap.
- `CINNY-044`
  - Active avatar opens Settings directly.
- `CINNY-045`
  - Adds click-to-expand collapsible messages with floating close affordance.
- `CINNY-045b`
  - Improves collapsible-message iconography and close-button UX.
- `CINNY-045c`
  - Fixes scroll-into-view timing and overflow behavior for collapsible messages.
- `CINNY-046`
  - Waits for service-worker control before mounting the app.
- `CINNY-047`
  - Uses `EventTimeline.FORWARDS` instead of string literals in thread code paths.
- `CINNY-047b`
  - Preserves `mx.sendStateEvent` binding by calling it directly.
- `CINNY-048`
  - Gates UI on first sync to avoid the startup screen flash.
- `CINNY-050`
  - Adds tag management UI to the thread context banner (ThreadContextBanner component with tag pills, picker, and resolve toggle).
  - Includes the compatibility fix for the parsed thread-tags shape:
    - `useRoomThreadTags` now unwraps `parseThreadTagsContent(...).tags` correctly,
    - resolved status is computed with `isThreadResolved(...)`,
    - and room/thread resolved filters render correctly again after the tag-management merge.
- `CINNY-050c`
  - Fixes tag picker input focus: removes explicit `initialFocus` from FocusTrap (lets it default to first tabbable element, matching working patterns like AdditionalCreatorInput), adds `useEffect`+`requestAnimationFrame` safety net for portal timing.
  - Improves empty-state UX: shows "Type to create a tag" when no tags exist instead of "No tags available".
- `CINNY-053`
  - Fixes iOS Safari keyboard dismiss scroll bug: adds `interactive-widget=resizes-content` to the viewport meta tag and a `useIOSKeyboardFix` hook that resets stale scroll offsets when the virtual keyboard is dismissed.

### Validation Standard

- Every logical code step should finish with:
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
- For docs-only or narrowly scoped work, at minimum run the relevant focused validation plus `git diff --check`.

### Current Baseline

- Cleaned issue-backed `dev` history starts at `96b13bcc`.
- Current green baseline at `HEAD`:
  - `npm test` passes (`109/109` files, `931/931` tests)
  - `npm run typecheck` passes
  - `npm run build` passes

### Operational Notes

- [justfile](/Users/basnijholt/Code/dev/mindroom-cinny/justfile) is intentionally kept for common local validation commands.
- [docs/timeline-debugging-playbook.md](/Users/basnijholt/Code/dev/mindroom-cinny/docs/timeline-debugging-playbook.md) is the persistent debugging reference for timeline/cache/search work.
- `CINNY-054` planning investigation (2026-03-31):
  - confirmed the markdown pipeline is Cinny's in-repo regex parser under `src/app/plugins/markdown/*`, wired into compose/search via `src/app/components/editor/output.ts` and `src/app/features/message-search/searchResultPreview.ts`; it is neither `unified/remark/rehype` nor `markdown-it`.
  - confirmed incoming formatted HTML is sanitized in `src/app/utils/sanitize.ts` and rendered through `src/app/plugins/react-custom-html-parser.tsx`.
  - `data-mx-maths` is already allowlisted in the sanitizer, but no render-time or compose-time math handling exists yet.
  - implementation plan recorded in `.claude/PLAN.md`.
  - implementation status (2026-03-31):
    - added `katex` plus shared math parsing/rendering helpers in `src/app/plugins/math.tsx`, with app-level KaTeX CSS loaded from `src/index.tsx`.
    - incoming render paths now handle `span/div[data-mx-maths]` and raw `$...$` / `$$...$$` text, while skipping escaped dollars, currency-like text, and backtick code spans/blocks.
    - markdown compose now emits Matrix math HTML (`data-mx-maths`) for inline and display math, and editor markdown mode reconstructs `$...$` / `$$...$$` when loading incoming Matrix math HTML.
    - added focused coverage in `src/app/plugins/react-custom-html-parser.test.ts` and `src/app/components/editor/math.test.ts`.
    - review-fix follow-up:
      - `tokenizeTextWithLatex()` now preserves backtick spans as verbatim segments and protects URL spans before math scanning, so escaped `\$` remains literal inside backticks and raw URLs containing `$...$` are linkified intact instead of being split by math rendering.
      - inline math now requires non-alphanumeric boundaries around the delimiters, and numeric-only inline content is left raw to avoid currency false positives such as `$5+$10$`.
      - display math remains top-level only by design; nested `div[data-mx-maths]` inside blockquotes/lists is preserved as raw `$$...$$` text on markdown import instead of flattening to bare LaTeX.
      - added regressions for escaped `\$` inside backticks, currency-like inline text, URLs containing `$`, and blockquote display-math raw round-tripping.
    - validation:
      - `npm test` passes (`106/106` files, `911/911` tests).
      - `npm run typecheck` passes.
      - `npm run build` passes; build now emits KaTeX font assets/CSS as part of the bundle.
      - `npm run lint` does not pass at repo baseline because `eslint src/*` crashes across the tree with the existing TypeScript parser `originalKeywordKind` deprecation error, and `npm run check:prettier` also reports broad pre-existing formatting drift outside this change.
- `CINNY-037` was reapplied on top of the cleaned issue-backed `dev` history:
  - `src/app/hooks/useBlobUrlCleanup.ts` revokes blob URLs on URL change and unmount.
  - Media/file consumers wired into that cleanup: `ImageContent`, `VideoContent`, `AudioContent`, `ThumbnailContent`, `FileContent`, and `FileHeader`.
  - `src/app/hooks/usePan.ts` now tears down active document listeners on unmount.
  - Reapplied validation: `npm run typecheck`.
- Current `dev` also restores two small non-issue runtime guards that were accidentally dropped during issue-history cleanup:
  - the active settings avatar now survives clear-cache reload by preferring the stored avatar fallback with authenticated thumbnail URLs,
  - the Settings avatar-cache refetch guard,
  - and swallowed URL preview effect rejection.
- Authenticated media URLs now fall back to query-token URLs before service-worker control is established.
  - This restores room/sidebar/header/settings avatars during startup and clear-cache reloads, when the page can render before the service worker is actively controlling the document.
- Latest remote regression fixed on top of `gitea/dev`:
  - `CINNY-050` introduced a parser/API mismatch where `parseThreadTagsContent()` returned `{ tags }`, but `useRoomThreadTags` still treated the parsed object itself as the tag map.
  - Symptom: compact/room thread buttons stopped showing `Resolved`, and the `Resolved` filter in Personal returned zero threads live.
  - Validation: live MCP repro on Personal room plus `npm test`, `npm run typecheck`, and `npm run build`.
- Latest local edit-reconciliation hardening (2026-03-31):
  - extracted shared serialized edit helpers into `src/app/utils/editEvent.ts` so room render, thread render, and cached-event hydration all apply the same validation rules.
  - serialized bundled replacements now require a real positive `origin_server_ts`; malformed bundled edits are ignored consistently.
  - `getEditedEvent()` now truthfully rejects sender-mismatched SDK/bundled replacements before candidate selection, instead of logging `*Rejected` while still passing them downstream.
  - room edit resolution now uses explicit candidate ordering so same-timestamp ties prefer the server-bundled replacement over raw relation edits.
  - added regression coverage in:
    - `src/app/utils/room.test.ts`
    - `src/app/features/room/threadRenderUtils.test.ts`
    - `src/app/features/room/eventCacheEditUtils.test.ts`
  - validation:
    - `npm test`
    - `npm run typecheck`
    - `npm run build`
    - live MCP repro on `/#personal` thread permalink `threadId=$eLBXTjJGVLGW3clgjAjBTI9SsBapa6hwl70_tVbjlUA`:
      - first load and hard reload both rendered `96` message rows,
      - the first `12` visible message ids/text snippets stayed identical across reload,
      - visible `Thinking...` count remained `0`.
- Backup branch created before the issue-only history cleanup:
  - `backup/dev-before-issue-squash-20260330-102644`
