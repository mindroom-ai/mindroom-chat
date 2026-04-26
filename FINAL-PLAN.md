# CINNY-089 — Collapsible MindRoom Message Extras Final Plan

## Goal

Implement a small rendering-only Cinny feature for optional secondary material on normal Matrix messages.

A message carrying `com.mindroom.message_extras` renders its normal body exactly as before, then shows one or more collapsed sections underneath. This lets agents keep the visible chat concise while attaching optional evidence, logs, code excerpts, or raw details.

This is not a generic UI block framework. V1 is deliberately narrow: one custom key, one parser, one renderer, two text content types, no sender UI, no raw HTML contract.

## Matrix content contract

Custom event content key:

```json
"com.mindroom.message_extras": {
  "version": 1,
  "sections": [
    {
      "title": "Relevant code",
      "content_type": "text/markdown",
      "content": "```ts\nconst value = foo();\n```",
      "collapsed": true
    }
  ]
}
```

Only `m.room.message` rendering is in scope. Other Matrix clients ignore the custom field and continue to show the ordinary `body`.

## Parser and schema normalization

Add `src/app/components/message/mindroomMessageExtras.ts`.

Export:

- `MINDROOM_MESSAGE_EXTRAS_KEY = 'com.mindroom.message_extras'`
- normalized section/extras types
- constants for limits
- `parseMindroomMessageExtras(content): MindroomMessageExtras | null`

Validation contract:

- Top-level value must be a plain object.
- `version` must be exactly `1`; wrong version rejects the whole payload.
- `sections` must be an array; non-array rejects the whole payload.
- Keep at most the first 8 candidate sections.
- Each section must be a plain object.
- `title` must be a non-empty string after trimming; clamp display title to 120 characters.
- `content` must be a string and within the configured character cap, initially 16 KiB; oversized sections are skipped.
- `content_type` must be `text/plain` or `text/markdown`; unknown types are skipped.
- `collapsed` defaults to `true`; only explicit `false` starts open.
- Unknown fields are ignored.
- If no valid sections remain, return `null`.
- The parser must never throw during render.

Cap failures are section-local except for top-level structure and version. One bad section must not suppress other useful sections.

Use character caps unless the implementation chooses true byte caps; do not name a UTF-16 length limit as bytes.

## Renderer

Add:

- `src/app/components/message/MindroomMessageExtras.tsx`
- `src/app/components/message/MindroomMessageExtras.css.ts`

Render one native `<details>` per section, using `defaultOpen={!section.collapsed}` so the disclosure is uncontrolled after first mount. Do not add React state, atoms, localStorage, or persistence.

Use a simple vertical list under the normal body. Each `<summary>` displays the section title as React text, relying on JSX escaping; do not HTML-sanitize titles before rendering because that can double-encode.

`text/plain` rendering:

- Render literal text in a styled `<pre>` or equivalent block.
- Use `white-space: pre-wrap` and wrapping so logs fit mobile width.
- Do not run linkification, LaTeX, markdown, or HTML parsing for plain text.

`text/markdown` rendering:

- Reuse the existing Cinny markdown pipeline and existing sanitizer.
- Convert markdown with `parseBlockMD(content, parseInlineMD)`.
- Sanitize the generated HTML with `sanitizeCustomHtml`.
- Parse with existing `html-react-parser` options, including MindRoom-aware parser options where applicable.
- Do not add new permitted sanitizer tags or attributes.
- Do not accept `text/html` or raw formatted HTML in v1.

Important implementation note: both planners flagged raw HTML handling. The implementer must inspect the existing markdown parser behavior and tests. The final contract is that v1 does not expose a separate arbitrary-HTML content type. Markdown should not expand sanitizer capabilities. If raw allow-listed HTML in markdown would become active in a surprising way, either escape raw input before markdown parsing or add regression tests documenting and constraining the existing parser behavior.

## Integration point

Start in `src/app/components/RenderMessageContent.tsx`.

Parse extras once from the effective content that already accounts for edits.

Append extras for text-family renderers:

- `m.text`
- `m.notice`
- `m.emote`
- MindRoom long-text text rendering paths that short-circuit to `MindroomLongTextText`

Skip extras for v1 on:

- media messages (`m.image`, `m.video`, `m.audio`, normal `m.file`)
- location messages
- bad encrypted fallback paths
- MindRoom tool approval cards
- MindRoom thread summary cards
- reactions, redactions, state events, replies as preview-only surfaces

The exact ordering should be intentional. Preferred visual order is normal body, then extras, then URL previews. If preserving that order requires a small `renderAfterBody` slot in `MText`, `MNotice`, and `MEmote`, implement that small slot. If the implementation instead appends extras after the existing renderer, document that the order is body, URL previews, extras; do not accidentally claim a different order.

Avoid touching `RoomTimeline.tsx` unless live visual review proves the outer long-message collapser hides extras in a bad way.

## Shared surface decision

`RenderMessageContent` is used beyond the main timeline. The implementation should be deliberate, not accidental.

Preferred v1 policy:

- Extras render in actual room and thread timeline messages.
- Extras may render in pinned-message full-content surfaces if that is naturally inherited and does not make the UI noisy.
- Inbox and notification previews should not become tall noisy cards unless explicitly reviewed.

If adding a `renderMessageExtras` / `showMessageExtras` prop is the smallest way to avoid accidental preview-surface expansion, do that and enable it only in full message surfaces.

This is a known planner disagreement: Claude favored transparent inheritance into pin/inbox because sections are collapsed; Codex favored explicit gating to avoid noisy compact surfaces. DevAgent synthesis chooses explicitness if the call-site cost is small.

## Edit behavior

`getLatestMessageContent` / `copyResolvedMessageMetadata` already preserve `com.mindroom.*` metadata across edits when `m.new_content` omits the key. Add a focused regression test so future refactors do not drop `com.mindroom.message_extras`.

If a sender wants to update extras during streaming or after completion, it should include the updated field in `m.new_content`. If it omits the field, the original extras should survive like other MindRoom metadata.

## CollapsibleMessage interaction risk

Timeline messages are already wrapped by Cinny's long-message `CollapsibleMessage`. If extras live inside the existing render tree, their height contributes to overflow measurement.

Risks to validate live:

- Closed extras summaries might be hidden by the outer Show More overlay on long messages.
- Opening a `<details>` inside an outer collapsed message might reveal a gradient overlay or require also expanding the outer message.

Do not redesign the timeline preemptively. Validate with real content. If it is jarring, the likely follow-up is to teach `CollapsibleMessage` that an open descendant `<details>` should behave like an always-expanded message, or to render extras outside the outer long-message wrapper. That is a follow-up only if evidence shows the problem.

## Tests

Focused tests are required.

Parser tests:

- missing key returns `null`
- non-object value returns `null`
- wrong version returns `null`
- non-array sections returns `null`
- valid schema normalizes correctly
- `collapsed` defaults to true
- explicit `collapsed: false` starts open
- invalid sections are skipped while valid sections remain
- unknown content types are skipped
- oversized content is skipped
- section count is capped at 8
- title is trimmed and clamped

Renderer tests:

- renders one `<details>` per valid section
- default collapsed/open behavior uses `defaultOpen`
- `text/plain` renders literally in pre-wrapped text and does not parse HTML/markdown
- `text/markdown` renders markdown through sanitized output
- raw dangerous input does not execute or expand sanitizer scope
- titles render as text

Integration tests:

- normal text message still renders body unchanged
- text message with extras renders body and extras
- malformed extras do not affect body rendering
- long-text MindRoom path also gets extras
- tool approval and thread summary special renderers are not hijacked
- edit-preservation test for `com.mindroom.message_extras` when `m.new_content` omits the field

Validation commands expected from implementer:

- focused test files for parser/renderer/integration
- `npm run typecheck`
- `npm run build`
- broader `npm test` if practical under current Cinny baseline

## Live test plan

After implementation and review, create live evidence in lab Cinny.

Scenarios:

1. Send or inject a synthetic `m.room.message` with normal body plus two extras sections: one `text/plain` and one `text/markdown` containing a fenced code block.
2. Verify the normal body is visible immediately.
3. Verify section titles are visible and content is collapsed by default.
4. Expand sections and verify plain text and rendered markdown/code are visible.
5. Repeat or inspect in a thread message path.
6. Send malformed extras beside a normal body and verify the body still renders with no console errors.
7. If feasible, edit the message with `m.replace` and verify extras survive or update correctly.
8. Capture screenshots and console output in `/tmp/CINNY-089-evidence/`.

## Out of scope

- Sender-side composer support.
- Agent/backend API changes for emitting extras.
- More semantic block types.
- JSON-described UI widgets.
- `text/html` / arbitrary HTML.
- Sandbox iframes.
- Per-section persisted UI state.
- Settings toggles.
- Extras on media events.
- Search indexing of extras.
- Reply preview rendering of extras.

## Estimated scope

Expected production diff: roughly 180–300 LOC.

Expected tests: roughly 250–400 LOC.

No new runtime dependencies.

The implementation should stay small enough that reviewers can understand the whole feature from the parser, the renderer, and one integration point.