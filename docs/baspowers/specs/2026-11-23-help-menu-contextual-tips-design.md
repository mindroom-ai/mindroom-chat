# Help Menu & Contextual UI Tips Design

## Goal

Give MindRoom Chat users a quiet, always-reachable **Help & guides** menu (`?`) to discover UI features on demand, and gently suggest resolving finished threads when open threads accumulate without any being resolved.

## Background

MindRoom Chat already ships a 12-step animated Interface Tour (`src/app/tour/`, Quick 8 steps / Full 12 steps) that demonstrates threads, titles, states, resolving threads (step 7), filters (step 8), snoozing (step 9), pinning/tagging (step 10), room views (step 11), and Activity (step 12). Today, the tour is offered once at first login (`TourOffer`, when the account typically has zero threads) and afterwards is reachable only from Settings -> About, the Command Palette, the Welcome page, or an empty Compact room. Users who dismiss the initial offer often accumulate many old unresolved threads without discovering Resolve.

Bas picked **Variant A** with the `resolve_threads` v1 trigger from the interactive Canvas mockups:

- Quiet `?` Help & guides button in the icon rail (and phone top bar) with a subtle dot while a contextual tip applies.
- Popover menu showing any active contextual suggestion at the top, direct jumps into specific animated Tour steps, Full tour, and Keyboard shortcuts (`Cmd+/` / `Ctrl+/`).
- One-time floating card in the existing `NoticeSlot` (bottom of room list on desktop, top of page on phone) when unresolved threads accumulate and none have been resolved yet.

## Scope & Constraints

- **100% client-only**: no backend or protocol changes. Reuses `src/app/tour/`, `crossRoomThreadIndexAtom`, `NoticeSlot`, `io.mindroom.settings`, and `ShortcutHelpDialog`.
- **Layers (`.eslintrc.cjs`)**:
  - `src/app/navigation/tourState.ts` (Layer 4): holds `TourStepId`, `tourAtom`, `helpMenuOpenAtom`, `tourOfferAnsweredAtom`, and `dismissedTipsSessionAtom`.
  - `src/app/preferences/accountSettings.ts` (Layer 1): persists `dismissedTips: readonly string[]` in `io.mindroom.settings`.
  - `src/app/tour/` (Layer 12): owns contextual tip evaluation (`contextualTips.ts`, `useContextualTip.ts`), the `HelpMenu` popover (`HelpMenu.tsx`, `HelpMenu.css.ts`), the one-time floating notice (`ContextualTipNotice.tsx`), and direct-step support in `TourDialog` / `TourRenderer`.
  - `src/app/sidebar/rail/HelpTab.tsx` (Layer 14): the `?` trigger button for `SidebarNav` and `PhoneTopBar`.
  - `src/app/shell/ClientShell.tsx` (Layer 15): mounts `<ContextualTipNotice />`.
- **Glass, directional, RTL, and a11y**:
  - `Menu` and `Surface` from `src/app/ui/glass/GlassPrimitives`.
  - `PopOut` from `src/app/ui/directional`.
  - Logical CSS properties (`inlineSize`, `paddingInline`, `marginBlockStart`, etc.).
  - `FocusTrap`, `role="menu"` / `role="menuitem"`, arrow-key navigation, Escape to close, focus return to trigger.
- **No spam / no e2e interference**:
  - `ContextualTipNotice` respects `tour.offerAtStart !== false` (the same config switch e2e tests use to suppress automatic offer cards), waits until `TourOffer` is answered and no tour is open, and never shows again once clicked, dismissed, or once any thread is resolved.
  - The `?` Help & guides menu itself stays available regardless of `tour.offerAtStart`.
- **i18n**: all visible strings added to `src/app/i18n/locales/additions/en.json` and all 16 other language overlays with exact plural categories passing `localeAdditions.test.ts`.
- **Size target**: ~350-450 net production lines across focused modules, ~1:1 test:prod ratio testing real user flows and invariants.

## Architecture & Component Design

### 1. Direct-step Tour Opening (`tourState.ts`, `tourSteps.ts`, `TourDialog.tsx`, `TourRenderer.tsx`)

- Move `TourStepId` union type to `src/app/navigation/tourState.ts` and re-export it from `src/app/tour/tourSteps.ts`.
- Extend `tourAtom` payload to `{ level: TourLevel; initialStep?: TourStepId } | undefined`.
- Add `stepIndexOf(level: TourLevel, stepId?: TourStepId): number` in `tourSteps.ts` (returns matching index or `0` if omitted/not found).
- Pass `initialStep?: TourStepId` from `TourRenderer` to `TourDialog`, initializing `position` via `useState(() => stepIndexOf(level, initialStep))`.
- Existing callers passing `{ level: 'quick' }` or `{ level: 'full' }` behave identically.
- Opening a tour from `HelpMenu` or `ContextualTipNotice` sets `{ level: 'full', initialStep }` (or `'quick'` for `'conversation'`), so e.g. jumping to `'resolve'` opens Step 7 of 12, and clicking Next flows naturally to Step 8 (`filters`).

### 2. Persistent Tip Dismissals (`accountSettings.ts`, `tourState.ts`)

- Add `dismissedTips: readonly string[]` to `AccountSettings` in `src/app/preferences/accountSettings.ts` (default `Object.freeze([])`), sanitized with the same string-array sanitizer used for `disabledPlugins` / `enabledPlugins`.
- Add `dismissedTipsSessionAtom = atom<ReadonlyMap<string, ReadonlySet<string>>>(new Map())` in `src/app/navigation/tourState.ts`, keyed by `sessionId` (matching `tourOfferAnsweredAtom`, so switching accounts does not leak dismissals and an in-flight/failed write still keeps the tip dismissed for the page). Register it in `accountState.test.ts` `keptAtoms` with its reason (keyed by session ID, like `tourOfferAnsweredAtom`).

### 3. Contextual Tip Evaluator (`src/app/tour/contextualTips.ts`, `src/app/tour/useContextualTip.ts`)

Pure evaluator `evaluateContextualTip(input): ContextualTip | undefined`:

- Constants:
  - `RESOLVE_TIP_ID = 'resolve_threads'`
  - `RESOLVE_TIP_MIN_OPEN = 8`
  - `RESOLVE_TIP_MIN_OLD = 5`
  - `RESOLVE_TIP_OLD_AGE_MS = 24 * 60 * 60 * 1000` (24 hours)
- Input:
  - `entries: Iterable<CrossRoomThreadIndexEntry>`
  - `selectedRoomId?: string`
  - `archivedRooms: ReadonlySet<string>`
  - `dismissedTips: ReadonlySet<string>`
  - `now: number`
- Rules:
  1. If `dismissedTips.has('resolve_threads')`, return `undefined`.
  2. Scan entries belonging to visible (non-archived) rooms:
     - If ANY entry has `isResolved === true`, return `undefined` (the user already resolves threads).
     - Ignore currently snoozed threads (`entry.snoozedUntilTs !== undefined && entry.snoozedUntilTs > now`).
     - Count `totalOpen`, `totalOld` (`now - entry.lastActivityTs >= RESOLVE_TIP_OLD_AGE_MS`), and when `selectedRoomId` matches `entry.roomId`, also count `roomOpen` and `roomOld`.
  3. If `selectedRoomId` is set and `(roomOpen >= 8 || roomOld >= 5)`:
     return `{ id: 'resolve_threads', tourStep: 'resolve', scope: 'room', openCount: roomOpen }`.
  4. Else if `totalOpen >= 8 || totalOld >= 5`:
     return `{ id: 'resolve_threads', tourStep: 'resolve', scope: 'all', openCount: totalOpen }`.
  5. Otherwise return `undefined`.

Hook `useContextualTip()`:

- Reads `synced = useServerSyncApplied(mx)`, `index = useAtomValue(crossRoomThreadIndexAtom)`, `selectedRoomId = useSelectedRoom()`, `archivedRooms = useAtomValue(archivedRoomsAtom)`, stored `dismissedTips` from `useAccountData(MINDROOM_ACCOUNT_SETTINGS_EVENT_TYPE)`, and session dismissals from `dismissedTipsSessionAtom`.
- Returns `{ tip, dismissTip, openTipTour }`:
  - `tip` is `undefined` until `synced && index.bootstrapped`.
  - `dismissTip(tipId)` adds `tipId` to `dismissedTipsSessionAtom` for `sessionId` and persists merged `dismissedTips` via `setAccountSettings({ dismissedTips: next })` when `synced` (errors ignored cleanly, matching `TourOffer`).
  - `openTipTour(tip)` calls `dismissTip(tip.id)` and `setTour({ level: 'full', initialStep: tip.tourStep })`.
- Note on clock: uses a stable timestamp captured per index version (`useMemo` keyed on `index.version`, `selectedRoomId`, `archivedRooms`, `dismissedKey`) with `Date.now()` so there is no polling timer and no unnecessary re-render churn.

### 4. Help & Guides Popover (`src/app/tour/HelpMenu.tsx`, `src/app/tour/HelpMenu.css.ts`)

- Anchored popover using `PopOut` (`src/app/ui/directional`), `Menu` (`GlassPrimitives`), and `FocusTrap`, following `AccountMenu.tsx` conventions:
  - Desktop (`!below`): `position="Right" align="End" offset={8}`
  - Phone (`below`): `position="Bottom" align="End" offset={8}`
  - Viewport-clamped `maxBlockSize` with `Scroll` / internal scroll body.
  - Keyboard navigation across all `role="menuitem"` buttons (ArrowUp/Down, Home/End, Escape to close, click outside to close, clicking trigger toggles).
- Sections:
  1. **Header**: "Help & guides" + subtle count ("1 tip" when `tip` is active, else "Quick guides").
  2. **Suggested for you** (only when `tip` is defined): highlighted surface box with eyebrow "Suggested for you", title "Resolve finished threads", count line (`{{count}} open threads here, 0 resolved yet` for room scope or `{{count}} open threads, 0 resolved yet` for all scope), primary "Show how" button (calls `openTipTour(tip)` and closes menu), and dismiss `x` icon button (calls `dismissTip(tip.id)`).
  3. **UI guides** (`role="group"`): 7 direct-jump guide rows using existing `folds` / `@tabler/icons-react` icons:
     - `conversation`: "How threads work" (opens `{ level: 'quick', initialStep: 'conversation' }`)
     - `resolve`: "Resolve what is done" (opens `{ level: 'full', initialStep: 'resolve' }`)
     - `filters`: "Find resolved threads" (opens `{ level: 'full', initialStep: 'filters' }`)
     - `snooze`: "Snooze for later" (opens `{ level: 'full', initialStep: 'snooze' }`)
     - `pinAndTag`: "Pin & tag threads" (opens `{ level: 'full', initialStep: 'pinAndTag' }`)
     - `views`: "Compact vs Threads view" (opens `{ level: 'full', initialStep: 'views' }`)
     - `activity`: "Activity & approvals" (opens `{ level: 'full', initialStep: 'activity' }`)
  4. **Split footer** (matching `AccountMenu.tsx`):
     - "Full tour" -> closes menu and opens `{ level: 'full' }`
     - "Shortcuts" (with `ShortcutHint id="help"`) -> closes menu and opens `shortcutHelpOpenAtom` (`true`).

### 5. `?` Trigger Button (`src/app/sidebar/rail/HelpTab.tsx`, `SidebarNav.tsx`, `PhoneTopBar.tsx`)

- `HelpTab({ inTopBar?: boolean; className?: string })`:
  - Renders in `SidebarNav.tsx` sticky bottom stack right above `<SettingsTab />` (always available, not gated on optional rail toggles).
  - Renders in `PhoneTopBar.tsx` right before `<SettingsTab inTopBar />`.
  - Uses a clean question-circle icon (`IconHelpCircle` from `@tabler/icons-react` or `Icons.Help` if `folds` exports one).
  - Shows a subtle accent dot badge when `tip !== undefined` (hidden while menu is open or once tip is dismissed/resolved).
  - Accessible name reflects tip presence ("Help & guides" / "Help & guides (1 tip)").
  - Toggles `<HelpMenu anchor={menuButton} below={inTopBar} onClose={closeMenu} />`.
  - Update `SidebarNav.buttons.test.tsx` and `PhoneTopBar.test.tsx` mocks/assertions cleanly.

### 6. One-time Contextual Tip Card (`src/app/tour/ContextualTipNotice.tsx`, `ClientShell.tsx`)

- Mounted in `ClientShell.tsx` right after `<TourOffer />`.
- Reuses `TourOffer.css.ts` card layout, `Surface`, `useNoticePresence`, and `NoticeSlot` (`listNoticeSlotAtom` / `pageNoticeSlotAtom`).
- `due` condition:
  - `tip !== undefined`
  - `offerAtStart` (`useClientConfig().tour?.offerAtStart !== false`)
  - `!tourFirst` (same check as `MacAppOffer`: waits until `TourOffer` is answered in stored settings or `tourOfferAnsweredAtom`, and never shows while `tourAtom` is open)
  - `!helpMenuOpen` (`helpMenuOpenAtom` is `false`: hides while the `?` Help & guides popover is open so the same tip is never shown twice)
  - `hasPlace` (`listSlot !== null || pageSlot !== null`)
- Clicking **Show how** calls `dismiss()` (leave animation) and `openTipTour(tip)` (dismisses tip in session + `io.mindroom.settings`, opens Tour at step `resolve`).
- Clicking **Dismiss (`x`)** calls `dismiss()` and `dismissTip(tip.id)`.
- If `tip` clears externally (user resolves a thread or dismisses via `?` menu), `due` becomes `false` and `useNoticePresence` hides the card cleanly.
- Note: also update `docs/configuration.md` and `AGENTS.md` product line if needed to note the Help menu and contextual tip behavior.

## Testing Strategy

1. **Unit tests**:
   - `tourSteps.test.ts` + `TourDialog.test.tsx` + `TourRenderer.test.tsx`: `stepIndexOf`, opening directly at `initialStep: 'resolve'`, stepping Next to `filters` and Back to `states`.
   - `accountSettings.test.ts`: sanitizing and merging `dismissedTips` (deduplication, trimming, non-array/garbage resilience).
   - `contextualTips.test.ts`: threshold boundaries (7 open vs 8 open, 4 old vs 5 old at 24h edge, any resolved thread suppresses tip, snoozed threads excluded, archived rooms excluded, dismissed tip suppressed, room scope vs all-rooms scope).
   - `HelpMenu.test.tsx`: renders active suggestion + dismisses it; renders clean state without suggestion; clicking each guide jumps to the right tour step; clicking Full tour opens full tour; clicking Shortcuts opens `shortcutHelpOpenAtom`; Escape closes menu.
   - `ContextualTipNotice.test.tsx`: waits for `TourOffer` and sync; respects `tour.offerAtStart: false`; shows once when triggered; Show how opens tour at `resolve` and persists dismissal; Dismiss persists dismissal; hides automatically when a thread becomes resolved.
   - `HelpTab.test.tsx` + updated `SidebarNav.buttons.test.tsx` & `PhoneTopBar.test.tsx`: renders `?` with/without dot, opens popover in desktop rail and phone top bar.
   - `accountState.test.ts` & `localeAdditions.test.ts`: atom registration and all 17 locale overlays pass.
2. **Quality gates**: `just typecheck`, `just strict`, `just lint`, `just test`, `npx vite build`.
3. **Screenshots (PR requirement)**: throwaway Playwright fixture/spec capturing before (`origin/main`) and after (branch) on desktop (light & dark) and phone (dark) showing the `?` rail button, the open Help & guides popover (with suggestion and clean), the one-time bottom-left tip card, and clicking "Show how" opening the real Tour directly at Step 7 (`resolve`).
