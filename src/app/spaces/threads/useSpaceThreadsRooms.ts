import { useEffect, useMemo, useState } from 'react';
import {
  MatrixEventEvent,
  RelationType,
  RoomEvent,
  RoomStateEvent,
  type MatrixEvent,
  type Room,
} from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { hasActiveMindroomAgent } from '../../matrix/protocol/agentIdentity';
import { useVisibleRooms } from '../../matrix/state/archivedRooms';
import { useSpaceNavigationRooms } from '../../matrix/state/useSpaceSearchRooms';
import { useJoinedRoomThreadLists } from '../../threads/page/useJoinedRoomThreadLists';
import { revealDirectionControls } from '../../ui/directional';
import { getRoomAccentColor } from './spaceThreadsModel';

const ZERO_REPLY_RESCAN_DEBOUNCE_MS = 150;

const isThreadReplyOrEdit = (event: MatrixEvent | undefined): boolean => {
  if (!event) return false;
  const relation = event.getRelation?.();
  if (relation?.rel_type === RelationType.Replace) return true;
  const eventId = event.getId?.();
  if (event.threadRootId && event.threadRootId !== eventId) return true;
  return Boolean(
    relation?.rel_type === RelationType.Thread && relation.event_id && relation.event_id !== eventId
  );
};

/**
 * Resolves visible joined rooms in a Space, paginates their thread lists, tracks live room
 * metadata/agent changes, and debounces rescans for standalone 0-reply roots (including decryption).
 */
export const useSpaceThreadsRooms = (spaceId: string) => {
  const mx = useMatrixClient();
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
    const scheduleRescan = (event?: MatrixEvent) => {
      if (isThreadReplyOrEdit(event)) return;
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        setTimelineTick((tick) => tick + 1);
      }, ZERO_REPLY_RESCAN_DEBOUNCE_MS);
    };
    const onDecrypted = (event: MatrixEvent) => {
      const roomId = event.getRoomId?.();
      if (roomId && roomMeta.ids.has(roomId)) scheduleRescan(event);
    };
    spaceRooms.forEach((room) => {
      room.on?.(RoomEvent.Timeline, scheduleRescan);
      room.on?.(RoomEvent.LocalEchoUpdated, scheduleRescan);
    });
    mx.on?.(MatrixEventEvent.Decrypted, onDecrypted);
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      spaceRooms.forEach((room) => {
        room.removeListener?.(RoomEvent.Timeline, scheduleRescan);
        room.removeListener?.(RoomEvent.LocalEchoUpdated, scheduleRescan);
      });
      mx.removeListener?.(MatrixEventEvent.Decrypted, onDecrypted);
    };
  }, [mx, roomMeta.ids, spaceRooms]);

  const hasMindroomAgents = useMemo(() => {
    void metaVersion;
    return spaceRooms.some((room) => hasActiveMindroomAgent(room.getMembers?.() ?? []));
  }, [metaVersion, spaceRooms]);

  return { spaceRooms, roomMeta, hasMindroomAgents, threadListsSettled, timelineTick };
};
