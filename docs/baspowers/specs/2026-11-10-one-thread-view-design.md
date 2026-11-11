# One thread view

Bas Nijholt asked on 2026-11-10 to "fix the thing properly" after #257 fixed two symptoms of one cause: the room page draws a thread over the whole page in two separate ways, and every difference between them shows as a bug.

## The two ways today

| | Thread in the messages' place | Thread column filling the page |
|---|---|---|
| Since | before #235 | #235 |
| Chosen | stored layout `full` (the default), and on every phone | stored layout `beside` while the page has room, then Show in full or a page turning narrow |
| Timeline | the room area's `RoomTimeline`, given `threadId` | `ThreadView`'s own `RoomTimeline` in a `ResizablePanel` with `fullWidth` |
| Header | the room area's floating glass header | a copy of `RoomViewHeader` in the column, not floating |
| Composer | the room page's `RoomInput`, which switches to the thread | `ThreadView`'s own `RoomInput` |
| Dock | background jobs and the thread's approvals float above the composer | approvals under the timeline; jobs under the column only while it fills |
| Typing, read receipts, composer notices | yes | none |
| Room's messages | replaced by the thread | mounted under the column, hidden and inert |

`RoomView` picks one as the thread opens (`place.column`), and keeps it while the thread is open, so the same picture comes out of two trees: #248 (the plugins' header slot), #246 (voice, Escape, drafts) and #257 (the Show beside button, a card in a card) each fixed one difference, and the column's composer still sits flush on the card's edge where the room's floats.

## Decisions

1. **Every thread on the room page shows in the thread column.** The column is the only place a thread renders (`ThreadView`); the room area shows only the room's own messages. The stored layout says whether the column sits beside the messages (`beside`, while the page has room) or fills the page (`full`, the default, and always on phones). Show beside and Show in full only change the column's width: the thread, its composer and what the composer holds stay as they are. `place`, `storedThreadLayout()` as a placement rule and `measured` go.
2. **One conversation layout for the room and for a thread.** A new component, `ConversationLayout` (`src/app/room/ConversationLayout.tsx`), draws what the room area draws today for any conversation: an optional floating header, the timeline, the dock (background jobs; the thread's approvals for a thread) floating above the composer, and the floating footer (typing, the composer notice, the composer, read receipts), with the header and footer insets it measures on its own box (`useRoomOverlayInsets` moves into it). The room area and `ThreadView` both render through it, so a thread filling the page and the room's messages look the same by construction: same header, same floating composer and gap, same dock.
3. **While the column fills the page, the room's conversation unmounts.** The room area (the room's `ConversationLayout` box) keeps its box (zero width, inert, `content-visibility: hidden`) and the plugin cover, which `ConversationLayout` takes as `children` over the conversation, so a cover keeps its state, but its header, timeline, dock and composer unmount (`ConversationLayout`'s `collapsed`), as the room's rows unmount today when a thread opens in their place. The page then holds one header, one timeline and one composer, as it does today. The room's rows save their place as they unmount (`useThreadReturnPlace`, Compact's `compactRoomScrollStateRef`), so going back to the room, or beside it, shows them where they were.
4. **The column, filling the page, shows the room header in `ConversationLayout`'s floating header,** with the plugins' header slot, the same classes as the room area's header (`HeaderInShortArea`, `HeaderInThread`) and the thread's `threadId`. `ThreadView` takes it as a new internal prop, `roomHeader`; the SDK's `ThreadView` (`{ room, threadId }`) does not pass it.
5. **A send that opens its thread goes with the thread.** In Compact, a message sent from the room's composer opens its thread; with the column filling the page the room's composer then unmounts. A send still under way (the remaining files and the caption) parks under the thread's composer key instead of the room's, so the thread's composer takes it over (#254's takeover): its files show on the thread's composer with the pending indicator, as they show today on the page's composer that moved to the thread. A send that opens no thread parks under the room's key, as now.
6. **No more waiting to show beside.** A thread no longer moves between composers, so Show beside never waits: the banner's button and the More menu's entry lose their blocked state (`showBesideBlocked`, the `thread.showBesideBlocked` string in every locale), and `voiceRecorderRoomAtom`, which only fed it, goes. The banner takes `onShowBeside` (column filling a page with room) and `onShowFull` (column beside); `onRestore` merges into `onShowBeside`.
7. **Focus as today.** The column takes the focus as a thread opens beside the messages (where typing would otherwise go to the room's composer), and not as it opens filling the page, as the messages' place never did, except from the room's composer whose Compact send opened it, which keeps the focus as the page's composer did; typing with nothing focused goes to the column's composer while it fills the page. On a phone, closing a thread leaves the focus alone rather than raising the keyboard.
8. **`ThreadView` gains what the messages' place had,** for the room page and for plugins' side panels alike: typing (`RoomViewTyping`), read receipts (`RoomViewFollowing`), the thread's background jobs (`BackgroundJobsBar`, with the cancel permission it checks itself), and the composer notices: the unsent root's Retry and Delete (`FailedSendActions`), an upgraded room's notice (`RoomTombstone`) and the no-permission line. `useLocalEchoRoot` moves to its own module for both views.

## Behaviour changes

- A thread opened with the layout `full`, or on a phone, now has its own composer. What the room's composer holds stays with the room: a reply, staged files or a recording no longer follow into the thread (before, they did, and were sent there), and they are there again on the way back. A recording under way in the room's composer ends as the thread opens, as leaving the room ends it.
- A thread's reply and staged files go with it as it closes, as they do in the column today (#235), and a reload no longer brings a thread's reply target back (the room composer's still comes back); its unsent text stays, under the thread, as now.
- Show beside works at any time, also with a reply, files or a recording in a composer.
- A plugin's cover no longer covers a thread opened while it shows: the thread fills the page over the room area, as the column does today.
- Plugins' `ThreadView` shows typing, read receipts, the thread's background jobs and the composer notices, and its composer floats over the timeline's bottom like the room page's.

## Not changed

- The stored layout, its key, the column's width and its splitter; Show beside and Show in full in the banner and the More menu; the phone, which never shows the column beside.
- Escape and read receipts: `useRoomEscapeReadReceipts` already handles a thread in the column, beside the messages or filling the page.
- Draft moves for an unsent root deleted in the column (`onColumnGone`), and the unconfirmed root handling of #254.
- The SDK's `ThreadView` props and `navigateRoomThread`.

## Testing

- Unit: `RoomView.threadColumn.test.tsx` covers the one placement (every open thread in the column; `full` fills, `beside` sits beside, phones fill), the room's conversation unmounting while the column fills, banner props, focus; `ConversationLayout` gets its own small test; `ThreadView.test.tsx` covers the new parts (typing, notices, jobs); the send controller test covers parking a send that opened its thread under that thread's key and the thread's composer taking it over. Tests of the removed blocked state and `voiceRecorderRoomAtom` go.
- e2e: `e2e/threads/agent-thread-column.spec.ts` follows the new rules (no waiting); the thread, composer and approval specs run unchanged against the new tree, on the e2e suite of the branch head; screenshots of a thread in full, beside, and on a phone, before and after.
- Docs: `docs/architecture.md` (`navigateRoomThread`, the header slot, `ThreadView`) and the SDK comment in `src/client-sdk/room.ts` drop the messages' place.
