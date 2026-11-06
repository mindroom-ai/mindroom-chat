import { MatrixEvent, ReceiptType, RelationType } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { markMainTimelineAsRead, markRoomAndThreadsAsRead, markThreadAsRead } from './readReceipts';

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
    getLiveTimeline: vi.fn(() => ({ getEvents: (): MatrixEvent[] => [] })),
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

/**
 * The ID of the event the only receipt names. A thread receipt's event must be of that thread:
 * the SDK takes the receipt's `thread_id` from it.
 */
const receiptTarget = (mx: ReturnType<typeof setup>) => {
  expect(mx.sendReceipt).toHaveBeenCalledTimes(1);
  const [event, , body] = mx.sendReceipt.mock.calls[0] as [MatrixEvent, unknown, unknown];
  if ((body as { thread_id?: string } | undefined)?.thread_id === THREAD_ID)
    expect(event.threadRootId).toBe(THREAD_ID);
  return event.getId();
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
    // As the server lists it: without the thread, and here without the room.
    const finish = { ...editIn('$finish', 4, '$answer', 'completed').event };
    delete finish.room_id;
    mx.fetchRelations.mockImplementation(async (...args: unknown[]) => ({
      chunk: [args[2] === RelationType.Thread ? reply('$answer', 2).event : finish],
    }));

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(mx.fetchRelations).toHaveBeenCalledTimes(2);
    expect(receiptTarget(mx)).toBe('$finish');
    expect((mx.sendReceipt.mock.calls[0]?.[0] as MatrixEvent).getRoomId()).toBe(ROOM_ID);
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

/** A reply as the server sends it after its stream: with its newest edit bundled. */
const replyWithBundledEdit = (status: string) => {
  const answer = reply('$answer', 2);
  // Bundled events need not name their room.
  const bundled = { ...editIn('$finish', 4, '$answer', status).event };
  delete bundled.room_id;
  answer.setUnsigned({ 'm.relations': { [RelationType.Replace]: bundled } } as never);
  return answer;
};

describe('markThreadAsRead, a thread opened after the stream finished', () => {
  it('reads the finishing edit the server bundled with the reply', async () => {
    const mx = setup([replyWithBundledEdit('completed')]);

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(receiptTarget(mx)).toBe('$finish');
    // The SDK builds the request path from the event's room.
    expect((mx.sendReceipt.mock.calls[0]?.[0] as MatrixEvent).getRoomId()).toBe(ROOM_ID);
    expect(mx.sendReceipt.mock.calls[0]?.[2]).toEqual({ thread_id: THREAD_ID });
  });

  it('reads the finishing edit the SDK applied to the reply', async () => {
    const answer = reply('$answer', 2);
    answer.makeReplaced(editIn('$finish', 4, '$answer', 'completed'));
    const mx = setup([answer]);

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(receiptTarget(mx)).toBe('$finish');
  });

  it('reads the reply while its bundled edit only continues the stream', async () => {
    const mx = setup([replyWithBundledEdit('streaming')]);

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(receiptTarget(mx)).toBe('$answer');
  });
});

describe('markThreadAsRead, ties and the server fallback', () => {
  it("reads the finishing edit the server bundled with its newest reply", async () => {
    const mx = setup([]);
    const answer = replyWithBundledEdit('completed');
    mx.fetchRelations.mockImplementation(async (...args: unknown[]) => ({
      chunk: args[2] === RelationType.Thread ? [answer.event] : [],
    }));

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(receiptTarget(mx)).toBe('$finish');
  });

  it('never moves the receipt back to a reply that ties with a later one', async () => {
    // The server's summary names an earlier reply with the same timestamp as the last loaded one,
    // which the reader's receipt already names.
    const earlier = reply('$earlier', 3);
    const later = reply('$later', 3);
    const mx = setup([earlier, later], '$later');
    const thread = mx.getRoom().getThread();
    thread.replyToEvent = earlier;

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(mx.sendReceipt).not.toHaveBeenCalled();
  });

  it('reads the later of two tied replies by their order in the thread', async () => {
    const earlier = reply('$earlier', 3);
    const later = reply('$later', 3);
    const mx = setup([earlier, later]);
    const thread = mx.getRoom().getThread();
    thread.replyToEvent = earlier;

    await markThreadAsRead(mx as never, ROOM_ID, THREAD_ID, false);

    expect(receiptTarget(mx)).toBe('$later');
  });
});

describe('markRoomAndThreadsAsRead, streamed replies', () => {
  it('reads the room up to the edit that finished a thread reply', async () => {
    const finish = editIn('$finish', 4, '$answer', 'completed');
    const mx = setup([reply('$answer', 2), finish]);

    await markRoomAndThreadsAsRead(mx as never, ROOM_ID, false);

    expect(mx.sendReadReceipt).toHaveBeenCalledWith(finish, ReceiptType.Read, true);
  });

  it('sends the receipt for a bundled finishing edit to the room, which the bundle leaves out', async () => {
    const mx = setup([replyWithBundledEdit('completed')]);

    await markRoomAndThreadsAsRead(mx as never, ROOM_ID, false);

    expect(mx.sendReadReceipt).toHaveBeenCalledTimes(1);
    const [event, type, unthreaded] = mx.sendReadReceipt.mock.calls[0] as [
      MatrixEvent,
      ReceiptType,
      boolean,
    ];
    expect([event.getId(), event.getRoomId(), type, unthreaded]).toEqual([
      '$finish',
      ROOM_ID,
      ReceiptType.Read,
      true,
    ]);
  });
});

describe('markMainTimelineAsRead, streamed thread replies', () => {
  it('skips a finishing edit of a thread reply the main timeline does not hold', async () => {
    const question = message('$question', 1, { msgtype: 'm.text', body: 'Ready?' });
    // Synced into the main timeline because the client has not loaded the reply it edits.
    const finish = message('$finish', 4, {
      msgtype: 'm.text',
      body: '* Done',
      'm.new_content': { msgtype: 'm.text', body: 'Done', 'io.mindroom.stream_status': 'completed' },
      'm.relates_to': { rel_type: RelationType.Replace, event_id: '$unloaded-reply' },
    });
    const ownEdit = message('$own-edit', 5, {
      msgtype: 'm.text',
      body: '* Ready now?',
      'm.new_content': { msgtype: 'm.text', body: 'Ready now?' },
      'm.relates_to': { rel_type: RelationType.Replace, event_id: '$question' },
    });
    const mx = setup([]);
    const room = mx.getRoom();
    room.getLiveTimeline.mockReturnValue({ getEvents: () => [question, finish] });

    await markMainTimelineAsRead(mx as never, ROOM_ID, false);
    expect(receiptTarget(mx)).toBe('$question');

    // The same when the reply is there, but in its thread.
    mx.sendReceipt.mockClear();
    const answer = reply('$unloaded-reply', 2);
    room.getLiveTimeline.mockReturnValue({ getEvents: () => [question, answer, finish] });
    await markMainTimelineAsRead(mx as never, ROOM_ID, false);
    expect(receiptTarget(mx)).toBe('$question');

    // An edit of a message the main timeline holds is still read.
    mx.sendReceipt.mockClear();
    room.getLiveTimeline.mockReturnValue({ getEvents: () => [question, finish, ownEdit] });
    await markMainTimelineAsRead(mx as never, ROOM_ID, false);
    expect(receiptTarget(mx)).toBe('$own-edit');
  });
});
