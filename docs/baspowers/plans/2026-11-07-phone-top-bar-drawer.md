# Phone Top Bar and Navigation Drawer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:executing-plans (native): the tasks share one layout tree and one state atom, so one implementer holding all of it is cheaper than handing interfaces between agents; one fresh reviewer checks the branch at the end.

**Goal:** On phones, a fixed top bar (menu, search with shortcut hint, account) and a drawer holding the rail and the section's list that slides in over the page.

**Architecture:** One jotai atom (`navigation/phoneNavDrawer.ts`) holds whether the drawer is open; a pure function decides it on each navigation from the navigation type and whether the new route is a section index (route `handle`). `ClientLayout` keeps one element tree on every size; on phones it renders the top bar and the drawer, and the section's list is portaled into the drawer.

**Tech Stack:** React 18, react-router 6 data router, jotai, vanilla-extract, folds, Vitest, Playwright.

**Spec:** `docs/baspowers/specs/2026-11-07-phone-top-bar-drawer-design.md`

## Global Constraints

- Phones only: `useScreenSizeContext() === ScreenSize.Mobile`; Tablet and Desktop render as before (same DOM boxes: the page wrapper is `display: contents` there).
- Lane C rules: `just strict`, type-aware ESLint, logical CSS sides (`insetInlineStart`, `paddingInline`), `PopOut`/`TooltipProvider` from `ui/directional.tsx`.
- Layers: the atom lives in `navigation/` (layer 4); top bar and drawer in `sidebar/` (13); `shell/` places them.
- No upstream lines: `scripts/upstream-overlap/check.py` reports 0 findings for every commit.
- No em dashes; unsigned commits by explicit path.
- Tests run on a runner (`~/repos/dev/scripts/mac-runner/remote-test.sh`), not on pc.

## Review Focus

1. Same-URL activation in the drawer (tapping the room already open): drawer must close. Test in Task 2 e2e.
2. Redirect at a section root (space root to lobby, Inbox to Invites) while the drawer is open: it must stay open. Unit test in Task 1, e2e in Task 5.
3. A menu or dialog open over the drawer and Escape: only the menu closes. e2e in Task 5.
4. Thread edge swipe while the drawer is open: nothing happens. Unit test in Task 1.
5. Turning a phone sideways (Mobile to Tablet): the open room stays mounted. e2e in Task 5.

---

### Task 1: Drawer state, open/close rule, section-root route handle

**Files:**
- Create: `src/app/navigation/phoneNavDrawer.ts`, `src/app/navigation/phoneNavDrawer.test.ts`
- Create: `src/app/routes/sectionRoot.ts`
- Modify: `src/app/navigation/useEdgeSwipe.ts` (no swipe while the drawer is open), its test

**Interfaces:**
- Produces: `phoneNavDrawerOpenAtom: PrimitiveAtom<boolean>`; `nextPhoneNavDrawerOpen(open: boolean, sectionRoot: boolean, action: NavigationType): boolean`; `SECTION_ROOT_HANDLE: { readonly sectionRoot: true }`; `isSectionRootHandle(handle: unknown): boolean`.

- [ ] Step 1: tests `nextPhoneNavDrawerOpen`: section root opens for PUSH, POP and REPLACE; non-root closes for PUSH and POP; non-root keeps `open` (true stays true, false stays false) for REPLACE. `isSectionRootHandle(SECTION_ROOT_HANDLE)` true, `undefined`/`{}` false.
- [ ] Step 2: run, expect fail; implement; run, expect pass.
- [ ] Step 3: `useEdgeSwipe` reads the atom and returns early while it is true (add to the effect's deps); test: with the atom true, a qualifying swipe does not call `onSwipe`.
- [ ] Step 4: commit.

### Task 2: Drawer, layout tree, portal, routes

**Files:**
- Create: `src/app/sidebar/PhoneNavDrawer.tsx`, `src/app/sidebar/PhoneNavDrawer.css.ts`
- Modify: `src/app/sidebar/MobileFriendly.tsx` (keep `MobileFriendlyPageNav`, a seam name; drop `MobileFriendlyClientNav`), `src/app/sidebar/Navigation.tsx`, `src/app/shell/ClientLayout.tsx`, `src/app/shell/Router.tsx` (index routes get `handle={SECTION_ROOT_HANDLE}` and render their pages directly), `src/app/shell/clientPages.tsx` (delete `SectionIndex`), `src/app/ui/page/Page.tsx` (no divider logic change needed; check)

**Interfaces:**
- Produces: `PhoneNavDrawer({ nav }: { nav: ReactNode })`; `PhoneNavSlotContext: Context<HTMLElement | null>`; `usePhoneNavDrawerRule(): void` (inside the drawer: `useLocation().key`, `useNavigationType()`, `useMatches()`).
- Consumes: Task 1.

- [ ] Step 1: `PhoneNavDrawer`: scrim button (closes) and panel `[rail][slot]`; panel `id="phone-nav-drawer"`, `aria-label` from `sharedUi.a11y.mainNavigation`'s sibling string for the drawer; `inert` and `data-open` when closed; Escape on window in capture phase unless `hasBlockingPortalOverlay()`; click capture on the panel closes when the target is inside `a[href]`; touch swipe toward the start edge of at least 56 px on the panel closes; edge swipe from the start edge opens (`useEdgeSwipe` with `direction` `back` in left-to-right, `forward` in right-to-left).
- [ ] Step 2: CSS: panel `position: absolute`, `insetBlock: 0`, `insetInlineStart: 0`, `width: min(calc(100% - 56px), 420px)` (rail only when the slot is `:empty`), `transform: translateX(-100%)` closed (`translateX(100%)` under `[dir=rtl]`), `transition: transform 250ms cubic-bezier(0.2, 0, 0, 1), visibility 0s linear 250ms`; open: `transform: none`, `visibility: visible`, no visibility delay; scrim `opacity` 0 to 0.5 over 250 ms; `@media (prefers-reduced-motion: reduce)` no transitions.
- [ ] Step 3: `MobileFriendlyPageNav`: on phones `createPortal(children, slot)` when the slot exists, else nothing.
- [ ] Step 4: `ClientLayout`: children `[phone ? <PhoneTopBar/> : nav, <div page wrapper inert={phone && open}>, phone && <PhoneNavDrawer nav={nav}/>]`; the outer Box is a column on phones.
- [ ] Step 5: focus: opening by the menu button focuses the drawer's selected item (`[aria-current="page"], [aria-selected="true"]`) or the panel; closing with focus inside the panel focuses the menu button (`#phone-nav-menu-button`).
- [ ] Step 6: typecheck, strict, lint, unit suite on a runner; commit.

### Task 3: Top bar

**Files:**
- Create: `src/app/sidebar/PhoneTopBar.tsx`, `src/app/sidebar/PhoneTopBar.css.ts`, `src/app/sidebar/PhoneTopBar.test.tsx`
- Modify: `src/app/sidebar/rail/SettingsTab.tsx` (`placement?: 'rail' | 'bar'`), `src/app/account/switcher/AccountMenu.tsx` (`position?: 'Right' | 'Bottom'`, default `Right`), `src/app/sidebar/SidebarNav.tsx` (no `SearchTab`, `SettingsTab` on phones), `src/app/i18n` locale files for new strings

**Interfaces:**
- Produces: `PhoneTopBar()`.
- Consumes: Task 1 atom; `commandPaletteOpenAtom`, `getCommandPaletteShortcutLabel`, `getCommandPaletteAriaKeyShortcuts`; `allRoomsAtom`, `useRoomsUnread`, `roomToUnreadAtom`.

- [ ] Step 1: test (jsdom): renders a button named "Search" whose text includes `getCommandPaletteShortcutLabel()`; clicking it sets `commandPaletteOpenAtom` to `'all'` and the drawer atom to false; the menu button toggles the drawer atom and has `aria-expanded`.
- [ ] Step 2: implement: 52 px bar, `paddingInline: S200`, gap S200, bottom border; menu `IconButton` with a three-line icon (`M4 6h16M4 12h16M4 18h16`, stroke 2), dot when unread; search button flex 1, 36 px, radius 300, border, icon, label, `kbd` badge; `SettingsTab placement="bar"` at the end.
- [ ] Step 3: run on a runner, pass; commit.

### Task 4: Room header on phones (dropped: the room keeps its back chevron, see the spec's decision note)

**Files:**
- Modify: `src/app/room/RoomViewHeader.tsx` (avatar on every size; delete `leaveRoom`, `sectionPathOf` and the phone `PhoneBackButton`; edge swipe opens the drawer), its tests

- [ ] Step 1: update the header tests that expect a phone back button to expect the avatar and no "Back" button.
- [ ] Step 2: implement; run on a runner; commit.

### Task 5: e2e and docs

**Files:**
- Create: `e2e/sidebar/phone-nav-drawer.spec.ts`
- Modify: phone specs the full-suite diff shows failing because of the new model (start with `e2e/ui/phone-back-button.spec.ts`, `e2e/sidebar/phone-back-path.spec.ts`, `e2e/sidebar/phone-room-edge-swipe.spec.ts`, `e2e/sidebar/drawer-motion.spec.ts`)
- Modify: `AGENTS.md` (Product line on phones), `docs/provenance.md` (session row)

- [ ] Step 1: spec at 390 by 844 with touch: top bar visible in a room; menu opens the drawer (rail and list visible, panel `transform` animates, room still in the DOM behind); room pick closes and shows that room; tapping the open room closes; space pick keeps it open with that space's list and the lobby behind; scrim, Escape and menu close; Escape with a rail context menu open only closes the menu; edge swipe opens; reduced motion: no transition; `dir=rtl`: panel at the right; search opens the palette and shows the shortcut; resizing to 844 by 390 keeps the room mounted.
- [ ] Step 2: full e2e suite at the base commit and at the branch tip on gce; fix or update every new failure.
- [ ] Step 3: overlap check (0 findings), gate, commit.
