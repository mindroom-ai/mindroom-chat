# Pull request client plugin: design

Date: 2026-11-09. Status: chosen (Bas Nijholt picked the recommended options: a new public repository, and GitHub's API called from the browser).

## Goal

A GitHub pull request link in a room's message opens, on a plain click, a small card about the pull request, as T3 Code's pull request preview card shows one: the repository and number, the state, the title, the author and when it was opened. From the card the pull request opens in a side panel of the room that shows it as T3 Code's pull request panel does: the header, a Summary tab with the description, and a Code tab with the changed files as a tree (the explorer) beside their diffs.

Success: in a room, a message with `https://github.com/<owner>/<repo>/pull/<n>` (as text or as an HTML link); clicking it shows the card; "Open in side panel" opens the panel; the Code tab lists every changed file in the tree, and choosing one scrolls its diff into view.

## Sources

- T3 Code, `github.com/pingdotgg/t3code` at `8ab427c6077f1e8b75ea608a363006ccb697f5f6`, MIT, "Copyright (c) 2026 T3 Tools Inc.". T3 Code is not on the AGENTS.md list of sources a session may not open; its code may be copied under its license, keeping its notice.
- What is ported (adapted from Tailwind classes to the app's tokens, and from T3 Code's server data to GitHub's REST API):
  - `apps/web/src/components/pullRequest/PullRequestLinkPreview.tsx`: the card's content.
  - `apps/web/src/components/pullRequest/pullRequestIcons.tsx` and parts of `pullRequestPresentation.tsx`: state presentation, actor avatar, diff stat, meta line.
  - `apps/web/src/components/pullRequest/PullRequestDetailLayout.tsx`: the panel header and tab bar.
  - `apps/web/src/components/diffs/diffFileTree.logic.ts`, `DiffFileTree.tsx` and `apps/web/src/pierre-tree-theme.ts`: the file tree.
  - `apps/web/src/components/diffs/StyledDiffCodeView.tsx` and parts of `apps/web/src/lib/diffRendering.ts`: the diff view and patch parsing.
  - The layout of `apps/web/src/components/pullRequest/PullRequestCodeTab.tsx` (tree beside diffs), without its review threads, viewed-file marks, commits and workers.
- Libraries T3 Code builds these on, used as installed packages of the plugin: `@pierre/diffs` 1.6.4 and `@pierre/trees` 1.0.0-beta.6 (Apache-2.0), `lucide-react` (ISC), and through them `shiki` (MIT), `diff` (BSD-3-Clause) and `preact` (MIT). All are on the AGENTS.md license list. Both Pierre packages ask for React `^18.3.1 || ^19`; the app ships React 18.2.0, and every React API their React bindings import exists in 18.2.

Left out: everything in T3 Code's pull request UI that writes (review, comments, merge, labels, edits, reviewers), its Timeline and Guide tabs, its pull request list page, commit links, the hover trigger (a click shows the card, so phones get it too) and the right-click menu.

## Part 1: a client SDK addition in this repository (`mindroom-chat`)

Plugins today can render whole messages (from agents) and add side panels, but nothing lets a plugin act on a click on a link inside any message. Version 43 of the client SDK adds that, as a new contribution kind.

### Contract

`ClientPlugin.messageLinks?: readonly MessageLink[]`, exported from `@mindroom/client-sdk/core` with its props type:

```ts
type MessageLinkCardProps = {
  /** The link's address, its href. */
  href: string;
  /** The room whose message holds the link. */
  roomId: string;
  /** Closes the card; the focus goes back to the link. */
  close: () => void;
};

type MessageLink = {
  /** Whether a click on this link shows the card; pure and synchronous, given the parsed http(s) URL. */
  match: (url: URL) => boolean;
  /** The card, shown at the link. */
  Component: ComponentType<MessageLinkCardProps>;
};
```

Behavior:

- Applies to the links of messages in a room's page (its timeline in every view, a thread, the pinned messages), every link `CheckedMessageLink` draws there with an `http:` or `https:` address. Elsewhere (the inbox, search, thread previews outside a room's page) links stay as they are.
- A plain click (primary button, no Ctrl, Meta, Shift or Alt), or Enter on the focused link, on a link that the first enabled plugin's `match` takes (build order, then list order) shows that plugin's `Component` in a pop-out at the link, below it and lined up with its start (mirrored in right-to-left), on the app's glass menu surface, instead of opening the link. A modified click, a middle click, the context menu and dragging keep the browser's behavior.
- A link whose text reads as another address keeps the app's check first; once confirmed, it opens as a link, without a card.
- The click goes no further than the link, so a thread card around it does not open its thread.
- Escape, a click outside the card and `close()` close the card, and the focus goes back to the link. One card shows at a time; another link's card takes its place.
- The card renders inside the room's page, so it can use what a message renderer can, such as `useRoomSidePanel` to open the plugin's panel.
- A `match` that throws counts as no match. A `Component` that throws closes the card; both are logged with `[plugin <id>@<version>]`, and a throwing `Component` is reported as the other contribution kinds report theirs. `plugins.<id>.enabled: false` and `?plugins=off` turn it off as they turn off the other kinds.

### Placement

`rich-text` (layer 4) cannot import `plugins` (also layer 4), so the seam is a context:

- `src/app/rich-text/messageLinkCards.ts`: `MessageLinkCardContext`, a function `(link: HTMLAnchorElement, href: string) => boolean` that shows a card and says whether one took the click; undefined outside a room's page.
- `src/app/rich-text/CheckedMessageLink.tsx`: after its own check, a plain click asks the context and, when a card took it, prevents the default and stops the event.
- `src/app/plugins/messageLinks.ts`: the type, `isMessageLink` (the registry's check of what a plugin gives), and `useMessageLinkMatcher(plugins, config)`, which finds the entry for a URL with each failure logged.
- `src/app/plugins/registry.ts`: the kind's list per plugin.
- `src/app/room/MessageLinkCards.tsx`: the provider in `Room.tsx` around `RoomView`, inside `PluginPanelControlsContext`; it keeps which card shows, at which link, and draws it in the app's `PopOut` and glass `Menu`, with a focus trap and an error boundary.
- `scripts/client-plugins.mjs`: `CLIENT_PLUGIN_API_VERSION` 43, and `src/build/clientPlugins.test.ts`.
- The example plugin (`src/app/plugins/__fixtures__/example-plugin`): a card for `https://example.org/items/<id>` links, "Example item <id>", with a button that opens its panel; `apiVersion` 43; its test.
- `docs/architecture.md` "Client plugins": the kind's bullet and version 43 in the list.

### Tests

- `messageLinks.test.ts`: the registry keeps only well-formed entries; the matcher takes the first match in order, skips disabled plugins, treats a throwing `match` as none and logs it; only `http:` and `https:` URLs reach `match`.
- `CheckedMessageLink.test.tsx`: a plain click with a card provider shows the card and does not follow the link; Ctrl, Meta, Shift, Alt and middle clicks do; a misleading link asks first and then opens without a card; without a provider nothing changes.
- `MessageLinkCards.test.tsx`: the card shows at the link with `href`, `roomId`, `close`; Escape and `close()` close it and the focus returns; a throwing `Component` closes it and logs the tag.
- `e2e/plugins/message-link.spec.ts`: in a room, a message with an example item link; a click shows "Example item 7"; its button opens the example panel; Ctrl+click opens a new tab instead. Its screenshots go in the pull request.

## Part 2: the plugin, `mindroom-ai/pull-request-client-plugin`

A new public repository (MIT, "Copyright (c) 2026 MindRoom", with T3 Code's notice for the ported files in `NOTICE` and at the top of each ported file). Plugin id `pull-requests`, `apiVersion` 43. Built into a client with `MINDROOM_CLIENT_PLUGINS=<checkout>`.

### Layout

```
package.json        mindroomClientPlugin { id: "pull-requests", apiVersion: 43, entry: "./src/index.tsx" }
LICENSE  NOTICE  README.md
src/index.tsx       the ClientPlugin: messageLinks, sidePanels, translations
src/github.ts       URL parsing, GitHub requests, patch assembly, error kinds
src/queries.ts      TanStack Query hooks over github.ts, on the app's QueryClient
src/token.tsx       the stored token and the form that sets it
src/PullRequestCard.tsx       the card (T3 Code's preview card) and its actions
src/PullRequestPanel.tsx      the side panel: header, tabs, Summary
src/CodeTab.tsx               the Code tab: tree beside diffs
src/diff/diffFileTree.logic.ts   ported
src/diff/DiffFileTree.tsx        ported
src/diff/diffRendering.ts        ported subset
src/diff/StyledDiffCodeView.tsx  ported
src/presentation.tsx  state, avatar, diff stat, meta line, relative time (ported)
src/styles.css        the plugin's classes, on CSS variables its root sets from folds tokens
*.test.ts(x)          beside their subjects
```

### Data

- `parsePullRequestUrl(url)`: `https://github.com/<owner>/<repo>/pull/<number>` with any tail (`/files`, `/commits`, a query, a fragment); owner and repo as GitHub allows them; anything else is no pull request. `match` is this test.
- Requests go to `https://api.github.com` only, with `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, and `Authorization: Bearer <token>` when the account stored one:
  - `GET /repos/{owner}/{repo}/pulls/{number}`: title, state, draft, merged_at, user, created_at, updated_at, body, base and head refs, additions, deletions, changed_files, html_url. The card and the panel's header share this query.
  - `GET /repos/{owner}/{repo}/pulls/{number}/files?per_page=100&page=<n>`, page after page until a page has fewer than 100 files (GitHub lists 3000 at most), loaded when the Code tab first shows.
- Each file's `patch` becomes a Git diff of its own (`diff --git` header, `new file`, `deleted file` or `rename from`/`rename to` lines, `---`/`+++`), joined and parsed with `@pierre/diffs`' `parsePatchFiles`. A file without a `patch` (binary, or too big for GitHub to send) still shows in the tree, and in the diff list as its name with "No diff to show" and a link to it on GitHub.
- Queries use the app's `QueryClient` (`useQuery`, a key under `['pull-requests', ...]`, a 60 s stale time), so the card and the panel do not ask twice.
- Errors, in the card and the panel: 404 or 401 without a token, "GitHub did not find this pull request. A private repository needs a token." with the token form; 403 or 429 with `x-ratelimit-remaining: 0`, "GitHub's rate limit was reached." with the token form when there is none; any other failure, its status and a Retry button.

### Token

- 🔒 A fine-grained personal access token with read access to pull requests and contents, pasted into a password field in the card or the panel, stored with `usePluginStorage('pull-requests')` under `githubToken`. That is localStorage, per signed-in account, deleted with the account's plugin storage on sign-out; any script running on the page can read it, and the form says so in one line. It is sent to `https://api.github.com` only. The panel's menu has "Forget token".

### Card

- Port of T3 Code's preview card: `owner/repo #n · <state icon> <state>`, the title, the author's avatar and login, "opened <relative time>"; a loading line until the pull request arrives; the error states above.
- Actions under it: "Open in side panel" (opens the plugin's panel with `{ owner, repo, number }` and closes the card), "Open on GitHub" (the link's own address, new tab), "Copy link".

### Side panel

- `sidePanels: [{ id: 'pull-request', label: 'panelLabel', icon: Icons.Code, remember: true, Component }]`, in the room menu (the default placement), with the room's frame (title, Close, Fill, Fold, resize). `remember: true` reopens it in the room with its request, which holds only `{ owner, repo, number }`. `Component` is `React.lazy`, so the diff libraries load only when a panel opens.
- Without a request (opened from its toggle): "Click a pull request link in a message to show it here."
- Header (port of `PullRequestDetailHeaderBody`): `owner/repo #n` and state, the title, the author and "updated <relative time>", `base ← head` branches, the file count and `+additions -deletions`, "Open on GitHub".
- Tabs (port of `PullRequestDetailTabBar`): Summary and Code.
- Summary: the description as Markdown through the SDK's `useMarkdownHtml` (sanitized by the app), or "No description."
- Code (layout of `PullRequestCodeTab`): the file tree (`@pierre/trees`, ported `DiffFileTree`) beside the diffs (`@pierre/diffs`' `CodeView`, ported `StyledDiffCodeView`) when the panel is at least 640 px wide, else above them at most 40% of the height; a button hides and shows the tree. Choosing a file in the tree scrolls its diff to the top; the diff theme follows `useThemeKind()` (`pierre-light` or `pierre-dark`). Unified diffs, wrapped lines.

### Tests (with the app's unit tests, `MINDROOM_CLIENT_PLUGINS=<checkout> just test <checkout>`)

- `github.test.ts`: URL parsing (accepted tails, rejected hosts and paths); patch assembly for added, removed, renamed and patchless files; paging stops; the error kinds from status and headers; the token header only with a token.
- `diffFileTree.logic.test.ts`: the ported logic's cases.
- `PullRequestCard.test.tsx` (`renderPluginComponent`, `fetch` stubbed): loading, then the card's content; the 404 state shows the token form, and saving it asks again with the token; "Open in side panel" calls the panel's `open` with the request and closes the card.
- `PullRequestPanel.test.tsx`: the empty state; the header from a stubbed pull request; Summary renders the description; Code lists the files in the tree.
- Screenshots of the card and the panel on a public pull request, through a throwaway Playwright spec against `just e2e-slot` with the plugin built in, go in the plugin's pull request.

## Delivery

1. Pull request in `mindroom-chat` (branch `t3/t3-pr-context-plugin`): Part 1, with this spec, screenshots of the example card.
2. New repository `mindroom-ai/pull-request-client-plugin`: a first commit on `main` with the license, notice and readme, then a pull request with the plugin, its tests and screenshots. Its `apiVersion` 43 builds only into a client with Part 1.
