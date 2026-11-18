// @vitest-environment jsdom
import { EventEmitter } from 'events';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { MatrixEvent, MatrixEventEvent, RoomEvent, type Room } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InlineSecretRequestPlan } from './inlineSecretRequests';
import { useInlineSecretRequestPlan } from './useInlineSecretRequestPlan';
import { AGENT, cardEvent, replyEvent } from './test-utils/secretRequestEvents';

const ROOM = '!room:example.org';
const NONE = new Set<string>();
const getContent = (event: MatrixEvent) => event.getContent();

const env = vi.hoisted(() => ({ client: undefined as unknown }));
vi.mock('../matrix/hooks/useMatrixClient', () => ({ useMatrixClient: () => env.client }));

let client: EventEmitter;
let room: Room;
let plans: InlineSecretRequestPlan[];
const plan = () => plans.at(-1)!;

function Thread({ events }: { events: MatrixEvent[] }) {
  plans.push(
    useInlineSecretRequestPlan({
      room,
      events,
      getContent,
      ignored: NONE,
      viewerId: '@bas:example.org',
      threadId: '$root',
    })
  );
  return null;
}

let host: HTMLDivElement;
let root: Root;
const render = (events: MatrixEvent[]) => act(() => root.render(<Thread events={events} />));

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  client = new EventEmitter();
  env.client = client;
  room = Object.assign(new EventEmitter(), { roomId: ROOM }) as unknown as Room;
  plans = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** `event` as the SDK has it before it decrypts, in the thread, and the decryption to come. */
const encrypted = (event: MatrixEvent) => {
  const wire = new MatrixEvent({
    event_id: event.getId(),
    type: 'm.room.encrypted',
    sender: event.getSender(),
    room_id: ROOM,
    content: {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'x',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    },
  });
  const decrypt = () =>
    act(() => {
      Object.assign(wire, { clearEvent: { type: event.getType(), content: event.getContent() } });
      client.emit(MatrixEventEvent.Decrypted, wire);
    });
  return { wire, decrypt };
};

describe('useInlineSecretRequestPlan', () => {
  it.each(['card', 'reply'] as const)(
    'brings the row back when the %s is redacted in place',
    (redacted) => {
      const events = { card: cardEvent(), reply: replyEvent() };
      render([events.reply, events.card]);
      expect([...plan().hiddenEventIds]).toEqual(['$card']);

      const redaction = new MatrixEvent({ type: 'm.room.redaction', sender: AGENT, content: {} });
      act(() => {
        events[redacted].makeRedacted(redaction, room);
        room.emit(RoomEvent.Redaction, redaction, room, '$root');
      });

      expect(plan().hiddenEventIds.size).toBe(0);
    }
  );

  it.each([
    ['the card, then the reply', ['card', 'reply']],
    ['the reply, then the card', ['reply', 'card']],
  ] as const)('draws the request once both decrypt: %s', (_case, order) => {
    const events = { card: encrypted(cardEvent()), reply: encrypted(replyEvent()) };
    render([events.reply.wire, events.card.wire]);
    expect(plan().hiddenEventIds.size).toBe(0);

    events[order[0]].decrypt();
    expect(plan().hiddenEventIds.size).toBe(0);
    events[order[1]].decrypt();

    expect([...plan().hiddenEventIds]).toEqual(['$card']);
  });

  it('keeps the same plan while the thread changes in ways that draw the same', () => {
    const events = [replyEvent(), cardEvent()];
    render(events);
    const first = plan();

    render([...events, replyEvent('$later')]);

    expect(plans.length).toBeGreaterThan(1);
    expect(plan()).toBe(first);
  });
});
