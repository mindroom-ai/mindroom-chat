# Sidebar thread hover card: live status rows and cost (plan)

Spec: `docs/baspowers/specs/2026-11-16-sidebar-thread-hover-status-design.md`, Delivery item 1 (Scope In 1 and 2). Plugin details (Scope In 3) wait for PR #424.

Goal: the sidebar THREADS hover card adds Status, Tools, Sub-agents, Background and Cost rows, each only when it has something to say, and they follow the stores while the card is open. An idle thread without a loaded cost shows today's card.

Architecture: one pure row model and one thin component in `threads/` (layer 9), so the Compact card and the thread menu can use it later; the sidebar row (layer 14) renders the component inside its tooltip. folds mounts a tooltip's content only while it is open, so the component's subscriptions exist only then.

## Tasks

1. **Running tool calls** (`matrix/protocol/toolTrace.ts`): `runningToolCalls(events, streaming)` returns the count of trace entries still `tool_call_started` and their distinct names, and nothing once the reply no longer streams. Tests: started, completed, a missing completion while streaming, stream ended.
2. **The streaming reply** (`event-store/threads/useThreadStreamingState.ts`): `getThreadStreamingReply(room, threadRootId)`, the tail reply the streaming check finds, so its tool trace can be read. Test beside the existing ones.
3. **Loaded thread cost** (`event-store/threads/threadConversationCost.ts`): `summarizeLoadedThreadCost(thread, viewerId)` runs `summarizeThreadConversationCost` over the thread's live timeline, with each event's latest edit, agent senders only, and `complete` only when the SDK fetched the thread and has no older page. Tests: priced replies sum, a non-agent sender is ignored, an unfetched thread is incomplete.
4. **Row model** (`threads/threadLiveStatus.ts`): `threadLiveStatusRows(input, t, language)` gives `{ key, label, value }[]` for status (approval, then question, then streaming), tools (`2 running: shell, grep`), sub-agents (`1 active`), background jobs (`3 jobs, 1 waiting for approval`) and cost (`$1.23`, or `≥ $1.23` when incomplete). Tests: idle gives no rows; each row and its wording; precedence of status.
5. **Component** (`threads/ThreadLiveStatusRows.tsx`): reads the signals reader, the streaming reply's tools (live reply store first, else the reply's latest edit), `useRoomSubagentCounts`, `useRoomBackgroundJobs` with `jobsInView`, and the loaded cost; renders label/value `Text` pairs for the card's grid. Test with real stores: idle renders nothing; a busy thread renders each row; a live frame that completes a tool changes the row while mounted.
6. **Sidebar card** (`sidebar/threads/ThreadNavItem.tsx`): render the component inside `css.EntryTooltipDetails`, after Last activity. Test that the tooltip holds it.
7. **Strings**: new keys under `threadNav.live` in `locales/additions/en.json` and the 16 overlays (a Python script), reusing `thread.filters.status`, `thread.status.streaming`, `mindroomUi.messages.threadApprovalControls.waitingForApproval`, `mindroomUi.subagents.title`, `mindroomUi.subagents.count`, `mindroomUi.messages.mindroomReplyDetails.cost` and `atLeastCost`.
8. **Gates and screenshots**: focused tests, eslint, `just typecheck`, `just strict` here; full `just lint` and `just test` on gce-dev; a throwaway Playwright spec for an idle and a busy card.
