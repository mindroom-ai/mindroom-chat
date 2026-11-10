import { ClientEvent, MatrixEventEvent, RoomEvent } from 'matrix-js-sdk';
import type { MatrixClient, MatrixEvent, Room } from 'matrix-js-sdk';
import type { CrossRoomThreadIndexEntry } from './crossRoomThreadIndex';
import { readThreadSignals, type ThreadSignals } from './threadSignals';

type Cached = { key: string; signals: ThreadSignals };

export type ThreadSignalsReader = {
  /** The thread's signals, read again only when something they depend on changed. */
  read: (
    room: Room,
    entry: CrossRoomThreadIndexEntry,
    userId: string,
    now: number
  ) => ThreadSignals;
  /** Forgets every thread whose index key `keep` does not hold. */
  prune: (keep: ReadonlySet<string>) => void;
};

/**
 * A cache of thread signals. They depend on more than an index entry's `generation` sees: a
 * reaction, an edit the thread holds back, a receipt from another device. So a thread is read
 * again whenever its room heard anything since (`roomChanges`), and once what it waits on lapses
 * (`waitsUntil`).
 */
export const createThreadSignalsReader = (
  roomChanges: (room: Room) => number = () => 0
): ThreadSignalsReader => {
  const cache = new Map<string, Cached>();
  return {
    read: (room, entry, userId, now) => {
      const events = room.getThread(entry.threadRootId)?.events ?? [];
      const key = [
        entry.generation,
        roomChanges(room),
        events.length,
        events.at(-1)?.getId() ?? '',
      ].join(':');
      const previous = cache.get(entry.key);
      const waitsUntil = previous?.signals.waitsUntil;
      const lapsed = waitsUntil !== undefined && now >= waitsUntil;
      if (previous && previous.key === key && !lapsed) return previous.signals;
      const read = readThreadSignals(room, entry.threadRootId, userId, now);
      // An agent asks whoever it talks with: in a thread the user takes no part in, not them.
      const { pendingQuestion: _theirs, ...others } = read;
      const signals = entry.isInvolved ? read : others;
      cache.set(entry.key, { key, signals });
      return signals;
    },
    prune: (keep) => {
      for (const key of cache.keys()) if (!keep.has(key)) cache.delete(key);
    },
  };
};

const readers = new WeakMap<MatrixClient, ThreadSignalsReader>();

/** The client's one signals cache, shared by Activity and the Threads page. */
export const getThreadSignalsReader = (mx: MatrixClient): ThreadSignalsReader => {
  let reader = readers.get(mx);
  if (!reader) {
    // What the client hears, per room: events (also those a thread holds back), decryptions, local
    // echoes and receipts.
    const changes = new Map<string, number>();
    const heard = (roomId: string | undefined) => {
      if (roomId) changes.set(roomId, (changes.get(roomId) ?? 0) + 1);
    };
    const heardEvent = (event: MatrixEvent) => heard(event.getRoomId());
    mx.on(ClientEvent.Event, heardEvent);
    mx.on(MatrixEventEvent.Decrypted, heardEvent);
    mx.on(RoomEvent.LocalEchoUpdated, heardEvent);
    mx.on(RoomEvent.Receipt, (_receipt, room) => heard(room.roomId));
    reader = createThreadSignalsReader((room) => changes.get(room.roomId) ?? 0);
    readers.set(mx, reader);
  }
  return reader;
};
