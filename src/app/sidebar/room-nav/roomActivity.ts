import { useEffect, useRef } from 'react';
import {
  RelationType,
  RoomEvent,
  type MatrixClient,
  type Room,
  type RoomEventHandlerMap,
} from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import type { RoomSortMode } from './roomOrder';

export type SubRoomChildrenTree = { children: ReadonlyMap<string, string[]> };

/** Safe last-active timestamp for a room (`0` when missing or invalid). */
export const getRoomActivityTimestamp = (room: Room | null | undefined): number => {
  const ts = room?.getLastActiveTimestamp?.();
  return typeof ts === 'number' && Number.isFinite(ts) && ts > 0 ? ts : 0;
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
 * Subscribes to live timeline events only while at least one tracked section uses Recent sorting
 * or shows activity times, ignoring backfill and `m.replace` edits.
 */
export const useRoomActivityListener = (
  sections: readonly ActivityTrackedSection[],
  onChange: () => void
): void => {
  const client = useMatrixClient();
  const enabled = sections.some((section) => section.recent || section.showTimes);
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return undefined;
    const onTimeline: RoomEventHandlerMap[RoomEvent.Timeline] = (
      event,
      room,
      toStartOfTimeline,
      _removed,
      data
    ) => {
      if (!room || toStartOfTimeline || !data.liveEvent) return;
      if (event.isRelation?.(RelationType.Replace)) return;
      for (const section of sectionsRef.current) {
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
          onChangeRef.current();
          return;
        }
      }
    };
    client.on(RoomEvent.Timeline, onTimeline);
    return () => {
      client.off(RoomEvent.Timeline, onTimeline);
    };
  }, [client, enabled]);
};
