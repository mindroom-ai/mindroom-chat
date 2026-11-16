# Thread Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development. Nine tasks over two repositories, where later tasks consume earlier interfaces (`shownThreadDetails`, `ThreadDetailsList`, the hover card's data attributes) and a slip ships to the production chat; a fresh reviewer per task is worth its cost.

**Goal:** A new client plugin kind, `threadDetails`, shown in a hover card on Compact thread cards and as the first group of the thread's menu (which a long press now opens on phones), and the pull request plugin's first contribution of it.

**Architecture:** The app registers `threadDetails` like `threadCardBadges` and `roomActions` (a guard in the registry, a pure `shownThreadDetails` that reads `shows` once per opening). One shared renderer, `ThreadDetailsList`, draws the contributions in error boundaries; `ThreadActionsMenu` draws it above its rows, and a new `ThreadCardDetails` in the Compact view draws it in a pointer-events-free pop-out, driven by native pointer listeners on the cards' list. The plugin reads its room snapshot for `shows` and reuses its chips' queries for the details.

**Tech Stack:** React 18, TypeScript (strict), matrix-js-sdk, folds, vanilla-extract, TanStack Query, vitest (jsdom), Playwright.

**Spec:** `docs/baspowers/specs/2026-11-15-thread-details-design.md` (corrected inline by this plan; see "Spec corrections" below).

## Global Constraints

- SDK version 57: `CLIENT_PLUGIN_API_VERSION` in `scripts/client-plugins.mjs` goes 56 to 57; the example plugin and the pull request plugin declare `apiVersion` 57.
- The kind is `ClientPlugin.threadDetails`, the eleventh kind, a list of `{ shows?, Component }`; `Component` gets `{ room, threadId }` and draws rows of text: no button, no link, nothing that takes the focus.
- Hover card: Compact view only, only where `(hover: hover) and (pointer: fine)` matches, after 500 ms, at most 320 px wide, glass menu surface, `pointer-events: none`, `aria-hidden`.
- `plugins.<id>.enabled: false` and `?plugins=off` turn the kind off; `shows` that throws counts as false, logged with `[plugin <id>@<version>]`.
- The pull request plugin's strings go in `src/strings.ts`, English. The app adds no strings.
- App code rules (`AGENTS.md`): strict flags, type-aware lint, layers (`threads` may import `plugins`, `ui`, `config`, `event-store`, `bug-reports`, `lib`), `PopOut` only from `src/app/ui/directional.tsx`, logical sides in styles.
- No em dashes in docs, comments or commit messages. Commits unsigned (`git -c commit.gpgsign=false commit`), files added by explicit path, never `git add -A`. Push nothing.
- Every command runs inside `nix develop` (from the app worktree, or `nix develop /home/basnijholt/repos/mindroom-client-worktrees/thread-details-hover -c ...` from the plugin).
- Out of scope: hover cards on the Threads page, sidebar thread rows and the timeline's thread badge; links, buttons or copy actions in the details; the app's own thread facts; haptics.

## Review Focus

1. The pointer moves straight from one card onto the next (no gap): the first card's hover card closes, and the next opens only after its own 500 ms. Test in Task 3.
2. A thread whose root is still sending (`~` local ID, not `$`): no hover card and no details group, since `shows` would get an ID the server never gave. Tests in Tasks 2 and 3.
3. A touch on a device whose media query reports a fine hovering pointer (a laptop with a touch screen): a touch pointer opens no hover card. Test in Task 3.
4. A click or press on a card, then the pointer rests there: no hover card reopens until the pointer has left that card. Test in Task 3.
5. The room changes, or the thread's menu opens, while the 500 ms wait is running: nothing opens afterwards. Test in Task 3.

## Spec corrections (applied to the spec in the same commit)

- `snapshotOf` is private in the plugin's `src/threadPullRequests.ts`. The plan exports `threadHasDetails(room, threadId)` from that module, built on `snapshotOf`, and keeps `snapshotOf` private.
- `NO_FOCUS_REFETCH` is a private constant of `src/PullRequestChip.tsx`. The plan moves it to `src/queries.ts` (exported) and lifts the chip's state and checks logic into `usePullRequestStatus`, so the details use the chips' exact queries.
- `ThreadActionsMenu` has no height cap today, so "scrolls with the menu when its height is capped" needs one: the plan copies `RoomActionsMenu.css.ts`'s coarse-pointer cap (`calc(100dvh - 4.5rem)`, rows scrolling inside the rim).
- The size line reuses the plugin's `PullRequestDiffStat` and `RelativeTime`, which render `-30` (hyphen) and "updated 2 hours ago"; the spec's `−30` and `2 h ago` are changed to match.
- A non-focusable group is not heard by a screen reader moving through the menu's items: the group becomes the menu's description (`aria-describedby`).
- A hover card whose contributions all drew nothing (a lazy one loading, one that returned null) would be an empty glass box at the pointer: the surface hides while no contribution drew anything (`:has`).
- The app pull request needs screenshots of its own head (`AGENTS.md`): it gets `e2e/plugins/thread-details.spec.ts` with the example plugin; the plugin's spec takes the plugin's screenshots.
- SDK types are named `ThreadDetail` and `ThreadDetailProps` (the spec left them unnamed).
- A pull request whose fork was deleted has `headRepo: null`: its head shows without an owner (the spec was silent).

---

# Part 1: app pull request (`mindroom-ai/mindroom-chat`, branch `thread-details-hover`)

Worktree: `/home/basnijholt/repos/mindroom-client-worktrees/thread-details-hover`. Run `nix develop -c just install` once if `node_modules` is missing. Baseline checked while planning: `nix develop -c just test src/app/plugins/threadCardBadges.test.tsx src/app/threads/overview/CompactRoomView.test.ts src/app/threads/ThreadActionsMenu.items.test.tsx src/app/lib/hooks/useLongPress.test.tsx src/app/threads/overview/CompactRoomView.motion.test.tsx` passes (48 tests).

### Task 1: The `threadDetails` kind, its registry entry and SDK version 57

**Files:**

- Create: `src/app/plugins/threadDetails.ts`, `src/app/plugins/threadDetails.test.ts`
- Modify: `src/app/plugins/registry.ts` (imports, `ClientPlugin`, `RegisteredPlugin`, `register`), `src/app/plugins/registry.test.ts` (entries, expectations at lines 193-198, frozen check at 218), `src/client-sdk/core.ts:30`, `scripts/client-plugins.mjs:22`
- Modify (add `threadDetails: [],` after `threadCardBadges`): `src/app/plugins/{PluginPageRoute,messageRenderers,threadCardBadges,roomActions,slashCommands,headerActions,messageLinks}.test.tsx`, `src/app/threads/overview/ThreadCardBadges.test.tsx`, `src/app/room/RoomActionsMenu.test.tsx:378`, the registry mock of `src/app/threads/overview/CompactRoomView.callRow.test.tsx:77`

**Interfaces:**

- Produces, in `src/app/plugins/threadDetails.ts`:

  - `type ThreadDetailProps = { room: Room; threadId: string }`
  - `type ThreadDetail = { shows?: (room: Room, threadId: string) => boolean; Component: ComponentType<ThreadDetailProps> }`
  - `isThreadDetail(value: unknown): value is ThreadDetail` (Component a function or a component object, as `isThreadCardBadge`; `shows` undefined or a function)
  - `type ShownThreadDetail = { key: string; tag: string; Component: ThreadDetail['Component'] }`
  - `shownThreadDetails(plugins: readonly RegisteredPlugin[], config: ClientConfig | undefined, room: Room, threadId: string): ShownThreadDetail[]`: enabled plugins (`isPluginEnabled`) in build order, entries whose `shows` is absent or returns true, keyed `<plugin id>/<index in the plugin's list>`; a throwing `shows` leaves out its entry and logs `console.error(\`[plugin ${tag}] its thread details' shows failed\`, error)`.
  - `ClientPlugin.threadDetails?: readonly ThreadDetail[]`, `RegisteredPlugin.threadDetails: readonly ThreadDetail[]` (frozen, filtered by `isThreadDetail`).
  - `@mindroom/client-sdk/core` exports `type ThreadDetail, ThreadDetailProps` (type-only, as the badge types: `registryImports.test.ts` forbids a static SDK import of the registry).

- [ ] **Step 1: Write the failing tests**

`src/app/plugins/threadDetails.test.ts` (node environment; a `plugin(id, threadDetails)` helper building a full `RegisteredPlugin` as `threadCardBadges.test.tsx` does):

```ts
it('takes an entry whose Component is a function or a component object, with or without a shows function', () => {
  expect(isThreadDetail({ Component: () => null })).toBe(true);
  expect(isThreadDetail({ Component: memo(A), shows: () => true })).toBe(true);
});
it('refuses an entry without a component or whose shows is no function', () => {
  expect(isThreadDetail({})).toBe(false);
  expect(isThreadDetail({ Component: 'x' })).toBe(false);
  expect(isThreadDetail({ Component: A, shows: true })).toBe(false);
  expect(isThreadDetail(null)).toBe(false);
});
it("lists the details of the enabled plugins whose shows takes the thread, in build order, keyed <plugin id>/<index>; a shows that throws leaves out only its entry, logged with the plugin's tag", () => {
  const failure = new Error('no');
  const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const config = { plugins: { off: { enabled: false } } } as unknown as ClientConfig;
  const room = { roomId: '!room:example.org' } as Room;
  const shown = shownThreadDetails(
    [
      plugin('off', [{ Component: A }]),
      plugin('alpha', [
        { Component: A },
        { Component: B, shows: () => false },
        { Component: C, shows: (r, id) => r === room && id === '$root' },
      ]),
      plugin('broken', [
        {
          Component: D,
          shows: () => {
            throw failure;
          },
        },
      ]),
      plugin('beta', [{ Component: E }]),
    ],
    config,
    room,
    '$root'
  );
  expect(shown).toEqual([
    { key: 'alpha/0', tag: 'alpha@1.0.0', Component: A },
    { key: 'alpha/2', tag: 'alpha@1.0.0', Component: C },
    { key: 'beta/0', tag: 'beta@1.0.0', Component: E },
  ]);
  expect(logged).toHaveBeenCalledWith(
    "[plugin broken@1.0.0] its thread details' shows failed",
    failure
  );
});
```

`src/app/plugins/registry.test.ts`: add `const detail = { Component, shows: () => true };` to the hoisted entries; `alpha` gets `threadDetails: detail` (not a list), the second plugin `threadDetails: [detail, { Component }, { nope: 1 }, { Component, shows: 'x' }]`; expect `plugins[0]?.threadDetails` to equal `[]`, `plugins[1]?.threadDetails` to equal `[entries.detail, { Component: entries.Component }]` (expose `Component` from the hoisted block if it is not yet), and `Object.isFrozen(plugin.threadDetails)` true. The existing `?plugins=off` test covers the kind.

- [ ] **Step 2: Run them to see them fail**

Run: `nix develop -c just test src/app/plugins/threadDetails.test.ts src/app/plugins/registry.test.ts`
Expected: FAIL (`./threadDetails` not found; `threadDetails` undefined on registered plugins).

- [ ] **Step 3: Implement** `src/app/plugins/threadDetails.ts` and the registry entry (`const details = isRecord(plugin) ? plugin.threadDetails : undefined;` beside `badges`), the `core.ts` type export, `CLIENT_PLUGIN_API_VERSION = 57`, and the `threadDetails: []` lines in the listed test files. Doc comments follow `threadCardBadges.ts` and `roomActions.ts`.

- [ ] **Step 4: Run tests and the strict check**

Run: `nix develop -c just test src/app/plugins` then `nix develop -c just strict`
Expected: PASS; 0 errors (a missing `threadDetails: []` in a typed `RegisteredPlugin` literal shows here).

- [ ] **Step 5: Commit**

```bash
git add src/app/plugins/threadDetails.ts src/app/plugins/threadDetails.test.ts src/app/plugins/registry.ts src/app/plugins/registry.test.ts src/client-sdk/core.ts scripts/client-plugins.mjs src/app/plugins/PluginPageRoute.test.tsx src/app/plugins/messageRenderers.test.tsx src/app/plugins/threadCardBadges.test.tsx src/app/plugins/roomActions.test.tsx src/app/plugins/slashCommands.test.tsx src/app/plugins/headerActions.test.tsx src/app/plugins/messageLinks.test.tsx src/app/threads/overview/ThreadCardBadges.test.tsx src/app/room/RoomActionsMenu.test.tsx src/app/threads/overview/CompactRoomView.callRow.test.tsx
git -c commit.gpgsign=false commit -m "Client plugins: thread details, a contribution kind (SDK version 57)"
```

### Task 2: The details group in the thread's menu, with the shared renderer

**Files:**

- Create: `src/app/threads/ThreadDetailsList.tsx`, `src/app/threads/ThreadDetailsList.css.ts`, `src/app/threads/ThreadDetailsList.test.tsx`, `src/app/threads/ThreadActionsMenu.css.ts`
- Modify: `src/app/threads/ThreadActionsMenu.tsx` (props at 37-52, hooks before the first early return at 182, markup at 536-554), `src/app/threads/ThreadActionsMenu.items.test.tsx`

**Interfaces:**

- Consumes: `shownThreadDetails`, `ShownThreadDetail`, `ThreadDetailProps` (Task 1); `isConfirmedMatrixEventId` (`src/app/event-store/threads/threadRouteUtils.ts:10`); `useOptionalClientConfig` (`src/app/config/useClientConfig`); `reportBoundaryError` and `pluginFailure` as `ThreadCardBadges.tsx` uses them.
- Produces:

  - `ThreadDetailsList({ room, threadId, details }: { room: Room; threadId: string; details: readonly ShownThreadDetail[] })`: each contribution in a `<div className={css.ThreadDetail} data-thread-detail={key}>` holding `ErrorBoundary` (fallback `null`, logs `[plugin ${tag}] failed to render its thread details` and reports `pluginFailure(tag, thrown)`) around `Suspense` (fallback `null`) around `<Component room threadId />`.
  - `css.ThreadDetail`: `'&:empty'` hidden; `'&:not(:empty) ~ &:not(:empty)'` gets the hairline (`borderBlockStart: ${config.borderWidth.B300} solid ${color.Surface.ContainerLine}`, `paddingBlockStart` and `marginBlockStart` `config.space.S200`), so a contribution that draws nothing leaves no stray line.
  - `ThreadActionsMenuProps.plugins?: readonly RegisteredPlugin[]` (default `registeredPlugins`, as `ThreadCardBadges` takes it).
  - DOM contract: the group is `<div id={detailsId} data-thread-details="">` as the menu's first child row, `maxWidth: toRem(320)`, `padding: config.space.S300`, followed by `<Line variant="Surface" size="300" />`; the `Menu` gets `aria-describedby={detailsId}` only while the group shows.

- [ ] **Step 1: Write the failing tests**

`src/app/threads/ThreadDetailsList.test.tsx`: copy the cases of `src/app/threads/overview/ThreadCardBadges.test.tsx` (named components, `Broken`, `NeverLoads`, the `reportBoundaryError` mock), rendering `<ThreadDetailsList room={room} threadId="$root" details={[...]} />` with `details` built as `ShownThreadDetail` objects:

```ts
it('renders each detail in the order given, with the thread\'s room and root', ...) // ['first !room:example.org $root', 'second !room:example.org $root']
it("leaves out a detail that throws, keeps the other, and reports it once under its plugin's tag", ...) // message '[plugin broken@1.0.0] boom'; console.error includes '[plugin broken@1.0.0] failed to render its thread details'
it('keeps the page and the other details while one waits for its code', ...)
```

`src/app/threads/ThreadActionsMenu.items.test.tsx`, new `describe("ThreadActionsMenu's thread details", ...)` with a local `plugin(id, threadDetails)` helper (full `RegisteredPlugin`) and `const Branch = () => <span data-detail>Branch main</span>;`:

```ts
it('shows the details first, above Open, with nothing that takes the focus, as the description of the menu', () => {
  const items = renderMenu({
    plugins: [plugin('alpha', [{ Component: Branch }])],
    onOpenThread: () => undefined,
  });
  const group = host.querySelector<HTMLElement>('[data-thread-details]');
  const menu = host.querySelector<HTMLElement>('[role="menu"]');
  expect(group?.textContent).toBe('Branch main');
  expect(menu?.getAttribute('aria-describedby')).toBe(group?.id);
  expect(group!.compareDocumentPosition(items[0]!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(items[0]?.dataset.threadAction).toBe('open');
  expect(
    group!.querySelectorAll('button, a[href], input, select, textarea, [tabindex]')
  ).toHaveLength(0);
  // The arrow keys still go to the first item.
  act(() => {
    menu!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  });
  expect(document.activeElement).toBe(items[0]);
});
it('shows no group and no description when no plugin shows details for the thread', () => {
  renderMenu({ plugins: [plugin('alpha', [{ Component: Branch, shows: () => false }])] });
  expect(host.querySelector('[data-thread-details]')).toBeNull();
  expect(host.querySelector('[role="menu"]')?.hasAttribute('aria-describedby')).toBe(false);
});
it('shows no details for a thread whose root is still sending', () => {
  renderMenu({ rootId: '~!room:test:m1', plugins: [plugin('alpha', [{ Component: Branch }])] });
  expect(host.querySelector('[data-thread-details]')).toBeNull();
});
it('keeps the details it opened with while it stays open', () => {
  let shows = true;
  const plugins = [plugin('alpha', [{ Component: Branch, shows: () => shows }])];
  renderMenu({ plugins });
  shows = false;
  renderMenu({ plugins });
  expect(host.querySelector('[data-thread-details]')?.textContent).toBe('Branch main');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `nix develop -c just test src/app/threads/ThreadDetailsList.test.tsx src/app/threads/ThreadActionsMenu.items.test.tsx`
Expected: FAIL (module not found; no `[data-thread-details]`).

- [ ] **Step 3: Implement**

`ThreadDetailsList.tsx` and its style as above. In `ThreadActionsMenu`: the client config is `clientConfig` (folds' `config` is already imported there); with the other hooks, before `if (dialog === 'snooze')`, `const [details] = useState(() => isConfirmedMatrixEventId(rootId) ? shownThreadDetails(plugins, clientConfig, room, rootId) : [])` (read once per opening; both callers key the menu by room and thread, so each opening mounts it) and `const detailsId = useId()`. The `Menu` gets `className={css.ThreadMenu}`; its children become one `<div className={css.ThreadMenuRows}>` holding the group, the `Line` and the existing `MenuGroup`. `ThreadActionsMenu.css.ts` copies `ThreadMenu`/`ThreadMenuRows` from `src/app/room/RoomActionsMenu.css.ts` (`threads` may not import `room`). The banner (`ThreadContextBanner.tsx:661`) needs no change: it renders the same menu.

- [ ] **Step 4: Run the menu's tests**

Run: `nix develop -c just test src/app/threads/ThreadDetailsList.test.tsx src/app/threads/ThreadActionsMenu.items.test.tsx src/app/threads/ThreadActionsMenu.test.tsx src/app/threads/ThreadActionsMenu.focus.test.tsx src/app/threads/ThreadActionsMenu.returnFocus.test.tsx src/app/threads/ThreadContextBanner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/threads/ThreadDetailsList.tsx src/app/threads/ThreadDetailsList.css.ts src/app/threads/ThreadDetailsList.test.tsx src/app/threads/ThreadActionsMenu.css.ts src/app/threads/ThreadActionsMenu.tsx src/app/threads/ThreadActionsMenu.items.test.tsx
git -c commit.gpgsign=false commit -m "Thread menu: client plugins' thread details as its first group"
```

### Task 3: The hover card on Compact thread cards

**Files:**

- Create: `src/app/threads/overview/ThreadCardDetails.tsx`, `src/app/threads/overview/ThreadCardDetails.css.ts`, `src/app/threads/overview/ThreadCardDetails.test.tsx`
- Modify: `src/app/threads/overview/CompactRoomView.tsx` (render it after `InsetScrollbar`, line 465-470), `src/app/threads/overview/CompactRoomView.motion.test.tsx` (add `vi.mock('./ThreadCardDetails', () => ({ ThreadCardDetails: () => null }));` beside the `ThreadCardBadges` mock: the file stubs react-i18next, which the registry's translations cannot use)

**Interfaces:**

- Consumes: `shownThreadDetails` (Task 1), `ThreadDetailsList` (Task 2), `PopOut` from `src/app/ui/directional.tsx`, `Menu` from `src/app/ui/glass/GlassPrimitives`, `isConfirmedMatrixEventId`.
- Produces:
  - `THREAD_CARD_DETAILS_DELAY_MS = 500`, `HOVER_POINTER_QUERY = '(hover: hover) and (pointer: fine)'`
  - `ThreadCardDetails({ room, listRef, menuOpen, plugins = registeredPlugins }: { room: Room; listRef: RefObject<HTMLElement>; menuOpen: boolean; plugins?: readonly RegisteredPlugin[] })`
  - DOM contract: the pop-out layer carries `data-thread-card-details=""`, `aria-hidden="true"` and `style={{ pointerEvents: 'none' }}` (on the layer itself, so `lib/overlayFocus.ts` `isPassiveLayer` skips it); inside, `<Menu role="none" className={css.HoverCard}>` (`maxWidth: toRem(320)`, `padding: config.space.S300`, hidden by `'&:not(:has([data-thread-detail]:not(:empty)))': { display: 'none' }`).
  - CompactRoomView renders `<ThreadCardDetails room={room} listRef={contentRef} menuOpen={!!menu} />`.

Behavior (native listeners on `listRef.current` in one effect, as `useCompactCardSwipeList`; latest `room`, `plugins`, config and `menuOpen` read through refs):

- `pointermove`: ignored for `pointerType === 'touch'` or when `globalThis.matchMedia?.(HOVER_POINTER_QUERY).matches` is not true. The card is `(event.target as Element).closest('[data-scroll-anchor]')` inside the list; its root ID is that attribute. The last pointer point is kept. A different card (or none) than the current one closes the card, cancels the wait and forgets the dismissal; a new confirmed (`$`) card that is not dismissed starts one 500 ms timer. Moves within the same card change nothing else.
- Timer: unless `menuOpen`, `shownThreadDetails(...)` for that root; none, nothing opens (and no new wait until the pointer leaves the card); else open with `anchor = { x, y, width: 0, height: 0 }` at the last point, `position` `'Top'` when `y > window.innerHeight / 2` else `'Bottom'`, `align="Start"`, `offset={16}` (clears the cursor).
- `pointerleave` on the list: close, cancel, forget the dismissal. `pointerdown` or `click` (capture) in the list: close, cancel, dismiss the current card. `scroll` on `window` (capture, passive): close, cancel, dismiss the current card.
- `menuOpen` true, a new `room.roomId`, unmount: close and cancel.

- [ ] **Step 1: Write the failing tests**

`ThreadCardDetails.test.tsx` (jsdom, fake timers, `vi.stubGlobal('matchMedia', (query: string) => ({ matches: hover, media: query }))`, `../../ui/directional` mocked with `PopOut: (props) => { popOut(props); return props.anchor ? <div data-layer {...pick(props, ['data-thread-card-details', 'aria-hidden', 'style'])}>{props.content}</div> : null }`, a `Harness` with a list of shells `data-scroll-anchor="$a"`, `"$b"`, `"~local"` and a gap element, and `point(target, type, x, y, pointerType = 'mouse')` dispatching a bubbling `MouseEvent` with `pointerType` defined on it):

```ts
it('opens at the pointer once it has rested 500 ms on a card, and moving within the card does not restart the wait', () => {
  point(cardA, 'pointermove', 40, 50); advance(300);
  point(cardA, 'pointermove', 60, 55); advance(199);
  expect(shown()).toBeNull();
  advance(1);
  expect(shown()?.textContent).toBe('Details of $a');
  expect(shown()?.getAttribute('aria-hidden')).toBe('true');
  expect(shown()?.style.pointerEvents).toBe('none');
  expect(popOut).toHaveBeenLastCalledWith(expect.objectContaining({
    anchor: { x: 60, y: 55, width: 0, height: 0 }, position: 'Bottom', align: 'Start' }));
});
it('opens above the pointer in the lower half of the window', ...) // y = 600 of innerHeight 768: position 'Top'
it('stays closed without a detail that shows, for a disabled plugin, and on a card whose root is still sending', ...)
it('closes when the pointer leaves the card, and the next card opens after its own wait', ...) // Review Focus 1: $a open, move onto $b: closed; advance 499 closed; advance 1 shows '$b'; move to gap: closed
it('closes on a press, a click or a scroll, and opens again only after the pointer left the card', ...) // Review Focus 4: after pointerdown, advance 1000 on $a: closed; move to $b and back to $a, advance 500: open
it('ignores a touch pointer and a page without a fine hovering pointer', ...) // Review Focus 3
it('opens nothing while a thread menu is open or after the room changed during the wait', ...) // Review Focus 5: rerender menuOpen true closes an open card; wait then rerender with another room: advance 500, closed
it('keeps the details it opened with, and the others when one throws', ...) // shows flips to false after opening: still shown; a Broken detail beside a named one: named one shows
```

- [ ] **Step 2: Run them to see them fail**

Run: `nix develop -c just test src/app/threads/overview/ThreadCardDetails.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `ThreadCardDetails.tsx`, its style, and the one line in `CompactRoomView` (outside the cards' `Box`, so no event from the pop-out reaches the list's handlers through React), plus the motion test's mock.

- [ ] **Step 4: Run the Compact view's tests**

Run: `nix develop -c just test src/app/threads/overview`
Expected: PASS (`CompactRoomView.test.ts` and `.performance.test.tsx` mock the registry as `[]`; react-test-renderer gives no list element, so the listeners stay off there).

- [ ] **Step 5: Commit**

```bash
git add src/app/threads/overview/ThreadCardDetails.tsx src/app/threads/overview/ThreadCardDetails.css.ts src/app/threads/overview/ThreadCardDetails.test.tsx src/app/threads/overview/CompactRoomView.tsx src/app/threads/overview/CompactRoomView.motion.test.tsx
git -c commit.gpgsign=false commit -m "Compact view: a hover card with a thread's details from client plugins"
```

### Task 4: A long press on a Compact card opens the thread's menu

**Files:**

- Create: `src/app/threads/overview/CompactRoomView.longPress.test.tsx` (jsdom; `CompactRoomView.test.ts` runs in node, where `useLongPress` has no `window`)
- Modify: `src/app/threads/overview/CompactRoomView.tsx:100-147` (`CompactThreadCardRow`)

**Interfaces:**

- Consumes: `useLongPress(onLongPress: (x: number, y: number, element: HTMLElement) => void, canStart: (evt: TouchEvent<HTMLElement>) => boolean)` and `LONG_PRESS_MS` from `src/app/lib/hooks/useLongPress.ts`.
- Produces: in the row, `openMenuAt(x: number, y: number, shell: HTMLElement)` calling `onOpenMenu({ roomId, rootId, viewModel, anchor: { x, y, width: 0, height: 0 }, trigger: shell.querySelector<HTMLButtonElement>('[data-thread-root-id]') ?? undefined })`, used by `onContextMenu` (with `event.clientX`, `event.clientY`, `event.currentTarget`) and by `useLongPress(openMenuAt, (evt) => evt.currentTarget.contains(evt.target as Node))`, whose four handlers spread on the `CardShell` div.

- [ ] **Step 1: Write the failing tests**

Mocks as in `CompactRoomView.motion.test.tsx` (view models, resolution, pinning, `ThreadCardBadges`, `ThreadCardDetails`, `InsetScrollbar`, react-i18next), with `ThreadActionsMenu` mocked to record its props (`menuProps`); `finger(x, y)` as in `useLongPress.test.tsx`; fake timers.

```ts
it("opens the thread's menu at the finger after a long press on its card, and the lift opens no thread", async () => {
  const onThreadClick = vi.fn();
  render(list(['$a'], onThreadClick));
  const shell = document.querySelector<HTMLElement>('[data-scroll-anchor="$a"]')!;
  fireEvent.touchStart(shell, { touches: [finger(40, 60)] });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  await act(async () => {}); // the menu is lazy
  expect(menuProps).toHaveBeenLastCalledWith(
    expect.objectContaining({ rootId: '$a', anchor: { x: 40, y: 60, width: 0, height: 0 } })
  );
  expect(fireEvent.touchEnd(shell, { touches: [] })).toBe(false);
  expect(onThreadClick).not.toHaveBeenCalled();
});
it('opens no menu for a finger that swipes the card sideways', () => {
  fireEvent.touchStart(shell, { touches: [finger(40, 60)] });
  fireEvent.touchMove(shell, { touches: [finger(70, 60)] });
  act(() => {
    vi.advanceTimersByTime(LONG_PRESS_MS);
  });
  expect(menuProps).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `nix develop -c just test src/app/threads/overview/CompactRoomView.longPress.test.tsx`
Expected: FAIL (no menu after the press).

- [ ] **Step 3: Implement** `openMenuAt` and the long press in `CompactThreadCardRow`.

- [ ] **Step 4: Run the Compact view's tests**

Run: `nix develop -c just test src/app/threads/overview src/app/lib/hooks/useLongPress.test.tsx`
Expected: PASS (the right-click test at `CompactRoomView.test.ts:195` still sees anchor `{ x: 123, y: 234, width: 0, height: 0 }`).

- [ ] **Step 5: Commit**

```bash
git add src/app/threads/overview/CompactRoomView.tsx src/app/threads/overview/CompactRoomView.longPress.test.tsx
git -c commit.gpgsign=false commit -m "Compact view: a long press on a thread's card opens its menu"
```

### Task 5: The example plugin's thread details and the docs

**Files:**

- Modify: `src/app/plugins/__fixtures__/example-plugin/index.tsx` (`GreetingBadge` at 1098-1117, the `threadCardBadges` entry of `plugin` at 1218), `.../example-plugin/index.test.tsx` (badge test at 875), `.../example-plugin/package.json` (`apiVersion` 57; description gains "the details of a thread a greeting begins, in its Compact card's hover card and its menu"), `docs/client-plugins.md` (line 24, line 175, version list after line 234, new section after line 459)

**Interfaces:**

- Produces in the example plugin: `greetingOf(room: Room, threadId: string): string | undefined` (the root lookup `GreetingBadge` does today plus `greetingText`), used by `GreetingBadge`, by `threadDetails: [{ shows: (room, threadId) => greetingOf(room, threadId) !== undefined, Component: GreetingDetails }]`, and by `GreetingDetails({ room, threadId }: ThreadDetailProps)`, which renders `<div data-example-plugin-details>` with two rows: `Greeting` and the greeting's text.

- [ ] **Step 1: Write the failing test** in `index.test.tsx`, lifting the badge test's `root`/`roots`/`room` into a file-level `greetingRoom()`:

```ts
it('gives the details of a thread a greeting begins, and of no other thread', async () => {
  const [details] = plugin.threadDetails ?? [];
  if (!details) throw new Error('the example plugin has no thread details');
  const room = greetingRoom();
  expect(['$greeting', '$plain', '$unknown'].map((id) => details.shows?.(room, id))).toEqual([
    true,
    false,
    false,
  ]);
  const view = await renderPluginComponent(<details.Component room={room} threadId="$greeting" />, {
    id: 'example',
    plugin,
  });
  expect(view.container.querySelector('[data-example-plugin-details]')?.textContent).toBe(
    'GreetingHello'
  );
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `nix develop -c just test src/app/plugins/__fixtures__/example-plugin/index.test.tsx`
Expected: FAIL ("the example plugin has no thread details").

- [ ] **Step 3: Implement** the contribution, then the docs. `docs/client-plugins.md`: `core`'s list gains `ThreadDetail`, `ThreadDetailProps`; "now 56" becomes "now 57"; the list gains "- version 57 thread details"; a "## Thread details" section after "Thread card badges" states: the eleventh kind, `{ shows?, Component }` (`src/app/plugins/threadDetails.ts`); `shows(room, threadId)` pure and synchronous, without it every thread, one that throws counts as false, logged with the tag; read as a surface opens, kept until it closes; only threads whose root the server confirmed; `Component` gets `{ room, threadId }`, rows of text, no control, nothing focusable, inside the room's page so room hooks work; where it shows: the Compact card's hover card (pointer devices, 500 ms rest, at the pointer, below or above by the window's half, mirrored in right-to-left, at most 320 px, read-only and hidden from assistive technology, closes on leave, press, click, scroll, the menu and a room change) and the first group of the thread's menu (More Options, right-click, ContextMenu key, long press on a Compact card, the open thread's banner), which describes the menu (`aria-describedby`) and scrolls with it on touch screens; contributions in build order, a hairline between those that drew something, the hover card hidden while none did; one that throws shows nothing, logged and reported ("failed to render its thread details"); a lazy one shows nothing until loaded; `enabled: false` and `?plugins=off`. Check the section for em dashes.

- [ ] **Step 4: Run the example plugin's tests**

Run: `nix develop -c just test src/app/plugins/__fixtures__/example-plugin`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/plugins/__fixtures__/example-plugin/index.tsx src/app/plugins/__fixtures__/example-plugin/index.test.tsx src/app/plugins/__fixtures__/example-plugin/package.json docs/client-plugins.md
git -c commit.gpgsign=false commit -m "Example plugin and docs: thread details"
```

### Task 6: End-to-end spec, screenshots, full checks

**Files:**

- Create: `e2e/plugins/thread-details.spec.ts`

**Interfaces:**

- Consumes: the DOM contract of Tasks 2 and 3 (`[data-thread-card-details]`, `[data-thread-details]`), `[data-example-plugin-details]` (Task 5), `touch(target, steps)` from `e2e/helpers/touch.ts`, and the setup of `e2e/plugins/thread-card-badge.spec.ts` (its own `npx vite build` with `MINDROOM_CLIENT_PLUGINS` set to the example plugin, `serveBuild`, a greeting thread and a plain one, `setRoomCompact`). Its `onBuild` gains a context-options argument for the phone.

- [ ] **Step 1: Write the spec**, three tests; `THREAD_DETAILS_SHOTS=1` saves to `test-results/thread-details/`:

  1. Desktop 1440x900: hover the greeting card's button, expect `[data-thread-card-details] [data-example-plugin-details]` visible with "Greeting" (shot `hover-light.png`; `page.emulateMedia({ colorScheme: 'dark' })`, wait for `html[data-theme-kind="dark"]`, hover again, shot `hover-dark.png`); hover the plain card, wait 1000 ms, expect `[data-thread-card-details]` to have count 0.
  2. Desktop: right-click the greeting card; in `getByRole('menu')`, `[data-thread-details]` contains "Greeting" and comes before the first `menuitem`, "Open thread"; Escape closes it.
  3. Phone (390x844, `hasTouch`, `isMobile`, device scale 3): `touch(card, [{ type: 'start' }, { type: 'wait', ms: 700 }, { type: 'end' }])` answers `liftAllowed: false`; the menu shows `[data-thread-details]` with "Greeting"; the URL has no `threadId`; shot `phone-menu.png`.

- [ ] **Step 2: Run it with screenshots on a free e2e slot**

Run: `THREAD_DETAILS_SHOTS=1 nix develop -c just e2e-slot 7 npx playwright test e2e/plugins/thread-details.spec.ts --project=chromium`, then `nix develop -c just e2e-slot 7 down`
Expected: 3 passed; three PNGs in `test-results/thread-details/`. Open each (`view_file`) and check it shows the hover card or the menu with the details, in the right theme. They go into the PR with `gh pr create --attach` when Bas asks for the PR.

- [ ] **Step 3: Full checks**

Run: `nix develop -c just format <every file this part changed>`, `nix develop -c just typecheck`, `nix develop -c just strict`, `nix develop -c just lint`, `nix develop -c just test`
Expected: 0 type errors, lint clean, all unit tests pass. Then `git diff origin/main...HEAD | grep -nP '\x{2014}'` prints nothing.

- [ ] **Step 4: Commit**

```bash
git add e2e/plugins/thread-details.spec.ts
git -c commit.gpgsign=false commit -m "e2e: a thread's details in the Compact card's hover card and its menu"
```

---

# Part 2: plugin pull request (`mindroom-ai/pull-request-client-plugin`, branch `thread-details`)

Starts once Part 1 is merged (or, before that, against the Part 1 worktree, whose SDK is version 57). `P=/tmp/prcp/thread-details/pull-request-client-plugin` (the directory keeps the name `pull-request-client-plugin`, which names its Playwright project), `APP=/home/basnijholt/repos/mindroom-client-worktrees/thread-details-hover`. Edits and commits happen in `$P`; tests run from `$APP`, as the plugin's README says.

### Task 7: Worktree, `threadHasDetails` and `usePullRequestStatus`

**Files:**

- Create: `src/pullRequestStatus.ts`
- Modify: `src/threadPullRequests.ts` (after `snapshotOf`, line 158), `src/threadPullRequests.test.ts`, `src/queries.ts`, `src/PullRequestChip.tsx` (27, 45-56)

**Interfaces:**

- Produces:

  - `threadHasDetails(room: Room, threadId: string): boolean`: `byThread.has(threadId) || worktrees.has(threadId)` of `snapshotOf(room)`.
  - `export const NO_FOCUS_REFETCH = { refetchOnWindowFocus: false }` in `src/queries.ts` (removed from the chip).
  - `type PullRequestStatus = { pr: PullRequest | undefined; state: PullRequestStatePresentation | undefined; checks: Exclude<ChecksState, 'none'> | undefined }` and `usePullRequestStatus(ref: PullRequestRef | undefined): PullRequestStatus` in `src/pullRequestStatus.ts`: the chip's lines 48-56 moved as they are (`usePullRequest(ref, NO_FOCUS_REFETCH)`, checks only for an open pull request with a stored token, `useChecks(ref, pr?.headSha ?? '', withChecks, NO_FOCUS_REFETCH)`, `checksState(...)`, `resolvePullRequestState(pr)`).
  - `PullRequestChip` calls `usePullRequestStatus(queried)` and draws `checks && pullRequestChecksStatePresentation(checks)`; nothing it renders or asks changes.

- [ ] **Step 1: Set up**

```bash
git -C /tmp/prcp/pull-request-client-plugin worktree add -b thread-details /tmp/prcp/thread-details/pull-request-client-plugin main
cd $P && ln -s $APP .mindroom-chat && nix develop $APP -c npm ci
cd $APP && MINDROOM_CLIENT_PLUGINS=$P nix develop -c just test $P/src
```

Expected: the plugin's tests pass at `main`.

- [ ] **Step 2: Write the failing test** in `src/threadPullRequests.test.ts`, with `linkedRoom` from `src/testing/linkedRoom.ts`:

```ts
it('says a thread has details when it has a linked pull request or a worktree', () => {
  const room = linkedRoom(
    '!r:x',
    [{ thread: '$pr', number: 1 }],
    [{ thread: '$tree', path: 'worktrees/a' }]
  );
  expect(['$pr', '$tree', '$none'].map((id) => threadHasDetails(room, id))).toEqual([
    true,
    true,
    false,
  ]);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd $APP && MINDROOM_CLIENT_PLUGINS=$P nix develop -c just test $P/src/threadPullRequests.test.ts`
Expected: FAIL (`threadHasDetails` is not exported).

- [ ] **Step 4: Implement** `threadHasDetails`, `NO_FOCUS_REFETCH` in `queries.ts`, `usePullRequestStatus`, and the chip's use of it.

- [ ] **Step 5: Run the plugin's tests and types**

Run: `cd $APP && MINDROOM_CLIENT_PLUGINS=$P nix develop -c just test $P/src` and `cd $P && nix develop $APP -c npm run typecheck`
Expected: PASS (`PullRequestChip.test.tsx` and `ThreadCardPullRequests.test.tsx` unchanged and green); 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/threadPullRequests.ts src/threadPullRequests.test.ts src/queries.ts src/pullRequestStatus.ts src/PullRequestChip.tsx
git -c commit.gpgsign=false commit -m "Threads: whether a thread has details, and a pull request's status for chips and details"
```

### Task 8: `ThreadDetails`, the plugin's contribution

**Files:**

- Create: `src/middleTruncate.ts`, `src/middleTruncate.test.ts`, `src/ThreadDetails.tsx`, `src/ThreadDetails.test.tsx`
- Modify: `src/strings.ts` (new `details` group), `src/styles.css` (new `.mrpr-details*` classes), `src/index.tsx`, `package.json` (`apiVersion` 57), `README.md` (a "Thread details" section after the worktree section)

**Interfaces:**

- Consumes: `threadHasDetails`, `usePullRequestStatus` (Task 7); `useThreadPullRequests`; `pullRequestUrl`; `PullRequestMetaLine`, `PullRequestDiffStat`, `RelativeTime`, `pullRequestChecksStatePresentation` (`src/presentation.tsx`); `pluginRootStyle`; `ThreadDetailProps` from `@mindroom/client-sdk/core`; lucide `GitPullRequestArrow`, `GitBranch`, `Folder`.
- Produces:

  - `middleTruncate(text: string, max: number): string`: unchanged when it has at most `max` code points; else the first `ceil((max - 1) / 2)` and the last `floor((max - 1) / 2)` code points around `…`. `BRANCH_MAX = 24` in `ThreadDetails.tsx`.
  - `ThreadDetails({ room, threadId }: ThreadDetailProps)`: `<div className="mrpr-root mrpr-details" style={pluginRootStyle()}>` with one `.mrpr-details-pull-request` block per pull request, all of them in link order, then a `.mrpr-details-worktree` block.
  - A pull request block (`usePullRequestStatus(pullRequest)`): line 1 the state icon (`role="img"`, `aria-label` `t('state.<key>')`; until GitHub answers or when it refuses, `GitPullRequestArrow` in `mrpr-tone-draft` with no name), `t('details.pullRequest', { repository: 'owner/repo', number })`, the checks mark (`role="img"`, `aria-label` `t('checksState.<state>')`); with `pr` only: line 2 the title (`.mrpr-details-title`, two-line clamp), line 3 `GitBranch` and `t('details.branches', { head, base })` where `head` is `t('details.forkHead', { owner, branch })` when `pr.headRepo !== null && pr.headRepo !== pr.baseRepo` (owner: `headRepo` before `/`), else `pr.headRef`, each side `middleTruncate(..., BRANCH_MAX)`; line 4 `PullRequestMetaLine` of `PullRequestDiffStat`, `t('code.fileCount', { count: pr.changedFiles })`, `t('details.author', { login: pr.author?.login ?? t('ghost') })` and `RelativeTime` with `label={(time) => t('updated', { time })}`.
  - A worktree block: `GitBranch` and the branch (left out when empty), `Folder` and the path.
  - Strings: `details: { pullRequest: '{{repository}} #{{number}}', branches: '{{head}} → {{base}}', forkHead: '{{owner}}:{{branch}}', author: '@{{login}}' }`.
  - `plugin.threadDetails = [{ shows: threadHasDetails, Component: ThreadDetails }]`.

- [ ] **Step 1: Write the failing tests**

`src/middleTruncate.test.ts`:

```ts
it('keeps a short text', () => expect(middleTruncate('main', 24)).toBe('main'));
it('keeps the start and the end of a long one', () =>
  expect(middleTruncate('feature/thread-details-hover-card', 20)).toBe('feature/th…over-card'));
it('cuts between code points', () => expect(middleTruncate('🌳'.repeat(30), 5)).toBe('🌳🌳…🌳🌳'));
```

`src/ThreadDetails.test.tsx`: fetch stubbed as in `PullRequestChip.test.tsx` (`serve`, `respond`, `saveToken`, `answered`), rendered with `renderPluginComponent(<QueryClientProvider client={client}><ThreadDetails room={linkedRoom(...)} threadId="$t1" /></QueryClientProvider>, { id: 'pull-requests', plugin })`; the pull request `pull({ title: 'Store sessions in Redis', head: { sha: SHA, ref: 'redis-sessions', repo: { full_name: 'mindroom-ai/mindroom-chat' } }, base: { ref: 'main', repo: { full_name: 'mindroom-ai/mindroom-chat' } }, user: { login: 'acme-builder' }, additions: 120, deletions: 30, changed_files: 5, updated_at: <two hours ago> })`:

```ts
it('is the plugin\'s thread details, for threads with a link or a worktree', () =>
  expect(plugin.threadDetails).toEqual([{ shows: threadHasDetails, Component: ThreadDetails }]));
it('shows a loaded pull request: repository and number with its state and checks, title, branches, size, author and age', ...)
  // text 'mindroom-ai/mindroom-chat #412'; getByRole('img', { name: 'Open' }); with a token and passing runs getByRole('img', { name: 'All checks have passed' });
  // 'Store sessions in Redis'; 'redis-sessions → main'; '+120', '-30', '5 files', '@acme-builder', 'updated 2 hours ago'
it('shows only the repository and number while GitHub has not answered, and when it refuses', ...)
  // a fetch that never resolves, then a 404: 'mindroom-ai/mindroom-chat #412', no title, queryByRole('img', { name: 'Open' }) null
it("names a fork's head with its owner, and a deleted fork's head without one", ...)
  // head.repo.full_name 'contributor/mindroom-chat', ref 'fix-typo': 'contributor:fix-typo → main'; head.repo null: 'fix-typo → main'
it('middle-truncates long branch names', ...) // ref 'feature/a-very-long-branch-name-for-details' shows middleTruncate(ref, 24)
it('shows the worktree with its branch and its path, and the path alone without a branch', ...)
it('shows every pull request of the thread, also past the two its card shows', ...) // three links: three blocks, in link order
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd $APP && MINDROOM_CLIENT_PLUGINS=$P nix develop -c just test $P/src/middleTruncate.test.ts $P/src/ThreadDetails.test.tsx`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement** `middleTruncate`, `ThreadDetails`, the strings, the styles (rows of 12 px text in `var(--pr-fg)`, the meta line's 11 px muted text, icons at the chips' size, no `button`/`a`/`tabindex`), the registration, `apiVersion` 57 and the README section (what the hover card and menu show, and that a hover asks GitHub nothing for a pull request whose chip has loaded, while those past the card's two load on the first hover).

- [ ] **Step 4: Run the plugin's tests and types**

Run: `cd $APP && MINDROOM_CLIENT_PLUGINS=$P nix develop -c just test $P/src` and `cd $P && nix develop $APP -c npm run typecheck`
Expected: PASS; 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/middleTruncate.ts src/middleTruncate.test.ts src/ThreadDetails.tsx src/ThreadDetails.test.tsx src/strings.ts src/styles.css src/index.tsx package.json README.md
git -c commit.gpgsign=false commit -m "Threads: a thread's pull requests and worktree as its details (SDK version 57)"
```

### Task 9: The plugin's end-to-end tests and screenshots

**Files:**

- Modify: `e2e/threadPullRequests.spec.ts` (`shot` at 505-513, two new tests after the phone test at 601-635)

**Interfaces:**

- Consumes: `[data-thread-card-details]` and `[data-thread-details]` (Part 1), `.mrpr-details-pull-request` (Task 8), `touch` from `@mindroom/e2e/touch`.
- Produces: `shot(page, name, { keepPointer = false } = {})`: with `keepPointer` it skips `page.mouse.move(0, 0)`, which would close the hover card.

- [ ] **Step 1: Write the tests**

  1. "resting the pointer on a card shows all its pull requests' details": `stubGitHub`, `openRoom`, hover `card(page, roots.release)`; `[data-thread-card-details] .mrpr-details-pull-request` has count 3 with the titles of `THREADS.release.pulls` in order and the branch line `rate-limit-per-token → main` of `PULLS.rateLimit`; shots `details-light` and, after the dark theme and a new hover, `details-dark` (both `keepPointer`); `unanswered` and `warnings` empty.
  2. "on a phone a long press on a card opens its menu with the details": the phone context of the existing phone test; `touch(card(page, roots.sessions), [{ type: 'start' }, { type: 'wait', ms: 700 }, { type: 'end' }])`; `getByRole('menu')` holds `[data-thread-details]` with the titles of `PULLS.sessionStore` and `PULLS.tokenEndpoint`; shot `phone-details-menu`.

- [ ] **Step 2: Run the plugin's specs with screenshots on a free slot**

Run (from `$APP`): `mkdir -p /tmp/prcp/shots && E2E_PLUGIN_DIRS=$P MINDROOM_CLIENT_PLUGINS=$P MRPR_SHOTS=/tmp/prcp/shots nix develop -c just e2e-slot 3 --preview npx playwright test --project=pull-request-client-plugin`, then `nix develop -c just e2e-slot 3 down`
Expected: every test of the spec passes; `details-light.png`, `details-dark.png` and `phone-details-menu.png` in `/tmp/prcp/shots`. Open each and check the details are legible in both themes and on the phone.

- [ ] **Step 3: Format and type-check**

Run: `nix develop -c just format $P/src/*.ts $P/src/*.tsx $P/e2e/threadPullRequests.spec.ts` (from `$APP`; Prettier takes the plugin's `.prettierrc`), `cd $P && nix develop $APP -c npm run typecheck`, `git -C $P diff main...HEAD | grep -nP '\x{2014}'`
Expected: no format change left, 0 errors, no em dash.

- [ ] **Step 4: Commit**

```bash
git add e2e/threadPullRequests.spec.ts
git -c commit.gpgsign=false commit -m "e2e: a thread's details on hover and after a long press on a phone"
```

Delivery after both parts: the app PR from `thread-details-hover`, the plugin PR from `thread-details` once the app PR is merged, then Bas's call on `mindroom-infra`'s `pins/pull-request-client-plugin`. Nothing is pushed by this plan.
