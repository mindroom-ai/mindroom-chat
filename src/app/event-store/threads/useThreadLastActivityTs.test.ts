import { MatrixEvent, Room, Thread } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { getThreadLastActivityTs } from './useThreadLastActivityTs';

const THREAD_ROOT_ID = '$root';

const makeMessageEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = eventId,
  content: Record<string, unknown> = {}
) =>
  new MatrixEvent({
    content: {
      body,
      msgtype: 'm.text',
      ...content,
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

const makeThreadRootWithBundledLatestEvent = ({
  eventId = THREAD_ROOT_ID,
  ts,
  latestEventTs,
  latestEditTs,
  latestEditSender = '@alice:example.org',
  latestEditContent,
}: {
  eventId?: string;
  ts: number;
  latestEventTs?: number;
  latestEditTs?: number;
  latestEditSender?: string;
  latestEditContent?: Record<string, unknown>;
}) =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    type: 'm.room.message',
    unsigned: {
      'm.relations':
        latestEventTs || latestEditTs
          ? {
              'm.thread': {
                latest_event: {
                  content: {
                    body: '$latest',
                    msgtype: 'm.text',
                  },
                  event_id: '$latest',
                  origin_server_ts: latestEventTs,
                  room_id: '!room:example.org',
                  sender: '@alice:example.org',
                  type: 'm.room.message',
                  unsigned:
                    latestEditTs !== undefined
                      ? {
                          'm.relations': {
                            'm.replace': {
                              content: latestEditContent,
                              origin_server_ts: latestEditTs,
                              sender: latestEditSender,
                            },
                          },
                        }
                      : undefined,
                },
              },
            }
          : undefined,
    },
  });

const makeThreadReplyEvent = (
  eventId: string,
  ts: number,
  sender = '@alice:example.org',
  body = eventId
) =>
  makeMessageEvent(eventId, ts, sender, body, {
    'm.relates_to': {
      event_id: THREAD_ROOT_ID,
      rel_type: 'm.thread',
    },
  });

const makeHiddenThreadTagEvent = (eventId: string, ts: number, sender = '@alice:example.org') =>
  new MatrixEvent({
    content: {
      'm.relates_to': {
        event_id: THREAD_ROOT_ID,
        rel_type: 'm.thread',
      },
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'com.mindroom.thread.tag',
  });

const makeEditEvent = (
  eventId: string,
  ts: number,
  targetEventId: string,
  sender = '@alice:example.org',
  newContent: Record<string, unknown> = {}
) =>
  new MatrixEvent({
    content: {
      body: `* ${eventId}`,
      'm.new_content': {
        body: eventId,
        msgtype: 'm.text',
        ...newContent,
      },
      'm.relates_to': {
        event_id: targetEventId,
        rel_type: 'm.replace',
      },
      msgtype: 'm.text',
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

type MockThread = Thread & {
  setLastReply: (event: MatrixEvent | null) => void;
  setTimelineEvents: (events: MatrixEvent[]) => void;
  getUnfilteredTimelineSet: () => {
    getLiveTimeline: () => {
      getEvents: () => MatrixEvent[];
      getNeighbouringTimeline: () => null;
    };
  };
};

const makeThread = ({
  rootEvent,
  lastReply,
  replyToEvent,
  timelineEvents,
}: {
  rootEvent: MatrixEvent;
  lastReply?: MatrixEvent | null;
  replyToEvent?: MatrixEvent | null;
  timelineEvents?: MatrixEvent[];
}): MockThread => {
  let currentLastReply = lastReply ?? null;
  let currentTimelineEvents = timelineEvents ?? [
    rootEvent,
    ...(lastReply ? [lastReply] : replyToEvent ? [replyToEvent] : []),
  ];
  const liveTimeline = {
    getEvents: () => currentTimelineEvents,
    getNeighbouringTimeline: () => null,
  };

  return {
    rootEvent,
    replyToEvent,
    lastReply: vi.fn(() => currentLastReply),
    setLastReply: (event: MatrixEvent | null) => {
      currentLastReply = event;
    },
    setTimelineEvents: (events: MatrixEvent[]) => {
      currentTimelineEvents = events;
    },
    getUnfilteredTimelineSet: () => ({
      getLiveTimeline: () => liveTimeline,
    }),
  } as unknown as MockThread;
};

const makeRoom = (rootEvent: MatrixEvent, thread?: MockThread): Room =>
  ({
    findEventById: vi.fn((eventId: string) =>
      eventId === rootEvent.getId() ? rootEvent : undefined
    ),
    getThread: vi.fn((threadRootId: string) =>
      threadRootId === rootEvent.getId() ? thread : undefined
    ),
  } as unknown as Room);

describe('getThreadLastActivityTs', () => {
  it('uses a newer reply once the thread holds it', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const thread = makeThread({ rootEvent });
    const room = makeRoom(rootEvent, thread);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(100);

    thread.setTimelineEvents([rootEvent, replyEvent]);
    thread.setLastReply(replyEvent);

    expect(getSnapshot()).toBe(200);
  });

  it('prefers the latest edit timestamp over the original reply timestamp', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const replyEvent = makeThreadReplyEvent('$reply', 200);
    const replyEdit = makeEditEvent('$edit', 300, '$reply');
    const thread = makeThread({ rootEvent, lastReply: replyEvent });
    const room = makeRoom(rootEvent, thread);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(200);

    replyEvent.makeReplaced(replyEdit);

    expect(getSnapshot()).toBe(300);
  });

  it('keeps a streaming reply at its own timestamp until the stream ends', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const agent = '@mindroom_helper:example.org';
    const replyEvent = makeThreadReplyEvent('$reply', 200, agent);
    const thread = makeThread({ rootEvent, lastReply: replyEvent });
    const room = makeRoom(rootEvent, thread);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);
    expect(getSnapshot()).toBe(200);

    // Every edit of a stream would otherwise move the thread's card to the top of the list.
    for (let edit = 1; edit <= 5; edit += 1) {
      replyEvent.makeReplaced(
        makeEditEvent(`$stream-${edit}`, 200 + edit * 50, '$reply', agent, {
          'io.mindroom.stream_status': 'streaming',
        })
      );
      expect(getSnapshot()).toBe(200);
    }

    replyEvent.makeReplaced(
      makeEditEvent('$finish', 600, '$reply', agent, {
        'io.mindroom.stream_status': 'completed',
      })
    );
    expect(getSnapshot()).toBe(600);
  });

  it('uses a root edit timestamp when there is no newer reply', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const rootEdit = makeEditEvent('$root-edit', 250, '$root');
    const thread = makeThread({ rootEvent, lastReply: null });
    const room = makeRoom(rootEvent, thread);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(100);

    rootEvent.makeReplaced(rootEdit);

    expect(getSnapshot()).toBe(250);
  });

  it('falls back to replyToEvent when lastReply is unavailable', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const replyToEvent = makeThreadReplyEvent('$latest-known', 180);
    const thread = makeThread({ rootEvent, lastReply: null, replyToEvent, timelineEvents: [] });
    const room = makeRoom(rootEvent, thread);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(180);
  });

  it('falls back to the root timestamp when the thread model is missing', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const room = makeRoom(rootEvent, undefined);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(100);
  });

  it('uses a newer lastReply even when the loaded thread tail is stale', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const olderReply = makeThreadReplyEvent('$reply-old', 180);
    const newerReply = makeThreadReplyEvent('$reply-new', 260);
    const thread = makeThread({
      rootEvent,
      lastReply: newerReply,
      replyToEvent: newerReply,
      timelineEvents: [rootEvent, olderReply],
    });
    const room = makeRoom(rootEvent, thread);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(260);
  });

  it.each([
    ['the newest reply the thread knows', (reply: MatrixEvent) => ({ lastReply: reply })],
    ['the reply its summary names', (reply: MatrixEvent) => ({ replyToEvent: reply })],
  ])('uses %s alone when the loaded thread tail is stale', (_which, held) => {
    const rootEvent = makeMessageEvent('$root', 100);
    const olderReply = makeThreadReplyEvent('$reply-old', 180);
    const thread = makeThread({
      rootEvent,
      ...held(makeThreadReplyEvent('$reply-new', 260)),
      timelineEvents: [rootEvent, olderReply],
    });

    expect(getThreadLastActivityTs(makeRoom(rootEvent, thread), THREAD_ROOT_ID)).toBe(260);
  });

  it('uses bundled latest_event timestamps when the thread model is missing', () => {
    const rootEvent = makeThreadRootWithBundledLatestEvent({
      eventId: '$root',
      ts: 100,
      latestEventTs: 240,
    });
    const room = makeRoom(rootEvent, undefined);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(240);
  });

  it('ignores bundled latest_event timestamps for hidden threaded metadata relations', () => {
    const rootEvent = new MatrixEvent({
      content: {
        body: '$root',
        msgtype: 'm.text',
      },
      event_id: '$root',
      origin_server_ts: 100,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      type: 'm.room.message',
      unsigned: {
        'm.relations': {
          'm.thread': {
            latest_event: {
              event_id: '$thread-tag',
              origin_server_ts: 240,
              room_id: '!room:example.org',
              sender: '@alice:example.org',
              type: 'com.mindroom.thread.tag',
            },
          },
        },
      },
    });
    const room = makeRoom(rootEvent, undefined);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(100);
  });

  it('uses bundled latest_event replacement timestamps when they are newer', () => {
    const rootEvent = makeThreadRootWithBundledLatestEvent({
      eventId: '$root',
      ts: 100,
      latestEventTs: 220,
      latestEditTs: 310,
    });
    const room = makeRoom(rootEvent, undefined);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(310);
  });

  it('keeps a streaming reply at its own timestamp when its bundled edit still streams', () => {
    const bundled = (status: string) =>
      makeRoom(
        makeThreadRootWithBundledLatestEvent({
          eventId: '$root',
          ts: 100,
          latestEventTs: 220,
          latestEditTs: 310,
          latestEditContent: { 'io.mindroom.stream_status': status },
        }),
        undefined
      );

    // As an edit put on a loaded reply: two streaming threads would trade places at every edit.
    expect(getThreadLastActivityTs(bundled('streaming'), '$root')).toBe(220);
    expect(getThreadLastActivityTs(bundled('completed'), '$root')).toBe(310);
  });

  it('ignores a bundled latest_event replacement another sender made', () => {
    const rootEvent = makeThreadRootWithBundledLatestEvent({
      eventId: '$root',
      ts: 100,
      latestEventTs: 220,
      latestEditTs: 310,
      latestEditSender: '@bob:example.org',
    });
    const room = makeRoom(rootEvent, undefined);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(220);
  });

  it('uses the latest edit timestamp from a non-last reply in the scanned tail', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const firstReply = makeThreadReplyEvent('$reply-1', 200);
    const secondReply = makeThreadReplyEvent('$reply-2', 250);
    const firstReplyEdit = makeEditEvent('$reply-1-edit', 320, '$reply-1');
    const thread = makeThread({
      rootEvent,
      lastReply: secondReply,
      timelineEvents: [rootEvent, firstReply, secondReply],
    });
    const room = makeRoom(rootEvent, thread);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(250);

    firstReply.makeReplaced(firstReplyEdit);

    expect(getSnapshot()).toBe(320);
  });

  it('ignores hidden threaded metadata relations when deriving live activity', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const visibleReply = makeThreadReplyEvent('$reply-visible', 180);
    const hiddenThreadTag = makeHiddenThreadTagEvent('$thread-tag', 320);
    const thread = makeThread({
      rootEvent,
      lastReply: hiddenThreadTag,
      replyToEvent: hiddenThreadTag,
      timelineEvents: [rootEvent, visibleReply, hiddenThreadTag],
    });
    const room = makeRoom(rootEvent, thread);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(180);
  });

  it('ignores edits on messages older than the last 10 scanned thread messages', () => {
    const rootEvent = makeMessageEvent('$root', 100);
    const replies = Array.from({ length: 11 }, (_, index) =>
      makeThreadReplyEvent(`$reply-${index + 1}`, 200 + index)
    );
    const outsideTailEdit = makeEditEvent('$reply-1-edit', 999, '$reply-1');
    const thread = makeThread({
      rootEvent,
      lastReply: replies[replies.length - 1],
      timelineEvents: [rootEvent, ...replies],
    });
    const room = makeRoom(rootEvent, thread);

    const getSnapshot = () => getThreadLastActivityTs(room, THREAD_ROOT_ID);

    expect(getSnapshot()).toBe(210);

    replies[0]!.makeReplaced(outsideTailEdit);

    expect(getSnapshot()).toBe(210);
  });
});
