import { EventEmitter } from 'events';
import {
  ClientEvent,
  createClient,
  EventStatus,
  MatrixEvent,
  Room,
  RoomEvent,
  SyncState,
  type IEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncAccumulator } from 'matrix-js-sdk/lib/sync-accumulator';
import type { ISyncResponse } from 'matrix-js-sdk/lib/sync-accumulator';
import {
  CHANGE_SAVE_GAP_MS,
  dropRedactedContent,
  keepRedactionsInSavedSync,
  REDACTION_SAVE_GAP_MS,
} from './savedSyncRedactions';

type Deferred = { resolve: () => void };

const ME = '@me:example.org';

/** A client whose store saves only when asked to and reports whether it would save itself. */
const makeClient = ({
  sdkWantsSave = false,
  room,
  rooms = room ? [room] : [],
}: { sdkWantsSave?: boolean; room?: Room; rooms?: Room[] } = {}) => {
  const pending: Deferred[] = [];
  const store = {
    wantsSave: vi.fn<() => boolean>(() => sdkWantsSave),
    save: vi.fn(
      () =>
        new Promise<void>((resolve) => {
          pending.push({ resolve });
        })
    ),
  };
  const emitter = new EventEmitter();
  const mx = Object.assign(emitter, {
    store,
    getUserId: () => ME,
    getRoom: () => room ?? null,
    getRooms: () => rooms,
  }) as unknown as MatrixClient;
  const finishSaves = async () => {
    pending.splice(0).forEach(({ resolve }) => resolve());
    // Let the save's settle handlers run.
    await vi.advanceTimersByTimeAsync(0);
  };
  return { mx, emitter, store, finishSaves };
};

const synced = (type: string, eventId: string): MatrixEvent =>
  new MatrixEvent({
    type,
    event_id: eventId,
    room_id: '!room:example.org',
    sender: '@alice:example.org',
    origin_server_ts: 1,
    content: type === 'm.room.redaction' ? { redacts: '$reply' } : { body: 'hi' },
    ...(type === 'm.room.redaction' ? { redacts: '$reply' } : {}),
  });

/** One processed sync batch: its events, then the SDK's PREPARED or SYNCING report. */
const batch = (emitter: EventEmitter, events: MatrixEvent[], state = SyncState.Syncing) => {
  events.forEach((event) => emitter.emit(ClientEvent.Event, event));
  emitter.emit(ClientEvent.Sync, state, SyncState.Syncing);
};

/** Lets the gap after the last save pass. */
const waitForGap = () => vi.advanceTimersByTimeAsync(REDACTION_SAVE_GAP_MS);

describe('keepRedactionsInSavedSync', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('saves the sync store after a redaction a room took without a synced event', async () => {
    const roomWith = (...editIds: string[]) =>
      ({ redactedBundledEdits: new Set(editIds) } as unknown as Room);
    const forgotten = roomWith('$old-edit');
    const room = roomWith();
    const rooms = [forgotten, room];
    const { mx, emitter, store, finishSaves } = makeClient({ rooms });
    keepRedactionsInSavedSync(mx);
    batch(emitter, [synced('m.room.message', '$reply')]);
    await finishSaves();
    store.save.mockClear();

    // A redaction that came with thread events paginated back, of an edit known only from a
    // bundle, while the account forgot another room.
    room.redactedBundledEdits.add('$edit');
    rooms.splice(0, 1);
    batch(emitter, []);
    await waitForGap();

    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('saves the sync store after a batch that brought a redaction', () => {
    const { mx, emitter, store } = makeClient();
    keepRedactionsInSavedSync(mx);

    batch(emitter, [synced('m.room.message', '$reply')]);
    expect(store.save).not.toHaveBeenCalled();

    batch(emitter, [synced('m.room.redaction', '$redaction')]);
    expect(store.save).toHaveBeenCalledTimes(1);
    expect(store.save).toHaveBeenCalledWith(true);

    batch(emitter, [synced('m.room.message', '$later')]);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('leaves the save to the SDK when it saves the batch itself', () => {
    const { mx, emitter, store } = makeClient({ sdkWantsSave: true });
    keepRedactionsInSavedSync(mx);

    batch(emitter, [synced('m.room.redaction', '$redaction')]);

    expect(store.save).not.toHaveBeenCalled();
  });

  it('waits for SYNCING: the saved sync replayed at startup only reports PREPARED', () => {
    const { mx, emitter, store } = makeClient();
    keepRedactionsInSavedSync(mx);

    batch(emitter, [synced('m.room.redaction', '$old-redaction')], SyncState.Prepared);
    expect(store.save).not.toHaveBeenCalled();

    // The first live batch: the SDK would save it, so nothing more happens.
    store.wantsSave.mockReturnValueOnce(true);
    batch(emitter, []);
    expect(store.save).not.toHaveBeenCalled();
    batch(emitter, []);
    expect(store.save).not.toHaveBeenCalled();
  });

  it('ignores a local redaction that is still being sent', () => {
    const { mx, emitter, store } = makeClient();
    keepRedactionsInSavedSync(mx);
    const local = synced('m.room.redaction', '~local');
    local.setStatus(EventStatus.SENDING);

    batch(emitter, [local]);

    expect(store.save).not.toHaveBeenCalled();
  });

  it('saves once more after a save that was still running when the next redaction came', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);

    batch(emitter, [synced('m.room.redaction', '$first')]);
    batch(emitter, [synced('m.room.redaction', '$second')]);
    batch(emitter, [synced('m.room.redaction', '$third')]);
    expect(store.save).toHaveBeenCalledTimes(1);

    await finishSaves();
    await waitForGap();
    expect(store.save).toHaveBeenCalledTimes(2);
    await finishSaves();
    await waitForGap();
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('gives a burst of redactions one more save after a gap, not one save each', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);

    batch(emitter, [synced('m.room.redaction', '$first')]);
    expect(store.save).toHaveBeenCalledTimes(1);
    await finishSaves();

    batch(emitter, [synced('m.room.redaction', '$second')]);
    await vi.advanceTimersByTimeAsync(REDACTION_SAVE_GAP_MS / 2);
    batch(emitter, [synced('m.room.redaction', '$third')]);
    expect(store.save).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(REDACTION_SAVE_GAP_MS / 2);
    expect(store.save).toHaveBeenCalledTimes(2);
    await finishSaves();
    await waitForGap();
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('drops a save still waiting for its gap when the SDK saves a later batch itself', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);
    batch(emitter, [synced('m.room.redaction', '$first')]);
    await finishSaves();

    batch(emitter, [synced('m.room.redaction', '$second')]);
    // The SDK's five minutes end with the next batch, which it saves with the redaction in it.
    store.wantsSave.mockReturnValueOnce(true);
    batch(emitter, []);
    await waitForGap();

    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('saves again when the SDK wanted to save while this save was still writing', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);
    batch(emitter, [synced('m.room.redaction', '$redaction')]);
    expect(store.save).toHaveBeenCalledTimes(1);

    // The SDK skips its own save while this one writes, and would wait five minutes more.
    store.wantsSave.mockReturnValueOnce(true);
    batch(emitter, [synced('m.room.message', '$skipped-by-the-sdk')]);
    await finishSaves();
    await waitForGap();

    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('stops listening when stopped, and drops a save still waiting', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    const stop = keepRedactionsInSavedSync(mx);
    batch(emitter, [synced('m.room.redaction', '$first')]);
    await finishSaves();
    batch(emitter, [synced('m.room.redaction', '$waiting')]);
    stop();

    batch(emitter, [synced('m.room.redaction', '$redaction')]);
    await waitForGap();

    expect(store.save).toHaveBeenCalledTimes(1);
    expect(emitter.listenerCount(ClientEvent.Event)).toBe(0);
    expect(emitter.listenerCount(ClientEvent.Sync)).toBe(0);
  });

  const stateEvent = (eventId: string) =>
    new MatrixEvent({
      type: 'm.room.member',
      event_id: eventId,
      room_id: '!room:example.org',
      sender: '@alice:example.org',
      state_key: '@alice:example.org',
      origin_server_ts: 1,
      content: { membership: 'join', displayname: 'Alice Renamed' },
    });
  const accountData = (type: string) => new MatrixEvent({ type, content: {} });

  it('saves a batch that changed room state, and keeps later changes for one save after a gap', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);

    batch(emitter, [stateEvent('$rename')]);
    expect(store.save).toHaveBeenCalledTimes(1);
    await finishSaves();

    batch(emitter, [stateEvent('$avatar')]);
    batch(emitter, [stateEvent('$topic')]);
    await vi.advanceTimersByTimeAsync(CHANGE_SAVE_GAP_MS - 1);
    expect(store.save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('saves account settings, but not a moved read marker', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);

    emitter.emit(RoomEvent.AccountData, accountData('m.fully_read'));
    batch(emitter, []);
    expect(store.save).not.toHaveBeenCalled();

    emitter.emit(ClientEvent.AccountData, accountData('io.mindroom.client.settings'));
    batch(emitter, []);
    expect(store.save).toHaveBeenCalledTimes(1);
    await finishSaves();

    emitter.emit(RoomEvent.AccountData, accountData('m.tag'));
    batch(emitter, []);
    await vi.advanceTimersByTimeAsync(CHANGE_SAVE_GAP_MS);
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  // A reload replays the saved sync: a room read on another device came back unread until the
  // server answered (P2-lane2-F001). The server sends the account's own receipts back to each of
  // its devices, so this covers reads on this device too.
  it("saves a batch with the account's own read receipt, not one with other people's", () => {
    const { mx, emitter, store } = makeClient();
    keepRedactionsInSavedSync(mx);
    const receipt = (userId: string, type: string, threadId?: string) =>
      new MatrixEvent({
        type: 'm.receipt',
        room_id: '!room:example.org',
        content: {
          $newest: {
            [type]: { [userId]: { ts: 1, ...(threadId ? { thread_id: threadId } : {}) } },
          },
        },
      });

    batch(emitter, [receipt('@alice:example.org', 'm.read')]);
    expect(store.save).not.toHaveBeenCalled();
    batch(emitter, [receipt(ME, 'm.read.private', '$root')]);
    expect(store.save).toHaveBeenCalledTimes(1);
  });

  it('lets a redaction cut short the wait of other changes', async () => {
    const { mx, emitter, store, finishSaves } = makeClient();
    keepRedactionsInSavedSync(mx);
    batch(emitter, [stateEvent('$first')]);
    await finishSaves();

    batch(emitter, [stateEvent('$second')]);
    batch(emitter, [synced('m.room.redaction', '$redaction')]);
    await waitForGap();
    expect(store.save).toHaveBeenCalledTimes(2);
  });

  it('saves a waiting change at once when the page is hidden', async () => {
    const page = Object.assign(new EventTarget(), { visibilityState: 'visible' });
    vi.stubGlobal('document', page);
    try {
      const { mx, emitter, store, finishSaves } = makeClient();
      const stop = keepRedactionsInSavedSync(mx);
      batch(emitter, [stateEvent('$first')]);
      await finishSaves();
      batch(emitter, [stateEvent('$second')]);
      expect(store.save).toHaveBeenCalledTimes(1);

      page.visibilityState = 'hidden';
      page.dispatchEvent(new Event('visibilitychange'));
      expect(store.save).toHaveBeenCalledTimes(2);
      stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

const ROOM = '!room:example.org';
const ALICE = '@alice:example.org';

let ts = 0;
const raw = (
  id: string,
  content: Record<string, unknown>,
  extra: Record<string, unknown> = {}
) => ({
  event_id: id,
  type: 'm.room.message',
  sender: ALICE,
  origin_server_ts: (ts += 1),
  content,
  ...extra,
});
const text = (body: string, extra: Record<string, unknown> = {}) => ({
  msgtype: 'm.text',
  body,
  ...extra,
});
const editOf = (id: string, target: string, body: string) =>
  raw(id, {
    ...text(`* ${body}`),
    'm.new_content': text(body),
    'm.relates_to': { rel_type: 'm.replace', event_id: target },
  });
const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } };
const redaction = (id: string, target: string) =>
  raw(id, { redacts: target }, { type: 'm.room.redaction', redacts: target });

/** One /sync response with `events` as the room's timeline. */
const syncOf = (events: object[], prevBatch: string, nextBatch: string, state: object[] = []) =>
  ({
    next_batch: nextBatch,
    rooms: {
      join: {
        [ROOM]: {
          timeline: { events, prev_batch: prevBatch, limited: false },
          state: { events: state },
          account_data: { events: [] },
          ephemeral: { events: [] },
          summary: {},
          unread_notifications: {},
        },
      },
    },
  } as unknown as ISyncResponse);

const savedTimeline = (accumulator: SyncAccumulator) =>
  accumulator.getJSON(true).roomsData.join[ROOM]?.timeline;

describe('dropRedactedContent', () => {
  it('drops the text of deleted messages, their edits and the copies bundled with others', () => {
    const accumulator = new SyncAccumulator({ maxTimelineEntries: 500 });
    const editedEdit = editOf('$edited-edit', '$edited', 'edited v2');
    const replyEdit = editOf('$reply-edit', '$reply', 'reply v2');
    accumulator.accumulate(
      syncOf(
        [
          raw('$plain', text('plain v1')),
          raw('$edited', text('edited v1'), {
            unsigned: { 'm.relations': { 'm.replace': editedEdit } },
          }),
          editedEdit,
          raw('$root', text('root stays'), {
            unsigned: {
              'm.relations': {
                'm.thread': {
                  count: 1,
                  latest_event: raw('$reply', text('reply v1', inThread), {
                    unsigned: { 'm.relations': { 'm.replace': replyEdit } },
                  }),
                },
              },
            },
          }),
          raw('$reply', text('reply v1', inThread)),
          replyEdit,
          raw('$kept', text('kept stays')),
          raw('$topic', { topic: 'topic stays' }, { type: 'm.room.topic', state_key: '' }),
        ],
        'token-1',
        'batch-1'
      )
    );
    accumulator.accumulate(
      syncOf(
        ['$plain', '$edited', '$reply', '$topic'].map((target) =>
          redaction(`$redacts-${target.slice(1)}`, target)
        ),
        'token-2',
        'batch-2'
      )
    );

    dropRedactedContent(accumulator as never);

    const timeline = savedTimeline(accumulator);
    const json = JSON.stringify(timeline);
    ['plain v1', 'edited v1', 'edited v2', 'reply v1', 'reply v2'].forEach((deleted) => {
      expect(json).not.toContain(deleted);
    });
    ['root stays', 'kept stays', 'topic stays'].forEach((kept) => expect(json).toContain(kept));
    const ids = timeline?.events.map((event) => event.event_id);
    expect(ids).not.toContain('$edited-edit');
    expect(ids).not.toContain('$reply-edit');
    const saved = (id: string) => timeline?.events.find((event) => event.event_id === id);
    expect(saved('$plain')?.content).toEqual({});
    // A reply keeps its relation, so the replayed redaction still finds it in its thread.
    expect(saved('$reply')?.content).toEqual(inThread);
    expect(saved('$redacts-reply')).toBeDefined();
    expect(timeline?.prev_batch).toBe('token-1');
  });

  it("drops the copies of deleted replies and titles beside a thread's summary", () => {
    const accumulator = new SyncAccumulator({ maxTimelineEntries: 500 });
    const replyEdit = editOf('$reply-edit', '$reply', 'reply v2');
    const notice = raw('$title', {
      msgtype: 'm.notice',
      body: 'title stays',
      'io.mindroom.thread_summary': { summary: 'title stays' },
      ...inThread,
    });
    accumulator.accumulate(
      syncOf(
        [
          raw('$root', text('root stays'), {
            unsigned: {
              'm.relations': {
                'm.thread': {
                  count: 2,
                  latest_event: notice,
                  'io.mindroom.title': notice,
                  'io.mindroom.latest_reply': raw('$reply', text('reply v1', inThread), {
                    unsigned: { 'm.relations': { 'm.replace': replyEdit } },
                  }),
                },
              },
            },
          }),
          raw('$reply', text('reply v1', inThread)),
          replyEdit,
          notice,
        ],
        'token-1',
        'batch-1'
      )
    );
    accumulator.accumulate(syncOf([redaction('$redacts-reply', '$reply')], 'token-2', 'b2'));

    dropRedactedContent(accumulator as never);

    const timeline = savedTimeline(accumulator);
    const json = JSON.stringify(timeline);
    ['reply v1', 'reply v2'].forEach((deleted) => expect(json).not.toContain(deleted));
    const root = timeline?.events.find((event) => event.event_id === '$root');
    expect(root?.unsigned?.['m.relations']?.['m.thread']).toEqual({
      count: 2,
      latest_event: notice,
      'io.mindroom.title': notice,
    });
  });

  it('drops an edit the room took a redaction of that the saved timeline does not hold', () => {
    const accumulator = new SyncAccumulator({ maxTimelineEntries: 500 });
    const bundled = editOf('$edit', '$message', 'message v2');
    accumulator.accumulate(
      syncOf(
        [
          raw('$message', text('message v1'), {
            unsigned: { 'm.relations': { 'm.replace': bundled } },
          }),
          raw('$root', text('root stays'), {
            unsigned: {
              'm.relations': {
                'm.thread': {
                  count: 1,
                  latest_event: raw('$reply', text('reply v1', inThread), {
                    unsigned: {
                      'm.relations': { 'm.replace': editOf('$reply-edit', '$reply', 'reply v2') },
                    },
                  }),
                },
              },
            },
          }),
        ],
        'token-1',
        'b1'
      )
    );

    dropRedactedContent(accumulator as never, () => new Set(['$edit', '$reply-edit']));

    const json = JSON.stringify(savedTimeline(accumulator));
    ['message v2', 'reply v2'].forEach((dropped) => expect(json).not.toContain(dropped));
    ['message v1', 'reply v1', 'root stays'].forEach((kept) => expect(json).toContain(kept));
  });

  it('gives the next event the pagination token of a dropped edit', () => {
    const accumulator = new SyncAccumulator({ maxTimelineEntries: 500 });
    accumulator.accumulate(
      syncOf([editOf('$edit', '$gone', 'gone v2'), raw('$next', text('next'))], 'token-1', 'b1')
    );
    accumulator.accumulate(syncOf([redaction('$redaction', '$gone')], 'token-2', 'b2'));

    dropRedactedContent(accumulator as never);

    const timeline = savedTimeline(accumulator);
    expect(timeline?.prev_batch).toBe('token-1');
    expect(timeline?.events.map((event) => event.event_id)).toEqual(['$next', '$redaction']);
  });

  it('runs before the save that follows a redaction', () => {
    const { mx, emitter, store } = makeClient();
    const accumulator = new SyncAccumulator({ maxTimelineEntries: 500 });
    accumulator.accumulate(syncOf([raw('$reply', text('reply v1'))], 'token-1', 'b1'));
    Object.assign(store, { backend: { syncAccumulator: accumulator } });
    store.save.mockImplementation(() => {
      expect(JSON.stringify(savedTimeline(accumulator))).not.toContain('reply v1');
      return Promise.resolve();
    });
    keepRedactionsInSavedSync(mx);

    accumulator.accumulate(syncOf([redaction('$redaction', '$reply')], 'token-2', 'b2'));
    batch(emitter, [synced('m.room.redaction', '$redaction')]);

    expect(store.save).toHaveBeenCalledTimes(1);
  });
});

// The SDK patch decides once, as a redaction arrives, whether its sender may redact an edit known
// only from a message's bundle. A reload replays the saved sync against the room's state after
// it, where the sender may no longer be a member.
describe('an edit redacted from a bundle, after a reload', () => {
  const MODERATOR = '@moderator:example.org';
  const sdk = createClient({ baseUrl: 'https://example.org', userId: ME });
  const map = (event: object) => sdk.getEventMapper()({ ...event, room_id: ROOM } as IEvent);
  const stateEvent = (
    type: string,
    stateKey: string,
    content: Record<string, unknown>,
    extra: object = {}
  ) =>
    raw(`$${type}-${stateKey}-${ts}`, content, {
      type,
      state_key: stateKey,
      ...extra,
    });
  const body = (room: Room) => room.findEventById('$message')?.getContent().body as unknown;

  it('stays gone once the moderator who redacted it left the room', async () => {
    const roomState = [
      stateEvent('m.room.create', '', { creator: ALICE, room_version: '10' }),
      ...[ALICE, MODERATOR].map((userId) =>
        stateEvent('m.room.member', userId, { membership: 'join' }, { sender: userId })
      ),
      stateEvent('m.room.power_levels', '', { users: { [MODERATOR]: 50 }, redact: 50 }),
    ];
    const message = raw('$message', text('message v1'), {
      unsigned: { 'm.relations': { 'm.replace': editOf('$edit', '$message', 'message v2') } },
    });
    const moderation = { ...redaction('$redaction', '$edit'), sender: MODERATOR };
    const leave = stateEvent(
      'm.room.member',
      MODERATOR,
      { membership: 'leave' },
      { sender: MODERATOR, unsigned: { prev_content: { membership: 'join' } } }
    );

    // The room takes the moderator's redaction as it arrives.
    const live = new Room(ROOM, sdk, ME, { timelineSupport: true });
    live.currentState.setStateEvents(roomState.map(map));
    await live.addLiveEvents([message, moderation].map(map), { addToState: false });
    expect(body(live)).toBe('message v1');

    const accumulator = new SyncAccumulator({ maxTimelineEntries: 500 });
    accumulator.accumulate(syncOf([message], 'token-1', 'b1', roomState));
    accumulator.accumulate(syncOf([moderation], 'token-2', 'b2'));
    accumulator.accumulate(syncOf([leave], 'token-3', 'b3'));
    const { mx, emitter, store } = makeClient({ room: live });
    Object.assign(store, { backend: { syncAccumulator: accumulator } });
    keepRedactionsInSavedSync(mx);
    batch(emitter, [synced('m.room.redaction', '$redaction')]);
    expect(store.save).toHaveBeenCalledTimes(1);

    // An offline reload: the SDK replays the saved timeline after setting the state after it.
    const saved = accumulator.getJSON(true).roomsData.join[ROOM]!;
    const reloaded = new Room(ROOM, sdk, ME, { timelineSupport: true });
    reloaded
      .getLiveTimeline()
      .initialiseState(saved['org.matrix.msc4222.state_after']!.events.map(map));
    await reloaded.addLiveEvents(saved.timeline.events.map(map), {
      addToState: false,
      fromCache: true,
    });

    expect(body(reloaded)).toBe('message v1');
    expect(JSON.stringify(saved.timeline)).not.toContain('message v2');
  });
});

// Only a redaction its sender may make, where it is in the timeline, removes a message, and the
// replay after a reload decides the same: it checks each redaction against the state at its place
// in the saved timeline, not against the state after it.
describe('a redacted message, after a reload', () => {
  const MODERATOR = '@moderator:example.org';
  const OTHER = '@other:elsewhere.org';
  const POWER_LEVELS = { users: { [MODERATOR]: 50 }, redact: 50 };
  const sdk = createClient({ baseUrl: 'https://example.org', userId: ME });
  const map = (event: object) => sdk.getEventMapper()(event as IEvent);
  const withRoom = (event: object) => ({ ...event, room_id: ROOM });
  const stateEvent = (type: string, stateKey: string, content: object, prevContent?: object) =>
    withRoom(
      raw(`$${type}-${stateKey}-${ts}`, content as Record<string, unknown>, {
        type,
        state_key: stateKey,
        sender: stateKey || MODERATOR,
        unsigned: prevContent ? { prev_content: prevContent } : {},
      })
    );
  const body = (room: Room) => room.findEventById('$message')?.getContent().body as unknown;

  /**
   * The room takes each batch as it arrives, after the state that follows it (MSC4222
   * state_after), and the SDK then saves it; the saved sync is scrubbed, then replayed after an
   * offline reload.
   */
  const liveAndReloaded = async (batches: object[][]) => {
    const roomState = [
      stateEvent('m.room.create', '', { creator: ALICE, room_version: '10' }),
      ...[ALICE, MODERATOR, OTHER].map((userId) =>
        stateEvent('m.room.member', userId, { membership: 'join' })
      ),
      stateEvent('m.room.power_levels', '', POWER_LEVELS),
    ];
    const live = new Room(ROOM, sdk, ME, { timelineSupport: true });
    live.currentState.setStateEvents(roomState.map(map));
    const accumulator = new SyncAccumulator({ maxTimelineEntries: 500 });
    for (const [index, events] of batches.entries()) {
      // The room and the saved sync share each event, as in the SDK's sync.
      const raws = events.map(withRoom);
      const mapped = raws.map(map);
      live.currentState.setStateEvents(mapped.filter((event) => event.isState()));
      await live.addLiveEvents(mapped, { addToState: false });
      accumulator.accumulate(
        syncOf(raws, `token-${index}`, `b${index}`, index === 0 ? roomState : [])
      );
    }
    const { mx, emitter, store } = makeClient({ room: live });
    Object.assign(store, { backend: { syncAccumulator: accumulator } });
    keepRedactionsInSavedSync(mx);
    batch(emitter, [synced('m.room.redaction', '$redaction')]);

    const saved = accumulator.getJSON(true).roomsData.join[ROOM]!;
    const reloaded = new Room(ROOM, sdk, ME, { timelineSupport: true });
    reloaded
      .getLiveTimeline()
      .initialiseState(saved['org.matrix.msc4222.state_after']!.events.map(map));
    await reloaded.addLiveEvents(saved.timeline.events.map(map), {
      addToState: false,
      fromCache: true,
    });
    return { live: body(live), reloaded: body(reloaded), saved: JSON.stringify(saved.timeline) };
  };

  const message = () => raw('$message', text('message v1'));
  const redactionBy = (sender: string) => ({ ...redaction('$redaction', '$message'), sender });

  it('stays when another member without the right redacted it', async () => {
    const result = await liveAndReloaded([[message()], [redactionBy(OTHER)]]);

    expect(result).toEqual({
      live: 'message v1',
      reloaded: 'message v1',
      saved: expect.stringContaining('message v1'),
    });
  });

  it('stays when a member redacted it before being given the right', async () => {
    const promoted = { ...POWER_LEVELS, users: { ...POWER_LEVELS.users, [OTHER]: 50 } };
    const result = await liveAndReloaded([
      [message()],
      [redactionBy(OTHER), stateEvent('m.room.power_levels', '', promoted, POWER_LEVELS)],
    ]);

    expect(result).toEqual({
      live: 'message v1',
      reloaded: 'message v1',
      saved: expect.stringContaining('message v1'),
    });
  });

  it('stays gone once the moderator who redacted it left the room', async () => {
    const leave = stateEvent(
      'm.room.member',
      MODERATOR,
      { membership: 'leave' },
      { membership: 'join' }
    );
    const result = await liveAndReloaded([[message()], [redactionBy(MODERATOR)], [leave]]);

    expect(result.live).toBeUndefined();
    expect(result.reloaded).toBeUndefined();
    expect(result.saved).not.toContain('message v1');
  });
});
