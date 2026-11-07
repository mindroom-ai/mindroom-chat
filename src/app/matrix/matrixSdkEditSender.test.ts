import { createClient, MatrixEvent, Room, type IEvent } from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';

// Only a message's sender can edit it (Matrix specification, "Event replacements"). The SDK's own
// aggregation of live edits ignores another sender's edit, and our SDK patch makes
// `MatrixEvent.makeReplaced` ignore one too, so an edit the server bundles with a message, or one
// the client applies itself, cannot change another member's message.

const ROOM = '!room:example.org';
const AUTHOR = '@author:example.org';
const OTHER = '@other:example.org';

const client = createClient({ baseUrl: 'https://example.org', userId: AUTHOR });

const original = (): Partial<IEvent> => ({
  event_id: '$message',
  room_id: ROOM,
  sender: AUTHOR,
  origin_server_ts: 1,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body: 'The forklift is charged.' },
});

const edit = (id: string, sender: string, ts: number, body: string): Partial<IEvent> => ({
  event_id: id,
  room_id: ROOM,
  sender,
  origin_server_ts: ts,
  type: 'm.room.message',
  content: {
    msgtype: 'm.text',
    body: `* ${body}`,
    'm.new_content': { msgtype: 'm.text', body },
    'm.relates_to': { rel_type: 'm.replace', event_id: '$message' },
  },
});

const ownEdit = () => edit('$own-edit', AUTHOR, 2, 'The forklift is at the dock.');
const otherEdit = () => edit('$other-edit', OTHER, 3, 'The forklift is broken.');

const bundled = (replacement: Partial<IEvent>) =>
  client.getEventMapper()({
    ...original(),
    unsigned: { 'm.relations': { 'm.replace': replacement } },
  });

const body = (event: MatrixEvent) => event.getContent().body as unknown;

describe('SDK edits from another sender', () => {
  it('ignores another sender’s edit the server bundles with the message', () => {
    const event = bundled(otherEdit());

    expect(body(event)).toBe('The forklift is charged.');
    expect(event.replacingEvent()).toBeNull();
  });

  it('applies the sender’s own bundled edit', () => {
    const event = bundled(ownEdit());

    expect(body(event)).toBe('The forklift is at the dock.');
  });

  it('keeps the sender’s edit when another sender’s edit is applied after it', () => {
    const event = new MatrixEvent(original());
    event.makeReplaced(new MatrixEvent(ownEdit()));
    event.makeReplaced(new MatrixEvent(otherEdit()));

    expect(body(event)).toBe('The forklift is at the dock.');
    expect(event.replacingEventId()).toBe('$own-edit');
  });

  it('still clears an applied edit', () => {
    const event = new MatrixEvent(original());
    event.makeReplaced(new MatrixEvent(ownEdit()));
    event.makeReplaced();

    expect(body(event)).toBe('The forklift is charged.');
    expect(event.replacingEvent()).toBeNull();
  });

  it('applies only the sender’s live edit', async () => {
    const room = new Room(ROOM, client, AUTHOR, { timelineSupport: true });
    await room.addLiveEvents(
      [new MatrixEvent(original()), new MatrixEvent(ownEdit()), new MatrixEvent(otherEdit())],
      { addToState: false }
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const event = room.findEventById('$message')!;
    expect(body(event)).toBe('The forklift is at the dock.');
    expect(event.replacingEventId()).toBe('$own-edit');
  });
});
