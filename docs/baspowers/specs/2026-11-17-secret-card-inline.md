# Secret request cards inline at their tool call

Date: 2026-11-17. Bas picked variant E from `mockups/secret-card/mockup.html` (DevAgent workspace).

## Goal

An agent's secret request is drawn inside the agent's reply, at the tool-call line that asked for it, instead of as a separate message row.

- **Pending:** the form card (today's card body, tidied as in mockup E/A) hangs under the request's line in the reply. It cannot be folded away. It shows even when the reply's tool calls are folded or the thread hides tool calls.
- **Done** (`saved`, `declined`, `expired`, or the local answer before the agent's edit): one line that looks exactly like a tool-call line: lock icon tile in the state's colour, the secret's name (temporary: `env` in mono, or `label`; key: `display_name`), then the status (`Sent · kept 15 minutes`, `Saved`, `Declined`, `Expired`), and a chevron. The request is always its own line: it splits a run of tool calls ("Ran 2 tool calls", secret line, "Ran 1 tool call") rather than hiding inside one.
- **Done, opened:** clicking the line opens a read-only card under it, in the same visual family as the pending card: name and status chip, the full reason, then fact lines (given as / kept for / sent to; for a key: used only for hosts, replaced the key saved before; declined: nothing was sent or kept). No field, no buttons. Clicking again folds it.

## Deviation: pending stays a row (2026-11-17, after review round 2)

A request that is not done yet (pending, or answered from this page before the agent's edit) does not move into the reply: it keeps its own row, exactly today's card, right under the reply. The agent is blocked on that call, so the call is the reply's last line and the row sits at it anyway. Moving the live form between its row and the reply gave it two owners that switched as the timeline changed (a later edit, a plugin's renderer, live frames, extras), losing what was typed. Only a request the agent's edit marked done is drawn inline, as the line above that opens the read-only card, and only when the reply's finished, durable body renders the call's marker (not a reply of long text, still streaming, or drawn by a plugin; never in the reply's extras). While a request of its calls waits, the reply's work does not fold.

## Wire format (backend `mindroom`)

1. `io.mindroom.secret_request` content (initial card and every `m.replace` edit) gains:
   - `response_event_id`: the event id of the agent reply whose tool call asked (the reply that carries the `🔧 ... ⏳` line), like `io.mindroom.tool_approval` carries for paused replies.
   - `tool_call_id`: the id of the tool call whose line shows the request. For a call made through the CLI/bash wrapper, the visible line is the outer call's, so this is the outer (`parent_bash_call_id`) call's id.
   Both are omitted when unknown (e.g. no streaming reply); the client then falls back to today's separate row.
2. `io.mindroom.tool_trace` events in Matrix metadata gain `tool_call_id` (public; provider call ids carry no secret). Update the comment at `tool_system/events.py:48` and `docs/streaming.md`.

## Client (`mindroom-chat`)

- A planner, like `approvals/threadApprovalTimeline.ts`, puts a secret card event in `hiddenEventIds` when its `response_event_id` reply is in the same timeline and has a trace entry with that `tool_call_id`. Otherwise the card keeps its own row (today's card with the #512 fold), so older backends, unloaded replies and read-only views still work.
- The reply's tool-call rendering (`messages/html/HtmlBlocks.tsx`, `ToolRefGroupBlock`, `agent-run/ToolCallsFold.tsx`) splits the run at the matched call and draws the secret line there; pending draws the form card under it.
- `SecretRequestCard` keeps owning the form, answer, focus and live-region logic. The new pieces are the line and the read-only opened card.
- Update `docs/architecture.md` (Secret request and Tool trace rows).

## Tests

Backend: card content carries both fields for a streamed reply's tool call (incl. a CLI-wrapped call) and omits them without a reply; trace serialization includes `tool_call_id`. Client: planner hides/keeps rows; pending card renders at its line even with tools folded/hidden; done line folds and opens the read-only card; fallback row without the fields. e2e: extend `e2e/approvals/secret-request.spec.ts` with an inline case and screenshots (pending, done folded, done opened).

## Out of scope

No change to how answers are sent, to who may answer, or to the backend's status edits.
