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
3. Its rendered HTML has at least one tool marker, and visible content follows the last one:
   once sanitized as the renderer sanitizes it, text other than whitespace and the pending mark
   `⏳`, or an image, video or audio element.
4. It is long (owner decision, 2026-11-16: "only fold when the reply is longer than a certain
   length"): its plain `body` (the sidecar's once read) has an effective length of at least 6000
   characters, about two printed pages (owner, 2026-11-16: 1200 folded too eagerly), where each
   tool marker line counts as 80 characters, because it renders as a full row. A length, not a
   measured height: an earlier version measured the rendered reply against the viewport, and
   review kept finding races in it (the cog mounting after the measurement, the Android keyboard
   shrinking the viewport for a cached verdict, images loading later, zero-size panels), and the
   element it measured broke inline bodies. A length is the same on every device and needs no
   layout.
5. It is not a search result or a highlighted row (`highlightRegex` set); those show the whole
   reply.
6. A long reply whose body is in a sidecar folds only once the sidecar is read; the truncated
   preview never folds, also when the sidecar cannot be read.

When it folds:

- Everything before the visible tail collapses into one row at the top of the message:
  the reasoning header, the tool-call cog and every top-level block up to and including
  the block that holds the last tool marker.
- The row reads `Worked for <duration>`, or `Worked` when no duration is known. It has a
  chevron and `aria-expanded`. Clicking it shows the folded part in place, exactly as it
  renders today; clicking again folds it.
- The tail renders as it does today.
- The duration runs from the reply event's `origin_server_ts` to the timestamp of its
  latest replacement (the final stream edit). With no replacement there is no duration. It is
  formatted with `Intl` in the interface language (narrow units: `45s`, `2m 13s`, `1h 4m` in
  English).
- Copy, tool-call rows, approvals and the `showToolCalls` preference keep working on the
  folded part once it is open. Copy still copies the whole body.
- A reply the reader opened stays open across virtualization remounts. Store the choice
  in the timeline's existing `ManualExpansionStateContext` map, under a key distinct from
  `CollapsibleMessage`'s key for the same event.
- The timeline's expand all opens the folded work and collapse all folds it, as it does for
  `CollapsibleMessage` (`ExpandAllInitContext`: true opens, false folds, undefined keeps the
  reply's own state).
- Every long finished reply in the history folds, not just the latest one.

Nothing else changes: user messages, agent replies without tool calls, replies that end in a
tool call and shorter replies render as today, with no row and no element of their own.

## Design

- **Split (pure, unit-tested):** `splitFinishedWork(html)` in
  `src/app/messages/agent-run/finishedWorkSplit.ts`. Parse with `htmlToDOM` (already used by
  `toolRefDom.ts`), find the last top-level node whose text matches
  `MINDROOM_TOOL_REF_HTML_REG_G`'s marker form, and return `{ head, tail }` HTML strings, or
  `undefined` when no marker exists or nothing visible follows it. The backend writes every
  marker as its own paragraph (`_format_tool_marker` wraps it in blank lines), so a top-level
  split is exact. The rendering component memoizes it on the HTML string (`useMemo`), because
  every streamed edit re-renders the row.
- **Length (pure, unit-tested):** `isLongAgentReply(body)` beside `splitFinishedWork`. Each line
  that `parseToolRefText` reads as a marker (`⏳` included) counts as 80 characters; the reply is
  long from 6000 (`LONG_AGENT_REPLY_LENGTH`), independent of the timeline's own
  long-message length. A reply that is not long is not split.
- **Fold component:** `FinishedWorkFold` in `src/app/messages/agent-run/`. Given a split, it
  renders the row, the work when open, and the answer; without one it returns the whole reply
  with no element of its own, so the tree is the same as without the fold (an emote's
  `* Agent` prefix and a body's streaming dots or `(edited)` stay on its line). The row uses the
  reasoning header's styles (`Reasoning.css.ts`); no new design language.
- **Wiring:** the agent text path in `renderAgentMessageContent.tsx` (`renderBody`, the
  thinking placeholder and the long-text path, so hydrated sidecar replies fold too). Every
  agent body renders through `AgentWorkBody` and `FinishedWorkFold` from its first streamed
  frame, with or without a tool marker, so collapsed reasoning and the body's elements stay
  as the first marker arrives. When the split applies, render
  `FinishedWorkFold` around the reasoning header, cog and head body, then the tail body.
  Keep `ToolCallsFold` as the outer provider so the cog still counts all calls.
- **Strings:** `Worked for {{duration}}` and `Worked` in `en.json` and all 16 overlay files.
  Format the duration with `Intl` (`formatWorkDuration` in `src/app/lib/time.ts`).

## Testing

- Unit tests for `splitFinishedWork`: no marker; marker at the end; one marker then text;
  several markers; whitespace-only tail; marker text inside a code block does not count; a
  tail of only `⏳` or of content the sanitizer drops does not fold, an image-only tail does;
  comments are not text; under the browser parser a `<pre>` keeps its leading newline.
- Unit tests for `isLongAgentReply`: 5999 characters is not long, 6000 is; a marker line counts
  as 80, also a pending one with `⏳`; a marker inside a line of text counts as text.
- Component tests: a completed reply of effective length 6000 folds and opens on click, one of
  5999 does not; a reply that does not fold renders with no element of the fold's own; an agent
  emote and an inline body, through the real `MsgTypeRenderers`, keep the body on the line of
  the `* Agent` prefix and of the streaming or edited suffix; a streaming reply, an `error` reply, a reply without tools, a non-agent message
  and a highlighted row do not fold; the label shows the duration from the replacement
  timestamp; the open state survives a remount through `ManualExpansionStateContext`; expand
  all opens and folds it; a sidecar reply folds once read and not when the read fails.
- Screenshots of a folded and an opened reply for the pull request.

## Not doing

- No setting to switch the fold off (none was requested; add one if Bas asks).
- No `You stopped after …` row for cancelled replies; they stay unfolded.
- No split inside a paragraph, and no folding of replies that have no tool calls.
