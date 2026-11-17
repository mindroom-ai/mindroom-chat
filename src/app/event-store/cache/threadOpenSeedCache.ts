import { MatrixEvent, Room } from 'matrix-js-sdk';
import { getLatestEdit } from '../../matrix/room';
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
 * The events without the same-sender edits a newer one supersedes, as the event cache stores them
 * (`serializeEventsForCache`): a streamed reply leaves one edit per chunk, each with its own ID.
 */
const dropSupersededEdits = (events: MatrixEvent[]): MatrixEvent[] => {
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
  const latestEdits = new Set(
    Array.from(editsByTarget, ([target, edits]) => getLatestEdit(target, edits))
  );
  return events.filter(
    (event) => !isStandaloneSameSenderReplace(event, eventsById) || latestEdits.has(event)
  );
};

export const saveThreadOpenSeedSnapshot = (
  room: Room,
  threadId: string,
  events: MatrixEvent[]
): void => {
  if (events.length === 0) return;
  getRoomThreadOpenSeedStore(room).set(threadId, dropSupersededEdits(events));
};

export const clearThreadOpenSeedSnapshotsForTests = (): void => {
  threadOpenSeedSnapshots = new WeakMap<Room, Map<string, MatrixEvent[]>>();
};
