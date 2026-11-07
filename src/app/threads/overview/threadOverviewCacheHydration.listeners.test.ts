import { MatrixClient, MatrixEvent, MemoryStore, Room } from 'matrix-js-sdk';
import { ThreadEvent } from 'matrix-js-sdk/lib/models/thread';
import { expect, it, vi } from 'vitest';
import { getBundledThreadPreviews } from '../../event-store/threads/threadBundledPreviews';
import { resolveCachedOverviewUpdate } from './threadOverviewCacheHydration';

const userId = '@alice:example.org';

class OfflineClient extends MatrixClient {
  constructor() {
    super({
      baseUrl: 'https://example.org',
      userId,
      // The event mapper finds rooms through the store; the default one keeps none.
      store: new MemoryStore(),
      fetchFn: vi.fn(() => Promise.reject(new TypeError('Offline'))),
    });
    this.clientOpts = { threadSupport: true };
    this.threadSupportPending = new Promise(() => {});
  }
}

const rawReply = (index: number) => ({
  event_id: `$cached-reply-${index}`,
  room_id: '!room:example.org',
  sender: userId,
  type: 'm.room.message',
  origin_server_ts: 1000 + index,
  content: {
    msgtype: 'm.text',
    body: `Cached reply ${index}`,
    'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
  },
});

it('reads cached pages without leaving their events on the thread (one per visit before)', () => {
  const mx = new OfflineClient();
  const room = new Room('!room:example.org', mx, userId, { timelineSupport: true });
  mx.store.storeRoom(room);
  const root = new MatrixEvent({
    event_id: '$root',
    room_id: room.roomId,
    sender: userId,
    type: 'm.room.message',
    origin_server_ts: 1000,
    content: { msgtype: 'm.text', body: 'A question' },
    unsigned: { 'm.relations': { 'm.thread': { count: 2, current_user_participated: true } } },
  });
  room.processThreadRoots([root], true);
  const thread = room.getThread('$root');
  if (!thread) throw new Error('no thread');
  const listenersBefore = thread.listenerCount(ThreadEvent.Update);

  // Each visit of the room's Compact view reads the thread's cached page again.
  for (let visit = 0; visit < 10; visit += 1) {
    resolveCachedOverviewUpdate({
      rootId: '$root',
      room,
      mapper: mx.getEventMapper(),
      cachedPage: { hasMoreBefore: false, events: [rawReply(1), rawReply(2)] },
      showCompactRoomView: true,
      compactCachedThreadRootBodyMap: new Map(),
      compactThreadRootBodyMap: new Map(),
    });
  }

  expect(thread.listenerCount(ThreadEvent.Update)).toBe(listenersBefore);
});

it('leaves the newer thread summary on the live root when it reads an older cached copy', async () => {
  const mx = new OfflineClient();
  const room = new Room('!room:example.org', mx, userId, { timelineSupport: true });
  mx.store.storeRoom(room);
  const agentId = '@agent:example.org';
  const inThread = (eventId: string, ts: number, content: Record<string, unknown>) => ({
    event_id: eventId,
    room_id: room.roomId,
    sender: agentId,
    type: 'm.room.message',
    origin_server_ts: ts,
    content: { ...content, 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } },
  });
  const placeholder = inThread('$reply', 1100, { msgtype: 'm.text', body: 'Thinking...' });
  const finished = {
    ...placeholder,
    unsigned: {
      'm.relations': {
        'm.replace': {
          event_id: '$edit',
          room_id: room.roomId,
          sender: agentId,
          type: 'm.room.message',
          origin_server_ts: 1200,
          content: {
            msgtype: 'm.text',
            body: '* The release notes are ready.',
            'm.new_content': { msgtype: 'm.text', body: 'The release notes are ready.' },
            'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
          },
        },
      },
    },
  };
  const title = inThread('$title', 1300, {
    msgtype: 'm.notice',
    body: 'Release notes',
    'io.mindroom.thread_summary': { version: 1, summary: 'Release notes' },
  });
  const rootWith = (latest: object, reply: object) => ({
    event_id: '$root',
    room_id: room.roomId,
    sender: userId,
    type: 'm.room.message',
    origin_server_ts: 1000,
    content: { msgtype: 'm.text', body: 'Which fixes go into the release notes?' },
    unsigned: {
      'm.relations': {
        'm.thread': {
          count: 2,
          current_user_participated: true,
          latest_event: latest,
          'io.mindroom.latest_reply': reply,
        },
      },
    },
  });
  // The thread list brought the root as the server has it now: the reply finished, then a title.
  await room.addLiveEvents([new MatrixEvent(rootWith(title, finished))], { addToState: false });
  const previewOfLiveRoot = () =>
    getBundledThreadPreviews(room, room.findEventById('$root')).reply?.getContent().body;
  expect(previewOfLiveRoot()).toBe('The release notes are ready.');

  // The cache saved the root while the reply was still its placeholder.
  resolveCachedOverviewUpdate({
    rootId: '$root',
    room,
    mapper: mx.getEventMapper(),
    cachedPage: { hasMoreBefore: false, events: [rootWith(placeholder, placeholder), placeholder] },
    showCompactRoomView: true,
    compactCachedThreadRootBodyMap: new Map(),
    compactThreadRootBodyMap: new Map(),
  });

  expect(previewOfLiveRoot()).toBe('The release notes are ready.');
});
