# Background jobs bar: rich rows

Date: 2026-11-18. Requested by Bas in Mindroom-Dev ("instead of just saying running sub agent, show a link to the thread, which model it is running with logo, and how long it's running for").

## Intent

Bas runs many sub-agents and long tool jobs at once (implementers, reviewers, test suites on gce-dev). The jobs bar above the composer says only "Sub-agent: mindroom_dev" or a tool name. He wants to see at a glance, per job: which model, what it is doing, how long it has run, what it has cost, and where it lives, and to jump to it.

Success: with five or more jobs running, each row answers "who, on what model, doing what, for how long, for how much" without opening anything, and Open goes straight to that sub-agent's run.

## Picked design

Bas picked variant A of the mockup (`mockups/jobs-bar-rich/mockup.html` in DevAgent's workspace; screenshot in the thread), with every detail on: model logo, model name, elapsed timer, task line, live "now doing", thread link, nested sub-agents, tool calls / tokens / cost, and grouping sub-agents vs tools.

### Expanded list

Bas then picked variant C ("Task-first table") of a visual redesign (`mockups/jobs-bar-rich-v2/` in DevAgent's workspace). The bar keeps its mechanics unchanged: where it sits, hover/click to expand, pinning, Escape and outside-click to close, focus handling, Stop, Stop all, Stopping…, failures, the jobs held between calls.

- **One grid.** Every row and group heading shares one grid: the logo in a fixed column (28 px tile, 20 px nested), the text column, then fixed columns for Calls, Tokens, Cost, Time, and Open + Stop. Only the text column flexes, so every row's numbers, time and buttons line up. A hairline sets each top-level job off the one before; a nested job stays with its parent.
- **Groups.** Sub-agents first, then tools, oldest first in each. Each group has a heading row on the grid that names its number columns ("Calls · Tokens · Cost · Time" for sub-agents, "Time" for tools), so the cells hold bare numbers with their words as titles. When both kinds are present the heading also names the group, "Sub-agents · N" or "Tools · N"; with one kind only, it names just the columns.
- **Type.** Inter only, two sizes (T200, and T300 for the headline), two weights (400, 600), tabular numerals. The only other family is the app's `var(--font-mono)`, for a tool call's arguments.
- **Sub-agent row:**
  - **Logo:** the run's model mark (`ProviderModelIcon`) on a Surface tile with a line, so it shows on the bar; the agent's avatar (`AgentAvatar`) before the run has a model. A status dot ringed in the row's own colour: running (success, a slow pulse `prefers-reduced-motion` turns off), awaiting approval (warning), stopping (critical), finished (muted).
  - **Line 1, the headline:** the task's first line at T300 weight 600, ellipsized, then at most one pill at its end: "Waiting for approval" (warning) or "Stopping…" (critical). Without a task (no frame yet), the job's name.
  - **Line 2, muted:** the agent's display name (`useAgentProfile`), the model (`getAiRunCompactModelLabel`, full label as `title`), "·", then what it does now: the newest tool entry's name and its args preview in the code font. Only the name when the frame carries no previews (`show_tool_calls` off). Then the thread chip.
  - **Thread chip:** only when the job's `threadId` is not the view's thread (in practice, the room timeline view). The thread's title (`useThreadTitle`) with a thread icon; pressing it shows that thread.
  - **Numbers:** calls, tokens (compact, "1.9M"), cost (`formatCostUsd`) from the frame's `usage`, each blank when it has no value: no calls when 0, and neither tokens nor cost before the first token. Cost counts the run's own model requests only.
  - **Time:** elapsed since `started_at`, as "38m 12s" (`formatWorkDuration`), so it visibly ticks each second. A finished job's time stops at its run's end, or when the bar first showed it finished.
  - **Open and Stop:** 28 px icon buttons with tooltips and labels. Open shows the Sub-agents panel on this job's run, and appears only when the panel has that run. Stop turns critical under the pointer. A stopping job shows a spinner in Stop's place, with "Stopping…" for screen readers.
- **Tool row:** a terminal icon on the tile, with the same dot. Line 1 is the tool's name (the headline style). Line 2 is the call's args preview in the code font, found by the job's `tool_call_id` in the visible tool trace of its own agent's reply in its own conversation; none when not found. Then the thread chip. No numbers; Time and Stop.
- **Nesting:** a sub-agent job whose run's `parent` is another listed job's run sits right under it, its logo and text moved in one fixed step per level (at most 3), with an elbow line from its parent. Its columns stay where they are. A job whose parent is not listed stays top-level.
- **The bar's width decides** (container queries on the bar, not the screen):
  - **Beside the side panel (bar under 46rem):** the number columns narrow, the thread chip shrinks to its icon (its title names the thread), the agent's name gives way sooner.
  - **Phone (bar under 30rem):** only Time, Open and Stop stay on the right; the model leaves line 2; the approval pill becomes its icon, and the stopping pill leaves (the spinner and dot say it).

### Title row

- A line sets it off the listed jobs. Its icon (clock, or a check once all finished) sits in the logos' column.
- **Several jobs:** today's title ("7 background jobs", weight 600), the first 4 sub-agents' logos stacked, then a muted summary "{s} sub-agents · {t} tools" and " · {k} needs approval" in the warning colour when k > 0 (parts with a zero count left out), then the chevron at the toggle's end. Stop all is an icon-and-text button of the same family as Stop. On a phone the icon, the summary and (when something needs approval) the logos leave, so the title reads "N background jobs", then "k needs approval".
- **One job:** that job on one line: its logo with dot, today's title text, its time, Open (sub-agent with a run only), Stop.

### Missing data

Every row must degrade to today's content, never to a blank or broken row:

- **No frame yet** (a client opened the room after the run started gets the next full snapshot within 10 s, a paused run sends none until it resumes, `streaming.live_frames: false` sends none): the sub-agent row shows today's name, the agent's avatar and the elapsed time from `started_at`. Elapsed time is always available.
- **Older backend without the new state fields:** same as no frame. The client must not join by agent name or thread as a fallback.
- **No `usage` in the frame (older backend):** no stats.

### Accessibility and copy

- The ticking timer text is `aria-hidden`. The row carries a screen-reader-only "started {relative time}" (`useRelativeTime`), so assistive tech is not told every second.
- Status dots are decorative. The status pill and today's waiting text carry the state.
- Every new string goes in the locale additions, in every locale file that the repo's i18n check requires.
- Every job's time ticks on one shared 1-second clock (`subscribeRelativeTimeClock`), and only while the job is live.

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

## Known limits

- While the job list is open and lists a tool job, each live reply frame re-reads that job's loaded conversation.
- A row shows the run its job names, so a follow-up turn's details appear once the jobs state names it, up to a few seconds later.
- A job is joined to its run by run ID alone; run IDs are unique per delegation.
- A tool job that ends while the list is folded shows its time as of the list's next opening.

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
