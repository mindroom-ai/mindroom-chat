# Pull Request Client Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: implement this plan task-by-task with the skill named in **Execution**. Steps use checkbox (`- [ ]`) syntax.

**Execution:** baspowers:subagent-driven-development (nine tasks over two repositories; later tasks would otherwise run on a compacted context, and a fresh reviewer per task catches SDK contract slips before the plugin builds on them).

**Goal:** A plain click on a GitHub pull request link in a room's message shows T3 Code's pull request card, which opens the pull request in a side panel with a file tree beside its diffs.

**Architecture:** Part 1 adds the client SDK's `messageLinks` contribution kind (API version 43) to `mindroom-chat`: `CheckedMessageLink` asks a context seam, which the room page provides and fills with the first enabled plugin whose `match` takes the URL, drawn in the app's `PopOut` and glass `Menu`. Part 2 is the plugin `pull-requests` in a new repository, `mindroom-ai/pull-request-client-plugin`, porting T3 Code's card, panel header, file tree and diff view over GitHub's REST API, on `@pierre/diffs` and `@pierre/trees`.

**Tech Stack:** React 18.2 (the app's), TypeScript, folds, TanStack Query (the app's client), Vitest + Testing Library (jsdom), Playwright, `@pierre/diffs` 1.6.4, `@pierre/trees` 1.0.0-beta.6, `lucide-react`.

**Spec:** `docs/baspowers/specs/2026-11-09-pull-request-plugin-design.md`

## Global Constraints

- Every command in `mindroom-chat` runs in `nix develop` (Node 24). Commits unsigned (`git -c commit.gpgsign=false commit`), files added by path, never `git add -A`, no em dashes in docs, comments or commit messages.
- New code in `mindroom-chat` is Lane C: `just typecheck`, `just strict` and `just lint` pass; styles use logical sides; `PopOut` comes from `src/app/ui/directional.tsx`, never `folds`.
- Layers: `rich-text` and `plugins` are both layer 4 and may not import each other; `room` (layer 11) may import both.
- `CLIENT_PLUGIN_API_VERSION` becomes 43; the example plugin and the plugin declare `apiVersion: 43`.
- The plugin imports the app only through `@mindroom/client-sdk/<subpath>`; shared packages (react, react-dom, folds, @tanstack/react-query, matrix-js-sdk, focus-trap-react, react-i18next, i18next) go under `peerDependencies`, never `dependencies`; it uses the app's `QueryClient`.
- Plugin requests go to `https://api.github.com` only, with `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2022-11-28`; `Authorization: Bearer <token>` only when a token is stored.
- 🔒 The token lives in `usePluginStorage('pull-requests')` under `githubToken`, never in a side panel request, a log or an error message.
- Ported T3 Code files start with: `// Ported from T3 Code (https://github.com/pingdotgg/t3code, <path> at 8ab427c6), MIT, Copyright (c) 2026 T3 Tools Inc. See NOTICE.`
- Exact copy: card actions "Open in side panel", "Open on GitHub", "Copy link"; empty panel "Click a pull request link in a message to show it here."; errors "GitHub did not find this pull request. A private repository needs a token." and "GitHub's rate limit was reached."; patchless file "No diff to show"; Summary without body "No description."; panel label "Pull request".

## Review Focus

- A link inside a thread card, or a message the person can click to open its thread: the card shows and the thread does not open (Task 2 test `stops the click from reaching the thread card`).
- Enter on a focused link shows the card, as a click does (Task 4 end-to-end step: jsdom fires no click for Enter on a link, so only the browser can prove it).
- A pull request URL with a tail (`/files`, `#discussion_r1`, `?w=1`) or a trailing slash still matches, while `/pulls`, `/pull/abc`, `/pull/0` and other hosts do not (Task 5 table).
- A pull request with more than 100 files lists every one, and one whose files include a binary or a too-large file still renders the rest (Task 5 tests `pages until a short page` and `keeps a patchless file`).
- A request that fails after a token was saved because the token is wrong (401 with a token) says so, and does not ask for a token as if none were set (Task 5 test `401 with a token is badToken`; Task 6 test `shows the bad token state`).

---

## Part 1: `mindroom-chat`, branch `t3/t3-pr-context-plugin`

### Task 1: The `messageLinks` contribution kind and SDK version 43

**Files:**
- Create: `src/app/plugins/messageLinks.ts`
- Test: `src/app/plugins/messageLinks.test.tsx`
- Modify: `src/app/plugins/registry.ts` (type `ClientPlugin`, `RegisteredPlugin`, `register`), `src/app/plugins/registry.test.ts`
- Modify: `src/client-sdk/core.ts` (export types), `scripts/client-plugins.mjs` (`CLIENT_PLUGIN_API_VERSION = 43`), `src/build/clientPlugins.test.ts` (the "needs a newer client SDK" case to 44/43)
- Modify: every test that builds a `RegisteredPlugin` literal by hand (the ones that gained `roomActions: []` in commit 9190f3239: `headerActions.test.tsx`, `messageRenderers.test.tsx`, `pluginPages.test.tsx`, `slashCommands.test.tsx`, `roomActions.test.tsx` and any other `grep -rln "roomActions: \[\]" src` finds) to add `messageLinks: []`

**Interfaces:**
- Produces, in `src/app/plugins/messageLinks.ts`:
  - `type MessageLinkCardProps = { href: string; roomId: string; close: () => void }`
  - `type MessageLink = { match: (url: URL) => boolean; Component: ComponentType<MessageLinkCardProps> }`
  - `isMessageLink(value: unknown): value is MessageLink` (`match` a function, `Component` truthy)
  - `type MessageLinkCard = { tag: string; Component: ComponentType<MessageLinkCardProps> }`
  - `useMessageLinkMatcher(plugins: readonly RegisteredPlugin[], config: ClientConfig | undefined): (href: string) => MessageLinkCard | undefined`: parses `href` with `new URL`, returns undefined for a parse failure or a protocol other than `http:`/`https:`, else the first entry (plugins in order, entries in order) of an enabled plugin (`isPluginEnabled`) whose `match` returns true; a `match` that throws counts as false and is logged with `console.error(\`[plugin ${tag}] its message link's match failed\`, error)`. Stable identity while `plugins` and `config` stay (`useCallback`).
- Produces: `RegisteredPlugin.messageLinks: readonly MessageLink[]`, `ClientPlugin.messageLinks?: readonly MessageLink[]`; `@mindroom/client-sdk/core` exports `type MessageLink, type MessageLinkCardProps`.

- [ ] **Step 1: Write the failing tests** in `messageLinks.test.tsx` (`renderHook`): `keeps only well-formed entries` (registry test: an entry without `match`, a string, and a good one; only the good one stays), `takes the first match in build order`, `skips a plugin config.json turns off` (`plugins: { a: { enabled: false } }`), `treats a throwing match as none and logs the tag` (expects `console.error` called with a string containing `[plugin a@1.0.0]`), `passes only http and https URLs to match` (`mailto:x@y`, `javascript:alert(1)`, `not a url` never reach a `vi.fn` match; `https://github.com/a/b/pull/1` does, as a `URL` whose `href` equals the input).
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/plugins/messageLinks.test.tsx src/app/plugins/registry.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `messageLinks.ts` and the registry field (`messageLinks: Object.freeze(Array.isArray(links) ? links.filter(isMessageLink) : [])`), the core export, the version bump and the test literals.
- [ ] **Step 4: Run** the two files plus `src/build/clientPlugins.test.ts` and `npx vitest run src/app/plugins`. Expected: PASS.
- [ ] **Step 5: Commit** `Client plugins: a messageLinks contribution kind (SDK 43)`.

### Task 2: The link seam in `rich-text` and `CheckedMessageLink`

**Files:**
- Create: `src/app/rich-text/messageLinkCards.ts`
- Modify: `src/app/rich-text/CheckedMessageLink.tsx`
- Test: `src/app/rich-text/CheckedMessageLink.test.tsx` (new, `// @vitest-environment jsdom`)

**Interfaces:**
- Produces: `MessageLinkCardContext = createContext<((link: HTMLAnchorElement, href: string) => boolean) | undefined>(undefined)` in `messageLinkCards.ts`.
- `CheckedMessageLink.handleClick` order: `onClick?.(evt)`; return if `defaultPrevented` or no `href`; a confirmed second click returns (as now); a misleading link asks (as now) and returns; otherwise, when `evt.button === 0` and none of `ctrlKey`, `metaKey`, `shiftKey`, `altKey`, and the context's function returns true for `(evt.currentTarget, href)`: `evt.preventDefault()` and `evt.stopPropagation()`.

- [ ] **Step 1: Write the failing tests**: `shows the card on a plain click and does not follow the link` (provider `vi.fn(() => true)`, `fireEvent.click(link)` returns false, the fn got the anchor and the href); `follows the link with Ctrl, Meta, Shift or Alt` (each modifier: fn not called, `fireEvent.click` returns true); `follows the link when no card takes it` (fn returns false: default not prevented); `asks first for a misleading link and opens it without a card` (text `https://good.example`, href `https://evil.example`: the dialog shows, fn not called; "Open" clicks through without calling fn); `changes nothing without a provider`; `stops the click from reaching the thread card` (a parent `onClick` spy is not called when the fn returns true).
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/rich-text/CheckedMessageLink.test.tsx`. Expected: FAIL (fn never called).
- [ ] **Step 3: Implement** the context and the click branch.
- [ ] **Step 4: Run** it again, then `npx vitest run src/app/rich-text src/app/messages`. Expected: PASS.
- [ ] **Step 5: Commit** `Message links: a click can show a card instead of opening the link`.

### Task 3: The room page's card provider

**Files:**
- Create: `src/app/room/MessageLinkCards.tsx`
- Test: `src/app/room/MessageLinkCards.test.tsx`
- Modify: `src/app/room/Room.tsx` (wrap `<RoomView ... />` in `<MessageLinkCards roomId={room.roomId}>`, inside the outer `PluginPanelControlsContext.Provider`)

**Interfaces:**
- Consumes: `useMessageLinkMatcher` (Task 1), `MessageLinkCardContext` (Task 2), `registeredPlugins`, `useOptionalClientConfig`, `PopOut` from `../ui/directional`, `Menu` from `../ui/glass/GlassPrimitives`, `FocusTrap` from `focus-trap-react`, `ErrorBoundary`, `reportBoundaryError`, `pluginFailure`.
- Produces: `MessageLinkCards({ roomId, children, plugins? }: { roomId: string; children: ReactNode; plugins?: readonly RegisteredPlugin[] })`, `plugins` defaulting to `registeredPlugins` (for tests). State: `{ link: HTMLAnchorElement; href: string; card: MessageLinkCard } | undefined`. It provides a function that looks up the card, sets the state and returns true, or returns false. It draws `PopOut` with `anchor={link.getBoundingClientRect()}`, `position="Bottom"`, `align="Start"`, `offset={4}`, `content` = `FocusTrap` (`initialFocus: false`, `returnFocusOnDeactivate: true`, `clickOutsideDeactivates: true`, `escapeDeactivates: true`, `onDeactivate: close`) around `Menu` around `ErrorBoundary key={href}` (fallback null, `onError` closes the card, logs `[plugin <tag>] failed to render its message link card` and reports) around `<card.Component href roomId close />`. `close` sets the state to undefined and focuses `link` if it is still in the document. A room switch (`roomId` change) closes the card.

- [ ] **Step 1: Write the failing tests** (mock `focus-trap-react` as the example plugin's test does; a fake `RegisteredPlugin` whose `Component` renders its props and a Close button): `shows the card at the link with href, roomId and close`; `close() hides the card and focuses the link`; `another link's card takes the place of the first`; `a throwing Component closes the card and logs the tag`; `a link no plugin takes opens as before` (`CheckedMessageLink` inside the provider: `fireEvent.click` returns true); `closes on a switch to another room` (rerender with another `roomId`).
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/room/MessageLinkCards.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the provider and the `Room.tsx` wrap.
- [ ] **Step 4: Run** it, then `npx vitest run src/app/room`, `just typecheck`, `just strict`, `just lint`. Expected: PASS, 0 errors.
- [ ] **Step 5: Commit** `Room: message link cards of client plugins show at the link`.

### Task 4: Example plugin card, docs, end-to-end spec, screenshots

**Files:**
- Modify: `src/app/plugins/__fixtures__/example-plugin/index.tsx` (a `messageLinks` entry and its comment paragraph), `index.test.tsx`, `package.json` (`apiVersion: 43`, description), `locales/de.json` if a string is added
- Modify: `docs/architecture.md` "Client plugins" (a bullet for message links after room menu entries, as "the ninth kind"; `CLIENT_PLUGIN_API_VERSION` "now 43"; "version 43 `messageLinks`" at the end of the version list)
- Create: `e2e/plugins/message-link.spec.ts`

**Interfaces:**
- Consumes: Tasks 1 to 3.
- The example entry: `match: (url) => url.hostname === 'example.org' && /^\/items\/[^/]+$/.test(url.pathname)`; `Component` shows `Example item <id>` and a button "Show item in panel" that calls `useRoomSidePanel('example', 'panel')?.open(undefined)` and then `close()`; without the panel control the button does not show.

- [ ] **Step 1: Write the failing plugin test** in `index.test.tsx`: `its message link takes example.org items only` (`plugin.messageLinks[0].match(new URL('https://example.org/items/7'))` true; `/items/7/x`, `https://example.com/items/7` false) and `its link card names the item` (`renderPluginComponent` of the `Component` with `href: 'https://example.org/items/7'`: text `Example item 7`).
- [ ] **Step 2: Run** `nix develop -c npx vitest run src/app/plugins/__fixtures__/example-plugin`. Expected: FAIL.
- [ ] **Step 3: Implement** the entry; update the docs.
- [ ] **Step 4: Write** `message-link.spec.ts` on the pattern of `e2e/plugins/room-action.spec.ts` (production build with `MINDROOM_CLIENT_PLUGINS` set to the example plugin, `serveBuild`, a disposable user, a private room with a message `See https://example.org/items/7`): a click on the link shows `Example item 7` in a menu; Escape closes it and the link has the focus; Enter on the focused link shows the card again; "Show item in panel" opens the example panel; a Ctrl+click opens a new page at `https://example.org/items/7` (route it to an empty 200 so nothing leaves the machine) and shows no card. Screenshots: `test-results/message-link/card.png` (the card open, the room around it) when `MESSAGE_LINK_SHOTS=1`.
- [ ] **Step 5: Run** on a slot: `just e2e-slot 31 --snapshot --preview npx playwright test e2e/plugins/message-link.spec.ts` after committing. Expected: PASS.
- [ ] **Step 6: Run** `just typecheck && just strict && just lint && just test`. Expected: PASS.
- [ ] **Step 7: Commit** `Example plugin: a card for example.org item links; message links in the docs`.

## Part 2: `mindroom-ai/pull-request-client-plugin`, checkout `/home/basnijholt/Work/dev/pull-request-client-plugin`

Its tests run with the app's: `cd <mindroom-chat> && MINDROOM_CLIENT_PLUGINS=/home/basnijholt/Work/dev/pull-request-client-plugin nix develop -c npx vitest run /home/basnijholt/Work/dev/pull-request-client-plugin`.

### Task 5: Repository, GitHub client and patch assembly

**Files:**
- Create: `package.json`, `.npmrc` (`legacy-peer-deps=true`, so the Pierre packages' React 18.3 peer range installs no React), `.gitignore`, `LICENSE` (MIT, "Copyright (c) 2026 MindRoom"), `NOTICE` (that `src/diff/*`, `src/presentation.tsx`, `src/PullRequestCard.tsx` and `src/PullRequestPanel.tsx` port T3 Code files, with T3 Code's full MIT text and copyright), `README.md` (what it does, how to build it in, the token note), `tsconfig.json` (extends nothing; `jsx: react-jsx`, `moduleResolution: bundler`, `paths` for `@mindroom/client-sdk/*` to `<mindroom-chat>/src/client-sdk/*` documented as a local setting)
- Create: `src/github.ts`, `src/github.test.ts`

**Interfaces:**
- `package.json`: `name: "pull-request-client-plugin"`, `version: "0.1.0"`, `mindroomClientPlugin: { id: "pull-requests", apiVersion: 43, entry: "./src/index.tsx" }`, `dependencies`: `@pierre/diffs` `1.6.4`, `@pierre/trees` `1.0.0-beta.6`, `lucide-react`; `peerDependencies`: `react`, `react-dom`, `folds`, `@tanstack/react-query`.
- Produces, in `src/github.ts`:
  - `type PullRequestRef = { owner: string; repo: string; number: number }`
  - `parsePullRequestUrl(url: URL): PullRequestRef | undefined`: host `github.com` or `www.github.com`, protocol `https:`, path `/<owner>/<repo>/pull/<number>` then nothing, `/` or `/<more>`; owner `[A-Za-z0-9-]{1,39}`, repo `[A-Za-z0-9._-]{1,100}`, number a positive integer without leading zero.
  - `pullRequestUrl(ref: PullRequestRef): string` (`https://github.com/o/r/pull/n`)
  - `type PullRequest = { title: string; state: 'open' | 'closed' | 'merged'; draft: boolean; body: string; author: { login: string; avatarUrl: string | null; url: string | null } | null; createdAt: string; updatedAt: string; baseRef: string; headRef: string; additions: number; deletions: number; changedFiles: number; url: string }` (`state` `merged` when `merged_at` is set)
  - `type PullRequestFile = { path: string; previousPath: string | null; status: 'added' | 'removed' | 'modified' | 'renamed' | 'copied' | 'changed' | 'unchanged'; additions: number; deletions: number; patch: string | null; url: string }` (`url`: `<pr url>/files` is enough)
  - `class GitHubError extends Error { kind: 'notFound' | 'rateLimited' | 'badToken' | 'failed'; status: number }`: 404, or 401 without a token, `notFound`; 401 with a token `badToken`; 403 or 429 with `x-ratelimit-remaining: 0`, or 429, `rateLimited`; else `failed`. A network failure is `failed` with status 0. The message never holds the token.
  - `fetchPullRequest(ref, token: string | undefined, signal?: AbortSignal): Promise<PullRequest>`
  - `fetchPullRequestFiles(ref, token, signal?): Promise<PullRequestFile[]>`: pages `per_page=100&page=1..30`, stopping after a page with fewer than 100 files.
  - `filePatch(file: PullRequestFile): string | null`: null without `patch`; else `diff --git a/<prev or path> b/<path>\n`, then `new file mode 100644\n` (added), `deleted file mode 100644\n` (removed), or `similarity index 100%\nrename from <prev>\nrename to <path>\n` (renamed), then `--- a/<prev or path>` or `--- /dev/null` (added), `+++ b/<path>` or `+++ /dev/null` (removed), then the patch and a final newline.

- [ ] **Step 1: Create the repository**: `gh repo create mindroom-ai/pull-request-client-plugin --public --description "MindRoom Chat client plugin: GitHub pull request cards and a side panel with the changed files and their diffs, ported from T3 Code"`, clone it to the checkout path, commit `LICENSE`, `NOTICE`, `README.md`, `.gitignore` on `main` and push. Then branch `initial-plugin`.
- [ ] **Step 2: Write the failing tests** in `github.test.ts`: a `parsePullRequestUrl` table (accepted: `https://github.com/mindroom-ai/mindroom-chat/pull/200`, `.../pull/200/`, `.../pull/200/files`, `.../pull/200#discussion_r1`, `.../pull/200?w=1`, `https://www.github.com/a/b.c/pull/1`; rejected: `http://github.com/a/b/pull/1`, `https://github.com/a/b/pulls`, `.../pull/abc`, `.../pull/0`, `.../pull/01`, `https://gitlab.com/a/b/pull/1`, `https://github.com/a/pull/1`); `sends the token only when set` (a stubbed `fetch` sees `authorization: Bearer t` with `'t'`, none with undefined, and always the Accept and API version headers, and a URL starting `https://api.github.com/repos/a/b/pulls/1`); `maps a merged pull request` (`merged_at` set: `state: 'merged'`); `pages until a short page` (100, 100, 3 files: three requests, 203 files); `the error kinds` (404 `notFound`; 401 without token `notFound`; `401 with a token is badToken`; 403 with `x-ratelimit-remaining: 0` `rateLimited`; 403 without it `failed`; 500 `failed`; a rejected fetch `failed` with status 0; no message contains the token); `filePatch` cases: added, removed, renamed with changes, modified, and `keeps a patchless file` (null patch: `null`); `parses the assembled patches` (join three `filePatch` outputs, `parsePatchFiles` from `@pierre/diffs/utils/parsePatchFiles` yields three files with the right `name`, `prevName` and `type`).
- [ ] **Step 3: Install** `npm install` in the checkout. Run the plugin tests. Expected: FAIL, module not found.
- [ ] **Step 4: Implement** `src/github.ts`.
- [ ] **Step 5: Run** the tests. Expected: PASS.
- [ ] **Step 6: Commit** `GitHub pull requests and their files from the REST API`.

### Task 6: Presentation, token, queries, card and plugin entry

**Files:**
- Create: `src/presentation.tsx` (port of `pullRequestIcons.tsx`'s state table and `pullRequestPresentation.tsx`'s `resolvePullRequestState`, `PullRequestActorAvatar`, `PullRequestDiffStat`, `PullRequestMetaLine`; plus `RelativeTime` with `Intl.RelativeTimeFormat` in the app's language), `src/theme.ts` (`pluginRootStyle(): CSSProperties` setting `--pr-fg`, `--pr-muted`, `--pr-border`, `--pr-surface`, `--pr-hover`, `--pr-added`, `--pr-removed`, `--pr-open`, `--pr-closed`, `--pr-merged`, `--pr-draft`, `--pr-font-mono` from folds `color` and `config` tokens), `src/styles.css` (classes prefixed `mrpr-`)
- Create: `src/token.tsx`: `useGitHubToken(): { token: string | undefined; setToken(value: string): void; forget(): void }` over `usePluginStorage('pull-requests')`, re-rendering on change; `TokenForm({ reason }: { reason: 'notFound' | 'rateLimited' | 'badToken' })` (password field, Save; one line saying the token stays in this browser where the page's scripts can read it)
- Create: `src/queries.ts`: `usePullRequest(ref: PullRequestRef | undefined)` and `usePullRequestFiles(ref, enabled: boolean)` (`useQuery`, keys `['pull-requests', 'pr', owner, repo, number, tokenSet]` and `[..., 'files']`, `staleTime: 60_000`, `retry` false for `GitHubError` other than `failed`)
- Create: `src/PullRequestCard.tsx`: `PullRequestCard({ href, close }: MessageLinkCardProps)`, `src/strings.ts` (English strings, the exact copy of Global Constraints)
- Create: `src/index.tsx`: the `ClientPlugin` (`messageLinks: [{ match: (url) => parsePullRequestUrl(url) !== undefined, Component: PullRequestCard }]`, `sidePanels: [{ id: 'pull-request', label: 'panelLabel', icon: Icons.Code, remember: true, Component: lazy(() => import('./PullRequestPanel')) }]`, `translations: { en }`)
- Test: `src/PullRequestCard.test.tsx`, `src/presentation.test.tsx`

**Interfaces:**
- Consumes: Task 5's `github.ts`; SDK `usePluginStorage`, `usePluginTranslation`, `useRoomSidePanel`, `MessageLinkCardProps`.
- Produces: the card's "Open in side panel" calls `useRoomSidePanel('pull-requests', 'pull-request')?.open({ owner, repo, number })` then `close()`, shown only when that control exists; "Open on GitHub" is an `<a href={href} target="_blank" rel="noreferrer noopener">`; "Copy link" writes `href` with `navigator.clipboard.writeText` and shows "Copied".

- [ ] **Step 1: Write the failing tests** (`renderPluginComponent` with `plugin`, inside a fresh `QueryClientProvider`; `fetch` stubbed; `@mindroom/client-sdk/core` partly mocked for `useRoomSidePanel`): `shows the repository, number, state, title and author` (`mindroom-ai/mindroom-chat`, `#200`, `Open`, the title, the login); `shows the merged state`; `shows the token form for a private pull request` (404: the not-found copy and a password field; Save stores the token and the next request carries `Bearer`); `shows the bad token state` (401 with a stored token: a line saying the token was refused, Forget token); `opens the side panel with the reference and closes` (`open` gets `{ owner: 'mindroom-ai', repo: 'mindroom-chat', number: 200 }`, `close` called); `has no side panel action outside a room page`; `presentation.test.tsx`: `resolvePullRequestState` for open, draft, closed, merged; `PullRequestDiffStat` renders nothing for 0/0 and `+1,234 -5` otherwise.
- [ ] **Step 2: Run** the plugin tests. Expected: FAIL.
- [ ] **Step 3: Implement** the files.
- [ ] **Step 4: Run** the plugin tests. Expected: PASS.
- [ ] **Step 5: Commit** `Pull request card for GitHub links in messages, ported from T3 Code`.

### Task 7: File tree and diff view (ports)

**Files:**
- Create: `src/diff/diffRendering.ts` (port: `DIFF_THEME_NAMES` as `{ light: 'pierre-light', dark: 'pierre-dark' }`, `fnv1a32`, `getRenderablePatch` without the whitespace and partial-hunk options, `resolveFileDiffPath`, `getDiffLineStat`)
- Create: `src/diff/diffFileTree.logic.ts` (port, with `pierre-icons` replaced by `@pierre/trees`' built-in icons), `src/diff/diffFileTree.logic.test.ts` (port of T3 Code's `diffFileTree.logic.test.ts` cases that the ported functions keep)
- Create: `src/diff/DiffFileTree.tsx` (port; T3's `Button`, `Tooltip` and `MorphIcon` become the SDK's `IconButton` and `IconTooltip`; `useTheme` becomes `useThemeKind`), `src/diff/pierreTreeTheme.ts` (port of `pierre-tree-theme.ts` on the `--pr-*` variables)
- Create: `src/diff/StyledDiffCodeView.tsx` (port without the worker pool provider; `disableWorkerPool`)
- Create: `src/CodeTab.tsx`: `CodeTab({ pullRequest, files }: { pullRequest: PullRequestRef; files: PullRequestFile[] })`
- Test: `src/CodeTab.test.tsx`

**Interfaces:**
- Consumes: Task 5's `PullRequestFile`, `filePatch`; Task 6's `pluginRootStyle`.
- `CodeTab` joins the files' patches, parses them with `getRenderablePatch`, orders them with `orderDiffFilesLikeTree`, gives `StyledDiffCodeView` one `CodeViewDiffItem` per parsed file (theme by `useThemeKind()`, `diffStyle: 'unified'`, `overflow: 'wrap'`), and `DiffFileTree` every file, patchless ones included (status from `PullRequestFile.status`: `removed` to `deleted`, `renamed` and `copied` to `renamed`, `added`, else `modified`). Choosing a file calls the view's `scrollTo` for its item; a patchless file shows a row "No diff to show" with a link to `file.url`. A "Files" toggle hides and shows the tree. The layout switches with a container query at 640 px: tree at the start (240 px) beside the diffs, or above them at most 40% of the height.

- [ ] **Step 1: Port the logic tests**, run them. Expected: FAIL, module not found.
- [ ] **Step 2: Port** `diffRendering.ts` and `diffFileTree.logic.ts`. Run. Expected: PASS.
- [ ] **Step 3: Write the failing `CodeTab` tests** (jsdom; mock `@pierre/diffs/react`'s `CodeView` to render its items' file names and capture `scrollTo`, and `@pierre/trees/react`'s `FileTree`/`useFileTree` to render the paths with selection callbacks, since jsdom has no custom elements or layout): `lists every file in the tree, patchless ones included`; `gives the diff view the parsed files in tree order`; `choosing a file scrolls its diff into view`; `shows No diff to show for a patchless file`; `the Files toggle hides the tree`.
- [ ] **Step 4: Port** `DiffFileTree.tsx`, `pierreTreeTheme.ts`, `StyledDiffCodeView.tsx`; write `CodeTab.tsx`. Run. Expected: PASS.
- [ ] **Step 5: Commit** `File tree and diffs of a pull request, ported from T3 Code`.

### Task 8: The side panel

**Files:**
- Create: `src/PullRequestPanel.tsx` (default export, the panel `Component`: `({ roomId, request }: { roomId: string; request?: unknown })`), `src/PullRequestPanel.test.tsx`

**Interfaces:**
- Consumes: Tasks 5 to 7; SDK `useMarkdownHtml`, `usePluginTranslation`.
- `request` is used only when it is `{ owner: string; repo: string; number: number }` and those pass `parsePullRequestUrl(new URL(pullRequestUrl(request)))`; anything else shows the empty state.
- Layout, ported from `PullRequestDetailLayout.tsx`: crumbs `owner/repo #n · <state>`, the title, meta line (author, "updated <relative>"), `base ← head` in monospace with the file count and `PullRequestDiffStat`, "Open on GitHub"; a tab bar (Summary, Code; `role="tablist"`, arrow keys move between tabs); Summary renders `useMarkdownHtml(body)` into a `div` with `dangerouslySetInnerHTML`, or "No description."; Code loads `usePullRequestFiles(ref, codeShown)` and renders `CodeTab`, with a loading line and the error states of the card (shared component from Task 6). While a token is stored, the header has "Forget token" (`useGitHubToken().forget`).

- [ ] **Step 1: Write the failing tests**: `shows the empty state without a request`; `ignores a request of another shape` (`{ owner: '../x', repo: 'y', number: 1 }`, `'text'`); `shows the header` (title, `mindroom-ai/mindroom-chat`, `#200`, `main`, `feature`, `+10 -2`, `3 files`); `renders the description` (Markdown `**bold**` becomes a `strong`, once the renderer has loaded: `await findByText`); `No description.` for an empty body; `loads the files only when the Code tab shows` (no `/files` request until the Code tab is chosen, then one); `Forget token shows only with a token and removes it`.
- [ ] **Step 2: Run** the plugin tests. Expected: FAIL.
- [ ] **Step 3: Implement** the panel.
- [ ] **Step 4: Run** the plugin tests. Expected: PASS.
- [ ] **Step 5: Commit** `Pull request side panel: header, Summary and Code, ported from T3 Code`.

### Task 9: Build in, live check, screenshots, pull requests

**Files:**
- Create (throwaway, not committed in either repository): `e2e/plugins/pull-request-shots.spec.ts` in the `mindroom-chat` checkout

- [ ] **Step 1: Build** `cd <mindroom-chat> && MINDROOM_CLIENT_PLUGINS=/home/basnijholt/Work/dev/pull-request-client-plugin nix develop -c npx vite build --outDir /tmp/pr-plugin-build --emptyOutDir`. Expected: exit 0; the plugin's diff chunk is not in the entry chunk (`grep -l pierre /tmp/pr-plugin-build/assets/index-*.js` finds nothing).
- [ ] **Step 2: License check** `MINDROOM_CLIENT_PLUGINS=... nix develop -c just license-check`. Expected: PASS.
- [ ] **Step 3: Write the throwaway spec** on the pattern of Task 4's spec, building with the plugin, a room message `Ready for review: https://github.com/mindroom-ai/mindroom-chat/pull/200`, then: click the link, wait for the card's title, screenshot `card.png`; "Open in side panel", screenshot `panel-summary.png`; Code tab, wait for the tree and a diff header, choose a file, screenshot `panel-code.png`; Fill, screenshot `panel-code-filled.png`; switch the theme to dark, screenshot `panel-code-dark.png`. Live GitHub requests, no token.
- [ ] **Step 4: Run** it on a slot: `MINDROOM_CLIENT_PLUGINS=... just e2e-slot 32 npx playwright test e2e/plugins/pull-request-shots.spec.ts`. Look at every screenshot (Read the PNG); fix what looks wrong in the plugin and run again.
- [ ] **Step 5: Push and open** the `mindroom-chat` pull request (Tasks 1 to 4) with the example card screenshot; the plugin pull request (`initial-plugin` into `main`) with the five screenshots; each body links the other.
