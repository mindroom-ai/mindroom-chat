# Thread details

Bas Nijholt asked on 2026-11-15 to make the client plugin system richer: the pull request plugin shows a thread's pull requests on its card, and he wants to "see more metadata by just hovering over the cards, like in T3 Code": which repository it is, and the branch name. What does not fit on the card can show "in the submenu or something", and phones and the iOS app need something convenient too.

## Understanding

- The thread card's chips stay small: a state icon and `#123`, the repository only when the room's links span several. The details belong in a surface that opens on demand.
- T3 Code's sidebar shows a glass hover card on a thread row: the title, the project, the branch (middle truncated), the model, errors, and a short list of the thread's pull requests. It is a tooltip: nothing in it takes a click.
- On a phone there is no hover. The thread's menu (the card's More Options button, a right-click) is the "submenu" Bas named, and a long press is how a finger opens a menu on iOS.
- Today a chip's only detail is its native `title` tooltip (`owner/repo #N state` and the title), which a phone never shows.

Assumptions (not said, chosen here):

- "Hovering over the cards" means the whole card, as in T3 Code, not only its chips.
- The details are a new kind of plugin contribution, so any plugin can add its own (the app has no repository or branch of its own to show). The pull request plugin is the first to use it.
- The hover card shows only what plugins contribute. The app's own facts (agents, model, tags) are a follow-up.
- The hover card is read-only, like T3 Code's. Opening a pull request stays the chip's click and the strip's buttons.

## Scope

In:

- SDK version 57: a new contribution kind `threadDetails`.
- The app: a hover card on Compact thread cards, a details group at the top of the thread's menu, and a long press on a Compact card that opens that menu.
- The pull request plugin: a `ThreadDetails` component with each pull request's repository, title, branches, size, author and checks, and the thread's worktree.

Out:

- Hover cards on the Threads page, the sidebar's thread rows and the timeline's thread badge.
- Links, buttons or copy actions inside the details.
- The app's own thread facts in the hover card.
- Haptics on the long press in the iOS app.

## SDK: `threadDetails`

`ClientPlugin.threadDetails` is the eleventh kind: a list of `{ shows?, Component }` (`src/app/plugins/threadDetails.ts`).

- `shows(room, threadId)`, pure and synchronous, says whether the thread has details from this contribution; without it, every thread does. One that throws counts as false, logged with `[plugin <id>@<version>]`. Room menu entries' `shows(room)` is the precedent.
- `Component` gets `{ room, threadId }`, as a thread card badge does, and draws rows of text: no button, no link, nothing that takes the focus. It renders inside the room's page, so the room hooks work.
- The app reads `shows` when a surface opens, not continuously: a hover card or menu that is open keeps its contributions until it closes.
- A `Component` that throws shows nothing in its place, logged and reported with the plugin tag, and the other contributions still show.
- A lazy `Component` shows nothing until it has loaded.
- `plugins.<id>.enabled: false` and `?plugins=off` turn the kind off.
- `CLIENT_PLUGIN_API_VERSION` goes from 56 to 57; `docs/client-plugins.md` gets a "Thread details" section and the version list a 57 entry.
- The example plugin (`src/app/plugins/__fixtures__/example-plugin/`) gets a `threadDetails` contribution, since it has one of each kind.

## App

### Hover card (Compact view, pointer devices)

`src/app/threads/overview/ThreadCardDetails.tsx`, one instance per Compact view, owned by `CompactRoomView` as the thread menu is.

- Only where the page matches `(hover: hover) and (pointer: fine)`.
- Opens once the pointer has rested on a card's shell for 500 ms and some enabled contribution `shows` for that thread. Moving within the card does not restart the wait.
- Closes when the pointer leaves the card, on a click or pointer down in the card, on scroll, when the thread's menu opens, and when the room changes. One shows at a time.
- Placed at the pointer: below it and lined up with its start, or above it when the pointer is in the lower half of the window, mirrored in right-to-left. It uses the glass menu surface, at most 320 px wide.
- `pointer-events: none` and `aria-hidden`: it is a tooltip for the eye. Keyboard and assistive technology reach the same content in the thread's menu.
- A card's order already holds while the pointer is inside the list (`orderHeld`), so the card under the hover card does not move away.
- Each contribution renders in its own error boundary; contributions are separated by a hairline.

### Details group in the thread's menu

`ThreadActionsMenu` gets a first group with the contributions that `shows` for its thread, above Open and the other actions, separated from them by the menu's group divider.

- Every place the menu opens shows it: the Compact card's More Options button, a right-click, the ContextMenu key, the new long press, and the open thread's banner (`ThreadContextBanner`).
- The group is not a menu item and is not in the focus order; the menu's first item still takes the focus.
- It scrolls with the menu when the menu's height is capped.
- No contribution `shows`: no group.

### Long press on a Compact card

A long press on a Compact card's shell (`useLongPress`, as sidebar rows and messages use it) opens the thread's menu at the press point, as a right-click does. iOS Safari fires no `contextmenu` on a long press, so this is the phone's way in.

- A sideways swipe (resolve) and a scroll move past the press slop and cancel the press, as `useLongPress` already does.
- A press that fired does not also open the thread on release.

## Pull request plugin

`src/ThreadDetails.tsx` in `mindroom-ai/pull-request-client-plugin`, with `apiVersion` 57.

- `shows(room, threadId)`: the thread has a linked pull request or a worktree, read synchronously from the room's state with `snapshotOf(room)`, the snapshot `useRoomPullRequests` already builds.
- One block per pull request, all of them (the card shows at most two):
  1. State icon, `owner/repo #123`, and the checks mark when a token is stored.
  2. The title, at most two lines.
  3. Branch icon, `head → base`, each middle truncated; `headOwner:head` when the head is in a fork (`headRepo` differs from `baseRepo`).
  4. `+120 −30 · 5 files · @author · updated 2 h ago`.
- Until GitHub answers, or when it refuses, only line 1 without state, from the link itself.
- A worktree block: branch icon and branch, and folder icon and path.
- Requests reuse `usePullRequest` and `useChecks` with the chips' query keys and `NO_FOCUS_REFETCH`, so a hover costs no request for a pull request whose chip has loaded; the ones past the card's two load on the first hover.
- Strings in `strings.ts`, English.

## Testing

App (vitest, jsdom):

- `threadDetails` registry: `shows` absent, true, false and throwing; disabled plugin; `?plugins=off`.
- Hover card: opens after 500 ms, not before; stays closed when no contribution shows; closes on leave, click and scroll; a throwing `Component` leaves the others.
- `ThreadActionsMenu`: details group first, absent without contributions, not focusable.
- Long press on a Compact card opens the menu; a swipe does not.
- The example plugin's `threadDetails`.

Plugin (vitest with `renderPluginComponent`):

- Loaded, loading and refused pull requests; a fork's head; a worktree with and without a branch; several pull requests.

End to end and screenshots, for both pull requests:

- The plugin's spec (GitHub answered by the page): the hover card on a desktop card in light and dark themes, and the thread's menu after a long press on a phone viewport.

## Delivery

1. `mindroom-ai/mindroom-chat`: the SDK kind, the hover card, the menu group and the long press.
2. `mindroom-ai/pull-request-client-plugin`: `ThreadDetails`, after 1 is merged.
3. `mindroom-infra`: bump `pins/pull-request-client-plugin` (Bas's call).
