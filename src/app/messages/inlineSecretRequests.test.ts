import { MatrixEvent } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import {
  createDrawnSecretRequests,
  planInlineSecretRequests,
  secretRequestCards,
} from './inlineSecretRequests';
import { AGENT, cardEvent, replyEvent } from './test-utils/secretRequestEvents';

const ROOT = '$root';

const isAgent = (userId: string | undefined) => !!userId?.startsWith('@mindroom_');

const plan = (
  events: MatrixEvent[],
  {
    ignored = new Set<string>(),
    revealed = new Set<string>(),
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
    threadId: ROOT,
  });
};

/** The cards a plan lets a reply draw, as `reply/call: card`. */
const allowed = ({ byReply }: ReturnType<typeof plan>) =>
  [...byReply].flatMap(([replyId, calls]) =>
    [...calls].map(([callId, { eventId }]) => `${replyId}/${callId}: ${eventId}`)
  );

describe('planInlineSecretRequests', () => {
  it('lets the reply a done card names draw it, at the call it names', () => {
    const { byReply, waitingReplyIds } = plan([replyEvent(), cardEvent()]);

    expect(waitingReplyIds.size).toBe(0);
    const drawn = byReply.get('$reply')?.get('call_2');
    expect(drawn?.eventId).toBe('$card');
    expect(drawn?.agentUserId).toBe(AGENT);
    expect(drawn?.request.kind).toBe('temporary');
  });

  it.each([
    ['still streams', { status: 'streaming' }],
    ['shows no marker of the call', { body: 'Done.' }],
    ['has a trace without the call yet', { callIds: ['call_1'] }],
    ['is long text', { extra: { 'io.mindroom.long_text': { version: 2 } } }],
  ])('says nothing of what the reply shows: one that %s may draw it', (_case, reply) => {
    expect(allowed(plan([replyEvent('$reply', reply), cardEvent()]))).toEqual([
      '$reply/call_2: $card',
    ]);
  });

  it('allows nothing for a card that names no reply, as older backends send', () => {
    expect(allowed(plan([replyEvent(), cardEvent('$card', { anchor: {} })]))).toEqual([]);
  });

  it.each([
    ['the reply is not loaded', [cardEvent()]],
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
  ])('allows nothing when %s', (_case, events) => {
    expect(allowed(plan(events))).toEqual([]);
  });

  it('allows nothing for the thread root, a revealed card and an ignored sender', () => {
    expect(allowed(plan([replyEvent(), cardEvent(ROOT)]))).toEqual([]);
    const revealed = new Set(['$card']);
    expect(allowed(plan([replyEvent(), cardEvent()], { revealed }))).toEqual([]);
    const ignored = new Set([AGENT]);
    expect(allowed(plan([replyEvent(), cardEvent()], { ignored }))).toEqual([]);
  });

  it('allows nothing for a card not done yet, and names its reply as waiting', () => {
    const pending = plan([replyEvent(), cardEvent('$card', { status: 'pending' })]);
    expect(allowed(pending)).toEqual([]);
    expect([...pending.waitingReplyIds]).toEqual(['$reply']);
  });

  it('allows one card per call: a second one that names the same call keeps its row', () => {
    expect(allowed(plan([replyEvent(), cardEvent('$first'), cardEvent('$second')]))).toEqual([
      '$reply/call_2: $first',
    ]);
  });

  it('reads the card as its row shows it, and never the reply', () => {
    const reply = replyEvent();
    const pending = cardEvent('$card', { status: 'pending' });
    const getContent = vi.fn((event: MatrixEvent) =>
      event === pending ? cardEvent().getContent() : event.getContent()
    );

    expect(allowed(plan([reply, pending], { getContent }))).toEqual(['$reply/call_2: $card']);
    expect(getContent.mock.calls.filter(([event]) => event === reply)).toHaveLength(0);
  });
});

describe('createDrawnSecretRequests', () => {
  it('names a card from the moment a line takes it until that line releases it', () => {
    const drawn = createDrawnSecretRequests();
    const line = {};
    const changes = vi.fn();
    drawn.subscribe(changes);
    const none = drawn.getIds();
    expect(none.size).toBe(0);

    expect(drawn.take('$card', line)).toBe(true);
    expect([...drawn.getIds()]).toEqual(['$card']);
    expect(drawn.drawerOf('$card')).toBe(line);
    expect(none.size).toBe(0);

    drawn.release('$card', line);
    expect(drawn.getIds().size).toBe(0);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('gives a card to one line: the first keeps it, whatever a second does', () => {
    const drawn = createDrawnSecretRequests();
    const first = {};
    const second = {};
    drawn.take('$card', first);
    const changes = vi.fn();
    drawn.subscribe(changes);
    const ids = drawn.getIds();

    expect(drawn.take('$card', second)).toBe(false);
    drawn.release('$card', second);
    expect(drawn.take('$card', first)).toBe(true);

    expect(drawn.drawerOf('$card')).toBe(first);
    expect(drawn.getIds()).toBe(ids);
    expect(changes).not.toHaveBeenCalled();
  });

  it("gives a hidden line's card to a shown one, and no line's to a hidden one", () => {
    const drawn = createDrawnSecretRequests();
    const hidden = {};
    const shown = {};
    expect(drawn.take('$card', hidden, true)).toBe(true);
    expect(drawn.shows('$card')).toBe(false);
    expect(drawn.take('$card', shown)).toBe(true);
    expect(drawn.drawerOf('$card')).toBe(shown);
    expect(drawn.shows('$card')).toBe(true);
    expect(drawn.take('$card', hidden, true)).toBe(false);
    expect([...drawn.getIds()]).toEqual(['$card']);
  });

  it('tells no one who stopped listening', () => {
    const drawn = createDrawnSecretRequests();
    const changes = vi.fn();
    drawn.subscribe(changes)();
    drawn.take('$card', {});
    expect(changes).not.toHaveBeenCalled();
  });
});
