import {
  ClientEvent,
  createClient,
  MatrixEvent,
  RelationType,
  Room,
  type IEvent,
} from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadCachedRoomEvent, loadCachedThreadEvent } from '../cache/eventRepository';
import { findPendingCachedReplies, restoreCachedReplies } from './restoreCachedReplies';

vi.mock('../cache/eventRepository', async (original) => ({
  ...(await original<typeof import('../cache/eventRepository')>()),
  loadCachedRoomEvent: vi.fn(),
  loadCachedThreadEvent: vi.fn(),
}));

const ROOM_ID = '!room:example.org';
const VIEWER = '@me:example.org';
const AGENT = '@mindroom_helper:example.org';
const ROOT_ID = '$root';
const REPLY_ID = '$reply';

const replyEvent = (overrides: Partial<IEvent> = {}): Partial<IEvent> => ({
  event_id: REPLY_ID,
  room_id: ROOM_ID,
  sender: AGENT,
  type: 'm.room.message',
  origin_server_ts: 1_000,
  content: {
    msgtype: 'm.text',
    body: 'Thinking...',
    'io.mindroom.stream_status': 'pending',
    'm.relates_to': { rel_type: RelationType.Thread, event_id: ROOT_ID },
  },
  ...overrides,
});

const editEvent = (
  eventId: string,
  body: string,
  status: string,
  ts: number,
  sender = AGENT
): Partial<IEvent> => ({
  event_id: eventId,
  room_id: ROOM_ID,
  sender,
  type: 'm.room.message',
  origin_server_ts: ts,
  content: {
    msgtype: 'm.text',
    body: `* ${body}`,
    'io.mindroom.stream_status': status,
    'm.new_content': { msgtype: 'm.text', body, 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: RelationType.Replace, event_id: REPLY_ID },
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCachedRoomEvent).mockResolvedValue(undefined);
  vi.mocked(loadCachedThreadEvent).mockResolvedValue(undefined);
});

describe('findPendingCachedReplies', () => {
  it('returns unfinished streaming replies and skips ones finished by same-sender edits', () => {
    const pending = replyEvent({ event_id: '$pending' });
    const finishedTimeline = replyEvent({ event_id: REPLY_ID });
    const finishedBundled = replyEvent({
      event_id: '$bundled_done',
      unsigned: {
        'm.relations': {
          'm.replace': editEvent('$bd_edit', 'Done', 'completed', 2_000) as Record<string, unknown>,
        },
      },
    });
    const forgedFinish = replyEvent({ event_id: '$forged' });
    const result = findPendingCachedReplies({
      joinRooms: {
        [ROOM_ID]: {
          _timeline: [
            { event: pending },
            { event: finishedTimeline },
            { event: editEvent('$done', 'Finished', 'completed', 2_000) },
            { event: finishedBundled },
            { event: forgedFinish },
            {
              event: {
                ...editEvent('$forged_edit', 'Fake', 'completed', 2_000, '@mallory:example.org'),
                content: {
                  ...editEvent('$forged_edit', 'Fake', 'completed', 2_000, '@mallory:example.org')
                    .content,
                  'm.relates_to': { rel_type: RelationType.Replace, event_id: '$forged' },
                },
              },
            },
          ],
        },
      },
    });
    expect(result).toEqual([
      { roomId: ROOM_ID, eventId: '$pending', threadId: ROOT_ID },
      { roomId: ROOM_ID, eventId: '$forged', threadId: ROOT_ID },
    ]);
  });
});

describe('restoreCachedReplies', () => {
  it('applies newer cached reply text over a restored placeholder on saved-sync replay', async () => {
    const mx = createClient({
      baseUrl: 'https://example.org',
      userId: VIEWER,
      timelineSupport: true,
    });
    const room = new Room(ROOM_ID, mx, VIEWER, { timelineSupport: true });
    const restored = new MatrixEvent(replyEvent());
    await room.addLiveEvents([restored], { addToState: false });
    vi.spyOn(mx, 'getRoom').mockImplementation((id) => (id === ROOM_ID ? room : null));
    (mx.store as unknown as { backend: { syncAccumulator: unknown } }).backend = {
      syncAccumulator: { joinRooms: { [ROOM_ID]: { _timeline: [{ event: replyEvent() }] } } },
    };

    const cachedNewer = replyEvent({
      unsigned: {
        'm.relations': {
          'm.replace': editEvent('$cached_edit', 'Progress so far', 'streaming', 5_000) as Record<
            string,
            unknown
          >,
        },
      },
    });
    vi.mocked(loadCachedThreadEvent).mockResolvedValue(cachedNewer as never);

    await restoreCachedReplies(mx);
    mx.emit(ClientEvent.Sync, 'PREPARED' as never, null, { fromCache: true });

    const replacement = restored.replacingEvent();
    expect(replacement?.getId()).toBe('$cached_edit');
    expect((replacement?.getContent()['m.new_content'] as { body?: string })?.body).toBe(
      'Progress so far'
    );
  });

  it('never rejects when cache reads fail', async () => {
    const mx = createClient({
      baseUrl: 'https://example.org',
      userId: VIEWER,
      timelineSupport: true,
    });
    (mx.store as unknown as { backend: { syncAccumulator: unknown } }).backend = {
      syncAccumulator: { joinRooms: { [ROOM_ID]: { _timeline: [{ event: replyEvent() }] } } },
    };
    vi.mocked(loadCachedRoomEvent).mockRejectedValue(new Error('idb closed'));
    vi.mocked(loadCachedThreadEvent).mockRejectedValue(new Error('idb closed'));

    await expect(restoreCachedReplies(mx)).resolves.toBeUndefined();
  });
});
