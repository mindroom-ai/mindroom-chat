import {
  createClient,
  EventStatus,
  MatrixEvent,
  PendingEventOrdering,
  Room,
  type IEvent,
} from 'matrix-js-sdk';
import { describe, expect, it } from 'vitest';
import { getEditedEvent, getLatestMessageContent } from './room';

// Only a message's sender can edit it (Matrix specification, "Event replacements"). The SDK's own
// aggregation of live edits ignores another sender's edit, and our SDK patch makes
// `MatrixEvent.makeReplaced` ignore one too, so an edit the server bundles with a message, or one
// the client applies itself, cannot change another member's message. The patch also hides another
// sender's bundled edit from `getServerAggregatedRelation`, so it sets neither the message's edit id
// and time nor which of the sender's live edits shows.

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

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The text the timeline renders for the message, which also reads the edit bundled with it. */
const rendered = (room: Room, event: MatrixEvent) =>
  getLatestMessageContent(event, getEditedEvent('$message', event, room.getUnfilteredTimelineSet()))
    .body as unknown;

const live = async (...events: MatrixEvent[]) => {
  const room = new Room(ROOM, client, AUTHOR, { timelineSupport: true });
  await room.addLiveEvents(events, { addToState: false });
  await tick();
  return room.findEventById('$message')!;
};

describe('SDK edits from another sender', () => {
  it('ignores another sender’s edit the server bundles with the message', () => {
    const event = bundled(otherEdit());

    expect(body(event)).toBe('The forklift is charged.');
    expect(event.replacingEvent()).toBeNull();
    expect(event.replacingEventId()).toBeUndefined();
    expect(event.replacingEventDate()).toBeUndefined();
  });

  it('applies the sender’s own bundled edit', () => {
    const event = bundled(ownEdit());

    expect(body(event)).toBe('The forklift is at the dock.');
    expect(event.replacingEventId()).toBe('$own-edit');
    expect(event.replacingEventDate()?.getTime()).toBe(2);
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
    const event = await live(
      new MatrixEvent(original()),
      new MatrixEvent(ownEdit()),
      new MatrixEvent(otherEdit())
    );

    expect(body(event)).toBe('The forklift is at the dock.');
    expect(event.replacingEventId()).toBe('$own-edit');
  });

  it('applies the sender’s live edit older than another sender’s bundled edit', async () => {
    const event = await live(bundled(otherEdit()), new MatrixEvent(ownEdit()));

    expect(body(event)).toBe('The forklift is at the dock.');
    expect(event.replacingEventId()).toBe('$own-edit');
    expect(event.replacingEventDate()?.getTime()).toBe(2);
  });
});

// The SDK skips a sender's live edits older than the edit the server bundled with the message,
// which it shows. Those edits still arrive after the bundle: the edits that follow a message opened
// at its position (a search result, a link), or the sync catching up after a reload.
describe('SDK edits older than the sender’s bundled edit', () => {
  const newestEdit = () => edit('$newest-edit', AUTHOR, 4, 'The forklift is back.');

  it('keeps the bundled edit when an older live edit of the sender arrives after it', async () => {
    const event = await live(bundled(newestEdit()), new MatrixEvent(ownEdit()));

    expect(body(event)).toBe('The forklift is back.');
  });

  it('keeps the bundled edit of a message opened at its position', async () => {
    const mx = createClient({
      baseUrl: 'https://example.org',
      userId: AUTHOR,
      timelineSupport: true,
      fetchFn: async () =>
        new Response(
          JSON.stringify({
            event: { ...original(), unsigned: { 'm.relations': { 'm.replace': newestEdit() } } },
            events_before: [],
            events_after: [ownEdit()],
            state: [],
            start: 'start',
            end: 'end',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        ),
    });
    const room = new Room(ROOM, mx, AUTHOR, { timelineSupport: true });
    mx.store.storeRoom(room);

    await mx.getEventTimeline(room.getUnfilteredTimelineSet(), '$message');
    await tick();

    expect(body(room.findEventById('$message')!)).toBe('The forklift is back.');
  });

  const redaction = (id: string, redacts: string, ts: number) =>
    new MatrixEvent({
      event_id: id,
      room_id: ROOM,
      sender: AUTHOR,
      origin_server_ts: ts,
      type: 'm.room.redaction',
      redacts,
      content: { redacts },
    });

  it('shows the sender’s previous edit once the bundled edit is redacted', async () => {
    const room = new Room(ROOM, client, AUTHOR, { timelineSupport: true });
    const add = async (...events: MatrixEvent[]) => {
      await room.addLiveEvents(events, { addToState: false });
      await tick();
    };
    await add(bundled(newestEdit()), new MatrixEvent(ownEdit()), new MatrixEvent(newestEdit()));
    const event = room.findEventById('$message')!;
    expect(body(event)).toBe('The forklift is back.');

    await add(redaction('$redaction', '$newest-edit', 5));
    expect(body(event)).toBe('The forklift is at the dock.');
    expect(rendered(room, event)).toBe('The forklift is at the dock.');
    expect(event.replacingEvent()?.getId()).toBe('$own-edit');

    await add(redaction('$second-redaction', '$own-edit', 6));
    expect(event.replacingEvent()).toBeNull();
    expect(body(event)).toBe('The forklift is charged.');
    expect(rendered(room, event)).toBe('The forklift is charged.');
  });

  it('keeps the bundled edit when an older edit of the sender is redacted', async () => {
    const room = new Room(ROOM, client, AUTHOR, { timelineSupport: true });
    const add = async (...events: MatrixEvent[]) => {
      await room.addLiveEvents(events, { addToState: false });
      await tick();
    };
    await add(bundled(newestEdit()), new MatrixEvent(ownEdit()));
    await add(redaction('$redaction', '$own-edit', 5));
    const event = room.findEventById('$message')!;

    expect(body(event)).toBe('The forklift is back.');
    expect(rendered(room, event)).toBe('The forklift is back.');
  });

  /** The message after `events` arrive live, with the sender's edit `raw` pending on it. */
  const withPendingEdit = async (events: MatrixEvent[], raw: Partial<IEvent>) => {
    const room = new Room(ROOM, client, AUTHOR, {
      timelineSupport: true,
      pendingEventOrdering: PendingEventOrdering.Detached,
    });
    await room.addLiveEvents(events, { addToState: false });
    const event = room.findEventById('$message')!;
    const pending = new MatrixEvent(raw);
    pending.setStatus(EventStatus.NOT_SENT);
    room.addPendingEvent(pending, 'txn');
    await tick();
    const cancel = async () => {
      room.updatePendingEvent(pending, EventStatus.CANCELLED);
      await tick();
    };
    return { room, event, pending, cancel };
  };

  it('does not bring back a redacted bundled edit once the newer edit is redacted', async () => {
    const room = new Room(ROOM, client, AUTHOR, { timelineSupport: true });
    const add = async (...events: MatrixEvent[]) => {
      await room.addLiveEvents(events, { addToState: false });
      await tick();
    };
    await add(bundled(newestEdit()), new MatrixEvent(edit('$later-edit', AUTHOR, 5, 'Sold.')));
    const event = room.findEventById('$message')!;
    expect(body(event)).toBe('Sold.');

    await add(redaction('$redaction', '$newest-edit', 6));
    await add(redaction('$second-redaction', '$later-edit', 7));

    expect(body(event)).toBe('The forklift is charged.');
  });

  it('shows the sender’s previous edit once the bundled pending edit is cancelled', async () => {
    const { room, event, pending, cancel } = await withPendingEdit(
      [new MatrixEvent(original()), new MatrixEvent(ownEdit())],
      edit('~pending-edit', AUTHOR, 4, 'The forklift is back.')
    );
    // The client keeps the edit an event shows as its bundled edit when it merges another copy.
    event.setUnsigned({ 'm.relations': { 'm.replace': pending.event } });
    expect(body(event)).toBe('The forklift is back.');

    await cancel();

    expect(body(event)).toBe('The forklift is at the dock.');
    expect(rendered(room, event)).toBe('The forklift is at the dock.');
  });

  it('drops a pending edit of the sender once it is cancelled', async () => {
    const { event, cancel } = await withPendingEdit([new MatrixEvent(original())], {
      ...ownEdit(),
      event_id: '~pending-edit',
    });
    expect(body(event)).toBe('The forklift is at the dock.');

    await cancel();

    expect(event.replacingEvent()).toBeNull();
  });
});
