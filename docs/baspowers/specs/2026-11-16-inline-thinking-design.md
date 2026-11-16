# Inline thinking: reasoning segments shown where they happened

Date: 2026-11-16. Requested by Bas. Option U1 (bulb works like the cog) and D1 (anchor metadata) chosen in the Mindroom-Dev thread `$vUkw7XDQ3O2fCuN-GdJYA3X8CshTKGohayx430N7Cw8`, after a clickable mockup.

## Goal

A reply's thinking shows in the place it happened, between its tool calls and text, the way the cog shows each run of tool calls in its place.
It is hidden by default and easy to hide again from anywhere in a long reply.

Today the backend joins every reasoning segment into one string (`io.mindroom.reasoning.text`), and the client can only show that string above the body.

Success:

- A finished reply shows today's header line (`💡 Thought for 12 s ›  ⚙ 4`), with nothing else from the thinking.
- Clicking the bulb shows every segment in its own place, with the same ripple the cog has, and clicking again hides them all.
- Each open segment has a thin rail on its left and a "Hide thinking" button at its end; either one hides all segments and moves focus to the bulb.
- While a reply streams, the segment being written shows open at the reply's current end, and once the segment ends it hides into the bulb (unless the bulb is open).
- With the bulb and the cog both open, the reply reads as a timeline: thinking, text and tool runs in the order they happened.
- Old events, and events from clients or backends without segments, look and behave as one segment at the top.

## Non-goals

- No per-segment toggles (option U2) and no merged bulb-and-cog control (U3).
- No setting that remembers the bulb per room or thread; the bulb starts closed on each message, as the cog does.
- No change to which replies keep reasoning (collected, team, split and approval-paused replies still keep none).
- No body marker line for thinking (option D2): the body and plain Matrix clients stay unchanged.

## Contract (backend writes, client reads)

### Final event

`io.mindroom.reasoning` gains an optional `segments` list:

```json
"io.mindroom.reasoning": {
  "text": "First thought…\n\nSecond thought…",
  "duration_ms": 12000,
  "segments": [
    {"start": 0, "after_tool": 0, "duration_ms": 5000},
    {"start": 17, "after_tool": 3, "duration_ms": 7000}
  ]
}
```

- `text` and `duration_ms` keep their current meaning, so old clients keep working.
- `start` is the segment's first position in `text`, in UTF-16 code units (as live splices count). Starts are strictly increasing, and the first is 0. A segment runs to the next one's `start`, or to the end of `text`; the client trims the `\n\n` separator off its end.
- `after_tool` is the number of visible tool calls started before the segment began, so `after_tool: n` places the segment right after the marker `🔧 \`name\` [n]`, and `0` means the top of the reply. It is `len(tool_trace)` at the segment's start when the agent shows tool calls, and `0` when it hides them, because then the body has no markers.
- `duration_ms` is the segment's own observed time. The segments' durations add up to the top-level `duration_ms` (it may differ by up to one millisecond per segment, from rounding).

Segments do not repeat the text, so the event grows by about 50 bytes per segment.

When `fit_reasoning_to_ordinary_event` cuts `text` to a prefix ending in `…`, it keeps only the segments whose `start` falls inside the kept prefix. When it drops the reasoning, the segments go with it.

### Live frames

`LiveDocs` gains `segments`, the same list without `duration_ms`: `[{"start": 0, "after_tool": 0}, …]`.

- Snapshots carry it as `"segments": [...]`.
- A delta carries the whole list as `"segments": [...]` only when it changed (it changes once per segment, and is small).
- Old clients ignore the key: `parseSnapshot` and `parseDelta` read only the keys they know.

## Backend design (mindroom)

`StreamingResponse` in `src/mindroom/streaming.py` already starts a new segment in `add_reasoning` after other output, and closes it in `end_reasoning_segment`. Both get one more step:

- `add_reasoning`, when it starts a segment, appends `{start: utf16_len(reasoning_text after the separator), after_tool: len(self.tool_trace) if self.show_tool_calls else 0}` to a new `_reasoning_segments` list.
- `end_reasoning_segment` writes the closed segment's `duration_ms`.
- `live_state()` passes `segments` (without durations) to `LiveDocs`; `LiveDocs.to_json` and `live_delta` in `src/mindroom/live_frames/frames.py` emit them.
- `_delivery_extra_content` adds `segments` to `REASONING_CONTENT_KEY` on the final write.
- `fit_reasoning_to_ordinary_event` in `src/mindroom/matrix/large_messages.py` filters segments to the kept prefix.

Resumed replies need no remap: `len(self.tool_trace)` already counts the resumed prefix, which is how marker numbers are counted too, and reasoning is not carried across a resume.

`docs/streaming.md` (section "Reasoning") documents the segments.

Tests:

- A stream of reasoning, tool, reasoning, text yields two segments with `after_tool` 0 and 1, correct starts, and durations.
- With `show_tool_calls: false`, every segment has `after_tool: 0`.
- Live snapshots and deltas carry `segments`, and a delta carries them only when they changed.
- `fit_reasoning_to_ordinary_event` drops segments past the cut.

## Client design (mindroom-chat)

### Reading segments

A pure helper, `reasoningSegments(text, segments, liveText?)` in `src/app/messages/agent-run/`, returns `{text, afterTool, durationMs?}[]`.
Missing, malformed or non-increasing segments fall back to one segment `{text, afterTool: 0}`, so old events look as they do today.
Live content gets the live list under a new key `io.mindroom.live_reasoning_segments`, set by `getLiveContent` in `useLiveReplyContent.ts`, after `liveFrame.ts` and the live reply store parse and apply it.

### Placing segments

A second pure helper, `placeSegments(segments, markerIndices)`, maps each segment to the marker it renders after.
`markerIndices` are the tool markers that render as blocks, from `getRenderedToolRefs` in `toolRefDom.ts`, which copy already uses.
A segment goes after the greatest rendered marker index at most its `after_tool`, or to the top when there is none.
This handles bodies without markers, markers inside code, and anchors past the last marker.

### Rendering

`withReasoning` (`Reasoning.tsx`) provides a `ReasoningSegmentsContext` with the placement, whether the bulb is open, its toggle, and which segment is live.

- The header line keeps its look: bulb, label, chevron, and the cog. The bulb button toggles `open`, sheds the cog's ripple on each click, and its comet laps while live reasoning grows, as today.
- Segments placed at the top render under the header line.
- `ToolRefGroupBlock` (`HtmlBlocks.tsx`) renders the segments placed after its last marker index right after itself. It does so even when the cog is closed and the run itself renders nothing.
- While segments render, `createToolTraceMarkerParserOptions` ends a run at a marker that has a rendering segment after it, so thinking between two consecutive tool calls splits their run. While none render, runs group as today. The parser options memo adds the anchors of the rendering segments to its keys.
- A segment renders when the bulb is open, or when it is the live segment of a streaming reply. Each one has the rail, a button with the label "Hide thinking", and the text with the current Markdown rendering (`ReasoningText`). The rail and the end button set `open` to false and focus the bulb, which scrolls it into view (today's `collapseFromEnd`).
- Labels: the header says "Thinking…" while live reasoning grows, otherwise "Thought for N s" with the total. Each segment shows "Thought for N s" with its own duration, or "Thinking…" while it is live, or "Thought" without a duration.

Styles go in `Reasoning.css.ts` (vanilla-extract), and strings go in the i18n files that `mindroomUi.messages.mindroomReasoning` uses now.

### Tests

- Unit tests: `reasoningSegments` (fallbacks, UTF-16 starts with an emoji, separator trimming), and `placeSegments` (no markers, anchor past the last marker, marker in code).
- Parser test: a segment anchored between two consecutive markers splits their run.
- `Reasoning.test.tsx`: the bulb toggles the segments in place; the rail and the end button hide them and focus the bulb; a live segment shows open at the end.
- One e2e spec, `e2e/messages/inline-thinking.spec.ts`, using a fixture event with three segments and four tool calls. It checks the closed state, the bulb open with the cog closed, both open in timeline order, and hiding from the rail. It takes screenshots for the PR.

`docs/architecture.md` documents the new keys where it lists the backend's event formats.

## Delivery

Two PRs, backend first:

1. `mindroom`: segments in the final event and live frames (about 60 lines of product code and 80 of tests).
2. `mindroom-chat`: reading, placement and rendering (about 145 lines of product code and 150 of tests, e2e included).

The client PR works without the backend PR, because it falls back to one segment at the top, so the order of merging does not matter.

## Risks

- Markers that render as text (in lists or quotes) have no block, so their segments move to the previous rendered marker, or to the top. That is acceptable, and the backend always writes markers as their own paragraphs.
- Long-text sidecar replies render a preview first, so their segments can move once the full body loads.
- Opening the bulb while tool calls show splits their runs, so the blocks rearrange once. That is intended: the thinking between them is now visible.
