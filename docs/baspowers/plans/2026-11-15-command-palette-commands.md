# Command Palette Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development (eight tasks that share interfaces; the planning session's context is already large, so each task gets a fresh one and a reviewer).

**Goal:** The command palette changes settings and themes, calls agents and runs the open room's header actions, with rows that show their state and pages of choices.

**Architecture:** Action rows gain optional fields (`icon`, `tag`, `shortcut`, `state`, `current`, `page`, `keepOpen`). The palette component keeps an open page and decides what stays open; a new hook builds the new rows from the atoms the Settings pages write. `command-palette` moves one layer up so it may read `settings`.

**Tech Stack:** React 18, jotai, fuse.js, folds, vanilla-extract, i18next, vitest (react-test-renderer and Testing Library), Playwright.

**Spec:** `docs/baspowers/specs/2026-11-15-command-palette-commands-design.md`

## Global Constraints

- Every command runs in `nix develop -c ...` from the worktree root. `node_modules` is absent in a fresh worktree: `cp -al` it from a sibling worktree under `~/.t3/worktrees/mindroom-client/` whose `package-lock.json` and `patches/*` match (`cmp`); never `npm ci` over a symlink.
- Every file compiles with `config/tsconfig.strict.json` (`just strict`, `just typecheck`) and passes `just lint` (type-aware, layer zones, logical sides in styles: `insetInlineEnd`, `paddingInline`, never `left`/`right`).
- No barrel files; tests beside their subject; a domain imports only lower layers (tests exempt).
- No em dashes in docs, comments or commit messages. Comments say what the code does or why, in full sentences, like the files around them.
- Commits: `git -c commit.gpgsign=false commit`, files added by explicit path, never `git add -A`.
- New strings: only `commandPalette.state.on` ("On") and `commandPalette.state.off` ("Off"), in `src/app/i18n/locales/additions/en.json` and all 16 overlays `additions/<code>.json` (ar bn de es fr hi id it ja ko nl pt ru tr zh zh-TW), translated. Every other text reuses an existing key named in the task.
- No code copied from GPL or AGPL projects.
- Format changed files with `just format <paths>` (Prettier 2.8.8) before each commit.

## Review Focus

1. Typing a page's title ("theme") must list the page row, not be crowded out by its 23 choices: choices are searched by their own title only (Task 4 test).
2. A switch setting flipped from typed text: the source rebuilds, the palette stays open, the text stays, and the highlight stays on the same row (Task 3 test).
3. Backspace in the empty field while an input method is composing must not leave the page (Task 3 test).
4. A setting the context hides (the access token while developer tools are off) is not offered, and a covered setting (`theme`, `language`, `tour`) never appears twice (Task 5 test).
5. On a phone there is no Escape: a click on the chip goes back and returns the focus to the field (Task 3 test).

---

### Task 1: Move `command-palette` above `settings`

**Files:**
- Move: `src/app/command-palette/commandPaletteShortcut.ts` to `src/app/shortcuts/paletteShortcut.ts` (`git mv`, content unchanged)
- Modify: the importers and the tests that mock its path (`grep -rn "commandPaletteShortcut'" src e2e`): `command-palette/CommandPalette.tsx`, `CommandPaletteSearchField.tsx`, `CommandPaletteSidebarTab.tsx`, `settings/Settings.tsx`, `settings/pages/AgentInterfaceSettings.tsx`, and the mocks in `CommandPalette.test.ts`, `CommandPaletteRenderer.test.ts`, `commandPaletteItems.tour.test.tsx`, `AgentInterfaceSettings.sidebar.test.tsx`
- Modify: `.eslintrc.cjs` (`LAYERS`), `docs/architecture.md` ("Layers" table)

**Interfaces:**
- Produces: `getCommandPaletteShortcutLabel`, `getCommandPaletteAriaKeyShortcuts` from `src/app/shortcuts/paletteShortcut.ts`. `command-palette` may import `settings`, `tour`, `room`, `local-mindroom` and everything below.

- [ ] **Step 1:** In `.eslintrc.cjs` change the two lines `['command-palette', 'local-mindroom', 'room'], ['settings', 'tour'],` to `['local-mindroom', 'room'], ['settings', 'tour'], ['command-palette'],`. In `docs/architecture.md` renumber the table: 11 `local-mindroom`, `room`; 12 `settings`, `tour`; 13 `command-palette`; 14 `sidebar`; 15 `shell`; 16 `src/index.tsx`, `src/client-sdk`.
- [ ] **Step 2:** Run `nix develop -c just lint`. Expected: FAIL, `settings` importing `command-palette/commandPaletteShortcut` climbs.
- [ ] **Step 3:** `git mv` the file and update every import and `vi.mock` path.
- [ ] **Step 4:** Run `nix develop -c just lint && nix develop -c just strict && nix develop -c just test src/test/layering.test.ts src/app/command-palette src/app/settings`. Expected: all pass.
- [ ] **Step 5:** Commit: `Command palette: its own layer above settings`.

### Task 2: Rows that show a state, a choice, a page and keys

**Files:**
- Modify: `src/app/command-palette/commandPaletteTypes.ts`, `CommandPaletteList.tsx`, `CommandPalette.css.ts`
- Modify: `src/app/i18n/locales/additions/en.json` and the 16 overlays
- Test: `src/app/command-palette/CommandPaletteList.test.ts` (add the new class names to its css mock and `Check`, `ChevronRight` to its folds `Icons` mock if it has one)

**Interfaces:**
- Produces, in `commandPaletteTypes.ts`:

```ts
export type CommandPalettePageId = 'theme' | 'message-layout' | 'language';
/** A row together with what choosing it does (moved here from commandPaletteItems.ts). */
export type Executable<T> = T & { onSelect?: () => void };
export type CommandPaletteActionItem = CommandPaletteBaseItem & {
  kind: 'action';
  title: string;
  description?: string;
  keywords?: string[];
  /** Its own icon; without one, the terminal. */
  icon?: IconSrc;
  /** A word after the title that says what kind of row it is. */
  tag?: string;
  /** The keyboard shortcut of the same action, shown at the row's end. */
  shortcut?: ShortcutId;
  /** A row that flips something: what it is now. */
  state?: 'on' | 'off';
  /** A choice of a page: whether it is the one in effect. */
  current?: boolean;
  /** Choosing the row opens this page. */
  page?: CommandPalettePageId;
  /** Choosing the row leaves the palette open, so the row can show its new state. */
  keepOpen?: boolean;
};
export type CommandPalettePage = {
  title: string;
  /** In display order: their sortRank descends. */
  items: readonly Executable<CommandPaletteActionItem>[];
};
```

- [ ] **Step 1: Failing tests** in `CommandPaletteList.test.ts`, one `it` each, rendering one action row:
  - `state: 'on'` renders an element `[data-row-state="on"]` with text `On` (the test's `t` mock returns the key or English as the file's other tests do; assert accordingly) and the option has `aria-checked: true`; `state: 'off'` gives `Off` and `aria-checked: false`.
  - `current: true` renders `[data-row-current]` and `aria-checked: true`; `current: false` renders no `[data-row-current]` and `aria-checked: false`.
  - `page: 'theme'` renders `[data-row-page]`.
  - `shortcut: 'settings'` renders a `kbd` with `data-shortcut-keys`.
  - `tag: 'Settings'` renders the tag text in the heading; `icon: 'sun'` is the row icon's `src`, and a row without `icon` keeps `Icons.Terminal`.
  - A row with none of these has no `aria-checked` prop.
- [ ] **Step 2:** Run `nix develop -c just test src/app/command-palette/CommandPaletteList.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement. In `CommandPaletteList.tsx` the row end, before `RowEnter`, in this order: keys (`ShortcutKeys` from `../shortcuts/ShortcutKeys`), state text (`t('commandPalette.state.on' | '.off')`, class `css.RowState`), check (`Icons.Check`, `aria-hidden`), chevron (`Icons.ChevronRight`, `aria-hidden`). `aria-checked` on the option is `state === 'on'` for a state row, `current` for a choice, absent otherwise. Do not put `aria-keyshortcuts` on rows (the shortcut hints draw on every element that carries it). `CommandPalette.css.ts` gains `RowState` (quiet text like `RowDescription`, `flex: 'none'`) and `RowEnd` (inline flex, gap, `flex: 'none'`). Add the two strings to `en.json` additions and translate them in the 16 overlays.
- [ ] **Step 4:** Run the list tests, `nix develop -c just test src/app/i18n`, `nix develop -c just strict`. Expected: PASS.
- [ ] **Step 5:** Commit: `Command palette: rows show a state, a current choice, a page and keys`.

### Task 3: Pages and rows that keep the palette open

**Files:**
- Modify: `src/app/command-palette/commandPaletteItems.ts` (types only), `CommandPalette.tsx`, `CommandPalette.css.ts`
- Test: `src/app/command-palette/CommandPalette.test.ts` (extend `FIXTURE_SOURCE`; fix every other fixture of `CommandPaletteSource`: `grep -rln "CommandPaletteSource" src`)

**Interfaces:**
- Consumes: Task 2's types.
- Produces, in `commandPaletteItems.ts`:

```ts
export type CommandPaletteSource = {
  /** The action rows of the first list. */
  actions: Executable<CommandPaletteActionItem>[];
  /** Every action row typed text can find: `actions`, the settings and the pages' choices. */
  searchActions: readonly Executable<CommandPaletteActionItem>[];
  pages: Readonly<Record<CommandPalettePageId, CommandPalettePage>>;
  threads: ...; rooms: ...; getUsers: ...; // unchanged
};
```
  Until Task 7, `useCommandPaletteSource` returns `searchActions: actions` and three pages with their title (`t('settings.general.appearance.theme')`, `t('settings.general.messages.messageLayout')`, `t('settings.general.language.appLanguage')`) and no items.

- [ ] **Step 1: Failing tests** in `CommandPalette.test.ts`. Fixture: `actions` gains `{ id: 'page-theme', kind: 'action', title: 'Theme', page: 'theme', sortRank: 5 }`; `pages.theme = { title: 'Theme', items: [light (current: false, sortRank 3), dark (current: true, sortRank 2), dracula (current: false, sortRank 1)] }` each with an `onSelect` spy; `searchActions` = the actions plus `{ id: 'setting:markdown', kind: 'action', title: 'Markdown Formatting', state: 'on', keepOpen: true, onSelect: spy }` and `{ id: 'room-command:viewSwitch', kind: 'action', title: 'Compact view', state: 'on', onSelect: spy }` and the three choices. Tests:
  - "Enter on a page row opens the page": on the Actions tab, highlight `page-theme`, Enter. The options are exactly Light, Dark, Dracula in that order; the highlighted one is Dark (the current choice); no `[role="tab"]` is rendered; `[data-page-chip]` shows `Theme`; the input is empty; `requestClose` not called.
  - "typing filters the page": type `drac`; the only option is Dracula.
  - "a choice in its page applies and stays": Enter on Dracula calls its spy once; `requestClose` not called; the page is still open.
  - "Escape goes back to the text and the row": type `the` in the first list, open the page from the `page-theme` row, Escape. The input is `the`, tabs are back, the highlighted option is `page-theme`, `requestClose` not called. A second Escape calls `requestClose`.
  - "Backspace in the empty field goes back", and "not while composing": the same with `key: 'Backspace'`; with `nativeEvent: { isComposing: true }` the page stays.
  - "the chip goes back": click `[data-page-chip]`; the page closes.
  - "typed text searches searchActions": type `markdown`; `setting:markdown` is listed; with no text it is not.
  - "a keepOpen row keeps the palette open": Enter on `setting:markdown` calls its spy; `requestClose` not called; the input still holds `markdown`. Then re-render with a new `source` whose row has `state: 'off'`: the highlighted option is still `setting:markdown`.
  - "a state row without keepOpen closes": type `compact`, Enter on `room-command:viewSwitch`: its spy is called and `requestClose` is called.
  - "a choice from the first list closes": type `dracula` in the first list, Enter: its spy is called and `requestClose` is called.
  - "the footer names Back in a page": with a page open the footer shows `esc` beside the `thread.back` text and no `Tab` hint.
  - "messages and people are not asked in a page": the `useMessages` and `usePeople` spies get `enabled === false` while a page is open.
- [ ] **Step 2:** Run `nix develop -c just test src/app/command-palette/CommandPalette.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3:** Implement in `CommandPalette.tsx`:
  - State `page?: { id: CommandPalettePageId; query: string; highlight: { id?: string; index: number } }`.
  - `getLocalSectionItems` case `actions`: `searchText ? source.searchActions : source.actions`.
  - With a page open the sections are one: `{ id: 'actions', title: page title, items: searchCommandPaletteSection({ items: source.pages[id].items, query, config: { ...commandPaletteSearchConfig.actions, limit: 50 } }) }`.
  - `handleSelect`: a row with `page` opens it (store the text and highlight, empty the text, highlight the first item with `current === true`, else the first); a row with `keepOpen`, or with `current !== undefined` while a page is open, runs `onSelect` and stays; everything else as today.
  - Back (Escape with a page open, Backspace with an empty field and a page open, the chip): restore the stored text and highlight, close the page, stop the key from closing the dialog. The composing guard at the top of `handleKeyDown` already covers Backspace.
  - With a page open: no tab row, no tab stepping on Tab or the arrows, `useMessages(query, false)`, `usePeople(query, false)`, the input's `aria-label` is the page's title, the footer's Tab hint becomes `esc` with `t('thread.back')`.
  - The chip: a `button` before the input with `data-page-chip`, `aria-label={t('thread.back')}`, a `ChevronLeft` icon (`aria-hidden`) and the page's title; a click goes back and focuses the input. Class `css.PageChip` (pill, quiet fill, `flex: 'none'`, 44 px tall hit area under `(pointer: coarse)`).
- [ ] **Step 4:** Run `nix develop -c just test src/app/command-palette && nix develop -c just strict`. Expected: PASS.
- [ ] **Step 5:** Commit: `Command palette: pages of choices, and rows that keep it open`.

### Task 4: Page rows and the system theme rule

**Files:**
- Create: `src/app/command-palette/commandPalettePages.ts`, `commandPalettePages.test.ts`
- Modify: `src/app/theme/useTheme.ts`, `src/app/theme/useTheme.test.ts`, `src/app/settings/pages/Appearance.tsx`

**Interfaces:**
- Produces:

```ts
// commandPalettePages.ts
export type CommandPaletteChoice = { value: string; title: string; current: boolean };
/** A page's choices as rows `<pageId>:<value>`, in the given order (sortRank descends), searched by title only. */
export const getCommandPalettePageRows = (
  pageId: CommandPalettePageId,
  choices: readonly CommandPaletteChoice[]
): CommandPaletteActionItem[];
/** The rows as the first list's search shows them: tagged with their page's title. */
export const tagCommandPalettePageRows = <T extends CommandPaletteActionItem>(
  pageTitle: string,
  rows: readonly T[]
): T[];

// theme/useTheme.ts
/** The settings after the System Theme switch is set: turned on, the deployment's default theme becomes the pick of its kind. */
export const withSystemTheme = <T extends ThemeSettings>(
  settings: T,
  deploymentTheme: Theme | undefined,
  on: boolean
): T;

// settings/pages/Appearance.tsx
export const LAYOUT_CHOICES; // was module-private; unchanged value
```

- [ ] **Step 1: Failing tests.**
  - `commandPalettePages.test.ts`: `getCommandPalettePageRows('theme', [{ value: 'light-theme', title: 'Light', current: false }, { value: 'dark-theme', title: 'Dark', current: true }])` equals two rows with ids `theme:light-theme`, `theme:dark-theme`, `kind: 'action'`, `sortRank` 2 then 1, `current` false then true, and no `keywords`, `description` or `tag`. `tagCommandPalettePageRows('Theme', rows)` gives the same rows with `tag: 'Theme'`. Review Focus 1: `searchCommandPaletteSection({ items: [pageRow, ...tagged], query: 'theme', config: commandPaletteSearchConfig.actions })` with `pageRow = { id: 'page-theme', kind: 'action', title: 'Theme', page: 'theme' }` returns only `pageRow`.
  - `useTheme.test.ts`: `withSystemTheme` turned on with a dark deployment theme and no `darkThemeId` sets `useSystemTheme: true` and `darkThemeId` to the deployment theme's id; with a stored `darkThemeId` keeps it; turned off, or without a deployment theme, changes only `useSystemTheme`.
- [ ] **Step 2:** Run both test files. Expected: FAIL (missing exports).
- [ ] **Step 3:** Implement. `withSystemTheme` is the body of `setFollowSystem` in `Appearance.tsx`, which now calls it. Export `LAYOUT_CHOICES`.
- [ ] **Step 4:** Run `nix develop -c just test src/app/command-palette/commandPalettePages.test.ts src/app/theme src/app/settings && nix develop -c just strict`. Expected: PASS.
- [ ] **Step 5:** Commit: `Command palette: the rows of a page of choices`.

### Task 5: Settings as rows, and Settings opening at a setting

**Files:**
- Create: `src/app/command-palette/commandPaletteSettings.ts`, `commandPaletteSettings.test.ts`, `src/app/settings/useSettingsSearchValues.ts`
- Modify: `src/app/settings/settingsSearchIndex.ts` (+ its test), `src/app/settings/Settings.tsx`, `SettingsModalRenderer.tsx` (+ its test), `src/app/navigation/settingsModal.ts`, `src/app/preferences/settings.ts`

**Interfaces:**
- Produces:

```ts
// preferences/settings.ts
export type BooleanSettingKey; // was module-private

// settings/settingsSearchIndex.ts
/** A setting's text in the active language: what its search and its rows elsewhere show. */
export type SettingText = { label: string; description: string; keywords: string[]; location: string[] };
export const getSettingText = (
  setting: SettingDefinition,
  t: SettingsTranslate,
  values?: SettingsSearchValues
): SettingText; // `searchSettings` builds its fields and location from it

// settings/useSettingsSearchValues.ts
export const useSettingsSearchValues = (): SettingsSearchValues; // `useSearchValues` moved out of Settings.tsx

// navigation/settingsModal.ts
export type SettingsModalState = { initialPage?: SettingsPage; initialSetting?: string; requestId?: string };
// Settings and SettingsModalRenderer: prop `initialSetting?: string`, the dialog's first target ({ id, seq: 0 }).

// command-palette/commandPaletteSettings.ts
/** The settings whose page shows a plain switch: the stored field, and whether the switch shows its opposite. */
export const COMMAND_PALETTE_SETTING_SWITCHES: Readonly<
  Record<string, { key: BooleanSettingKey; inverted?: boolean }>
>;
export type CommandPaletteSettingRow = {
  item: CommandPaletteActionItem;
  setting: SettingDefinition;
  /** Set for a switch setting. */
  switch?: { key: BooleanSettingKey; inverted?: boolean };
};
export const getCommandPaletteSettingRows = (
  settings: readonly SettingDefinition[],
  stored: Pick<Settings, BooleanSettingKey>,
  t: SettingsTranslate,
  values?: SettingsSearchValues
): CommandPaletteSettingRow[];
```
- Switch map (setting id to field): `enterForNewline` `enterForNewline`; `markdown` `isMarkdown`; `hideMembershipEvents`; `hideNickAvatarEvents`; `showToolCalls`; `mediaAutoLoad` `mediaAutoLoad` inverted; `urlPreview`; `hideActivity`; `encUrlPreview`; `developerTools`; `showHiddenEvents`; `errorReports` `sendErrorReports`; `notificationSound` `isNotificationSounds`.
- Left out (covered elsewhere): `systemTheme`, `theme`, `lightTheme`, `darkTheme`, `messageLayout`, `language`, `tour`.
- A row's `item`: `id: 'setting:<id>'`, `title` the label, `description` the location joined with ` › `, `keywords` the search words plus the description, `tag: t('settings.title')`, `icon: Icons.Setting`, `sortRank: 0`, and for a switch `state` (`stored[key] !== !!inverted ? 'on' : 'off'`) with `keepOpen: true`.

- [ ] **Step 1: Failing tests.**
  - `commandPaletteSettings.test.ts` with the real registry (`getShownSettings(context)`) and a `t` that returns the key: every key of `COMMAND_PALETTE_SETTING_SWITCHES` is a registry setting id; `markdown` with `isMarkdown: true` has `state: 'on'` and `keepOpen: true`; `mediaAutoLoad` with `mediaAutoLoad: true` has `state: 'off'`; `pageZoom` has no `state`, no `keepOpen` and no `switch`; none of the seven left-out ids has a row; with `developerTools: false` in the context `accessToken` has no row (Review Focus 4); a row's description joins its page label and group label with ` › `; every row has the tag and `sortRank: 0`.
  - `settingsSearchIndex.test.ts`: `getSettingText` returns the label, the split search words and the location `[page, group, Advanced]` without repeats, for one plain and one advanced setting.
  - `SettingsModalRenderer.test.ts`: a state with `initialSetting: 'pageZoom'` reaches `Settings` as that prop.
- [ ] **Step 2:** Run the three files. Expected: FAIL.
- [ ] **Step 3:** Implement. `Settings` starts its `target` state from `initialSetting`; the existing effect reveals it.
- [ ] **Step 4:** Run `nix develop -c just test src/app/command-palette/commandPaletteSettings.test.ts src/app/settings src/app/preferences && nix develop -c just strict`. Expected: PASS.
- [ ] **Step 5:** Commit: `Command palette: settings as rows; Settings opens at a setting`.

### Task 6: The open room's header publishes its commands

**Files:**
- Create: `src/app/navigation/roomCommands.ts`, `roomCommands.test.tsx`
- Modify: `src/app/room/RoomViewHeader.tsx`
- Test: `src/app/room/RoomViewHeader.commands.test.tsx` (copy the mocks of `RoomViewHeader.filterButton.test.tsx`)

**Interfaces:**
- Produces:

```ts
// navigation/roomCommands.ts
export type RoomCommand = {
  id: string;
  label: string;
  icon: IconSrc;
  /** For a toggle: whether it is on. */
  pressed?: boolean;
  shortcut?: ShortcutId;
  run: () => void;
};
/** Offers `commands` while the calling component is mounted; the one mounted last is the one read. */
export const useRoomCommands = (commands: readonly RoomCommand[]): void;
/** The commands of the room header on screen now; none without one. */
export const getRoomCommands = (): readonly RoomCommand[];
```
  Module-level state like `shortcuts/useShortcut.ts` (a stack of refs written on render, pushed and removed in an effect), no atom.

- [ ] **Step 1: Failing tests.**
  - `roomCommands.test.tsx` (jsdom): no component mounted gives `[]`; a mounted one gives its latest commands after a re-render with new ones; of two mounted the later one is read; unmounting it reads the first again; unmounting both gives `[]`.
  - `RoomViewHeader.commands.test.tsx`: with the header rendered in a room with agents and a filter bar, `getRoomCommands()` holds `filterBar` (with `pressed`), `toolCalls`, `members` (with `shortcut: 'members'`), no entry with a `popup` (`pins`) and none of the header-drawn controls (`schedules`, `canvas`, `call`); running `filterBar`'s `run` flips the stored `hideThreadFilterBar`.
- [ ] **Step 2:** Run both. Expected: FAIL.
- [ ] **Step 3:** Implement. In `RoomViewHeader.tsx`, after `entries`: `useRoomCommands(entries.filter(drawnByHeader).filter((entry) => !entry.popup).map(({ id, label, icon, pressed, shortcut, run }) => ({ id, label, icon, pressed, shortcut, run: () => run(undefined) })))`. The hook call must sit before any early return of the component.
- [ ] **Step 4:** Run `nix develop -c just test src/app/navigation/roomCommands.test.tsx src/app/room && nix develop -c just strict && nix develop -c just lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `Room header: its actions are offered as room commands`.

### Task 7: The rows wired to the app

**Files:**
- Create: `src/app/command-palette/useCommandPaletteCommands.ts`, `useCommandPaletteCommands.test.tsx`
- Modify: `src/app/command-palette/commandPaletteActions.ts` (+ test), `commandPaletteItems.ts`, `commandPaletteItems.tour.test.tsx` (mock `./useCommandPaletteCommands` to empty rows and empty pages)

**Interfaces:**
- Consumes: Tasks 2 to 6.
- Produces:

```ts
// useCommandPaletteCommands.ts
export type CommandPaletteCommands = {
  /** Rows for the first list, beside the fixed actions. */
  actions: Executable<CommandPaletteActionItem>[];
  /** Rows only typed text finds: the settings and the pages' choices, tagged. */
  searchOnly: Executable<CommandPaletteActionItem>[];
  pages: Record<CommandPalettePageId, CommandPalettePage>;
};
/** `room` is the open room, or the source's stand-in room while none is open (`inRoom` false). */
export const useCommandPaletteCommands = (options: {
  room: Room;
  inRoom: boolean;
  threadId: string | undefined;
}): CommandPaletteCommands;
```
- `commandPaletteActions.ts`: `actionItem`'s options also take `icon`, `shortcut`, `page`. New quick action ids `page-theme` (title `settings.general.appearance.theme`, rank 25, icon `Sun`, keywords `['appearance', 'dark', 'light', 'colors']`), `page-message-layout` (`settings.general.messages.messageLayout`, rank 18, icon `Message`, keywords `['modern', 'compact', 'bubble']`), `page-language` (`settings.general.language.appLanguage`, rank 17, icon `Globe`, keywords `['locale', 'translation']`), each with its `page`. Shortcuts: `open-settings` gets `settings`; `resolve-current-thread` and `unresolve-current-thread` get `resolveThread`. Icons: `open-settings` `Setting`, `go-home` `Home`, `go-direct` `Message`, `go-activity` `Bell`, `create-room` `HashPlus`, `create-space` `SpacePlus`, `toggle-theme` `Sun`, the tours `Info`, `logout` `Power`, `mark-current-room-read` `CheckTwice`, `copy-current-room-link` `Link`, `open-current-room-settings` `Setting`, resolve and unresolve `Check`.
- The hook's rows:
  - Settings: `getCommandPaletteSettingRows(getShownSettings(useSettingsContext()), useAtomValue(settingsAtom), t, useSettingsSearchValues())`. A switch row's `onSelect` writes `store.set(settingsAtom, { ...store.get(settingsAtom), [key]: !store.get(settingsAtom)[key] })`; another row's sets `settingsModalAtom` to `{ initialPage: setting.page, initialSetting: setting.id, requestId: 'palette:' + setting.id }`.
  - Theme page: first `{ id: 'theme:system', title: t('settings.general.appearance.systemTheme'), state from themeSettingsAtom.useSystemTheme, keepOpen: true, sortRank above the choices }` whose `onSelect` writes `withSystemTheme(settings, deploymentTheme, !on)`; then `getCommandPalettePageRows('theme', THEMES.map(theme => ({ value: theme.id, title: t('options.themeName.' + theme.name), current: theme.id === useTheme().id })))`, each writing `{ ...settings, themeId: value, useSystemTheme: false }`.
  - Message layout page: `LAYOUT_CHOICES` (value `String(layout)`), writing `messageLayout`.
  - Language page: `APP_LANGUAGES` by `nativeName`, current `useAppLanguageCode()`, `onSelect` `void i18n.changeLanguage(code)`.
  - `searchOnly`: the setting rows, then each page's rows through `tagCommandPalettePageRows(page.title, ...)`.
  - Agent calls (only `inRoom` and `!room.isCallRoom()`): for each of `useAgentCallCandidates(room, threadId)` a row `id: 'call-agent:<userId>'`, `title: t('mindroomUi.calls.agentCallHeaderButton.callAgent', { name })`, `description: room.name`, `icon: Icons.Phone`, `sortRank: 75`, `keywords: ['voice', 'agent']`; `onSelect` calls `useAgentCaller({ announce: true }).call({ agentUserId, displayName, roomId: room.roomId, threadId })` and ignores the promise.
  - Room commands (read once: `useState(getRoomCommands)`): rows `id: 'room-command:<id>'`, `title: label`, `description: room.name`, `icon`, `shortcut`, `state` from `pressed` when it is defined, no `keepOpen` (the palette read the commands once, so it could not show the new state), `sortRank: 45`, `onSelect: run`.
  - Shortcut commands: for `help` (rank 15), `nextUnread` (14), `previousUnread` (13), `roomList` (12), read once with `hasShortcutHandler`: `id: 'shortcut:<id>'`, `title: t(SHORTCUTS[id].labelKey)`, `shortcut: id`, `onSelect: () => runShortcut(id, new KeyboardEvent('keydown'))`.
- `commandPaletteItems.ts`: `actions` = the quick actions then the hook's `actions`; `searchActions` = `actions` then `searchOnly` (one memo, so the search index is reused); `pages` from the hook.

- [ ] **Step 1: Failing tests.**
  - `commandPaletteActions.test.ts`: the three page rows exist with their `page`, rank and icon; `open-settings` has `shortcut: 'settings'`.
  - `useCommandPaletteCommands.test.tsx` (jsdom, `renderHook` in a jotai `Provider`, mocking `../settings/useSettingsContext`, `../settings/useSettingsSearchValues`, `../calls/agent/AgentCallHeaderButton` (`useAgentCallCandidates`), `../calls/agent/agentCaller` (`useAgentCaller`), `../theme/useTheme` (`useTheme` only), `../navigation/roomCommands`, `../shortcuts/useShortcut`):
    - choosing `setting:markdown` flips `settingsAtom`'s `isMarkdown` and the re-rendered row's `state` follows;
    - choosing `setting:pageZoom` sets `settingsModalAtom` to `{ initialPage: 'appearance', initialSetting: 'pageZoom', requestId: 'palette:pageZoom' }`;
    - the theme page lists `theme:system` first, then one row per entry of `THEMES` in order, with `current` on the mocked theme's id; choosing `theme:dracula-theme` stores `themeId: 'dracula-theme'` and `useSystemTheme: false`; choosing `theme:system` stores `useSystemTheme: true`;
    - the message layout page has three rows and choosing Bubble stores `MessageLayout.Bubble`;
    - the language page has 17 rows and choosing `language:nl` calls `i18n.changeLanguage('nl')`;
    - `searchOnly` holds `theme:dracula-theme` with `tag` equal to the theme page's title;
    - with one candidate `{ userId: '@mindroom_research:example.org', displayName: 'Research' }` and `inRoom` true, `actions` holds `call-agent:@mindroom_research:example.org` and choosing it calls `call` with `{ agentUserId, displayName: 'Research', roomId: room.roomId, threadId: '$thread' }`; with `inRoom` false or a call room there is no such row;
    - with `getRoomCommands` returning `[{ id: 'viewSwitch', label: 'Compact view', pressed: true, icon, run }]` there is `room-command:viewSwitch` with `state: 'on'` and no `keepOpen`, and choosing it calls `run`;
    - `shortcut:help` exists only while `hasShortcutHandler('help')` is true, and choosing it calls `runShortcut` with `'help'`.
- [ ] **Step 2:** Run both test files. Expected: FAIL.
- [ ] **Step 3:** Implement as above.
- [ ] **Step 4:** Run `nix develop -c just test src/app/command-palette && nix develop -c just strict && nix develop -c just typecheck && nix develop -c just lint`. Expected: PASS.
- [ ] **Step 5:** Commit: `Command palette: settings, themes, agent calls, room commands and shortcuts`.

### Task 8: End-to-end spec, full check

**Files:**
- Create: `e2e/command-palette/command-palette-commands.spec.ts` (accounts, login and `pressPaletteShortcut` as in `e2e/command-palette/command-palette-topics.spec.ts`)

- [ ] **Step 1:** Write the spec, one test each:
  - "a theme from the Theme page": open the palette, type `theme`, Enter on `Theme`; the chip shows `Theme`; type `dracula`, Enter; `document.body` has the class `dracula-theme`, the palette is still open with a check on Dracula; Escape shows the tabs again; Escape closes; the class stays after a reload.
  - "a switch setting flips in place": type `markdown formatting`; the row shows `On`; Enter; it shows `Off` and the palette is open; open Settings on Chats: the Markdown Formatting switch is off.
  - "another setting opens Settings at it": type `page zoom`, Enter; the Settings dialog is open on Appearance and `[data-setting-id="pageZoom"]` has `data-settings-highlight`.
  - "a room command": in a room, type `compact view`, Enter; `[data-room-view-switch]` flips its `aria-pressed`.
- [ ] **Step 2:** Run `nix develop -c just hs-up`, then `E2E_PORT=4377 E2E_REUSE_EXISTING_SERVER=0 nix develop -c npx playwright test e2e/command-palette --project=chromium`. Expected: the new spec and the three existing palette specs PASS.
- [ ] **Step 3:** Run `nix develop -c just check`. Expected: PASS. Fix what it reports.
- [ ] **Step 4:** Commit: `Command palette commands: end-to-end spec`.
