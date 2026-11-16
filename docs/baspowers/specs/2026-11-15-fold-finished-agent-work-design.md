# Fold finished agent work (T3 Code parity)

## Intent

Bas is moving his development work from T3 Code into MindRoom. In T3 Code a finished
turn folds: tool calls, reasoning and the in-between messages collapse into one
`Worked for <duration>` row, and only the turn's final message stays visible. Long agent
replies in MindRoom Chat show everything, so the answer sits under screens of tool output.

MindRoom differs from T3 in one way: an agent turn is usually a single Matrix event. Its
body holds text with tool markers (`🔧 \`tool\` [N]`) in between. T3's "final message"
therefore maps to **the text after the last tool marker** in that one event.

Bas chose the split point: after the last tool call.

## Behavior

A MindRoom agent reply folds when all of these hold:

1. The sender is a MindRoom agent (`fromMindroomAgent`).
2. The reply is finished: its AI run status is `completed` or `cached`. A reply that is
   streaming, `error` or `cancelled` never folds (T3 does not fold interrupted or failed turns).
3. Its rendered HTML has at least one tool marker, and some non-whitespace content follows
   the last one.

When it folds:

- Everything before the visible tail collapses into one row at the top of the message:
  the reasoning header, the tool-call cog and every top-level block up to and including
  the block that holds the last tool marker.
- The row reads `Worked for <duration>`, or `Worked` when no duration is known. It has a
  chevron and `aria-expanded`. Clicking it shows the folded part in place, exactly as it
  renders today; clicking again folds it.
- The tail renders as it does today.
- The duration runs from the reply event's `origin_server_ts` to the timestamp of its
  latest replacement (the final stream edit). With no replacement there is no duration.
- Copy, search highlighting, tool-call rows, approvals and the `showToolCalls` preference
  keep working on the folded part once it is open. Copy still copies the whole body.
- A reply the reader opened stays open across virtualization remounts. Store the choice
  in the timeline's existing `ManualExpansionStateContext` map, under a key distinct from
  `CollapsibleMessage`'s key for the same event.
- Every finished reply in the history folds, not just the latest one (T3 folds every turn).

Nothing else changes: user messages, agent replies without tool calls, and replies that
end in a tool call render as today.

## Design

- **Split (pure, unit-tested):** `splitFinishedWork(html)` in
  `src/app/messages/agent-run/finishedWorkSplit.ts`. Parse with `htmlToDOM` (already used by
  `toolRefDom.ts`), find the last top-level node whose text matches
  `MINDROOM_TOOL_REF_HTML_REG_G`'s marker form, and return `{ head, tail }` HTML strings, or
  `undefined` when no marker exists or the tail is blank. The backend writes every marker as
  its own paragraph (`_format_tool_marker` wraps it in blank lines), so a top-level split is
  exact. Memoize on the HTML string, because every streamed edit re-renders the row.
- **Fold component:** `FinishedWorkFold` in `src/app/messages/agent-run/`. Renders the row and,
  when open, its children. Reuse the disclosure styling of `ToolCallsFold`/`Reasoning` where it
  fits; no new design language.
- **Wiring:** the agent text path in `renderAgentMessageContent.tsx` (`renderBody` and the
  long-text path, so hydrated sidecar replies fold too). When the split applies, render
  `FinishedWorkFold` around the reasoning header, cog and head body, then the tail body.
  Keep `ToolCallsFold` as the outer provider so the cog still counts all calls.
- **Strings:** `Worked for {{duration}}` and `Worked` in `en.json` and all 16 overlay files.
  Format the duration as T3 does (`45s`, `2m 13s`, `1h 4m`).

## Testing

- Unit tests for `splitFinishedWork`: no marker; marker at the end; one marker then text;
  several markers; whitespace-only tail; marker text inside a code block does not count.
- Component tests: a completed reply folds and opens on click; a streaming reply, an
  `error` reply, a reply without tools and a non-agent message do not fold; the label shows
  the duration from the replacement timestamp; the open state survives a remount through
  `ManualExpansionStateContext`.
- Screenshots of a folded and an opened reply for the pull request.

## Not doing

- No setting to switch the fold off (none was requested; add one if Bas asks).
- No `You stopped after …` row for cancelled replies; they stay unfolded.
- No split inside a paragraph, and no folding of replies that have no tool calls.
