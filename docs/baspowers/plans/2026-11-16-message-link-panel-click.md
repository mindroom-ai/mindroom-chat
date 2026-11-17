# Message link opens its side panel on a click: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development. Three tasks across two repos with a shared
interface, and a regression in link clicks would hit every message, so each task gets its own
reviewer.

**Goal:** On desktop, a plain click on a plugin's message link that opts in opens the plugin's side
panel, and a click while the panel already shows that link follows it. Phones keep the card.

**Architecture:** `MessageLink` gains an optional declarative `sidePanel: { id, request }`.
`MessageLinkCards.show` decides between opening the panel, letting the click go on as a link
click, and showing the card, using a new `PluginPanelControls.showsRequest` that `Room` builds from
its latest state. The pull request plugin opts in.

**Tech Stack:** React 18, TypeScript, vitest + Testing Library, Playwright (e2e).

**Spec:** `docs/baspowers/specs/2026-11-16-message-link-panel-click-design.md`

## Global Constraints

- Plugin API version 62 (`scripts/client-plugins.mjs` `CLIENT_PLUGIN_API_VERSION`). Docs say "since version 62".
- Request equality is `JSON.stringify(a) === JSON.stringify(b)`. A stringify that throws counts as not equal.
- "Showing" means the panel is the shown one and its layout is not `folded`. `filled` counts as showing.
- Phone = `useScreenSizeContext() === ScreenSize.Mobile`: always the card.
- Modified clicks, middle clicks, the context menu, drag and the link check (`CheckedMessageLink`) are unchanged.
- No new user-facing strings.
- Commits end with `--trailer "Assisted-by: MindRoom <display name>:<model id> <https://github.com/mindroom-ai/mindroom>"`. Never `git stash`.

## Review Focus

- A click on the same link while its panel is folded: unfolds (opens) the panel, does not open GitHub. (Task 2 test)
- A click while a different plugin panel or the computer/canvas is shown: opens this panel in its place. (Task 2 test)
- Enter on the focused link behaves like a plain click (same path). (Task 2 test)
- A card already showing for another link closes when a click opens the panel. (Task 2 test)
- A room switch between the two clicks: `showsRequest` reads the new room's panel, so the first click there opens the panel. (Task 1 test)

---

### Task 1: `PluginPanelControls.showsRequest`

**Files:**
- Modify: `src/app/plugins/sidePanels.ts` (the `PluginPanelControls` type, ~line 118)
- Modify: `src/app/room/Room.tsx` (`now` ref ~line 513, `pluginPanelControls` memo ~line 588)
- Test: `src/app/room/Room.sidePanels.test.tsx`

**Interfaces:**
- Produces: `PluginPanelControls.showsRequest: (id: string, request: unknown) => boolean`. Its
  identity stays the same while the room shows (it reads `now.current`). Every other place that
  builds a `PluginPanelControls` (test helpers, `client-sdk` test utilities: `git grep -n "openBesideThread:" src`) gets one.

- [ ] **Step 1: Write the failing tests** in `Room.sidePanels.test.tsx`, next to "opens a plugin's panel from the plugin's code with a request":
  - `"tells whether a plugin's panel shows a request"`: open the panel with `{ n: 1 }` through the controls → `showsRequest(id, { n: 1 })` is `true`, `showsRequest(id, { n: 2 })` is `false`, `showsRequest('other/panel', { n: 1 })` is `false`.
  - `"a folded panel does not count as showing its request"`: open with `{ n: 1 }`, fold it (header/tab path the existing tests use) → `false`. Filled → `true`.
  - `"a room switch reads the new room's panel"`: open in room A with `{ n: 1 }`, switch to room B → `false`.
- [ ] **Step 2: Run** `npx vitest run src/app/room/Room.sidePanels.test.tsx` → the new tests FAIL (`showsRequest` is not a function).
- [ ] **Step 3: Implement.** Add `layout` and `pluginRequest: pluginPanel?.request` to the `now` ref. Write `showsRequest` as a `useCallback` comparing `now.current.shownId === id`, `layout !== 'folded'`, `now.current.roomId === roomId`, and JSON equality (try/catch → `false`). Add it to the memo and to every other `PluginPanelControls` literal.
- [ ] **Step 4: Run** the file plus `npx tsc --noEmit -p .` (or `just strict` if faster) → PASS.
- [ ] **Step 5: Commit** `Side panels: the room tells whether a plugin's panel shows a request`.

### Task 2: `MessageLink.sidePanel` and the click

**Files:**
- Modify: `src/app/plugins/messageLinks.ts` (`MessageLink`, `isMessageLink`, `MessageLinkCard`, `useMessageLinkMatcher`)
- Modify: `src/app/room/MessageLinkCards.tsx` (`show`)
- Modify: `scripts/client-plugins.mjs` (`CLIENT_PLUGIN_API_VERSION = 62`) and whatever the version bump touches (`git grep -n "61" -- scripts docs src/client-sdk` for the API changelog/check tests)
- Modify: `docs/client-plugins.md` "Message links"
- Modify: `src/app/plugins/__fixtures__/example-plugin/index.tsx` (add a second message link)
- Test: `src/app/plugins/messageLinks.test.tsx`, `src/app/room/MessageLinkCards.test.tsx`, `e2e/plugins/message-link.spec.ts`

**Interfaces:**
- Consumes: `PluginPanelControls.showsRequest` and `open` (Task 1).
- Produces (SDK): `MessageLink.sidePanel?: { id: string; request: (url: URL) => unknown }`.
- `MessageLinkCard` becomes `{ tag: string; Component; sidePanel?: { id: string; request: (url: URL) => unknown } }` where `id` is already `<pluginId>/<id>`. The matcher also returns the parsed `url` it matched, or `show` parses again: implementer's choice.
- `show(link, href)` keeps its `boolean` return: `true` = the click is taken (card shown or panel opened), `false` = the click goes on.

- [ ] **Step 1: Failing tests, `messageLinks.test.tsx`:**
  - `isMessageLink({ match, Component, sidePanel: { id: 'p', request: () => 1 } })` → `true`. With `sidePanel: { id: 3, request: () => 1 }`, `{ id: 'p' }` or `'p'` → `false`.
  - The matcher returns `sidePanel.id === '<pluginId>/p'` for an opted-in link and no `sidePanel` for one without.
- [ ] **Step 2: Failing tests, `MessageLinkCards.test.tsx`** (wrap in `PluginPanelControlsContext.Provider` with `vi.fn()` controls and `ScreenSizeProvider`):
  - `"a link with a side panel opens it with its request and shows no card"`: desktop, `showsRequest` → `false`. Click → `open` called with `('<plugin>/p', request(url))`, no card in the document, the click's default is prevented.
  - `"a click while its panel shows the same request goes on as a link click"`: `showsRequest` → `true`. Click → `open` not called, no card, `defaultPrevented === false`.
  - `"on a phone a link with a side panel shows its card"`: `ScreenSize.Mobile` → card shown, `open` not called.
  - `"without panel controls a link with a side panel shows its card"`.
  - `"a throwing request shows the card and logs the plugin's tag"`.
  - `"opening the panel closes another link's card"`: card of link A shows, click opted-in link B → card gone, `open` called.
  - `"Enter on the focused link opens the panel"` (Review Focus).
  - Folded and replaced panels need no test here: they only change `showsRequest`'s answer, which Task 1 covers.
- [ ] **Step 3: Run** both files → the new tests FAIL.
- [ ] **Step 4: Implement** `isMessageLink`'s check, the matcher's `sidePanel`, and `show`: card when no `sidePanel`, no controls, phone, or a throwing `request` (log `[plugin <tag>] its message link's request failed`); `false` when `showsRequest`; otherwise `setShown(undefined)`, `controls.open(id, request)`, `true`. `show` reads controls and screen size through refs or deps, so `CheckedMessageLink` stays as it is.
- [ ] **Step 5: Run** both files → PASS.
- [ ] **Step 6: Example plugin, e2e and docs.** Add a second link to the example plugin: `https://example.org/panel-items/<id>` with `sidePanel: { id: 'panel', request: (url) => ({ item: url.pathname.split('/')[2] }) }`, and make `ExamplePanel` show its request's item (e.g. `data-testid="example-panel-item"`), if it does not already. The existing item-link e2e stays unchanged. New e2e test in `message-link.spec.ts`: `"a click on a panel item link opens the side panel, and a second click opens the link"`. Desktop: click → panel shows the item, no card. Click again → `context.waitForEvent('page')` whose URL is the link. Phone viewport (`test.use` or a second test with `viewport: { width: 390, height: 844 }`): tap → the card shows. Run e2e on a free slot (check `ss -ltn | grep :43<n>` first) or on a Mac runner. Update `docs/client-plugins.md` "Message links": one paragraph on `sidePanel` (since version 62) with the rules from the spec's "what a plain click does". Bump `CLIENT_PLUGIN_API_VERSION` to 62 and fix whatever its tests pin.
- [ ] **Step 7: Run** `just strict`, `NODE_OPTIONS=--max-old-space-size=6144 just lint`, and `npx vitest run src/app/plugins src/app/room` → PASS. Run the e2e spec → PASS.
- [ ] **Step 8: Commit** `Client plugins: a message link may open its side panel on a click (version 62)`.

### Task 3: Pull request plugin opts in

Repo: `mindroom-ai/pull-request-client-plugin`, worktree `~/repos/worktrees/pull-request-client-plugin-link-panel-click` from `origin/main`. Its `.mindroom-chat` host must be a client checkout of the Task 2 branch (`git -C ~/repos/dev/mindroom-chat worktree add --detach ~/repos/worktrees/mindroom-chat-link-panel-click-host feat/message-link-panel-click` + `nix develop -c npm ci`), not a shared one.

**Files:**
- Modify: `src/index.ts` (the `messageLinks` entry)
- Modify: the plugin's required API version (`git grep -n "61"` in its `package.json`/manifest)
- Test: `src/index.test.ts(x)` (create if absent, following the repo's test layout)

**Interfaces:**
- Consumes: `MessageLink.sidePanel` (Task 2), `parsePullRequestUrl(url: URL): PullRequestRef | undefined` (`src/github.ts`).

- [ ] **Step 1: Failing test** `"a pull request link opens the pull-request panel with the card's request"`: `plugin.messageLinks[0].sidePanel.id === 'pull-request'`, and for `new URL('https://github.com/mindroom-ai/mindroom-chat/pull/490')` the request deep-equals and JSON-equals `parsePullRequestUrl` of the same URL. That is the value `PullRequestCard` passes to `panel.open`.
- [ ] **Step 2: Run** the plugin's test command → FAIL.
- [ ] **Step 3: Implement** `sidePanel: { id: 'pull-request', request: (url) => parsePullRequestUrl(url) }` and the API version 62.
- [ ] **Step 4: Run** the plugin's full check (its `just`/`npm` test and typecheck recipes against the Task 2 host) → PASS.
- [ ] **Step 5: Commit** `Links: a click opens the pull request in the side panel, a second click on GitHub (SDK version 62)`.
