# MindRoom Cinny Fork Changes

## Runbook

### Scope

- `dev` now keeps issue-backed history only.
- Old recovery/debugging branches were intentionally squashed out of mainline history.
- Use [docs/timeline-debugging-playbook.md](/Users/basnijholt/Code/dev/mindroom-cinny/docs/timeline-debugging-playbook.md) for future room/thread/search investigations instead of rebuilding long transient notes here.

### Current Feature Set On `dev`

- `CINNY-038`
  - Recovers cached thread hydration and truncation behavior so cached thread opens prefer complete local thread data instead of thin slices.
- `CINNY-040`
  - Drops structural table whitespace parser nodes that polluted rendering.
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

### Validation Standard

- Every logical code step should finish with:
  - `npm test`
  - `npm run typecheck`
  - `npm run build`
- For docs-only or narrowly scoped work, at minimum run the relevant focused validation plus `git diff --check`.

### Current Baseline

- Cleaned issue-backed `dev` history starts at `96b13bcc`.
- Current green baseline at `HEAD`:
  - `npm test` passes (`102/102` files, `861/861` tests)
  - `npm run typecheck` passes
  - `npm run build` passes

### Operational Notes

- [justfile](/Users/basnijholt/Code/dev/mindroom-cinny/justfile) is intentionally kept for common local validation commands.
- [docs/timeline-debugging-playbook.md](/Users/basnijholt/Code/dev/mindroom-cinny/docs/timeline-debugging-playbook.md) is the persistent debugging reference for timeline/cache/search work.
- Current `dev` also restores two small non-issue runtime guards that were accidentally dropped during issue-history cleanup:
  - the Settings avatar-cache refetch guard,
  - and swallowed URL preview effect rejection.
- Backup branch created before the issue-only history cleanup:
  - `backup/dev-before-issue-squash-20260330-102644`
