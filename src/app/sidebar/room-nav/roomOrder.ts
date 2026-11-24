import { useMemo, useState } from 'react';
import type { MatrixClient, MatrixEvent } from 'matrix-js-sdk';
import { AccountDataEvent } from '../../matrix/types/accountData';
import { useAccountData } from '../../matrix/hooks/useAccountData';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';

/**
 * Per-list sidebar room sort preferences and hand-ordered room lists in `io.mindroom.room_order`:
 * `{ lists, modes, showTimes }`. A list is `home` or a space's room ID. Legacy accounts with only
 * `lists` resolve saved lists to `'manual'`.
 */

/** The list of the Home page's Rooms section; a space's list is the space's room ID. */
export const HOME_ROOM_LIST = 'home';

export type RoomSortMode = 'recent' | 'name' | 'manual';
/** Stored mode value; `'inherit'` lets a sub-space with a saved list inherit from its parent. */
export type StoredRoomSortMode = RoomSortMode | 'inherit';
export type InheritSource = string | readonly string[];
export type RoomOrderLists = Record<string, string[]>;
export type RoomOrderData = {
  lists: RoomOrderLists;
  modes: Record<string, StoredRoomSortMode>;
  showTimes: Record<string, boolean>;
};
export type RoomOrderChanges = {
  lists?: Readonly<Record<string, readonly string[] | undefined>>;
  modes?: Readonly<Record<string, StoredRoomSortMode | undefined>>;
  showTimes?: Readonly<Record<string, boolean | undefined>>;
};

const VALID_MODES = new Set<string>(['recent', 'name', 'manual', 'inherit']);
const hasOwn = (record: Record<string, unknown>, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(record, key);
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isStoredMode = (value: unknown): value is StoredRoomSortMode =>
  typeof value === 'string' && VALID_MODES.has(value);
const isConcreteMode = (value: StoredRoomSortMode | undefined): value is RoomSortMode =>
  value === 'recent' || value === 'name' || value === 'manual';
const toAncestors = (inheritFrom?: InheritSource): readonly string[] =>
  inheritFrom === undefined ? [] : typeof inheritFrom === 'string' ? [inheritFrom] : inheritFrom;
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

/** Parses `lists`, `modes`, and `showTimes` from `io.mindroom.room_order`, dropping invalid entries. */
export const parseRoomOrderData = (content: unknown): RoomOrderData => {
  const lists = parseRoomOrderLists(content);
  const modes: Record<string, StoredRoomSortMode> = {};
  const showTimes: Record<string, boolean> = {};
  if (isRecord(content)) {
    if (isRecord(content.modes)) {
      Object.entries(content.modes).forEach(([id, mode]) => {
        if (isStoredMode(mode)) modes[id] = mode;
      });
    }
    if (isRecord(content.showTimes)) {
      Object.entries(content.showTimes).forEach(([id, show]) => {
        if (typeof show === 'boolean') showTimes[id] = show;
      });
    }
  }
  return { lists, modes, showTimes };
};

/** Saved rooms still in `roomIds` first, then the rest in A to Z order. */
export const applyRoomOrder = (roomIds: readonly string[], saved?: readonly string[]): string[] => {
  if (!saved || saved.length === 0) return [...roomIds];
  const present = new Set(roomIds);
  const ordered = saved.filter((roomId) => present.has(roomId));
  const placed = new Set(ordered);
  return [...ordered, ...roomIds.filter((roomId) => !placed.has(roomId))];
};

/** `order` with `roomId` moved to `toIndex`; unchanged when absent. */
export const moveRoom = (order: readonly string[], roomId: string, toIndex: number): string[] => {
  const from = order.indexOf(roomId);
  if (from < 0) return [...order];
  const next = order.filter((id) => id !== roomId);
  next.splice(Math.max(0, Math.min(toIndex, next.length)), 0, roomId);
  return next;
};

/** Appends `roomId` to a saved manual order, keeping archived saved IDs and unsaved visible rooms. */
export const appendRoomOrder = (
  saved: readonly string[],
  visibleRoomIds: readonly string[],
  roomId: string
): string[] => [
  ...[...new Set([...saved, ...visibleRoomIds])].filter((id) => id !== roomId),
  roomId,
];

const patchSection = <T>(
  base: unknown,
  changes: Readonly<Record<string, T | undefined>>,
  clone: (value: T) => unknown
): Record<string, unknown> => {
  const next = { ...(isRecord(base) ? base : {}) };
  Object.entries(changes).forEach(([id, value]) => {
    if (value !== undefined) next[id] = clone(value);
    else delete next[id];
  });
  return next;
};

/** Applies `changes` (`lists`, `modes`, `showTimes`) while preserving unknown top-level keys. */
export const withRoomOrderChanges = (
  content: unknown,
  changes: RoomOrderChanges
): Record<string, unknown> => {
  const current = isRecord(content) ? content : {};
  const next: Record<string, unknown> = { ...current };
  if (changes.lists) next.lists = patchSection(current.lists, changes.lists, (order) => [...order]);
  if (changes.modes) {
    const modes = patchSection(current.modes, changes.modes, (mode) => mode);
    if (Object.keys(modes).length > 0) next.modes = modes;
    else delete next.modes;
  }
  if (changes.showTimes) {
    const showTimes = patchSection(current.showTimes, changes.showTimes, (show) => show);
    if (Object.keys(showTimes).length > 0) next.showTimes = showTimes;
    else delete next.showTimes;
  }
  return next;
};

/** Applies list `changes` to account data content while preserving other lists and unknown keys. */
export const withRoomOrders = (
  content: unknown,
  changes: Readonly<Record<string, readonly string[] | undefined>>
): Record<string, unknown> => withRoomOrderChanges(content, { lists: changes });

/** Applies `changes` to `io.mindroom.room_order` in one account-data write. */
export const saveRoomOrderChanges = async (
  client: MatrixClient,
  changes: RoomOrderChanges
): Promise<void> => {
  const current = client.getAccountData(AccountDataEvent.MindroomRoomOrder as never)?.getContent();
  await client.setAccountData(
    AccountDataEvent.MindroomRoomOrder as never,
    withRoomOrderChanges(current, changes) as never
  );
};

/** Applies all list `changes` to `io.mindroom.room_order` in one account-data write. */
export const saveRoomOrders = async (
  client: MatrixClient,
  changes: Readonly<Record<string, readonly string[] | undefined>>
): Promise<void> => saveRoomOrderChanges(client, { lists: changes });

type PendingChanges = {
  event: MatrixEvent | undefined;
  lists: Record<string, string[] | undefined>;
  modes: Record<string, StoredRoomSortMode | undefined>;
  showTimes: Record<string, boolean | undefined>;
};

export type RoomOrders = {
  orderOf: (listId: string, roomIds: readonly string[]) => string[];
  modeOf: (listId: string, inheritFrom?: InheritSource) => RoomSortMode;
  hasExplicitMode: (listId: string) => boolean;
  showTimesOf: (listId: string, inheritFrom?: InheritSource) => boolean;
  hasSavedOrder: (listId: string) => boolean;
  isManual: (listId: string, inheritFrom?: InheritSource) => boolean;
  save: (listId: string, order: string[]) => void;
  setMode: (listId: string, mode: RoomSortMode, currentOrder?: readonly string[]) => void;
  setShowTimes: (listId: string, show: boolean, inheritFrom?: InheritSource) => void;
  resetSubspaceOverride: (subspaceId: string) => void;
  appendRoom: (
    listId: string,
    visibleRoomIds: readonly string[],
    roomId: string,
    inheritFrom?: InheritSource
  ) => void;
  reset: (listIds: readonly string[]) => void;
};

export type RoomOrder = {
  roomIds: string[];
  mode: RoomSortMode;
  showTimes: boolean;
  hasSavedOrder: boolean;
  manual: boolean;
  save: (order: string[]) => void;
  setMode: (mode: RoomSortMode) => void;
  setShowTimes: (show: boolean) => void;
  reset: () => void;
};

const mergeMap = <T, R>(
  base: Record<string, R | undefined> | undefined,
  patch: Readonly<Record<string, T | undefined>> | undefined,
  map: (value: T) => R
): Record<string, R | undefined> => {
  const merged = { ...base };
  if (patch) {
    Object.entries(patch).forEach(([id, val]) => {
      merged[id] = val !== undefined ? map(val) : undefined;
    });
  }
  return merged;
};

/**
 * All sidebar room sort preferences and hand-ordered lists from one `io.mindroom.room_order`
 * subscription, with optimistic updates that revert if `setAccountData` rejects.
 */
export const useRoomOrders = (): RoomOrders => {
  const client = useMatrixClient();
  const event = useAccountData(AccountDataEvent.MindroomRoomOrder);
  const [pending, setPending] = useState<PendingChanges>();
  const saved = useMemo(() => parseRoomOrderData(event?.getContent()), [event]);
  const active = pending && pending.event === event ? pending : undefined;

  return useMemo(() => {
    const read = <K extends keyof RoomOrderData>(
      field: K,
      id: string
    ): RoomOrderData[K][string] | undefined => {
      const pendingMap = active?.[field] as
        | Record<string, RoomOrderData[K][string] | undefined>
        | undefined;
      if (pendingMap && hasOwn(pendingMap, id)) return pendingMap[id];
      return (saved[field] as Record<string, RoomOrderData[K][string] | undefined>)[id];
    };

    const hasSavedOrder = (id: string): boolean => (read('lists', id)?.length ?? 0) > 0;

    const explicitModeOf = (id: string): RoomSortMode | undefined => {
      const stored = read('modes', id);
      if (isConcreteMode(stored)) return stored;
      if (stored === 'inherit') return undefined;
      return hasSavedOrder(id) ? 'manual' : undefined;
    };

    const modeOf = (id: string, inheritFrom?: InheritSource): RoomSortMode => {
      for (const candidate of [id, ...toAncestors(inheritFrom)]) {
        const mode = explicitModeOf(candidate);
        if (mode) return mode;
      }
      return 'name';
    };

    const showTimesOf = (id: string, inheritFrom?: InheritSource): boolean => {
      for (const candidate of [id, ...toAncestors(inheritFrom)]) {
        const show = read('showTimes', candidate);
        if (show !== undefined) return show;
      }
      return false;
    };

    const write = (changes: RoomOrderChanges) => {
      const lists = mergeMap(active?.lists, changes.lists, (order) => [...order]);
      const modes = mergeMap(active?.modes, changes.modes, (mode) => mode);
      const showTimes = mergeMap(active?.showTimes, changes.showTimes, (show) => show);
      const nextChanges: RoomOrderChanges = {
        ...(Object.keys(lists).length > 0 ? { lists } : undefined),
        ...(Object.keys(modes).length > 0 ? { modes } : undefined),
        ...(Object.keys(showTimes).length > 0 ? { showTimes } : undefined),
      };
      if (!nextChanges.lists && !nextChanges.modes && !nextChanges.showTimes) return;
      const nextPending: PendingChanges = { event, lists, modes, showTimes };
      setPending(nextPending);
      saveRoomOrderChanges(client, nextChanges).catch(() => {
        setPending((latest) => (latest === nextPending ? undefined : latest));
      });
    };

    return {
      orderOf: (id, roomIds) => applyRoomOrder(roomIds, read('lists', id)),
      modeOf,
      hasExplicitMode: (id) => explicitModeOf(id) !== undefined,
      showTimesOf,
      hasSavedOrder,
      isManual: (id, inheritFrom) => modeOf(id, inheritFrom) === 'manual',
      save: (id, order) => write({ lists: { [id]: order }, modes: { [id]: 'manual' } }),
      setMode: (id, mode, currentOrder) => {
        const freeze =
          mode === 'manual' && !hasSavedOrder(id) && currentOrder && currentOrder.length > 0;
        write({
          modes: { [id]: mode },
          ...(freeze ? { lists: { [id]: currentOrder } } : undefined),
        });
      },
      setShowTimes: (id, show, inheritFrom) => {
        if (show) {
          write({ showTimes: { [id]: true } });
          return;
        }
        const ancestors = toAncestors(inheritFrom);
        const parentShows = ancestors.length > 0 && showTimesOf(ancestors[0]!, ancestors.slice(1));
        if (parentShows) write({ showTimes: { [id]: false } });
        else if (read('showTimes', id) !== undefined) write({ showTimes: { [id]: undefined } });
      },
      resetSubspaceOverride: (id) => {
        const nextMode: StoredRoomSortMode | undefined = hasSavedOrder(id) ? 'inherit' : undefined;
        const curMode = read('modes', id);
        const curShow = read('showTimes', id);
        if (curMode === nextMode && curShow === undefined) return;
        write({
          ...(curMode !== nextMode ? { modes: { [id]: nextMode } } : undefined),
          ...(curShow !== undefined ? { showTimes: { [id]: undefined } } : undefined),
        });
      },
      appendRoom: (id, visibleRoomIds, roomId, inheritFrom) => {
        if (modeOf(id, inheritFrom) !== 'manual') return;
        const savedList = read('lists', id);
        if (savedList)
          write({ lists: { [id]: appendRoomOrder(savedList, visibleRoomIds, roomId) } });
      },
      reset: (listIds) => {
        if (listIds.length === 0) return;
        const lists: Record<string, undefined> = {};
        const modes: Record<string, undefined> = {};
        listIds.forEach((id) => {
          lists[id] = undefined;
          if (read('modes', id) !== undefined) modes[id] = undefined;
        });
        write({ lists, ...(Object.keys(modes).length > 0 ? { modes } : undefined) });
      },
    };
  }, [client, event, saved, active]);
};
