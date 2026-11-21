import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RelationType } from 'matrix-js-sdk/lib/@types/event';
import { createClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import type { Thread } from 'matrix-js-sdk/lib/models/thread';
import {
  applyCrossRoomThreadIndexBatch,
  areCrossRoomThreadIndexEntriesEquivalent,
  buildCrossRoomThreadIndexEntry,
  createCrossRoomThreadDirtyCoalescer,
  CROSS_ROOM_INDEX_EVICTION_SLACK,
  emptyCrossRoomThreadIndexSnapshot,
  getCrossRoomThreadIndexKey,
  getCrossRoomThreadRootsForEvent,
  hasAgentPostForUser,
  isUserInvolvedInThread,
  MAX_CROSS_ROOM_INDEX_ENTRIES,
  removeCrossRoomThreadIndexEntry,
  removeRoomCrossRoomThreadIndexEntries,
  type CrossRoomThreadIndexEntry,
  type CrossRoomThreadIndexSnapshot,
} from '../crossRoomThreadIndex';
import type { ThreadTagSnapshot } from '../../tags/threadTagSnapshots';
import { matchesEnum } from '../../../lib/matchesEnum';
import { ORIGINAL_SENDER_KEY } from '../../../matrix/protocol/originalSender';
import { groupThreads } from '../../page/threadGroups';
import { readThreadSignals } from '../threadSignals';
import { getBundledThreadPreviews } from '../../../event-store/threads/threadBundledPreviews';
import { hasLoadedEveryThreadReply } from '../../../event-store/threads/threadUtils';

const upsert = (snapshot: CrossRoomThreadIndexSnapshot, entry: CrossRoomThreadIndexEntry) =>
  applyCrossRoomThreadIndexBatch(snapshot, { upserts: [entry] });

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
    isRelation: (relationType: string) =>
      matchesEnum(relationType, RelationType.Thread) && !!threadRootId,
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
  } as unknown as Thread);

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
    currentState: { getStateEvents: () => [] },
    getThread: (threadRootId: string) => (threadRootId === root.getId() ? thread : null),
    findEventById: (eventId: string) => (eventId === root.getId() ? root : undefined),
    getMember: () => undefined,
    getEventReadUpTo: () => undefined,
    getLiveTimeline: () => ({ getState: () => ({ getStateEvents: () => undefined }) }),
    getUnfilteredTimelineSet: () => makeTimelineSet([...replies, root]),
  } as unknown as Room;
};

describe('thread involvement and agent attribution with SDK events', () => {
  const roomId = '!room:example.org';
  const userId = '@me:example.org';
  const otherId = '@someone:example.org';
  const agentId = '@mindroom_helper:example.org';
  const attribution = { [ORIGINAL_SENDER_KEY]: userId };
  const message = (eventId: string, content: Record<string, unknown> = {}, sender = otherId) => ({
    event_id: eventId,
    room_id: roomId,
    type: 'm.room.message',
    sender,
    origin_server_ts: 1,
    content: { msgtype: 'm.text', body: 'Example message', ...content },
  });
  const reply = (content: Record<string, unknown> = {}, sender = otherId) =>
    message(
      '$reply',
      { ...content, 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } },
      sender
    );
  const createThread = (root: MatrixEvent, events: MatrixEvent[] = []) => {
    const client = createClient({ baseUrl: 'https://example.org', userId });
    vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
    const room = new Room(roomId, client, userId, { timelineSupport: true });
    return room.createThread('$root', root, events, false);
  };
  const title = {
    ...reply(
      {
        msgtype: 'm.notice',
        body: 'Example title',
        'io.mindroom.thread_summary': { version: 1, summary: 'Example title' },
      },
      agentId
    ),
    event_id: '$title',
    origin_server_ts: 2,
  };
  const bundledRoot = (
    count: number,
    participated = true,
    latest = reply(),
    latestReply?: ReturnType<typeof reply>
  ) =>
    new MatrixEvent({
      ...message('$root'),
      unsigned: {
        'm.relations': {
          'm.thread': {
            count,
            current_user_participated: participated,
            latest_event: latest,
            ...(latestReply && { 'io.mindroom.latest_reply': latestReply }),
          },
        },
      },
    } satisfies IEvent);

  it('keeps an attributed agent-only thread in Automations, not Following', () => {
    const root = new MatrixEvent(message('$root', attribution, agentId));
    const thread = createThread(root, [root, new MatrixEvent(reply({}, agentId))]);
    const { room } = thread;
    const entry = buildCrossRoomThreadIndexEntry({
      room,
      threadRootId: thread.id,
      currentUserId: userId,
    })!;
    const signals = readThreadSignals(room, thread.id, userId, 10_000);
    const items = [{ entry, signals }];

    expect(signals.automation).toBe(true);
    expect(entry.isInvolved).toBe(false);
    expect(groupThreads(items, 'all', userId, '', 10_000)).toEqual([{ id: 'automations', items }]);
    expect(groupThreads(items, 'following', userId, '', 10_000)).toEqual([]);
    expect(entry.hasAgentPostForUser).toBe(true);
  });

  it('counts a visible agent reply posted on behalf of the user', () => {
    const rootEvent = new MatrixEvent(message('$root'));
    const thread = createThread(rootEvent, [new MatrixEvent(reply(attribution, agentId))]);
    expect(hasAgentPostForUser({ rootEvent, thread, userId })).toBe(true);
  });

  it('does not count attribution to a different user', () => {
    const forSomeoneElse = { [ORIGINAL_SENDER_KEY]: '@requester:example.org' };
    const rootEvent = new MatrixEvent(message('$root', forSomeoneElse, agentId));
    const thread = createThread(rootEvent, [new MatrixEvent(reply(forSomeoneElse, agentId))]);
    expect(hasAgentPostForUser({ rootEvent, thread, userId })).toBe(false);
  });

  it.each([otherId, '@mindroom_helper:elsewhere.example'])(
    'ignores attribution from %s',
    (sender) => {
      const rootEvent = new MatrixEvent(message('$root', attribution, sender));
      const thread = createThread(rootEvent, [new MatrixEvent(reply(attribution, sender))]);
      expect(hasAgentPostForUser({ rootEvent, thread, userId })).toBe(false);
    }
  );

  it('keeps attribution through an edit but loses it on redaction', () => {
    const rootEvent = new MatrixEvent(message('$root'));
    const agentReply = new MatrixEvent(reply(attribution, agentId));
    const thread = createThread(rootEvent, [agentReply]);
    agentReply.makeReplaced(
      new MatrixEvent(
        message(
          '$edit',
          {
            'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
            'm.new_content': { msgtype: 'm.text', body: 'Edited example reply' },
          },
          agentId
        )
      )
    );
    expect(agentReply.getContent().body).toBe('Edited example reply');
    expect(agentReply.getContent()[ORIGINAL_SENDER_KEY]).toBeUndefined();
    expect(hasAgentPostForUser({ rootEvent, thread, userId })).toBe(true);

    agentReply.makeRedacted(
      new MatrixEvent({
        ...message('$redact', {}, agentId),
        type: 'm.room.redaction',
        redacts: '$reply',
      }),
      thread.room
    );
    expect(hasAgentPostForUser({ rootEvent, thread, userId })).toBe(false);
  });

  it('counts a bundled latest agent reply before opening a thread', () => {
    const rootEvent = bundledRoot(1, false, reply(attribution, agentId));
    const thread = createThread(rootEvent);
    expect(thread.events).toHaveLength(0);
    expect(thread.hasCurrentUserParticipated).toBe(false);
    expect(thread.replyToEvent?.getId()).toBe('$reply');
    expect(hasAgentPostForUser({ rootEvent, thread, userId })).toBe(true);
  });

  it('keeps bundled attribution when the latest event is the title', () => {
    const rootEvent = bundledRoot(2, false, title, reply(attribution, agentId));
    const thread = createThread(rootEvent);
    expect(thread.events).toHaveLength(0);
    expect(thread.replyToEvent?.getId()).toBe('$title');
    expect(hasAgentPostForUser({ rootEvent, thread, userId })).toBe(true);
    expect(
      buildCrossRoomThreadIndexEntry({
        room: thread.room,
        threadRootId: thread.id,
        currentUserId: userId,
      })?.hasAgentPostForUser
    ).toBe(true);
  });

  it.each(['latest event', 'reply behind the title'])(
    'counts a direct mention in the bundled %s of an unopened thread',
    (source) => {
      const mentioned = reply({ 'm.mentions': { user_ids: [userId], room: true } });
      const rootEvent =
        source === 'latest event'
          ? bundledRoot(1, false, mentioned)
          : bundledRoot(2, false, title, mentioned);
      const thread = createThread(rootEvent);
      expect(thread.events).toHaveLength(0);
      expect(thread.hasCurrentUserParticipated).toBe(false);
      expect(
        buildCrossRoomThreadIndexEntry({
          room: thread.room,
          threadRootId: thread.id,
          currentUserId: userId,
        })?.isInvolved
      ).toBe(true);
      expect(
        isUserInvolvedInThread({ rootEvent, thread, userId: '@unmentioned:example.org' })
      ).toBe(false);

      // The loaded copy no longer mentions the user. Do not count the stale bundled copy.
      const loaded = createThread(rootEvent, [
        new MatrixEvent(reply({ 'm.mentions': { room: true } })),
      ]);
      expect(isUserInvolvedInThread({ rootEvent, thread: loaded, userId })).toBe(false);
    }
  );

  it.each([true, false])(
    'does not resurrect a live-redacted reply (all replies loaded: %s)',
    async (complete) => {
      const content = { ...attribution, 'm.mentions': { user_ids: [userId] } };
      const rootEvent = bundledRoot(2, false, title, reply(content, agentId));
      const thread = createThread(rootEvent, complete ? [rootEvent] : []);
      const { room, client } = thread;
      client.store.storeRoom(room);
      const mapEvent = client.getEventMapper();
      thread.addEvents([mapEvent(reply(content, agentId)), mapEvent(title)], false);
      const index = () =>
        buildCrossRoomThreadIndexEntry({ room, threadRootId: thread.id, currentUserId: userId });
      expect(hasLoadedEveryThreadReply(thread)).toBe(complete);
      expect(index()).toMatchObject({ isInvolved: true, hasAgentPostForUser: true });

      await room.addLiveEvents(
        [
          new MatrixEvent({
            ...message('$redact', { redacts: '$reply' }, agentId),
            type: 'm.room.redaction',
            redacts: '$reply',
            origin_server_ts: 3,
          }),
        ],
        { addToState: false }
      );
      expect(room.findEventById('$reply')?.isRedacted()).toBe(true);
      expect(hasLoadedEveryThreadReply(thread)).toBe(complete);
      expect(getBundledThreadPreviews(room, rootEvent).reply?.getId()).toBe('$reply');
      expect(index()).toMatchObject({ isInvolved: false, hasAgentPostForUser: false });
    }
  );

  it('uses only the newest detached reply when the SDK and the bundle name different replies', () => {
    const content = { ...attribution, 'm.mentions': { user_ids: [userId] } };
    const latest = { ...reply(), event_id: '$newer', origin_server_ts: 2 };
    const rootEvent = bundledRoot(2, false, latest, reply(content, agentId));
    const thread = createThread(rootEvent);
    const entry = buildCrossRoomThreadIndexEntry({
      room: thread.room,
      threadRootId: thread.id,
      currentUserId: userId,
    });
    expect(thread.events).toHaveLength(0);
    expect(entry).toMatchObject({ isInvolved: false, hasAgentPostForUser: false });
  });

  it('publishes a new generation when only agent attribution changes', () => {
    const build = (content: Record<string, unknown>) => {
      const thread = createThread(bundledRoot(1, false, reply(content, agentId)));
      return buildCrossRoomThreadIndexEntry({
        room: thread.room,
        threadRootId: thread.id,
        currentUserId: userId,
      })!;
    };
    const previous = build({});
    const next = build(attribution);
    expect(
      areCrossRoomThreadIndexEntriesEquivalent(previous, { ...next, hasAgentPostForUser: false })
    ).toBe(true);

    const first = upsert(emptyCrossRoomThreadIndexSnapshot(), previous);
    const second = upsert(first, next);
    expect(second.entries.get(next.key)?.generation).toBe(previous.generation + 1);
  });

  it('uses bundled participation when the SDK has not loaded all the replies', () => {
    const rootEvent = bundledRoot(3);
    const thread = createThread(rootEvent);
    expect(thread.hasCurrentUserParticipated).toBe(true);
    expect(thread.events).toHaveLength(0);
    expect(isUserInvolvedInThread({ rootEvent, thread, userId })).toBe(true);
    expect(isUserInvolvedInThread({ rootEvent, thread, userId: '@different:example.org' })).toBe(
      false
    );
  });

  it('does not let a stale bundle override a complete timeline with no involved replies', () => {
    const rootEvent = bundledRoot(1);
    const thread = createThread(rootEvent, [rootEvent, new MatrixEvent(reply())]);
    expect(thread.events.map((event) => event.getId())).toEqual(['$root', '$reply']);
    expect(thread.hasCurrentUserParticipated).toBe(true);
    expect(isUserInvolvedInThread({ rootEvent, thread, userId })).toBe(false);
  });
});

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

  it('does not promote a later summary generation time over real reply activity', () => {
    const root = makeEvent({ id: '$root', body: 'Root preview', ts: 100 });
    const reply = makeEvent({
      id: '$reply',
      body: 'Reply',
      ts: 150,
      threadRootId: '$root',
    });

    const entry = buildCrossRoomThreadIndexEntry({
      room: makeRoom({ root, replies: [reply] }),
      threadRootId: '$root',
      summaryInfo: { summaryText: 'Summary text', generatedTs: 300, messageCount: 1 },
      tagSnapshot,
    });

    expect(entry?.lastActivityTs).toBe(150);
  });

  it("keeps the root's time apart from the latest reply's", () => {
    const root = makeEvent({ id: '$root', body: 'Root preview', ts: 100 });
    const reply = makeEvent({ id: '$reply', body: 'Reply', ts: 150, threadRootId: '$root' });

    const entry = buildCrossRoomThreadIndexEntry({
      room: makeRoom({ root, replies: [reply] }),
      threadRootId: '$root',
      tagSnapshot,
    });

    expect(entry?.rootTs).toBe(100);
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

    const inserted = upsert(emptyCrossRoomThreadIndexSnapshot(), entry!);
    expect(inserted.version).toBe(1);
    expect(
      inserted.entries.get(getCrossRoomThreadIndexKey('!room:example.org', '$root'))
    ).toBeDefined();

    const removed = removeCrossRoomThreadIndexEntry(inserted, '!room:example.org', '$root');
    expect(removed.version).toBe(2);
    expect(removed.entries.size).toBe(0);

    expect(removeCrossRoomThreadIndexEntry(removed, '!room:example.org', '$root')).toBe(removed);

    const roomA = upsert(inserted, {
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

    const inserted = upsert(emptyCrossRoomThreadIndexSnapshot(), entry!);
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
      snapshot = upsert(snapshot, {
        ...entry!,
        key: getCrossRoomThreadIndexKey(`!room${index}:example.org`, `$root${index}`),
        roomId: `!room${index}:example.org`,
        threadRootId: `$root${index}`,
        lastActivityTs: index,
      });
    }

    snapshot = upsert(snapshot, {
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
      snapshot = upsert(snapshot, {
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

  it('returns the identical snapshot when re-upserting a semantically unchanged entry', () => {
    const root = makeEvent({ id: '$root', body: 'Root' });
    const room = makeRoom({ root });
    const entry = buildCrossRoomThreadIndexEntry({ room, threadRootId: '$root', tagSnapshot });
    expect(entry).toBeDefined();

    const inserted = upsert(emptyCrossRoomThreadIndexSnapshot(), entry!);
    const rebuilt = buildCrossRoomThreadIndexEntry({ room, threadRootId: '$root', tagSnapshot });
    expect(rebuilt).not.toBe(entry);

    const next = upsert(inserted, rebuilt!);
    expect(next).toBe(inserted);
    expect(next.version).toBe(1);
  });

  it('ignores generation when comparing entries for semantic equivalence', () => {
    const root = makeEvent({ id: '$root', body: 'Root' });
    const entry = buildCrossRoomThreadIndexEntry({
      room: makeRoom({ root }),
      threadRootId: '$root',
      tagSnapshot,
    });
    expect(entry?.generation).toBe(0);

    expect(areCrossRoomThreadIndexEntriesEquivalent(entry!, { ...entry!, generation: 7 })).toBe(
      true
    );
    expect(
      areCrossRoomThreadIndexEntriesEquivalent(entry!, { ...entry!, summaryText: 'Changed' })
    ).toBe(false);
  });

  it('applies a batch of upserts and removals with a single version increment', () => {
    const makeEntry = (roomId: string, rootId: string, body: string) => {
      const root = makeEvent({ id: rootId, body });
      return buildCrossRoomThreadIndexEntry({
        room: makeRoom({ roomId, root }),
        threadRootId: rootId,
        tagSnapshot,
      })!;
    };
    const entryA = makeEntry('!a:example.org', '$root-a', 'Root A');
    const entryB = makeEntry('!b:example.org', '$root-b', 'Root B');
    const entryC = makeEntry('!c:example.org', '$root-c', 'Root C');

    const inserted = applyCrossRoomThreadIndexBatch(emptyCrossRoomThreadIndexSnapshot(), {
      upserts: [entryA, entryB, entryC],
    });
    expect(inserted.version).toBe(1);
    expect(inserted.entries.size).toBe(3);

    const changedA = { ...entryA, summaryText: 'Updated A', lastActivityTs: 999 };
    const next = applyCrossRoomThreadIndexBatch(inserted, {
      upserts: [changedA, { ...entryB }],
      removals: [{ roomId: entryC.roomId, threadRootId: entryC.threadRootId }],
    });

    expect(next.version).toBe(2);
    expect(next.entries.get(entryA.key)?.summaryText).toBe('Updated A');
    expect(next.entries.get(entryA.key)?.generation).toBe(entryA.generation + 1);
    expect(next.entries.get(entryB.key)).toBe(inserted.entries.get(entryB.key));
    expect(next.entries.has(entryC.key)).toBe(false);
    expect(getCrossRoomThreadRootsForEvent(next, entryC.roomId, entryC.threadRootId)).toEqual([]);
  });

  it('returns the identical snapshot for a batch with no effective changes', () => {
    const root = makeEvent({ id: '$root', body: 'Root' });
    const room = makeRoom({ root });
    const entry = buildCrossRoomThreadIndexEntry({ room, threadRootId: '$root', tagSnapshot });
    const inserted = applyCrossRoomThreadIndexBatch(emptyCrossRoomThreadIndexSnapshot(), {
      upserts: [entry!],
    });

    const rebuilt = buildCrossRoomThreadIndexEntry({ room, threadRootId: '$root', tagSnapshot });
    const unchanged = applyCrossRoomThreadIndexBatch(inserted, {
      upserts: [rebuilt!],
      removals: [{ roomId: '!missing:example.org', threadRootId: '$missing' }],
    });

    expect(unchanged).toBe(inserted);
    expect(unchanged.version).toBe(1);
  });

  it('keeps batch removals from mutating the previous snapshot reverse index', () => {
    const roomId = '!room:example.org';
    const rootOne = makeEvent({ id: '$root-1', body: 'Root one' });
    const replyOne = makeEvent({ id: '$reply-1', body: 'Reply one', threadRootId: '$root-1' });
    const rootTwo = makeEvent({ id: '$root-2', body: 'Root two' });
    const entryOne = buildCrossRoomThreadIndexEntry({
      room: makeRoom({ roomId, root: rootOne, replies: [replyOne] }),
      threadRootId: '$root-1',
      tagSnapshot,
    });
    const entryTwo = buildCrossRoomThreadIndexEntry({
      room: makeRoom({ roomId, root: rootTwo }),
      threadRootId: '$root-2',
      tagSnapshot,
    });

    const inserted = applyCrossRoomThreadIndexBatch(emptyCrossRoomThreadIndexSnapshot(), {
      upserts: [entryOne!, entryTwo!],
    });
    const removed = applyCrossRoomThreadIndexBatch(inserted, {
      removals: [{ roomId, threadRootId: '$root-1' }],
    });

    expect(getCrossRoomThreadRootsForEvent(removed, roomId, '$root-1')).toEqual([]);
    expect(getCrossRoomThreadRootsForEvent(removed, roomId, '$reply-1')).toEqual([]);
    expect(getCrossRoomThreadRootsForEvent(removed, roomId, '$root-2')).toEqual(['$root-2']);
    expect(getCrossRoomThreadRootsForEvent(inserted, roomId, '$root-1')).toEqual(['$root-1']);
    expect(getCrossRoomThreadRootsForEvent(inserted, roomId, '$reply-1')).toEqual(['$root-1']);
  });

  it('evicts overflow entries and cleans their reverse index within one batch', () => {
    const root = makeEvent({ id: '$root', body: 'Root' });
    const entry = buildCrossRoomThreadIndexEntry({
      room: makeRoom({ root }),
      threadRootId: '$root',
      tagSnapshot,
    });
    expect(entry).toBeDefined();

    const total = MAX_CROSS_ROOM_INDEX_ENTRIES + CROSS_ROOM_INDEX_EVICTION_SLACK + 1;
    const upserts = Array.from({ length: total }, (_, index) => ({
      ...entry!,
      key: getCrossRoomThreadIndexKey(`!room${index}:example.org`, `$root${index}`),
      roomId: `!room${index}:example.org`,
      threadRootId: `$root${index}`,
      lastActivityTs: index,
    }));

    const snapshot = applyCrossRoomThreadIndexBatch(emptyCrossRoomThreadIndexSnapshot(), {
      upserts,
    });

    expect(snapshot.version).toBe(1);
    expect(snapshot.entries.size).toBe(MAX_CROSS_ROOM_INDEX_ENTRIES);
    expect(snapshot.entries.has(getCrossRoomThreadIndexKey('!room0:example.org', '$root0'))).toBe(
      false
    );
    expect(getCrossRoomThreadRootsForEvent(snapshot, '!room0:example.org', '$root0')).toEqual([]);
    expect(
      getCrossRoomThreadRootsForEvent(
        snapshot,
        `!room${total - 1}:example.org`,
        `$root${total - 1}`
      )
    ).toEqual([`$root${total - 1}`]);
  });

  describe('dirty coalescer', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('coalesces dirty keys into one flush on the next microtask', async () => {
      const flush = vi.fn();
      const coalescer = createCrossRoomThreadDirtyCoalescer(flush);

      coalescer.enqueueDirty('a');
      coalescer.enqueueDirty('b');
      coalescer.enqueueDirty('a');
      expect(flush).not.toHaveBeenCalled();
      await Promise.resolve();

      expect(flush).toHaveBeenCalledTimes(1);
      expect(flush).toHaveBeenCalledWith(['a', 'b']);
    });

    it('drops a discarded key from the pending flush', async () => {
      const flush = vi.fn();
      const coalescer = createCrossRoomThreadDirtyCoalescer(flush);

      coalescer.enqueueDirty('a');
      coalescer.enqueueDirty('b');
      coalescer.discardDirty('a');
      await Promise.resolve();

      expect(flush).toHaveBeenCalledWith(['b']);
    });

    it('spaces a burst until the interval after the previous flush ended', async () => {
      const flush = vi.fn(() => {
        vi.advanceTimersByTime(30);
      });
      const coalescer = createCrossRoomThreadDirtyCoalescer(flush);
      coalescer.enqueueDirty('a');
      await Promise.resolve();

      vi.advanceTimersByTime(50);
      coalescer.enqueueDirty('b');
      coalescer.enqueueDirty('c');
      await Promise.resolve();
      // The first flush ended 30 ms in, so the next may start 200 ms later.
      vi.advanceTimersByTime(149);
      expect(flush).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1);
      expect(flush).toHaveBeenLastCalledWith(['b', 'c']);

      vi.advanceTimersByTime(500);
      coalescer.enqueueDirty('d');
      await Promise.resolve();
      expect(flush).toHaveBeenLastCalledWith(['d']);
      expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps the interval when a scheduled flush finds every key discarded', async () => {
      const flush = vi.fn();
      const coalescer = createCrossRoomThreadDirtyCoalescer(flush);
      coalescer.enqueueDirty('a');
      await Promise.resolve();

      vi.advanceTimersByTime(100);
      coalescer.enqueueDirty('deleted');
      coalescer.discardDirty('deleted');
      vi.advanceTimersByTime(110);
      coalescer.enqueueDirty('fresh');
      await Promise.resolve();

      expect(flush).toHaveBeenCalledTimes(2);
      expect(flush).toHaveBeenLastCalledWith(['fresh']);
    });

    it('lets flushNow supersede a pending microtask flush', async () => {
      const flush = vi.fn();
      const coalescer = createCrossRoomThreadDirtyCoalescer(flush);

      coalescer.enqueueDirty('a');
      coalescer.flushNow();
      coalescer.enqueueDirty('b');
      // The microtask queued for 'a' must not flush 'b' inside the interval.
      await Promise.resolve();
      expect(flush).toHaveBeenCalledTimes(1);
      expect(flush).toHaveBeenLastCalledWith(['a']);

      vi.advanceTimersByTime(200);
      expect(flush).toHaveBeenLastCalledWith(['b']);
    });

    it('lets flushNow supersede a pending timer and restart the interval', async () => {
      const flush = vi.fn();
      const coalescer = createCrossRoomThreadDirtyCoalescer(flush);
      coalescer.enqueueDirty('a');
      await Promise.resolve();

      vi.advanceTimersByTime(50);
      coalescer.enqueueDirty('b');
      coalescer.flushNow();
      expect(flush).toHaveBeenLastCalledWith(['b']);
      expect(vi.getTimerCount()).toBe(0);

      coalescer.enqueueDirty('c');
      vi.advanceTimersByTime(199);
      expect(flush).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(1);
      expect(flush).toHaveBeenLastCalledWith(['c']);
    });

    it('cancels the pending flush on clear', async () => {
      const flush = vi.fn();
      const coalescer = createCrossRoomThreadDirtyCoalescer(flush);
      coalescer.enqueueDirty('a');
      await Promise.resolve();

      coalescer.enqueueDirty('b');
      coalescer.clear();

      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(200);
      expect(flush).toHaveBeenCalledTimes(1);
    });
  });
});
