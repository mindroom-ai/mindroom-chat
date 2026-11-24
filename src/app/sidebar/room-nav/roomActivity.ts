import { useEffect, useEffectEvent } from 'react';
import {
  RelationType,
  RoomEvent,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import type { RoomSortMode } from './roomOrder';

export type SubRoomChildrenTree = { children: ReadonlyMap<string, string[]> };

const validTs = (ts: unknown): number =>
  typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? ts : 0;

const isReplaceEdit = (event: MatrixEvent | null | undefined): boolean =>
  Boolean(event?.isRelation?.(RelationType.Replace));

const latestNonEditTs = (events: readonly MatrixEvent[] | undefined): number => {
  if (!events) return 0;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const event = events[i];
    if (!event || isReplaceEdit(event)) continue;
    const ts = validTs(event.getTs?.());
    if (ts > 0) return ts;
  }
  return 0;
};

/**
 * Latest activity timestamp for `room`, combining the live main timeline and all known threads
 * (loaded thread timelines plus bundled `replyToEvent` summaries) while excluding `m.replace`
 * edits. Falls back to `room.getLastActiveTimestamp()` only when no live-timeline events are
 * loaded yet.
 */
export const getRoomActivityTimestamp = (room: Room | null | undefined): number => {
  if (!room) return 0;
  const mainEvents = room.getLiveTimeline?.()?.getEvents?.();
  let maxTs = latestNonEditTs(mainEvents);

  const threads = room.getThreads?.();
  if (threads) {
    for (const thread of threads) {
      maxTs = Math.max(maxTs, latestNonEditTs(thread.events ?? thread.timeline));
      const reply = thread.replyToEvent;
      if (reply && !isReplaceEdit(reply)) {
        maxTs = Math.max(maxTs, validTs(reply.getTs?.()));
      }
    }
  }

  // Only fall back when the room has no loaded main-timeline events; if events are loaded (e.g.
  // only an `m.replace` edit), never fall back because `getLastActiveTimestamp()` counts edits.
  if (maxTs === 0 && (!mainEvents || mainEvents.length === 0)) {
    return validTs(room.getLastActiveTimestamp?.());
  }
  return maxTs;
};

/** Max activity timestamp of `roomId` and all nested descendant sub-rooms in `tree`. */
export const getSubRoomTreeActivityTs = (
  client: MatrixClient,
  roomId: string,
  tree?: SubRoomChildrenTree
): number => {
  let maxTs = getRoomActivityTimestamp(client.getRoom(roomId));
  const stack = [...(tree?.children.get(roomId) ?? [])];
  const seen = new Set<string>([roomId]);
  while (stack.length > 0) {
    const childId = stack.pop();
    if (!childId || seen.has(childId)) continue;
    seen.add(childId);
    maxTs = Math.max(maxTs, getRoomActivityTimestamp(client.getRoom(childId)));
    const nested = tree?.children.get(childId);
    if (nested) stack.push(...nested);
  }
  return maxTs;
};

/** Sorts `roomIds` descending by effective activity timestamp; ties preserve input (A to Z) order. */
export const sortRoomIdsByActivity = (
  client: MatrixClient,
  roomIds: readonly string[],
  tree?: SubRoomChildrenTree
): string[] => {
  if (roomIds.length <= 1) return [...roomIds];
  const ts = new Map(roomIds.map((id) => [id, getSubRoomTreeActivityTs(client, id, tree)]));
  return [...roomIds].sort((a, b) => (ts.get(b) ?? 0) - (ts.get(a) ?? 0));
};

/** Applies the section's active sort mode (`recent`, `manual`, or `name`) to A-to-Z top room IDs. */
export const orderRoomsForMode = (
  client: MatrixClient,
  mode: RoomSortMode,
  topRoomIds: readonly string[],
  savedOrder: (roomIds: readonly string[]) => string[],
  tree?: SubRoomChildrenTree
): string[] => {
  if (mode === 'recent') return sortRoomIdsByActivity(client, topRoomIds, tree);
  return mode === 'manual' ? savedOrder(topRoomIds) : [...topRoomIds];
};

const sameOrder = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id, index) => id === b[index]);

export type ActivityTrackedSection = {
  recent: boolean;
  showTimes: boolean;
  baseTop: readonly string[];
  orderedTop: readonly string[];
  tree: SubRoomChildrenTree;
  trackedRoomIds: ReadonlySet<string>;
};

/**
 * Subscribes to live timeline events (both main timeline and thread replies, which `matrix-js-sdk`
 * re-emits on the client as `RoomEvent.Timeline`) only while at least one tracked section uses
 * Recent sorting or shows activity times, ignoring backfill and `m.replace` edits.
 */
export const useRoomActivityListener = (
  sections: readonly ActivityTrackedSection[],
  onChange: () => void
): void => {
  const client = useMatrixClient();
  const enabled = sections.some((section) => section.recent || section.showTimes);
  const onTimeline = useEffectEvent<RoomEventHandlerMap[RoomEvent.Timeline]>(
    (event, room, toStartOfTimeline, _removed, data) => {
      if (!room || toStartOfTimeline || !data.liveEvent) return;
      if (isReplaceEdit(event)) return;
      for (const section of sections) {
        if ((!section.recent && !section.showTimes) || !section.trackedRoomIds.has(room.roomId)) {
          continue;
        }
        if (
          section.showTimes ||
          !sameOrder(
            section.orderedTop,
            sortRoomIdsByActivity(client, section.baseTop, section.tree)
          )
        ) {
          onChange();
          return;
        }
      }
    }
  );

  useEffect(() => {
    if (!enabled) return undefined;
    client.on(RoomEvent.Timeline, onTimeline);
    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
    };
  }, [client, enabled]);
};
