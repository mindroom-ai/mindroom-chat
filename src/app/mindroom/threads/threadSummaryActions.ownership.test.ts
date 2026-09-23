import 'fake-indexeddb/auto';
import { MatrixEvent, type IEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { afterEach, expect, it, vi } from 'vitest';
import { createSessionId } from '../../state/sessions';
import {
  clearRoomCachedContent,
  deleteCacheStoreDb,
  loadCachedThreadSummaries,
} from './cacheStore';
import { clearThreadSummarySharedState, getThreadSummaryStateSnapshot } from './threadSummaryState';
import { saveThreadSummary } from './threadSummaryActions';

const homeserver = 'https://matrix.test';
const userId = '@me:test';
const sessionId = createSessionId(homeserver, userId);
const roomId = '!room:test';
const threadId = '$root';

afterEach(async () => {
  clearThreadSummarySharedState(sessionId);
  await deleteCacheStoreDb(sessionId);
});

it.each(['room clear', 'session removal'] as const)(
  'does not ingest or publish a manual action completing after %s',
  async (action) => {
    const root = new MatrixEvent({
      event_id: threadId,
      room_id: roomId,
      sender: userId,
      origin_server_ts: 1,
      type: 'm.room.message',
      content: { body: 'Root', msgtype: 'm.text' },
    });
    const room = {
      roomId,
      getThread: () => undefined,
      findEventById: (id: string) => (id === threadId ? root : undefined),
      getMyMembership: () => 'join',
      currentState: { maySendEvent: () => true },
    } as unknown as Room;
    let accept!: (event: Partial<IEvent>) => void;
    const sendMessage = vi.fn().mockResolvedValue({ event_id: '$manual' });
    const fetchRoomEvent = vi.fn().mockReturnValue(
      new Promise((resolve) => {
        accept = resolve;
      })
    );
    const mx = {
      getHomeserverUrl: () => homeserver,
      getSafeUserId: () => userId,
      makeTxnId: () => 'manual-summary',
      sendMessage,
      fetchRoomEvent,
    } as unknown as MatrixClient;
    const saving = saveThreadSummary(mx, room, threadId, 'Pending manual title');
    await vi.waitFor(() => expect(fetchRoomEvent).toHaveBeenCalledOnce());
    if (action === 'room clear') await clearRoomCachedContent(sessionId, roomId);
    else clearThreadSummarySharedState(sessionId);
    accept({
      event_id: '$manual',
      room_id: roomId,
      sender: userId,
      type: 'm.room.message',
      origin_server_ts: 20,
      content: sendMessage.mock.calls[0][2],
    });
    await saving;
    expect((await loadCachedThreadSummaries(sessionId, roomId)).has(threadId)).toBe(false);
    expect(getThreadSummaryStateSnapshot(sessionId, roomId).has(threadId)).toBe(false);
  }
);
