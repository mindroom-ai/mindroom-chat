import { useEffect, useRef } from 'react';
import { useAtomValue } from 'jotai';
import { KnownMembership, type Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { allRoomsAtom } from '../../../state/room-list/roomList';
import { loadRoomThreads } from '../../../mindroom/threads/roomThreadList';

/** Rooms whose lists load at the same time; the rest wait their turn. */
const PARALLEL_ROOMS = 3;

/**
 * The newest page of each joined room's thread list, fetched while the Threads page is open.
 *
 * The page lists the threads the client knows. A room that was not opened since the app started
 * knows only the threads its synced messages touched, and those count each synced reply on top of
 * the server's count. A room's thread list adds its other threads and resets their counts to the
 * server's, as opening the room does. Each room loads once per visit, a few at a time.
 */
export const useJoinedRoomThreadLists = () => {
  const mx = useMatrixClient();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const listedRef = useRef(new Set<string>());

  useEffect(() => {
    const listed = listedRef.current;
    const waiting = joinedRoomIds
      .filter((roomId) => !listed.has(roomId))
      .map((roomId) => mx.getRoom(roomId))
      .filter(
        (room): room is Room =>
          !!room && room.getMyMembership() === KnownMembership.Join && !room.isSpaceRoom()
      );
    if (waiting.length === 0) return undefined;

    const visit = new AbortController();
    const listNext = async (): Promise<void> => {
      const room = waiting.shift();
      if (!room || visit.signal.aborted) return;
      // Only the first page: this consumer leaves once it arrives, and the room view, when it is
      // open too, keeps paging through the rest.
      const page = new AbortController();
      const leave = () => page.abort();
      visit.signal.addEventListener('abort', leave, { once: true });
      try {
        await loadRoomThreads(room, leave, page.signal);
        if (page.signal.aborted && !visit.signal.aborted) listed.add(room.roomId);
      } catch {
        // A room whose list fails keeps the threads it knows; the others go on.
      } finally {
        visit.signal.removeEventListener('abort', leave);
      }
      await listNext();
    };
    for (let lane = 0; lane < PARALLEL_ROOMS; lane += 1) listNext();

    // A room the room list changed under, or the page left, before its first page arrived is
    // listed by the next run; the shared load keeps a room from being requested twice meanwhile.
    return () => visit.abort();
  }, [mx, joinedRoomIds]);
};
