# Sidebar thread hover card: live status, cost and plugin details

Bas Nijholt asked on 2026-11-16, with a screenshot of the sidebar THREADS hover card:

> When hovering over these threads in the sidebar, I want to be able that plugins add more extra information, like for example for the pull request plugin, the CI status, the branch name, the pull request, those kinds of things. And perhaps also something that is useful is how many tools are currently being run, or whether it's streaming, if there's anything running on the background, whether a sub agent is running, such things. And maybe even the aggregate price of the total thread if available.

## Understanding

- The surface is the sidebar THREADS row's hover card (`src/app/sidebar/threads/ThreadNavItem.tsx`, the `TooltipProvider` around each row). Today it shows the title, Room, Agents, Messages and Last activity.
- Bas wants it to answer "what is this thread doing right now, and what is it about" without opening it: live work (streaming, tools running, background jobs, sub-agents), the thread's cost, and whatever plugins know (for the pull request plugin: the pull request, its CI state, the branch).
- Success: hovering a working thread shows what runs in it, live, and a thread with a linked pull request shows that pull request's state and CI; an idle thread's card stays as short as today's.

Said by Bas: the sidebar hover card; plugins add rows; pull request plugin rows (CI, branch, pull request); tools running; streaming; background work; sub-agents; total cost "if available".

Assumptions (chosen here):

- Plugins use the `threadDetails` contribution kind that open PR #424 (SDK version 57) adds for the Compact card's hover card and the thread menu. The sidebar becomes a third surface of that kind; no second kind.
- Live status and cost are app rows, not a plugin: they come from app stores and every user benefits.
- No backend change. The cost is the sum of the priced replies the client has loaded; when the thread's history is not fully loaded, the row says it is a lower bound.
- The card stays read-only and desktop-only (hover), as today.

## Scope

In:

1. **Live status rows** in the sidebar hover card, under the existing rows, each shown only when it has something to say:
   - **Status**: Streaming, Waiting for approval, or Waiting for an answer. No row when none applies.
   - **Tools**: the number of tool calls running in the thread's streaming reply, with up to two tool names, e.g. `2 running: shell, grep`. A call runs from its `tool_call_started` until its `tool_call_completed` in the reply's live tool trace.
   - **Sub-agents**: the number of active sub-agent runs started in the thread, the same count the room header's Sub-agents toggle shows for that thread (`runsStartedIn`, `countActiveSubagents` in `messages/live/subagentRunStore.ts`).
   - **Background**: the thread's live background jobs from `io.mindroom.background_jobs` (only agents still joined, as the jobs bar does), e.g. `3 jobs, 1 awaiting approval`.
   - **Cost**: the thread's total, `$1.23`, from `summarizeThreadConversationCost` over the thread's events in memory. When its `complete` is false, `at least $1.23`. No row when no priced reply is loaded. Formatted with the existing `formatCostUsd`.
2. **Live updates**: while the card is open, the rows follow the stores, so a tool finishing or a job ending changes the card without moving the pointer.
3. **Plugin details** (after PR #424 merges): the card renders the enabled plugins' `threadDetails` for the thread after the app rows, with `ThreadDetailsList` and the hairline rule #424 uses. Room hooks keep working there as on the other surfaces (the card provides the same room context the room page does), and `docs/client-plugins.md` names the sidebar card as a surface of the kind.

Out:

- Changing when or where the card opens (delay, position, touch).
- The Compact card's hover card and the thread menu: the live rows are one component, so those surfaces can add it later in a small PR.
- Loading thread history on hover to make the cost exact. A backend cumulative thread cost (for example a `cost.thread_usd` on each reply) is a separate follow-up if "at least" shows too often.
- The pull request plugin's own contribution: it ships in the plugin repo after #424 merges (Delivery).

## Behavior

- An idle thread with no cost loaded shows exactly today's card.
- Rows use the card's existing two-column grid (`EntryTooltipDetails`): label in priority 300, value at normal priority.
- The card subscribes to live stores only while it is open. Fifty rows in the sidebar must not add fifty subscriptions: the content mounts inside the tooltip, not in the row.
- Tool counting tolerates a trace whose completed event is missing (the stream ends): once the reply stops streaming, no tool counts as running.
- New strings go in `src/app/i18n/locales/additions/en.json` and all 16 language overlays, with plural forms for counts.

## Testing

- Unit tests for the pure pieces: running tool calls from a tool trace (started, completed, missing completion, stream ended), and the row model (which rows show, cost lower bound wording).
- Component test of the card: idle thread shows today's rows only; a streaming thread with running tools, a sub-agent and a job shows each row; rows update when a store changes while open.
- After #424: the card renders a plugin's `threadDetails` (the example plugin's contribution), a throwing one shows nothing.
- Screenshots of the card for an idle thread and a busy thread with a throwaway Playwright spec, in the PR.

## Delivery

1. App PR A (this branch, from `origin/main`): live status rows and cost.
2. Plugin details in the sidebar card: in PR A if #424 has merged by then (merge `origin/main`), else a small app PR B right after #424 merges.
3. Pull request plugin PR (`mindroom-ai/pull-request-client-plugin`, `apiVersion` 57): a `threadDetails` contribution with each linked pull request (number, title, state), its CI state (passing, failing, running, from the checks the plugin already reads) and the thread's branch. After #424 merges.
