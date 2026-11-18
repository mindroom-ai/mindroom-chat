# Background jobs bar: rich rows

Date: 2026-11-18. Requested by Bas in Mindroom-Dev ("instead of just saying running sub agent, show a link to the thread, which model it is running with logo, and how long it's running for").

## Intent

Bas runs many sub-agents and long tool jobs at once (implementers, reviewers, test suites on gce-dev). The jobs bar above the composer says only "Sub-agent: mindroom_dev" or a tool name. He wants to see at a glance, per job: which model, what it is doing, how long it has run, what it has cost, and where it lives, and to jump to it.

Success: with five or more jobs running, each row answers "who, on what model, doing what, for how long, for how much" without opening anything, and Open goes straight to that sub-agent's run.

## Picked design

Bas picked variant A of the mockup (`mockups/jobs-bar-rich/mockup.html` in DevAgent's workspace; screenshot in the thread), with every detail on: model logo, model name, elapsed timer, task line, live "now doing", thread link, nested sub-agents, tool calls / tokens / cost, and grouping sub-agents vs tools.

### Expanded list

The bar keeps today's mechanics unchanged: where it sits, hover/click to expand, pinning, Escape and outside-click to close, focus handling, Stop, Stop all, Stopping…, failures, the jobs held between calls. Only the content of the rows and the title row changes.

- **Groups.** When both kinds are present, the list has two headings, "Sub-agents · N" then "Tools · N". With one kind only, no headings. Rows stay oldest first in each group.
- **Sub-agent row**, two lines, left to right:
  - **Logo** (26 px) from the run's model (`ModelIcon`/`ProviderModelIcon` with the frame's `model` provider and id). It has a status dot: running (success colour, a slow pulse that `prefers-reduced-motion` turns off), awaiting approval (warning), stopping (danger), finished (muted). If the run has no model yet, use the agent's avatar (`AgentAvatar`) with the same dot.
  - **Line 1:** agent display name (`useAgentProfile`), a model pill (`getAiRunCompactModelLabel`, full label as `title`), the task's first line (ellipsized), then at most one status pill: "Needs approval", "Stopping…" or "Done".
  - **Line 2 ("now doing"):** the run's newest tool entry, as the tool name in bold plus its args preview in monospace (ellipsized). When the frame carries no previews (`show_tool_calls` off, or dropped for size), only the name. Nothing when the run has no tool entry yet. Then the thread chip, then stats.
  - **Thread chip:** shown only when the job's `threadId` is not the view's thread, which in practice means the room timeline view, with the job in a thread. It shows the thread's title (the same title helper the thread list uses) and navigates to that thread.
  - **Stats:** "{n} tool calls · {tokens} tokens · {cost}" from the frame's `usage`. Each part shows only when its value is present. Tokens are compact ("1.9M", "310k"). Cost uses the app's existing cost formatting. Cost counts the run's own model requests only, not its nested sub-agents, which have their own rows.
  - **Right side:** elapsed time since `started_at`, ticking each second (`formatCallDuration`), then **Open**, then **Stop**. Open opens the Sub-agents panel with this sub-agent's run open. The bar shows Open only when the panel has that run. The name is no longer a button.
- **Tool row:** a terminal icon in the logo slot, with the same status dot. Line 1 is the tool name. Line 2 is the call's args preview, found by the job's `tool_call_id` in the tool trace of the agent's reply that the client already holds (live frame or content). When none is found, there is no line 2. Then the thread chip. The right side has the elapsed time and Stop.
- **Nesting:** a sub-agent job whose run's `parent` is the run of another listed job sits right under that job, indented one step per level (at most 3 steps), with a 20 px logo. A job whose parent is not listed stays top-level.
- **Narrow (under 40rem):** line 1 drops the model pill (the logo stays) and line 2 drops the stats.

### Title row

- Several jobs: today's title ("7 background jobs"), then the sub-agents' logos stacked (first 4, overlapping), then a summary: "{s} sub-agents · {t} tools", plus " · {k} need approval" in the warning colour when k > 0. Parts with a zero count are left out.
- One job: the title row is that job's row on one line: logo with dot, today's title text, elapsed, Open (sub-agent only), Stop.

### Missing data

Every row must degrade to today's content, never to a blank or broken row:

- **No frame yet** (a client opened the room after the run started gets the next full snapshot within 10 s, a paused run sends none until it resumes, `streaming.live_frames: false` sends none): the sub-agent row shows today's name, the agent's avatar and the elapsed time from `started_at`. Elapsed time is always available.
- **Older backend without the new state fields:** same as no frame. The client must not join by agent name or thread as a fallback.
- **No `usage` in the frame (older backend):** no stats.

### Accessibility and copy

- The ticking timer text is `aria-hidden`. The row carries a screen-reader-only "started {relative time}" (`useRelativeTime`), so assistive tech is not told every second.
- Status dots are decorative. The status pill and today's waiting text carry the state.
- Every new string goes in the locale additions, in every locale file that the repo's i18n check requires.
- The bar owns one 1-second clock (`useInterval`), running only while a listed job is live.

## Data contract

Two producers change, in `mindroom-ai/mindroom`. Both changes are additive. Clients treat every new field as optional.

### Jobs state (`io.mindroom.background_jobs`, `tool_jobs/publication.py` `_job_state`)

Room state is not encrypted, and today's rule stays: state never carries a job's arguments or results. It gains only opaque join keys:

- A delegation job (`kind: "subagent"`) adds `subagent` (the child's `subagent_id`) and `run` (its `delegation_id`, which is the frame's `run`), read from `job.adapter["child"]`.
- A tool job (`kind: "tool"`) adds `tool_call_id` (`job.adapter["tool_call_id"]`) when present.

Each ID costs about 50 bytes per job. That fits under the existing `_MAX_LISTED_BYTES` budget logic, which already counts each job's bytes.

### Sub-agent frames (`io.mindroom.subagents`, `live_frames/subagents.py` `_run_meta`)

`meta` gains `usage` for the run so far: `{"input_tokens": int, "output_tokens": int, "tool_calls": int, "cost_usd": float}`.

- **Tokens** are summed over the run's completed model requests, and update when each request completes. They do not change per streamed chunk.
- **`tool_calls`** counts every tool call the run started, including entries the transcript caps dropped.
- **`cost_usd`** prices those tokens at the run's model with the deployment's prices (`budgets/pricing.py` `run_cost_usd`, `model_prices(config)`). It is left out when the model has no price.
- The usage reaches the frame sink through the existing child-observation path (`delegation/lifecycle.py`). There is no new Matrix event and no new timer. A meta change already triggers a snapshot.
- Frames are encrypted in encrypted rooms and already go to the same members as the transcript, so cost and tool count need no extra privacy gate.

## Out of scope

- A "Review" button for approvals: the pill plus Open (the run view shows its approval) cover it.
- Per-turn or whole-sub-agent totals across turns: each row shows its own run.
- Changing the Sub-agents panel's cards.
- Showing tool-job command previews from room state (privacy rule above).

## Testing

- **Backend:** unit tests for the new `_job_state` fields (delegation and tool jobs, a job without `tool_call_id`), and for `meta.usage` (it accumulates over two requests, counts tool calls past the transcript cap, leaves out `cost_usd` for an unpriced model).
- **Client unit tests:** contract parsing (fields present, absent, wrong type), the presentation join (job to run by `subagent`, nesting by `parent`, tool preview by `tool_call_id`, no join without the field), grouping, the summary, and the single-job title row.
- **Client e2e:** extend `e2e/background-jobs/` with a fixture of a sub-agent job plus its frames (model, task, a running tool with preview, usage), a nested child and a tool job. Assert the row content, Open opening that run, and the narrow layout.
- **Live:** one run on a fresh throwaway deployment (`just live up --chat <worktree> --backend <worktree>`): start two sub-agents (one on an OpenAI model, one on Anthropic) and a background shell job, then screenshot the bar expanded and collapsed. Tear it down after.
