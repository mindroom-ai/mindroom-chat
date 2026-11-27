import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { KnownMembership, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { allRoomsAtom } from '../../matrix/state/roomList';
import {
  loadRoomThreads,
  roomThreadListIsComplete,
} from '../../event-store/threads/roomThreadList';
import { matchesEnum } from '../../lib/matchesEnum';

/** Rooms whose lists load at the same time; the rest wait their turn. */
const PARALLEL_ROOMS = 3;

/** A joined room that is not a space: the rooms whose thread lists this hook loads. */
export const isListedRoom = (room: Room | null): room is Room =>
  !!room && matchesEnum(room.getMyMembership(), KnownMembership.Join) && !room.isSpaceRoom();

/**
 * The newest page of each joined room's thread list, or with `allPages` (the Threads and Space
 * Threads pages) every page, fetched while the caller is mounted. When `roomIds` is provided, only
 * those rooms are fetched and checked; otherwise all joined rooms (`allRoomsAtom`) are covered.
 *
 * The client lists the threads it knows. A room that was not opened since the app started knows
 * only the threads its synced messages touched, and those count each synced reply on top of the
 * server's count. A room's thread list adds its other threads and resets their counts to the
 * server's, as opening the room does. Each room loads once per visit, a few at a time.
 *
 * Answers whether every targeted room's list is complete, so a count over them can say it may grow.
 */
export const useJoinedRoomThreadLists = (
  allPages = false,
  roomIds?: readonly string[],
  enabled = true
): boolean => {
  const mx = useMatrixClient();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const roomIdsKey = (roomIds ?? joinedRoomIds).join('\0');
  const targetRoomIds = useMemo(() => (roomIdsKey ? roomIdsKey.split('\0') : []), [roomIdsKey]);
  const listedRef = useRef(new Set<string>());
  const [, setPagesLoaded] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const listed = listedRef.current;
    const waiting = targetRoomIds
      .filter((roomId) => !listed.has(roomId))
      .map((roomId) => mx.getRoom(roomId))
      .filter(isListedRoom);
    if (waiting.length === 0) return undefined;

    const visit = new AbortController();
    const listNext = async (): Promise<void> => {
      const room = waiting.shift();
      if (!room || visit.signal.aborted) return;
      // Without `allPages`, only the first page: this consumer leaves once it arrives, and the
      // room view, when it is open too, keeps paging through the rest.
      const page = new AbortController();
      const leave = () => page.abort();
      const pageLoaded = () => setPagesLoaded((count) => count + 1);
      visit.signal.addEventListener('abort', leave, { once: true });
      try {
        await loadRoomThreads(room, allPages ? pageLoaded : leave, page.signal);
        if ((allPages || page.signal.aborted) && !visit.signal.aborted) listed.add(room.roomId);
      } catch {
        // A room whose list fails keeps the threads it knows; the others go on.
      } finally {
        visit.signal.removeEventListener('abort', leave);
      }
      await listNext();
    };
    for (let lane = 0; lane < PARALLEL_ROOMS; lane += 1) void listNext();

    // A room the room list changed under, or the page left, before its first page arrived is
    // listed by the next run; the shared load keeps a room from being requested twice meanwhile.
    return () => visit.abort();
  }, [mx, targetRoomIds, allPages, enabled]);

  return targetRoomIds
    .map((roomId) => mx.getRoom(roomId))
    .filter(isListedRoom)
    .every(roomThreadListIsComplete);
};
