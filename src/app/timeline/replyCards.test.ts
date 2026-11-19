import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { NO_REPLY_CARDS, planReplyCards } from './replyCards';
import {
  MINDROOM_SCHEDULED_TASK_EVENT,
  parseScheduledTaskStateEvent,
} from '../matrix/protocol/scheduledTaskContract';
import { readChatUiAction } from '../matrix/protocol/chatUiProtocol';
import { getPendingRoomSchedules } from '../schedules/roomSchedules';

const HELPER = '@mindroom_helper:example.org';
const SCOUT = '@mindroom_scout:example.org';
const ALICE = '@alice:example.org';
const THREAD = '$root';

const inThread = (answered: string, fallback = false) => ({
  rel_type: 'm.thread',
  event_id: THREAD,
  is_falling_back: fallback,
  'm.in_reply_to': { event_id: answered },
});

const message = (
  id: string,
  sender: string,
  content: Record<string, unknown>,
  answered = '$ask',
  fallback = false
) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    sender,
    room_id: '!room:example.org',
    content: { 'm.relates_to': inThread(answered, fallback), ...content },
  });

const reply = (id: string, sender = HELPER, answered = '$ask') =>
  message(id, sender, { msgtype: 'm.text', body: 'Done.' }, answered);

const canvasNotice = (id: string, extra: Record<string, unknown> = {}, sender = HELPER) =>
  message(id, sender, {
    msgtype: 'm.notice',
    body: 'Interactive panel: Project Alpha KPIs. Open it in MindRoom Chat to respond.',
    'io.mindroom.ui_action': {
      version: 1,
      action: 'show_canvas',
      requester_id: ALICE,
      agent_user_id: sender,
      room_id: '!room:example.org',
      thread_id: THREAD,
      canvas: { title: 'Project Alpha KPIs', html: '<p>KPIs</p>' },
      ...extra,
    },
  });

const task = (workflow: Record<string, unknown>, status = 'pending') =>
  new MatrixEvent({
    type: MINDROOM_SCHEDULED_TASK_EVENT,
    state_key: 'task1234',
    sender: '@mindroom_router:example.org',
    content: {
      status,
      workflow: JSON.stringify({
        schedule_type: 'once',
        execute_at: '2026-11-20T09:30:00Z',
        message: '@helper review it with Bob',
        description: 'Weekly planning review',
        thread_id: THREAD,
        ...workflow,
      }),
    },
  });

// Alice and the agents are joined; an agent that left can no longer show its canvas.
const room = (left: string[] = []) => ({
  roomId: '!room:example.org',
  getMember: (userId: string) => ({ membership: left.includes(userId) ? 'leave' : 'join' }),
});
const read = (left?: string[]) => (event: MatrixEvent) =>
  readChatUiAction(event, ALICE, room(left) as never);

const plan = (
  events: MatrixEvent[],
  taskEvents: MatrixEvent[] = [],
  opts: Partial<Omit<Parameters<typeof planReplyCards>[0], 'events' | 'tasks'>> = {}
) =>
  planReplyCards({
    threadId: THREAD,
    viewerId: ALICE,
    readCanvas: read(),
    isHidden: () => false,
    revealed: new Set(),
    ...opts,
    events,
    tasks: getPendingRoomSchedules(taskEvents),
  });

const canvasOf = (notice: MatrixEvent) => ({ canvas: read()(notice) });

describe('planReplyCards', () => {
  it("puts a canvas under its agent's reply to the same message and hides the notice", () => {
    const notice = canvasNotice('$canvas');
    const result = plan([
      message('$ask', ALICE, { msgtype: 'm.text', body: 'Hi' }, THREAD),
      reply('$reply'),
      notice,
    ]);

    expect(result.byReply.get('$reply')).toEqual([canvasOf(notice)]);
    expect([...result.hiddenEventIds]).toEqual(['$canvas']);
  });

  it('ties a notice sent before the reply, and gives a retried reply the card', () => {
    const notice = canvasNotice('$canvas');
    const result = plan([notice, reply('$first'), reply('$retry')]);

    expect([...result.byReply.keys()]).toEqual(['$retry']);
  });

  it("keeps the notice's row without the same agent's reply to the same message", () => {
    expect(plan([reply('$reply', SCOUT), canvasNotice('$canvas')])).toBe(NO_REPLY_CARDS);
    expect(plan([reply('$reply', HELPER, '$other'), canvasNotice('$canvas')])).toBe(NO_REPLY_CARDS);
    // A thread fallback names the latest message, not one the reply answered.
    const { 'm.relates_to': _relation, ...content } = canvasNotice('$x').getContent();
    const fallback = message('$canvas', HELPER, content, '$ask', true);
    expect(plan([reply('$reply'), fallback])).toBe(NO_REPLY_CARDS);
  });

  it('keeps an inline canvas, which is its own page, and a notice a jump opened', () => {
    expect(plan([reply('$reply'), canvasNotice('$canvas', { inline: true })])).toBe(NO_REPLY_CARDS);
    const notice = canvasNotice('$canvas');
    expect(plan([reply('$reply'), notice], [], { revealed: new Set(['$canvas']) })).toBe(
      NO_REPLY_CARDS
    );
  });

  it('keeps the notice where no card can show: canvases off, its agent left, its reply hidden', () => {
    const events = [reply('$reply'), canvasNotice('$canvas')];
    expect(plan(events, [], { readCanvas: undefined })).toBe(NO_REPLY_CARDS);
    expect(plan(events, [], { readCanvas: read([HELPER]) })).toBe(NO_REPLY_CARDS);
    expect(plan(events, [], { isHidden: (event) => event.getId() === '$reply' })).toBe(
      NO_REPLY_CARDS
    );
  });

  it('plans nothing outside a thread view', () => {
    expect(plan([reply('$reply'), canvasNotice('$canvas')], [], { threadId: '' })).toBe(
      NO_REPLY_CARDS
    );
  });

  it('puts a reminder under the latest agent reply to the message its scheduling reply answered', () => {
    const reminder = parseScheduledTaskStateEvent(task({ source_event_id: '$ask' }));
    expect(reminder?.sourceEventId).toBe('$ask');
    const notice = canvasNotice('$canvas');
    const events = [reply('$scout', SCOUT), notice, reply('$reply'), reply('$x', HELPER, '$y')];
    const result = plan(events, [task({ source_event_id: '$ask' })]);

    expect(result.byReply.get('$reply')).toEqual([canvasOf(notice), { reminder }]);
    expect([...result.byReply.keys()]).toEqual(['$reply']);
  });

  it("shows a reminder only in its own thread, not under another thread's reply to the message", () => {
    const tasks = [task({ source_event_id: '$ask' })];
    expect(plan([reply('$reply')], tasks, { threadId: '$other-root' })).toBe(NO_REPLY_CARDS);
    expect(plan([reply('$reply')], tasks).byReply.get('$reply')).toHaveLength(1);
  });

  it('shows no reminder for a task saved before the link, or one no longer pending', () => {
    expect(plan([reply('$reply')], [task({})])).toBe(NO_REPLY_CARDS);
    expect(plan([reply('$reply')], [task({ source_event_id: '$ask' }, 'completed')])).toBe(
      NO_REPLY_CARDS
    );
  });
});
