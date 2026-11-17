# Subagent cost on replies

## Goal

A reply's cost covers only its own agent's model requests, so a turn that hands most of its work to subagents looks cheap.
The backend now also reports what the subagent turns cost whose results the reply's turn received (backend design: `mindroom` `docs/dev/2026-11-16-subagent-reply-cost-design.md`).
The client shows that cost in the reply's cost details and adds it to the thread total.
Success: a reply that ran a reviewer subagent shows its own cost, the subagents' cost, and the thread total adds both.

## Event contract

`io.mindroom.ai_run.cost` gains one optional key:

| Key | Type | Meaning |
|---|---|---|
| `usd` | decimal string (existing) | the reply's own model requests |
| `subagents_usd` | decimal string, same format as `usd` (new, optional) | subagent turns whose results this reply's turn received, including their own nested subagents |

- Older backends and replies without subagents send no `subagents_usd`; the client then shows exactly what it shows today.
- A foreground `run_subagent` counts on the reply that called it; a background job counts on the reply whose `job` call collected its result.

## Decisions

1. Parse `subagents_usd` in `getAiRunInfo` (`src/app/matrix/protocol/aiRun.ts`) with the same `asNonNegativeDecimal` as `usd`, into `AiRunInfo.subagentsCostUsd`. The sender trust gate that drops `costUsd` for non-agent senders drops it too.
2. Reply details: the cost card keeps the reply's own cost and adds one "Subagents" row with `subagentsCostUsd` when present.
3. Thread total and per-reply cost entries (`threadConversationCost.ts`) count `costUsd + subagentsCostUsd`, so the thread cost row includes subagents. A reply with only a subagent cost still counts as priced.
4. No new preference, no change to the subagents panel.
