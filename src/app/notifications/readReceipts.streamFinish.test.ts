import { MatrixEvent, ReceiptType, RelationType } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { markRoomAndThreadsAsRead, markThreadAsRead } from './readReceipts';

// A streamed reply ends with an edit the server counts as new, so the thread receipt has to reach
// that edit. The SDK's thread model holds the edits of its replies, marked with the thread's ID.

const ROOM_ID = '!stream:example.org';
const USER_ID = '@reader:example.org';
const HELPER = '@helper:example.org';
const THREAD_ID = '$root';

const message = (eventId: string, ts: number, content: Record<string, unknown>) =>
  new MatrixEvent({
    content,
    event_id: eventId,
    origin_server_ts: ts,
    room_id: ROOM_ID,
    sender: HELPER,
    type: 'm.room.message',
  });

const reply = (eventId: string, ts: number) =>
  message(eventId, ts, {
    msgtype: 'm.text',
    body: 'Thinking',
    'm.relates_to': { rel_type: RelationType.Thread, event_id: THREAD_ID },
  });

/** An edit as the thread model holds it: with the thread's ID. */
const editIn = (eventId: string, ts: number, targetId: string, status: string) => {
  const edit = message(eventId, ts, {
    msgtype: 'm.text',
    body: '* Done',
    'm.new_content': { msgtype: 'm.text', body: 'Done', 'io.mindroom.stream_status': status },
    'm.relates_to': { rel_type: RelationType.Replace, event_id: targetId },
  });
  edit.setThreadId(THREAD_ID);
  return edit;
};

const setup = (events: MatrixEvent[], readEventId: string | null = null) => {
  const thread = {
    id: THREAD_ID,
    events,
    replyToEvent: events.find((event) => event.isRelation(RelationType.Thread)),
    getEventReadUpTo: vi.fn(() => readEventId),
    getReadReceiptForUserId: vi.fn(() =>
      readEventId ? { eventId: readEventId, data: { ts: 5, thread_id: THREAD_ID } } : null
    ),
    getLastUnthreadedReceiptFor: vi.fn(() => undefined),
  };
  const room = {
    roomId: ROOM_ID,
    findEventById: vi.fn(),
    getEventReadUpTo: vi.fn(() => null),
    getLiveTimeline: vi.fn(() => ({ getEvents: () => [] })),
    getThread: vi.fn(() => thread),
    getThreads: vi.fn(() => [thread]),
  };
  const mx = {
    fetchRelations: vi.fn(async () => ({ chunk: [] as unknown[] })),
    getEventMapper: vi.fn(
      () => (raw: ConstructorParameters<typeof MatrixEvent>[0]) => new MatrixEvent(raw)
    ),
    getRoom: vi.fn(() => room),
    getUserId: vi.fn(() => USER_ID),
    sendReadReceipt: vi.fn(),
    sendReceipt: vi.fn(),
  };
  return mx;
};

/** The ID of the event the only receipt names. */
const receiptTarget = (mx: ReturnType<typeof setup>) => {
  expect(mx.sendReceipt).toHaveBeenCalledTimes(1);
  return (mx.sendReceipt.mock.calls[0]?.[0] as MatrixEvent).getId();
};

describe('markThreadAsRead, streamed replies', () => {
  it('sends the thread receipt on the edit that finished the reply', async () => {
    const answer = reply('$answer', 2);
    const finish = editIn('$finish', 4, '$answer', 'completed');
    const mx = setup([answer, editIn('$step', 3, '$answer', 'streaming'), finish]);

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(mx.sendReceipt).toHaveBeenCalledTimes(1);
    expect(mx.sendReceipt).toHaveBeenCalledWith(finish, ReceiptType.Read, {
      thread_id: THREAD_ID,
    });
  });

  it('keeps the receipt private when the reader hides their activity', async () => {
    const finish = editIn('$finish', 4, '$answer', 'completed');
    const mx = setup([reply('$answer', 2), finish]);

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, true);

    expect(mx.sendReceipt).toHaveBeenCalledWith(finish, ReceiptType.ReadPrivate, {
      thread_id: THREAD_ID,
    });
  });

  it('sends nothing when the finishing edit is already read', async () => {
    const mx = setup([reply('$answer', 2), editIn('$finish', 4, '$answer', 'completed')], '$finish');

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(mx.sendReceipt).not.toHaveBeenCalled();
  });

  it('leaves an edit of the root, which is in the main timeline, to the main receipt', async () => {
    const answer = reply('$answer', 2);
    const mx = setup([answer, editIn('$root-edit', 4, THREAD_ID, 'completed')]);

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(mx.sendReceipt).toHaveBeenCalledWith(answer, ReceiptType.Read, {
      thread_id: THREAD_ID,
    });
  });
});

describe('markThreadAsRead, a reply still streaming', () => {
  it('reads the reply, not an edit that only continues the stream', async () => {
    const answer = reply('$answer', 2);
    const mx = setup([answer, editIn('$step', 3, '$answer', 'streaming')]);

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(receiptTarget(mx)).toBe('$answer');
  });

  it('sends no receipt for a continuing edit once the reply is read', async () => {
    const mx = setup([reply('$answer', 2), editIn('$step', 3, '$answer', 'streaming')], '$answer');

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(mx.sendReceipt).not.toHaveBeenCalled();
  });
});

describe('markThreadAsRead, a thread model without the reply', () => {
  it('reads the finishing edit the reader saw, without asking the server', async () => {
    const mx = setup([]);
    const finish = editIn('$finish', 4, '$answer', 'completed');

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false, finish);

    expect(mx.fetchRelations).not.toHaveBeenCalled();
    expect(receiptTarget(mx)).toBe('$finish');
    expect(mx.sendReceipt.mock.calls[0]?.[2]).toEqual({ thread_id: THREAD_ID });
  });

  it("fetches the server's newest reply and the edit that finished it", async () => {
    const mx = setup([]);
    const finish = editIn('$finish', 4, '$answer', 'completed');
    mx.fetchRelations.mockImplementation(async (...args: unknown[]) => ({
      chunk: [args[2] === RelationType.Thread ? reply('$answer', 2).event : finish.event],
    }));

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(mx.fetchRelations).toHaveBeenCalledTimes(2);
    expect(receiptTarget(mx)).toBe('$finish');
  });

  it('keeps the fetched reply while its newest edit only continues the stream', async () => {
    const mx = setup([]);
    const step = editIn('$step', 3, '$answer', 'streaming');
    mx.fetchRelations.mockImplementation(async (...args: unknown[]) => ({
      chunk: [args[2] === RelationType.Thread ? reply('$answer', 2).event : step.event],
    }));

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(receiptTarget(mx)).toBe('$answer');
  });

  it('sends nothing when the receipt already names the fetched tail', async () => {
    const mx = setup([], '$answer');
    mx.fetchRelations.mockImplementation(async (...args: unknown[]) => ({
      chunk: args[2] === RelationType.Thread ? [reply('$answer', 2).event] : [],
    }));

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(mx.sendReceipt).not.toHaveBeenCalled();
  });
});

describe('markRoomAndThreadsAsRead, streamed replies', () => {
  it('reads the room up to the edit that finished a thread reply', async () => {
    const finish = editIn('$finish', 4, '$answer', 'completed');
    const mx = setup([reply('$answer', 2), finish]);

    await markRoomAndThreadsAsRead(mx as never, ROOM_ID, false);

    expect(mx.sendReadReceipt).toHaveBeenCalledWith(finish, ReceiptType.Read, true);
  });
});
