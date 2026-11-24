import { useCallback, useMemo } from 'react';
import { atom, useAtom, type WritableAtom } from 'jotai';
import {
  atomWithLocalStorage,
  getLocalStorageItem,
  setLocalStorageItem,
} from '../lib/state/atomWithLocalStorage';
import { getSafeLocalStorage, removeStorageItemSafe } from '../lib/safeLocalStorage';
import { settingsAtom } from '../preferences/settings';
import { useSettingValue } from '../preferences/useSettingValue';
import { useActiveSession } from '../matrix/session/useSessionStore';

/**
 * Where the reader changed whether agent replies list their tool calls: a room's choice, from the
 * room menu, and a thread's, from the thread menu. Everything else follows `showToolCalls` in
 * Settings. Kept on this device, as the room's view is.
 */
export type ToolCallOverrides = Record<
  string,
  { room?: boolean; threads?: Record<string, boolean> }
>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const sanitizeToolCallOverrides = (value: unknown): ToolCallOverrides => {
  if (!isRecord(value)) return {};
  const overrides: ToolCallOverrides = {};
  Object.entries(value).forEach(([roomId, entry]) => {
    if (!isRecord(entry)) return;
    const threads = isRecord(entry.threads)
      ? Object.fromEntries(
          Object.entries(entry.threads).filter(
            (pair): pair is [string, boolean] => typeof pair[1] === 'boolean'
          )
        )
      : {};
    const room = typeof entry.room === 'boolean' ? entry.room : undefined;
    if (room === undefined && Object.keys(threads).length === 0) return;
    overrides[roomId] = {
      ...(room !== undefined && { room }),
      ...(Object.keys(threads).length > 0 && { threads }),
    };
  });
  return overrides;
};

/** The thread's choice, else the room's, else the default from Settings. */
export const resolveToolCallsShown = (
  overrides: ToolCallOverrides,
  fallback: boolean,
  roomId?: string,
  threadId?: string
): boolean => {
  const entry = roomId === undefined ? undefined : overrides[roomId];
  const roomShown = entry?.room ?? fallback;
  return (threadId === undefined ? undefined : entry?.threads?.[threadId]) ?? roomShown;
};

/**
 * Stores the choice for the room (no `threadId`) or the thread. A choice equal to what the level
 * above gives is forgotten, so the room or thread follows that level again when it changes.
 */
export const withToolCallsShown = (
  overrides: ToolCallOverrides,
  fallback: boolean,
  roomId: string,
  threadId: string | undefined,
  shown: boolean
): ToolCallOverrides => {
  const entry = overrides[roomId] ?? {};
  const above = threadId === undefined ? fallback : entry.room ?? fallback;
  const value = shown === above ? undefined : shown;
  const { room, threads = {} } = entry;
  const next =
    threadId === undefined
      ? { room: value, threads }
      : { room, threads: { ...threads, [threadId]: value } };
  return sanitizeToolCallOverrides({ ...overrides, [roomId]: next });
};

const STORAGE_PREFIX = 'toolCallsShown';
const storageKey = (sessionId: string) => `${STORAGE_PREFIX}:${sessionId}`;

const overrideAtoms = new Map<string, WritableAtom<ToolCallOverrides, [ToolCallOverrides], void>>();

const overridesAtom = (sessionId: string) => {
  let valueAtom = overrideAtoms.get(sessionId);
  if (!valueAtom) {
    valueAtom = atomWithLocalStorage<ToolCallOverrides>(
      storageKey(sessionId),
      (key) => sanitizeToolCallOverrides(getLocalStorageItem<unknown>(key, {})),
      (key, value) => {
        setLocalStorageItem(key, Object.keys(value).length > 0 ? value : undefined);
      }
    );
    overrideAtoms.set(sessionId, valueAtom);
  }
  return valueAtom;
};

/** Forgets the account's room and thread choices, when it signs out. */
export const clearToolCallOverrides = (sessionId: string): void => {
  removeStorageItemSafe(getSafeLocalStorage(), storageKey(sessionId));
  overrideAtoms.delete(sessionId);
};

/**
 * Whether tool calls show in the room (no `threadId`) or the thread, and a setter that stores the
 * choice for that same room or thread, for the signed-in account. Without one only the default
 * applies.
 */
export const useToolCallsShown = (
  roomId?: string,
  threadId?: string
): [boolean, (shown: boolean) => void] => {
  const sessionId = useActiveSession()?.sessionId;
  const fallback = useSettingValue(settingsAtom, 'showToolCalls');
  // Signed out (or in fixtures) there is no account to read choices for, or to store them for.
  const valueAtom = useMemo(
    () => (sessionId === undefined ? atom<ToolCallOverrides>({}) : overridesAtom(sessionId)),
    [sessionId]
  );
  const [overrides, setOverrides] = useAtom(valueAtom);
  const setShown = useCallback(
    (shown: boolean) => {
      if (sessionId === undefined || roomId === undefined) return;
      setOverrides(withToolCallsShown(overrides, fallback, roomId, threadId, shown));
    },
    [fallback, overrides, roomId, sessionId, setOverrides, threadId]
  );
  return [resolveToolCallsShown(overrides, fallback, roomId, threadId), setShown];
};
