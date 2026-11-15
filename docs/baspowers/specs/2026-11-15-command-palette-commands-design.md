# Command palette: commands that change things

Bas Nijholt asked on 2026-11-15 to "make the command panel much richer but trying to keep it easy to use. Eg changing settings and themes and other things too. Like calling agent and more".

## Understanding

- The palette finds rooms, threads, people and messages well, and offers 15 fixed actions. It should also do what the app's settings and buttons do: change a setting, pick a theme, call an agent, run what the open room's header offers.
- Easy to use means: nothing new to learn before typing, the list a person sees before typing stays short, and a row shows what it will do and what state it is in.

Assumptions (not said, chosen here):

- "Calling agent" is the voice call with a MindRoom agent that the room header and the agent's profile already start.
- The search of rooms, threads, people and messages, the tabs and the keys of today's palette stay as they are.
- One pull request.

## Scope

In:

- Rows that show a state, a current choice, a keyboard shortcut, or that open a page of choices.
- Pages of choices: Theme, Message Layout, App Language.
- Every setting of the Settings dialog, found by typing: on/off settings flip in place, the others open Settings at the setting.
- Calling a voice-capable agent of the open room or thread.
- The open room's header actions, plugin panels and plugin actions included.
- Keyboard shortcuts as commands (the help dialog, next and previous unread room, the room list), and the keys of a shortcut on the row of its action.

Out:

- A preview of a theme while it is only highlighted. A choice applies on Enter and the page stays open, so trying several is two keys each.
- A `>` prefix for commands, recently used commands, a seventh tab for settings.
- Commands for page zoom, message spacing and the date format. Typing their name leads to the setting in Settings.
- Desktop notifications as an on/off row: turning them on asks the browser for permission, which the Settings page handles. The row opens Settings there.
- Calling an agent while no room is open: a call is about a conversation.
- Header actions that open a pop-out from their button (pinned messages) and the header's own controls (schedules, canvases, the call buttons).

## Behavior

### Rows

An action row keeps its icon, title and description, and gains at its end, before the Enter mark:

- **State:** `On` or `Off`, for a row that flips something. Enter flips it, the palette stays open and the row shows the new state.
- **Current choice:** a check mark on the choice in effect.
- **Page:** a chevron. Enter opens the page.
- **Keys:** the keyboard shortcut of the same action, as the app's tooltips write it.

A settings row carries the tag `Settings` after its title, as a space carries `Space`.

Action rows get an icon of their own in place of the one terminal icon they share today.

### Pages

- Enter on a page row opens its page: the search field shows the page's title as a chip before the text, the tabs go away, the typed text is emptied, and the list holds only the page's choices with the current one highlighted.
- Typing filters the page's choices.
- Enter on a choice applies it and the page stays open, with the check mark on the new choice.
- Escape, Backspace in the empty field, or a click on the chip goes back: the tabs, the typed text and the highlighted row are as they were. A second Escape closes the palette. The footer names Escape as Back while a page is open.
- The pages:
  - **Theme:** `System Theme` as an on/off row, then every theme by its name, light ones first, as Settings orders them. Choosing a theme makes it the fixed theme and turns the system theme off, as the fixed pick in Settings does. The check mark is on the theme showing now.
  - **Message Layout:** Modern, Compact, Bubble.
  - **App Language:** every app language by its own name.
- A page's choices are also found from the palette's first list by typing ("dracula"), each tagged with its page's title (`Theme`). There Enter applies the choice and closes the palette.
- `Toggle Theme` stays.

### Settings

- With text typed, the Actions section also searches every setting the Settings dialog offers this account on this device now (`getShownSettings`), by its label, its search words and its description, in the app's language. Without text they are not listed.
- A setting whose page shows a plain switch for it is an on/off row: ENTER for Newline, Markdown Formatting, Hide Membership Change, Hide Profile Change, Show tool calls, Disable Media Auto Load, Url Preview, Hide Typing & Read Receipts, Url Preview in Encrypted Room, Enable Developer Tools, Show Hidden Events, Send error reports, Notification Sound. The row's state is what the switch shows (so `Disable Media Auto Load` is `On` while media does not load).
- Every other setting is a row that opens Settings on its page with the setting scrolled to, highlighted and focused, as a result of the dialog's own search does. Its description says where it is: `Appearance › Display`.
- The settings the pages cover (the theme picks, the system theme, the message layout, the app language) and the tour's setting (already two actions) are left out, so nothing shows twice.

### Calling an agent

- In a room that is not a call room, each voice-capable agent the header's call button would offer (`useAgentCallCandidates`: the room's agents whose presence advertises voice calls; in a thread those that took part in it, when any did) is a row `Call <name>`, described by the room's name.
- Enter closes the palette and starts the call about the open thread, or the room outside one. A call that does not start is reported by the account's call notices, as from the header button.

### Room commands

- The open room's header publishes the actions it draws itself and that need no place to open from: Compact view, Thread filters, Show tool calls, Show or Hide Computer, Sub-agents, Members, each plugin side panel and each plugin action. The palette lists them, described by the room's name, a toggle with its `On` or `Off` and Members with its keys.
- Enter runs the action and closes the palette.

### Shortcuts

- `Show keyboard shortcuts`, `Next unread room`, `Previous unread room` and `Show or hide the room list` are rows, named as the help dialog names them, each offered while its shortcut has a handler mounted. Enter runs that handler.
- `Open Settings` and `Resolve Current Thread` (and its reverse) show their keys.

### What shows before typing

- All: as today (rooms, threads, the three highest-ranked actions, people).
- Actions tab: the fixed actions, the three page rows, the agent calls, the room commands and the shortcut commands, ranked. Settings and page choices need text.
- Ranks keep today's order and put the new rows below what people do every day: agent calls 75 (above Mark Current Room Read), room commands 45, Theme 25, Message Layout 18, App Language 17, shortcut commands 15 and below.

### Phones

- The same sheet. The chip is the Back button; the on-screen keyboard has no Escape.

## Design

### Layers

`command-palette` moves to a layer of its own between `settings`/`tour` and `sidebar`, so it may read the settings registry's context (`useSettingsContext`) and the layout choices of the Appearance page. Two files of `settings` import the palette shortcut's label from `command-palette`; `commandPaletteShortcut.ts` moves to `shortcuts/paletteShortcut.ts` (it reads only `lib`). `LAYERS` in `.eslintrc.cjs` and the table in `docs/architecture.md` change together.

### Units

| File | What it does |
|---|---|
| `command-palette/commandPaletteTypes.ts` | `CommandPaletteActionItem` gains `icon`, `tag`, `shortcut`, `state` (`'on' \| 'off'`), `current` (boolean) and `page` (a page id). `CommandPalettePageId` is `'theme' \| 'message-layout' \| 'language'`. |
| `command-palette/commandPaletteSettings.ts` (new) | Pure: the registry's shown settings to action rows (title, location, search words, tag, state for the switch settings). Holds the map of switch settings to their `settingsAtom` key and whether the switch is inverted. |
| `command-palette/commandPalettePages.ts` (new) | Pure: the rows of the three pages from the themes, layouts and languages, with the current one marked, and their tagged copies for the first list's search. |
| `command-palette/useCommandPaletteCommands.ts` (new) | The hook that makes those rows executable and adds the agent calls, room commands and shortcut commands. Returns `actions` (extra rows for the first list), `searchOnly` (settings and page choices) and `pages`. |
| `command-palette/commandPaletteItems.ts` | `CommandPaletteSource` gains `searchActions` (all action rows, for typed text) and `pages`; `actions` gains the extra rows. |
| `command-palette/CommandPalette.tsx` | The open page with the text and highlight to return to; a row with a state keeps the palette open, a choice does inside its page; typed text searches `searchActions`. |
| `command-palette/CommandPaletteList.tsx` | Draws the row's icon, tag and end (state, check, chevron, keys). |
| `navigation/roomCommands.ts` (new) | A module-level registration like `useShortcut`'s: `useRoomCommands(commands)` for the header that is mounted, `getRoomCommands()` for the palette, which reads once as it opens. |
| `room/RoomViewHeader.tsx` | Publishes its header-drawn actions without a `popup`. |
| `navigation/settingsModal.ts`, `settings/Settings.tsx`, `settings/SettingsModalRenderer.tsx` | `initialSetting`: the dialog opens with that setting as its target. |
| `theme/useTheme.ts`, `settings/pages/Appearance.tsx` | The system theme switch's rule (the deployment's default theme becomes the pick of its kind) moves to `theme` as a pure function both use. `LAYOUT_CHOICES` is exported. |

### Data flow

`useCommandPaletteSource` (mounted while the palette is open) reads the settings atom, the theme, the language, the room commands and the agent call candidates, and builds rows whose `onSelect` writes the same atoms the Settings pages write. A changed setting rebuilds the rows, so a state shown is the stored one. The palette holds no copy of any setting.

### Errors

- A setting's write goes through `settingsAtom`, as from Settings; a roaming one is sent to the account the same way.
- A failed agent call: the account-wide call notice (`useAgentCaller({ announce: true })`).
- A room command whose room went away between opening the palette and Enter does what its header's button would do in that state: its closure belongs to the header.

### Strings

Two new ones, `commandPalette.state.on` and `commandPalette.state.off`, in `locales/additions/en.json` and the 16 overlays. Every other text is a label the app has: the settings' labels and search words, the theme names, the layout names, the languages' own names, the shortcuts' names, `Call {{name}}`, `Back`, `Settings`.

## Testing

- Unit: the settings rows (state, inversion, what is left out, location), the page rows (current choice), the registry of room commands, the palette (a page opens, filters, applies and stays, goes back with the text and highlight; a state row stays open; a choice from the first list closes), the list (state, check, chevron, keys, tag), Settings opening at a setting, the source hook (agent call rows and what Enter calls, shortcut rows only with a handler).
- e2e (`e2e/command-palette/command-palette-commands.spec.ts`): a theme picked from the Theme page changes the document's theme class and survives Back; typing a switch setting flips it and the Settings page shows the new value; typing another setting opens Settings at it; in a room, Compact view from the palette switches the view.
- Not run: a real agent call from the palette (it calls the header button's `useAgentCaller` with the same arguments; a live call needs the agent stack with a voice agent).
