import { EventEmitter } from 'events';
import {
  ClientEvent,
  createClient,
  EventStatus,
  FeatureSupport,
  MatrixEvent,
  MatrixEventEvent,
  PendingEventOrdering,
  Room,
  Thread,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getSyncedEdit, keepSyncedEdits } from './client/syncedEdits';
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

const edit = (
  id: string,
  sender: string,
  ts: number,
  body: string,
  target = '$message'
): Partial<IEvent> => ({
  event_id: id,
  room_id: ROOM,
  sender,
  origin_server_ts: ts,
  type: 'm.room.message',
  content: {
    msgtype: 'm.text',
    body: `* ${body}`,
    'm.new_content': { msgtype: 'm.text', body },
    'm.relates_to': { rel_type: 'm.replace', event_id: target },
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

const redaction = (id: string, redacts: string, ts: number, sender = AUTHOR) =>
  new MatrixEvent({
    event_id: id,
    room_id: ROOM,
    sender,
    origin_server_ts: ts,
    type: 'm.room.redaction',
    redacts,
    content: { redacts },
  });

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
const newestEdit = () => edit('$newest-edit', AUTHOR, 4, 'The forklift is back.');

describe('SDK edits older than the sender’s bundled edit', () => {
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

// A message's newest edit can reach the client only bundled with the message, after a reload or a
// gap, so the client holds no event for a redaction of that edit to apply to. The SDK patch drops
// the bundled edit from the message once someone allowed to redact it does.
describe('SDK redactions of an edit the client knows only from its bundle', () => {
  const MODERATOR = '@moderator:example.org';

  const state = (type: string, stateKey: string, content: Record<string, unknown>) =>
    new MatrixEvent({
      type,
      state_key: stateKey,
      sender: AUTHOR,
      room_id: ROOM,
      event_id: `$${type}-${stateKey}`,
      content,
    });

  /** A room where the moderator alone may redact other members' events. */
  const moderatedRoom = () => {
    const room = new Room(ROOM, client, AUTHOR, { timelineSupport: true });
    room.currentState.setStateEvents([
      state('m.room.create', '', { creator: AUTHOR, room_version: '10' }),
      ...[AUTHOR, OTHER, MODERATOR].map((userId) =>
        state('m.room.member', userId, { membership: 'join' })
      ),
      state('m.room.power_levels', '', { users: { [MODERATOR]: 50 }, redact: 50 }),
    ]);
    const add = async (...added: MatrixEvent[]) => {
      await room.addLiveEvents(added, { addToState: false });
      await tick();
    };
    return { room, add };
  };

  const message = async (...events: MatrixEvent[]) => {
    const { room, add } = moderatedRoom();
    await add(...events);
    return { room, add, event: room.findEventById('$message')! };
  };

  it.each([
    ['the edit’s sender', AUTHOR],
    ['a moderator', MODERATOR],
  ])('shows the original text once %s redacts the bundled edit', async (_, sender) => {
    const { room, add, event } = await message(bundled(newestEdit()));
    expect(body(event)).toBe('The forklift is back.');

    await add(redaction('$redaction', '$newest-edit', 5, sender));

    expect(body(event)).toBe('The forklift is charged.');
    expect(rendered(room, event)).toBe('The forklift is charged.');
    expect(event.replacingEvent()).toBeNull();
    expect(event.replacingEventId()).toBeUndefined();
  });

  it('shows the sender’s previous edit once the bundled edit is redacted', async () => {
    const { room, add, event } = await message(bundled(newestEdit()), new MatrixEvent(ownEdit()));
    expect(body(event)).toBe('The forklift is back.');

    await add(redaction('$redaction', '$newest-edit', 5));

    expect(body(event)).toBe('The forklift is at the dock.');
    expect(rendered(room, event)).toBe('The forklift is at the dock.');
  });

  it('ignores a redaction of the bundled edit by a member who may not redact it', async () => {
    const { room, add, event } = await message(bundled(newestEdit()));

    await add(redaction('$redaction', '$newest-edit', 5, OTHER));

    expect(body(event)).toBe('The forklift is back.');
    expect(rendered(room, event)).toBe('The forklift is back.');
  });

  it('keeps a newer edit that arrives while the previous edit still decrypts', async () => {
    const previous = new MatrixEvent(ownEdit());
    const { add, event } = await message(bundled(newestEdit()), previous);
    let decrypted = () => {};
    vi.spyOn(previous, 'isBeingDecrypted').mockReturnValue(true);
    vi.spyOn(previous, 'getDecryptionPromise').mockReturnValue(
      new Promise<void>((resolve) => {
        decrypted = resolve;
      })
    );

    await add(redaction('$redaction', '$newest-edit', 5));
    await add(new MatrixEvent(edit('$later-edit', AUTHOR, 6, 'Sold.')));
    decrypted();
    await tick();

    expect(body(event)).toBe('Sold.');
  });

  it('drops a bundled edit that the app hides because it could not read it yet', async () => {
    const { add, event } = await message(bundled(newestEdit()));
    // The app's replacingEvent() leaves out an edit that failed to decrypt (untrustedContent.ts);
    // the message would show it once its key arrives.
    vi.spyOn(event, 'replacingEvent').mockReturnValue(null);

    await add(redaction('$redaction', '$newest-edit', 5));

    expect(event.replacingEventId()).toBeUndefined();
  });

  describe('in an encrypted room', () => {
    afterEach(() => {
      // Forgets the edits the client kept.
      keepSyncedEdits(new EventEmitter() as unknown as MatrixClient)();
    });

    /**
     * Redacts the message's bundled edit, which the client keeps once it decrypts it: `decrypts`
     * before the redactions arrive or after them, as when its key comes later.
     */
    const redactKeptEdit = async (decrypts: 'before' | 'after', ...redactions: MatrixEvent[]) => {
      const { room, add, event } = await message(bundled(newestEdit()));
      const bundledEdit = event.replacingEvent();
      const mx = Object.assign(new EventEmitter(), { getRoom: () => room });
      keepSyncedEdits(mx as unknown as MatrixClient);
      if (decrypts === 'before') mx.emit(MatrixEventEvent.Decrypted, bundledEdit);
      await add(...redactions);
      redactions.forEach((redacted) => mx.emit(ClientEvent.Event, redacted));
      if (decrypts === 'after') mx.emit(MatrixEventEvent.Decrypted, bundledEdit);
      return { shown: rendered(room, event), kept: getSyncedEdit('$message')?.getId() };
    };

    it.each(['before', 'after'] as const)(
      'shows the original text once the sender redacts the bundled edit it decrypts %s',
      async (decrypts) => {
        expect(await redactKeptEdit(decrypts, redaction('$redaction', '$newest-edit', 5))).toEqual({
          shown: 'The forklift is charged.',
          kept: undefined,
        });
      }
    );

    it.each(['before', 'after'] as const)(
      'keeps the edit it decrypts %s another edit, or another member, is redacted',
      async (decrypts) => {
        expect(
          await redactKeptEdit(
            decrypts,
            redaction('$redaction', '$own-edit', 5),
            redaction('$second-redaction', '$newest-edit', 6, OTHER)
          )
        ).toEqual({ shown: 'The forklift is back.', kept: '$newest-edit' });
      }
    );
  });

  it('keeps the bundled edit when the sender redacts another of their edits', async () => {
    const { room, add, event } = await message(bundled(newestEdit()));

    await add(redaction('$redaction', '$own-edit', 5));

    expect(body(event)).toBe('The forklift is back.');
    expect(rendered(room, event)).toBe('The forklift is back.');
    expect(event.getServerAggregatedRelation<{ event_id: string }>('m.replace')?.event_id).toBe(
      '$newest-edit'
    );
  });

  describe('in threads', () => {
    let support: FeatureSupport;
    beforeEach(() => {
      support = Thread.hasServerSideSupport;
      vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
    });
    afterEach(() => {
      Thread.hasServerSideSupport = support;
      vi.restoreAllMocks();
    });

    /** A reply in the message's thread, with the sender's edit `$reply-edit` bundled. */
    const reply = (): Partial<IEvent> => ({
      ...original(),
      event_id: '$reply',
      origin_server_ts: 2,
      content: {
        msgtype: 'm.text',
        body: 'Is the forklift for sale?',
        'm.relates_to': { rel_type: 'm.thread', event_id: '$message' },
      },
      unsigned: {
        'm.relations': { 'm.replace': edit('$reply-edit', AUTHOR, 3, 'Sold.', '$reply') },
      },
    });

    it('shows the original text of a reply in an opened thread', async () => {
      Thread.hasServerSideSupport = FeatureSupport.None;
      const { room, add } = moderatedRoom();
      const root = new MatrixEvent(original());
      await add(root);
      const later = new MatrixEvent({ ...reply(), event_id: '$later-reply', unsigned: {} });
      const thread = room.createThread(
        '$message',
        root,
        [client.getEventMapper()(reply()), later],
        false
      );
      const shown = thread.findEventById('$reply')!;
      expect(body(shown)).toBe('Sold.');

      await add(redaction('$redaction', '$reply-edit', 5));

      expect(body(shown)).toBe('Is the forklift for sale?');
    });

    /** The message's thread as the thread list brings it, before it is opened. */
    const listedThread = async () => {
      Thread.hasServerSideSupport = FeatureSupport.Stable;
      const { room, add } = moderatedRoom();
      const root = client.getEventMapper()({
        ...original(),
        unsigned: {
          'm.relations': {
            'm.replace': newestEdit(),
            'm.thread': { count: 1, current_user_participated: false, latest_event: reply() },
          },
        },
      });
      room.processThreadRoots([root], false);
      await tick();
      return { add, root, thread: room.getThread('$message')! };
    };

    it('shows the original text of a root and latest reply known from the thread list', async () => {
      const { add, root, thread } = await listedThread();
      expect(body(root)).toBe('The forklift is back.');
      expect(body(thread.replyToEvent!)).toBe('Sold.');

      await add(
        redaction('$redaction', '$newest-edit', 5),
        redaction('$second-redaction', '$reply-edit', 6)
      );

      expect(body(root)).toBe('The forklift is charged.');
      expect(body(thread.replyToEvent!)).toBe('Is the forklift for sale?');
    });

    it('keeps a later edit that the latest reply of an unopened thread shows', async () => {
      const { add, thread } = await listedThread();
      // The app shows the edits that reach an unopened thread's latest reply (unopenedThreadEdits.ts).
      thread.replyToEvent!.makeReplaced(
        new MatrixEvent(edit('$later-edit', AUTHOR, 7, 'Sold to Sam.', '$reply'))
      );

      await add(redaction('$redaction', '$reply-edit', 8));

      expect(body(thread.replyToEvent!)).toBe('Sold to Sam.');
    });
  });
});
