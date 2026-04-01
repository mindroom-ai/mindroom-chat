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

### Validation Standard

- Every logical code step should finish with:
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
- For docs-only or narrowly scoped work, at minimum run the relevant focused validation plus `git diff --check`.

### Current Baseline

- Cleaned issue-backed `dev` history starts at `96b13bcc`.
- Current green baseline at `HEAD`:
  - `npx vitest run` passes (`103/103` files, `873/873` tests)
  - `npm run typecheck` passes
  - `npm run build` passes

### Operational Notes

- [justfile](/Users/basnijholt/Code/dev/mindroom-cinny/justfile) is intentionally kept for common local validation commands.
- [docs/timeline-debugging-playbook.md](/Users/basnijholt/Code/dev/mindroom-cinny/docs/timeline-debugging-playbook.md) is the persistent debugging reference for timeline/cache/search work.
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
- Backup branch created before the issue-only history cleanup:
  - `backup/dev-before-issue-squash-20260330-102644`
