import { EventType, RelationType } from 'matrix-js-sdk';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { getSyncedEdit } from '../../matrix/client/syncedEdits';
import { isPendingApproval } from '../../matrix/protocol/threadApprovalModel';
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

const reactionCount = (room: Room, eventId: string): number =>
  room
    .getUnfilteredTimelineSet()
    .relations.getChildEventsForEvent(eventId, RelationType.Annotation, EventType.Reaction)
    ?.getRelations().length ?? 0;

/**
 * A cache of thread signals. An index entry's `generation` misses changes the signals see: a
 * reaction or an approval card's edit in the loaded thread, a reaction on the question it waits
 * on, the edit that answers its waiting approval, and the clock that expires an approval; the
 * cache key holds those too.
 */
export const createThreadSignalsReader = (): ThreadSignalsReader => {
  const cache = new Map<string, Cached>();
  return {
    read: (room, entry, userId, now) => {
      const events = room.getThread(entry.threadRootId)?.events ?? [];
      const base = `${entry.generation}:${events.length}:${events.at(-1)?.getId() ?? ''}`;
      // What a thread waits on adds to its key: reactions on the question, the card's synced edit.
      const keyOf = ({ pendingQuestion, pendingApproval }: ThreadSignals) =>
        [
          base,
          pendingQuestion ? reactionCount(room, pendingQuestion.eventId) : '',
          pendingApproval ? getSyncedEdit(pendingApproval.eventId)?.getId() ?? '' : '',
        ].join(':');
      const previous = cache.get(entry.key);
      const approval = previous?.signals.pendingApproval;
      const expired = !!approval && !isPendingApproval(approval, now);
      if (previous && previous.key === keyOf(previous.signals) && !expired) return previous.signals;
      const read = readThreadSignals(room, entry.threadRootId, userId, now);
      // An agent asks whoever it talks with: in a thread the user takes no part in, not them.
      const { pendingQuestion: _theirs, ...others } = read;
      const signals = entry.isInvolved ? read : others;
      cache.set(entry.key, { key: keyOf(signals), signals });
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
    reader = createThreadSignalsReader();
    readers.set(mx, reader);
  }
  return reader;
};
