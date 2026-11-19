# Open a second thread beside the current one ("Open beside")

## Goal

On a wide screen, show two threads at once: messages | thread A | thread B, or A | B where the
page is too narrow for the messages too. A thread card's menu gets **Open beside**: it keeps the
open thread (A) and opens the card's thread (B) in a second column. Phones do not offer it.

Success: from a room's Compact cards, Open beside puts B in its own column with its own banner,
timeline and composer; A and its composer stay as they were; B survives a reload and a visit to
another room; Close (or opening another side panel) removes it.

## What exists (origin/main 135a9550e)

- One thread column (`room/RoomView.tsx`), beside the messages or filling the page
  (`room/threadLayout.ts`: beside needs a page of `2 * CONVERSATION_MIN_WIDTH`, never on phones).
- At most one side panel beside the conversation (`ui/panels/roomPanels.ts` `useRoomPanels`, the
  list in `room/Room.tsx`). The side panel takes its width from the conversation box, which holds
  the room's page, so the thread layout already measures the room left by a side panel.
- `room/ThreadView.tsx` draws a whole thread with its own composer, approvals, jobs, receipts and
  notification "shown" state (`useShownConversationView`); the example plugin already shows one in
  a side panel.
- `threads/ThreadActionsMenu.tsx` is the menu of both a Compact card (`threads/overview/
  CompactRoomView.tsx`) and the open thread's banner (`threads/ThreadContextBanner.tsx`).

## Approaches

1. **Second thread as a core side panel (chosen).** A built-in side panel, `thread`, that renders
   `ThreadView` for B under a `ThreadContextBanner`. It reuses the one-panel rule, the splitter,
   the width memory and the thread layout's width measure. ~200 product lines.
2. A second column inside `RoomView`. Needs its own three-column width rules beside the existing
   fill logic, and side panels would then make four columns. More code, more layout states.
3. B in the address (`?beside=<id>`). Every navigation helper would have to carry the parameter, or
   switching A closes B. Invasive for little gain.

## Design

### Layout at each width

B is a side panel beside the conversation box, default 480px (the thread column's default), at
least `CONVERSATION_MIN_WIDTH` left to the conversation, resizable, width kept per account
(`secondThreadWidthStorageKey`). The conversation box then lays out as today:

| Room area left of B | Result |
|---|---|
| room for messages + A (`>= 2 * CONVERSATION_MIN_WIDTH`) and the stored layout is beside | messages \| A \| B |
| less, or the stored layout is full | A \| B, messages hidden under A (today's fill rule) |
| no thread open | messages \| B |
| phone (`ScreenSize.Mobile`) | not offered; a remembered B does not show |

No new width rule: `useThreadLayout` measures the page, which B already narrows. B never fills the
room (no Expand, no fold).

### Opening and closing

- **Open beside** is in `ThreadActionsMenu`, right after Open, for a thread that is neither A nor
  B, on a room page, not on a phone. It comes from a context the room page provides
  (`SecondThreadContext`); without the context (Threads page, search, phone) the entry is absent.
  So it shows on Compact cards' menus, and never in the open thread's own banner menu (that thread
  is already shown).
- Opening uses the panel rule (`request('thread', ...)`): it closes the other side panels (members,
  computer, canvas, sub-agents, a plugin's), as any panel opening does. Opening B while another B
  shows replaces it.
- B closes on: its banner's **Close** button (an X in place of the banner's Back arrow), dragging
  its splitter shut (`onCollapse`), another side panel opening (panel rule), B becoming A (the
  person opens B's own card: one thread never shows twice), and B failing to load
  (`onThreadLoadError`). Leaving the room does not close it.
- B's banner menu offers the thread's usual actions (tags, resolve, snooze, pin, copy link) but no
  Show beside / Show in full / Open beside.

### Focus and keys with two composers

- Opening B moves the focus to B's composer (`autoFocus`).
- Typing a letter or digit, or pasting, while the focus is inside B's column on no field goes to
  B's composer; anywhere else it goes where it goes today (A's or the room's composer). B's column
  catches the key on its way (React `onKeyDown`) and focuses its own composer, so the window's
  type-to-compose then finds a field focused and does nothing.
- **Escape** inside B marks B as read, as Escape in A's column marks A read. It does not close B
  (Escape never closes the thread column either). B's column notes the key with its thread
  (`noteThreadViewKey`), and `useRoomEscapeReadReceipts` marks the noted thread instead of A or
  the room.
- Closing B with the focus inside it moves the focus to the main composer: A's composer when the
  thread column shows, else the room's (not on phones, where B never shows).
- Shortcuts (`leaveThread`, `openThread`, `resolveThread`, `focusComposer`) keep acting on A and
  the room. Known limit, see below.

### Reload and the address

B is not in the address: a link names one conversation, and carrying a parameter through every
navigation is the cost approach 3 avoids. B survives a reload anyway: the room page keeps
`{ [roomId]: threadId }` for the signed-in account in localStorage
(`secondThreadStorageKey(userId)`, listed in `accountStorageKeys` so sign-out removes it). Each
room remembers its own B; showing the room again shows it. Close forgets it. Opening another panel
closes and forgets it (the panel rule calls `close`).

### With the existing side panels

B is one of the room's side panels, listed after the members list: one shows at a time. When a
room shows with B remembered while another panel is open (the members list stays open across
rooms), that panel shows and B waits behind it, showing once it closes. The plugin SDK is
unchanged: `useShownThread` and `openBesideThread` keep meaning A.

## Data flow

- `navigation/secondThread.ts` (layer 4): `SecondThreadContext` and its type
  `{ offers(rootId): boolean; open(rootId): void }`, so `threads` (9) can read what `room` (11)
  provides.
- `room/useSecondThread.ts`: per-account storage read and write, `{ threadId, open, close }` for
  the room shown, with the B-became-A rule.
- `room/SecondThreadPanel.tsx`: `ResizablePanel` > key-catching wrapper > `ThreadView` with
  `ThreadContextBanner onClose`.
- `room/Room.tsx`: the `thread` panel entry, the context value, focus on close.
- `room/typeToCompose.ts`: `isTypingKey`, `isPasteKey`, `focusOwnsTyping` moved out of
  `RoomView.tsx` unchanged, shared by both columns.
- `room/useRoomEscapeReadReceipts.ts`: `noteThreadViewKey(evt, threadId)` plus one check.
- `threads/ThreadContextBanner.tsx`: optional `onClose` (X, label "Close thread") replacing Back.
- `threads/ThreadActionsMenu.tsx`: the Open beside entry.

## Testing

Unit (Vitest, written first): storage hook (per room, reload, malformed storage, close forgets,
sign-out key listed); Room panel (renders B's ThreadView, closes on members open, closes when B is
the route thread, none on phone); menu entry (offered, hidden for A/B, absent without context,
select opens and closes the menu); Escape in B marks B read; typing in B focuses B's composer;
banner Close. E2E: two seeded threads at 1920 and 1280 widths (three and two columns), reload
keeps B, a message typed in B lands in B, Close removes it, phone menu lacks the entry.

## Known limits

- Shortcuts (Alt+Left/Right, resolve, focus composer) act on A, also when pressed inside B.
- B is per browser, not synced across devices, and not in a copied link.
- On a narrow tablet the splitter keeps the conversation's least width, so B can be narrow.
- No "swap A and B" action; opening B's card makes it A and closes the second column.

## Follow-up (2026-11-18)

Two features both said "beside" (the banner's Show beside and the card menu's Open beside), and
with the default layout opening B hid the room's messages. Three changes:

1. **Rename.** The card menu's entry is now **Open in second column** (key
   `threadActions.openBeside` kept), in English and the 16 overlays.
2. **Messages show while B shows.** While B shows (not on phones) and the page has room
   (`threadLayout.roomy`), A lays out beside the messages whatever layout is stored: Room passes
   `besideWhileSecond` to RoomView, and `columnFills` is
   `!!openThreadId && ((layout === 'full' && !besideWhileSecond) || !roomy)`. Nothing is stored;
   closing B brings the stored layout back. Meanwhile A's banner offers neither Show beside nor
   Show in full, and A's splitter no expansion (neither could take effect while B shows). A voice
   message being recorded as B closes keeps A beside until it is sent or discarded, so the room's
   composer keeps its take.
3. **Drag a card to open it in the second column** (mouse only). A Compact card the page offers
   (`SecondThreadContext.offers`) turns `draggable` on a mouse press (not touch or pen); its drag
   carries `application/x-mindroom-thread` = `{ roomId, rootId }` (`navigation/secondThread.ts`,
   shared by `threads` and `room`). `room/useThreadDrag.ts` tells a thread's drag by its type from
   window `dragstart` until `dragend` or `drop` (Escape ends a drag too), also hearing the card's
   own `dragend` and ending as the card leaves the page, and `room/SecondThreadDropZone.tsx` shows
   a primary-tinted zone along the room row's end edge, as wide as B's stored width or 480px and
   never wider than the row, fading in over 150 ms (none with reduced motion), lit while the drag
   is over it. Dropping calls `SecondThreadContext.open`, so B
   moves in through the panel presence, or replaces the B that shows. The zone is `aria-hidden`:
   the menu entry is the keyboard's way. Phones have no context, so neither drag nor zone. The
   panel row is now positioned (`position: relative`) so the zone takes its edges. A drag picked up
   under the zone drops there only after leaving it once.
