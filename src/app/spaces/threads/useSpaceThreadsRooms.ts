import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'jotai';
import {
  MatrixEventEvent,
  RelationType,
  RoomEvent,
  RoomStateEvent,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { isZeroReplyStandaloneThreadRootEvent } from '../../event-store/threads/compactThreadRootData';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { hasActiveMindroomAgent } from '../../matrix/protocol/agentIdentity';
import { isAiRunStreaming } from '../../matrix/protocol/aiRun';
import { useVisibleRooms } from '../../matrix/state/archivedRooms';
import { useSpaceNavigationRooms } from '../../matrix/state/useSpaceSearchRooms';
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import { useJoinedRoomThreadLists } from '../../threads/page/useJoinedRoomThreadLists';
import { revealDirectionControls } from '../../ui/directional';
import { getRoomAccentColor } from './spaceThreadsModel';

const ZERO_REPLY_RESCAN_DEBOUNCE_MS = 150;

const shouldTriggerStandaloneRescan = (
  event: MatrixEvent | undefined,
  room: Room,
  indexedEntries: ReadonlyMap<string, CrossRoomThreadIndexEntry>
): boolean => {
  if (!event) return true;
  const relation = event.getRelation?.();
  if (relation?.rel_type === RelationType.Replace) {
    const content = event.getContent?.();
    if (content && isAiRunStreaming(content)) return false;
    const targetId = relation.event_id;
    if (!targetId || indexedEntries.has(getCrossRoomThreadIndexKey(room.roomId, targetId))) {
      return false;
    }
    const target =
      room.findEventById?.(targetId) ??
      room
        .getLiveTimeline?.()
        ?.getEvents?.()
        .find((candidate) => candidate.getId?.() === targetId);
    return Boolean(target && isZeroReplyStandaloneThreadRootEvent(target));
  }
  const eventId = event.getId?.();
  if (event.threadRootId && event.threadRootId !== eventId) return false;
  return !(
    relation?.rel_type === RelationType.Thread &&
    relation.event_id &&
    relation.event_id !== eventId
  );
};

/**
 * Resolves visible joined rooms in a Space, paginates their thread lists, tracks live room
 * metadata/agent changes, and debounces rescans for standalone 0-reply roots (including decryption
 * and non-streaming edits on standalone roots).
 */
export const useSpaceThreadsRooms = (spaceId: string) => {
  const mx = useMatrixClient();
  const store = useStore();
  const visibleSpaceRoomIds = useVisibleRooms(useSpaceNavigationRooms(spaceId));
  const threadListsSettled = useJoinedRoomThreadLists(true, visibleSpaceRoomIds);
  const spaceRooms = useMemo(
    () =>
      visibleSpaceRoomIds.map((id) => mx.getRoom(id)).filter((room): room is Room => Boolean(room)),
    [mx, visibleSpaceRoomIds]
  );

  const [metaVersion, setMetaVersion] = useState(0);
  const [timelineTick, setTimelineTick] = useState(0);

  useEffect(() => {
    if (spaceRooms.length === 0) return undefined;
    const bumpMeta = () => setMetaVersion((tick) => tick + 1);
    spaceRooms.forEach((room) => {
      room.on?.(RoomEvent.Name, bumpMeta);
      room.on?.(RoomStateEvent.Members, bumpMeta);
    });
    return () => {
      spaceRooms.forEach((room) => {
        room.removeListener?.(RoomEvent.Name, bumpMeta);
        room.removeListener?.(RoomStateEvent.Members, bumpMeta);
      });
    };
  }, [spaceRooms]);

  const roomMeta = useMemo(() => {
    void metaVersion;
    const ids = new Set<string>();
    const byId = new Map<string, Room>();
    const nameById = new Map<string, string>();
    const accentById = new Map<string, string>();
    const orderedIds: string[] = [];
    const composerRooms = spaceRooms.map((room) => {
      const name = revealDirectionControls(room.name || room.roomId);
      const accentColor = getRoomAccentColor(room.roomId);
      ids.add(room.roomId);
      byId.set(room.roomId, room);
      nameById.set(room.roomId, name);
      accentById.set(room.roomId, accentColor);
      orderedIds.push(room.roomId);
      return { room, name, accentColor };
    });
    return { ids, byId, nameById, accentById, orderedIds, composerRooms };
  }, [metaVersion, spaceRooms]);

  useEffect(() => {
    if (spaceRooms.length === 0) return undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRescan = (event: MatrixEvent | undefined, room: Room) => {
      if (
        !shouldTriggerStandaloneRescan(event, room, store.get(crossRoomThreadIndexAtom).entries)
      ) {
        return;
      }
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        setTimelineTick((tick) => tick + 1);
      }, ZERO_REPLY_RESCAN_DEBOUNCE_MS);
    };
    const bindings = spaceRooms.map((room) => {
      const onRoomEvent = (event?: MatrixEvent) => scheduleRescan(event, room);
      room.on?.(RoomEvent.Timeline, onRoomEvent);
      room.on?.(RoomEvent.LocalEchoUpdated, onRoomEvent);
      return { room, onRoomEvent };
    });
    const onDecrypted = (event: MatrixEvent) => {
      const roomId = event.getRoomId?.();
      const room = roomId ? roomMeta.byId.get(roomId) : undefined;
      if (room) scheduleRescan(event, room);
    };
    mx.on?.(MatrixEventEvent.Decrypted, onDecrypted);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      bindings.forEach(({ room, onRoomEvent }) => {
        room.removeListener?.(RoomEvent.Timeline, onRoomEvent);
        room.removeListener?.(RoomEvent.LocalEchoUpdated, onRoomEvent);
      });
      mx.removeListener?.(MatrixEventEvent.Decrypted, onDecrypted);
    };
  }, [mx, roomMeta.byId, spaceRooms, store]);

  const hasMindroomAgents = useMemo(() => {
    void metaVersion;
    return spaceRooms.some((room) => hasActiveMindroomAgent(room.getMembers?.() ?? []));
  }, [metaVersion, spaceRooms]);

  return { spaceRooms, roomMeta, hasMindroomAgents, threadListsSettled, timelineTick };
};
