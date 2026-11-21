import 'fake-indexeddb/auto';
import { createClient, Room, type MatrixEvent } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { planVoiceTranscripts } from '../../messages/voiceTranscripts';
import { deleteCacheStoreDb } from './db';
import { putLegacyRows } from './db/__tests__/legacyRows';
import {
  createPreferLiveEventMapper,
  loadLatestRoomCacheHydrationSnapshot,
  loadThreadCachedSnapshot,
  serializeRoomCacheEvents,
} from './eventRepository';

const sessionId = 'cache-voice-age';
const roomId = '!room:example.org';
const viewerId = '@person:example.org';

afterEach(async () => {
  vi.useRealTimers();
  await deleteCacheStoreDb(sessionId);
});

it('does not restart the pending voice hint when rebuilding an old cached event', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const mx = createClient({ baseUrl: 'https://example.org', userId: viewerId });
  const room = new Room(roomId, mx, viewerId);
  const root = {
    event_id: '$voice',
    room_id: roomId,
    sender: viewerId,
    type: 'm.room.message',
    origin_server_ts: Date.now() - 60 * 60 * 1000,
    content: {
      msgtype: 'm.audio',
      body: 'voice.ogg',
      url: 'mxc://example.org/voice',
      'org.matrix.msc3245.voice': {},
    },
    unsigned: { age: 50, transaction_id: 'voice-send' },
  };
  await putLegacyRows(sessionId, roomId, {
    events: [{ scope: '', rawEvent: root }],
    roots: [{ scope: root.event_id, rootEvent: root }],
  });

  const mapper = mx.getEventMapper();
  const mapEvent = createPreferLiveEventMapper(room, mapper);
  const roomSnapshot = await loadLatestRoomCacheHydrationSnapshot({
    sessionId,
    roomId,
    limit: 5,
    loadedEvents: [],
    mapEvent,
  });
  const threadSnapshot = await loadThreadCachedSnapshot({
    sessionId,
    roomId,
    threadId: root.event_id,
    limit: 5,
    maxPages: 1,
    mapEvent,
  });
  const pending = (events: MatrixEvent[]) =>
    planVoiceTranscripts({
      events,
      getContent: (event) => event.getContent(),
      trustedAccountIds: new Set<string>(),
      ignored: new Set<string>(),
      revealed: new Set<string>(),
      viewerId,
      expectsAnswer: true,
      isHidden: () => false,
      hasThreadReplies: () => false,
    }).pendingVoiceIds;
  for (const events of [roomSnapshot.events, threadSnapshot?.events ?? []]) {
    expect(events).toHaveLength(1);
    expect(pending(events).size).toBe(0);
    expect(events[0]?.getUnsigned()).toEqual({ transaction_id: 'voice-send' });
  }

  const liveVoice = mapper(root);
  await room.addLiveEvents([liveVoice], { addToState: false });
  expect(mapEvent(roomSnapshot.events[0]!.event)).toBe(liveVoice);
  expect(pending([liveVoice])).toEqual(new Set([root.event_id]));
  expect(serializeRoomCacheEvents(room, [liveVoice])[0]?.unsigned).toEqual({
    transaction_id: 'voice-send',
  });
  expect(liveVoice.getAge()).toBe(50);
});
