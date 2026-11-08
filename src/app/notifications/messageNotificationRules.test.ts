import { describe, expect, it, vi } from 'vitest';
import { MatrixEvent, type IContent, type MatrixClient, type Room } from 'matrix-js-sdk';
import {
  MESSAGE_NOTIFY_MAX_AGE_MS,
  getCompletedAgentReply,
  getEventThreadId,
  isNoticeOnScreen,
  readMessageNotice,
} from './messageNotificationRules';
import { defined } from '../../test/utils/defined';

const ME = '@me:example.org';
const AGENT = '@mindroom_code:example.org';
const ROOM = '!room:example.org';
const NOW = 1_700_000_000_000;

let counter = 0;
const makeEvent = (content: IContent, extra: Partial<Record<string, unknown>> = {}) => {
  counter += 1;
  return new MatrixEvent({
    type: 'm.room.message',
    room_id: ROOM,
    sender: AGENT,
    event_id: `$event${counter}`,
    origin_server_ts: NOW - 1000,
    content,
    ...extra,
  });
};

type Actions = { notify: boolean; tweaks?: { sound?: string; highlight?: boolean } };

/**
 * A client and a room that finds the `known` events, in which the account read `read` (by receipt
 * order) and whose threads hold the account's receipts `threadReceipts` (thread ID: event ID).
 */
const setup = (
  actions: Actions | null,
  known: MatrixEvent[] = [],
  read: string[] = [],
  threadReceipts: Record<string, string> = {}
) => {
  const getPushActionsForEvent = vi.fn<(event: MatrixEvent) => Actions | null>(() => actions);
  const client = {
    getUserId: () => ME,
    getPushActionsForEvent,
    getRooms: () => [],
  } as unknown as MatrixClient;
  const hasUserReadEvent = vi.fn(
    (userId: string, id: string) => userId === ME && read.includes(id)
  );
  const room = {
    roomId: ROOM,
    getMyMembership: () => 'join',
    findEventById: (id: string) => known.find((event) => event.getId() === id),
    hasUserReadEvent,
    getThread: (threadId: string) =>
      threadId in threadReceipts
        ? {
            getReadReceiptForUserId: (userId: string) =>
              userId === ME ? { eventId: threadReceipts[threadId] } : null,
          }
        : null,
  } as unknown as Room;
  return { client, room, getPushActionsForEvent, hasUserReadEvent };
};

const loud: Actions = { notify: true, tweaks: { sound: 'default', highlight: true } };

describe('readMessageNotice', () => {
  it('notifies with the sound and highlight the push actions ask for', () => {
    const { client, room } = setup(loud);
    const event = makeEvent({ msgtype: 'm.text', body: 'Deploy finished' });
    expect(readMessageNotice(client, room, event, NOW)).toEqual({
      roomId: ROOM,
      eventId: event.getId(),
      threadId: undefined,
      sender: AGENT,
      content: { msgtype: 'm.text', body: 'Deploy finished' },
      sound: true,
      highlight: true,
    });
  });

  it('stays quiet when the push rules do not notify', () => {
    const { client, room } = setup({ notify: false });
    expect(readMessageNotice(client, room, makeEvent({ body: 'x' }), NOW)).toBeUndefined();
  });

  it('never notifies for own, old or non-message events, or outside joined rooms', () => {
    const { client, room } = setup(loud);
    expect(readMessageNotice(client, room, makeEvent({ body: 'x' }, { sender: ME }), NOW)).toBe(
      undefined
    );
    const old = makeEvent({ body: 'x' }, { origin_server_ts: NOW - MESSAGE_NOTIFY_MAX_AGE_MS - 1 });
    expect(readMessageNotice(client, room, old, NOW)).toBeUndefined();
    const reaction = makeEvent({}, { type: 'm.reaction' });
    expect(readMessageNotice(client, room, reaction, NOW)).toBeUndefined();
    const left = { ...room, getMyMembership: () => 'leave' } as unknown as Room;
    expect(readMessageNotice(client, left, makeEvent({ body: 'x' }), NOW)).toBeUndefined();
  });

  it('stays quiet for a message read already, on this device or another', () => {
    const event = makeEvent({ msgtype: 'm.text', body: 'seen elsewhere' });
    // A live message is in the timeline that announced it.
    const { client, room } = setup(loud, [event], [event.getId() as string]);
    expect(readMessageNotice(client, room, event, NOW)).toBeUndefined();
  });

  it('names the thread of a thread reply', () => {
    const { client, room } = setup(loud);
    const reply = makeEvent({
      body: 'in thread',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    });
    expect(readMessageNotice(client, room, reply, NOW)?.threadId).toBe('$root');
    expect(getEventThreadId(makeEvent({ body: 'main' }))).toBeUndefined();
  });

  it('ignores ordinary edits', () => {
    const original = makeEvent({ msgtype: 'm.text', body: 'typo' });
    const { client, room, getPushActionsForEvent } = setup(loud, [original]);
    const edit = makeEvent({
      msgtype: 'm.text',
      body: '* fixed',
      'm.new_content': { msgtype: 'm.text', body: 'fixed' },
      'm.relates_to': { rel_type: 'm.replace', event_id: original.getId() },
    });
    expect(readMessageNotice(client, room, edit, NOW)).toBeUndefined();
    expect(getPushActionsForEvent).not.toHaveBeenCalled();
  });

  describe('a streamed agent reply', () => {
    const streamed = () =>
      makeEvent({
        msgtype: 'm.notice',
        body: '…',
        'io.mindroom.stream_status': 'streaming',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      });
    const finish = (reply: MatrixEvent, status = 'completed', msgtype = 'm.text') =>
      makeEvent({
        msgtype: 'm.text',
        body: '* @me:example.org the answer',
        'm.new_content': {
          msgtype,
          body: '@me:example.org the answer',
          'io.mindroom.stream_status': status,
        },
        'm.relates_to': { rel_type: 'm.replace', event_id: reply.getId() },
      });

    it('notifies once it completes, for the reply and its thread, by its final text', () => {
      const reply = streamed();
      const { client, room, getPushActionsForEvent } = setup(loud, [reply]);
      const notice = readMessageNotice(client, room, finish(reply), NOW);
      expect(notice).toMatchObject({
        eventId: reply.getId(),
        threadId: '$root',
        content: { body: '@me:example.org the answer' },
      });
      const judged = defined(getPushActionsForEvent.mock.calls[0], 'a push rule check')[0];
      expect(judged.getContent()).toEqual({
        msgtype: 'm.text',
        body: '@me:example.org the answer',
        'io.mindroom.stream_status': 'completed',
      });
      expect(judged.getId()).toBe(reply.getId());
    });

    // The server counts a finished reply as new from the edit that finished it, and the reader's
    // client sends a receipt on that edit only when the reader sees the reply finish.
    it('notifies when it completes after the reader saw only its start, here or elsewhere', () => {
      const reply = streamed();
      const edit = finish(reply);
      // The receipt the reader's client sent while the reply streamed names the reply.
      const { client, room } = setup(loud, [reply, edit], [defined(reply.getId(), 'reply id')]);
      expect(readMessageNotice(client, room, edit, NOW)).toMatchObject({
        eventId: reply.getId(),
        threadId: '$root',
      });
    });

    it('stays quiet once a receipt reads the edit that finished it', () => {
      const reply = streamed();
      const edit = finish(reply);
      const read = [defined(reply.getId(), 'reply id'), defined(edit.getId(), 'edit id')];
      const { client, room } = setup(loud, [reply, edit], read);
      expect(readMessageNotice(client, room, edit, NOW)).toBeUndefined();
    });

    it('in a thread this device never opened, is read only by a receipt naming its last edit', () => {
      // The SDK holds the edits of such a thread back, so the room cannot find the edit.
      const reply = streamed();
      const edit = finish(reply);
      const replyId = defined(reply.getId(), 'reply id');
      const glanced = setup(loud, [reply], [replyId], { $root: replyId });
      expect(readMessageNotice(glanced.client, glanced.room, edit, NOW)).toMatchObject({
        eventId: replyId,
      });
      // Asked about an event it cannot find, the SDK warns that this should not happen.
      expect(glanced.hasUserReadEvent).not.toHaveBeenCalledWith(ME, edit.getId());

      const watched = setup(loud, [reply], [replyId], { $root: defined(edit.getId(), 'edit id') });
      expect(readMessageNotice(watched.client, watched.room, edit, NOW)).toBeUndefined();
    });

    it('stays quiet for a placeholder still in progress, whatever its msgtype', () => {
      const { client, room, getPushActionsForEvent } = setup(loud);
      for (const status of ['pending', 'streaming', 'approval_pending']) {
        const placeholder = makeEvent({
          msgtype: 'm.text',
          body: 'Thinking...',
          'io.mindroom.stream_status': status,
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
        });
        expect(readMessageNotice(client, room, placeholder, NOW)).toBeUndefined();
      }
      expect(getPushActionsForEvent).not.toHaveBeenCalled();
    });

    it('notifies once a reply that started as an m.text placeholder completes', () => {
      const reply = makeEvent({
        msgtype: 'm.text',
        body: 'Thinking...',
        'io.mindroom.stream_status': 'pending',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
      });
      const { client, room } = setup(loud, [reply]);
      expect(readMessageNotice(client, room, finish(reply), NOW)).toMatchObject({
        eventId: reply.getId(),
        threadId: '$root',
        content: { body: '@me:example.org the answer' },
      });
    });

    it('does not notify for progress edits or for replies sent finished', () => {
      const reply = streamed();
      const { room } = setup(loud, [reply]);
      expect(getCompletedAgentReply(room, finish(reply, 'streaming', 'm.notice'))).toBe(undefined);
      const sentFinished = makeEvent({ msgtype: 'm.text', body: 'done' });
      const other = setup(loud, [sentFinished]);
      expect(getCompletedAgentReply(other.room, finish(sentFinished))).toBeUndefined();
      expect(getCompletedAgentReply(setup(loud).room, finish(reply))).toBeUndefined();
    });
  });
});

describe('isNoticeOnScreen', () => {
  it('is on screen only with focus, in its room, and in its thread when one is open', () => {
    const notice = { roomId: ROOM, threadId: '$root' };
    expect(isNoticeOnScreen(notice, { roomId: ROOM }, true)).toBe(true);
    expect(isNoticeOnScreen(notice, { roomId: ROOM }, false)).toBe(false);
    expect(isNoticeOnScreen(notice, { roomId: ROOM, threadId: '$root' }, true)).toBe(true);
    expect(isNoticeOnScreen(notice, { roomId: ROOM, threadId: '$other' }, true)).toBe(false);
    expect(isNoticeOnScreen(notice, { roomId: '!other:example.org' }, true)).toBe(false);
  });
});
