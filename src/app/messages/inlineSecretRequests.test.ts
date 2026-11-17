import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  planInlineSecretRequests,
  secretRequestAttachments,
  secretRequestCards,
} from './inlineSecretRequests';
import { AGENT, cardEvent, markers, replyEvent } from './test-utils/secretRequestEvents';

const ROOT = '$root';

const isAgent = (userId: string | undefined) => !!userId?.startsWith('@mindroom_');

const plan = (
  events: MatrixEvent[],
  {
    ignored = new Set<string>(),
    revealed = new Set<string>(),
    rows = new Set<string>(),
    getContent = (event: MatrixEvent) => event.getContent(),
  } = {}
) => {
  const byId = new Map(events.map((event) => [event.getId(), event]));
  return planInlineSecretRequests({
    cards: secretRequestCards(events, isAgent),
    getEvent: (id) => byId.get(id),
    getContent,
    ignored,
    revealed,
    rows,
    threadId: ROOT,
  });
};

describe('secretRequestAttachments', () => {
  it('maps each call ID to the marker the body renders for it', () => {
    const content = replyEvent('$r', { callIds: ['a', 'b', 'c'], body: markers(3) }).getContent();
    expect([...secretRequestAttachments(content)]).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ]);
  });

  it('leaves out a call the trace has but the body has no marker for yet', () => {
    const content = replyEvent('$r', { body: markers(1) }).getContent();
    expect([...secretRequestAttachments(content)]).toEqual([['call_1', 1]]);
  });

  it('leaves out a marker the renderer shows as text, and a reply of long text', () => {
    const fenced = replyEvent('$r', { body: '```\n🔧 `shell` [2]\n```\n\n🔧 `shell` [1]' });
    expect([...secretRequestAttachments(fenced.getContent())]).toEqual([['call_1', 1]]);
    const long = { ...replyEvent().getContent(), 'io.mindroom.long_text': { version: 2 } };
    expect(secretRequestAttachments(long).size).toBe(0);
  });
});

describe('planInlineSecretRequests', () => {
  it("hides a card its reply draws, at the named call's marker", () => {
    const { hiddenEventIds, byReply } = plan([replyEvent(), cardEvent()]);

    expect([...hiddenEventIds]).toEqual(['$card']);
    const drawn = byReply.get('$reply')?.get(2);
    expect(drawn?.eventId).toBe('$card');
    expect(drawn?.agentUserId).toBe(AGENT);
    expect(drawn?.request.kind).toBe('temporary');
  });

  it('keeps the row of a card whose call the trace has before its marker shows', () => {
    const { hiddenEventIds, byReply } = plan([
      replyEvent('$reply', { body: markers(1) }),
      cardEvent(),
    ]);
    expect(hiddenEventIds.size).toBe(0);
    expect(byReply.size).toBe(0);
  });

  it('keeps the row of a card that names no reply, as older backends send', () => {
    expect(plan([replyEvent(), cardEvent('$card', { anchor: {} })]).hiddenEventIds.size).toBe(0);
  });

  it.each([
    ['the reply is not loaded', [cardEvent()]],
    ['the trace lacks the call', [replyEvent('$reply', { callIds: ['call_1'] }), cardEvent()]],
    ['the reply shows no tool markers', [replyEvent('$reply', { body: 'Done.' }), cardEvent()]],
    [
      'another agent sent the reply',
      [replyEvent('$reply', { sender: '@mindroom_other:example.org' }), cardEvent()],
    ],
    [
      'someone who is not an agent sent both',
      [
        replyEvent('$reply', { sender: '@mallory:example.org' }),
        cardEvent('$card', { sender: '@mallory:example.org' }),
      ],
    ],
  ])('keeps the row when %s', (_case, events) => {
    const { hiddenEventIds, byReply } = plan(events);
    expect(hiddenEventIds.size).toBe(0);
    expect(byReply.size).toBe(0);
  });

  it('keeps the rows of the thread root, a revealed card and an ignored sender', () => {
    expect(plan([replyEvent(), cardEvent(ROOT)]).hiddenEventIds.size).toBe(0);
    const revealed = new Set(['$card']);
    expect(plan([replyEvent(), cardEvent()], { revealed }).hiddenEventIds.size).toBe(0);
    const ignored = new Set([AGENT]);
    expect(plan([replyEvent(), cardEvent()], { ignored }).hiddenEventIds.size).toBe(0);
  });

  it('keeps a pending card that showed as a row a row, and lets it move once done', () => {
    const rows = new Set(['$card']);
    const waiting = plan([replyEvent(), cardEvent()], { rows });
    expect(waiting.hiddenEventIds.size).toBe(0);
    expect([...waiting.pending]).toEqual(['$card']);

    const done = plan([replyEvent(), cardEvent('$card', { status: 'saved' })], { rows });
    expect([...done.hiddenEventIds]).toEqual(['$card']);
    expect(done.pending.size).toBe(0);
  });

  it('draws one card per call; a second one naming the same call keeps its row', () => {
    const { hiddenEventIds, byReply } = plan([
      replyEvent(),
      cardEvent('$first'),
      cardEvent('$second'),
    ]);
    expect([...hiddenEventIds]).toEqual(['$first']);
    expect(byReply.get('$reply')?.get(2)?.eventId).toBe('$first');
  });

  it('reads a reply that several cards name once', () => {
    const reply = replyEvent('$reply', { callIds: ['a', 'b', 'c'], body: markers(3) });
    const cards = ['a', 'b', 'c'].map((callId) =>
      cardEvent(`$card-${callId}`, {
        anchor: { response_event_id: '$reply', tool_call_id: callId },
      })
    );
    const getContent = vi.fn((event: MatrixEvent) => event.getContent());

    const { hiddenEventIds } = plan([reply, ...cards], { getContent });

    expect(hiddenEventIds.size).toBe(3);
    expect(getContent.mock.calls.filter(([event]) => event === reply)).toHaveLength(1);
  });

  it("reads the reply and the card as their rows show them, the latest edit's trace included", () => {
    const streaming = replyEvent('$reply', { callIds: ['call_1'] });
    const edited = replyEvent('$reply');
    const getContent = (event: MatrixEvent) =>
      event === streaming ? edited.getContent() : event.getContent();
    expect([...plan([streaming, cardEvent()], { getContent }).hiddenEventIds]).toEqual(['$card']);
  });
});
