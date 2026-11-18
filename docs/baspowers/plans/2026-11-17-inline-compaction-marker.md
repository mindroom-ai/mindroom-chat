# Inline compaction marker: client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development (four tasks with separate review surfaces: protocol, component, placement, notice row plus e2e).

**Goal:** Render each compaction as a quiet "seam" row inside the agent reply at the spot it happened, with a hover/tap card, exactly as mockup variant C draws it.

**Architecture:** A protocol reader parses `io.mindroom.compactions` (reply events and live frames) and the old `io.mindroom.compaction` notice. `CompactionSeam` draws the row and card. The reply renderer places seams by `after_tool` with the same rule as reasoning segments, including inside the Worked-for fold. Old/manual notices render as the same row via the quiet-marker path.

**Tech Stack:** React, TypeScript (strict), vanilla-extract, vitest, Playwright; all commands in `nix develop`.

**Spec:** `docs/baspowers/specs/2026-11-17-inline-compaction-marker-design.md`. Visual source of truth: `/home/basnijholt/.mindroom-chat/mindroom_data/agents/mindroom_dev/workspace/mockups/compaction-inline/mockup.html` (variant `V.c`, functions `restLabel`, `card`, `gauge`, CSS `.seamrow .seam .mk .card .gauge .kv .tag .csub .glabel`, keyframes `slide`) and `variant-c.png`, `phone-c.png` beside it.

## Global Constraints

- Follow the repo `AGENTS.md`: `just typecheck`, `just strict` 0 errors, `NODE_OPTIONS=--max-old-space-size=6144 just lint`, tests beside their subject, no barrel files, no em dashes, add files by explicit path.
- Sizes in rem; colors from the app theme vars; motion tokens from `src/app/ui/styles/Motion.css.ts`; reduced motion: no hairline animation. No CSS `linear()` (iOS 16.4 WebView).
- Every new string in `src/app/i18n/locales/additions/en.json` and every other locale overlay (copy from the spec's "Copy" section, verbatim).
- Parse defensively (spec "Client tolerance"); a missing/malformed list renders nothing and never throws.
- Running seams tick once per second from `started_at` (old notices: the event's origin ts); stop when status leaves running; show "interrupted" on a terminal reply.
- Never `git stash`. Commit early. `git commit --trailer "Assisted-by: MindRoom DevAgent:<model id> <https://github.com/mindroom-ai/mindroom>"`.

## Review Focus

- A seam whose `after_tool` exceeds the rendered markers (markers inside lists/code, or hidden tool calls) must land after the last rendered marker, not vanish.
- A seam between two consecutive markers must split the merged tool run in both the forward-merge and backward-check paths of `createToolTraceMarkerParserOptions`, and must still render when the cog hides tool calls (`ToolRefGroupBlock` returns `null` then).
- Inside the Worked-for fold, seams belong to the folded work; none may leak into the answer tail, and a top seam folds too.
- While streaming, live-frame compactions win over the event's (same precedence as `LIVE_REASONING_SEGMENTS_KEY`), so a pre-turn seam shows on the pending placeholder.
- The old notice row must be a quiet marker for the reply-quote fold, and only for a MindRoom agent sender.

---

### Task 1: Protocol readers and live frames

**Files:**
- Create: `src/app/matrix/protocol/compactions.ts`, `src/app/matrix/protocol/compactions.test.ts`
- Modify: `src/app/matrix/protocol/liveFrame.ts` (+ test), `src/app/messages/live/useLiveReplyContent.ts` (live key), `src/app/matrix/protocol/untrustedContent.ts` (list the new live key beside `io.mindroom.live_reasoning_segments`)

**Interfaces:**
- Produces:
  - `export const COMPACTIONS_CONTENT_KEY = 'io.mindroom.compactions'`, `export const COMPACTION_NOTICE_CONTENT_KEY = 'io.mindroom.compaction'`
  - `export type CompactionStatus = 'running' | 'success' | 'failed' | 'timeout'`
  - `export type ReplyCompaction = { id: string; phase: 'pre_turn' | 'mid_turn' | 'manual'; afterTool: number; status: CompactionStatus; startedAt?: number; durationMs?: number; summaryModel?: string; beforeTokens: number; afterTokens?: number; historyBudgetTokens?: number; runsBefore?: number; compactedRunCount?: number; runsRemaining?: number; failureReason?: string }`
  - `export const readReplyCompactions = (value: unknown): ReplyCompaction[]` (takes the raw list)
  - `export const readCompactionNotice = (content: Record<string, unknown>, originTs: number): ReplyCompaction | undefined` (old singular notice; `phase: 'manual'` when `mode === 'manual'`, else `'mid_turn'` with `afterTool: 0`; `startedAt = originTs`; `id` = `'notice'`)
  - `LiveDocs.compactions: unknown[]` (default `[]`), `LiveDelta.compactions?: unknown[]`; `export const LIVE_COMPACTIONS_KEY = 'io.mindroom.live_compactions'` in `useLiveReplyContent.ts`, set only when non-empty.

- [ ] **Step 1: Failing tests** in `compactions.test.ts`: the spec's example entry parses to camelCase; entries missing `id`/unknown `status`/negative or fractional `after_tool`/non-number `before_tokens` are dropped while valid neighbours stay; non-array gives `[]`; unknown keys ignored; `phase` other than the two values is dropped. Notice: a v3 success notice (`status success, mode auto, before_tokens 366804, after_tokens 6336, history_budget_tokens 351792, compacted_run_count 24, summary_model haiku, duration_ms 8400`) reads with `startedAt === originTs`; `mode manual` gives `phase 'manual'`; a `running` notice reads as running; missing key gives `undefined`. In `liveFrame.test.ts`: snapshot with and without `compactions` (older backend gives `[]`), delta replaces the whole list, a non-list `compactions` rejects the frame like `segments`.
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/matrix/protocol/compactions.test.ts src/app/matrix/protocol/liveFrame.test.ts`, expect failures.
- [ ] **Step 3: Implement.** Reuse `isRecord` from `lib/isRecord`.
- [ ] **Step 4: Run** the same plus `src/app/messages/live`; pass. `just typecheck`.
- [ ] **Step 5: Commit.**

### Task 2: `CompactionSeam` row and card

**Files:**
- Create: `src/app/messages/agent-run/CompactionSeam.tsx`, `CompactionSeam.css.ts`, `CompactionSeam.test.tsx`, `compactionCopy.ts` (+ test) for formatting
- Modify: `src/app/i18n/locales/additions/*.json`

**Interfaces:**
- Consumes: Task 1's `ReplyCompaction` (`phase: 'pre_turn' | 'mid_turn' | 'manual' | 'notice'`, `beforeTokens?: number`).
- Copy additions (controller rulings): `phase 'notice'` (an old automatic notice) uses the mid-turn rest label "Compacted context · …" and its card shows no tag and no subtitle; with no `beforeTokens` the History row, Saved row, gauge and its label are left out and the rest label drops the token part ("Compaction failed" already has none; a success without tokens reads just "Compacted context").
- Produces: `export function CompactionSeam(props: { compaction: ReplyCompaction; interrupted?: boolean }): JSX.Element` with root `data-compaction-seam` and `data-state` (`running|success|failed|timeout|interrupted`) attributes (e2e selects on these). Pure helpers in `compactionCopy.ts`: `formatTokensShort(n)` (`367k`, `6k`, `950`), `formatSeconds(ms)` (`8.4 s` under 10 s, else whole `120 s`), `percentOf(n, budget)` (rounded).

- [ ] **Step 1: Failing tests:** helpers (`formatTokensShort(366804) === '367k'`, `formatTokensShort(6336) === '6k'`, `formatSeconds(8400) === '8.4 s'`, `formatSeconds(120000) === '120 s'`); the row label per state and phase from the spec's Copy (mid-turn success "Compacted context · 367k → 6k tokens", pre-turn "Compacted before replying · …", `pre_turn` with `afterTool > 0` uses mid-turn copy, manual "Compacted on request · …", failed, timeout, interrupted); running label ticks (fake timers: 12 s then 13 s) and the interval is cleared on unmount and on a status change; hover and focus open the card (`role="tooltip"`), Escape closes it; card rows for success (History "366,804 → 6,336", Saved "360,468 tokens (98%)", Budget, Folded "24 runs into 1 summary", Summarized by "haiku in 8.4 s", When), running (Folding "24 runs, 9 done"), failure (Reason first, Gave up after); no gauge when there is no budget.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement**, copying `messages/thread-summary/ThreadSummaryMarker.tsx` for the trigger, `PopOut`/`Tooltip`, Escape/outside-click/scroll and touch tap behaviour, and the mockup's CSS for the seam, hairline (animated gradient while running, dashed amber on failure), card, gauge (hatched "was", solid "now"), tag chip and key/value grid.
- [ ] **Step 4: Run** tests, `just typecheck`, `just strict`.
- [ ] **Step 5: Commit.**

### Task 3: Place seams inside the reply

**Files:**
- Modify: `src/app/messages/agent-run/Reasoning.tsx` (`withReasoning` placement), `src/app/messages/html/HtmlBlocks.tsx` (run split at a seam), `src/app/messages/agent-run/finishedWorkSplit.ts` (seams fold with their block), `src/app/messages/content/renderAgentMessageContent.tsx` (pass event or live compactions and the interrupted flag)
- Test: `renderAgentMessageContent.compactions.test.tsx` (new, beside `renderAgentMessageContent.finishedWork.test.tsx`), `finishedWorkSplit.test.ts`

**Interfaces:**
- Consumes: Task 1 readers and `LIVE_COMPACTIONS_KEY`; Task 2 `CompactionSeam`.
- Placement rule (spec "Placement"): after the greatest rendered tool marker index `<= afterTool`, else at the top below the reasoning header line; seam before a thinking segment at the same spot; interrupted = entry `running` while the reply's `io.mindroom.stream_status` is terminal (`TERMINAL_STREAM_STATUSES`).

- [ ] **Step 1: Failing tests** (use the backend marker fixtures in `messages/__fixtures__/backendToolMarkerBodies.json` and the `withToolRefFormattedBodyFallback` body-only shape): seam at top for `afterTool 0`; after marker 3 of 5 consecutive markers the run is split into 3 + 2 with the seam between; tool calls hidden by the cog: seam still renders between the texts; two seams at 4 and 9 of 11; seam and thinking segment at one spot (seam first); `afterTool` beyond the rendered markers lands after the last one; finished long reply: seam inside the Worked-for fold, absent from the tail, visible after opening; live content: `LIVE_COMPACTIONS_KEY` beats the event's key, and a pending placeholder with a running pre-turn entry shows the running seam; a running entry on a `completed` reply renders `data-state="interrupted"`.
- [ ] **Step 2: Run, expect failures.**
- [ ] **Step 3: Implement** by extending the reasoning-segment placement rather than a parallel walker (read the inline-thinking design `docs/baspowers/specs/2026-11-16-inline-thinking-design.md` first: it explains the placement rule, the merged-run split and the fold behaviour this task extends).
- [ ] **Step 4: Run** the new and existing tests under `src/app/messages` (`Reasoning*.test.tsx`, `FinishedWorkFold.test.tsx`, `finishedWorkSplit*.test.ts`, `renderAgentMessageContent*.test.tsx`, `toolRefDom.test.ts`), `just typecheck`, `just strict`.
- [ ] **Step 5: Commit.**

### Task 4: Old/manual notice row, quiet marker, e2e screenshots

**Files:**
- Modify: `src/app/timeline/message-rendering/useTimelineMessageFeature.tsx` (`readQuietMarker`: a MindRoom agent's notice with `io.mindroom.compaction` renders `CompactionSeam` from `readCompactionNotice`), plus the room-timeline path if the notice renders there too (check how `SkillReviewMarker` handles the room timeline)
- Test: `TimelineMessageFeature.test.tsx` (marker row, quiet for the reply fold, not for a human sender)
- Create: `e2e/messages/compaction-seam.spec.ts` (copy the fixture approach of `e2e/messages/skill-review-marker.spec.ts` / `inline-thinking.spec.ts`)

- [ ] **Step 1: Failing unit tests** for the notice row (agent sender: seam row with no avatar/name; human sender: ordinary notice; reply after it keeps no quote, per `timelineRowFold` quiet markers).
- [ ] **Step 2: Implement**, run tests.
- [ ] **Step 3: e2e spec** that seeds replies for the spec's scenes 1-7 (mid-turn with tools open, cog hidden, Worked-for fold folded and opened, pre-turn placeholder running and finished, two seams, the four states plus interrupted, the manual notice row), asserts each seam's `data-state` and position relative to the tool runs, opens one card, and with `SCREENSHOTS=<dir>` writes desktop and 390 px phone screenshots in dark and light. Run it on a free e2e slot (check `ss -ltn | grep :43<n>` first).
- [ ] **Step 4: Full gates:** `just typecheck`, `just strict`, `NODE_OPTIONS=--max-old-space-size=6144 just lint`, `nix develop -c npx vitest run src/app/messages src/app/timeline src/app/matrix/protocol`.
- [ ] **Step 5: Commit.** `view_file` every screenshot and list them in the report.
