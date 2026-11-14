import type { TFunction } from 'i18next';
import { MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildPerTagEventContent,
  buildPerTagStateKey,
  MINDROOM_THREAD_TAGS_EVENT,
  RESOLVED_TAG,
} from '../event-store/threads/threadTags';
import type { CrossRoomThreadIndexEntry } from '../threads/cross-room/crossRoomThreadIndex';
import type { ThreadSignals } from '../threads/cross-room/threadSignals';
import { threadActorName } from '../threads/cross-room/threadText';
import { readCaptureThreads } from './captureThreads';

const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../threads/cross-room/threadSignalsReader', () => ({
  getThreadSignalsReader: () => ({ read: mocks.read }),
}));

const ROOM_ID = '!r:x';
const NOW = 1_000_000;
const QUIET: ThreadSignals = {
  mentionedMe: false,
  newCount: 0,
  newSenderIds: [],
  automation: false,
};

const t = ((key: string) => `t:${key}`) as unknown as TFunction;
const mx = { getSafeUserId: () => '@me:x', getUserId: () => '@me:x' } as unknown as MatrixClient;

const message = (
  id: string,
  content: Record<string, unknown>,
  ts = 500,
  sender = '@alice:x'
): MatrixEvent =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    content,
  });

const stateEvent = (type: string, stateKey: string, content: object, ts = 900): MatrixEvent =>
  new MatrixEvent({
    event_id: `$state-${ts}`,
    room_id: ROOM_ID,
    sender: '@me:x',
    type,
    state_key: stateKey,
    origin_server_ts: ts,
    content,
  });

/** The room's state holding `events`, read as the SDK's room state reads them. */
const roomState = (events: MatrixEvent[]) => ({
  getStateEvents: (type: string, stateKey?: string) =>
    stateKey === undefined
      ? events.filter((event) => event.getType() === type)
      : events.find((event) => event.getType() === type && event.getStateKey() === stateKey) ??
        null,
});

const makeRoom = ({
  timeline = [],
  loaded = [],
  state,
}: { timeline?: MatrixEvent[]; loaded?: MatrixEvent[]; state?: MatrixEvent[] } = {}): Room => {
  const live = state ? roomState(state) : undefined;
  return {
    roomId: ROOM_ID,
    getLiveTimeline: () => ({ getEvents: () => timeline, getState: () => live }),
    getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
    getThread: () => null,
    findEventById: (id: string) => loaded.find((event) => event.getId() === id),
    getMember: () => null,
    membersLoaded: () => true,
  } as unknown as Room;
};

const makeEntry = (
  rootId: string,
  fields: Partial<CrossRoomThreadIndexEntry> = {},
  presentation: Record<string, unknown> = {}
): CrossRoomThreadIndexEntry =>
  ({
    key: `${ROOM_ID}:${rootId}`,
    roomId: ROOM_ID,
    threadRootId: rootId,
    summaryText: '',
    rootPreviewText: `root ${rootId}`,
    threadRecord: { status: { isStreaming: false }, presentation },
    isUnread: false,
    isResolved: false,
    isInvolved: true,
    lastActivityTs: 100,
    generation: 1,
    ...fields,
  } as unknown as CrossRoomThreadIndexEntry);

describe('readCaptureThreads', () => {
  beforeEach(() => {
    mocks.read.mockReset();
    mocks.read.mockReturnValue(QUIET);
  });

  it("keeps only the room's entries, with their title, state and activity time", () => {
    const room = makeRoom();
    const entries = [
      makeEntry('$a', {
        summaryText: 'AI title',
        isUnread: true,
        lastActivityTs: 300,
        threadRecord: { status: { isStreaming: true }, presentation: {} },
      } as Partial<CrossRoomThreadIndexEntry>),
      makeEntry('$b', { isResolved: true, resolvedTs: 250, lastActivityTs: 200 }),
      makeEntry('$other', { roomId: '!elsewhere:x' }),
    ];

    expect(readCaptureThreads(mx, room, entries, t, NOW)).toEqual([
      {
        threadId: '$a',
        title: 'AI title',
        reply: expect.any(Function),
        pinned: false,
        streaming: true,
        needsYou: false,
        unread: true,
        resolved: false,
        ts: 300,
      },
      {
        threadId: '$b',
        title: 'root $b',
        reply: expect.any(Function),
        pinned: false,
        streaming: false,
        needsYou: false,
        unread: false,
        resolved: true,
        resolvedTs: 250,
        ts: 200,
      },
    ]);
    expect(mocks.read).toHaveBeenCalledTimes(2);
    expect(mocks.read).toHaveBeenCalledWith(room, entries[0], '@me:x', NOW);
  });

  it('needs you for a pending approval or a pending question', () => {
    const entries = [makeEntry('$approval'), makeEntry('$question'), makeEntry('$quiet')];
    mocks.read.mockImplementation((_room: Room, entry: CrossRoomThreadIndexEntry) => {
      if (entry.threadRootId === '$approval') return { ...QUIET, pendingApproval: {} };
      if (entry.threadRootId === '$question') return { ...QUIET, pendingQuestion: {} };
      return QUIET;
    });

    const needsYou = readCaptureThreads(mx, makeRoom(), entries, t, NOW).map(
      (thread) => thread.needsYou
    );

    expect(needsYou).toEqual([true, true, false]);
  });

  it("takes the newest reply's whole body when it is a text message", () => {
    const body = 'A long answer. '.repeat(30).trim();
    const room = makeRoom({ loaded: [message('$reply', { msgtype: 'm.text', body })] });
    mocks.read.mockReturnValue({
      ...QUIET,
      lastReply: {
        eventId: '$reply',
        senderId: '@alice:x',
        ts: 90,
        preview: { kind: 'text', text: 'A long answer.' },
      },
    });

    const [thread] = readCaptureThreads(mx, room, [makeEntry('$t')], t, NOW);

    expect(thread?.reply().replyText).toBe(body);
    expect(thread?.reply().replySender).toBe(threadActorName(mx, room, '@alice:x'));
    expect(thread?.reply().replySender).toBe('alice');
  });

  it("cleans the newest reply's body as the previews do: tool calls counted, lines kept", () => {
    const body = '🔧 `shell` [1]\n🔧 `read_file` [2]\nAll **green**.\n\nNext: `deploy`.';
    const room = makeRoom({ loaded: [message('$reply', { msgtype: 'm.text', body })] });
    mocks.read.mockReturnValue({
      ...QUIET,
      lastReply: {
        eventId: '$reply',
        senderId: '@bot:x',
        ts: 90,
        preview: { kind: 'text', text: 'unused' },
      },
    });

    const [thread] = readCaptureThreads(mx, room, [makeEntry('$t')], t, NOW);

    expect(thread?.reply().replyText).toBe(
      '🔧 t:sharedUi.threadPreviews.tools · All green.\n\nNext: deploy.'
    );
    // Copy takes the reply as its sender wrote it.
    expect(thread?.reply().copyText).toBe(body);
  });

  it('says which threads are pinned, from the room state', () => {
    const pinned = new MatrixEvent({
      type: 'm.room.pinned_events',
      state_key: '',
      content: { pinned: ['$t'] },
    });
    const room = {
      ...makeRoom(),
      getLiveTimeline: () => ({
        getEvents: () => [],
        getState: () => ({ getStateEvents: () => pinned }),
      }),
    } as unknown as Room;
    mocks.read.mockReturnValue(QUIET);
    const threads = readCaptureThreads(mx, room, [makeEntry('$t'), makeEntry('$u')], t, NOW);
    expect(threads.map((thread) => thread.pinned)).toEqual([true, false]);
  });

  it("takes the preview's text for a reply that is no text message or is not loaded", () => {
    const room = makeRoom({
      loaded: [message('$image', { msgtype: 'm.image', body: 'cat.png', url: 'mxc://x/y' })],
    });
    mocks.read.mockImplementation((_room: Room, entry: CrossRoomThreadIndexEntry) => ({
      ...QUIET,
      lastReply:
        entry.threadRootId === '$withImage'
          ? { eventId: '$image', senderId: '@bob:x', ts: 90, preview: { kind: 'image' } }
          : {
              eventId: '$missing',
              senderId: '@bob:x',
              ts: 90,
              preview: { kind: 'text', text: 'Short preview' },
            },
    }));

    const threads = readCaptureThreads(
      mx,
      room,
      [makeEntry('$withImage'), makeEntry('$unloaded')],
      t,
      NOW
    );

    expect(
      threads.map((thread) => {
        const { replyText, replySender } = thread.reply();
        return { replyText, replySender };
      })
    ).toEqual([
      { replyText: 't:threadPreview.image', replySender: 'bob' },
      { replyText: 'Short preview', replySender: 'bob' },
    ]);
  });

  it("falls back to the index's reply preview when the signals hold no reply", () => {
    const entry = makeEntry(
      '$t',
      {},
      { latestReplyPreviewText: 'Indexed', lastSenderId: '@carol:x' }
    );

    const [thread] = readCaptureThreads(mx, makeRoom(), [entry], t, NOW);

    expect(thread?.reply().replyText).toBe('Indexed');
    expect(thread?.reply().replySender).toBe('carol');
  });

  it("adds the user's own roots nobody answered from the live timeline, once each", () => {
    const room = makeRoom({
      timeline: [
        message('$indexed', { msgtype: 'm.text', body: 'Already a thread' }, 400, '@me:x'),
        message('$fresh', { msgtype: 'm.text', body: 'Buy milk' }, 600, '@me:x'),
        // Someone else's message nobody answered is no entry of the user's.
        message('$theirs', { msgtype: 'm.text', body: 'Lunch?' }, 700),
        message('$reply', {
          msgtype: 'm.text',
          body: 'In a thread',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$indexed' },
        }),
      ],
    });

    const threads = readCaptureThreads(mx, room, [makeEntry('$indexed')], t, NOW);

    expect(threads.map((thread) => thread.threadId)).toEqual(['$indexed', '$fresh']);
    expect(threads[1]).toEqual({
      threadId: '$fresh',
      title: 'Buy milk',
      reply: expect.any(Function),
      pinned: false,
      streaming: false,
      needsYou: false,
      unread: false,
      resolved: false,
      ts: 600,
    });
  });

  it("reads the resolved tags of the user's roots nobody answered, which a pin keeps open", () => {
    const resolvedTag = (rootId: string) =>
      stateEvent(
        MINDROOM_THREAD_TAGS_EVENT,
        buildPerTagStateKey(rootId, RESOLVED_TAG),
        buildPerTagEventContent('@me:x')
      );
    const room = makeRoom({
      timeline: [
        message('$done', { msgtype: 'm.text', body: 'Done' }, 600, '@me:x'),
        message('$pinned', { msgtype: 'm.text', body: 'Pinned' }, 610, '@me:x'),
        message('$open', { msgtype: 'm.text', body: 'Open' }, 620, '@me:x'),
      ],
      state: [
        resolvedTag('$done'),
        resolvedTag('$pinned'),
        stateEvent('m.room.pinned_events', '', { pinned: ['$pinned'] }, 950),
      ],
    });

    const threads = readCaptureThreads(mx, room, [], t, NOW);

    expect(
      threads.map(({ threadId, pinned, resolved, resolvedTs }) => ({
        threadId,
        pinned,
        resolved,
        resolvedTs,
      }))
    ).toEqual([
      { threadId: '$done', pinned: false, resolved: true, resolvedTs: 900 },
      { threadId: '$pinned', pinned: true, resolved: false, resolvedTs: undefined },
      { threadId: '$open', pinned: false, resolved: false, resolvedTs: undefined },
    ]);
  });
});
