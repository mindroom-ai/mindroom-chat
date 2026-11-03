import { useEffect } from 'react';
import { atom, type WritableAtom, useSetAtom } from 'jotai';
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../types/matrix/accountData';
import { isRecord } from '../utils/isRecord';

export type MDirectAction =
  | { type: 'INITIALIZE'; rooms: Set<string> }
  | { type: 'UPDATE'; rooms: Set<string> };

export type MDirectAtom = WritableAtom<Set<string>, [MDirectAction], void>;

const directRoomsAtom = atom(new Set<string>());

/** IDs of the rooms the account's `m.direct` data marks as direct messages. */
export const mDirectAtom: MDirectAtom = atom<Set<string>, [MDirectAction], void>(
  (get) => get(directRoomsAtom),
  (_get, set, action) => set(directRoomsAtom, action.rooms)
);

/** The room IDs listed in an `m.direct` event (user ID to room IDs). */
export const getMDirects = (event?: MatrixEvent): Set<string> => {
  const rooms = new Set<string>();
  const content: unknown = event?.getContent();
  if (!isRecord(content)) return rooms;




    });
  });
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
      if (event.getType() !== AccountDataEvent.Direct) return;







};
