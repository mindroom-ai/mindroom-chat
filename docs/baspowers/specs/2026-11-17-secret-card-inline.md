# Secret request cards inline at their tool call

Date: 2026-11-17. Bas picked variant E from `mockups/secret-card/mockup.html` (DevAgent workspace).

## Goal

A done secret request is drawn inside the agent's reply, at the tool-call line that asked for it, instead of as a separate message row.

- **Pending** (or answered from this page before the agent's edit): the request keeps its own row, today's card, right under the reply. The agent is blocked on that call, so the call is the reply's last line and the row sits at it anyway. Moving the live form into the reply gave it two owners that switched as the timeline changed (a later edit, a plugin's renderer, live frames, extras), losing what was typed. While a request of its calls waits, the reply's work does not fold.
- **Done** (`saved`, `declined`, `expired`, as the agent's edit says): one line that looks like a tool-call line: lock icon tile in the state's colour, the secret's name (temporary: `env` in mono, or `label`; key: `display_name`), then the status (`Sent · kept 15 minutes`, `Saved`, `Declined`, `Expired`), and a chevron. It splits a run of tool calls ("Ran 2 tool calls", secret line, "Ran 1 tool call") and folds with the reply's other calls.
- **Done, opened:** clicking the line opens a read-only card under it: name and status chip, the full reason, then fact lines (given as, kept for; for a key: used only for hosts, replaced the key saved before; declined or expired: nothing was sent). It names no server, since the viewer's current one may not be the one that got the secret. No field, no buttons. Clicking again folds it.
- **Fallbacks:** the request keeps its own row (with the #512 fold once done) for older backends without the fields below, replies not in the timeline, and replies that do not draw the call's marker from their finished, durable body: still streaming, long text, or drawn by a plugin. So does a card that is the thread's root, comes from an ignored sender, or was opened by a link or a jump. The reply's extras never draw it.

## Wire format (backend `mindroom`)

1. `io.mindroom.secret_request` content (initial card and every `m.replace` edit) gains:
   - `response_event_id`: the event id of the agent reply whose tool call asked (the reply that carries the `🔧 ... ⏳` line), like `io.mindroom.tool_approval` carries for paused replies.
   - `tool_call_id`: the id of the tool call whose line shows the request. For a call made through the CLI/bash wrapper, the visible line is the outer call's, so this is the outer (`parent_bash_call_id`) call's id.
   Both are omitted when unknown (e.g. no streaming reply); the client then falls back to today's separate row.
2. `io.mindroom.tool_trace` events in Matrix metadata gain `tool_call_id` (public; provider call ids carry no secret). Update the comment at `tool_system/events.py:48` and `docs/streaming.md`.

## Client (`mindroom-chat`)

- A planner (`messages/inlineSecretRequests.ts`) says which done secret cards a reply may draw (its `response_event_id` reply is in the same timeline, from the same agent) and at which `tool_call_id`, and marks replies with a waiting request so their work does not fold. It does not hide rows: a card's row hides while its line is mounted in the reply, which the line records as it mounts and unmounts (the same file's `DrawnSecretRequests`), so the row and the line cannot disagree, also while the reply streams.
- The reply's tool-call rendering (`messages/html/HtmlBlocks.tsx`, `ToolRun`) splits the run at the matched call and draws the secret line (`approvals/SecretRequestLine.tsx`) there.
- `SecretRequestCard` keeps owning the form, answer, focus and live-region logic; the line and its opened card reuse its read-only details.
- `docs/architecture.md` (Secret request and Tool trace rows).

## Tests

Backend: card content carries both fields for a streamed reply's tool call (incl. a CLI-wrapped call) and omits them without a reply; trace serialization includes `tool_call_id`. Client: the planner hides only done cards it can place and keeps the rest as rows; a pending card stays its row under the reply and keeps the reply's work unfolded; the done line splits its run, folds with the calls, and opens the read-only card; the fallback rows above. e2e: `e2e/approvals/secret-request.spec.ts` covers the pending row, the done line in place, and the opened card, with screenshots.

## Out of scope

No change to how answers are sent, to who may answer, or to the backend's status edits.
