/**
 * The thread filter bar's People filter: who took part in each thread, who took part in the
 * room's threads at all (the picker's list), and which threads a selection keeps.
 */
import type { MatrixEvent } from 'matrix-js-sdk/lib/models/event';
import type { ThreadRecord } from './types';

/** The distinct senders of a thread: its root's sender first, then everyone who replied. */
export const collectThreadPeopleIds = (
  rootSenderId: string | undefined,
  replySenderIds: Iterable<string | undefined>
): string[] => {
  const people = new Set<string>();
  if (rootSenderId) people.add(rootSenderId);
  for (const senderId of replySenderIds) {
    if (senderId) people.add(senderId);
  }
  return [...people];
};

/**
 * Whether the server says the current user wrote in the thread: its bundled `m.thread`
 * aggregation on the root carries `current_user_participated`, worked out for the requesting user.
 * The aggregation names no other writer but the newest reply's sender.
 */
export const currentUserTookPart = (rootEvent: MatrixEvent | undefined): boolean => {
  const thread = rootEvent?.getUnsigned()?.['m.relations']?.['m.thread'] as
    | { current_user_participated?: unknown }
    | undefined;
  return thread?.current_user_participated === true;
};

/**
 * The people a thread record knows took part. Records from `buildThreadRecord` carry everyone the
 * client saw: the root's sender, every loaded reply's sender, the writers the room timeline and
 * the read replies (`threadWriters`) show, the newest reply's sender, and the current user when
 * the server says they took part. Other records offer only their participant avatars and last
 * sender.
 */
export const getThreadRecordPeopleIds = (record: ThreadRecord): readonly string[] => {
  const { peopleIds, participantIds, replyParticipantIds, lastSenderId } = record.presentation;
  return (
    peopleIds ?? collectThreadPeopleIds(lastSenderId, [...participantIds, ...replyParticipantIds])
  );
};

/** Whether any of `people` took part in the thread; no selection keeps every thread. */
export const matchesThreadPeopleFilter = (
  record: ThreadRecord,
  people: readonly string[] | undefined
): boolean => {
  if (!people || people.length === 0) return true;
  const participants = getThreadRecordPeopleIds(record);
  return people.some((userId) => participants.includes(userId));
};

/** The selection after checking or unchecking one person, sorted so it stores the same way. */
export const toggleThreadPerson = (
  people: readonly string[] | undefined,
  userId: string
): string[] => {
  const selected = new Set(people);
  if (selected.has(userId)) selected.delete(userId);
  else selected.add(userId);
  return [...selected].sort();
};

export type ThreadPersonActivity = {
  userId: string;
  /** How many of the room's threads this person took part in. */
  threadCount: number;
  /** The newest activity of those threads. */
  lastActivityTs: number;
};

/**
 * Everyone who took part in the given threads, most active first: by the number of threads, then
 * by the newest activity among them. One pass over the records.
 */
export const buildThreadPeopleActivity = (
  records: Iterable<ThreadRecord>
): ThreadPersonActivity[] => {
  const activity = new Map<string, ThreadPersonActivity>();
  for (const record of records) {
    const ts = record.status.lastActivityTs ?? 0;
    getThreadRecordPeopleIds(record).forEach((userId) => {
      const person = activity.get(userId);
      if (person) {
        person.threadCount += 1;
        person.lastActivityTs = Math.max(person.lastActivityTs, ts);
      } else {
        activity.set(userId, { userId, threadCount: 1, lastActivityTs: ts });
      }
    });
  }
  return [...activity.values()].sort(
    (a, b) =>
      b.threadCount - a.threadCount ||
      b.lastActivityTs - a.lastActivityTs ||
      a.userId.localeCompare(b.userId)
  );
};

/** The picker's search: a case-insensitive match on the display name or the Matrix ID. */
export const matchesThreadPersonSearch = (
  person: { userId: string; displayName: string },
  query: string
): boolean => {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  return (
    person.displayName.toLocaleLowerCase().includes(needle) ||
    person.userId.toLocaleLowerCase().includes(needle)
  );
};
