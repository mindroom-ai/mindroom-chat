# Native `ui` widgets: MindRoom Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development (five tasks; the trust and effective-content tasks are cheap to get subtly wrong and the chart is large, so each task gets its own review).

**Goal:** Stage 1: draw the chart an agent reply carries in `io.mindroom.ui`, in place between its paragraphs, while it streams and afterwards, and show readable fallback text for anything else. Stage 2 (form) is outlined at the end and built later.

**Architecture:** A protocol reader takes the entries from exactly the content that supplies the reply's shown body. The base HTML parser turns each `mindroom-ui-<id>` code block into a slot, and the slot draws a widget only inside a scope whose provider checks the event's sender against the current account itself. Validation and the chart are one lazy chunk. Live frames feed the same content key, so live and durable replies share the path.

**Tech Stack:** React 18, TypeScript (strict flags), vanilla-extract, folds, matrix-js-sdk, vitest, Playwright. No new dependency.

**Spec:** `docs/baspowers/specs/2026-11-18-genui-widgets-design.md` (sections 5, 7, 8, 9 and 11 are the contract; appendix A says why; read it first).

## Global Constraints

- Stage 1 draws `chart` only. An entry of any other `type` (a form from a Stage 2 backend) shows its fallback block; it is not an error.
- Keys: `io.mindroom.ui` (`UI_WIDGETS_KEY`), `io.mindroom.ui_response` (`UI_RESPONSE_KEY`, read by nothing in Stage 1 but already excluded from edit inheritance); marker class `language-mindroom-ui-<10 hex>`.
- Value shape `{version: 1, widgets: [{id, json}]}`. Another `version`, more than 8 entries, a repeated id, or more than 16,384 UTF-8 bytes over all `json` strings together means no widgets at all. Chat never computes an id.
- Trust is decided by the scope provider, at render: the event is not redacted and `isMindroomAgentUserIdForViewer(mEvent.getSender(), mx.getUserId())` holds. Never by a prop, by `isMindroomAgentMessageEvent`, by a display name, a marker or a label. `io.mindroom.ui` is also in `AGENT_ONLY_CONTENT_KEYS`.
- The value is read only from the content that supplies the shown body: the selected edit's own `m.new_content`, or the event's own content. `copyResolvedEditMetadata` must not copy `io.mindroom.ui` or `io.mindroom.ui_response` from older edits or from an edit's outer content.
- The validator checks the canonical wire text: spec section 8 bounds, code-point lengths (`[...text].length`), finite numbers, no booleans as numbers, unknown keys rejected, labels must be strings, optional keys absent (not `null`).
- A widget string is only ever rendered as React text: no `dangerouslySetInnerHTML`, no URL, `href`, `src` or SVG reference from a widget, no request caused by a widget string.
- Everything except the reader and the slot is reachable only through the lazy chunk; `just bundle-report` must stay inside `scripts/perf/bundle-budget.json`.
- Card frame: the question card's (`messages/question/QuestionCard.css.ts` `Card`: 12 px radius, `SurfaceVariant.ContainerLine` border, 60% `SurfaceVariant.Container` fill). Colors only from `theme/colors.css.ts` and folds tokens. Logical CSS sides only.
- Every visible string is translated: keys under `mindroomUi.messages.uiWidget` in all 17 `src/app/i18n/locales/additions/*.json`, added by the task that first uses them, in the same commit. Stage 1 keys: `chart`, `table`, `pointValue` (`{{label}}: {{series}} {{value}}`), `share` (`{{value}} ({{percent}})`).
- Fixtures are copied byte-identical from the backend worktree after its Tasks 1 to 3: `tests/ui_widgets/fixtures/ui-widgets-v1.json` to `src/app/messages/widgets/__fixtures__/`, and `tests/live_frames/fixtures/live-frames-v1.json` to `src/app/messages/live/__fixtures__/`; compare `sha256sum`.
- Commands run in `nix develop`: `just test <paths>`, `just typecheck`, `just strict`, `just lint`, `just format <paths>`.
- Placement per `docs/architecture.md`: tests beside their subject, no barrel files. No em dashes in docs, comments or commit messages. Commits unsigned, files added by path.
- Fixtures, tests and screenshots use invented placeholder data only.

## Review Focus

- An edit without the key (regenerated into prose, or dropped for size) after an edit with it: the widget must be gone. Today's metadata borrowing would bring it back (Task 1, with real `MatrixEvent` edits).
- A member who is not a MindRoom agent of the current account sends the marker block and a forged key, with a second signed-in account on another homeserver: a plain code block (Task 3).
- The original event is redacted while a readable edit or live frames are held: nothing is drawn (Task 3).
- A chart whose labels are `example.com`, with link previews on: no preview card and no `getUrlPreview` call (Task 3).
- Chart inputs that break naive scales: all values equal, all zero, negatives, one point, `1e308` beside `-1e308`, `5e-324`, 200 points at 390 px, a pie slice of 0 (Task 4).

---

### Task 1: Reader, effective content, live frame field

**Files:**
- Create: `src/app/matrix/protocol/uiWidgets.ts`, `src/app/matrix/protocol/uiWidgets.test.ts`
- Create: `src/app/messages/widgets/__fixtures__/ui-widgets-v1.json` (copy)
- Modify: `src/app/matrix/protocol/untrustedContent.ts` (`AGENT_ONLY_CONTENT_KEYS` and its comment), `src/app/matrix/protocol/untrustedContent.test.ts`
- Modify: `src/app/matrix/protocol/editMetadata.ts`, `src/app/matrix/protocol/editMetadata.test.ts`, `src/app/matrix/room.test.ts`
- Modify: `src/app/matrix/protocol/liveFrame.ts`, `src/app/matrix/protocol/liveFrame.test.ts`, `src/app/messages/live/__fixtures__/live-frames-v1.json` (copy), `src/app/messages/live/useLiveReplyContent.ts`, `src/app/messages/live/useLiveReplyContent.test.tsx`

**Interfaces:**
- Produces:
  - `UI_WIDGETS_KEY`, `UI_RESPONSE_KEY`
  - `type UiWidgetsContent = { widgets: { id: string; json: string }[] }`
  - `readUiWidgets(content: Record<string, unknown>): UiWidgetsContent | undefined`
  - `readUiMarkerId(codeClassName: string | undefined): string | undefined`
  - `stripUiFallbackBlocks(body: string): string` (the body without its `mindroom-ui-` fenced blocks)
  - `LiveDocs.ui?: unknown` and `LiveDelta.ui?: unknown` (a delta's `null` clears it)

- [ ] **Step 1: Copy both fixtures from the backend worktree and compare `sha256sum`.**
- [ ] **Step 2: Write the failing tests.**

```ts
it.each(fixture.renders.filter((c) => c.ui))('reads the fixture value: %s', ({ ui }) => {
  expect(readUiWidgets({ [UI_WIDGETS_KEY]: ui })?.widgets).toEqual(ui.widgets);
});
it('rejects what the backend never sends', () => {
  const entry = { id: 'df4d729a5d', json: '{}' };
  const big = { id: 'aaaaaaaaaa', json: 'x'.repeat(9000) };
  const bad = [
    { version: 2, widgets: [entry] },
    { version: 1, widgets: Array.from({ length: 9 }, (_, i) => ({ ...entry, id: `${i}`.repeat(10) })) },
    { version: 1, widgets: [entry, entry] },
    { version: 1, widgets: [{ ...entry, id: 'DF4D729A5D' }] },
    { version: 1, widgets: [big, { ...big, id: 'bbbbbbbbbb' }] },
    { version: 1, widgets: [{ id: 'df4d729a5d', json: {} }] },
    { version: 1, widgets: [] },
  ];
  bad.forEach((value) => expect(readUiWidgets({ [UI_WIDGETS_KEY]: value })).toBeUndefined());
});
it('reads the marker id only from the exact class', () => {
  expect(readUiMarkerId('language-mindroom-ui-df4d729a5d')).toBe('df4d729a5d');
  expect(readUiMarkerId('language-mindroom-ui-df4d729a5d extra')).toBeUndefined();
  expect(readUiMarkerId('language-ui')).toBeUndefined();
});
```

  Effective content, in `room.test.ts`, with real `MatrixEvent`s through `getEditedEvent` and `getLatestMessageContent`:
  - an original with the key, a newer readable edit whose `m.new_content` has the same marker block and no key: the shown content has no key;
  - two edits, the older with the key and the newer without: no key;
  - an edit carrying the key only at its outer level: no key;
  - an edit with the key in `m.new_content`: that value;
  - a newer edit by another sender with a key: ignored, the sender's own revision stands;
  - a newer edit that is not decrypted yet: the last readable revision's value as a whole; once it decrypts without a key: none;
  - the newest edit redacted: the previous revision's own value.
  And: `copyResolvedEditMetadata` skips both keys from every source; `sanitizeContent` drops `io.mindroom.ui` from a sender who is not an agent; `stripUiFallbackBlocks` removes the 5.4 block and keeps the two paragraphs, and leaves a `python` block alone; the three new live-frame fixture cases apply (`applyLiveDelta` sets and clears `ui`; a snapshot keeps it); `getLiveContent` writes `docs.ui` to `io.mindroom.ui` and removes a durable one when the frame has none; a terminal durable status drops a stale frame's `ui` with the frame (`getLiveVerdict`).
- [ ] **Step 3: Run `just test src/app/matrix src/app/messages/live`.** Expected: FAIL.
- [ ] **Step 4: Implement.** `editMetadata.ts` skips the two keys beside `LONG_TEXT_KEY`. In `liveFrame.ts` a snapshot keeps `ui` when present and a delta with the `ui` key replaces it (`null` becomes absent); a delta holding only `ui` is a valid delta. `getLiveContent` always deletes `UI_WIDGETS_KEY` from the copied content, then sets it from `docs.ui`.
- [ ] **Step 5: Run again, then `just typecheck` and `just lint`.** Expected: PASS.
- [ ] **Step 6: Commit** (`feat(widgets): read io.mindroom.ui from the shown revision and live frames`).

### Task 2: Chart validator

**Files:**
- Create: `src/app/messages/widgets/chartSchema.ts`, `src/app/messages/widgets/chartSchema.test.ts`

**Interfaces:**
- Produces:
  - `type ChartWidget = { type: 'chart'; kind: 'bar' | 'line' | 'area' | 'pie'; title: string; labels: string[]; series: { name: string; data: number[] }[]; x?: string; y?: string }`
  - `parseChartWidget(json: string): ChartWidget | undefined` (never throws; undefined for any other `type`)

- [ ] **Step 1: Write the failing test.**

```ts
const stage1 = fixture.widgets.filter((c) => c.stage === 1);
it.each(stage1.filter((c) => c.valid).map((c) => [c.name, c] as const))('accepts the wire text: %s', (_n, c) => {
  const chart = parseChartWidget(c.canonical);
  expect(chart?.labels.every((label) => typeof label === 'string')).toBe(true);
  expect(chart?.series.every((s) => s.data.every(Number.isFinite))).toBe(true);
});
it.each(stage1.filter((c) => !c.valid).map((c) => [c.name, c] as const))('rejects: %s', (_n, c) => {
  expect(parseChartWidget(c.json)).toBeUndefined();
});
it.each(fixture.wire_invalid)('rejects what only the wire could carry: %s', (json) => {
  expect(parseChartWidget(json)).toBeUndefined();
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** by hand (no schema library): byte limit first, `JSON.parse` in a try, then one reader that copies only known keys and returns undefined on any unknown key, wrong type, bound or cross-field rule (one value per label, unique series names, the pie rules).
- [ ] **Step 4: Run, typecheck, lint.** Expected: PASS for every fixture case.
- [ ] **Step 5: Commit** (`feat(widgets): strict chart validator`).

### Task 3: Scope, slot, parser hook, link previews

**Files:**
- Create: `src/app/messages/widgets/UiWidgetSlot.tsx`, `src/app/messages/widgets/UiWidgetSlot.test.tsx`, `src/app/messages/widgets/UiWidget.tsx` (the lazy chunk's root; renders the chart's title until Task 4)
- Modify: `src/app/messages/html/react-custom-html-parser.tsx` (the `pre` case), `src/app/rich-text/code/codeBlockLanguage.ts` (`getCodeBlockLanguage` returns undefined for a `mindroom-ui-` class), `src/app/messages/content/renderAgentMessageContent.tsx` (`wrapAgentBody`), `src/app/messages/content/MsgTypeRenderers.tsx` (the `getBodyUrls` input)
- Test: `src/app/messages/content/renderAgentMessageContent.widgets.test.tsx` (also the frame binder cases, through `LiveReplyMessageContent`), `src/app/messages/content/MsgTypeRenderers.text.test.ts`, `src/app/messages/live/liveMarkdown.test.ts`, `src/app/rich-text/code/codeBlockLanguage.test.ts`

**Interfaces:**
- Consumes: `readUiWidgets`, `readUiMarkerId`, `stripUiFallbackBlocks`, `parseChartWidget`.
- Produces:
  - `UiWidgetsScope({ mEvent, content, children })`: the provider. It provides entries (`ReadonlyMap<string, string>`) only when `mEvent` is not redacted, its sender is a MindRoom agent for `useOptionalMatrixClient()?.getUserId()` (agent content also renders outside a client provider, as in fixtures, where it draws nothing), and `readUiWidgets(content)` gives a value.
  - `UiWidgetSlot({ id, fallback }: { id: string; fallback: ReactNode })`
  - `UiWidget` default export of `UiWidget.tsx` with props `{ json: string; fallback: ReactNode }`; it renders `fallback` when `parseChartWidget` fails.

- [ ] **Step 1: Write the failing tests** (jsdom), rendering the fixture's 5.4 content through `renderAgentMessageContent` with a real `MatrixEvent` and a mocked client whose `getUserId()` is `@viewer:example.org`:
  - sender `@mindroom_atlas:example.org`: the chart's title shows and no `<pre>` holds the table;
  - sender `@alice:example.org`, and sender `@mindroom_atlas:other.org`, each also with `fromMindroomAgent: true` forced and with `trustAgentsOfViewer('@second:other.org')` registered: a code block with the table text, no widget;
  - a client with no user id: the code block;
  - a redacted original with the same content passed in: the code block is not replaced by a widget;
  - agent content whose value lacks the marker's id: the code block, whose header shows no language label;
  - the Stage 2 fixture case (a form entry): the code block with the form's fallback text;
  - an entry whose `json` is `{"type":"map"}`: the code block;
  - through the real frame binder: a frame from another local agent for this reply, and a frame in the wrong room, add no widget; a frame from the reply's sender with `ui` draws it before any durable edit, and a later delta `ui: null` returns the code block;
  - the sanitized parser and `renderLiveMarkdown` on the fixture's 5.4 `text` each yield one `code.language-mindroom-ui-df4d729a5d` whose text is the table;
  - `MsgTypeRenderers`: with `renderUrlsPreview` given, a body whose chart labels are `example.com` and whose prose has `https://example.org/a` asks for previews of `https://example.org/a` only, and still so when the content has no `io.mindroom.ui`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `pre` case: `const id = readUiMarkerId(<the code child's class>)`; with an id, return `<UiWidgetSlot id={id} fallback={<CodeBlock .../>} />`, else the code block as today. The slot renders `fallback` without a scope or an entry, else `<Suspense fallback={fallback}>` around the lazy `UiWidget`. `wrapAgentBody` wraps its result in `UiWidgetsScope` whenever it has an `mEvent`. `MsgTypeRenderers` passes `stripUiFallbackBlocks(trimmedBody)` to `getBodyUrls`.
- [ ] **Step 4: Run the tests plus `src/app/messages/html` and `src/app/messages/content`.** Expected: PASS, and `HtmlBlocks.parserOptionsIdentity.test.ts` still passes.
- [ ] **Step 5: Commit** (`feat(widgets): draw a widget in place of its marker block`).

### Task 4: Chart

**Files:**
- Create: `src/app/messages/widgets/chartGeometry.ts`, `src/app/messages/widgets/chartGeometry.test.ts`
- Create: `src/app/messages/widgets/UiChart.tsx`, `src/app/messages/widgets/UiChart.css.ts`, `src/app/messages/widgets/UiChart.test.tsx`
- Modify: `src/app/messages/widgets/UiWidget.tsx`, the 17 `src/app/i18n/locales/additions/*.json`

**Interfaces:**
- Consumes: `ChartWidget`.
- Produces:
  - `valueDomain(kind: ChartWidget['kind'], series: number[][]): [number, number] | undefined` (undefined when the span is not finite or cannot be widened)
  - `niceTicks(min: number, max: number, target?: number): number[]` (ascending, first <= min, last >= max, at most 12; the step is the smallest of 1, 2, 5 or 10 times a power of ten that is at least `(max - min) / target`; `target` defaults to 4; every tick is `start + i * step`, never a running sum)
  - `pieSlices(data: number[]): { start: number; end: number; share: number }[] | undefined` (radians from 0 to 2π; undefined when the sum is not finite)
  - `labelStep(count: number, plotWidth: number, minGap?: number): number` (show every nth x label; `minGap` defaults to 48)
  - `UiChart({ chart }: { chart: ChartWidget })`

- [ ] **Step 1: Write the failing geometry tests.**

```ts
expect(valueDomain('bar', [[120, 180.5]])).toEqual([0, 180.5]);
expect(valueDomain('line', [[120, 180.5]])).toEqual([120, 180.5]);
expect(valueDomain('line', [[7, 7]])).toEqual([6, 8]);
expect(valueDomain('bar', [[0, 0]])).toEqual([0, 1]);
expect(valueDomain('area', [[-5, 10]])).toEqual([-5, 10]);
expect(valueDomain('line', [[1e308, -1e308]])).toBeUndefined();
expect(valueDomain('line', [[1e300, 1e300]])).toBeUndefined();
expect(niceTicks(0, 180.5)).toEqual([0, 50, 100, 150, 200]);
expect(niceTicks(-30, 70)).toEqual([-50, 0, 50, 100]);
expect(niceTicks(0, 7)).toEqual([0, 2, 4, 6, 8]);
expect(niceTicks(0, 5e-324).length).toBeLessThanOrEqual(12);
expect(niceTicks(0, 1.5e300).every(Number.isFinite)).toBe(true);
expect(pieSlices([1, 0, 3])!.map((s) => s.share)).toEqual([0.25, 0, 0.75]);
expect(pieSlices([1, 0, 3])![2]!.end).toBeCloseTo(2 * Math.PI);
expect(pieSlices([1e308, 1e308])).toBeUndefined();
expect(labelStep(6, 600)).toBe(1);
expect(labelStep(200, 300)).toBe(34);
```

- [ ] **Step 2: Write the failing component tests** (jsdom, the 5.4 chart): the title and the `y` subtitle show; two toggle buttons with `aria-pressed`; Table shows a `<table>` with one `th[scope="row"]` per label and `180.5` formatted for the locale; back to Chart shows an `svg[dir="ltr"]`; the plot has `tabIndex=0`, and ArrowRight then moves the announced point from `Jan` to `Feb` in an `aria-live="polite"` region; End jumps to `Mar`; a pie shows a legend row per label with its percent; a 200-point line chart renders at width 390; a chart of `[1e308, -1e308]` shows the table and no `svg`; a title of `<img src=x onerror=1>` and a label of `https://example.com` appear as text, with no `img`, `a` or `image` element in the card.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.** Measure the card's width with `lib/hooks/useResizeObserver`; bars are grouped per label; line and area draw one path per series; the pie is a donut. Eight series colors as CSS variables in `UiChart.css.ts`, taken from theme tokens, used by the plot, the legend and the tooltip. The toggle shows icons only under 420 px. The frame is one style (variant B). Parse once per `json` with `useMemo`.
- [ ] **Step 5: Run, typecheck, strict, lint.** Expected: PASS.
- [ ] **Step 6: Commit** (`feat(widgets): chart card with table view`).

### Task 5: Docs, bundle budget, stub scenario, e2e

**Files:**
- Modify: `docs/architecture.md` ("MindRoom event formats": a row for `io.mindroom.ui`; the `messages/` folder list gains `widgets/`)
- Modify: `scripts/agent-stack/stub_model.py` (`#chart`: a sentence, the 5.4 `ui` block, a sentence; in `TEXT_SCENARIOS` and the header list), `scripts/agent-stack/stack.py` (`ui_widgets: true` on the helper when the backend checkout's `src/mindroom/config/agent.py` knows the field)
- Create: `e2e/messages/agent-ui-widgets.spec.ts`

- [ ] **Step 1: Add the docs row**: one sentence on the shape, one on the trust rule (a `mindroom_` account on the viewer's homeserver, so the namespace must be reserved), pointing at the backend's `docs/widgets.md`.
- [ ] **Step 2: Write the spec** with the agent-stack fixtures of `e2e/helpers/agentStack.ts`. One lifecycle: send `#chart`; the finished reply shows a figure titled `Signups` between its two sentences and no code block; Table shows 3 rows; after a reload the figure is there again; at 390 px wide the card fits the row without horizontal scroll. When the backend checkout has no `ui_widgets` the spec skips with a message naming the checkout; that run is not evidence.
- [ ] **Step 3: Run it on a slot** as the other `agent-*.spec.ts` specs run, with `E2E_MINDROOM_CHECKOUT` set to the backend worktree. Expected: PASS, not skipped. Record the backend commit in the pull request.
- [ ] **Step 4: Run `just build` and `just bundle-report`.** Expected: inside the budget, with the chart in a chunk of its own that a first visit does not download.
- [ ] **Step 5: Run `just check`, then take the pull request's screenshots** at the head commit: bar, line and pie, the table view, desktop and 390 px, one light and one dark.
- [ ] **Step 6: Commit** (`test(widgets): agent chart e2e; docs`).

The fresh live test (spec section 11, L1 to L12) is the backend plan's Task 8, a release gate for both pull requests.

## Stage 1 estimated size

| Part | Source | Tests, fixtures, translations, docs |
|---|---|---|
| Task 1 reader, effective content, live field | 85 | 230 + fixture copies |
| Task 2 chart validator | 95 | 35 |
| Task 3 scope, slot, hook, previews | 120 | 240 |
| Task 4 chart | 480 (170 styles) | 220 + translations 70 |
| Task 5 docs, stub, e2e | 30 | 110 |
| **Total** | **about 810** | **about 905** |

## Stage 2 (form): later, its own pull request

Not built now; written here so Stage 1 leaves room for it. No wire change; requirements are spec 5.6 and 7.4.

- **Validator:** `parseFormWidget(json)` for the canonical wire text, with the negated secret filter, dates by arithmetic from year 0001 (not `Date`), and the Stage 2 fixture cases; `UiWidget.tsx` picks chart or form by `type`.
- **Form card:** native controls, one column under 420 px, the app-owned line under Submit, a required multiple choice needing one box, the slider showing the value the control holds, text capped at 500 characters.
- **Scope:** the provider gains what the form needs, derived on every render with no hand-written memo: room, original event id, `threadId ?? mEvent.threadRootId`, the event's sender, `readOnly`, and the reply's status (Submit only when absent or `completed`).
- **Answer:** `buildUiResponseContent` per spec 5.6: every interpolation escaped with `rich-text/sanitize.ts` `sanitizeText`, the mention from the event's sender with a bounded name, non-safe-integer numbers as strings; measured as built, sent without `formatted_body` when over the limit, refused with the draft kept when still over. Pinned by the fixture's `responses` case plus boundary cases (500 double quotes in each of 12 answers).
- **Send:** as `CanvasPanel`'s `deliver`: one transaction id, the conditions checked again at the click, a second click ignored, offered only when the timeline shown reaches its live end.
- **Drafts:** in memory, keyed by account, room, event and widget id; cleared on sign-out and on a sent answer; kept on failure.
- **Answered plan:** `planUiResponses(events, viewerId, roomId)` keyed by event and widget id: the current user's readable, unredacted `m.text` that replies to the form's event and whose own content names it; values revalidated against the form; echo states sending, failed or cancelled, acknowledged; recomputed on local echo updates, decryption, redaction and pagination, in room and thread views.
- **Receipt:** a `<details>` row from the disclosure styles of `approvals/ThreadApprovals.css.ts`.
- **Tests:** failed and cancelled echo, echo reconciliation, an answer for another widget, an answer outside the loaded window, redaction, an edited answer, account switch with the same form, read-only and finished transitions with identical JSON, previews and icons on with URLs in labels and answers, and a `#form` e2e with a second session.
- **Estimate:** about 950 source (220 styles), about 900 tests, translations and e2e.
