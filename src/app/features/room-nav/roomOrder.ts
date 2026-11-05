import { useMemo, useState } from 'react';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../../types/matrix/accountData';
import { useAccountData } from '../../hooks/useAccountData';
import { useMatrixClient } from '../../hooks/useMatrixClient';

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
 * The account data content with the list set to `order`, or removed when `order` is undefined.
 * Other lists and any keys this client does not know stay as they are.
 */
export const withRoomOrder = (
  content: unknown,
  listId: string,
  order: readonly string[] | undefined
): Record<string, unknown> => {
  const current = isRecord(content) ? content : {};
  const lists = { ...(isRecord(current.lists) ? current.lists : {}) };
  if (order) lists[listId] = [...order];
  else delete lists[listId];
  return { ...current, lists };
};

/** Saves one list's order (undefined: back to A to Z) in the account data. */
export const saveRoomOrder = async (
  client: MatrixClient,
  listId: string,
  order: readonly string[] | undefined
): Promise<void> => {
  const current = client.getAccountData(AccountDataEvent.MindroomRoomOrder as never)?.getContent();
  await client.setAccountData(
    AccountDataEvent.MindroomRoomOrder as never,
    withRoomOrder(current, listId, order) as never
  );
};

/** A change not echoed by the server yet, made while `event` was the stored account data. */
type PendingOrder = {
  listId: string;
  event: MatrixEvent | undefined;
  order: string[] | undefined;
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
 * The order of one room list: `roomIds` (sorted A to Z) as the person ordered them. A change shows
 * at once and holds until the server echoes the account data; a failed save shows the old order.
 */
export const useRoomOrder = (listId: string, roomIds: readonly string[]): RoomOrder => {
  const client = useMatrixClient();
  const event = useAccountData(AccountDataEvent.MindroomRoomOrder);
  const [pending, setPending] = useState<PendingOrder>();
  const saved = useMemo(() => parseRoomOrderLists(event?.getContent())[listId], [event, listId]);
  // Any newer account data, the echo or another device's change, replaces the pending order.
  const current = pending && pending.listId === listId && pending.event === event;
  const order = current ? pending.order : saved;
  const ordered = useMemo(() => applyRoomOrder(roomIds, order), [roomIds, order]);

  const write = (next: string[] | undefined) => {
    const change = { listId, event, order: next };
    setPending(change);
    saveRoomOrder(client, listId, next).catch(() => {
      setPending((latest) => (latest === change ? undefined : latest));
    });
  };

  return {
    roomIds: ordered,
    manual: order !== undefined,
    save: write,
    reset: () => write(undefined),
  };
};
