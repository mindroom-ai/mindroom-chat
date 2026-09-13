import { describe, expect, it, vi } from 'vitest';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import type { MatrixEvent } from 'matrix-js-sdk';
import type { Room } from 'matrix-js-sdk/lib/models/room';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import {
  buildCrossRoomThreadIndexEntry,
  createCrossRoomThreadDirtyCoalescer,
  CROSS_ROOM_INDEX_EVICTION_SLACK,
  emptyCrossRoomThreadIndexSnapshot,
  getCrossRoomThreadIndexKey,
  getCrossRoomThreadRootsForEvent,
  isUserInvolvedInThread,
  MAX_CROSS_ROOM_INDEX_ENTRIES,
  removeCrossRoomThreadIndexEntry,
  removeRoomCrossRoomThreadIndexEntries,
  upsertCrossRoomThreadIndexEntry,
} from '../crossRoomThreadIndex';
import type { ThreadTagSnapshot } from '../../threads/threadTagSnapshots';

type EventOptions = {
  id: string;
  sender?: string;
  body?: string;
  ts?: number;
  threadRootId?: string;
  content?: Record<string, unknown>;
  replacingEvent?: () => MatrixEvent | undefined;
};

const makeEvent = ({
  id,
  sender = '@alice:example.org',
  body,
  ts = 1,
  threadRootId,
  content,
  replacingEvent,
}: EventOptions): MatrixEvent =>
  ({
    threadRootId,
    getId: () => id,
    getSender: () => sender,
    getTs: () => ts,
    getType: () => 'm.room.message',
    getContent: () => content ?? { msgtype: 'm.text', body },
    getUnsigned: () => ({}),
    getRelation: () => (threadRootId ? { rel_type: RelationType.Thread } : undefined),
    isRelation: (relationType: string) => relationType === RelationType.Thread && !!threadRootId,
    isRedacted: () => false,
    isRedaction: () => false,
    replacingEvent: () => replacingEvent?.(),
  } as MatrixEvent);

const makeTimelineSet = (events: MatrixEvent[]) => ({
  relations: {
    getChildEventsForEvent: () => undefined,
  },
  getLiveTimeline: () => ({
    getEvents: () => events,
    getNeighbouringTimeline: () => undefined,
  }),
});

const makeThread = (root: MatrixEvent, replies: MatrixEvent[] = []): Thread =>
  ({
    rootEvent: root,
    events: replies,
    timeline: replies,
    length: replies.length,
    lastReply: () => replies.at(-1) ?? null,
    getUnfilteredTimelineSet: () => makeTimelineSet([...replies, root]),
  } as Thread);

const tagSnapshot: ThreadTagSnapshot = {
  content: { tags: { urgent: { set_by: '@alice:example.org', set_at: '2026-05-06T00:00:00Z' } } },
  isResolved: false,
  displayTags: ['urgent'],
};

const makeRoom = ({
  roomId = '!room:example.org',
  name = 'Room',
  root,
  replies = [],
}: {
  roomId?: string;
  name?: string;
  root: MatrixEvent;
  replies?: MatrixEvent[];
}): Room => {
  const thread = makeThread(root, replies);

  return {
    roomId,
    name,
    getThread: (threadRootId: string) => (threadRootId === root.getId() ? thread : null),
    findEventById: (eventId: string) => (eventId === root.getId() ? root : undefined),
    getMember: () => undefined,
    getEventReadUpTo: () => undefined,
    getUnfilteredTimelineSet: () => makeTimelineSet([...replies, root]),
  } as unknown as Room;
};

describe('crossRoomThreadIndex', () => {
  it('builds entries from root preview and summary text only', () => {
    const root = makeEvent({ id: '$root', body: 'Root preview', ts: 100 });
    const reply = makeEvent({
      id: '$reply',
      body: 'reply-only-secret-token',
      ts: 150,
      threadRootId: '$root',
    });
    const room = makeRoom({ root, replies: [reply] });

    const entry = buildCrossRoomThreadIndexEntry({
      room,
      threadRootId: '$root',
      currentUserId: '@bob:example.org',
      summaryInfo: { summaryText: 'Summary text', generatedTs: 120, messageCount: 1 },
      tagSnapshot,
    });

    expect(entry).toBeDefined();
    expect(entry?.searchableText).toContain('root preview');
    expect(entry?.searchableText).toContain('summary text');
    expect(entry?.searchableText).not.toContain('reply-only-secret-token');
  });

  it('computes involvement from root sender, visible reply sender, and direct mentions', () => {
    const ownRoot = makeEvent({ id: '$own-root', sender: '@me:example.org', body: 'Root' });
    expect(
      isUserInvolvedInThread({
        rootEvent: ownRoot,
        thread: makeThread(ownRoot),
        userId: '@me:example.org',
      })
    ).toBe(true);

    const root = makeEvent({ id: '$root', body: 'Root' });
    const ownReply = makeEvent({
      id: '$own-reply',
      sender: '@me:example.org',
      body: 'Reply',
      threadRootId: '$root',
    });
    expect(
      isUserInvolvedInThread({
        rootEvent: root,
        thread: makeThread(root, [ownReply]),
        userId: '@me:example.org',
      })
    ).toBe(true);

    const mentionedReply = makeEvent({
      id: '$mention',
      body: 'No body scan needed',
      threadRootId: '$root',
      content: { 'm.mentions': { user_ids: ['@me:example.org'] } },
    });
    expect(
      isUserInvolvedInThread({
        rootEvent: root,
        thread: makeThread(root, [mentionedReply]),
        userId: '@me:example.org',
      })
    ).toBe(true);

    const roomMention = makeEvent({
      id: '$room-mention',
      body: 'Room mention',
      threadRootId: '$root',
      content: { 'm.mentions': { room: true, user_ids: ['@me:example.org'] } },
    });
    expect(
      isUserInvolvedInThread({
        rootEvent: root,
        thread: makeThread(root, [roomMention]),
        userId: '@me:example.org',
      })
    ).toBe(true);
  });

  it('computes direct mention involvement from effective replacement content', () => {
    const root = makeEvent({ id: '$root', body: 'Root' });
    let latestEdit: MatrixEvent | undefined;
    const reply = makeEvent({
      id: '$reply',
      body: 'Reply',
      threadRootId: '$root',
      replacingEvent: () => latestEdit,
    });

    expect(
      isUserInvolvedInThread({
        rootEvent: root,
        thread: makeThread(root, [reply]),
        userId: '@me:example.org',
      })
    ).toBe(false);

    latestEdit = makeEvent({
      id: '$edit-add',
      content: {
        msgtype: 'm.text',
        body: '* Reply',
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$reply' },
        'm.mentions': { user_ids: [] },
        'm.new_content': {
          msgtype: 'm.text',
          body: 'Reply @me',
          'm.mentions': { user_ids: ['@me:example.org'] },
        },
      },
    });

    expect(
      isUserInvolvedInThread({
        rootEvent: root,
        thread: makeThread(root, [reply]),
        userId: '@me:example.org',
      })
    ).toBe(true);

    latestEdit = makeEvent({
      id: '$edit-remove',
      content: {
        msgtype: 'm.text',
        body: '* Reply @me',
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$reply' },
        'm.mentions': { user_ids: ['@me:example.org'] },
        'm.new_content': {
          msgtype: 'm.text',
          body: 'Reply without mention',
        },
      },
    });

    expect(
      isUserInvolvedInThread({
        rootEvent: root,
        thread: makeThread(root, [reply]),
        userId: '@me:example.org',
      })
    ).toBe(false);
  });

  it('reads direct mentions from replacement wrapper new_content when the wrapper is enumerated', () => {
    const root = makeEvent({ id: '$root', body: 'Root' });
    const replyEdit = makeEvent({
      id: '$reply-edit',
      body: '* Reply',
      threadRootId: '$root',
      content: {
        msgtype: 'm.text',
        body: '* Reply',
        'm.relates_to': { rel_type: RelationType.Replace, event_id: '$reply' },
        'm.mentions': { user_ids: [] },
        'm.new_content': {
          msgtype: 'm.text',
          body: 'Reply @me',
          'm.mentions': { user_ids: ['@me:example.org'] },
        },
      },
    });

    expect(
      isUserInvolvedInThread({
        rootEvent: root,
        thread: makeThread(root, [replyEdit]),
        userId: '@me:example.org',
      })
    ).toBe(true);
  });

  it('upserts, removes, removes rooms, and bumps versions only when state changes', () => {
    const root = makeEvent({ id: '$root', body: 'Root' });
    const entry = buildCrossRoomThreadIndexEntry({
      room: makeRoom({ root }),
      threadRootId: '$root',
      tagSnapshot,
    });
    expect(entry).toBeDefined();

    const inserted = upsertCrossRoomThreadIndexEntry(emptyCrossRoomThreadIndexSnapshot(), entry!);
    expect(inserted.version).toBe(1);
    expect(
      inserted.entries.get(getCrossRoomThreadIndexKey('!room:example.org', '$root'))
    ).toBeDefined();

    const removed = removeCrossRoomThreadIndexEntry(inserted, '!room:example.org', '$root');
    expect(removed.version).toBe(2);
    expect(removed.entries.size).toBe(0);

    expect(removeCrossRoomThreadIndexEntry(removed, '!room:example.org', '$root')).toBe(removed);

    const roomA = upsertCrossRoomThreadIndexEntry(inserted, {
      ...entry!,
      key: getCrossRoomThreadIndexKey('!other:example.org', '$other'),
      roomId: '!other:example.org',
      threadRootId: '$other',
    });
    const roomRemoved = removeRoomCrossRoomThreadIndexEntries(roomA, '!room:example.org');
    expect(roomRemoved.entries.size).toBe(1);
    expect(roomRemoved.entries.values().next().value.roomId).toBe('!other:example.org');
  });

  it('indexes thread roots by root and visible reply event ids', () => {
    const root = makeEvent({ id: '$root', body: 'Root' });
    const reply = makeEvent({
      id: '$reply',
      body: 'Reply',
      threadRootId: '$root',
    });
    const room = makeRoom({ root, replies: [reply] });
    const entry = buildCrossRoomThreadIndexEntry({
      room,
      threadRootId: '$root',
      tagSnapshot,
    });
    expect(entry).toBeDefined();

    const inserted = upsertCrossRoomThreadIndexEntry(emptyCrossRoomThreadIndexSnapshot(), entry!);
    expect(getCrossRoomThreadRootsForEvent(inserted, room.roomId, '$root')).toEqual(['$root']);
    expect(getCrossRoomThreadRootsForEvent(inserted, room.roomId, '$reply')).toEqual(['$root']);

    const removed = removeCrossRoomThreadIndexEntry(inserted, room.roomId, '$root');
    expect(getCrossRoomThreadRootsForEvent(removed, room.roomId, '$root')).toEqual([]);
    expect(getCrossRoomThreadRootsForEvent(removed, room.roomId, '$reply')).toEqual([]);
  });

  it('batch-evicts oldest entries only after the eviction slack is exceeded', () => {
    let snapshot = emptyCrossRoomThreadIndexSnapshot();
    const root = makeEvent({ id: '$root', body: 'Root' });
    const entry = buildCrossRoomThreadIndexEntry({
      room: makeRoom({ root }),
      threadRootId: '$root',
      tagSnapshot,
    });
    expect(entry).toBeDefined();

    for (let index = 0; index < MAX_CROSS_ROOM_INDEX_ENTRIES; index += 1) {
      snapshot = upsertCrossRoomThreadIndexEntry(snapshot, {
        ...entry!,
        key: getCrossRoomThreadIndexKey(`!room${index}:example.org`, `$root${index}`),
        roomId: `!room${index}:example.org`,
        threadRootId: `$root${index}`,
        lastActivityTs: index,
      });
    }

    snapshot = upsertCrossRoomThreadIndexEntry(snapshot, {
      ...entry!,
      key: getCrossRoomThreadIndexKey(
        `!room${MAX_CROSS_ROOM_INDEX_ENTRIES}:example.org`,
        `$root${MAX_CROSS_ROOM_INDEX_ENTRIES}`
      ),
      roomId: `!room${MAX_CROSS_ROOM_INDEX_ENTRIES}:example.org`,
      threadRootId: `$root${MAX_CROSS_ROOM_INDEX_ENTRIES}`,
      lastActivityTs: MAX_CROSS_ROOM_INDEX_ENTRIES,
    });

    expect(snapshot.entries.size).toBe(MAX_CROSS_ROOM_INDEX_ENTRIES + 1);
    expect(snapshot.entries.has(getCrossRoomThreadIndexKey('!room0:example.org', '$root0'))).toBe(
      true
    );

    for (
      let index = MAX_CROSS_ROOM_INDEX_ENTRIES + 1;
      index <= MAX_CROSS_ROOM_INDEX_ENTRIES + CROSS_ROOM_INDEX_EVICTION_SLACK;
      index += 1
    ) {
      snapshot = upsertCrossRoomThreadIndexEntry(snapshot, {
        ...entry!,
        key: getCrossRoomThreadIndexKey(`!room${index}:example.org`, `$root${index}`),
        roomId: `!room${index}:example.org`,
        threadRootId: `$root${index}`,
        lastActivityTs: index,
      });
    }

    expect(snapshot.entries.size).toBe(MAX_CROSS_ROOM_INDEX_ENTRIES);
    expect(snapshot.entries.has(getCrossRoomThreadIndexKey('!room0:example.org', '$root0'))).toBe(
      false
    );
    expect(
      snapshot.entries.has(
        getCrossRoomThreadIndexKey(
          `!room${CROSS_ROOM_INDEX_EVICTION_SLACK}:example.org`,
          `$root${CROSS_ROOM_INDEX_EVICTION_SLACK}`
        )
      )
    ).toBe(false);
    expect(
      snapshot.entries.has(
        getCrossRoomThreadIndexKey(
          `!room${CROSS_ROOM_INDEX_EVICTION_SLACK + 1}:example.org`,
          `$root${CROSS_ROOM_INDEX_EVICTION_SLACK + 1}`
        )
      )
    ).toBe(true);
  });

  it('coalesces dirty keys into one scheduled flush', () => {
    const callbacks: Array<() => void> = [];
    const flush = vi.fn();
    const coalescer = createCrossRoomThreadDirtyCoalescer(flush, (callback) =>
      callbacks.push(callback)
    );

    coalescer.enqueueDirty('a');
    coalescer.enqueueDirty('b');
    coalescer.enqueueDirty('a');

    expect(callbacks).toHaveLength(1);
    callbacks[0]();

    expect(flush).toHaveBeenCalledTimes(1);
    expect(flush).toHaveBeenCalledWith(['a', 'b']);
  });
});
