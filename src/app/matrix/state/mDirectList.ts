import { useEffect, useMemo } from 'react';
import { atom, type WritableAtom, useAtomValue, useSetAtom } from 'jotai';
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../hooks/useMatrixClient';
import { AccountDataEvent } from '../types/accountData';
import { isRecord } from '../../lib/isRecord';
import { matchesEnum } from '../../lib/matchesEnum';

type MDirectAction =
  { type: 'INITIALIZE'; rooms: Set<string> } | { type: 'UPDATE'; rooms: Set<string> };

type MDirectAtom = WritableAtom<Set<string>, [MDirectAction], void>;

const directRoomsAtom = atom(new Set<string>());

/** IDs of the rooms the account's `m.direct` data marks as direct messages. */
export const mDirectAtom: MDirectAtom = atom<Set<string>, [MDirectAction], void>(
  (get) => get(directRoomsAtom),
  (_get, set, action) => set(directRoomsAtom, action.rooms)
);

/** The room IDs listed in an `m.direct` event (user ID to room IDs). */
const getMDirects = (event?: MatrixEvent): Set<string> => {
  const rooms = new Set<string>();
  const content: unknown = event?.getContent();
  if (!isRecord(content)) return rooms;

  // Each value is the list of room IDs shared with that user (spec: "Direct Messaging").
  for (const roomIds of Object.values(content)) {
    if (!Array.isArray(roomIds)) continue;
    roomIds.filter((id): id is string => typeof id === 'string').forEach((id) => rooms.add(id));
  }
  return rooms;
};

/** Loads the current account's direct rooms, replacing any previous account's, and follows changes. */
export const useBindMDirectAtom = (mx: MatrixClient, directAtom: MDirectAtom = mDirectAtom) => {
  const setDirects = useSetAtom(directAtom);

  useEffect(() => {
    setDirects({
      type: 'INITIALIZE',
      rooms: getMDirects(mx.getAccountData(AccountDataEvent.Direct as never) ?? undefined),
    });

    const handleAccountData = (event: MatrixEvent) => {
      if (!matchesEnum(event.getType(), AccountDataEvent.Direct)) return;
      setDirects({ type: 'UPDATE', rooms: getMDirects(event) });
    };

    mx.on(ClientEvent.AccountData, handleAccountData);
    return () => void mx.off(ClientEvent.AccountData, handleAccountData);
  }, [mx, setDirects]);
};

/** Reads the raw `m.direct` account data dictionary (`userId -> roomId[]`) from `mx`. */
export const readMDirectContent = (
  mx: Pick<MatrixClient, 'getAccountData'> | undefined
): Record<string, unknown> | undefined => {
  const content: unknown = mx?.getAccountData?.(AccountDataEvent.Direct as never)?.getContent();
  return isRecord(content) ? content : undefined;
};

/** Live `m.direct` account-data dictionary (`userId -> roomId[]`), reacting to `mDirectAtom`. */
export const useMDirectContent = (): Record<string, unknown> | undefined => {
  const mx = useMatrixClient();
  const directs = useAtomValue(mDirectAtom);
  return useMemo(() => {
    void directs;
    return readMDirectContent(mx);
  }, [mx, directs]);
};

/**
 * Partner user ID mapped to `roomId` in `m.direct` account data. Prefers a non-self entry when a
 * room appears under multiple keys; returns `myUserId` only when mapped solely to the viewer.
 */
export const getMDirectPartnerId = (
  mDirect: Record<string, unknown> | undefined,
  roomId: string,
  myUserId?: string
): string | undefined => {
  if (!mDirect) return undefined;
  let selfMatch: string | undefined;
  for (const [userId, rooms] of Object.entries(mDirect)) {
    if (!Array.isArray(rooms) || !rooms.includes(roomId)) continue;
    if (myUserId && userId === myUserId) {
      selfMatch = userId;
      continue;
    }
    return userId;
  }
  return selfMatch;
};

/** Whether `m.direct` explicitly lists `roomId` under `myUserId` (a verified self-DM). */
export const isRoomInSelfMDirect = (
  mDirect: Record<string, unknown> | undefined,
  roomId: string,
  myUserId: string | undefined
): boolean => {
  if (!myUserId || !mDirect) return false;
  const ownRooms = mDirect[myUserId];
  return Array.isArray(ownRooms) && ownRooms.includes(roomId);
};
