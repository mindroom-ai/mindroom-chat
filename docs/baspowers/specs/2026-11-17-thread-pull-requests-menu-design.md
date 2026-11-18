# Thread pull requests menu

## Understanding

Bas (2026-11-17, voice + phone screenshot of an open thread in Mindroom-Dev): "Here it should work more like T3 Code. Instead of showing all those pull request status tags separately, there should be a single icon that I can click that opens a menu that shows a list with all the pull requests that I can click on. We can use that exact same UI element."

The screenshot: an open thread with 11 linked pull requests. The pull request plugin's room header strip (`ThreadPullRequestStrip`, a `roomHeaderSlot` contribution) draws one chip per PR (`pull-request-… #15`, `mindroom-chat #502`, …) in four wrapped rows between the room header and the thread's banner, about 250 px of a phone screen.

What T3 Code does (pingdotgg/t3code `055b4491`): the header has one icon toggle, `PanelLayoutControls.tsx` "Toggle thread details" (`SquareMenuIcon`), which opens the thread details card (`ThreadDetailsCard.tsx`, a popover on narrow layouts). Its pull request section (`ThreadDetailsPrRows.tsx`) lists the thread's PRs as rows (state glyph, `#N: title`, status), each opening that PR; the branch row sits above them.

The "same UI element" in MindRoom: the plugin's thread details rows (`src/ThreadDetails.tsx`: state icon, `repo #N`, state in words, checks, title; then the worktree's branch and path), already shown in the thread's hover card and at the top of the thread's ⋮ menu.

Said by Bas: one icon, a menu listing every PR, each row clickable; T3 Code as the model. Assumed:
- The icon goes in the open thread's banner row (`ThreadContextBanner`, next to ⋮ / pin / resolve), as T3 puts its toggle in the header row. That row exists on phones and desktop, so the strip's rows of vertical space go away entirely.
- A row click does what a chip click does today: open the PR in the plugin's side panel (`panel.open(pr)`); a row for the PR the panel already shows is marked current.
- The Compact view's card chips (`ThreadCardPullRequests`) stay: Bas pointed at the open thread.

## Scope

In:
- App: a new plugin contribution kind, `threadHeaderSlot`, components drawn in the open thread's banner row before the ⋮ button. SDK version 63.
- Plugin: replace `ThreadPullRequestStrip` with `ThreadPullRequestsButton` (contributed to `threadHeaderSlot`): a PR icon button with the count, opening a menu of the thread's PRs and its worktree.

Out:
- Compact card chips, hover cards, the ⋮ menu's details group (unchanged).
- Any state colour or GitHub request on the closed button: it asks GitHub nothing until the menu opens.

## SDK: `threadHeaderSlot`

`threadHeaderSlot?: readonly ComponentType<{ room: Room; threadId: string }>[]` on `ClientPlugin`, registered like `roomHeaderSlot` (`registry.ts`, frozen array, non-arrays ignored).

`src/app/threads/ThreadHeaderSlot.tsx` renders the components of enabled plugins in build order, each in its own `ErrorBoundary` (fallback null, logged and reported with `[plugin <id>@<version>]`, as `RoomHeaderSlot` does) and `Suspense` (fallback null). It renders nothing when no enabled plugin contributes.

`ThreadContextBanner` renders it in the expanded row's button group, before ⋮, and in the collapsed row after the approval chips, only once the thread root is a confirmed server event (`isConfirmedMatrixEventId`), the same rule the ⋮ menu's details use. A component returns null to show nothing. Components draw icon-sized controls with the SDK's `IconButton`/`IconTooltip`, matching the banner's neighbours.

Docs: a "Thread header slot" section in `docs/client-plugins.md`, "now 63", and "version 63 `threadHeaderSlot`" under "What each version added". The example plugin gets one contribution. `CLIENT_PLUGIN_API_VERSION` 62 to 63.

## Pull request plugin

`ThreadPullRequestsButton({ room, threadId })`:
- Reads `useThreadPullRequests(room, threadId)`. No PRs and no worktree: renders null.
- The button: the SDK's `IconButton` with the `GitPullRequestArrow` glyph and the PR count beside it (no count for one PR; worktree only: the `GitBranch` glyph), wrapped in `IconTooltip` with "Pull requests (N)" / "Worktree", `aria-haspopup="menu"`, `aria-expanded`. Sized in rem and styled like the banner's other icon buttons (measure them).
- Click opens a menu (SDK `Menu` in `PopOut`, anchored to the button, closes on Escape, outside click and after a row click, focus returns to the button). Rows:
  - One per PR, the thread details row (`PullRequestDetails` from `ThreadDetails.tsx`, extracted so both render the same thing), as a button: click opens the PR in the side panel (`useRoomSidePanel('pull-requests', 'pull-request')`); where the page has no panel controls, the row is a link to the PR on GitHub (`target="_blank"`). The row for the PR the open panel shows has `aria-current="true"` and the selected style the chip had.
  - The worktree (branch and path), as the details block shows it, not clickable, last.
  - A long list scrolls inside the menu (max height from the viewport); no cap.
- GitHub requests: the rows use the existing `usePullRequestStatus` keys, so the menu costs no request for a PR already loaded, and none without a token beyond what the strip asked (it asked every PR on mount; the menu asks only when open).
- `index.tsx`: `roomHeaderSlot` entry removed, `threadHeaderSlot: [ThreadPullRequestsButton]`; `ThreadPullRequestStrip.tsx` and its test deleted; `apiVersion` 63; strings in `src/strings.ts`; README updated.

## Testing

- App unit: `ThreadHeaderSlot` renders contributions in order, skips disabled plugins, isolates a throwing component; banner renders it in both rows and not before the root is confirmed. Example plugin test covers the kind.
- Plugin unit: button hidden without PRs/worktree; count; menu opens, lists every PR and the worktree, row click calls `panel.open` with the same ref as the old chip and closes the menu; current row marked; no-panel row is a GitHub link; no GitHub request while the menu is closed.
- Plugin e2e (Playwright, slot with `--preview`): open a thread with 3 linked PRs and a worktree, click the button, click a row, panel opens; phone viewport too. Screenshots: before (strip) and after (button closed, menu open) on desktop and phone.
- `npx vite build` (vanilla-extract) and `just strict` in the app; prettier, tsc and vitest in the plugin.

## Delivery

Two PRs: mindroom-chat (kind, SDK 63) merges first, then pull-request-client-plugin (its CI typechecks against client `main`). Then pins (chat `bundled-plugins.txt`, mindroom-infra `pins/`) and a web publish when Bas asks.
