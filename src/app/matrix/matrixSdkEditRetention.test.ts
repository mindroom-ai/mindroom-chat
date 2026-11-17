import {
  createClient,
  Direction,
  EventStatus,
  FeatureSupport,
  MatrixEvent,
  MatrixEventEvent,
  Room,
  Thread,
  type IEvent,
} from 'matrix-js-sdk';
import { DecryptionError } from 'matrix-js-sdk/lib/common-crypto/CryptoBackend';
import { DecryptionFailureCode } from 'matrix-js-sdk/lib/crypto-api';
import { Feature, ServerSupport } from 'matrix-js-sdk/lib/feature';
import { RelationsEvent, setReplacementRetentionPolicy } from 'matrix-js-sdk/lib/models/relations';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getEditedEvent, getReleasableEdits } from './room';

// Upstream, a room's relations keep every edit of a message for as long as the room lives. An
// agent's streamed reply is edited hundreds of times, each edit with the whole text so far, so the
// room held all of them, and the SDK went through all of them again on every further edit. Our SDK
// patch lets the app say which of a sender's edits of a message the relations can release
// (`setReplacementRetentionPolicy`), and the app answers with the rule its thread seed follows too
// (`getReleasableEdits`): the edits it can neither show nor borrow MindRoom metadata from.

const ROOM = '!room:example.org';
const AGENT = '@agent:example.org';
const ME = '@me:example.org';
const ROOT = '$root';
const REPLY = '$reply';
const TOOL_TRACE = 'io.mindroom.tool_trace';
const STREAM_STATUS = 'io.mindroom.stream_status';

const message = (
  id: string,
  ts: number,
  content: Record<string, unknown>,
  sender = AGENT
): Partial<IEvent> => ({
  event_id: id,
  room_id: ROOM,
  sender,
  origin_server_ts: ts,
  type: 'm.room.message',
  content: { msgtype: 'm.text', body: id, ...content },
});
const editContent = (body: string, target: string, metadata: Record<string, unknown> = {}) => ({
  msgtype: 'm.text',
  body: `* ${body}`,
  'm.new_content': { msgtype: 'm.text', body, ...metadata },
  'm.relates_to': { rel_type: 'm.replace', event_id: target },
});
const edit = (id: string, ts: number, target = REPLY, sender = AGENT) =>
  new MatrixEvent(message(id, ts, editContent(id, target), sender));
const editWith = (id: string, ts: number, metadata: Record<string, unknown>) =>
  new MatrixEvent(message(id, ts, editContent(id, REPLY, metadata)));
const trace = (tool: string) => ({ version: 2, events: [{ tool_name: tool }] });
const reaction = (id: string, key: string, sender: string) =>
  new MatrixEvent({
    ...message(id, 5, {}, sender),
    type: 'm.reaction',
    content: { 'm.relates_to': { rel_type: 'm.annotation', event_id: REPLY, key } },
  });
const redaction = (id: string, redacts: string, ts: number, sender = AGENT) =>
  new MatrixEvent({ ...message(id, ts, { redacts }, sender), type: 'm.room.redaction', redacts });

/** An edit as an encrypted room delivers it, which fails to decrypt until its key arrives. */
const encryptedEdit = async (id: string, ts: number, metadata: Record<string, unknown> = {}) => {
  const event = new MatrixEvent({
    ...message(id, ts, {}),
    type: 'm.room.encrypted',
    content: {
      algorithm: 'm.megolm.v1.aes-sha2',
      ciphertext: 'opaque',
      'm.relates_to': { rel_type: 'm.replace', event_id: REPLY },
    },
  });
  let keyed = false;
  const crypto = {
    decryptEvent: vi.fn(async () => {
      if (!keyed) {
        throw new DecryptionError(
          DecryptionFailureCode.MEGOLM_UNKNOWN_INBOUND_SESSION_ID,
          'no key yet'
        );
      }
      return { clearEvent: { type: 'm.room.message', content: editContent(id, REPLY, metadata) } };
    }),
  };
  await event.attemptDecryption(crypto as never);
  expect(event.isDecryptionFailure()).toBe(true);
  /** Another attempt without the key: the edit fails to decrypt again. */
  const failsAgain = () => event.attemptDecryption(crypto as never, { isRetry: true });
  const keyArrives = () => {
    keyed = true;
    return event.attemptDecryption(crypto as never, { isRetry: true });
  };
  return { event, failsAgain, keyArrives };
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The edits the timelines of `room` hold, its threads' included. */
const timelineEdits = (room: Room) =>
  [...room.getThreads().map((thread) => thread.timelineSet), ...room.getTimelineSets()]
    .flatMap((timelineSet) =>
      timelineSet.getTimelines().flatMap((timeline) => timeline.getEvents())
    )
    .filter((event) => event.getRelation()?.rel_type === 'm.replace');

/**
 * The edits a timeline of `room` holds that its relations do not: none, but for one redacted or
 * still being decrypted, which the relations have not taken (yet). Nothing reads an edit from a
 * timeline, so one the relations released is gone from the timelines too.
 */
const unheldTimelineEdits = (room: Room) =>
  timelineEdits(room)
    .filter((event) => !event.isRedacted() && !event.isBeingDecrypted())
    .filter(
      (event) =>
        !room.relations
          .getAllChildEventsForEvent(event.getRelation()?.event_id ?? '')
          .includes(event)
    )
    .map((event) => event.getId());

describe('the edits a room keeps of a message', () => {
  let support: FeatureSupport;
  let rooms: Room[] = [];
  beforeEach(() => {
    rooms = [];
    support = Thread.hasServerSideSupport;
    Thread.hasServerSideSupport = FeatureSupport.None;
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    // As the app does before it starts a client (initMatrix.ts).
    setReplacementRetentionPolicy(getReleasableEdits);
  });
  afterEach(() => {
    for (const room of rooms) expect(unheldTimelineEdits(room)).toEqual([]);
    setReplacementRetentionPolicy(undefined);
    Thread.hasServerSideSupport = support;
    vi.restoreAllMocks();
  });

  /** A room of a client that is offline: the SDK asks the server for a message the room does not hold. */
  const offlineRoom = () => {
    const fetchFn = () => Promise.reject(new Error('offline'));
    const client = createClient({ baseUrl: 'https://example.org', userId: ME, fetchFn });
    vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
    const room = new Room(ROOM, client, ME, { timelineSupport: true });
    vi.spyOn(client, 'getRoom').mockReturnValue(room);
    rooms.push(room);
    return { client, room };
  };

  /** A room with the agent's reply in a thread, and how its events arrive: live, as the sync brings them. */
  const roomWithReply = async () => {
    const { room } = offlineRoom();
    const add = async (...events: MatrixEvent[]) => {
      await room.addLiveEvents(events, { addToState: false });
      await tick();
    };
    await add(
      new MatrixEvent(message(ROOT, 1, {}, ME)),
      new MatrixEvent(
        message(REPLY, 2, { 'm.relates_to': { rel_type: 'm.thread', event_id: ROOT } })
      )
    );
    const reply = room.findEventById(REPLY);
    if (!reply) throw new Error('the room does not hold the reply');
    const edits = (target = REPLY) =>
      room.relations.getChildEventsForEvent(target, 'm.replace', 'm.room.message');
    const kept = (target = REPLY) =>
      edits(target)
        ?.getRelations()
        .map((event) => event.getId());
    /** The IDs the relations refuse to take again. */
    const ids = (target = REPLY) => [
      ...(edits(target) as unknown as { relationEventIds: Set<string> }).relationEventIds,
    ];
    const shown = () =>
      getEditedEvent(REPLY, reply, room.getUnfilteredTimelineSet())?.getContent()[
        'm.new_content'
      ] as Record<string, unknown> | undefined;
    /** The IDs of the edits the room's timelines hold. */
    const inTimelines = () => timelineEdits(room).map((event) => event.getId());
    return { room, add, reply, edits, kept, ids, shown, inTimelines };
  };

  it('are one after 50 edits of a streamed reply: the newest', async () => {
    const { room, add, reply, kept, ids, inTimelines } = await roomWithReply();

    for (let round = 1; round <= 50; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await add(edit(`$edit-${round}`, 10 + round));
    }

    expect(kept()).toEqual(['$edit-50']);
    expect(ids()).toEqual(['$edit-50']);
    expect(reply.replacingEvent()?.getId()).toBe('$edit-50');
    // Nothing reads an edit from a timeline, so the thread's holds only the kept one too.
    expect(inTimelines()).toEqual(['$edit-50']);
    // The thread shows the reply from the same relations.
    expect(room.getThread(ROOT)?.timelineSet.relations).toBe(room.relations);
  });

  it('are all of them while the app installed no policy, as upstream', async () => {
    setReplacementRetentionPolicy(undefined);
    const { add, kept, inTimelines } = await roomWithReply();

    for (let round = 1; round <= 50; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await add(edit(`$edit-${round}`, 10 + round));
    }

    expect(kept()).toHaveLength(50);
    expect(inTimelines()).toHaveLength(50);
  });

  it('leave out an older edit that arrives after a newer one', async () => {
    const { add, reply, kept, ids, inTimelines } = await roomWithReply();

    await add(edit('$newest', 20));
    await add(edit('$older', 10));

    // Released as the room took it, the older edit never enters the thread's timeline.
    expect(inTimelines()).toEqual(['$newest']);
    expect(kept()).toEqual(['$newest']);
    expect(ids()).toEqual(['$newest']);
    expect(reply.replacingEvent()?.getId()).toBe('$newest');
  });

  it('are each sender’s newest, and of two sent at the same time the one the app shows', async () => {
    const { add, reply, kept } = await roomWithReply();

    await add(edit('$first', 10), edit('$not-the-sender', 11, REPLY, ME));
    await add(edit('$tie-b', 20), edit('$tie-a', 20));

    expect(kept()).toEqual(['$not-the-sender', '$tie-b']);
    expect(reply.replacingEvent()?.getId()).toBe('$tie-b');
  });

  it('are one for a message the room does not hold, too', async () => {
    const { add, kept } = await roomWithReply();

    for (let round = 1; round <= 5; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await add(edit(`$edit-${round}`, 10 + round, '$unknown'));
    }

    expect(kept('$unknown')).toEqual(['$edit-5']);
  });

  it('are one in the room’s own timeline too, for a message outside any thread', async () => {
    const { room, add, kept, inTimelines } = await roomWithReply();
    // An agent that answers in the room, not in a thread (`io.mindroom.thread_mode` room).
    await add(new MatrixEvent(message('$main', 3, {})));

    for (let round = 1; round <= 5; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await add(edit(`$edit-${round}`, 10 + round, '$main'));
    }

    expect(kept('$main')).toEqual(['$edit-5']);
    expect(inTimelines()).toEqual(['$edit-5']);
    expect(
      room
        .getLiveTimeline()
        .getEvents()
        .map((event) => event.getId())
    ).toEqual([ROOT, '$main', '$edit-5']);
  });

  it('leave an older segment that held only edits empty, with its tokens and links', async () => {
    const { room, add, inTimelines } = await roomWithReply();
    const thread = room.getThread(ROOT);
    if (!thread) throw new Error('the room has no thread');
    const { timelineSet } = thread;
    const live = timelineSet.getLiveTimeline();
    // A window of the thread before a sync gap, which saw only the stream's edits.
    const older = timelineSet.addTimeline();
    older.setNeighbouringTimeline(live, Direction.Forward);
    live.setNeighbouringTimeline(older, Direction.Backward);
    const page = [edit('$edit-2', 12), edit('$edit-1', 11)];
    // As every path that pages a thread does first (appendThreadBootstrapRelations).
    page.forEach((event) => thread.setEventMetadata(event));
    timelineSet.addEventsToTimeline(page, true, false, older, 'before-older');
    older.setPaginationToken('after-older', Direction.Forward);
    expect(inTimelines()).toEqual(['$edit-2']);

    await add(edit('$edit-3', 13));

    expect(inTimelines()).toEqual(['$edit-3']);
    expect(older.getEvents()).toEqual([]);
    expect(timelineSet.getTimelines()).toContain(older);
    expect(timelineSet.getTimelineForEvent('$edit-2')).toBeNull();
    expect(room.findEventById('$edit-2')).toBeUndefined();
    expect(older.getPaginationToken(Direction.Backward)).toBe('before-older');
    expect(older.getPaginationToken(Direction.Forward)).toBe('after-older');
    expect(older.getNeighbouringTimeline(Direction.Forward)).toBe(live);
    expect(live.getNeighbouringTimeline(Direction.Backward)).toBe(older);
  });

  it('are one in a thread the server lists, of a page that brings the newest edit first', async () => {
    Thread.hasServerSideSupport = FeatureSupport.Stable;
    const { client, room } = offlineRoom();
    client.canSupport.set(Feature.RelationsRecursion, ServerSupport.Stable);
    const root = new MatrixEvent(message(ROOT, 1, {}, ME));
    await room.addLiveEvents([root], { addToState: false });
    // Opened: its first page is in.
    const thread = room.createThread(ROOT, root, [], false);
    thread.initialEventsFetched = true;
    thread.replayEvents = null;
    await room.addLiveEvents(
      [
        new MatrixEvent(
          message(REPLY, 2, { 'm.relates_to': { rel_type: 'm.thread', event_id: ROOT } })
        ),
      ],
      { addToState: false }
    );
    await tick();
    const reply = room.findEventById(REPLY);
    if (!reply) throw new Error('the thread does not hold the reply');
    thread.liveTimeline.setPaginationToken('before-reply', Direction.Backward);
    vi.spyOn(client, 'fetchRelations').mockResolvedValue({
      chunk: [3, 2, 1].map((round) => edit(`$edit-${round}`, 10 + round).event as IEvent),
      next_batch: 'older',
    });

    await client.paginateEventTimeline(thread.liveTimeline, { backwards: true });
    await tick();

    expect(timelineEdits(room).map((event) => event.getId())).toEqual(['$edit-3']);
    expect(getEditedEvent(REPLY, reply, thread.timelineSet)?.getId()).toBe('$edit-3');
    expect(thread.liveTimeline.getPaginationToken(Direction.Backward)).toBe('older');
  });

  it('keep the edit whose tool trace a final edit without one borrows', async () => {
    const { add, kept, shown } = await roomWithReply();

    for (let round = 1; round <= 5; round += 1) {
      // eslint-disable-next-line no-await-in-loop
      await add(
        editWith(`$traced-${round}`, 10 + round, {
          [STREAM_STATUS]: 'streaming',
          [TOOL_TRACE]: trace(`tool-${round}`),
        })
      );
    }
    expect(kept()).toEqual(['$traced-5']);
    // The backend's text fallback for a reply whose sidecar it could not send: no tool trace.
    await add(editWith('$body-1', 21, { [STREAM_STATUS]: 'streaming' }));
    await add(editWith('$final', 22, { [STREAM_STATUS]: 'completed' }));

    expect(kept()).toEqual(['$traced-5', '$final']);
    expect(shown()).toMatchObject({
      body: '$final',
      [STREAM_STATUS]: 'completed',
      [TOOL_TRACE]: trace('tool-5'),
    });
  });

  it('listen to, and announce, only the kept edit of a batch that came at once', async () => {
    const { add, edits, kept } = await roomWithReply();
    await add(edit('$first', 10));
    const announced = vi.fn();
    edits()?.on(RelationsEvent.Add, announced);
    const batch = [1, 2, 3, 4, 5].map((round) => edit(`$edit-${round}`, 10 + round));

    await add(...batch);

    expect(kept()).toEqual(['$edit-5']);
    expect(announced.mock.calls).toEqual([[batch[4]]]);
    // The room listens to each of them itself; the relations to the one they hold.
    const [newest = 0, ...released] = batch
      .map((event) => event.listenerCount(MatrixEventEvent.BeforeRedaction))
      .reverse();
    expect(released).toEqual([newest - 1, newest - 1, newest - 1, newest - 1]);
  });

  // Redacting the newest edit shows the newest edit the room still holds: an older one kept for its
  // metadata if there is one, as main falls back to the previous edit, otherwise the original text.
  describe('once the newest edit is redacted', () => {
    // The room no longer holds the previous edit, as after the homeserver's purge of edits over 24 hours old.
    it('show the original text, without an edit kept for its metadata', async () => {
      const { add, reply, kept, shown } = await roomWithReply();
      await add(edit('$previous', 10), edit('$newest', 20));

      await add(redaction('$redaction', '$newest', 30));

      expect(kept()).toEqual([]);
      expect(reply.replacingEvent()).toBeNull();
      expect(shown()).toBeUndefined();
    });

    it('show the older edit kept for its metadata', async () => {
      const { add, reply, kept, shown } = await roomWithReply();
      await add(editWith('$traced', 10, { [TOOL_TRACE]: trace('search') }), edit('$newest', 20));
      expect(kept()).toEqual(['$traced', '$newest']);

      await add(redaction('$redaction', '$newest', 30));

      expect(kept()).toEqual(['$traced']);
      expect(reply.replacingEvent()?.getId()).toBe('$traced');
      expect(shown()).toMatchObject({ body: '$traced', [TOOL_TRACE]: trace('search') });
    });

    it('take an older edit again that arrives again', async () => {
      const { room, add, reply, kept, shown } = await roomWithReply();
      const older = edit('$older', 10);
      await add(older, edit('$newest', 20));
      await add(redaction('$redaction', '$newest', 30));
      expect(kept()).toEqual([]);

      // A page of history, or the first page of its thread, brings the edit again.
      room.relations.aggregateChildEvent(older);
      await tick();

      expect(kept()).toEqual(['$older']);
      expect(reply.replacingEvent()).toBe(older);
      expect(shown()?.body).toBe('$older');
    });
  });

    // A message's edits fetched with its relations: the relations hold them, no timeline does.
    it.each(['readable', 'unreadable'] as const)(
      'release an older %s edit the room knows redacted only through its bundle',
      async (kind) => {
        const { room, add, reply, kept, shown } = await roomWithReply();
        await add(edit('$readable', 20));
        const older =
          kind === 'readable'
            ? { event: editWith('$older', 10, { [TOOL_TRACE]: trace('search') }), keyArrives: tick }
            : await encryptedEdit('$older', 10, { [TOOL_TRACE]: trace('search') });
        room.relations.aggregateChildEvent(older.event);
        await tick();
        expect(kept()).toEqual(['$readable', '$older']);
        expect(room.findEventById('$older')).toBeUndefined();
        reply.setUnsigned({ 'm.relations': { 'm.replace': { ...older.event.event } } });

        await add(redaction('$redact-bundle', '$older', 40));
        await older.keyArrives();
        await tick();

        expect(room.redactedBundledEdits.has('$older')).toBe(true);
        expect(kept()).toEqual(['$readable']);
        expect(shown()?.[TOOL_TRACE]).toBeUndefined();
      }
    );

  describe('with an edit of the user’s own that is still being sent', () => {
    /** The user's message with a sent edit and a pending one, which the server names `$echoed`. */
    const withPendingEdit = async () => {
      const made = await roomWithReply();
      await made.add(new MatrixEvent(message('$mine', 3, {}, ME)), edit('$sent', 4, '$mine', ME));
      const mine = made.room.findEventById('$mine');
      const pending = edit('~pending', 5, '$mine', ME);
      pending.setStatus(EventStatus.SENDING);
      pending.setTxnId('txn');
      made.room.addPendingEvent(pending, 'txn');
      await tick();
      expect(made.kept('$mine')).toEqual(['$sent', '~pending']);
      expect(mine?.replacingEvent()).toBe(pending);
      // A pending edit is never released, so the older sent one stays in the timeline too.
      expect(made.inTimelines()).toEqual(['$sent', '~pending']);

      const sent = async () => {
        made.room.updatePendingEvent(pending, EventStatus.SENT, '$echoed');
        await tick();
      };
      const echoed = (ts = 6) => {
        const echo = edit('$echoed', ts, '$mine', ME);
        echo.setUnsigned({ transaction_id: 'txn' });
        return made.add(echo);
      };
      return { ...made, mine, pending, sent, echoed };
    };

    it.each([
      ['the server’s answer comes before the remote echo', ['sent', 'echoed']],
      ['the remote echo comes before the server’s answer', ['echoed', 'sent']],
    ] as const)('keep the sent edit until the remote echo, when %s', async (_, order) => {
      const made = await withPendingEdit();
      const { add, mine, pending, kept, ids } = made;

      await made[order[0]]();
      expect(kept('$mine')).toEqual(order[0] === 'sent' ? ['$sent', '$echoed'] : ['$echoed']);
      await made[order[1]]();

      expect(kept('$mine')).toEqual(['$echoed']);
      expect(ids('$mine')).not.toContain('$sent');
      expect(mine?.replacingEvent()).toBe(pending);

      // The next edit releases the echoed one, under the ID it came with too.
      await add(edit('$next', 7, '$mine', ME));
      expect(kept('$mine')).toEqual(['$next']);
      expect(ids('$mine')).toEqual(['$next']);
    });

    it('keep the pending edit when a sent edit is newer, as the server may date it later', async () => {
      const { add, echoed, mine, pending, kept } = await withPendingEdit();

      // Sent from another device, while this one's clock dated the pending edit earlier.
      await add(edit('$elsewhere', 6, '$mine', ME));
      expect(kept('$mine')).toEqual(['~pending', '$elsewhere']);

      await echoed(7);
      expect(kept('$mine')).toEqual(['$echoed']);
      expect(mine?.replacingEvent()).toBe(pending);
    });

    it('take the formerly pending edit again, under the ID the server gave it', async () => {
      const { room, add, echoed, mine, pending, kept, ids } = await withPendingEdit();
      await echoed();
      await add(edit('$next', 7, '$mine', ME));
      expect(kept('$mine')).toEqual(['$next']);

      // The same event, sent by now, as a read of the timeline that holds it aggregates it again.
      room.relations.aggregateChildEvent(pending);
      await tick();
      expect(kept('$mine')).toEqual(['$next']);
      expect(ids('$mine')).toEqual(['$next']);

      await add(redaction('$redaction', '$next', 8, ME));
      room.relations.aggregateChildEvent(pending);
      await tick();
      expect(kept('$mine')).toEqual(['$echoed']);
      expect(mine?.replacingEvent()).toBe(pending);
    });

    it('remember the formerly pending edit they hold by the ID the server gave it only', async () => {
      const { room, echoed, pending, kept, ids } = await withPendingEdit();
      await echoed();

      // A read of the timeline that holds it aggregates the held edit again, under its new ID.
      room.relations.aggregateChildEvent(pending);
      await tick();

      expect(kept('$mine')).toEqual(['$echoed']);
      expect(ids('$mine')).toEqual(['$echoed']);
    });

    it('show the sent edit again once the pending one is cancelled', async () => {
      const { room, mine, pending, kept } = await withPendingEdit();

      // It failed to send, and the user gives it up.
      room.updatePendingEvent(pending, EventStatus.NOT_SENT);
      room.updatePendingEvent(pending, EventStatus.CANCELLED);
      await tick();

      expect(kept('$mine')).toEqual(['$sent']);
      expect(mine?.replacingEvent()?.getId()).toBe('$sent');
    });
  });

  describe('with edits that cannot be decrypted', () => {
    it('keep the last edit the client can read, which the app shows', async () => {
      const { add, kept, shown } = await roomWithReply();
      const unreadable = await encryptedEdit('$unreadable', 30);

      await add(edit('$first', 10), edit('$readable', 20), unreadable.event);

      expect(kept()).toEqual(['$readable', '$unreadable']);
      expect(shown()?.body).toBe('$readable');
    });

    it('are one once their keys arrive, without a further edit', async () => {
      const { add, kept, shown } = await roomWithReply();
      const unreadable = [
        await encryptedEdit('$unreadable-1', 31),
        await encryptedEdit('$unreadable-2', 32),
        await encryptedEdit('$unreadable-3', 33),
      ];
      const listeners = unreadable.map(({ event }) =>
        event.listenerCount(MatrixEventEvent.Decrypted)
      );
      await add(edit('$readable', 20), ...unreadable.map(({ event }) => event));
      expect(kept()).toEqual(['$readable', '$unreadable-1', '$unreadable-2', '$unreadable-3']);

      // The stream is over; the keys of its last edits arrive one after another.
      await unreadable[0]?.keyArrives();
      expect(kept()).toEqual(['$unreadable-1', '$unreadable-2', '$unreadable-3']);
      await unreadable[1]?.keyArrives();
      await unreadable[2]?.keyArrives();

      expect(kept()).toEqual(['$unreadable-3']);
      expect(shown()?.body).toBe('$unreadable-3');
      // Neither the edits that left nor the one that stays are listened to any longer.
      expect(
        unreadable.map(({ event }) => event.listenerCount(MatrixEventEvent.Decrypted))
      ).toEqual(listeners);
    });

    /** An older edit with a tool trace that cannot be decrypted yet, and a newer readable one without. */
    const withOlderUnreadableEdit = async (order: 'unreadable first' | 'readable first') => {
      const made = await roomWithReply();
      const unreadable = await encryptedEdit('$unreadable', 10, { [TOOL_TRACE]: trace('search') });
      const listening = () => ({
        decrypted: unreadable.event.listenerCount(MatrixEventEvent.Decrypted),
        redaction: unreadable.event.listenerCount(MatrixEventEvent.BeforeRedaction),
      });
      const before = listening();
      const readable = edit('$readable', 20);
      // A page of a thread or of history comes decrypted, or failed to be, before the room adds it.
      if (order === 'unreadable first') await made.add(unreadable.event, readable);
      else await made.add(readable, unreadable.event);
      return { ...made, unreadable, listening, before };
    };

    it.each(['unreadable first', 'readable first'] as const)(
      'keep an older one until it decrypts, for the tool trace it may carry (%s)',
      async (order) => {
        const { kept, shown, unreadable } = await withOlderUnreadableEdit(order);
        expect(kept()?.slice().sort()).toEqual(['$readable', '$unreadable']);
        expect(shown()?.[TOOL_TRACE]).toBeUndefined();

        await unreadable.keyArrives();
        await tick();

        expect(kept()?.slice().sort()).toEqual(['$readable', '$unreadable']);
        expect(shown()).toMatchObject({ body: '$readable', [TOOL_TRACE]: trace('search') });
      }
    );

    // The accepted cost: an edit whose key never arrives stays, as every edit did before the policy.
    it('keep an older one for as long as it cannot be decrypted', async () => {
      const { add, kept, unreadable, listening, before } =
        await withOlderUnreadableEdit('readable first');

      await unreadable.failsAgain();
      await add(edit('$later', 30));

      expect(unreadable.event.isDecryptionFailure()).toBe(true);
      expect(kept()).toEqual(['$unreadable', '$later']);
      expect(listening()).toEqual({
        decrypted: before.decrypted + 1,
        redaction: before.redaction + 1,
      });
    });

    it('let an older one go once it decrypts without metadata of its own', async () => {
      const made = await roomWithReply();
      const unreadable = await encryptedEdit('$unreadable', 10);
      const before = unreadable.event.listenerCount(MatrixEventEvent.Decrypted);
      await made.add(edit('$readable', 20), unreadable.event);
      expect(made.kept()).toEqual(['$readable', '$unreadable']);
      expect(made.inTimelines()).toEqual(['$readable', '$unreadable']);

      await unreadable.keyArrives();
      await tick();

      expect(made.kept()).toEqual(['$readable']);
      expect(made.ids()).toEqual(['$readable']);
      expect(made.inTimelines()).toEqual(['$readable']);
      expect(unreadable.event.listenerCount(MatrixEventEvent.Decrypted)).toBe(before);
    });

    it.each(['before', 'after'] as const)(
      'let an older one go that is redacted %s it decrypts, and stop listening to it',
      async (when) => {
        const { add, kept, shown, unreadable, listening, before } =
          await withOlderUnreadableEdit('readable first');

        if (when === 'after') await unreadable.keyArrives();
        await add(redaction('$redaction', '$unreadable', 30));
        if (when === 'before') await unreadable.keyArrives();
        await tick();

        expect(unreadable.event.isRedacted()).toBe(true);
        expect(kept()).toEqual(['$readable']);
        expect(shown()?.[TOOL_TRACE]).toBeUndefined();
        expect(listening()).toEqual(before);
      }
    );

    it('let an older one go that was still being decrypted as the timeline took it', async () => {
      const made = await roomWithReply();
      await made.add(edit('$readable', 20));
      const { event: older } = await encryptedEdit('$older', 10);
      let resolve!: (result: unknown) => void;
      const decrypting = older.attemptDecryption(
        { decryptEvent: () => new Promise((done) => (resolve = done)) } as never,
        { isRetry: true }
      );
      expect(older.isBeingDecrypted()).toBe(true);
      await made.add(older);
      // The relations wait for it to decrypt.
      expect(made.inTimelines()).toEqual(['$readable', '$older']);
      expect(made.kept()).toEqual(['$readable']);

      resolve({ clearEvent: { type: 'm.room.message', content: editContent('$older', REPLY) } });
      await decrypting;
      await tick();

      expect(made.kept()).toEqual(['$readable']);
      expect(made.inTimelines()).toEqual(['$readable']);
    });

    it('listen to an older one once while a newer one is still being decrypted', async () => {
      const made = await roomWithReply();
      const newest = await encryptedEdit('$newest', 30);
      await made.add(newest.event);
      let resolve!: (result: unknown) => void;
      const waiting = new Promise((done) => {
        resolve = done;
      });
      const retry = newest.event.attemptDecryption({ decryptEvent: () => waiting } as never, {
        isRetry: true,
      });
      const older = await encryptedEdit('$older', 10, { [TOOL_TRACE]: trace('search') });
      const before = older.event.listenerCount(MatrixEventEvent.BeforeRedaction);
      made.room.relations.aggregateChildEvent(older.event);
      made.room.relations.aggregateChildEvent(edit('$readable', 20));
      expect(made.kept()).toContain('$older');

      await older.keyArrives();
      await tick();
      resolve({ clearEvent: { type: 'm.room.message', content: editContent('$newest', REPLY) } });
      await retry;
      await tick();
      expect(made.kept()).toEqual(['$newest', '$older']);
      expect(older.event.listenerCount(MatrixEventEvent.BeforeRedaction)).toBe(before + 1);

      await made.add(editWith('$last', 40, { [TOOL_TRACE]: trace('new') }));

      expect(made.kept()).toEqual(['$last']);
      expect(older.event.listenerCount(MatrixEventEvent.BeforeRedaction)).toBe(before);
    });

  });

  it('leave the reactions to the message as they are', async () => {
    const { room, add } = await roomWithReply();

    await add(reaction('$up-1', '👍', ME), edit('$edit-1', 10), reaction('$up-2', '👍', AGENT));
    await add(edit('$edit-2', 11), reaction('$party', '🎉', ME));

    const reactions = room.relations.getChildEventsForEvent(REPLY, 'm.annotation', 'm.reaction');
    expect(reactions?.getRelations().map((event) => event.getId())).toEqual([
      '$up-1',
      '$up-2',
      '$party',
    ]);
    expect(
      reactions?.getSortedAnnotationsByKey()?.map(([key, events]) => [key, events.size])
    ).toEqual([
      ['👍', 2],
      ['🎉', 1],
    ]);
  });
});
