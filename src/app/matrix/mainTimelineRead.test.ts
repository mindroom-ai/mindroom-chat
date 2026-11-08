import {
  createClient,
  MatrixEvent,
  ReceiptType,
  RelationType,
  Room,
  RoomEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { FeatureSupport, Thread } from 'matrix-js-sdk/lib/models/thread';
import { describe, expect, it, vi } from 'vitest';
import { roomHaveUnread } from './room';
import { isMainTimelineMessageUnread } from './mainTimelineRead';
import { keepUnthreadedReceiptEvents } from './receiptReadTs';

// The room list's dot and the unread thread filter answer one question for a message in the main
// timeline, usually a thread root: has the reader seen it?
const ME = '@me:example.org';
const AGENT = '@agent:example.org';

const message = (eventId: string, ts: number, sender: string, threadRootId?: string) =>
  new MatrixEvent({
    content: {
      body: eventId,
      msgtype: 'm.text',
      ...(threadRootId
        ? {
            'm.relates_to': {
              rel_type: RelationType.Thread,
              event_id: threadRootId,
              is_falling_back: true,
              'm.in_reply_to': { event_id: threadRootId },
            },
          }
        : {}),
    },
    event_id: eventId,
    origin_server_ts: ts,
    room_id: '!room:example.org',
    sender,
    type: 'm.room.message',
  });

type Receipt = { eventId: string; ts: number; threadId?: string };

const makeRoom = ({
  main,
  receipt,
  threads = {},
}: {
  main: MatrixEvent[];
  /** The reader's receipt for the room: main timeline or unthreaded. */
  receipt?: Receipt;
  threads?: Record<string, MatrixEvent[]>;
}): Room => {
  const all = [...main, ...Object.values(threads).flat()];
  const findEventById = (eventId: string) => all.find((event) => event.getId() === eventId);
  return {
    roomId: '!room:example.org',
    getLiveTimeline: () => ({ getEvents: () => main }),
    findEventById,
    // The SDK answers a receipt's event wherever it is, a thread reply included.
    getEventReadUpTo: () => (receipt && findEventById(receipt.eventId) ? receipt.eventId : null),
    getReadReceiptForUserId: (_userId: string, _ignore: boolean, type: ReceiptType) =>
      receipt && type === ReceiptType.Read
        ? { eventId: receipt.eventId, data: { ts: receipt.ts, thread_id: receipt.threadId } }
        : null,
    getLastUnthreadedReceiptFor: () =>
      receipt && !receipt.threadId ? { ts: receipt.ts } : undefined,
    getThread: (rootId: string) => {
      const events = threads[rootId];
      return events
        ? { id: rootId, events, replyToEvent: events.at(-1), hasCurrentUserParticipated: false }
        : null;
    },
  } as unknown as Room;
};

const client = { getUserId: () => ME } as unknown as MatrixClient;

describe('main timeline read state', () => {
  it('counts an unthreaded receipt on a thread reply as reading the roots before it', () => {
    // Mark as Read and Escape send one unthreaded receipt on the newest event, often a reply.
    const root = message('$root', 1000, AGENT);
    const reply = message('$reply', 2000, AGENT, '$root');
    const room = makeRoom({
      main: [root],
      threads: { $root: [reply] },
      receipt: { eventId: '$reply', ts: 3000 },
    });

    expect(roomHaveUnread(client, room)).toBe(false);
    expect(isMainTimelineMessageUnread(room, root, ME)).toBe(false);
  });

  it("keeps another member's root unread after the reader answered in its thread", () => {
    // Tuwunel (mindroom-tuwunel #139): an own thread reply reads only its thread, so the server
    // keeps counting the root in the main timeline until a main or unthreaded receipt reaches it.
    const root = message('$root', 1000, AGENT);
    const room = makeRoom({
      main: [root],
      threads: {
        $root: [message('$answer', 2000, AGENT, '$root'), message('$mine', 3000, ME, '$root')],
      },
    });

    expect(roomHaveUnread(client, room)).toBe(true);
    expect(isMainTimelineMessageUnread(room, root, ME)).toBe(true);
  });

  it("keeps another member's root unread when it came after the reader's receipt", () => {
    // A root by an agent, such as a welcome or a scheduled post, with no visible reply yet.
    const older = message('$older', 1000, ME);
    const root = message('$root', 4000, AGENT);
    const room = makeRoom({
      main: [older, root],
      receipt: { eventId: '$older', ts: 2000, threadId: 'main' },
    });

    expect(roomHaveUnread(client, room)).toBe(true);
    expect(isMainTimelineMessageUnread(room, root, ME)).toBe(true);
    expect(isMainTimelineMessageUnread(room, older, ME)).toBe(false);
  });

  it('finds a root outside the loaded timeline unread by its time alone', () => {
    const root = message('$old-root', 4000, AGENT);
    const room = makeRoom({ main: [], receipt: { eventId: '$gone', ts: 2000 } });

    expect(isMainTimelineMessageUnread(room, root, ME)).toBe(true);
  });

  it('leaves the messages after the event an older receipt names unread', () => {
    // Tuwunel v1.9.4-mindroom.31 on: a receipt reads up to the event it names, not to when the
    // server took it.
    const mx = createClient({ baseUrl: 'https://example.org', userId: ME });
    keepUnthreadedReceiptEvents(mx);
    const room = new Room('!room:example.org', mx, ME);
    mx.reEmitter.reEmit(room, [RoomEvent.Receipt]);
    const first = message('$m1', 1000, AGENT);
    const second = message('$m2', 2000, AGENT);
    const third = message('$m3', 3000, AGENT);
    [first, second, third].forEach((event) =>
      room.getUnfilteredTimelineSet().addLiveEvent(event, { addToState: false })
    );
    const read = (eventId: string, ts: number, threadId?: string) =>
      room.addReceipt(
        new MatrixEvent({
          type: 'm.receipt',
          room_id: room.roomId,
          content: {
            [eventId]: {
              [ReceiptType.Read]: { [ME]: { ts, ...(threadId && { thread_id: threadId }) } },
            },
          },
        })
      );

    // Another device read up to the first message after the others arrived.
    read('$m1', 5000);
    expect(roomHaveUnread(mx, room)).toBe(true);
    expect(isMainTimelineMessageUnread(room, second, ME)).toBe(true);

    read('$m2', 6000, 'main');
    expect(isMainTimelineMessageUnread(room, second, ME)).toBe(false);
    expect(isMainTimelineMessageUnread(room, third, ME)).toBe(true);
  });
  it('keeps the main timeline read up to a main receipt when an older unthreaded one arrives later', async () => {
    // A stale device's Mark as Read names the newest event it holds, a reply in a thread, after
    // another device read the main timeline further. The server keeps one receipt per context
    // and only lowers counts; the SDK keeps one receipt for the main timeline, which the later
    // unthreaded receipt replaces.
    const previous = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    try {
      const mx = createClient({ baseUrl: 'https://example.org', userId: ME });
      vi.spyOn(mx, 'supportsThreads').mockReturnValue(true);
      keepUnthreadedReceiptEvents(mx);
      const room = new Room('!room:example.org', mx, ME);
      mx.store.storeRoom(room);
      mx.reEmitter.reEmit(room, [RoomEvent.Receipt]);
      const question = message('$q', 1000, AGENT);
      const m1 = message('$m1', 3000, AGENT);
      const m2 = message('$m2', 5000, AGENT);
      [question, m1, m2].forEach((event) =>
        room.getUnfilteredTimelineSet().addLiveEvent(event, { addToState: false })
      );
      const thread = room.createThread(
        '$q',
        question,
        [message('$a1', 2000, AGENT, '$q'), message('$a2', 4000, AGENT, '$q')],
        false
      );
      await vi.waitFor(() => expect(thread.events.at(-1)?.getId()).toBe('$a2'));
      const read = (eventId: string, ts: number, type: ReceiptType, threadId?: string) =>
        room.addReceipt(
          new MatrixEvent({
            type: 'm.receipt',
            room_id: room.roomId,
            content: {
              [eventId]: { [type]: { [ME]: { ts, ...(threadId && { thread_id: threadId }) } } },
            },
          })
        );

      read('$m2', 6000, ReceiptType.Read, 'main');
      read('$a1', 7000, ReceiptType.Read);
      expect(isMainTimelineMessageUnread(room, m1, ME)).toBe(false);
      expect(isMainTimelineMessageUnread(room, m2, ME)).toBe(false);
      expect(roomHaveUnread(mx, room)).toBe(false);
    } finally {
      Thread.hasServerSideSupport = previous;
      vi.restoreAllMocks();
    }
  });

});
