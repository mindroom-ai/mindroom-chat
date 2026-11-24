# Cross-Room Thread Forks Design

**Date:** 2026-11-23
**Repositories:** `mindroom-ai/mindroom` (backend), `mindroom-ai/mindroom-chat` (client)

> Shared design spec (same as `mindroom-ai/mindroom:docs/baspowers/specs/2026-11-23-cross-room-thread-forks-design.md`).

## Protocol: `io.mindroom.fork`

```json
"io.mindroom.fork": {
  "room_id": "!sourceRoom",
  "thread_id": "$parentRoot",
  "event_id": "$forkPoint"
}
```

- `room_id` names the immediate parent's room and is omitted for same-room forks.
- If `room_id` is present, require valid Matrix room ID (`isRoomId`, supporting server-less v12 room IDs). Reject the entire fork reference on malformed/null `room_id`.
- Omit `room_id` on send when `targetRoomId === sourceRoomId`. Preserve `room_id` in `keepThreadForkRef` and `buildLongTextPreview`.
- Chains (`A -> B -> C`): resolve omitted `room_id` relative to each hop's owning room, key `visited` by `(roomId, threadId)`, max depth 8.

## Client Architecture (`mindroom-ai/mindroom-chat`)

1. **Entry points & picker**: Add **Fork to room…** beside **Fork thread** (`ThreadActionsMenu`) and **Fork from here** (`Message` menu). Open searchable, keyboard-navigable `ForkToRoomDialog` over joined non-archived rooms (`navigationRoomsAtom`, recent-first via `getRecentRooms`), excluding spaces, source room, tombstoned/unwritable rooms, `room`-thread-mode rooms, and unencrypted rooms when source is encrypted. Show a clear inline warning badge when a target room has MindRoom agents but none of them are joined to the source room.
2. **Target-room draft route**: Navigate to `<targetRoomPath>?forkRoom=<sourceRoomId>&forkThread=<parentThreadId>&forkAt=<eventId>` (leaving `threadId` unset). Validate all three in `Room.tsx` and `nativeUniversalLinks.ts`. `ThreadView` splits read scope (`sourceRoom`, `forkThread`, `forkAt`, `sourcePowerLevels`) from send scope (`targetRoom`, `RoomInput` with `forkFrom: { roomId: sourceRoom.roomId, threadId: forkThread, eventId: forkAt }`). Read-only draft banner shows `"Forking from <sourceRoomName>"` (+ Back, + agent-not-in-source warning if applicable); divider shows `"Forking <title> into <targetRoomName>"`.
3. **Sent cross-room forks**: `loadThreadForkPrefix` & `useThreadForkPrefix` resolve `hopRoom = mx.getRoom(hopRoomId)` per hop, never pollute `targetRoom`'s cache, and clear/reload on membership changes. `useThreadRenderState` preserves segment order (prefix before own events). `forkPrefixTimelineSet`, `useTimelineMessageFeature`, and `Message` render each prefix row with its owning `eventRoom`. `ThreadForkDivider` and `CompactThreadCard` show `"Forked from <title> in <parentRoomName>"` (clickable to parent room/thread/event) or static `"Forked from another room"` when the user isn't in `parentRoom` (shown above the root even if prefix is empty). `useThreadForks` stays room-local (ignoring fork roots targeting another room).
