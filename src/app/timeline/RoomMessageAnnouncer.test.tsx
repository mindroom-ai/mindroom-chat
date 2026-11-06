import { EventEmitter } from 'events';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, MatrixEventEvent, RoomEvent, type Room } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomMessageAnnouncer, announcementBody } from './RoomMessageAnnouncer';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, values: { sender: string; body: string }) =>
      `${values.sender}: ${values.body}`,
  }),
}));

const ROOM_ID = '!room:example.org';
const ME = '@me:example.org';
const AGENT = '@mindroom_code:example.org';
let counter = 0;

const message = (
  sender: string,
  content: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): MatrixEvent => {
  counter += 1;
  return new MatrixEvent({
    type: 'm.room.message',
    room_id: ROOM_ID,
    sender,
    event_id: `$event${counter}`,
    origin_server_ts: Date.now(),
    content,
    ...extra,
  });
};

const createRoom = () => {
  const emitter = new EventEmitter();
  const threadList = {};
  const room = Object.assign(emitter, {
    roomId: ROOM_ID,
    getMember: (userId: string) =>
      userId === AGENT ? { userId, rawDisplayName: 'Code', disambiguate: false } : null,
    threadsTimelineSets: [threadList],
  }) as unknown as Room;
  const receive = (event: MatrixEvent, live = true) =>
    act(() => {
      emitter.emit(RoomEvent.Timeline, event, room, false, false, { liveEvent: live });
    });
  /** What the SDK does when it lists a thread, and at each reply to it: adds its root again. */
  const relist = (root: MatrixEvent) =>
    act(() => {
      emitter.emit(RoomEvent.Timeline, root, room, false, false, {
        liveEvent: true,
        timeline: { getTimelineSet: () => threadList },
      });
    });
  return { room, receive, relist };
};

/**
 * An encrypted message from the agent whose decryption the test runs: until an attempt works it
 * reads as the SDK shows a failure, a notice that it could not be decrypted.
 */
const lateKeyMessage = (body: string, extra?: Record<string, unknown>) => {
  const event = message(AGENT, { msgtype: 'm.text', body }, extra);
  const clear = event.getContent();
  let state: 'pending' | 'running' | 'failed' | 'decrypted' = 'pending';
  vi.spyOn(event, 'shouldAttemptDecryption').mockImplementation(() => state === 'pending');
  vi.spyOn(event, 'isBeingDecrypted').mockImplementation(() => state === 'running');
  vi.spyOn(event, 'isDecryptionFailure').mockImplementation(() => state === 'failed');
  vi.spyOn(event, 'getContent').mockImplementation(() =>
    state === 'decrypted' ? clear : { msgtype: 'm.bad.encrypted', body: '** Unable to decrypt **' }
  );
  const fail = () => {
    state = 'failed';
  };
  /** An attempt starts, as the SDK starts one when the event arrives. */
  const begin = () => {
    state = 'running';
  };
  const attempt = (outcome: 'fails' | 'works') =>
    act(() => {
      state = outcome === 'fails' ? 'failed' : 'decrypted';
      event.emit(MatrixEventEvent.Decrypted, event);
    });
  return { event, attempt, fail, begin };
};

const logLines = (renderer: ReactTestRenderer): string[] =>
  renderer.root.findAllByType('p').map((line) => String(line.children.join('')));

describe('RoomMessageAnnouncer', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
  });

  const render = (room: Room, threadId?: string) => {
    act(() => {
      renderer = create(<RoomMessageAnnouncer room={room} threadId={threadId} myUserId={ME} />);
    });
    return renderer!;
  };

  it('is a polite log that reads new messages from others with their sender', () => {
    const { room, receive } = createRoom();
    const view = render(room);
    expect(view.root.findByType('div').props).toMatchObject({ role: 'log', 'aria-live': 'polite' });

    receive(message(AGENT, { msgtype: 'm.text', body: 'The deck   is\nready.' }));
    receive(message(ME, { msgtype: 'm.text', body: 'Thanks' }));
    receive(message(AGENT, { msgtype: 'm.text', body: 'Old history' }), false);

    expect(logLines(view)).toEqual(['Code: The deck is ready.']);
  });

  it('reads a streamed reply once, when its final edit arrives', () => {
    const { room, receive } = createRoom();
    const view = render(room);
    const reply = message(AGENT, {
      msgtype: 'm.text',
      body: 'Draft',
      'io.mindroom.stream_status': 'streaming',
    });
    receive(reply);
    const edit = (body: string, status: string) =>
      message(AGENT, {
        msgtype: 'm.text',
        body: `* ${body}`,
        'm.new_content': { msgtype: 'm.text', body, 'io.mindroom.stream_status': status },
        'm.relates_to': { rel_type: 'm.replace', event_id: reply.getId() },
      });
    receive(edit('Draft two', 'streaming'));
    expect(logLines(view)).toEqual([]);

    receive(edit('Final answer', 'completed'));
    receive(edit('Final answer, edited later', 'completed'));
    expect(logLines(view)).toEqual(['Code: Final answer']);
  });

  it('only reads the open thread while a thread is open, and skips thread titles', () => {
    const { room, receive } = createRoom();
    const root = message(AGENT, { msgtype: 'm.text', body: 'Root' });
    const view = render(room, root.getId());
    const reply = (rootId: string, body: string) =>
      message(AGENT, {
        msgtype: 'm.text',
        body,
        'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
      });

    receive(reply('$other', 'Elsewhere'));
    receive(reply(root.getId()!, 'In this thread'));
    receive(
      message(AGENT, { msgtype: 'm.notice', body: 'Title', 'io.mindroom.thread_summary': {} })
    );

    expect(logLines(view)).toEqual(['Code: In this thread']);
  });

  it('drops a message that decrypts after the reader left its room', () => {
    const first = createRoom();
    const second = createRoom();
    const view = render(first.room);
    const pending = message(AGENT, { msgtype: 'm.text', body: 'Late secret' });
    pending.shouldAttemptDecryption = () => true;
    first.receive(pending);
    expect(pending.listenerCount(MatrixEventEvent.Decrypted)).toBe(1);

    act(() => {
      view.update(<RoomMessageAnnouncer room={second.room} threadId={undefined} myUserId={ME} />);
    });
    expect(pending.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    act(() => {
      pending.emit(MatrixEventEvent.Decrypted, pending);
    });

    expect(logLines(view)).toEqual([]);
  });

  it('reads a message once it decrypts in the open room', () => {
    const { room, receive } = createRoom();
    const view = render(room);
    const pending = message(AGENT, { msgtype: 'm.text', body: 'Decrypted later' });
    pending.shouldAttemptDecryption = () => true;
    receive(pending);
    expect(logLines(view)).toEqual([]);

    act(() => {
      pending.emit(MatrixEventEvent.Decrypted, pending);
    });

    expect(logLines(view)).toEqual(['Code: Decrypted later']);
    expect(pending.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });

  it('reads a message whose first decryption fails once its key arrives, not the failure', () => {
    const { room, receive } = createRoom();
    const view = render(room);
    const late = lateKeyMessage('Key came later');
    receive(late.event);

    late.attempt('fails');
    expect(logLines(view)).toEqual([]);

    late.attempt('works');
    expect(logLines(view)).toEqual(['Code: Key came later']);
    expect(late.event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
  });

  it('reads a message that arrives with its decryption already failed once its key arrives', () => {
    const { room, receive } = createRoom();
    const view = render(room);
    const late = lateKeyMessage('Forwarded key');
    late.fail();
    receive(late.event);
    expect(logLines(view)).toEqual([]);

    late.attempt('works');
    expect(logLines(view)).toEqual(['Code: Forwarded key']);
  });

  it('stops waiting for a key that comes too late to be news', () => {
    vi.useFakeTimers();
    try {
      const { room, receive } = createRoom();
      const view = render(room);
      const late = lateKeyMessage('Old news');
      receive(late.event);

      act(() => {
        vi.advanceTimersByTime(2 * 60_000);
      });
      late.attempt('works');

      expect(logLines(view)).toEqual([]);
      expect(late.event.listenerCount(MatrixEventEvent.Decrypted)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads a message older than the key wait on arrival once the attempt it came with works', () => {
    vi.useFakeTimers();
    try {
      const { room, receive } = createRoom();
      const view = render(room);
      act(() => {
        vi.advanceTimersByTime(5 * 60_000);
      });
      // A reconnect after a short drop brings a message sent three minutes ago, while the room
      // has been open for five.
      const old = lateKeyMessage('Sent before the drop', {
        origin_server_ts: Date.now() - 3 * 60_000,
      });
      old.begin();
      receive(old.event);
      expect(logLines(view)).toEqual([]);

      old.attempt('works');

      expect(logLines(view)).toEqual(['Code: Sent before the drop']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not read a root that a thread list adds again', () => {
    const { room, receive, relist } = createRoom();
    const view = render(room);

    relist(message(AGENT, { msgtype: 'm.text', body: 'Can someone review the deck?' }));
    expect(logLines(view)).toEqual([]);

    receive(message(AGENT, { msgtype: 'm.text', body: 'Reviewed.' }));
    expect(logLines(view)).toEqual(['Code: Reviewed.']);
  });

  it('cuts long messages', () => {
    const body = announcementBody({ body: 'word '.repeat(80) });
    expect(body!.length).toBeLessThanOrEqual(200);
    expect(body!.endsWith('…')).toBe(true);
    expect(announcementBody({ body: '   ' })).toBeUndefined();
  });

  it('reads a mention as the name its pill shows, and an unknown user ID as written', () => {
    const names: Record<string, string> = { '@mindroom_helper_t1:example.org': 'Helper' };
    const body = announcementBody(
      { body: '@mindroom_helper_t1:example.org could you help? Ask @someone:example.org too.' },
      (userId) => names[userId]
    );
    expect(body).toBe('@Helper could you help? Ask @someone:example.org too.');
  });

  it('reads a canvas notice as its title, not the fallback body for other clients', () => {
    const notice = {
      msgtype: 'm.notice',
      body: 'Interactive panel: Choose a plan. Open it in MindRoom Chat to respond.',
      'io.mindroom.ui_action': {
        version: 1,
        action: 'show_canvas',
        canvas: { title: 'Choose a plan', html: '<p>Which plan?</p>' },
      },
    };
    expect(announcementBody(notice)).toBe('Choose a plan');
  });
});
