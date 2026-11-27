import { describe, expect, it, vi } from 'vitest';
import { Direction, MatrixEvent, Room, createClient } from 'matrix-js-sdk';
import { SyncAccumulator } from 'matrix-js-sdk/lib/sync-accumulator';
import type { ISyncData, ISyncResponse } from 'matrix-js-sdk/lib/sync-accumulator';
import { STARTUP_SYNC_TIMELINE_LIMIT, SYNC_ARCHIVE_TIMELINE_LIMIT } from './clientSyncPolicy';
import { trimSavedSyncTimelines, type SavedTimelineSync } from './savedSyncTimeline';

const ROOM = '!room:example.org';
const SENDER = '@alice:example.org';

const messageEvent = (index: number) => ({
  type: 'm.room.message',
  event_id: `$ev-${index}`,
  sender: SENDER,
  origin_server_ts: 1_000 + index,
  content: { msgtype: 'm.text', body: `message ${index}` },
});

const stateEvent = (
  type: string,
  stateKey: string,
  content: Record<string, unknown>,
  index: number,
  prevContent?: Record<string, unknown>
) => ({
  type,
  state_key: stateKey,
  event_id: `$state-${type}-${index}`,
  sender: SENDER,
  origin_server_ts: 1_000 + index,
  content,
  ...(prevContent ? { unsigned: { prev_content: prevContent, prev_sender: SENDER } } : {}),
});

const syncOf = (
  nextBatch: string,
  events: unknown[],
  prevBatch: string | null,
  state: unknown[] = []
): ISyncResponse =>
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
  }) as unknown as ISyncResponse;

const reloadFromDatabase = (
  saved: ISyncData,
  maxTimelineEntries = SYNC_ARCHIVE_TIMELINE_LIMIT
): SyncAccumulator => {
  const reloaded = new SyncAccumulator({ maxTimelineEntries });
  reloaded.accumulate(
    {
      next_batch: saved.nextBatch,
      rooms: saved.roomsData,
      account_data: { events: saved.accountData },
    },
    true
  );
  return reloaded;
};

const stateContentOf = (
  events: { type: string; state_key?: string; content?: Record<string, unknown> }[] | undefined,
  type: string,
  stateKey = ''
): Record<string, unknown> | undefined =>
  (events ?? []).find((event) => event.type === type && event.state_key === stateKey)?.content;

describe('trimSavedSyncTimelines', () => {
  it('leaves rooms at or below the archive limit untouched with their original prev_batch', () => {
    const initial = new SyncAccumulator({ maxTimelineEntries: SYNC_ARCHIVE_TIMELINE_LIMIT });
    const events = Array.from({ length: SYNC_ARCHIVE_TIMELINE_LIMIT }, (_, i) => messageEvent(i));
    initial.accumulate(syncOf('S_40', events, 'T0'));

    const reloaded = reloadFromDatabase(initial.getJSON(true));
    trimSavedSyncTimelines(reloaded as unknown as SavedTimelineSync);

    const room = reloaded.getJSON().roomsData.join[ROOM];
    expect(room?.timeline.prev_batch).toBe('T0');
    expect(room?.timeline.events.map((event) => event.event_id)).toEqual(
      events.map((event) => event.event_id)
    );
  });

  it('trims a 500-event legacy IDB room to 20 events with nextBatch and exact state rollback', () => {
    const legacy = new SyncAccumulator({ maxTimelineEntries: 500 });
    const timeline = Array.from({ length: 500 }, (_, index) => {
      if (index === 10) {
        return stateEvent('m.room.name', '', { name: 'Prefix Name' }, index, {
          name: 'Initial Name',
        });
      }
      if (index === 50) {
        return stateEvent('m.room.topic', '', { topic: 'Before Tail' }, index, {
          topic: 'Initial Topic',
        });
      }
      if (index === 485) {
        return stateEvent('m.room.topic', '', { topic: 'Mid Tail' }, index, {
          topic: 'Before Tail',
        });
      }
      if (index === 495) {
        return stateEvent('m.room.topic', '', { topic: 'Final Tail' }, index, {
          topic: 'Mid Tail',
        });
      }
      return messageEvent(index);
    });
    const initialState = [
      stateEvent('m.room.name', '', { name: 'Initial Name' }, 0),
      stateEvent('m.room.topic', '', { topic: 'Initial Topic' }, 0),
      stateEvent('io.mindroom.mode', '', { mode: 'v0' }, 0),
    ];
    legacy.accumulate(syncOf('S_500', timeline, 'T0', initialState));

    // Round-trip through getJSON(true) so only index 0 carries a token on reload.
    const reloaded = reloadFromDatabase(legacy.getJSON(true));
    expect(reloaded.getJSON().roomsData.join[ROOM]?.timeline.events).toHaveLength(500);

    trimSavedSyncTimelines(reloaded as unknown as SavedTimelineSync);

    const room = reloaded.getJSON().roomsData.join[ROOM];
    expect(room?.timeline.prev_batch).toBe('S_500');
    expect(room?.timeline.events).toHaveLength(STARTUP_SYNC_TIMELINE_LIMIT);
    expect(room?.timeline.events[0]?.event_id).toBe('$ev-480');
    expect(room?.timeline.events.at(-1)?.event_id).toBe('$ev-499');

    // `state` reflects the room right before event 480 (dropped prefix applied, kept tail rolled back).
    expect(stateContentOf(room?.state?.events, 'm.room.name')).toEqual({ name: 'Prefix Name' });
    expect(stateContentOf(room?.state?.events, 'm.room.topic')).toEqual({ topic: 'Before Tail' });
    expect(stateContentOf(room?.state?.events, 'io.mindroom.mode')).toEqual({ mode: 'v0' });

    // `state_after` reflects the room after event 499.
    const stateAfter = room?.['org.matrix.msc4222.state_after']?.events;
    expect(stateContentOf(stateAfter, 'm.room.name')).toEqual({ name: 'Prefix Name' });
    expect(stateContentOf(stateAfter, 'm.room.topic')).toEqual({ topic: 'Final Tail' });
    expect(stateContentOf(stateAfter, 'io.mindroom.mode')).toEqual({ mode: 'v0' });
  });

  it('trims to an existing internal batch token at or after startIndex without reading nextBatch', () => {
    const accumulator = new SyncAccumulator({ maxTimelineEntries: 500 });
    accumulator.accumulate(
      syncOf(
        'S1',
        Array.from({ length: 35 }, (_, i) => messageEvent(i)),
        'T0'
      )
    );
    accumulator.accumulate(
      syncOf(
        'S2',
        Array.from({ length: 10 }, (_, i) => messageEvent(35 + i)),
        'T35'
      )
    );
    accumulator.accumulate(
      syncOf(
        'S3',
        Array.from({ length: 5 }, (_, i) => messageEvent(45 + i)),
        'T45'
      )
    );

    const nextBatchSpy = vi.spyOn(accumulator, 'getNextBatchToken');
    trimSavedSyncTimelines(accumulator as unknown as SavedTimelineSync);

    expect(nextBatchSpy).not.toHaveBeenCalled();
    const room = accumulator.getJSON().roomsData.join[ROOM];
    expect(room?.timeline.prev_batch).toBe('T35');
    expect(room?.timeline.events.map((event) => event.event_id)).toEqual(
      Array.from({ length: 15 }, (_, i) => `$ev-${35 + i}`)
    );
  });

  it('leaves rooms untouched when nextBatch or the leading timeline token is missing', () => {
    const makeEntries = (leadingToken: string | null) =>
      Array.from({ length: 50 }, (_, index) => ({
        event: messageEvent(index),
        token: index === 0 ? leadingToken : null,
      }));

    const missingNextBatchRoom = { _timeline: makeEntries('T0') };
    trimSavedSyncTimelines({
      joinRooms: { [ROOM]: missingNextBatchRoom },
      nextBatch: null,
    });
    expect(missingNextBatchRoom._timeline).toHaveLength(50);
    expect(missingNextBatchRoom._timeline[0]?.token).toBe('T0');

    const emptyNextBatchRoom = { _timeline: makeEntries('T0') };
    trimSavedSyncTimelines({
      joinRooms: { [ROOM]: emptyNextBatchRoom },
      getNextBatchToken: () => '',
    });
    expect(emptyNextBatchRoom._timeline).toHaveLength(50);
    expect(emptyNextBatchRoom._timeline[0]?.token).toBe('T0');

    const tokenlessRoom = { _timeline: makeEntries(null) };
    trimSavedSyncTimelines({
      joinRooms: { [ROOM]: tokenlessRoom },
      nextBatch: 'S_50',
    });
    expect(tokenlessRoom._timeline).toHaveLength(50);
    expect(tokenlessRoom._timeline[0]?.token).toBeNull();

    expect(() => trimSavedSyncTimelines({ joinRooms: { '!bare:example.org': {} } })).not.toThrow();
    expect(() => trimSavedSyncTimelines({})).not.toThrow();
  });

  it('deduplicates and prepends older history cleanly when back-paginating from nextBatch', async () => {
    const legacy = new SyncAccumulator({ maxTimelineEntries: 500 });
    legacy.accumulate(
      syncOf(
        'S_60',
        Array.from({ length: 60 }, (_, i) => messageEvent(i)),
        'T0'
      )
    );
    const reloaded = reloadFromDatabase(legacy.getJSON(true));
    trimSavedSyncTimelines(reloaded as unknown as SavedTimelineSync);

    const savedRoom = reloaded.getJSON().roomsData.join[ROOM];
    expect(savedRoom).toBeDefined();

    const client = createClient({
      baseUrl: 'https://example.org',
      userId: SENDER,
      timelineSupport: true,
    });
    const room = new Room(ROOM, client, SENDER, { timelineSupport: true });
    const liveTimeline = room.getLiveTimeline();
    liveTimeline.setPaginationToken(savedRoom!.timeline.prev_batch, Direction.Backward);
    await room.addLiveEvents(
      savedRoom!.timeline.events.map((event) => new MatrixEvent({ ...event, room_id: ROOM })),
      { addToState: true }
    );

    expect(liveTimeline.getPaginationToken(Direction.Backward)).toBe('S_60');
    expect(liveTimeline.getEvents().map((event) => event.getId())).toEqual(
      Array.from({ length: 20 }, (_, i) => `$ev-${40 + i}`)
    );

    // Simulated GET /rooms/{roomId}/messages?from=S_60&dir=b returning newest-first events
    // overlapping all 20 kept events ($ev-59..$ev-40) plus 15 older events ($ev-39..$ev-25).
    const backPage = Array.from({ length: 35 }, (_, offset) => 59 - offset).map(
      (index) => new MatrixEvent({ ...messageEvent(index), room_id: ROOM })
    );
    room
      .getUnfilteredTimelineSet()
      .addEventsToTimeline(backPage, true, true, liveTimeline, 'T_before_25');

    expect(liveTimeline.getEvents().map((event) => event.getId())).toEqual(
      Array.from({ length: 35 }, (_, i) => `$ev-${25 + i}`)
    );
    expect(liveTimeline.getPaginationToken(Direction.Backward)).toBe('T_before_25');
  });

  it('gives a 20-event room a full page of headroom before pruning to a newer batch boundary', () => {
    const initial = new SyncAccumulator({ maxTimelineEntries: SYNC_ARCHIVE_TIMELINE_LIMIT });
    initial.accumulate(
      syncOf(
        'S_20',
        Array.from({ length: STARTUP_SYNC_TIMELINE_LIMIT }, (_, i) => messageEvent(i)),
        'T0'
      )
    );
    const reloaded = reloadFromDatabase(initial.getJSON(true));

    // Receiving 1 incremental event keeps all 21 events (no 20 -> 1 collapse).
    reloaded.accumulate(syncOf('S_21', [messageEvent(20)], 'T20'));
    const afterOne = reloaded.getJSON().roomsData.join[ROOM];
    expect(afterOne?.timeline.prev_batch).toBe('T0');
    expect(afterOne?.timeline.events.map((event) => event.event_id)).toEqual(
      Array.from({ length: 21 }, (_, i) => `$ev-${i}`)
    );

    // Reaching exactly 40 keeps all 40 events.
    reloaded.accumulate(
      syncOf(
        'S_40',
        Array.from({ length: 19 }, (_, i) => messageEvent(21 + i)),
        'T21'
      )
    );
    const atLimit = reloaded.getJSON().roomsData.join[ROOM];
    expect(atLimit?.timeline.prev_batch).toBe('T0');
    expect(atLimit?.timeline.events).toHaveLength(SYNC_ARCHIVE_TIMELINE_LIMIT);

    // Crossing 40 prunes cleanly to the newer batch boundary at T20.
    reloaded.accumulate(syncOf('S_41', [messageEvent(40)], 'T40'));
    const afterOverflow = reloaded.getJSON().roomsData.join[ROOM];
    expect(afterOverflow?.timeline.prev_batch).toBe('T20');
    expect(afterOverflow?.timeline.events.map((event) => event.event_id)).toEqual(
      Array.from({ length: 21 }, (_, i) => `$ev-${20 + i}`)
    );
  });
});
