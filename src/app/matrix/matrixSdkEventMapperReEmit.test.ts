import { createClient, MatrixEvent, MatrixEventEvent, Room, type IEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';

// The SDK's event mapper has the client re-emit each event's `Decrypted` (and `Replaced`), so
// listeners on the client hear every event decrypt. It skips an event the room already holds,
// whose model re-emits them already. The SDK kept that "already held" flag for the whole mapper,
// and a /sync batch is mapped by one mapper: after one held event, or a held bundled edit, every
// later new event of the batch decrypted unheard by the client. In an encrypted thread, the
// canvas index then never listed an agent's canvas, and a phone's room menu never offered it.

const ROOM_ID = '!room:example.org';
const VIEWER = '@alice:example.org';
const AGENT = '@mindroom_helper:example.org';

const encrypted = (eventId: string, extra: Partial<IEvent> = {}): Partial<IEvent> => ({
  event_id: eventId,
  room_id: ROOM_ID,
  sender: AGENT,
  origin_server_ts: 1,
  type: 'm.room.encrypted',
  content: { algorithm: 'm.megolm.v1.aes-sha2', ciphertext: eventId },
  ...extra,
});

/** A client whose room holds `held`, and the IDs of the events whose decryption it heard. */
const setup = () => {
  const mx = createClient({ baseUrl: 'https://example.org', userId: VIEWER });
  const room = new Room(ROOM_ID, mx, VIEWER);
  mx.getRoom = (roomId) => (roomId === ROOM_ID ? room : null);
  const held = new Map<string, MatrixEvent>();
  room.findEventById = (eventId) => held.get(eventId);
  const heard: Array<string | undefined> = [];
  mx.on(MatrixEventEvent.Decrypted, (event) => heard.push(event.getId()));
  return { mx, held, heard };
};

describe('SDK event mapper re-emits', () => {
  it('a new event’s decryption after an event the room holds in the same batch', () => {
    const { mx, held, heard } = setup();
    held.set('$held', new MatrixEvent(encrypted('$held')));
    // /sync maps a room's timeline with one mapper, without decrypting.
    const map = mx.getEventMapper({ decrypt: false });

    map(encrypted('$held'));
    const fresh = map(encrypted('$canvas'));
    fresh.emit(MatrixEventEvent.Decrypted, fresh);

    expect(heard).toEqual(['$canvas']);
  });

  it('a new event’s decryption when the room holds its bundled edit', () => {
    const { mx, held, heard } = setup();
    const edit = encrypted('$edit', {
      content: {
        algorithm: 'm.megolm.v1.aes-sha2',
        ciphertext: 'edit',
        'm.relates_to': { rel_type: 'm.replace', event_id: '$canvas' },
      },
    });
    held.set('$edit', new MatrixEvent(edit));

    const fresh = mx.getEventMapper({ decrypt: false })(
      encrypted('$canvas', { unsigned: { 'm.relations': { 'm.replace': edit } } })
    );
    fresh.emit(MatrixEventEvent.Decrypted, fresh);

    expect(heard).toEqual(['$canvas']);
  });

  it('an event mapped again once only', () => {
    const { mx, held, heard } = setup();
    const map = mx.getEventMapper({ decrypt: false });
    const first = map(encrypted('$canvas'));
    held.set('$canvas', first);

    expect(map(encrypted('$canvas'))).toBe(first);
    first.emit(MatrixEventEvent.Decrypted, first);

    expect(heard).toEqual(['$canvas']);
  });
});
