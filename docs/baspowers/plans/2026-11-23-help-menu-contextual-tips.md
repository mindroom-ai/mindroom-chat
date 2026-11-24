# Help Menu & Contextual UI Tips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task following TDD and frequent commits in `/home/basnijholt/repos/worktrees/mindroom-chat-help-tips`. Steps use checkbox (`- [ ]`) syntax.

**Execution:** Single `gemini4_neon@xhigh` subagent executing tasks 1-5 sequentially on branch `feat/help-menu-contextual-tips`, followed by fresh `opus` and `astra` full-diff reviews.

**Goal:** Add a quiet `?` Help & guides menu (desktop rail + phone top bar) with direct jumps into the existing animated Tour and keyboard shortcuts, plus a one-time contextual suggestion when unresolved threads pile up without any being resolved.

**Architecture:** Extend `tourAtom` with an optional `initialStep`, persist dismissed tip IDs in `io.mindroom.settings`, evaluate contextual tips purely from `crossRoomThreadIndexAtom`, and build `HelpMenu`, `ContextualTipNotice`, and `HelpTab` directly on existing MindRoom Chat primitives (`PopOut`, `GlassPrimitives`, `NoticeSlot`, `TourOffer.css`, `SidebarItem`).

**Tech Stack:** TypeScript (strict), React 19, Jotai, Folds + Vanilla Extract CSS, i18next (17 locale overlays), Vitest + Testing Library.

**Spec:** `docs/baspowers/specs/2026-11-23-help-menu-contextual-tips-design.md`

## Global Constraints

- 100% client-only; no backend or protocol changes.
- Respect `.eslintrc.cjs` `LAYERS`: `navigation` (Layer 4), `preferences` (Layer 1), `tour` (Layer 12), `sidebar` (Layer 14), `shell` (Layer 15). No new domain directory.
- Import `Menu`, `Surface` from `src/app/ui/glass/GlassPrimitives` and `PopOut` from `src/app/ui/directional` (never raw `folds`).
- Use logical CSS properties in `.css.ts` (`inlineSize`, `blockSize`, `paddingInline`, `marginBlockStart`, etc.).
- No em dashes in code comments, docs, or commit messages.
- Soft size target: ~350-450 net production lines, ~1:1 test:prod ratio testing real user flows and invariants (not mock-permutation sprawl).
- Every commit uses `git -c commit.gpgsign=false commit --trailer "Assisted-by: ..."` with explicit file paths (never `git add -A`, never `git stash`).

## Review Focus

1. **Account switch isolation:** Switching from account A (who dismissed `'resolve_threads'` during an in-flight or failed write) to account B must not suppress account B's tip, and `accountState.test.ts` must pass without uncategorized module-level atoms.
2. **Pre-bootstrap / pre-sync suppression:** Before `useServerSyncApplied` and `crossRoomThreadIndexAtom.bootstrapped` are both true, no contextual tip card or `?` dot may flash.
3. **Snoozed & archived exclusion:** Snoozed threads (`snoozedUntilTs > now`) and archived rooms must not trigger the unresolved-thread tip; any single resolved thread anywhere must immediately suppress it.
4. **TourOffer priority & `offerAtStart: false`:** `ContextualTipNotice` must wait until `TourOffer` is answered and never appear while `tourAtom` is open or when `tour.offerAtStart === false` (while `?` Help menu remains usable).
5. **17-locale i18n parity & plural rules:** Every new key in `en.json` must exist in all 16 other `src/app/i18n/locales/additions/*.json` files with exact `Intl.PluralRules` categories passing `localeAdditions.test.ts`.

---

### Task 1: Direct-step Tour Opening & Persistent `dismissedTips` Setting

**Files:**
- Modify: `src/app/navigation/tourState.ts`
- Modify: `src/app/tour/tourSteps.ts`
- Modify: `src/app/tour/TourDialog.tsx`
- Modify: `src/app/tour/TourRenderer.tsx`
- Modify: `src/app/preferences/accountSettings.ts`
- Modify: `src/app/shell/accountState.test.ts`
- Test: `src/app/tour/tourSteps.test.ts`, `src/app/tour/TourDialog.test.tsx`, `src/app/tour/TourRenderer.test.tsx`, `src/app/preferences/accountSettings.test.ts`

**Interfaces:**
- Produces in `src/app/navigation/tourState.ts`:
  - `export type TourStepId = 'conversation' | 'start' | 'reply' | 'title' | 'order' | 'states' | 'resolve' | 'filters' | 'snooze' | 'pinAndTag' | 'views' | 'activity';`
  - `export type TourRequest = { level: TourLevel; initialStep?: TourStepId };`
  - `export const tourAtom = atom<TourRequest | undefined>(undefined);`
  - `export const dismissedTipsSessionAtom = atom<ReadonlyMap<string, ReadonlySet<string>>>(new Map());`
- Produces in `src/app/tour/tourSteps.ts`:
  - `export type { TourStepId } from '../navigation/tourState';`
  - `export const stepIndexOf = (level: TourLevel, stepId?: TourStepId): number`
- Produces in `src/app/preferences/accountSettings.ts`:
  - `AccountSettings.dismissedTips: readonly string[]` (default `EMPTY_STRING_IDS`)

- [ ] **Step 1: Add unit tests for `stepIndexOf`, `TourDialog` `initialStep`, `TourRenderer` `initialStep`, and `dismissedTips` sanitization.**
- [ ] **Step 2: Run targeted tests to verify they fail.**
  Run: `nix develop -c npx vitest run src/app/tour/tourSteps.test.ts src/app/tour/TourDialog.test.tsx src/app/tour/TourRenderer.test.tsx src/app/preferences/accountSettings.test.ts`
- [ ] **Step 3: Implement `TourStepId` & `dismissedTipsSessionAtom` in `tourState.ts`, `stepIndexOf` in `tourSteps.ts`, `initialStep` prop in `TourDialog.tsx` and `TourRenderer.tsx`, `dismissedTips` in `accountSettings.ts`, and register `dismissedTipsSessionAtom` in `accountState.test.ts` `keptAtoms`.**
- [ ] **Step 4: Run tests including `src/app/shell/accountState.test.ts` and verify all pass.**
- [ ] **Step 5: Commit.**

---

### Task 2: Contextual Tip Evaluator & Hook

**Files:**
- Create: `src/app/tour/contextualTips.ts`
- Create: `src/app/tour/useContextualTip.ts`
- Test: `src/app/tour/contextualTips.test.ts`

**Interfaces:**
- Consumes: `CrossRoomThreadIndexEntry`, `crossRoomThreadIndexAtom`, `archivedRoomsAtom`, `useSelectedRoom`, `useServerSyncApplied`, `useAccountData`, `useSetAccountSettings`, `tourAtom`, `dismissedTipsSessionAtom`.
- Produces in `src/app/tour/contextualTips.ts`:
  - `export const RESOLVE_TIP_ID = 'resolve_threads';`
  - `export const RESOLVE_TIP_MIN_OPEN = 5;`
  - `export const RESOLVE_TIP_MIN_OLD = 3;`
  - `export const RESOLVE_TIP_OLD_AGE_MS = 24 * 60 * 60 * 1000;`
  - `export type ContextualTipId = typeof RESOLVE_TIP_ID;`
  - `export type ContextualTip = { id: ContextualTipId; tourStep: TourStepId; scope: 'room' | 'all'; openCount: number };`
  - `export const evaluateContextualTip = (input: { entries: Iterable<CrossRoomThreadIndexEntry>; selectedRoomId?: string; archivedRooms: ReadonlySet<string>; dismissedTips: ReadonlySet<string>; now: number }): ContextualTip | undefined`
- Produces in `src/app/tour/useContextualTip.ts`:
  - `export type ContextualTipState = { tip: ContextualTip | undefined; dismissTip: (tipId: ContextualTipId) => void; openTipTour: (tip: ContextualTip) => void };`
  - `export function useContextualTip(): ContextualTipState`

- [ ] **Step 1: Write failing tests in `src/app/tour/contextualTips.test.ts` covering all boundaries (4 vs 5 open, 2 vs 3 old at 24h, any resolved suppresses, snoozed excluded, archived rooms excluded, dismissed tip suppressed, room vs all scope).**
- [ ] **Step 2: Run test to verify failure.**
- [ ] **Step 3: Implement `contextualTips.ts` and `useContextualTip.ts` (gating `tip` on `synced && index.bootstrapped`, persisting `dismissedTips` safely after sync, updating `dismissedTipsSessionAtom` immediately per `sessionId`).**
- [ ] **Step 4: Run `contextualTips.test.ts` and verify pass.**
- [ ] **Step 5: Commit.**

---

### Task 3: Locale Strings Across All 17 Language Overlays

**Files:**
- Modify: `src/app/i18n/locales/additions/en.json`
- Modify: all 16 other `src/app/i18n/locales/additions/*.json` (`ar`, `bn`, `de`, `es`, `fr`, `hi`, `id`, `it`, `ja`, `ko`, `nl`, `pt`, `ru`, `tr`, `zh`, `zh-TW`)

**Interfaces:**
- Adds `helpMenu` and `contextualTips` keys under `tour` (or top-level `helpMenu` / `tour.help` & `tour.tips`):
  - Button / aria labels: `tour.help.button`, `tour.help.buttonWithTip`
  - Menu header: `tour.help.title`, `tour.help.subtitle`, `tour.help.oneTip`
  - Suggested card: `tour.help.suggested`, `tour.help.showHow`, `tour.help.dismissTip`
  - Guides section: `tour.help.guidesHeading`, guide labels (`conversation`, `resolve`, `filters`, `snooze`, `pinAndTag`, `views`, `activity`), footer buttons (`fullTour`, `shortcuts`)
  - Resolve tip copy: `tour.tips.resolve.title`, `tour.tips.resolve.cardTitle`, `tour.tips.resolve.roomSummary` (`{{count}} open threads here, none resolved yet`), `tour.tips.resolve.allSummary` (`{{count}} open threads, none resolved yet`), `tour.tips.resolve.cardTextRoom`, `tour.tips.resolve.cardTextAll`

- [ ] **Step 1: Add English strings to `src/app/i18n/locales/additions/en.json` and idiomatic translations to all 16 other overlays (using exact `Intl.PluralRules` categories if any pluralized keys are used, or non-pluralized keys where count is always >= 3).**
  Note: because `openCount` is always >= 3 (min threshold is 3 old or 5 open), non-pluralized strings with `{{count}}` avoid awkward singulars while keeping localization clean (Wait: check `ar`/`ru` plural rules for numbers like 3, 5, 21 — actually even better, use standard `_one`/`_other` etc. or natural count phrasing! Follow whatever passes `localeAdditions.test.ts` and `i18nPluralRules.test.ts`).
- [ ] **Step 2: Run `nix develop -c npx vitest run src/app/i18n/` and verify every i18n test passes.**
- [ ] **Step 3: Commit.**

---

### Task 4: `HelpMenu`, `HelpTab`, and `ContextualTipNotice` UI Components

**Files:**
- Create: `src/app/tour/HelpMenu.css.ts`
- Create: `src/app/tour/HelpMenu.tsx`
- Create: `src/app/tour/ContextualTipNotice.tsx`
- Create: `src/app/sidebar/rail/HelpTab.tsx`
- Modify: `src/app/sidebar/SidebarNav.tsx`
- Modify: `src/app/sidebar/PhoneTopBar.tsx`
- Modify: `src/app/shell/ClientShell.tsx`
- Test: `src/app/tour/HelpMenu.test.tsx`, `src/app/tour/ContextualTipNotice.test.tsx`, `src/app/sidebar/rail/HelpTab.test.tsx`
- Update existing tests: `src/app/sidebar/SidebarNav.buttons.test.tsx`, `src/app/sidebar/PhoneTopBar.test.tsx`

**Interfaces:**
- `HelpMenu({ anchor, below, onClose }: { anchor: HTMLElement; below?: boolean; onClose: () => void })`
- `HelpTab({ inTopBar, className }: { inTopBar?: boolean; className?: string })`
- `ContextualTipNotice()`

- [ ] **Step 1: Implement `HelpMenu.css.ts` and `HelpMenu.tsx` reusing `PopOut` (`ui/directional`), `Menu` (`ui/glass/GlassPrimitives`), `FocusTrap`, `ShortcutHint`, `useContextualTip`, `tourAtom`, and `shortcutHelpOpenAtom`. Keep styling clean, logical properties only, matching `AccountMenu.css.ts` tokens.**
- [ ] **Step 2: Implement `ContextualTipNotice.tsx` reusing `TourOffer.css.ts`, `Surface`, `useNoticePresence`, `listNoticeSlotAtom`, `pageNoticeSlotAtom`, `useContextualTip`, gating on `offerAtStart && !tourFirst && hasPlace && tip !== undefined`. Mount in `ClientShell.tsx` after `<TourOffer />`.**
- [ ] **Step 3: Implement `HelpTab.tsx` (matching `SettingsTab`/`ActivityTab` rail + `inTopBar` patterns, showing subtle accent dot when `tip !== undefined && !menuButton`). Wire into `SidebarNav.tsx` (sticky stack above `<SettingsTab />`) and `PhoneTopBar.tsx` (before `<SettingsTab inTopBar />`).**
- [ ] **Step 4: Write focused tests (`HelpMenu.test.tsx`, `ContextualTipNotice.test.tsx`, `HelpTab.test.tsx`) and update `SidebarNav.buttons.test.tsx` and `PhoneTopBar.test.tsx`.**
- [ ] **Step 5: Run targeted tests + `just typecheck` + `just strict` + `just lint` + `npx vite build`.**
- [ ] **Step 6: Commit.**

---

### Task 5: Docs Update & Full Verification

**Files:**
- Modify: `AGENTS.md` (update the one-sentence tour product summary to mention the `?` Help & guides menu and contextual resolve tip)
- Modify: `docs/configuration.md` (note `tour.offerAtStart` also controls automatic contextual tip cards)

- [ ] **Step 1: Update `AGENTS.md` and `docs/configuration.md`.**
- [ ] **Step 2: Run `just format` on changed files, `just typecheck`, `just strict`, `just lint`, `just test` (affected + `accountState` + `layering` + `i18n`), and `npx vite build`.**
- [ ] **Step 3: Commit.**
