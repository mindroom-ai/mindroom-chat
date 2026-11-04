import { EventEmitter } from 'events';
import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { MatrixEvent, RoomEvent, type Room } from 'matrix-js-sdk';
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
  const room = Object.assign(emitter, {
    roomId: ROOM_ID,
    getMember: (userId: string) => (userId === AGENT ? { name: 'Code' } : null),
  }) as unknown as Room;
  const receive = (event: MatrixEvent, live = true) =>
    act(() => {
      emitter.emit(RoomEvent.Timeline, event, room, false, false, { liveEvent: live });
    });
  return { room, receive };
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

  it('cuts long messages', () => {
    const body = announcementBody({ body: 'word '.repeat(80) });
    expect(body!.length).toBeLessThanOrEqual(200);
    expect(body!.endsWith('…')).toBe(true);
    expect(announcementBody({ body: '   ' })).toBeUndefined();
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
