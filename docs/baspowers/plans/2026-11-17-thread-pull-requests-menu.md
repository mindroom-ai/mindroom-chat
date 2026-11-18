# Thread pull requests menu: plan

Spec: `docs/baspowers/specs/2026-11-17-thread-pull-requests-menu-design.md`.

Worktrees: app `~/repos/worktrees/mindroom-chat-pr-menu` (branch `feat/thread-banner-actions`), plugin `~/repos/worktrees/pull-request-client-plugin-pr-menu` (branch `feat/pull-requests-menu`, `.mindroom-chat` links to the app worktree).

## Task 1: app kind `threadHeaderSlot` (mindroom-chat)

1. Test first: `src/app/threads/ThreadHeaderSlot.test.tsx` (order, disabled plugin, throwing component isolated and reported), registry test for the new field.
2. `src/app/plugins/registry.ts`: `ThreadHeaderSlotComponent = ComponentType<{ room: Room; threadId: string }>`, `threadHeaderSlot?` on `ClientPlugin`, frozen array on `RegisteredPlugin`, exported from `src/client-sdk/core.ts` as a type.
3. `src/app/threads/ThreadHeaderSlot.tsx`, modelled on `src/app/room/RoomHeaderSlot.tsx`, plus `Suspense`.
4. `ThreadContextBanner.tsx`: render it before ⋮ in the expanded row and after the approval chips in the collapsed row, only for a confirmed root (`isConfirmedMatrixEventId`). Banner test for both rows.
5. `scripts/client-plugins.mjs` 62 to 63; `docs/client-plugins.md` section + "now 63" + version list; example plugin contribution (`src/app/plugins/__fixtures__/example-plugin/index.tsx`) and its test.
6. Gates: `nix develop -c npx vitest run <touched tests>`, `NODE_OPTIONS=--max-old-space-size=6144 nix develop -c just strict` (or lint + typecheck), `nix develop -c npx vite build`. Commit.

## Task 2: plugin button and menu (pull-request-client-plugin)

1. Test first: `src/ThreadPullRequestsButton.test.tsx` (spec Testing list), adapted from `ThreadPullRequestStrip.test.tsx`.
2. Extract `PullRequestDetails` (and the worktree block) from `ThreadDetails.tsx` so the menu renders the same rows; `ThreadDetails` keeps its output.
3. `src/ThreadPullRequestsButton.tsx`: SDK `IconButton` + `IconTooltip` trigger, `PopOut` + `Menu` list (see `src/detail/DiffOptionsMenu.tsx` for the SDK menu pattern), rows as buttons opening the side panel or GitHub links without panel controls, `aria-current` for the shown PR.
4. `index.tsx`: drop `roomHeaderSlot`, add `threadHeaderSlot`; delete `ThreadPullRequestStrip.tsx` + test; drop dead `mrpr-thread-strip` CSS; `package.json` `apiVersion` 63; strings; README.
5. Gates (from the plugin README): vitest from the app worktree with `MINDROOM_CLIENT_PLUGINS=<plugin dir> MINDROOM_CLIENT_PLUGIN_TESTS_ONLY=1 ... --minWorkers=1 --maxWorkers=4`, prettier check, tsc. Commit.

## Task 3: e2e and screenshots

Plugin e2e spec for the menu (desktop + phone), screenshots before (plugin `main`) and after: closed button, open menu, panel opened from a row. Neighbour measurement of the banner's icon buttons in the spec run.
