# Fold Finished Agent Work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:executing-plans. Three tightly coupled tasks with cheap mistakes; one fresh whole-branch review at the end.

**Goal:** A finished MindRoom agent reply folds everything up to its last tool call into one `Worked for <duration>` row, like T3 Code's finished turns.

**Architecture:** A pure function splits the reply's HTML at the top-level block that holds the last tool marker. A small disclosure component renders the folded head. `renderAgentMessageContent.tsx` uses both on the agent text paths (plain and long-text sidecar).

**Tech Stack:** React, TypeScript, vanilla-extract CSS, html-react-parser (`htmlToDOM`), i18next, Vitest.

**Spec:** `docs/baspowers/specs/2026-11-15-fold-finished-agent-work-design.md`

## Global Constraints

- Work in `~/repos/worktrees/mindroom-chat-fold-agent-work` (branch `feat/fold-finished-agent-work`). Every command runs in `nix develop`. Read `AGENTS.md` and `docs/architecture.md` first.
- Strict TS: `just typecheck` and `just strict` print nothing; `just lint` passes (layer import rules, no barrel files, tests beside their subject).
- Unsigned commits, files added by explicit path, no em dashes in code, comments or strings.
- Folds only when sender is a MindRoom agent, AI run status is `completed` or `cached`, the HTML has a tool marker, and non-whitespace content follows the last one.
- Labels: `Worked for {{duration}}` and `Worked`. Duration format `45s`, `2m 13s`, `1h 4m`.
- Duration = latest replacement `getTs()` minus the original event's `getTs()`; no replacement means no duration.
- Open state lives in `ManualExpansionStateContext` (`src/app/timeline/CollapsibleMessage.tsx`) under key `finished-work:<eventId>`, written with `rememberManualExpansionState`.
- No new setting.

## Review Focus

- A reply that finishes while on screen: it must fold once its status turns `completed`, and must not flicker between folded and unfolded on later edits.
- A long-text (sidecar) agent reply: the fold applies after hydration, the preview before hydration does not crash.
- A reply whose final text is only whitespace or a trailing `⏳` pending marker: no fold.
- Search highlighting (`highlightRegex`) inside the folded head: opening the fold shows highlights; a fold does not hide a search hit without a way to open it (it opens on click like any other).
- The cog (`ToolCallsFold`) still counts all of the reply's calls after the split, because both head and tail sit under the same `ToolCallsFold` provider.

---

### Task 1: Split and duration helpers

**Files:**
- Create: `src/app/messages/agent-run/finishedWorkSplit.ts`
- Test: `src/app/messages/agent-run/finishedWorkSplit.test.ts`

**Interfaces:**
- Produces: `splitFinishedWork(html: string): { head: string; tail: string } | undefined`
- Produces: `formatWorkDuration(ms: number): string`

- [ ] **Step 1: Write failing tests**

```ts
const marker = (name: string, n: number) => `<p>🔧 <code>${name}</code> [${n}]</p>`;
it('returns undefined without a tool marker', () =>
  expect(splitFinishedWork('<p>hi</p>')).toBeUndefined());
it('returns undefined when the reply ends in a tool marker', () =>
  expect(splitFinishedWork(`<p>a</p>${marker('shell', 1)}`)).toBeUndefined());
it('returns undefined when only whitespace follows', () =>
  expect(splitFinishedWork(`${marker('shell', 1)}\n  `)).toBeUndefined());
it('splits after the last marker', () =>
  expect(splitFinishedWork(`<p>a</p>${marker('shell', 1)}<p>b</p>${marker('grep', 2)}<p>done</p>`)).toEqual({
    head: `<p>a</p>${marker('shell', 1)}<p>b</p>${marker('grep', 2)}`,
    tail: '<p>done</p>',
  }));
it('ignores marker-like text inside a code block', () =>
  expect(splitFinishedWork('<pre><code>🔧 `shell` [1]</code></pre><p>x</p>')).toBeUndefined());
it('treats a pending marker as a marker', () =>
  expect(splitFinishedWork(`${marker('shell', 1).replace('</p>', ' ⏳</p>')}<p>x</p>`)?.tail).toBe('<p>x</p>'));
it.each([[45_000, '45s'], [133_000, '2m 13s'], [3_840_000, '1h 4m'], [400, '0s']])(
  'formats %d ms as %s', (ms, label) => expect(formatWorkDuration(ms)).toBe(label));
```

- [ ] **Step 2: Run, expect FAIL** `nix develop -c just test src/app/messages/agent-run/finishedWorkSplit.test.ts`
- [ ] **Step 3: Implement.** Parse with `htmlToDOM`; a top-level node counts as a marker block when the HTML of that node matches the marker form used by `MINDROOM_TOOL_REF_HTML_REG_G` (`src/app/messages/html/blocks.ts`) via `parseToolRefHtml` or the shared regex (reuse, do not copy the regex). Serialize head and tail by slicing the original string at the node's `endIndex` (enable `withEndIndices`), so the HTML is byte-identical. Add a bounded memo (last input/output pair is enough).
- [ ] **Step 4: Run, expect PASS.**
- [ ] **Step 5: Commit** `Fold finished agent work: split a reply after its last tool call`

### Task 2: `FinishedWorkFold` component and strings

**Files:**
- Create: `src/app/messages/agent-run/FinishedWorkFold.tsx`, `FinishedWorkFold.css.ts`, `FinishedWorkFold.test.tsx`
- Modify: `src/app/i18n/locales/additions/en.json` and the 16 `locales/additions/<code>.json` overlays (Python script that keeps each file's indent; reuse each language's existing wording for "worked"/duration where one exists)

**Interfaces:**
- Consumes: `formatWorkDuration` (Task 1)
- Produces: `FinishedWorkFold({ foldKey, durationMs, children }: { foldKey: string; durationMs?: number; children: ReactNode })`. Renders a `<button aria-expanded>` row with a chevron and the label; renders `children` only when open. Reads and writes open state through `ManualExpansionStateContext` with `rememberManualExpansionState`; falls back to local state when the context is absent.
- Keys: `mindroomUi.messages.finishedWork.workedFor` = `Worked for {{duration}}`, `mindroomUi.messages.finishedWork.worked` = `Worked`.

- [ ] **Step 1: Failing tests:** label `Worked for 2m 13s` with `durationMs=133000`; label `Worked` without it; children hidden, shown after click, `aria-expanded` flips; with a shared `Map` in `ManualExpansionStateContext`, unmount and remount keeps it open; `localeAdditions.test.ts` passes.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Match the row styling of the reasoning header (`Reasoning.css.ts`) so it reads as the same family.
- [ ] **Step 4: Run, expect PASS** (component test plus `src/app/i18n`).
- [ ] **Step 5: Commit** `Fold finished agent work: the Worked for row`

### Task 3: Wire it into agent replies

**Files:**
- Modify: `src/app/messages/content/renderAgentMessageContent.tsx` (`renderBody`, `renderLongTextBody`, and `wrapWithReasoning` use)
- Modify if needed: `src/app/messages/agent-run/Reasoning.tsx` (`withReasoning`, so the reasoning header and cog can go inside the fold)
- Test: `src/app/messages/content/renderAgentMessageContent.test.ts` (or a new `renderAgentMessageContent.finishedWork.test.tsx` beside it)

**Interfaces:**
- Consumes: `splitFinishedWork`, `FinishedWorkFold`, `getAiRunInfo(content).status`, `mEvent.replacingEvent()?.getTs()` and `mEvent.getTs()`.

- [ ] **Step 1: Failing tests:** an agent reply with `io.mindroom.ai_run` status `completed`, two markers and a final paragraph renders the final paragraph and a `Worked for …` button, and not the head text; clicking shows the head text and the tool rows. No fold for: status absent or `streaming`, `error`, `cancelled`; a reply without markers; a reply ending in a marker; `fromMindroomAgent=false`. A hydrated long-text reply folds the same way.
- [ ] **Step 2: Run, expect FAIL.**
- [ ] **Step 3: Implement.** Decide folding once per render from the resolved content; when it folds, render `FinishedWorkFold` (key `finished-work:<eventId>`) containing the reasoning header or cog row plus the head body, then the tail body and live activity. Both bodies go through `AgentRenderBody` so markers, highlights and parser options are unchanged. Not folding must render exactly today's tree (no extra wrapper), so existing snapshots and state keep their place.
- [ ] **Step 4: Run focused tests, expect PASS:** `nix develop -c just test src/app/messages`
- [ ] **Step 5: Full gates** in one call, logs to files: `just typecheck`, `just strict`, `just lint`, `just test`; grep logs for `FAIL` and `Test Files`. Check any failure on `origin/main` before calling it pre-existing.
- [ ] **Step 6: Screenshots** of a folded and an opened reply (throwaway Playwright spec on a `just e2e-slot` slot, or the dev server); save under the workspace, not the repo.
- [ ] **Step 7: Commit** `Fold finished agent work: finished agent replies fold up to their last tool call`
