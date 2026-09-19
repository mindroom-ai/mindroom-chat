import { atom, useAtomValue, useSetAtom } from 'jotai';
import { ClientEvent, MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { useEffect, useMemo } from 'react';
import { allRoomsAtom } from '../../state/room-list/roomList';

const ARCHIVED_ROOMS_EVENT = 'io.mindroom.archived_rooms';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const readArchivedRooms = (content: unknown): Set<string> =>
  new Set(
    isRecord(content) && Array.isArray(content.rooms)
      ? content.rooms.filter((id): id is string => typeof id === 'string' && id.startsWith('!'))
      : []
  );

export const archivedRoomsAtom = atom<Set<string>>(new Set<string>());

export const useVisibleRooms = (rooms: string[]): string[] => {
  const archived = useAtomValue(archivedRoomsAtom);
  return useMemo(() => rooms.filter((id) => !archived.has(id)), [rooms, archived]);
};

// Keep membership and routing on allRoomsAtom; only navigation hides archives.
export const navigationRoomsAtom = atom((get) => {
  const archived = get(archivedRoomsAtom);
  return get(allRoomsAtom).filter((id) => !archived.has(id));
});

export const joinedArchivedRoomsAtom = atom((get) => {
  const archived = get(archivedRoomsAtom);
  return get(allRoomsAtom).filter((id) => archived.has(id));
});

export const useBindArchivedRoomsAtom = (mx: MatrixClient) => {
  const setArchived = useSetAtom(archivedRoomsAtom);
  useEffect(() => {
    const handleAccountData = (event: MatrixEvent) => {
      if (event.getType() === ARCHIVED_ROOMS_EVENT) {
        setArchived(readArchivedRooms(event.getContent()));
      }
    };
    mx.on(ClientEvent.AccountData, handleAccountData);
    setArchived(readArchivedRooms(mx.getAccountData(ARCHIVED_ROOMS_EVENT as any)?.getContent()));
    return () => {
      mx.removeListener(ClientEvent.AccountData, handleAccountData);
    };
  }, [mx, setArchived]);
};

const writeTails = new WeakMap<MatrixClient, Promise<void>>();

export const setRoomArchived = (
  mx: MatrixClient,
  roomId: string,
  archived: boolean
): Promise<void> => {
  // setAccountData resolves after its sync echo; re-read then to preserve queued edits.
  const task = (writeTails.get(mx) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const content: unknown = mx.getAccountData(ARCHIVED_ROOMS_EVENT as any)?.getContent();
      const rooms = readArchivedRooms(content);
      if (archived) rooms.add(roomId);
      else rooms.delete(roomId);
      await mx.setAccountData(
        ARCHIVED_ROOMS_EVENT as any,
        {
          ...(isRecord(content) ? content : {}),
          rooms: [...rooms],
        } as any
      );
    });
  writeTails.set(mx, task);
  return task;
};
