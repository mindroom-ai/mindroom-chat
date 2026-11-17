# Inline thinking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development. The plan has six tasks in two repos, with interfaces that cross the wire, so each task gets a fresh implementer and reviewer.

**Goal:** Show each reasoning segment of an agent reply where it happened, toggled by the bulb as the cog toggles tool runs.

**Architecture:** The backend records each segment's UTF-16 start in the joined reasoning text, its tool count (`after_tool`) and its duration. It sends them in `io.mindroom.reasoning.segments` and in live frames. The client places each segment after its rendered tool marker, and renders it from `ToolRefGroupBlock` or under the header line.

**Tech Stack:** Python 3 (mindroom, pytest under nix-shell/uv); React + TypeScript + vanilla-extract (mindroom-chat, vitest, Playwright).

**Spec:** `/home/basnijholt/repos/worktrees/mindroom-chat-inline-thinking/docs/baspowers/specs/2026-11-16-inline-thinking-design.md`. Read it first; it holds the contract.

## Global Constraints

- Worktrees: backend `/home/basnijholt/repos/worktrees/mindroom-inline-thinking` (branch `inline-thinking-segments`); client `/home/basnijholt/repos/worktrees/mindroom-chat-inline-thinking` (branch `inline-thinking`). Never touch `~/repos/dev/*`, `/srv/mindroom`, or another worktree.
- Contract field names exactly: `segments`, `start`, `after_tool`, `duration_ms`; live content key `io.mindroom.live_reasoning_segments`.
- `start` counts UTF-16 code units. Starts are strictly increasing, and the first is 0.
- Old events without `segments` must look and behave as one segment at the top.
- The body and plain Matrix clients see no change; there is no new marker line.
- No em dashes in code comments, docs, or commit messages (mindroom-chat AGENTS.md).
- `git add` explicit paths only; never `git add -A`; never `git stash` (refs/stash is shared across worktrees); never push.
- Every commit ends with `--trailer "Assisted-by: MindRoom <your display name>:<your model id> <https://github.com/mindroom-ai/mindroom>"`.
- Backend tests: `cd <backend worktree> && NIX_PATH=nixpkgs=flake:nixpkgs nix-shell --run 'uv run pytest <file> -x -n 0 --no-cov'`. Client: `cd <client worktree> && nix develop -c just test <file>`; also `nix develop -c just typecheck` and `nix develop -c just lint` before committing.

## Review Focus

1. A reasoning text holding an emoji or another non-BMP character before a later segment: the starts must still slice correctly in JS (UTF-16). Tests in Task 1 and Task 4.
2. Thinking between two consecutive tool calls with no text between them: with the bulb open, the run splits and the thinking shows between the calls; with the bulb closed, the run stays whole. Test in Task 5.
3. A reply whose agent hides tool calls (no markers): every segment shows at the top. Tests in Task 1 (`after_tool` 0) and Task 4 (no markers).
4. Reasoning cut to fit an ordinary event: segments past the cut are dropped, and the client never slices past the end. Tests in Task 2 and Task 4.
5. Old clients receiving new live frames, and new clients reading old frames or events: unknown keys are ignored, and missing keys fall back. Tests in Task 3 and Task 4.

---

## Part A: backend (mindroom)

### Task 1: Record segments in `StreamingResponse`, the final event and live frames

**Files:**
- Modify: `src/mindroom/streaming.py` (`add_reasoning` ~658, `end_reasoning_segment` ~666, `live_state` ~690-710, `_delivery_extra_content` ~1125-1135)
- Modify: `src/mindroom/live_frames/frames.py` (`LiveDocs`, `to_json`, `live_delta`)
- Test: `tests/live_frames/test_live_streaming.py`, `tests/live_frames/test_frames.py`

**Interfaces:**
- Produces: `LiveDocs.segments: tuple[dict[str, int], ...] = ()` (each `{"start", "after_tool"}`); final `REASONING_CONTENT_KEY` value `{"text", "duration_ms", "segments": [{"start", "after_tool", "duration_ms"}]}`.

- [ ] **Step 1: Write failing tests.**
  - In `test_live_streaming.py`, next to `test_reasoning_streams_live_and_the_final_event_keeps_it`, add `test_reasoning_segments_record_where_each_began`. Drive reasoning `"🙂 first"`, a tool start and completion, reasoning `"second"`, then text, the same way that test drives its stream. Assert the final event's `io.mindroom.reasoning["segments"]` has two entries. The first is `start == 0, after_tool == 0`. The second has `after_tool == 1` and `start == len("🙂 first\n\n".encode("utf-16-le")) // 2`, which is 10. Both carry an int `duration_ms >= 0`. Assert the last live snapshot's `segments` equals the same list without `duration_ms`.
  - Add `test_reasoning_segments_anchor_to_the_top_when_tool_calls_are_hidden`: the same stream with `show_tool_calls=False`; every `after_tool == 0`.
  - In `test_frames.py`, add `test_live_delta_carries_segments_only_when_they_change`. Two `LiveDocs` with equal segments produce a delta without a `"segments"` key. Changed segments produce `delta["segments"] == [dict(s) for s in after.segments]`. `to_json()` includes `"segments"`.
- [ ] **Step 2: Run them, expect FAIL** (missing key or attribute).
- [ ] **Step 3: Implement.**
  - Add `_reasoning_segments: list[dict[str, int]]` (a `field(default_factory=list, init=False, repr=False)`).
  - In `add_reasoning`, when a new segment starts, append `{"start": <UTF-16 length of reasoning_text after the separator is added>, "after_tool": len(self.tool_trace) if self.show_tool_calls else 0}`. Reuse `_utf16_length` from `frames.py`: make it public as `utf16_length` and update its one caller.
  - In `end_reasoning_segment`, set the last segment's `duration_ms` to `round(elapsed * 1000)`.
  - `live_state` passes `segments=tuple({"start": s["start"], "after_tool": s["after_tool"]} for s in self._reasoning_segments)`.
  - `_delivery_extra_content` adds `"segments": [dict(s) for s in self._reasoning_segments]`. A segment still open at the final write gets the elapsed time so far; call `end_reasoning_segment` before building if the code path doesn't already.
  - `LiveDocs` gets `segments` with default `()`, so other constructors keep working. `to_json` emits `"segments": [dict(s) for s in self.segments]`. `live_delta` adds `delta["segments"]` when `before.segments != after.segments`.
- [ ] **Step 4: Run the two test files, expect PASS.** Also run `tests/test_streaming_behavior.py` and `tests/live_frames/` whole, expect PASS.
- [ ] **Step 5: Commit** `feat(streaming): record where each reasoning segment began`.

### Task 2: Keep segments consistent when reasoning is cut, and document them

**Files:**
- Modify: `src/mindroom/matrix/large_messages.py` (`fit_reasoning_to_ordinary_event` ~623-667)
- Modify: `docs/streaming.md` (section "Reasoning", ~114-121)
- Test: `tests/test_response_delivery_gateway.py` (near `test_split_strategy_keeps_a_short_answer_whole_with_its_reasoning_cut`, ~1856), or the existing direct unit tests of `fit_reasoning_to_ordinary_event` if there are any (grep first)

**Interfaces:**
- Consumes: the final `segments` list from Task 1.

- [ ] **Step 1: Write the failing test** `test_cut_reasoning_keeps_only_segments_that_start_in_the_kept_text`. The reasoning is `{"text": "a" * 40000 + "\n\n" + "b" * 40000, "duration_ms": 9, "segments": [{"start": 0, "after_tool": 0, "duration_ms": 4}, {"start": 40002, "after_tool": 2, "duration_ms": 5}]}`, with a size limit that keeps fewer than 40000 characters. Assert the result's segments equal the first segment only. A second case, where everything fits, keeps both segments unchanged.
- [ ] **Step 2: Run it, expect FAIL** (both segments kept).
- [ ] **Step 3: Implement.** In `with_text(text)`, when `reasoning` has a `segments` list, keep the entries whose `start` is below `utf16_length(text)`. Leave the rest of the fitting logic alone.
- [ ] **Step 4: Run the file, expect PASS.**
- [ ] **Step 5: Document.** In `docs/streaming.md` "Reasoning", add two sentences. The final message also keeps where each reasoning segment began (`segments`: UTF-16 `start` in `text`, `after_tool`, `duration_ms`), so clients can show it between the tool calls. Live frames carry the same list without durations.
- [ ] **Step 6: Commit** `feat(streaming): keep reasoning segments within cut reasoning`.

---

## Part B: client (mindroom-chat)

### Task 3: Carry live segments through frames, the live store and live content

**Files:**
- Modify: `src/app/matrix/protocol/liveFrame.ts` (`LiveDocs`, `LiveDelta`, `parseSnapshot`, `parseDelta`, `applyLiveDelta` ~148)
- Modify: `src/app/messages/live/useLiveReplyContent.ts` (`getLiveContent` ~56-76, the `waitDocs` path ~205-212; export `LIVE_REASONING_SEGMENTS_KEY = 'io.mindroom.live_reasoning_segments'` beside `LIVE_REASONING_KEY`)
- Modify: `src/app/messages/content/renderAgentMessageContent.tsx` (~223-228, copy the new key wherever `LIVE_REASONING_KEY` is copied)
- Test: `src/app/matrix/protocol/liveFrame.test.ts`, `src/app/messages/live/useLiveReplyContent.test.tsx`

**Interfaces:**
- Produces: `type LiveReasoningSegment = { start: number; after_tool: number }`; `LiveDocs.segments: LiveReasoningSegment[]` (always present after parsing, `[]` when absent); live content key `io.mindroom.live_reasoning_segments` holding that array.

- [ ] **Step 1: Write failing tests.**
  - A snapshot with `segments: [{start: 0, after_tool: 0}]` parses to them.
  - A snapshot without `segments` parses to `[]`.
  - A delta with `segments` replaces the list.
  - A delta without it keeps the list.
  - A malformed `segments` (non-array, or an entry with a negative or non-integer field) rejects the frame, as other malformed fields do.
  - `getLiveContent` sets `LIVE_REASONING_SEGMENTS_KEY`.
- [ ] **Step 2: Run them, expect FAIL.**
- [ ] **Step 3: Implement** with the file's existing `isRecord` and `isCount` helpers.
- [ ] **Step 4: Run them, expect PASS**, then `just typecheck`.
- [ ] **Step 5: Commit** `feat(live): carry reasoning segments in live frames`.

### Task 4: Pure helpers that read and place segments

**Files:**
- Create: `src/app/messages/agent-run/reasoningSegments.ts`
- Test: `src/app/messages/agent-run/reasoningSegments.test.ts`

**Interfaces:**
- Produces:
  - `type ReasoningSegment = { text: string; afterTool: number; durationMs?: number }`
  - `readReasoningSegments(text: string, segments: unknown): ReasoningSegment[]`. It slices `text` by UTF-16 `start` (JS string indices are UTF-16) and trims trailing whitespace from each piece. Pieces that are empty after trimming are dropped. Missing, malformed, non-increasing, first-not-0, or past-the-end segments yield `[{ text, afterTool: 0 }]` for non-empty text. Empty text yields `[]`.
  - `placeReasoningSegments(segments: ReasoningSegment[], renderedMarkerIndices: readonly number[]): Map<number, number[]>`. It maps an anchor (a rendered marker index, or `0` for the top) to the segment indices placed there, in order. A segment goes to the greatest rendered index `<= afterTool`, or to `0`.

- [ ] **Step 1: Write failing tests:**
  - Two segments split correctly, with the `\n\n` trimmed.
  - A text starting with `"🙂 a\n\nb"` and starts `[0, 6]` gives `["🙂 a", "b"]`.
  - `segments` undefined gives one segment at the top.
  - Starts `[0, 0]` (not increasing) fall back.
  - A start past the end falls back.
  - Placement with markers `[1, 2, 3, 4]` and anchors `[0, 3, 4]` maps to `{0: [0], 3: [1], 4: [2]}`.
  - Placement with no markers puts everything at `0`.
  - Placement with markers `[1, 2]` and anchor `5` maps to `2`.
  - Placement with markers `[2]` and anchor `1` maps to `0`.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `feat(reasoning): read and place reasoning segments`.

### Task 5: Render segments inline, toggled by the bulb

**Files:**
- Modify: `src/app/messages/agent-run/Reasoning.tsx` (`withReasoning`, `ReasoningHeader`, `ReasoningBlock`)
- Modify: `src/app/messages/agent-run/Reasoning.css.ts` (rail, segment body, ripple, reusing `ToolCallsFold.css.ts`'s ripple keyframes if exportable)
- Modify: `src/app/messages/agent-run/toolCallStatus.ts` (add `ReasoningSegmentsContext` beside the other contexts) or a new `reasoningSegmentsContext.ts`; follow the layering in `.eslintrc.cjs`
- Modify: `src/app/messages/html/HtmlBlocks.tsx` (`ToolRefGroupBlock` ~333-423, `createToolTraceMarkerParserOptions` ~501-685, `useToolTraceMarkerParserOptions` ~694-706)
- Modify: `src/app/i18n/locales/en.json` (and the other locales the repo keeps in sync, as its i18n test requires): `mindroomUi.messages.mindroomReasoning.hide` = "Hide thinking", `.thought` = "Thought" if missing
- Test: `src/app/messages/agent-run/Reasoning.test.tsx`, `Reasoning.header.test.tsx`, `src/app/messages/html/react-custom-html-parser.test.ts`

**Interfaces:**
- Consumes: `readReasoningSegments` and `placeReasoningSegments` (Task 4), `LIVE_REASONING_SEGMENTS_KEY` (Task 3), `getRenderedToolRefs(html).toolBlocks[].index` (`toolRefDom.ts`).
- Produces: `ReasoningSegmentsContext` value `{ placement: Map<number, number[]>; segments: ReasoningSegment[]; open: boolean; hide: () => void; liveIndex?: number }`, where `liveIndex` is the last segment while live reasoning grows; a component `ReasoningSegmentsAt({ anchor }: { anchor: number })` that renders the segments placed at `anchor` that should show (when `open`, or the one at `liveIndex`).

- [ ] **Step 1: Write failing tests** in `Reasoning.test.tsx`. Render a final reply whose body has markers `[1]..[4]` and whose reasoning has three segments at `after_tool` 0, 3 and 4.
  - Closed: no segment text is in the document, and the header label reads "Thought for N s" with the total.
  - Clicking the bulb shows all three, and DOM order puts segment 2 after tool marker 3's run anchor and before marker 4's. Run this with tool calls shown, so the runs render.
  - Clicking the bulb again hides them.
  - With the bulb open, clicking one segment's rail (`button` named "Hide thinking" and the rail element) hides all of them, and focus moves to the bulb.
  - A live reply (`LIVE_REASONING_KEY` and segments, active stream status) shows only the last segment, open, while the bulb is closed.
  - An old event without `segments` shows its text at the top when the bulb is open.
  - In `src/app/messages/content/renderAgentMessageContent.finishedWork.test.tsx` (from #419), add a test. A long finished reply that folds behind "Worked for", with segments at `after_tool` 0 and at the last marker, keeps both segments inside the folded part, with none in the tail, once the fold and the bulb are open. Read `docs/baspowers/specs/2026-11-15-fold-finished-agent-work-design.md` and `FinishedWorkFold.tsx` first.
- [ ] **Step 2: Write a failing parser test** in `react-custom-html-parser.test.ts`. Use markers `[1]` and `[2]` as consecutive paragraphs, and a segment at `after_tool: 1`. With segments rendering, two run blocks appear with the segment between them. With the bulb closed, one run block appears.
- [ ] **Step 3: Run both, expect FAIL.**
- [ ] **Step 4: Implement.**
  - **Placement.** `withReasoning` computes `segments` from `io.mindroom.reasoning` (final) or from live text plus `LIVE_REASONING_SEGMENTS_KEY`. It computes `placement` from the rendered marker indices of the HTML the body renders: `formatted_body`, or the fallback HTML that `renderAgentMessageContent` builds, so pass what it already has rather than rebuilding it.
  - **Provider and header.** It wraps the header, the top segments (`ReasoningSegmentsAt anchor={0}`) and the body in the provider. The bulb button keeps today's look and comet, toggles `open`, and sheds the cog's ripple on each click, as `Cog` does with its `ripples` counter.
  - **Rendering after runs.** `ToolRefGroupBlock` renders `<ReasoningSegmentsAt anchor={lastIndex} />` after its activity, including on the hidden-run path that returns `null` today (return just the segments there).
  - **Splitting runs.** `useToolTraceMarkerParserOptions` reads the context, builds `splitAfter: ReadonlySet<number>` from the anchors that currently render (empty when nothing renders), adds it to the memo keys, and passes it to `createToolTraceMarkerParserOptions`. That function ends a run after an item whose index is in `splitAfter`: in the forward merge loop, and in the backward check that returns `null` for a consumed marker.
  - **Segment view.** Each shown segment is the rail (a `button` with `aria-label` "Hide thinking"), the label ("Thought for N s", "Thinking…" while live, or "Thought"), the text through `ReasoningText`, and the end button with today's `CollapseEnd` look. Both buttons call `hide`, which sets `open` false and focuses the bulb.
  - **What goes.** Remove the old expanded body from the header. Keep `LiveActivity` and the cog placement as they are.
- [ ] **Step 5: Run the tests, expect PASS.** Then run the whole `src/app/messages` folder (`just test src/app/messages`), `just typecheck`, `just strict` and `just lint`. Fix every test the change breaks, such as header tests that expected the reasoning body to open from the label.
- [ ] **Step 6: Commit** `feat(reasoning): show thinking where it happened, toggled by the bulb`.

### Task 6: E2E spec, screenshots and docs

**Files:**
- Create: `e2e/messages/inline-thinking.spec.ts` (follow `e2e/messages/agent-reasoning-header.spec.ts`: register an agent account, send the event with `sendRoomMessage`/`matrixFetch`, honor `E2E_SCREENSHOT_DIR`)
- Modify: `docs/architecture.md` (where it lists backend event formats: `io.mindroom.reasoning.segments`, live `segments`)

- [ ] **Step 1: Write the spec.** The agent reply body is `🔧 \`read_file\` [1]`, `🔧 \`grep\` [2]`, `🔧 \`grep\` [3]`, text, `🔧 \`shell\` [4]`, `Done.`. It has a matching v2 tool trace (copy the shape from the existing spec) and reasoning with three segments at `after_tool` 0, 3 and 4. The spec checks:
  - (a) Closed: the header shows "Thought for", and no segment text is visible.
  - (b) After clicking the bulb, all three segment texts are visible, in DOM order relative to the text "Done.".
  - (c) After also clicking the cog, segments and tool rows interleave in the order seg1, read_file, grep, grep, seg2, shell, seg3, and a screenshot is taken.
  - (d) Clicking a rail hides all of them, and the bulb is focused.

  It takes screenshots of (a), (b) and (c) when `E2E_SCREENSHOT_DIR` is set.
- [ ] **Step 2: Run it.** Check for a free slot first: `ss -ltn | grep :43<n>` must be empty. Then `nix develop -c just hs-up` and `nix develop -c scripts/e2e-slot.sh <n> e2e/messages/inline-thinking.spec.ts` (or `just e2e e2e/messages/inline-thinking.spec.ts` if that is what the repo documents for a slot). Expect PASS. Also run `e2e/messages/agent-reasoning-header.spec.ts` and `e2e/messages/tool-calls-toggle.spec.ts`, expect PASS.
- [ ] **Step 3: Document** the keys in `docs/architecture.md` in two or three lines.
- [ ] **Step 4: Commit** `test(e2e): inline thinking timeline`.
