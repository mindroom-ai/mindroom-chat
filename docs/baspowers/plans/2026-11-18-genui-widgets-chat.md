# Native `ui` widgets: MindRoom Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development (eight tasks; the trust and wire-format tasks are cheap to get subtly wrong and the chart and form are large, so each task gets its own review).

**Goal:** Draw the chart and form widgets an agent reply carries in `io.mindroom.ui`, in place between its paragraphs, while it streams and afterwards, and send a form's answer as an ordinary thread message.

**Architecture:** A protocol reader takes the entries from the reply's shown content; the base HTML parser turns each `mindroom-ui-<id>` code block into a slot, and the slot draws the widget only inside a context that `renderAgentMessageContent` provides for MindRoom agents. Validation, chart and form are one lazy chunk. Live frames feed the same content key, so live and durable replies share the path. Answered state is a per-timeline plan over the loaded events.

**Tech Stack:** React 18, TypeScript (strict flags), vanilla-extract, folds, matrix-js-sdk, vitest, Playwright. No new dependency.

**Spec:** `docs/baspowers/specs/2026-11-18-genui-widgets-design.md` (sections 5, 7, 8 and 10 are the contract; read it first).

## Global Constraints

- Keys: `io.mindroom.ui` (`UI_WIDGETS_KEY`), `io.mindroom.ui_response` (`UI_RESPONSE_KEY`); marker class `language-mindroom-ui-<10 hex>`.
- Value shape `{version: 1, widgets: [{id, json}], pending?}`; more than 8 entries, a `json` over 16,384 UTF-8 bytes, or another `version` means no widgets at all.
- Widgets render only inside `UiWidgetsContext`, which only `renderAgentMessageContent` provides, only when `fromMindroomAgent`; `io.mindroom.ui` is in `AGENT_ONLY_CONTENT_KEYS`.
- The key is read from the content the reply shows; never from `getOriginalContent()` of an edited reply, and it is not added to the metadata borrowed from older edits.
- Schema bounds are the spec's section 8; string lengths count code points (`[...text].length`), numbers must be finite, booleans are not numbers, unknown keys are rejected.
- A widget string is only ever rendered as React text; no `dangerouslySetInnerHTML`, no URL from a widget.
- Everything except the reader, the slot and the skeleton is reachable only through the lazy chunk; `just bundle-report` must stay inside `scripts/perf/bundle-budget.json`.
- Card frame: the question card's (`messages/question/QuestionCard.css.ts` `Card`: 12 px radius, `SurfaceVariant.ContainerLine` border, 60% `SurfaceVariant.Container` fill). Colors only from `theme/colors.css.ts` and folds tokens. Logical CSS sides only.
- Every visible string is translated: keys under `mindroomUi.messages.uiWidget` in all 17 `src/app/i18n/locales/additions/*.json`, added by the task that first uses them, in the same commit. Keys: `chart`, `table`, `receivingChart`, `receivingForm`, `receivingWidget`, `pointValue` (`{{label}}: {{series}} {{value}}`), `share` (`{{value}} ({{percent}})`), `send`, `sendFailed`, `waitForReply`, `required`, `yes`, `no`, `none`, `answered`.
- The fixture `src/app/messages/widgets/__fixtures__/ui-widgets-v1.json` is copied byte-identical from the backend worktree (`tests/ui_widgets/fixtures/ui-widgets-v1.json`); the backend plan's Tasks 1 and 2 must be done first. Same rule for `live-frames-v1.json`.
- Commands run in `nix develop`: `just test <paths>`, `just typecheck`, `just strict`, `just lint`, `just format <paths>`.
- Placement per `docs/architecture.md`: tests beside their subject, no barrel files. No em dashes in docs, comments or commit messages. Commits unsigned, files added by path.
- Fixtures, tests and screenshots use invented placeholder data only.

## Review Focus

- A member who is not a MindRoom agent sends the marker block and a forged `io.mindroom.ui`: a plain code block, nothing to click (Task 3).
- A later edit of the reply without the key (regenerated into prose, or dropped for size): the widget is gone, not revived from the original or an older edit (Task 3).
- A form row scrolled out of the virtual timeline and back keeps its draft; after a reload the receipt comes from the timeline alone (Tasks 5 and 6).
- Chart inputs that break naive scales: all values equal, all zero, negatives, one point, 200 points at 390 px, a pie slice of 0 (Task 4).
- A slider answer of 2.5 in an unencrypted room: `values` holds `"2.5"`, never a float (Task 5).
- A label of 120 emoji validates; 121 does not (Task 2).

---

### Task 1: Protocol reader, trust key, fixture, live frame field

**Files:**
- Create: `src/app/matrix/protocol/uiWidgets.ts`, `src/app/matrix/protocol/uiWidgets.test.ts`
- Create: `src/app/messages/widgets/__fixtures__/ui-widgets-v1.json` (copy)
- Modify: `src/app/matrix/protocol/untrustedContent.ts` (`AGENT_ONLY_CONTENT_KEYS` and its comment), `src/app/matrix/protocol/untrustedContent.test.ts`
- Modify: `src/app/matrix/protocol/liveFrame.ts`, `src/app/messages/live/__fixtures__/live-frames-v1.json` (copy), `src/app/messages/live/useLiveReplyContent.ts`, `src/app/messages/live/useLiveReplyContent.test.tsx`

**Interfaces:**
- Produces:
  - `UI_WIDGETS_KEY`, `UI_RESPONSE_KEY`
  - `type UiPendingKind = 'chart' | 'form' | 'widget'`
  - `type UiWidgetsContent = { widgets: { id: string; json: string }[]; pending?: UiPendingKind }`
  - `readUiWidgets(content: Record<string, unknown>): UiWidgetsContent | undefined`
  - `readUiMarkerId(codeClassName: string | undefined): string | undefined`
  - `type UiResponse = { eventId: string; widget: string; values: Record<string, unknown> }`, `readUiResponse(content: Record<string, unknown>): UiResponse | undefined`
  - `LiveDocs.ui?: unknown` and `LiveDelta.ui?: unknown` (a delta's `null` clears it)

- [ ] **Step 1: Copy both fixtures from the backend worktree and compare `sha256sum`.**
- [ ] **Step 2: Write the failing tests.**

```ts
it.each(fixture.renders.filter((c) => c.ui))('reads the fixture value: %s', ({ ui, html }) => {
  const read = readUiWidgets({ [UI_WIDGETS_KEY]: ui });
  expect(read?.widgets).toEqual(ui.widgets);
  expect(read?.pending).toBe(ui.pending);
  read?.widgets.forEach(({ id }) => expect(html).toContain(`class="language-mindroom-ui-${id}"`));
});
it('rejects what the backend never sends', () => {
  const entry = { id: 'df4d729a5d', json: '{}' };
  const bad = [
    { version: 2, widgets: [entry] },
    { version: 1, widgets: Array.from({ length: 9 }, (_, i) => ({ ...entry, id: `${i}`.repeat(10) })) },
    { version: 1, widgets: [{ ...entry, id: 'DF4D729A5D' }] },
    { version: 1, widgets: [{ ...entry, json: 'x'.repeat(16385) }] },
    { version: 1, widgets: [entry], pending: 'map' },
    { version: 1, widgets: [{ id: 'df4d729a5d', json: {} }] },
  ];
  bad.forEach((value) => expect(readUiWidgets({ [UI_WIDGETS_KEY]: value })).toBeUndefined());
});
it('reads the marker id only from the exact class', () => {
  expect(readUiMarkerId('language-mindroom-ui-df4d729a5d')).toBe('df4d729a5d');
  expect(readUiMarkerId('language-mindroom-ui-df4d729a5d extra')).toBeUndefined();
  expect(readUiMarkerId('language-ui')).toBeUndefined();
});
```

  Plus: a repeated `id` keeps the first entry; `readUiResponse` reads the fixture's `responses[0].content` and rejects a missing `event_id`, a non-object `values` and `version: 2`; `sanitizeContent` drops `io.mindroom.ui` from a sender who is not an agent and keeps `io.mindroom.ui_response` from anyone; the new live-frame fixture cases apply (`applyLiveDelta` sets and clears `ui`); `getLiveContent` writes `docs.ui` to `io.mindroom.ui` and removes a durable one when the frame has none.
- [ ] **Step 3: Run `just test src/app/matrix/protocol src/app/messages/live`.** Expected: FAIL (module missing).
- [ ] **Step 4: Implement.** In `liveFrame.ts` a snapshot keeps `ui` when present, a delta with the `ui` key replaces it (`null` becomes absent). `getLiveContent` always deletes `UI_WIDGETS_KEY` from the copied content, then sets it from `docs.ui`.
- [ ] **Step 5: Run again, then `just typecheck` and `just lint`.** Expected: PASS.
- [ ] **Step 6: Commit** (`feat(widgets): read io.mindroom.ui from replies and live frames`).

### Task 2: Strict validator

**Files:**
- Create: `src/app/messages/widgets/uiWidgetSchema.ts`, `src/app/messages/widgets/uiWidgetSchema.test.ts`

**Interfaces:**
- Produces:
  - `type ChartWidget = { type: 'chart'; kind: 'bar' | 'line' | 'area' | 'pie'; title: string; labels: string[]; series: { name: string; data: number[] }[]; x?: string; y?: string }`
  - `type FormField` = a union on `kind` with the keys of spec section 4 (`name`, `label`, `required?`, and per kind `options`, `value`, `min`, `max`, `step`, `unit`, `placeholder`)
  - `type FormWidget = { type: 'form'; title: string; fields: FormField[]; submit?: string }`, `type WidgetSpec = ChartWidget | FormWidget`
  - `parseUiWidget(json: string): WidgetSpec | undefined` (never throws)

- [ ] **Step 1: Write the failing test.**

```ts
it.each(fixture.widgets.map((c) => [c.name, c] as const))('agrees with the backend: %s', (_n, c) => {
  expect(parseUiWidget(c.json) !== undefined).toBe(c.valid);
  if (c.valid) expect(parseUiWidget(c.canonical)).toEqual(parseUiWidget(c.json));
});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** by hand (no schema library): byte limit first, `JSON.parse` in a try, then one reader per shape that copies only known keys and returns undefined on any unknown key, wrong type, bound or cross-field rule. Numeric labels become strings. A date must match `^\d{4}-\d{2}-\d{2}$` and survive a UTC round trip. The secret pattern is the spec's, applied to the label and to the name with `_` read as a space.
- [ ] **Step 4: Run, typecheck, lint.** Expected: PASS for every fixture case.
- [ ] **Step 5: Commit** (`feat(widgets): strict chart and form validator`).

### Task 3: Slot, context, skeleton and the parser hook

**Files:**
- Create: `src/app/messages/widgets/UiWidgetSlot.tsx`, `src/app/messages/widgets/UiWidgetSlot.css.ts`, `src/app/messages/widgets/UiWidgetSlot.test.tsx`, `src/app/messages/widgets/UiWidget.tsx` (the lazy chunk's root; a stub that renders the widget's title until Tasks 4 and 5)
- Modify: `src/app/messages/html/react-custom-html-parser.tsx` (the `pre` case), `src/app/rich-text/code/codeBlockLanguage.ts` (`getCodeBlockLanguage` returns undefined for a `mindroom-ui-` class), `src/app/messages/content/renderAgentMessageContent.tsx` (`wrapAgentBody`)
- Test: `src/app/messages/content/renderAgentMessageContent.widgets.test.tsx`, `src/app/messages/live/liveMarkdown.test.ts` (one case)

**Interfaces:**
- Consumes: `readUiWidgets`, `readUiMarkerId`, `UiPendingKind`, `parseUiWidget`.
- Produces:
  - `type UiWidgetsScope = { entries: ReadonlyMap<string, string>; eventId: string | undefined; roomId: string | undefined; threadId: string | undefined; agentUserId: string; finished: boolean; readOnly: boolean }`
  - `UiWidgetsContext` (default `undefined`)
  - `UiWidgetSlot({ id, fallback }: { id: string; fallback: ReactNode })`
  - `UiWidgetSkeleton({ kind }: { kind: UiPendingKind })`: 325 px high, `role="status"`, translated label
  - `UiWidget` default export of `UiWidget.tsx` with props `{ id: string; json: string; scope: UiWidgetsScope; fallback: ReactNode }`; it renders `fallback` when `parseUiWidget` fails

- [ ] **Step 1: Write the failing tests** (jsdom), rendering the fixture's 5.4 content through `renderAgentMessageContent`:
  - from a MindRoom agent: the widget's title shows and no `<pre>` holds the table;
  - the same content with `fromMindroomAgent: false`: a code block with the table text, no widget;
  - agent content whose `io.mindroom.ui` lacks the id: the code block, whose header shows no language label;
  - an edited reply whose shown content has no key while `getOriginalContent()` has one: the code block;
  - an entry whose `json` is `{"type":"map"}`: the code block;
  - a streaming reply with `pending: 'chart'`: one `role="status"` skeleton after the body; the same content with `io.mindroom.stream_status: 'completed'`: none;
  - `renderLiveMarkdown` on the fixture's 5.4 `text` equals its `html`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `pre` case: `const id = readUiMarkerId(<the code child's class>)`; with an id, return `<UiWidgetSlot id={id} fallback={<CodeBlock .../>} />`, else the code block as today. The slot renders `fallback` without a scope or an entry, else `<Suspense fallback={<UiWidgetSkeleton .../>}>` around the lazy `UiWidget`. `wrapAgentBody` wraps its result in the provider when `fromMindroomAgent` and `readUiWidgets(bodyContent)` gives a value, with `finished` = the content's stream status is not `pending` or `streaming`, and appends the skeleton while `pending` is set and not `finished`. Memoize the scope on the entries' ids and JSON, so a streamed edit of another reply redraws nothing.
- [ ] **Step 4: Run the tests plus `src/app/messages/html` and `src/app/messages/content`.** Expected: PASS, and `HtmlBlocks.parserOptionsIdentity.test.ts` still passes.
- [ ] **Step 5: Commit** (`feat(widgets): draw a widget in place of its marker block`).

### Task 4: Chart

**Files:**
- Create: `src/app/messages/widgets/chartGeometry.ts`, `src/app/messages/widgets/chartGeometry.test.ts`
- Create: `src/app/messages/widgets/UiChart.tsx`, `src/app/messages/widgets/UiChart.css.ts`, `src/app/messages/widgets/UiChart.test.tsx`
- Modify: `src/app/messages/widgets/UiWidget.tsx`

**Interfaces:**
- Consumes: `ChartWidget`.
- Produces:
  - `valueDomain(kind: ChartWidget['kind'], series: number[][]): [number, number]`
  - `niceTicks(min: number, max: number, target?: number): number[]` (ascending, first <= min, last >= max; the step is the smallest of 1, 2, 5 or 10 times a power of ten that is at least `(max - min) / target`; `target` defaults to 4)
  - `pieSlices(data: number[]): { start: number; end: number; share: number }[]` (radians from 0 to 2π)
  - `labelStep(count: number, plotWidth: number, minGap?: number): number` (show every nth x label; `minGap` defaults to 48)
  - `UiChart({ chart }: { chart: ChartWidget })`

- [ ] **Step 1: Write the failing geometry tests.**

```ts
expect(valueDomain('bar', [[120, 180.5]])).toEqual([0, 180.5]);
expect(valueDomain('line', [[120, 180.5]])).toEqual([120, 180.5]);
expect(valueDomain('line', [[7, 7]])).toEqual([6, 8]);
expect(valueDomain('bar', [[0, 0]])).toEqual([0, 1]);
expect(valueDomain('area', [[-5, 10]])).toEqual([-5, 10]);
expect(niceTicks(0, 180.5)).toEqual([0, 50, 100, 150, 200]);
expect(niceTicks(-30, 70)).toEqual([-50, 0, 50, 100]);
expect(niceTicks(0, 7)).toEqual([0, 2, 4, 6, 8]);
expect(pieSlices([1, 0, 3]).map((s) => s.share)).toEqual([0.25, 0, 0.75]);
expect(pieSlices([1, 0, 3])[2]!.end).toBeCloseTo(2 * Math.PI);
expect(labelStep(6, 600)).toBe(1);
expect(labelStep(200, 300)).toBe(34);
```

- [ ] **Step 2: Write the failing component tests** (jsdom, the 5.4 chart): the title and the `y` subtitle show; two toggle buttons with `aria-pressed`; Table shows a `<table>` with one `th[scope="row"]` per label and `180.5` formatted for the locale; back to Chart shows an `svg[dir="ltr"]`; the plot has `tabIndex=0`, and ArrowRight then moves the announced point from `Jan` to `Feb` in a `aria-live="polite"` region; End jumps to `Mar`; a pie shows a legend row per label with its percent; a 200-point line chart renders without throwing at width 390.
- [ ] **Step 3: Run.** Expected: FAIL.
- [ ] **Step 4: Implement.** Measure the card's width with the app's existing element-size hook; bars are grouped per label; line and area draw one path per series; the pie is a donut. Eight series colors as CSS variables in `UiChart.css.ts`, taken from theme tokens, used by the plot, the legend and the tooltip. The toggle shows icons only under 420 px. Variant B frame; the frame is one style so A or C is a change to it alone.
- [ ] **Step 5: Run, typecheck, strict, lint.** Expected: PASS.
- [ ] **Step 6: Commit** (`feat(widgets): chart card with table view`).

### Task 5: Form, drafts and the answer message

**Files:**
- Create: `src/app/messages/widgets/uiResponse.ts`, `src/app/messages/widgets/uiResponse.test.ts`
- Create: `src/app/messages/widgets/uiFormDrafts.ts`, `src/app/messages/widgets/uiFormDrafts.test.ts`
- Create: `src/app/messages/widgets/UiForm.tsx`, `src/app/messages/widgets/UiForm.css.ts`, `src/app/messages/widgets/UiForm.test.tsx`
- Modify: `src/app/messages/widgets/UiWidget.tsx`

**Interfaces:**
- Consumes: `FormWidget`, `UiWidgetsScope`, `UI_RESPONSE_KEY`, `getMessageRelation` (`matrix/send/composeMessageRelation.ts`).
- Produces:
  - `type FormAnswers = Record<string, string | boolean | string[] | number>`
  - `initialAnswers(form: FormWidget): FormAnswers` (box `false`, multiple choice `[]`, slider `value ?? min`, text `''`; a choice or date only when the widget gives a `value`)
  - `answerValues(form: FormWidget, answers: FormAnswers): Record<string, string | boolean | string[] | number>` (the wire `values` of spec 5.6)
  - `answerLines(form: FormWidget, values: Record<string, unknown>): [label: string, value: string][]` (skips a value that does not fit its field)
  - `type UiResponseTarget = { eventId: string; widgetId: string; threadId?: string; agentUserId: string; agentName: string }`
  - `buildUiResponseContent(target: UiResponseTarget, form: FormWidget, answers: FormAnswers): Record<string, unknown>`
  - `readFormDraft(key: string): FormAnswers | undefined`, `writeFormDraft(key: string, answers: FormAnswers): void`, `clearFormDraft(key: string): void` (in memory, the 50 most recently written keys)
  - `UiForm({ id, form, scope }: { id: string; form: FormWidget; scope: UiWidgetsScope })`

- [ ] **Step 1: Write the failing tests.**

```ts
it('builds the spec answer event', () => {
  const [c] = fixture.responses;
  const form = parseUiWidget(c.form) as FormWidget;
  const target = { eventId: c.event_id, widgetId: c.content[UI_RESPONSE_KEY].widget, threadId: c.thread_id, agentUserId: c.agent_user_id, agentName: c.agent_name };
  expect(buildUiResponseContent(target, form, { ...initialAnswers(form), ...c.answers })).toEqual(c.content);
});
it('never writes a float', () => {
  expect(answerValues(sliderForm, { amount: 2.5 })).toEqual({ amount: '2.5' });
  expect(answerLines(sliderForm, { amount: '2.5' })).toEqual([['Amount', '2.5 USD']]);
});
```

  Plus: an agent name with `<b>` is escaped in `formatted_body`; outside a thread the relation is `{'m.in_reply_to': {event_id}}`; no answers gives a body ending in `(no answers)`; a box gives `yes` or `no`, an empty multiple choice `none`; the draft store drops the oldest of 51 keys.
  Component (jsdom): one labelled native control per field kind; the slider shows its value and unit; with `scope.finished` false there is no Submit button and the wait hint shows; `scope.readOnly` shows no Submit; Submit with a required radio unanswered sends nothing and focuses it; a valid Submit calls `mx.sendMessage(roomId, content, txnId)` once with the built content; typing, unmounting and mounting again restores the draft; a text input stops at 500 characters.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** The draft key is `roomId|eventId|id`. Submit is offered under the question card's rule (`!readOnly`, a room, `isConfirmedMatrixEventId(eventId)`, the viewer is not an agent) plus `scope.finished`. Send as `CanvasPanel`'s `deliver` does: `mx.sendMessage` with a fresh transaction id, the relation in the content, a thrown error shown as a retry hint. The agent's display name comes from `getMemberDisplayName(room, agentUserId)`. One column under 420 px.
- [ ] **Step 4: Run, typecheck, strict, lint.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(widgets): form card that answers with a thread message`).

### Task 6: Answered state and the receipt

**Files:**
- Modify: `src/app/messages/widgets/uiResponse.ts`, `src/app/messages/widgets/uiResponse.test.ts`, `src/app/messages/widgets/UiForm.tsx`, `src/app/messages/widgets/UiForm.test.tsx`
- Create: `src/app/messages/widgets/useUiResponses.ts`, `src/app/messages/widgets/UiFormReceipt.tsx`
- Modify: `src/app/timeline/RoomTimeline.tsx` (beside `useInlineSecretRequestPlan` and its provider)

**Interfaces:**
- Produces:
  - `type UiResponseRecord = { values: Record<string, unknown>; sending: boolean }`
  - `uiResponseKey(eventId: string, widgetId: string): string`
  - `planUiResponses(events: readonly MatrixEvent[], viewerId: string | undefined): ReadonlyMap<string, UiResponseRecord>`
  - `sameUiResponsePlan(a, b): boolean`
  - `UiResponsesContext` (default: an empty map), `useUiResponses({ room, events, viewerId }): ReadonlyMap<string, UiResponseRecord>`
  - `UiFormReceipt({ form, values, sending }: { form: FormWidget; values: Record<string, unknown>; sending: boolean })`

- [ ] **Step 1: Write the failing tests.** `planUiResponses`: the fixture answer from the viewer gives one record under `uiResponseKey('$form:example.org', '0fd993d70d')`; the same event from another member, a redacted one, one whose `m.in_reply_to` names another event, and one with another `widget` give none; of two answers the earlier `getTs()` wins; an event still sending (`event.status` set) gives `sending: true`. `UiForm` inside a context with a record renders a `<details>` receipt with the title and "Answered", closed, whose body lists `Pace` and `Relaxed`; without the record it is the form again. `sameUiResponsePlan` is true for equal maps.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `useUiResponses` mirrors `useInlineSecretRequestPlan`: recompute when `events` changes and on decrypt, replace and redaction, and return the previous map when it draws the same. It runs for the room timeline and for threads. The receipt reuses the `Receipt*` styles of `approvals/ThreadApprovals.css.ts`; its status text sits outside the folded body. The plan reads each answer event's own content, not an edit of it.
- [ ] **Step 4: Run with `src/app/timeline`, typecheck, strict, lint.** Expected: PASS.
- [ ] **Step 5: Commit** (`feat(widgets): fold an answered form to a receipt`).

### Task 7: Docs and the bundle budget

**Files:**
- Modify: `docs/architecture.md` ("MindRoom event formats": rows for `io.mindroom.ui` and `io.mindroom.ui_response`; the `messages/` folder list gains `widgets/`)

- [ ] **Step 1: Add the two rows**, each one sentence on the shape and the trust rule, pointing at the backend's `docs/widgets.md`.
- [ ] **Step 2: Run `just build` and `just bundle-report`.** Expected: inside the budget, with the chart and form in a chunk of their own that a first visit does not download. If initial CSS is over, move styles out of `UiWidgetSlot.css.ts` before touching the budget file.
- [ ] **Step 3: Run `just check`.** Expected: PASS.
- [ ] **Step 4: Commit** (`docs(widgets): event formats`).

### Task 8: Stub scenarios, e2e and screenshots

**Files:**
- Modify: `scripts/agent-stack/stub_model.py` (`#chart`: a sentence, the 5.4 `ui` block, a sentence; `#form`: a sentence and the 5.6 form block; both in `TEXT_SCENARIOS` and the header list), `scripts/agent-stack/stack.py` (`ui_widgets: true` on the helper when the backend checkout's `src/mindroom/config/agent.py` knows the field)
- Create: `e2e/messages/agent-ui-widgets.spec.ts`

- [ ] **Step 1: Write the spec** with the agent-stack fixtures of `e2e/helpers/agentStack.ts`; it skips when the backend checkout has no `ui_widgets`.
  - `#chart`: the finished reply shows a figure titled `Signups` between its two sentences and no code block; Table shows 3 rows; after a reload the figure is there again.
  - `#form`: choosing `Relaxed` and pressing `Plan my trip` adds one message by the user whose text lists `Pace: Relaxed`, the card becomes a receipt reading "Answered", and after a reload it still is.
  - `#chart` at 390 px wide: the card fits the row without horizontal scroll.
- [ ] **Step 2: Run it on a slot** as the other `agent-*.spec.ts` specs run, with `E2E_MINDROOM_CHECKOUT` set to the backend worktree. Expected: PASS.
- [ ] **Step 3: Take the pull request's screenshots** at the head commit: chart and form, desktop and 390 px, light and dark, plus the receipt.
- [ ] **Step 4: Commit** (`test(widgets): agent chart and form e2e`).

The fresh live test (spec section 10, L1 to L10) is the backend plan's Task 6 and needs this plan finished.

## Estimated size

| Part | Source | Tests, fixtures, translations, docs |
|---|---|---|
| Task 1 reader, trust, live field | 95 | 150 + fixture copies |
| Task 2 validator | 210 | 30 |
| Task 3 slot and hook | 150 | 170 |
| Task 4 chart | 520 (190 styles) | 190 + translations 120 |
| Task 5 form and answer | 470 (110 styles) | 260 + translations 100 |
| Task 6 answered and receipt | 170 | 150 + translations 20 |
| Task 7 docs | 0 | 10 |
| Task 8 stub and e2e | 40 | 150 |
| **Total** | **about 1,650** | **about 1,350** |
