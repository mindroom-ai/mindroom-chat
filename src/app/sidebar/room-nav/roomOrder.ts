import { useMemo, useState } from 'react';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../matrix/types/accountData';
import { useAccountData } from '../../matrix/hooks/useAccountData';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';

/**
 * Room lists the person ordered by hand, in the `io.mindroom.room_order` account data, so the
 * order follows the account to every device: `{ "lists": { "<list>": ["<room ID>", ...] } }`. A
 * list is `home` (the rooms outside spaces) or a space's room ID (that space's Rooms section). A
 * list without an entry keeps the A to Z order.
 */

/** The list of the Home page's Rooms section; a space's list is the space's room ID. */
export const HOME_ROOM_LIST = 'home';

export type RoomOrderLists = Record<string, string[]>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The strings of `value` once each, in order; anything else is dropped. */
const uniqueStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? [...new Set(value.filter((entry): entry is string => typeof entry === 'string'))]
    : [];

/** The saved lists in account data content, with malformed or empty ones dropped. */
export const parseRoomOrderLists = (content: unknown): RoomOrderLists => {
  const lists = isRecord(content) ? content.lists : undefined;
  if (!isRecord(lists)) return {};
  const parsed: RoomOrderLists = {};
  Object.entries(lists).forEach(([listId, order]) => {
    const roomIds = uniqueStrings(order);
    if (roomIds.length > 0) parsed[listId] = roomIds;
  });
  return parsed;
};

/**
 * The rooms of a list in the saved order: the saved rooms still in `roomIds` first, then the rest
 * in the order `roomIds` has them (A to Z), so a room joined later shows at the end.
 */
export const applyRoomOrder = (roomIds: readonly string[], saved?: readonly string[]): string[] => {
  if (!saved || saved.length === 0) return [...roomIds];
  const present = new Set(roomIds);
  const ordered = saved.filter((roomId) => present.has(roomId));
  const placed = new Set(ordered);
  return [...ordered, ...roomIds.filter((roomId) => !placed.has(roomId))];
};

/** `order` with `roomId` taken out and put at `toIndex`; unchanged when it holds no such room. */
export const moveRoom = (order: readonly string[], roomId: string, toIndex: number): string[] => {
  const from = order.indexOf(roomId);
  if (from < 0) return [...order];
  const next = order.filter((id) => id !== roomId);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, roomId);
  return next;
};

/**
 * The account data content with each entry of `changes` applied: a room ID list sets that list's
 * order, and `undefined` removes it (back to A to Z). Other lists and unknown keys stay as they
 * are.
 */
export const withRoomOrders = (
  content: unknown,
  changes: Readonly<Record<string, readonly string[] | undefined>>
): Record<string, unknown> => {
  const current = isRecord(content) ? content : {};
  const lists = { ...(isRecord(current.lists) ? current.lists : {}) };
  Object.entries(changes).forEach(([listId, order]) => {
    if (order) lists[listId] = [...order];
    else delete lists[listId];
  });
  return { ...current, lists };
};

/** Applies all `changes` to `io.mindroom.room_order` in one account-data write. */
export const saveRoomOrders = async (
  client: MatrixClient,
  changes: Readonly<Record<string, readonly string[] | undefined>>
): Promise<void> => {
  const current = client.getAccountData(AccountDataEvent.MindroomRoomOrder as never)?.getContent();
  await client.setAccountData(
    AccountDataEvent.MindroomRoomOrder as never,
    withRoomOrders(current, changes) as never
  );
};

/** Changes not echoed by the server yet, made while `event` was the stored account data. */
type PendingOrders = {
  event: MatrixEvent | undefined;
  changes: Record<string, string[] | undefined>;
};

export type RoomOrders = {
  /** `roomIds` (sorted A to Z) in the saved order for `listId`, if any. */
  orderOf: (listId: string, roomIds: readonly string[]) => string[];
  /** Whether `listId` is ordered by hand. */
  isManual: (listId: string) => boolean;
  /** Saves `order` as `listId`'s order. */
  save: (listId: string, order: string[]) => void;
  /** Forgets the saved order of every list in `listIds` in one account-data write. */
  reset: (listIds: readonly string[]) => void;
};

export type RoomOrder = {
  /** The list's rooms as the section shows them. */
  roomIds: string[];
  /** Whether the person ordered the list by hand. */
  manual: boolean;
  /** Saves `order` as the list's order. */
  save: (order: string[]) => void;
  /** Forgets the list's order, so it shows A to Z again. */
  reset: () => void;
};

/**
 * All hand-ordered room lists from one `io.mindroom.room_order` subscription. Changes show at once
 * and hold until the server echoes the account data; a failed save reverts to the stored order.
 */
export const useRoomOrders = (): RoomOrders => {
  const client = useMatrixClient();
  const event = useAccountData(AccountDataEvent.MindroomRoomOrder);
  const [pending, setPending] = useState<PendingOrders>();
  const savedLists = useMemo(() => parseRoomOrderLists(event?.getContent()), [event]);
  // Any newer account data, the echo or another device's change, replaces pending changes.
  const activeChanges = pending && pending.event === event ? pending.changes : undefined;

  return useMemo(() => {
    const savedOf = (listId: string): readonly string[] | undefined =>
      activeChanges && Object.prototype.hasOwnProperty.call(activeChanges, listId)
        ? activeChanges[listId]
        : savedLists[listId];

    const write = (changes: Record<string, string[] | undefined>) => {
      if (Object.keys(changes).length === 0) return;
      const merged = { ...activeChanges, ...changes };
      const change: PendingOrders = { event, changes: merged };
      setPending(change);
      saveRoomOrders(client, merged).catch(() => {
        setPending((latest) => (latest === change ? undefined : latest));
      });
    };

    return {
      orderOf: (listId, roomIds) => applyRoomOrder(roomIds, savedOf(listId)),
      isManual: (listId) => savedOf(listId) !== undefined,
      save: (listId, order) => write({ [listId]: order }),
      reset: (listIds) => {
        const changes: Record<string, undefined> = {};
        listIds.forEach((listId) => {
          changes[listId] = undefined;
        });
        write(changes);
      },
    };
  }, [client, event, savedLists, activeChanges]);
};
