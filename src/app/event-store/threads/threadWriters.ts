/**
 * Who wrote in each thread of a room, as far as the client has read the thread's replies: from
 * `/relations` pages it fetched and from the event cache. A thread the server's list brought in
 * carries only its root and its newest reply, and the server's thread summary (the bundled
 * `m.thread` aggregation) adds only the reply count and whether the current user took part, so a
 * thread's other writers are known only once its replies are read. This keeps them per room, so
 * the cards and the People filter still know them when the thread's replies are not loaded.
 */
import { useCallback, useSyncExternalStore } from 'react';
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import { buildVisibleThreadParticipantMap } from './threadUtils';

export type ThreadWriters = {
  /** The distinct senders of the thread's replies, newest first. */
  senderIds: readonly string[];
  /** Whether they come from every reply of the thread. */
  complete: boolean;
};

/** How long new writers wait before they are published, so a run of reads rebuilds once. */
export const THREAD_WRITERS_PUBLISH_DELAY_MS = 250;

type RoomThreadWriters = {
  published: ReadonlyMap<string, ThreadWriters>;
  pending: Map<string, ThreadWriters> | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  listeners: Set<() => void>;
};

const EMPTY: ReadonlyMap<string, ThreadWriters> = new Map();
const rooms = new WeakMap<Room, RoomThreadWriters>();

const roomWriters = (room: Room): RoomThreadWriters => {
  let entry = rooms.get(room);
  if (!entry) {
    entry = { published: EMPTY, pending: undefined, timer: undefined, listeners: new Set() };
    rooms.set(room, entry);
  }
  return entry;
};

const publish = (entry: RoomThreadWriters) => {
  clearTimeout(entry.timer);
  entry.timer = undefined;
  if (!entry.pending) return;
  entry.published = entry.pending;
  entry.pending = undefined;
  entry.listeners.forEach((listener) => listener());
};

/** The distinct senders of `rootId`'s replies among `events`, newest first. */
export const collectThreadWriterIds = (events: readonly MatrixEvent[], rootId: string): string[] =>
  buildVisibleThreadParticipantMap([...events], Infinity).get(rootId) ?? [];

const sameIds = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, index) => id === b[index]);

/**
 * Notes the writers of `rootId` that `events` (some or all of its replies) show. Every reply of
 * the thread (`complete`) replaces what was known; a part adds its writers, newest first. Readers
 * see the change after `THREAD_WRITERS_PUBLISH_DELAY_MS`.
 */
export const recordThreadWriters = (
  room: Room,
  rootId: string,
  events: readonly MatrixEvent[],
  complete: boolean
): void => {
  const entry = roomWriters(room);
  const current = entry.pending ?? entry.published;
  const known = current.get(rootId);
  const seen = collectThreadWriterIds(events, rootId);
  const next: ThreadWriters = complete
    ? { senderIds: seen, complete: true }
    : {
        senderIds: [...seen, ...(known?.senderIds ?? []).filter((id) => !seen.includes(id))],
        complete: known?.complete ?? false,
      };
  if (known && known.complete === next.complete && sameIds(known.senderIds, next.senderIds)) {
    return;
  }
  if (!entry.pending) entry.pending = new Map(entry.published);
  entry.pending.set(rootId, next);
  entry.timer ??= setTimeout(() => publish(entry), THREAD_WRITERS_PUBLISH_DELAY_MS);
};

/** What is known of the writers of `room`'s threads, published so far. */
export const getThreadWriters = (room: Room): ReadonlyMap<string, ThreadWriters> =>
  rooms.get(room)?.published ?? EMPTY;

/** The writers of `room`'s threads; renders again when more are known. */
export const useThreadWriters = (room: Room): ReadonlyMap<string, ThreadWriters> => {
  const subscribe = useCallback(
    (listener: () => void) => {
      const { listeners } = roomWriters(room);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    [room]
  );
  const snapshot = useCallback(() => getThreadWriters(room), [room]);
  return useSyncExternalStore(subscribe, snapshot);
};

/**
 * Each thread's people for the records: the writers `loaded` shows first (they can be newer),
 * then the other writers known from read replies.
 */
export const mergeThreadWriterIds = (
  loaded: ReadonlyMap<string, string[]>,
  writers: ReadonlyMap<string, ThreadWriters>
): Map<string, string[]> => {
  const merged = new Map(loaded);
  writers.forEach(({ senderIds }, rootId) => {
    const first = merged.get(rootId) ?? [];
    merged.set(rootId, [...first, ...senderIds.filter((id) => !first.includes(id))]);
  });
  return merged;
};
