# Inline Canvases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:executing-plans, in one fresh subagent per repo (backend Task 1; Chat Tasks 2 to 5), because the tasks are short and share one interface; a cross-model whole-branch review follows.

**Goal:** `show_canvas(inline=True)` shows the agent's page in the thread, fitted to its height, instead of opening the side panel.

**Architecture:** The backend adds `"inline": true` to the canvas request, fixed at first show like `share_state`. Chat parses it, skips the auto open, and renders the page inside the canvas notice through the existing canvas wrapper document, with a new size message from the bridge.

**Tech Stack:** Python (backend, pytest), React + TypeScript + vitest + Playwright (Chat).

**Spec:** `docs/baspowers/specs/2026-11-15-inline-canvas-design.md` (in the Chat repo).

## Global Constraints

- Panel canvases (no `inline`) behave exactly as before.
- Chat repo rules (its `AGENTS.md`): strict TS, `just typecheck`, `just strict`, `just lint` clean; tests beside their subject; no barrel files; no em dashes; files added by explicit path; unsigned commits; commands in `nix develop`.
- New UI strings go in `src/app/i18n/locales/additions/en.json` and all 16 overlays; prefer reusing existing canvas strings.
- Sizes beside app UI in rem/em, except the frame height, which is in CSS px because the page reports px.
- Height bounds: minimum 80px, maximum 20000px, 160px before the first size message.
- Size message: `{ type: 'mindroom.canvas.size', version: 1, height: number }`, posted to `parent.parent` with `'*'`, like the bridge's other messages.

## Review Focus

- A page that grows with its frame (`height:100vh`): the 20000px cap must stop the loop; test the clamp.
- A size message from another window or another canvas's frame: ignored (source must be this frame's `canvasFrameWindow`, origin `'null'`).
- An update of an inline canvas: the thread shows the new revision (the notice re-renders from the latest replacement), and the frame remounts.
- An edit that tries to change `inline`: Chat rejects it as for `share_state`.
- Canvases disabled for the deployment (`clientConfig.mindroom?.canvas?.enabled !== true`): no inline frame, notice renders as today.

---

### Task 1 (backend repo `~/repos/worktrees/mindroom-inline-canvas`): `show_canvas(inline=...)`

**Files:**
- Modify: `src/mindroom/custom_tools/chat_ui.py` (`show_canvas`, `_canvas_metadata`, `_FUNCTION_INSTRUCTIONS["show_canvas"]`, docstring)
- Modify: `tests/chat_ui_contract_fixture.py` and whatever regenerates the Chat contract fixture (`src/app/ui-actions/__fixtures__/chatUiBackendContract.json` in the Chat repo; read `tests/test_chat_ui_contract_fixture.py` to learn how)
- Test: `tests/test_chat_ui_tools.py`

**Interfaces:**
- Produces: request data field `"inline": True` (absent when false), beside `"share_state"`.

- [ ] Write failing tests in `tests/test_chat_ui_tools.py`: `test_show_canvas_inline_marks_request` (first show with `inline=True` sends data containing `"inline": True`; without it the key is absent), `test_show_canvas_update_keeps_original_inline` (update of an inline canvas keeps `"inline": True` even when called with `inline=False`; update of a panel canvas called with `inline=True` stays without it). Model them on the existing `share_state` tests.
- [ ] Run `NIX_PATH=nixpkgs=flake:nixpkgs nix-shell --run 'uv run pytest tests/test_chat_ui_tools.py -x -n 0 --no-cov'`; expect the new tests to fail.
- [ ] Implement: `show_canvas(..., share_state: bool = False, inline: bool = False)`; new canvas adds `{"inline": True}` to the action fields when set; `_canvas_metadata` copies the original's `inline` like it handles `share_state`. Add the spec's guidance text (section "Backend: tool guidance") to the docstring and an `inline` Args line: "Show the page in the conversation instead of the side panel; decided when the canvas is first shown, updates keep it." Extend `_FUNCTION_INSTRUCTIONS["show_canvas"]` with one sentence: "With inline=True the page appears in the conversation itself, for mockups, diagrams and charts."
- [ ] Add an inline canvas case to the contract fixture and regenerate the Chat fixture JSON per the fixture test's instructions; write the regenerated JSON to `/tmp/inline-canvas-contract.json` and report its path (Task 2 copies it into the Chat repo).
- [ ] Run the test file and `tests/test_chat_ui_contract_fixture.py`; expect PASS. Run `pre-commit run --files <changed files>` if configured.
- [ ] Commit: `feat(chat_ui): show_canvas(inline=True) shows the page in the thread`.

### Task 2 (Chat): protocol field

**Files:**
- Modify: `src/app/matrix/protocol/chatUiProtocol.ts` (type `ChatUiAction` show_canvas branch, `AUTHORITY_FIELDS`, the `share_state` read near line 270)
- Modify: `src/app/ui-actions/__fixtures__/chatUiBackendContract.json` (from Task 1's output) and the test that reads it
- Test: `src/app/matrix/protocol/chatUiProtocol.test.ts`

**Interfaces:**
- Produces: `show_canvas` action has `inline?: true`.

- [ ] Failing tests: a request with `inline: true` reads as `{ ..., inline: true }`; without it `inline` is undefined; an edit whose data changes `inline` is rejected like a `share_state` change.
- [ ] Implement: add `'inline'` to `AUTHORITY_FIELDS`; read `data.inline === true ? { inline: true as const } : {}` next to `shared`.
- [ ] `nix develop -c just test src/app/matrix/protocol src/app/ui-actions`; PASS. Commit.

### Task 3 (Chat): size message and inline page style

**Files:**
- Modify: `src/app/messages/canvas/canvasDocument.ts`
- Test: `src/app/messages/canvas/canvasDocument.test.ts`

**Interfaces:**
- Produces: `CANVAS_SIZE_MESSAGE = 'mindroom.canvas.size'`; `readCanvasSize(event: MessageEvent, frame: Window | null | undefined): number | undefined` (same source/origin checks as `readCanvasSubmission`; returns a finite positive height); `buildCanvasDocument(..., saved, inline = false)` and `buildCanvasPage(..., saved, inline = false)`; `clampInlineCanvasHeight(height: number): number` (`min(20000, max(80, ceil(height)))`).

- [ ] Failing tests: bridge script contains a `ResizeObserver` that posts `CANVAS_SIZE_MESSAGE` (assert on the built page string like existing tests do); `readCanvasSize` accepts `{type, version: 1, height: 412.3}` from the frame with origin `'null'` and rejects other sources, origins, versions, `NaN`, `0`, negative; `clampInlineCanvasHeight` maps `10 -> 80`, `412.3 -> 413`, `50000 -> 20000`; with `inline=true` the base style has `background:transparent` and `padding:8px`, without it the style is unchanged.
- [ ] Implement: bridge measures `Math.ceil(document.documentElement.scrollHeight > document.documentElement.clientHeight ? scrollHeight : getBoundingClientRect().height)` (T3's formula), posts only on change, observes `documentElement` and `body` after `DOMContentLoaded`, and on `load`.
- [ ] `nix develop -c just test src/app/messages/canvas`; PASS (existing tests unchanged). Commit.

### Task 4 (Chat): inline frame in the canvas notice

**Files:**
- Create: `src/app/messages/canvas/InlineCanvasFrame.tsx`, `src/app/messages/canvas/InlineCanvasFrame.css.ts` if styles are needed
- Modify: `src/app/messages/content/renderAgentMessageContent.tsx` (canvas notice branch, about line 448)
- Test: `src/app/messages/canvas/InlineCanvasFrame.test.tsx`, `src/app/messages/content/renderAgentMessageContent.test.ts`

**Interfaces:**
- Consumes: Task 2 `inline`, Task 3 `buildCanvasDocument(..., inline)`, `readCanvasSize`, `clampInlineCanvasHeight`, `canvasFrameWindow`, `CANVAS_WRAPPER_SANDBOX`; `useCanvasPage` (`src/app/canvas/useCanvasPage.ts`); theme the way `RoomCanvasPanel.tsx` gets it (`useTheme`, `readCanvasTheme`, the one-frame-later re-read); libraries and enabled flags the way `Room.tsx` reads `clientConfig.mindroom?.canvas`.
- Produces: `InlineCanvasFrame({ event }: { event: MatrixEvent })`, rendering nothing unless the event's chat UI action is an enabled inline `show_canvas`.

- [ ] Failing tests: renders an iframe with `sandbox` = `CANVAS_WRAPPER_SANDBOX` and height 160px for an inline canvas; a size message from the frame's canvas window sets height to the clamped value; a message from another source does not; a panel canvas renders no frame; disabled canvases render no frame; submit and state messages cause no send.
- [ ] Implement the component (frame `title` = canvas title, width 100%, block, no border; `key` on revision event id plus document hash so updates remount; loading and failed lines with retry like `CanvasPanel`'s). Place it in the notice's `renderAfterBody` before `ChatUiActionButton`.
- [ ] `nix develop -c just test src/app/messages`; PASS. Commit.

### Task 5 (Chat): no auto open for inline canvases, screenshots

**Files:**
- Modify: `src/app/ui-actions/chatUiController.ts` (auto-open decision near `autoOpenFromHomeservers`)
- Test: `src/app/ui-actions/chatUiController.test.ts`; throwaway `e2e/canvas/zz-inline-canvas-shots.spec.ts` (never committed)

- [ ] Failing test: an inline `show_canvas` from an auto-open homeserver is not performed; a panel canvas still is; activating the inline one from its button still performs it.
- [ ] Implement; run `nix develop -c just test src/app/ui-actions`; PASS. Commit.
- [ ] Screenshots: model a throwaway spec on `e2e/canvas/agent-canvas-auto-open.spec.ts`; send an inline canvas notice (a small mockup page with a card and an SVG chart, height about 400px) and a panel canvas; assert the inline frame's height fits (between 300 and 600px), the panel did not open, the button opens it. Capture desktop and phone (390px) in light and dark into `/tmp/inline-canvas-shots/`. Run on a private slot: `nix develop -c bash -c 'scripts/e2e-slot.sh <n> npx playwright test e2e/canvas/zz-inline-canvas-shots.spec.ts --reporter=line'`. Trash the spec and `test-results/` after.
- [ ] Gates: `just typecheck`, `just strict`, `just lint`, then the full suite on another machine (`~/repos/dev/scripts/mac-runner/remote-test.sh m5 <commit> vitest`, after pushing is done by the coordinator; locally only focused tests).
