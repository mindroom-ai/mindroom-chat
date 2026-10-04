# Bug reports

Every message menu has **Report a bug**.
One click sends a JSON report to the deployment's administrators and opens the report thread, where the reporter can add details.
State events (the room-event menu) do not show the item.

## Enable it

Add the administrators to the homeserver's `/.well-known/matrix/client`:

```json
{
  "m.homeserver": { "base_url": "https://matrix.example.com" },
  "io.mindroom.bug_reports": { "admins": ["@admin:example.com"] }
}
```

The document must be served with `Access-Control-Allow-Origin: *`, as Matrix clients already require.
Without the key, the menu item is labelled **Download bug report** and saves the JSON instead.

## What happens

- The reporter gets one private room, `Bug reports · <name>`, shared only with the administrators; each report is a thread in it.
- The room has type `io.mindroom.bug_reports` and is created unencrypted so `matrix-mcp` can read it.
- Administrators' MindRoom Chat clients join these rooms automatically when the inviter is on the same homeserver.
- The room ID is kept in the reporter's account data `io.mindroom.bug_reports`; leaving the room makes the next report create a new one.

## What a report contains

- The room, thread, and message IDs and permalinks.
- The raw events of the thread (or the 50 main-timeline events up to the message), each with its latest edit and local send status.
- Client build, platform, browser, viewport, sync state, and URL.
- The same diagnostics as **Settings → About → Export diagnostics**.

`m.replace` edit events are not listed in `events`, because streaming responses produce hundreds of them; each event carries its latest edit as `latestEdit` instead.
Reactions are kept.

Nothing is redacted: administrators are trusted with everything, and users never see each other's reports.

## Backend data

Run `mindroom debug-report <report.json>` on the MindRoom host to collect the backend side (turn records, Agno runs, tool calls, LLM request logs, and log lines) for the same identifiers.
