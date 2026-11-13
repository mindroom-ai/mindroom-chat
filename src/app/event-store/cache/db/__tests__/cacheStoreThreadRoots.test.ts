import 'fake-indexeddb/auto';
import type { IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  loadCachedThreadEvent,
  loadCachedThreadRootsForRoom,
  loadLatestCachedThreadEvents,
  loadLatestCachedThreadEventsBatch,
  deleteCacheStoreDb,
  resetCacheStoreForTesting,
  saveThreadEventsToCache,
} from '..';

// A root's thread summary is the server's word at the moment the page read it. A thread list read
// while an agent streams keeps the reply's placeholder in it; the page then saves the reply's
// finishing edit and the thread's title notice with the thread's events, but nothing rewrites the
// saved root. A reload restored the old summary, so the card streamed again (and asked the server
// about it) although the page held the finished reply.

const SESSION_ID = 'thread-roots-session';
const ROOM_ID = '!load:example.org';
const ROOT_ID = '$root';
const REPLY_ID = '$reply';
const PERSON = '@person:example.org';
const AGENT = '@mindroom_planner:example.org';

const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: ROOT_ID } };

const reply = (status: string, edit?: Partial<IEvent>): Partial<IEvent> => ({
  event_id: REPLY_ID,
  room_id: ROOM_ID,
  sender: AGENT,
  type: 'm.room.message',
  origin_server_ts: 2_000,
  content: {
    msgtype: 'm.text',
    body: 'Thinking...',
    'io.mindroom.stream_status': status,
    ...inThread,
  },
  unsigned: edit ? { 'm.relations': { 'm.replace': edit } } : {},
});

const edit = (eventId: string, status: string, ts: number): Partial<IEvent> => ({
  event_id: eventId,
  room_id: ROOM_ID,
  sender: AGENT,
  type: 'm.room.message',
  origin_server_ts: ts,
  content: {
    msgtype: 'm.text',
    body: `* ${status} text`,
    'io.mindroom.stream_status': status,
    'm.new_content': {
      msgtype: 'm.text',
      body: `${status} text`,
      'io.mindroom.stream_status': status,
    },
    'm.relates_to': { rel_type: 'm.replace', event_id: REPLY_ID },
  },
});

const notice = (eventId: string, ts: number): Partial<IEvent> => ({
  event_id: eventId,
  room_id: ROOM_ID,
  sender: AGENT,
  type: 'm.room.message',
  origin_server_ts: ts,
  content: { msgtype: 'm.notice', body: 'Release notes', ...inThread },
});

const root = (latest: Partial<IEvent>, count: number): Partial<IEvent> => ({
  event_id: ROOT_ID,
  room_id: ROOM_ID,
  sender: PERSON,
  type: 'm.room.message',
  origin_server_ts: 1_000,
  content: { msgtype: 'm.text', body: 'Which fixes go into the release notes?' },
  unsigned: {
    'm.relations': {
      'm.thread': { latest_event: latest, count, current_user_participated: true },
    },
  },
});

const summaryOf = async () => {
  const roots = await loadCachedThreadRootsForRoom(SESSION_ID, ROOM_ID);
  expect(roots).toHaveLength(1);
  return roots[0]?.rootEvent.unsigned?.['m.relations']?.['m.thread'] as
    | { latest_event: Partial<IEvent>; count: number; current_user_participated: boolean }
    | undefined;
};

const statusOf = (event: Partial<IEvent> | undefined) => {
  const replacement = event?.unsigned?.['m.relations']?.['m.replace'] as
    | Partial<IEvent>
    | undefined;
  const newContent = replacement?.content?.['m.new_content'] as Record<string, unknown> | undefined;
  return newContent?.['io.mindroom.stream_status'] ?? event?.content?.['io.mindroom.stream_status'];
};

const save = (events: Partial<IEvent>[], rootEvent?: Partial<IEvent>) =>
  saveThreadEventsToCache(SESSION_ID, ROOM_ID, ROOT_ID, events, rootEvent);

describe('cached thread roots', () => {
  beforeEach(async () => {
    resetCacheStoreForTesting();
    await deleteCacheStoreDb(SESSION_ID);
  });
  afterEach(async () => {
    await deleteCacheStoreDb(SESSION_ID);
    resetCacheStoreForTesting();
  });

  it('take the thread’s newest cached event over an older summary', async () => {
    // The list was read while the reply was its placeholder; the reply then finished and the
    // thread got its title, both saved with the thread's events.
    await save([], root(reply('pending'), 1));
    await save([reply('pending', edit('$done', 'completed', 4_000)), notice('$title', 5_000)]);

    const summary = await summaryOf();
    expect(summary?.latest_event.event_id).toBe('$title');
    expect(summary?.count).toBe(2);
    expect(summary?.current_user_participated).toBe(true);
  });

  it('take the newest edit the cache holds for the summary’s own latest reply', async () => {
    await save([], root(reply('pending', edit('$step', 'streaming', 3_000)), 1));
    await save([reply('pending', edit('$done', 'completed', 4_000))]);

    const summary = await summaryOf();
    expect(summary?.latest_event.event_id).toBe(REPLY_ID);
    expect(statusOf(summary?.latest_event)).toBe('completed');
    expect(summary?.count).toBe(1);
  });

  it('keep a summary newer than anything the cache holds for the thread', async () => {
    await save([reply('pending', edit('$step', 'streaming', 3_000))]);
    await save([], root(notice('$title', 5_000), 2));

    const summary = await summaryOf();
    expect(summary?.latest_event.event_id).toBe('$title');
    expect(summary?.count).toBe(2);
  });
});

// A thread is its root's room's. An earlier version could save another room's thread under a room
// (a render that paired a room with the timeline of the room shown before it): that room listed
// the thread again after every reload, and opened it with the root and none of its replies.
describe('a cached thread whose root is another room’s', () => {
  const OTHER_ROOM_ID = '!other:example.org';
  const otherRoot = (): Partial<IEvent> => ({
    ...root(reply('completed'), 1),
    room_id: OTHER_ROOM_ID,
  });

  beforeEach(async () => {
    resetCacheStoreForTesting();
    await deleteCacheStoreDb(SESSION_ID);
  });
  afterEach(async () => {
    await deleteCacheStoreDb(SESSION_ID);
    resetCacheStoreForTesting();
  });

  it('is not a thread of the room it was saved under', async () => {
    await save([], otherRoot());

    expect(await loadCachedThreadRootsForRoom(SESSION_ID, ROOM_ID)).toEqual([]);
    expect(await loadCachedThreadEvent(SESSION_ID, ROOM_ID, ROOT_ID, ROOT_ID)).toBeUndefined();
    expect((await loadLatestCachedThreadEvents(SESSION_ID, ROOM_ID, ROOT_ID, 10)).rootEvent).toBe(
      undefined
    );
    const batch = await loadLatestCachedThreadEventsBatch(SESSION_ID, ROOM_ID, [ROOT_ID], 10);
    expect(batch.get(ROOT_ID)?.rootEvent).toBeUndefined();
  });

  it('keeps a root saved without its room, as older rows were', async () => {
    const { room_id: _roomId, ...withoutRoom } = root(reply('completed'), 1);
    await save([], withoutRoom);

    expect(await loadCachedThreadRootsForRoom(SESSION_ID, ROOM_ID)).toHaveLength(1);
    expect((await loadCachedThreadEvent(SESSION_ID, ROOM_ID, ROOT_ID, ROOT_ID))?.event_id).toBe(
      ROOT_ID
    );
  });
});
