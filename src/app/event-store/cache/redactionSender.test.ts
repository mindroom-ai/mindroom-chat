import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionId } from '../../matrix/session/sessions';
import { createEngineWriteThrough } from '../engine/engineWriteThrough';
import type { EngineLiveEventMeta } from '../engine/types';
import { resetCacheHealthForTesting } from './cacheHealth';
import { loadCachedRoomEvent, resetCacheStoreForTesting } from './db';
import { persistRoomEventCacheSnapshot } from './eventRepository';

// A redaction its sender may not make removes nothing from the event cache either: the room keeps
// it without a target (matrixSdkRedactionSender.test.ts), so the cache keeps the event as it was.

const ROOM = '!room:example.org';
const AUTHOR = '@author:example.org';
const OTHER = '@other:example.org';
const MODERATOR = '@moderator:example.org';

const raw = (extra: Partial<IEvent>): Partial<IEvent> => ({
  room_id: ROOM,
  sender: AUTHOR,
  origin_server_ts: 1,
  type: 'm.room.message',
  ...extra,
});

const edit: Partial<IEvent> = raw({
  event_id: '$edit',
  origin_server_ts: 2,
  content: {
    msgtype: 'm.text',
    body: '* The forklift is back.',
    'm.new_content': { msgtype: 'm.text', body: 'The forklift is back.' },
    'm.relates_to': { rel_type: 'm.replace', event_id: '$message' },
  },
});

const message = (unsigned = {}) =>
  raw({
    event_id: '$message',
    content: { msgtype: 'm.text', body: 'The forklift is charged.' },
    unsigned,
  });

const redaction = (redacts: string, sender: string) =>
  raw({
    event_id: `$redaction-${redacts}`,
    sender,
    origin_server_ts: 5,
    type: 'm.room.redaction',
    redacts,
    content: { redacts },
  });

const state = (type: string, stateKey: string, content: Record<string, unknown>) =>
  raw({ event_id: `$${type}-${stateKey}`, type, state_key: stateKey, content });

const timeline: EngineLiveEventMeta = {
  kind: 'timeline',
  roomId: ROOM,
  liveEvent: true,
  toStartOfTimeline: false,
};

/** A room where the moderator alone may redact other members' events, saved as events arrive. */
const savedRoom = () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: AUTHOR });
  const room = new Room(ROOM, mx, AUTHOR, { timelineSupport: true });
  const map = mx.getEventMapper();
  room.currentState.setStateEvents(
    [
      state('m.room.create', '', { creator: AUTHOR, room_version: '10' }),
      ...[AUTHOR, OTHER, MODERATOR].map((userId) =>
        state('m.room.member', userId, { membership: 'join' })
      ),
      state('m.room.power_levels', '', { users: { [MODERATOR]: 50 }, redact: 50 }),
    ].map(map)
  );
  const sessionId = createSessionId(mx.getHomeserverUrl(), AUTHOR);
  const writes: Promise<unknown>[] = [];
  const writeThrough = createEngineWriteThrough({
    sessionId,
    persist: (_room, events) => {
      writes.push(persistRoomEventCacheSnapshot({ sessionId, room, events }).write);
    },
  });
  const arrive = async (event: Partial<IEvent>) => {
    const mapped: MatrixEvent = map(event);
    await room.addLiveEvents([mapped], { addToState: false });
    writeThrough.handleLiveEvent(mapped, room, timeline);
    await Promise.all(writes.splice(0));
  };
  const cached = async () => (await loadCachedRoomEvent(sessionId, ROOM, '$message'))!;
  return { room, arrive, cached };
};

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
  resetCacheStoreForTesting();
  resetCacheHealthForTesting();
});
afterEach(() => {
  resetCacheStoreForTesting();
});

describe('the event cache, after a redaction by someone who may not redact the event', () => {
  it('keeps the message another member redacts', async () => {
    const { room, arrive, cached } = savedRoom();
    await arrive(message());

    await arrive(redaction('$message', OTHER));

    expect(room.findEventById('$message')!.isRedacted()).toBe(false);
    expect((await cached()).content).toEqual({
      msgtype: 'm.text',
      body: 'The forklift is charged.',
    });
  });

  it('keeps the edit bundled with the message that another member redacts', async () => {
    const { arrive, cached } = savedRoom();
    await arrive(message({ 'm.relations': { 'm.replace': edit } }));

    await arrive(redaction('$edit', OTHER));

    expect((await cached()).unsigned?.['m.relations']?.['m.replace']?.event_id).toBe('$edit');
  });

  it('drops the message a moderator redacts', async () => {
    const { arrive, cached } = savedRoom();
    await arrive(message());

    await arrive(redaction('$message', MODERATOR));

    expect((await cached()).content).toEqual({});
  });
});
