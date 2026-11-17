import { MatrixEvent, Room } from 'matrix-js-sdk';
import { collectKnownRedactedEventIds, createIsKnownRedacted } from '../../matrix/eventRevision';
import { getReleasableEdits } from '../../matrix/room';
import { isStandaloneSameSenderReplace } from './eventCacheEditUtils';

let threadOpenSeedSnapshots = new WeakMap<Room, Map<string, MatrixEvent[]>>();
export const clearRoomThreadOpenSeedSnapshots = (room: Room): void => {
  threadOpenSeedSnapshots.delete(room);
};

const getRoomThreadOpenSeedStore = (room: Room): Map<string, MatrixEvent[]> => {
  let roomStore = threadOpenSeedSnapshots.get(room);
  if (!roomStore) {
    roomStore = new Map<string, MatrixEvent[]>();
    threadOpenSeedSnapshots.set(room, roomStore);
  }
  return roomStore;
};

export const getThreadOpenSeedSnapshot = (room: Room, threadId: string): MatrixEvent[] =>
  getRoomThreadOpenSeedStore(room).get(threadId)?.slice() ?? [];

/**
 * The events without the same-sender edits the app can no longer show or borrow from
 * (`getReleasableEdits`): a streamed reply leaves one edit per chunk, which the event cache folds
 * into its target (`isStandaloneSameSenderReplace`).
 */
const dropSupersededEdits = (room: Room, events: MatrixEvent[]): MatrixEvent[] => {
  const eventsById = new Map<string, MatrixEvent>();
  events.forEach((event) => {
    const eventId = event.getId();
    if (eventId) eventsById.set(eventId, event);
  });
  const editsByTarget = new Map<MatrixEvent, MatrixEvent[]>();
  events.forEach((event) => {
    const target = eventsById.get(event.getRelation()?.event_id ?? '');
    if (!target || !isStandaloneSameSenderReplace(event, eventsById)) return;
    const edits = editsByTarget.get(target) ?? [];
    edits.push(event);
    editsByTarget.set(target, edits);
  });
  if (editsByTarget.size === 0) return events.slice();

  const isKnownRedacted = createIsKnownRedacted(
    room,
    collectKnownRedactedEventIds(
      room,
      events.map((event) => event.event)
    )
  );
  const dropped = new Set(
    [...editsByTarget.values()].flatMap((edits) => getReleasableEdits(edits, isKnownRedacted))
  );
  return events.filter((event) => !dropped.has(event));
};

export const saveThreadOpenSeedSnapshot = (
  room: Room,
  threadId: string,
  events: MatrixEvent[]
): void => {
  if (events.length === 0) return;
  getRoomThreadOpenSeedStore(room).set(threadId, dropSupersededEdits(room, events));
};

export const clearThreadOpenSeedSnapshotsForTests = (): void => {
  threadOpenSeedSnapshots = new WeakMap<Room, Map<string, MatrixEvent[]>>();
};
