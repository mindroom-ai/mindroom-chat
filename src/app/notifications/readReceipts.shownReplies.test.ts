import { MatrixEvent, ReceiptType, RelationType } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { markShownThreadRepliesAsRead } from './readReceipts';

// The classic view shows thread replies among the room's rows; reading them there reads each
// thread up to its newest reply shown, as the open thread reads its own.

const ROOM_ID = '!classic:example.org';
const USER_ID = '@reader:example.org';
const HELPER = '@helper:example.org';

const message = (eventId: string, ts: number, content: Record<string, unknown>) =>
  new MatrixEvent({
    content,
    event_id: eventId,
    origin_server_ts: ts,
    room_id: ROOM_ID,
    sender: HELPER,
    type: 'm.room.message',
  });

const reply = (eventId: string, ts: number, rootId: string) =>
  message(eventId, ts, {
    msgtype: 'm.text',
    body: eventId,
    'm.relates_to': { rel_type: RelationType.Thread, event_id: rootId },
  });

const finishingEdit = (eventId: string, ts: number, targetId: string, rootId: string) => {
  const edit = message(eventId, ts, {
    msgtype: 'm.text',
    body: '* Done',
    'm.new_content': { msgtype: 'm.text', body: 'Done', 'io.mindroom.stream_status': 'completed' },
    'm.relates_to': { rel_type: RelationType.Replace, event_id: targetId },
  });
  edit.setThreadId(rootId);
  return edit;
};

const thread = (id: string, events: MatrixEvent[], readEventId: string | null = null) => ({
  id,
  events,
  replyToEvent: events.findLast((event) => event.isRelation(RelationType.Thread)),
  getEventReadUpTo: vi.fn(() => readEventId),
  getReadReceiptForUserId: vi.fn(() =>
    readEventId ? { eventId: readEventId, data: { ts: 1, thread_id: id } } : null
  ),
  getLastUnthreadedReceiptFor: vi.fn(() => undefined),
});

const setup = (threads: ReturnType<typeof thread>[]) => {
  const room = {
    roomId: ROOM_ID,
    findEventById: vi.fn(),
    getEventReadUpTo: vi.fn(() => null),
    getLiveTimeline: vi.fn(() => ({ getEvents: (): MatrixEvent[] => [] })),
    getThread: vi.fn((id: string) => threads.find((candidate) => candidate.id === id) ?? null),
    getThreads: vi.fn(() => threads),
  };
  return {
    getRoom: vi.fn(() => room),
    getUserId: vi.fn(() => USER_ID),
    sendReadReceipt: vi.fn(),
    sendReceipt: vi.fn(),
  };
};

/** Each receipt as `<event> <thread>`. */
const receipts = (mx: ReturnType<typeof setup>) =>
  mx.sendReceipt.mock.calls.map(([event, , body]) => {
    const target = event as MatrixEvent;
    const threadId = (body as { thread_id?: string }).thread_id;
    // The SDK takes the receipt's thread from its event: the two must agree.
    expect(target.threadRootId).toBe(threadId);
    return `${target.getId()} ${threadId}`;
  });

describe('markShownThreadRepliesAsRead', () => {
  it('reads each thread up to its newest reply among the rows, and nothing for room rows', async () => {
    const a1 = reply('$a1', 2, '$a');
    const a2 = reply('$a2', 5, '$a');
    const a3 = reply('$a3', 9, '$a');
    const b1 = reply('$b1', 4, '$b');
    const mx = setup([thread('$a', [a1, a2, a3]), thread('$b', [b1])]);
    const rows = [message('$a', 1, { msgtype: 'm.text', body: 'root' }), a1, b1, a2];

    await markShownThreadRepliesAsRead(mx as never, ROOM_ID, rows, false);

    // `$a3` is not among the rows the reader saw, so thread `$a` is read up to `$a2` only.
    expect(receipts(mx).sort()).toEqual(['$a2 $a', '$b1 $b']);
    expect(mx.sendReceipt).toHaveBeenCalledWith(a2, ReceiptType.Read, { thread_id: '$a' });
  });

  it('reads the replies a sync adds one by one with one receipt per thread', async () => {
    const a1 = reply('$a1', 2, '$a');
    const a2 = reply('$a2', 5, '$a');
    const b1 = reply('$b1', 4, '$b');
    const mx = setup([thread('$a', [a1, a2]), thread('$b', [b1])]);

    // The classic view asks to read each reply as it arrives.
    await Promise.all(
      [a1, b1, a2].map((shown) =>
        markShownThreadRepliesAsRead(mx as never, ROOM_ID, [shown], false)
      )
    );

    expect(receipts(mx).sort()).toEqual(['$a2 $a', '$b1 $b']);
  });

  it('reads a finished streamed reply up to its finishing edit, privately when asked', async () => {
    const answer = reply('$answer', 2, '$root');
    const finish = finishingEdit('$finish', 4, '$answer', '$root');
    // The row shows the reply with the edit the SDK applied.
    answer.makeReplaced(finish);
    const mx = setup([thread('$root', [answer, finish])]);

    await markShownThreadRepliesAsRead(mx as never, ROOM_ID, [answer], true);

    expect(mx.sendReceipt).toHaveBeenCalledWith(finish, ReceiptType.ReadPrivate, {
      thread_id: '$root',
    });
  });

  it('takes a finishing edit that arrived as read up to that edit', async () => {
    const answer = reply('$answer', 2, '$root');
    const finish = finishingEdit('$finish', 4, '$answer', '$root');
    const mx = setup([thread('$root', [answer, finish], '$answer')]);

    await markShownThreadRepliesAsRead(mx as never, ROOM_ID, [finish], false);

    expect(receipts(mx)).toEqual(['$finish $root']);
  });

  it('sends nothing for a thread already read that far, a pending reply or a local root', async () => {
    const read = reply('$read', 3, '$root');
    const pending = reply('~local-reply', 4, '$other');
    const onLocalRoot = reply('$on-local', 5, `~${ROOM_ID}:txn`);
    const mx = setup([thread('$root', [reply('$older', 2, '$root'), read], '$read')]);

    await markShownThreadRepliesAsRead(mx as never, ROOM_ID, [read, pending, onLocalRoot], false);

    expect(mx.sendReceipt).not.toHaveBeenCalled();
  });
});
