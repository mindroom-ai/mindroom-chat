# A message link that opens its plugin's side panel on a click

Date: 2026-11-16. Repos: `mindroom-ai/mindroom-chat` (host, plugin API version 62) and
`mindroom-ai/pull-request-client-plugin`.

## Intent

Bas clicks GitHub pull request links in agent replies many times a day. Today a plain click shows
the pull request plugin's link card (title, author, then "Open in side panel", "Open on GitHub",
"Copy link"), so reaching the side panel takes two clicks and the card covers the message.

What he asked for (2026-11-16):

- On desktop, one click on a pull request link opens it in the side panel.
- A click on the same link while the side panel already shows that pull request opens GitHub in a
  new tab.
- On a phone the side panel covers the whole screen, so a tap keeps showing today's card.

Assumptions:

- The card's header and "Copy link" are not needed on desktop. The panel shows the same header,
  the browser's context menu copies the link, and Cmd/Ctrl-click still opens GitHub.
- A hover preview on message links is out of scope (a possible follow-up).

Success: on desktop a single click shows the pull request in the panel, a second click on the same
link opens GitHub, and nothing changes on a phone or for plugins that don't opt in.

## Design

### Plugin API: `MessageLink.sidePanel` (version 62)

```ts
export type MessageLink = {
  match: (url: URL) => boolean;
  Component: ComponentType<MessageLinkCardProps>;
  /**
   * Since version 62: off a phone, a plain click on the link opens this side panel of the same
   * plugin with `request(url)` instead of showing `Component`. A click while the panel shows,
   * unfolded, the same request follows the link (a new tab).
   */
  sidePanel?: { id: string; request: (url: URL) => unknown };
};
```

- `id` names one of the same plugin's `sidePanels`. The host resolves it to `<pluginId>/<id>`, as
  `useRoomSidePanel` does.
- `request(url)` must be pure and synchronous and return what the panel's `Component` gets as
  `request`. It must be JSON-safe, since a `remember`ed panel already stores it as JSON.
- A `sidePanel` that is not `{ id: string, request: function }` leaves the link out at
  registration (`isMessageLink`), as a non-boolean `hoverCard` leaves a badge out.
- Declarative rather than an `onClick` callback. The host owns the panel state, the phone check
  and the click, so a plugin can't open a new tab outside the click, which Safari would block.
  Plugins also need no hooks or bookkeeping of what the panel shows.

### Host: what a plain click does

A plain click, or Enter on the focused link, already reaches `MessageLinkCards.show(link, href)`
after the app's link check (`CheckedMessageLink`). For the matched `MessageLink`:

1. No `sidePanel`, no panel controls in context (a page without room side panels), on a phone
   (`ScreenSize.Mobile`), or the named panel not registered: show the card (today).
2. `request(url)` throws: log with the plugin's tag and show the card.
3. The panel shows unfolded (beside or filling the room) and its current request is JSON-equal to
   `request(url)`: return `false`, so the click goes on as a normal link click. Message links
   carry `target="_blank" rel="noopener noreferrer"` (`sanitize.ts`), so GitHub opens in a new tab
   from the click itself.
4. Otherwise open the panel with `request(url)`, as `useRoomSidePanel().open` does (it takes the
   place of another panel, and a folded panel unfolds), close any card that shows, and swallow the
   click (`preventDefault` and `stopPropagation`, as for a card).

A folded panel counts as not showing: the first click unfolds it on the link's pull request, and
the next click opens GitHub.

### Host: state the click needs

`PluginPanelControls` (`src/app/plugins/sidePanels.ts`, built in `Room.tsx`) gets one function:

```ts
/** Whether panel `id` shows, unfolded, with a request JSON-equal to `request`. */
showsRequest: (id: string, request: unknown) => boolean;
```

It reads `now.current` (shown id, layout, the plugin panel's stored request), so it is current
inside a click handler and keeps its identity. `MessageLinkCards` reads the controls from
`PluginPanelControlsContext` and `useScreenSizeContext()`. `ThreadView` (a plugin's surface) gets
the same behavior wherever it renders inside those providers, and falls back to the card where
there are none.

Opening goes through `PluginPanelControls.open`, whose `request` (`roomPanels.ts`) resets a folded
panel's layout and keeps one that fills the room.

### Plugin

`pull-request-client-plugin/src/index.ts`:

```ts
messageLinks: [{
  match: (url) => parsePullRequestUrl(url) !== undefined,
  Component: PullRequestCard,
  sidePanel: { id: 'pull-request', request: (url) => parsePullRequestUrl(url) },
}],
```

`PullRequestCard` passes `parsePullRequestUrl(new URL(href))` to `panel.open`, the same value, so
JSON equality holds for a panel opened either way. The card stays as it
is: phones use it, and so do pages without panel controls. The plugin's required API version
becomes 62, and `mindroom-infra/pins` gets a bump after both PRs merge.

## Error handling

- A throwing `request` or an unknown panel `id` falls back to the card, so the link still works.
- A request that doesn't serialize (a cycle) makes `showsRequest` return `false`, so the click
  opens the panel again instead of following the link.
- A room switch while a card shows still closes it (unchanged).

## Testing

Host (`MessageLinkCards.test.tsx`, `sidePanels`/`Room` tests):

- With `sidePanel` on desktop, a click opens the panel with the request and shows no card.
- A click while the panel shows the same request unfolded is not prevented (default proceeds).
- A click while the panel shows another request, or is folded, opens it with the new request.
- On a phone, a click shows the card. Without controls, a click shows the card.
- A throwing `request` shows the card and logs. A malformed `sidePanel` leaves the link out.
- Modified, middle and context-menu clicks are unchanged (existing tests).
- e2e `e2e/plugins/message-link.spec.ts`: the example plugin opts in. Desktop: click → panel, no
  card; click again → a popup page with the link's URL. Phone viewport: tap → card.

Plugin: a unit test that `index.ts`'s message link names `pull-request` and that its request equals
what `PullRequestCard` passes to `panel.open`.

Docs: `docs/client-plugins.md` "Message links" describes `sidePanel` (since version 62).
