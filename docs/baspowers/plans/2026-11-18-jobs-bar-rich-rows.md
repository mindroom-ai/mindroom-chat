# Background jobs bar rich rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development, adapted: one implementer per repo, since the two PRs share only the wire contract below; each PR then gets cross-model review (Sol + Astra) of the whole branch.

**Goal:** Jobs bar rows show model logo, model, task, now-doing, thread chip, ticking elapsed time, tool calls/tokens/cost, nesting and grouping, with Open going to the sub-agent's run.

**Architecture:** The backend adds opaque join keys to jobs state and running usage to sub-agent frame meta. The client parses both, joins each job to its sub-agent run (by `subagent`) or its reply's tool-trace entry (by `tool_call_id`) in the presentation model, and renders richer rows in the existing bar.

**Tech Stack:** Python 3.13 / nio (backend); React, jotai, vanilla-extract, i18next, Vitest, Playwright (client).

**Spec:** `docs/baspowers/specs/2026-11-18-jobs-bar-rich-rows-design.md` (this repo). Read it first; it is authoritative.

## Global Constraints

- All new wire fields are optional on the client; missing or wrong-typed means "show today's content".
- Jobs state (unencrypted room state) never carries arguments, previews or results: only `subagent`, `run`, `tool_call_id`.
- No join by agent name or thread as a fallback.
- Keep the bar's existing mechanics (expand, pin, Escape, focus, Stop, Stop all, held jobs, failures) and their tests passing unchanged.
- Commits end with `--trailer "Assisted-by: MindRoom <display name>:<model id> <https://github.com/mindroom-ai/mindroom>"`.

## Wire contract (both PRs)

```jsonc
// io.mindroom.background_jobs, per job
{"job_id": "...", "thread_id": "...", "kind": "subagent", "tool": "mindroom_dev", "status": "running", "started_at": "...",
 "subagent": "<subagent_id>", "run": "<delegation_id>"}
{"job_id": "...", "kind": "tool", "tool": "run_shell_command", ..., "tool_call_id": "toolu_..."}
// io.mindroom.subagents frame meta
"usage": {"input_tokens": 120000, "output_tokens": 8000, "tool_calls": 31, "cost_usd": 1.3}  // cost_usd optional
```

## Review Focus

1. A client opening the room mid-run: the row shows name, avatar and timer until the next snapshot, then fills in. Test: a presentation test with a job carrying `subagent` but no run in the store.
2. An older backend (no new fields): the bar renders exactly today's names. Test: the existing presentation tests pass unchanged, plus one asserting no `run` on the item.
3. `show_tool_calls: false`: frame tools carry no previews, so line 2 shows only the tool name. Test: a presentation test with a tool entry lacking `args_preview`.
4. A nested child whose parent job is not listed (it ended) stays top-level. Test: in the presentation nesting tests.
5. A run whose model has no price: there is no `cost_usd` and no cost part, but tokens still show. Tests: backend (usage without cost) and client (stats formatting).

---

## Backend PR (`mindroom-ai/mindroom`, worktree `~/repos/worktrees/mindroom-jobs-state-run-links`, branch `feat/jobs-state-run-links`)

### Task B1: join keys in jobs state

**Files:** Modify `src/mindroom/tool_jobs/publication.py` (`_job_state`). Test in the existing publication test file (`tests/` grep `_jobs_state_content`).

- [ ] Test `test_job_state_names_the_subagent_and_run_of_a_delegation_job`: a delegation job with `adapter={"child": {..., "subagent_id": "s1", "delegation_id": "d1"}}` gives state with `subagent == "s1"` and `run == "d1"`.
- [ ] Test `test_job_state_names_the_tool_call_of_a_tool_job`: a tool job with `adapter["tool_call_id"] == "call_1"` gives `tool_call_id == "call_1"`. A tool job without it gives no key.
- [ ] Test that no `arguments` or `progress` key is ever in the state, for both kinds.
- [ ] Implement: read with `.get`, add a key only when it is a non-empty `str`, and update the module comment.
- [ ] Run the publication tests, then commit.

### Task B2: running usage in sub-agent frame meta

**Files:** `src/mindroom/delegation/activity.py` (`SubagentSnapshot` gains `usage: Mapping[str, int | float] | None = None`, or separate fields; the implementer chooses), `src/mindroom/delegation/lifecycle.py` (observation feeds usage), `src/mindroom/live_frames/subagents.py` (`_run_meta` emits `usage`), and the agent loop or provider pipeline only as far as needed to surface each completed request's usage to the child observer. Tests go next to the existing tests for each.

- [ ] Design the hook first. Today `UsageReported` is consumed in `agent_loop/model_loop.py:527` and `RunMetrics.add` runs in `_count_request` (`model_loop.py:583`). The observer (`observe_child_event`) sees `TextDelta`, `ToolStarted`, `ToolCompleted` and `RunFinished`. Pick the smallest change that hands each completed request's counts to the child's observation. That might be a new loop event the observer handles, which existing consumers ignore, or a callback on the child's run context. Prove that no non-delegation consumer of loop events breaks.
- [ ] Test `test_subagent_frame_meta_counts_usage_over_requests`: two completed requests of 100/10 and 50/5 tokens give `usage.input_tokens == 150` and `usage.output_tokens == 15`.
- [ ] Test `test_subagent_usage_counts_tool_calls_past_the_transcript_cap`: more tool calls than the item cap give `tool_calls ==` the true count.
- [ ] Test `test_subagent_usage_prices_the_run_model`: with a priced model, `cost_usd ==` `run_cost_usd(...)`. With an unpriced one, there is no `cost_usd` key.
- [ ] Test that a frame for a run with no completed request yet carries `usage` with zero tokens, or no `usage`; pick one and document it in the docstring.
- [ ] Implement, run the touched test files, and run `tach check` if imports change. Commit.
- [ ] Run the full backend suite on gce-dev (see AGENTS.md / MEMORY: `ssh -A pc.local 'ssh gce-dev ...'`, a free `/work` slot).

## Client PR (`mindroom-ai/mindroom-chat`, worktree `~/repos/worktrees/mindroom-chat-jobs-bar-rich`, branch `feat/jobs-bar-rich`)

### Task C1: contract parsing

**Files:** `src/app/matrix/protocol/backgroundJobsContract.ts` (+ test), `src/app/matrix/protocol/subagentFrame.ts` (+ test).

**Produces:** `BackgroundJob` gains `subagent?: string; run?: string; toolCallId?: string`. `SubagentMeta` gains `usage?: SubagentUsage` with `type SubagentUsage = { inputTokens: number; outputTokens: number; toolCalls: number; costUsd?: number }`.

- [ ] Tests: fields parsed when they are non-empty strings or finite non-negative numbers. They are absent when missing or of the wrong type, and the job or meta is still parsed (no job is dropped because of a bad new field).
- [ ] Implement, run the tests, commit.

### Task C2: presentation join

**Files:** `src/app/background-jobs/backgroundJobsPresentation.ts` (+ test).

**Consumes:** C1 types and `SubagentRun` from `messages/live/subagentRunStore.ts`.
**Produces:** `BackgroundJobsBarItem` gains:
- `startedAt: number` (ms);
- `run?: SubagentRun` (that sub-agent's newest turn whose `meta.subagent === job.subagent`);
- `activity?: { tool: string; preview?: string }`;
- `depth: number` (0 to 3);
- `kind: 'subagent' | 'tool'`.

`BackgroundJobsBarModel` gains:
- `groups: { kind: 'subagent' | 'tool'; items: BackgroundJobsBarItem[] }[]`, one per kind present, sub-agents first;
- `summary?: { subagents: number; tools: number; waiting: number }`, when there are several jobs.

`presentBackgroundJobs` takes two new lookups:
- `runFor: (subagent: string) => SubagentRun | undefined`;
- `toolCallFor: (toolCallId: string) => { tool: string; preview?: string } | undefined`.

- [ ] Tests:
  - join by `subagent` only;
  - no `run` without the field;
  - activity comes from the run's newest tool entry, with the preview when present and only the name when not;
  - a tool job's activity comes from `toolCallFor`;
  - nesting: a child job sits right after its parent with `depth` 1, and a child whose parent is not listed stays at depth 0;
  - depth caps at 3;
  - the groups' order;
  - summary counts.
- [ ] Implement as pure functions. The existing tests stay green. Commit.

### Task C3: rows, title row, styles, i18n

**Files:** `src/app/background-jobs/BackgroundJobsBar.tsx`, `BackgroundJobsBar.css.ts`, a new `BackgroundJobRow.tsx` (row rendering, to keep the bar file from growing), and `src/app/i18n/locales/additions/*.json`.

**Consumes:** C2 model, C4 `openSubagentsPanel` signature.

- [ ] Wire `runFor` from the room's sub-agent run store, and `toolCallFor` from the tool traces of the agent replies the client holds for the view. Find the existing live-reply/tool-trace store; `toolTrace.ts` already parses `tool_call_id`.
- [ ] Render per the spec's "Expanded list", "Title row", "Missing data" and "Accessibility" sections. Use `ModelIcon`/`ProviderModelIcon`, `AgentAvatar`, `getAiRunCompactModelLabel`/`getAiRunModelLabel`, `formatCallDuration`, `useRelativeTime`, `useInterval`, and the thread-title helper the thread list uses. For the cost format, reuse the app's existing cost formatter (grep `costUsd`).
- [ ] Unit tests in `BackgroundJobsBar.test.tsx`:
  - the rich row content;
  - the single-job title row;
  - a group heading only when both kinds are present;
  - Open only when the panel has the run;
  - the thread chip only when the job's thread is not the view's;
  - the timer is `aria-hidden`.
- [ ] Run `npx vite build` (vanilla-extract), `NODE_OPTIONS=--max-old-space-size=6144 just lint`, the unit tests. Commit.

### Task C4: Open a specific sub-agent

**Files:** `src/app/navigation/subagentsPanel.ts` (+ test), `src/app/subagents/SubagentsPanel.tsx` (+ test).

**Produces:** `openSubagentsPanel(store, roomId, threadId?, subagent?)`. The atom gains `subagent?: string`, and `SubagentsPanel` opens that node's run view on open (its `openId`) when the node exists.

- [ ] Tests: opening with `subagent` shows that run's view. Without it, behaviour is unchanged. An unknown `subagent` shows the list.
- [ ] Implement, commit.

### Task C5: e2e

**Files:** `e2e/background-jobs/` (a new spec, or extend `background-jobs-bar.spec.ts`).

- [ ] Fixture: a sub-agent job with frames (Anthropic model, task, a running tool with preview, usage with cost), a nested child on an OpenAI model, and a tool job whose reply trace has that `tool_call_id`.
- [ ] Assert:
  - the row texts;
  - the logos (`data-` attributes);
  - the ticking timer changes after 1.5 s;
  - Open opens the Sub-agents panel on that run;
  - at 390 px width, no model pill and no stats.
- [ ] Check that the e2e slot is free first (`ss -ltn | grep :43<n>`). Run, commit.

### Task C6: live check

- [ ] Run `just live up --chat ~/repos/worktrees/mindroom-chat-jobs-bar-rich --backend ~/repos/worktrees/mindroom-jobs-state-run-links` from `~/repos/dev`. Start two background sub-agents (Anthropic and OpenAI models) and a background shell job, then screenshot the bar expanded and collapsed. Run `just live down`.
