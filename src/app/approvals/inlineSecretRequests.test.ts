import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { MINDROOM_SECRET_REQUEST_KEY } from '../matrix/protocol/secretRequest';
import { planInlineSecretRequests } from './inlineSecretRequests';

const AGENT = '@mindroom_dev:example.org';
const ROOT = '$root';

const reply = (
  id = '$reply',
  { sender = AGENT, callIds = ['call_1', 'call_2'], body = '🔧 `shell` [1]\n\n🔧 `ask` [2]' } = {}
) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    sender,
    content: {
      msgtype: 'm.text',
      body,
      'io.mindroom.tool_trace': {
        version: 2,
        events: callIds.map((callId) => ({
          type: 'tool_call_completed',
          tool_name: 'shell',
          tool_call_id: callId,
        })),
      },
    },
  });

const card = (
  id = '$card',
  {
    sender = AGENT,
    anchor = { response_event_id: '$reply', tool_call_id: 'call_2' } as object,
  } = {}
) =>
  new MatrixEvent({
    event_id: id,
    type: 'm.room.message',
    sender,
    content: {
      msgtype: 'm.notice',
      body: 'Secret needed',
      [MINDROOM_SECRET_REQUEST_KEY]: {
        request_id: 'req-1',
        requester_id: '@bas:example.org',
        env: 'SUDO_PASSWORD',
        keep: { memory: 900 },
        reason: 'To restart',
        status: 'pending',
        expires_at: 1_000,
        ...anchor,
      },
    },
  });

const plan = (
  events: MatrixEvent[],
  { ignored = new Set<string>(), revealed = new Set<string>() } = {}
) =>
  planInlineSecretRequests({
    events,
    getContent: (event) => event.getContent(),
    isAgent: (userId) => !!userId?.startsWith('@mindroom_'),
    ignored,
    revealed,
    threadId: ROOT,
  });

describe('planInlineSecretRequests', () => {
  it("hides a card its reply draws, at the named call of the reply's trace", () => {
    const { hiddenEventIds, byReply } = plan([reply(), card()]);

    expect([...hiddenEventIds]).toEqual(['$card']);
    const drawn = byReply.get('$reply')?.get('call_2');
    expect(drawn?.eventId).toBe('$card');
    expect(drawn?.agentUserId).toBe(AGENT);
    expect(drawn?.request.kind).toBe('temporary');
  });

  it('keeps the row of a card that names no reply, as older backends send', () => {
    expect(plan([reply(), card('$card', { anchor: {} })]).hiddenEventIds.size).toBe(0);
  });

  it.each([
    ['the reply is not loaded', [card()]],
    ['the trace lacks the call', [reply('$reply', { callIds: ['call_1'] }), card()]],
    ['the reply shows no tool markers', [reply('$reply', { body: 'Done.' }), card()]],
    [
      'another agent sent the reply',
      [reply('$reply', { sender: '@mindroom_other:example.org' }), card()],
    ],
  ])('keeps the row when %s', (_case, events) => {
    const { hiddenEventIds, byReply } = plan(events);
    expect(hiddenEventIds.size).toBe(0);
    expect(byReply.size).toBe(0);
  });

  it('keeps the row of a card from someone who is not an agent', () => {
    const person = '@mallory:example.org';
    expect(
      plan([reply('$reply', { sender: person }), card('$card', { sender: person })]).hiddenEventIds
        .size
    ).toBe(0);
  });

  it('keeps the rows of the thread root, a revealed card and an ignored sender', () => {
    expect(plan([reply(), card(ROOT)]).hiddenEventIds.size).toBe(0);
    expect(plan([reply(), card()], { revealed: new Set(['$card']) }).hiddenEventIds.size).toBe(0);
    expect(plan([reply(), card()], { ignored: new Set([AGENT]) }).hiddenEventIds.size).toBe(0);
  });

  it('draws one card per call; a second one naming the same call keeps its row', () => {
    const { hiddenEventIds, byReply } = plan([reply(), card('$first'), card('$second')]);
    expect([...hiddenEventIds]).toEqual(['$first']);
    expect(byReply.get('$reply')?.get('call_2')?.eventId).toBe('$first');
  });

  it("reads the reply and the card as their rows show them, the latest edit's trace included", () => {
    const streaming = reply('$reply', { callIds: ['call_1'] });
    const edited = reply('$reply');
    const { hiddenEventIds } = planInlineSecretRequests({
      events: [streaming, card()],
      getContent: (event) => (event === streaming ? edited.getContent() : event.getContent()),
      isAgent: () => true,
      ignored: new Set(),
      revealed: new Set(),
    });
    expect([...hiddenEventIds]).toEqual(['$card']);
  });
});
