# Command Palette Fuzzy Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:executing-plans — five tasks that share one interface each with the next, implemented by the session that designed them.

**Goal:** Replace the palette's Fuse.js and exact-word search with one matcher that ranks by how typed text matches, orders the All tab by its best match, and marks the matched letters.

**Architecture:** A pure matcher (`fuzzyMatch.ts`) scores one typed word against one prepared text. `commandPaletteSearch.ts` holds each list's fields and weights, an index per list identity, and the ranking. `commandPaletteResults.ts` builds a tab's local sections for the component, which draws the marks.

**Tech Stack:** TypeScript, React 18, vitest, Playwright. No new dependency.

**Spec:** `docs/baspowers/specs/2026-11-15-command-palette-fuzzy-search-design.md`

## Global Constraints

- Every file compiles with `config/tsconfig.strict.json` and passes `just lint`; no em dashes in docs, comments or commit messages.
- No code copied from GPL or AGPL projects; no new dependency.
- `command-palette` imports only lower layers (`.eslintrc.cjs` `LAYERS`).
- The corpus (`command-palette/__fixtures__/searchCorpus.ts`) decides: every case passes, and no case is changed to make it pass unless its expectation was wrong, which the spec then says.
- Commits unsigned, files added by path.

## Review Focus

- Typed text that is only spaces, `@` or punctuation: the lists show what they show without text or nothing, and nothing throws.
- A pasted paragraph of 500 letters as typed text: a keystroke stays under the load test's bound (the typo check is bounded by the length difference).
- A name with emoji, a surrogate pair or a combining accent written as two characters: a mark never splits a character.
- A row whose field is missing, empty or an empty list: it does not match through that field, and nothing throws.
- A list that is a new array on every render: the result is right each time (the index belongs to the array, not to its content).

---

### Task 1: The matcher

**Files:**
- Create: `src/app/command-palette/fuzzyMatch.ts`
- Test: `src/app/command-palette/fuzzyMatch.test.ts`

**Interfaces:**
- Produces:
  - `foldText(text: string): string`
  - `type PreparedText = { text: string; flags: Uint8Array }` with `WORD_START = 1`, `WORD_END = 2`, `SEGMENT_START = 4` per folded character (a segment ignores the every-character starts of scripts without spaces)
  - `prepareText(text: string): PreparedText`
  - `type TextRange = readonly [start: number, end: number]`
  - `type WordMatch = { score: number; ranges: TextRange[] }`
  - `matchWord(word: string, field: PreparedText, name: boolean): WordMatch | undefined` (`word` folded; `name` allows initials and abbreviations and in-word matches of one or two letters)
  - `MATCH_SCORE = { exact: 100, strong: 60 }`
  - `originalRanges(text: string, ranges: readonly TextRange[]): TextRange[]`

- [ ] **Step 1: Write the failing tests** (`fuzzyMatch.test.ts`): folding (`'Café Zürich'` to `'cafe zurich'`, `'Straße'` to `'strasse'`, `'Søren Łukasz'` to `'soren lukasz'`, `'é'` to `'e'`, `'が'` kept, `'مُحَمَّد'` to `'محمد'`, `'ΟΔΟΣ'` equal to the fold of `'οδος'`); score order for one word over fields (`theme`: Theme > Theme Park > Toggle Theme > Themes > Anthem); whole word above longer word (`john`: John Smith > Johnson); initials (`cr` Create Room, not for `name: false`); abbreviation (`crm` Create Room, `stgs` Settings, not `emma` Hide Membership Change); typo lengths (`jhon` John yes, `jahn` no, `markdwon` yes, `markdxwn` yes at 8, `marko` not Markdown, `markdwo` Markdown as a start, `notifcatoin` at 11 two typos); first letter fixed (`harkdown` no); CJK (`オフィス` in `東京オフィス` scores as a word start); ranges (`crm` gives `[[0,1],[7,8],[10,11]]`); `originalRanges` (`'Café'` with fold range `[0,4]` gives `[0,4]`; decomposed `'Café x'` range `[3,4]` gives `[3,5]`; `'Straße'` fold range `[4,6]` gives `[4,5]`; an emoji before the match keeps whole code points).
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/command-palette/fuzzyMatch.test.ts`; expected: fails, module missing.
- [ ] **Step 3: Implement.** Scores: whole field 100; start of the field's first word 80; start of a later word 70; whole word adds 15; initials 60 (plus 5 from the first word, plus 3 covering every word); inside a word 50 (plus 5 ending at a word end); typo 40 (plus 5 for a whole word, minus 4 for a second typo); abbreviation 30 plus up to 9 for letters that follow each other or start words. Inside a way: plus up to 4 for the share of the word covered, minus 0.5 per word before it (at most 2). Typos by length: 4 a swap of neighbors, 5 to 8 one, 9 and more two; the start of a longer word from 7 letters.
- [ ] **Step 4: Run the tests**; expected: pass.
- [ ] **Step 5: Commit** `fuzzyMatch.ts`, `fuzzyMatch.test.ts`.

### Task 2: Lists, fields and ranking

**Files:**
- Modify: `src/app/command-palette/commandPaletteSearch.ts`, `commandPalettePages.ts`
- Test: `commandPaletteSearch.test.ts`, `commandPaletteSearch.names.test.ts`, `commandPalettePages.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  - `type CommandPaletteSearchField<T> = { key: string; get: (item: T) => string | readonly string[] | undefined; weight: number; name?: boolean }`
  - `type CommandPaletteSearchConfig<T> = { fields: readonly CommandPaletteSearchField<T>[]; limit: number; query?: (text: string) => string }`
  - `type CommandPaletteMarks = Readonly<Record<string, readonly TextRange[]>>` (by field key, ranges of the text as written)
  - `type CommandPaletteMatch<T> = { item: T; score: number; marks: CommandPaletteMarks }`
  - `matchCommandPaletteSection<T>(options: { items: readonly T[]; query: string; config; keepUnmatched?: boolean }): CommandPaletteMatch<T>[]` (best first, cut to `config.limit`; without text the starter order and score 0; `keepUnmatched` appends rows no rule matches, in their order)
  - `searchCommandPaletteSection<T>(options): T[]`
  - `commandPaletteSearchConfig.{actions,rooms,users,threads}` with the weights of the spec: actions `title` 1 name, `keywords` 0.7, `description` 0.5; rooms `name` 1 name, `canonicalAlias` 0.9, `topic` 0.5, `parentNames` 0.5; users `displayName` 1 name, `userName` 0.8 name (local part without `mindroom_`), `userId` 0.5 (not for agents), `agentId` 0.5 (agents: the ID without the prefix), `dmRoomName` 0.5, and `query` that drops a leading `@` and a leading `mindroom_` when more follows; threads `summaryText` 1, `tags` 0.7, `roomName` 0.5, `participantNames` 0.5.
  - `tagCommandPalettePageRows` adds the page title to `keywords`.

- [ ] **Step 1: Rewrite the tests**: keep the four behaviors of `commandPaletteSearch.test.ts` (starter order without text, a room found by its parent, boost breaks equal matches, tags found) and the three of `commandPaletteSearch.names.test.ts`; replace the Fuse config test with one that pins field keys and weights; add: every word required over different fields, order free, `keepUnmatched`, marks for the title and for an array field absent, a missing or empty field, text of spaces or `@` alone, a 500-letter text returns, a new array with the same rows gives the same result.
- [ ] **Step 2: Run them**; expected: the new ones fail.
- [ ] **Step 3: Implement.** Row score: the mean over typed words of the best `weight * matchWord` score, or `weight * score + 2` of the whole typed text as one word in a name field when that is higher; rejected when a word matches no field. Order: `score + 3 * normalizedBoost` descending, `sortRank` descending, `id`.
- [ ] **Step 4: Run the tests**; expected: pass.
- [ ] **Step 5: Commit.**

### Task 3: A tab's sections, and the source's commands

**Files:**
- Create: `src/app/command-palette/commandPaletteResults.ts`, `commandPaletteResults.test.ts`, `commandPaletteResults.corpus.test.ts`
- Delete: `commandPalettePeopleRanking.ts`, `commandPaletteSearch.corpus.test.ts`
- Modify: `CommandPalette.tsx`, `commandPaletteItems.ts`, `useCommandPaletteCommands.ts`, and the tests that build a source (`CommandPalette.test.ts`, `CommandPaletteRenderer.test.ts`, `commandPaletteItems.tour.test.tsx`, `useCommandPaletteCommands.test.tsx`)

**Interfaces:**
- Consumes: Task 2.
- Produces:
  - `CommandPaletteSource.commands: Executable<CommandPaletteActionItem>[]` in place of `searchCommands`; `CommandPaletteCommands.commands` the same.
  - `type CommandPaletteLocalSection = { id: 'rooms' | 'threads' | 'users' | 'actions'; items: ExecutableCommandPaletteItem[]; marks: ReadonlyMap<string, CommandPaletteMarks> }`
  - `getCommandPaletteLocalSections(options: { source: Pick<CommandPaletteSource, 'actions' | 'commands' | 'rooms' | 'threads' | 'getUsers'>; tab: CommandPaletteTab; searchText: string }): CommandPaletteLocalSection[]` (in the order shown; empty sections left out except `users`, which the server may still fill)
  - `rankCommandPalettePeople<T extends CommandPaletteUserItem>(people: readonly T[], query: string): CommandPaletteMatch<T>[]`

- [ ] **Step 1: Write the failing tests**: `commandPaletteResults.test.ts` (All orders sections by grade: `dark` puts actions first over a thread that holds the word; equal grades keep rooms first; a tab of its own returns its one section; without text the starter rooms leave spaces out on All; people ranked with the server's keep unmatched ones last) and `commandPaletteResults.corpus.test.ts` (one `it.each` case per corpus case, failing with the case's failures; the load fixture: best of three runs per text, each under 50 ms).
- [ ] **Step 2: Run them**; expected: fail, module missing.
- [ ] **Step 3: Implement**, wire `CommandPalette.tsx`, turn `searchCommands` into `commands`, update the source-building tests; the name tests of `useCommandPaletteCommands.test.tsx` search `commands` with `searchCommandPaletteSection`.
- [ ] **Step 4: Run** `nix develop -c npx vitest run src/app/command-palette`; expected: pass.
- [ ] **Step 5: Commit.**

### Task 4: Marks

**Files:**
- Modify: `CommandPaletteList.tsx`, `CommandPalette.css.ts`, `CommandPalette.tsx`
- Test: `CommandPaletteList.test.ts`, `CommandPalette.test.ts`

**Interfaces:**
- Consumes: `CommandPaletteLocalSection.marks`.
- Produces: `CommandPaletteListSection.marks?: ReadonlyMap<string, CommandPaletteMarks>`; a mark is `<mark class={css.TitleMatch} data-match>`.

- [ ] **Step 1: Write the failing tests**: a room row marks `Plat` of its name for `plat`; a person found by user ID marks the ID line; a name with a direction control carries no mark; a typed-ID row carries none; the row's text content is unchanged.
- [ ] **Step 2: Run them**; expected: fail.
- [ ] **Step 3: Implement**; style: `color.Primary.Main`, underline, no weight change.
- [ ] **Step 4: Run** the palette's tests; expected: pass.
- [ ] **Step 5: Commit.**

### Task 5: End to end, docs, delivery

**Files:**
- Create: `e2e/command-palette/command-palette-fuzzy.spec.ts`
- Modify: e2e specs and docs that describe the old search; the spec's results section.

- [ ] **Step 1: Write the spec** (initials `crm`, typo `markdwon`, a name lists no setting, `dark` on All opens the Dark theme, marks visible) and run it on slot 48: `nix develop -c just e2e-slot 48 npx playwright test e2e/command-palette --project=chromium`; fix specs that pinned the old order only where the new order is the spec's.
- [ ] **Step 2: Write the results** (corpus and speed, before and after) into the spec.
- [ ] **Step 3: Run** `nix develop -c just check`; expected: exit 0.
- [ ] **Step 4: Screenshots** of the same typed texts before (`328551ab0`) and after, then the pull request against `t3/rich-command-palette` while its pull request is open, else `main`.
