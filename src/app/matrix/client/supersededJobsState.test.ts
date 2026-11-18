import { describe, expect, it, vi } from 'vitest';
import {
  createClient,
  Direction,
  EventType,
  MatrixEvent,
  Room,
  RoomEvent,
  RoomStateEvent,
  type MatrixClient,
} from 'matrix-js-sdk';
import { MINDROOM_BACKGROUND_JOBS_EVENT } from '../protocol/backgroundJobsContract';
import { startClient } from './clientSyncPolicy';
import { emptySupersededJobsState } from './supersededJobsState';

const ROOM_ID = '!room:example.org';
const AGENT = '@mindroom_agent:example.org';
const OTHER_AGENT = '@mindroom_other:example.org';

let ts = 1_000;

const stateEvent = (type: string, stateKey: string, eventId: string, content: object = {}) => {
  ts += 1;
  return new MatrixEvent({
    type,
    room_id: ROOM_ID,
    event_id: eventId,
    sender: stateKey || AGENT,
    state_key: stateKey,
    origin_server_ts: ts,
    content,
    unsigned: { age: 1, prev_content: { jobs: [{ job_id: `before-${eventId}` }] } },
  });
};

const jobs = (eventId: string, agent = AGENT, running = 1) =>
  stateEvent(MINDROOM_BACKGROUND_JOBS_EVENT, agent, eventId, {
    jobs: Array.from({ length: running }, (_, index) => ({ job_id: `${eventId}-${index}` })),
  });

const message = (eventId: string) => {
  ts += 1;
  return new MatrixEvent({
    type: EventType.RoomMessage,
    room_id: ROOM_ID,
    event_id: eventId,
    sender: AGENT,
    origin_server_ts: ts,
    content: { msgtype: 'm.text', body: eventId },
  });
};

const joinedRoom = async (keep = true) => {
  const mx: MatrixClient = createClient({
    baseUrl: 'https://example.org',
    userId: '@me:example.org',
    timelineSupport: true,
  });
  const room = new Room(ROOM_ID, mx, '@me:example.org', { timelineSupport: true });
  mx.store.storeRoom(room);
  // As sync does for each room it creates.
  mx.reEmitter.reEmit(room, [RoomEvent.Timeline, RoomStateEvent.Events]);
  if (keep) emptySupersededJobsState(mx);
  await room.addLiveEvents([stateEvent(EventType.RoomCreate, '', '$create'), message('$first')], {
    addToState: true,
  });
  const live = (...events: MatrixEvent[]) => room.addLiveEvents(events, { addToState: true });
  /** Every event of the room's timelines, with what it still holds of a jobs list. */
  const timelineEvents = () =>
    room
      .getUnfilteredTimelineSet()
      .getTimelines()
      .flatMap((timeline) => timeline.getEvents())
      .map((event) => [
        event.getId(),
        Object.keys({ ...event.getContent(), ...event.getPrevContent() }).includes('jobs'),
      ]);
  const currentJobs = (agent = AGENT) =>
    room.currentState.getStateEvents(MINDROOM_BACKGROUND_JOBS_EVENT, agent)?.getId();
  return { mx, room, live, timelineEvents, currentJobs };
};

describe('emptySupersededJobsState', () => {
  it('without it, the room timeline keeps every jobs list an agent ever wrote, each twice', async () => {
    const { room, live, timelineEvents } = await joinedRoom(false);

    await live(jobs('$jobs1'), jobs('$jobs2'), jobs('$jobs3'));

    expect(timelineEvents().slice(2)).toEqual([
      ['$jobs1', true],
      ['$jobs2', true],
      ['$jobs3', true],
    ]);
    expect(room.findEventById('$jobs1')?.getPrevContent()).toHaveProperty('jobs');
  });

  it('empties the jobs states an agent replaced, and keeps them in their places', async () => {
    const { room, live, timelineEvents, currentJobs } = await joinedRoom();

    await live(jobs('$jobs1'));
    await live(message('$between'), jobs('$jobs2'));
    await live(jobs('$jobs3'), jobs('$jobs4', AGENT, 2));

    expect(timelineEvents()).toEqual([
      ['$create', true],
      ['$first', false],
      ['$jobs1', false],
      ['$between', false],
      ['$jobs2', false],
      ['$jobs3', false],
      ['$jobs4', true],
    ]);
    const replaced = room.findEventById('$jobs3');
    expect(replaced?.getContent()).toEqual({});
    expect(replaced?.getUnsigned()).toEqual({ age: 1 });
    expect(replaced?.getType()).toBe(MINDROOM_BACKGROUND_JOBS_EVENT);
    expect(replaced?.getStateKey()).toBe(AGENT);
    expect(currentJobs()).toBe('$jobs4');
  });

  it('leaves the current jobs state whole: its list and the list before it', async () => {
    const { room, live } = await joinedRoom();

    await live(jobs('$jobs1'), jobs('$jobs2', AGENT, 2));

    const current = room.currentState.getStateEvents(MINDROOM_BACKGROUND_JOBS_EVENT, AGENT);
    expect(current).toBe(room.findEventById('$jobs2'));
    expect(current?.getContent()).toEqual({
      jobs: [{ job_id: '$jobs2-0' }, { job_id: '$jobs2-1' }],
    });
    expect(current?.getPrevContent()).toEqual({ jobs: [{ job_id: 'before-$jobs2' }] });
  });

  it('keeps each agent its own current jobs state', async () => {
    const { room, live, timelineEvents, currentJobs } = await joinedRoom();

    await live(jobs('$a1'), jobs('$b1', OTHER_AGENT), jobs('$a2'));

    expect(timelineEvents().slice(2)).toEqual([
      ['$a1', false],
      ['$b1', true],
      ['$a2', true],
    ]);
    expect(currentJobs()).toBe('$a2');
    expect(currentJobs(OTHER_AGENT)).toBe('$b1');
    expect(room.findEventById('$b1')?.getContent()).toEqual({ jobs: [{ job_id: '$b1-0' }] });
  });

  it('starts with the client, before its first sync', async () => {
    const { mx, room, live } = await joinedRoom(false);
    // The SDK's first sync delivers both.
    vi.spyOn(mx, 'startClient').mockImplementation(() => live(jobs('$jobs1'), jobs('$jobs2')));
    await startClient(mx);

    expect(room.findEventById('$jobs1')?.getContent()).toEqual({});
    mx.stopClient();
  });

  it('leaves a jobs state whole when sync brings it again', async () => {
    const { room, live } = await joinedRoom();
    const event = jobs('$jobs1');
    await live(event);

    room.currentState.setStateEvents([event]);

    expect(event.getContent()).toHaveProperty('jobs');
  });

  it('leaves other state events alone', async () => {
    const { room, live } = await joinedRoom();

    await live(
      stateEvent(EventType.RoomTopic, '', '$topic1', { topic: 'one' }),
      stateEvent(EventType.RoomTopic, '', '$topic2', { topic: 'two' })
    );

    expect(room.findEventById('$topic1')?.getContent()).toEqual({ topic: 'one' });
    expect(room.findEventById('$topic1')?.getPrevContent()).toHaveProperty('jobs');
  });

  it('announces no timeline change for the state it empties', async () => {
    const { mx, live } = await joinedRoom();
    const announced = vi.fn();
    mx.on(RoomEvent.Timeline, (event, _room, _older, removed) =>
      announced(event.getId(), removed === true)
    );

    await live(jobs('$jobs1'), jobs('$jobs2'));

    expect(announced.mock.calls).toEqual([
      ['$jobs1', false],
      ['$jobs2', false],
    ]);
  });

  it('keeps a read receipt on a replaced jobs state where it was', async () => {
    const { room, live } = await joinedRoom();
    await live(jobs('$jobs1'));
    room.addReceipt(
      new MatrixEvent({
        type: EventType.Receipt,
        room_id: ROOM_ID,
        content: { $jobs1: { 'm.read': { '@me:example.org': { ts: ts + 1 } } } },
      })
    );

    await live(message('$unread'), jobs('$jobs2'));

    expect(room.getEventReadUpTo('@me:example.org')).toBe('$jobs1');
    expect(room.hasUserReadEvent('@me:example.org', '$first')).toBe(true);
    expect(room.hasUserReadEvent('@me:example.org', '$unread')).toBe(false);
  });

  it('empties nothing for a page of history, whose jobs states are older than the current one', async () => {
    const { room, live, timelineEvents, currentJobs } = await joinedRoom();
    await live(jobs('$current'));
    const liveTimeline = room.getLiveTimeline();

    room.addEventsToTimeline([jobs('$older'), jobs('$oldest')], true, true, liveTimeline);

    expect(timelineEvents()).toEqual([
      ['$oldest', true],
      ['$older', true],
      ['$create', true],
      ['$first', false],
      ['$current', true],
    ]);
    expect(currentJobs()).toBe('$current');
    expect(liveTimeline.getState(Direction.Forward)).toBe(room.currentState);
  });

  it('empties the state in the timeline before a sync gap as well', async () => {
    const { room, live, timelineEvents, currentJobs } = await joinedRoom();
    await live(jobs('$before'));

    const beforeGap = room.getLiveTimeline();
    room.resetLiveTimeline('back', 'forward');
    await live(message('$after'), jobs('$after-jobs'));

    expect(timelineEvents().slice(2)).toEqual([
      ['$before', false],
      ['$after', false],
      ['$after-jobs', true],
    ]);

    // A page that fills the gap changes the state at the end of the older timeline.
    room.addEventsToTimeline([jobs('$gap1'), jobs('$gap2')], false, true, beforeGap);

    expect(timelineEvents().slice(2)).toEqual([
      ['$before', false],
      ['$gap1', true],
      ['$gap2', true],
      ['$after', false],
      ['$after-jobs', true],
    ]);
    expect(currentJobs()).toBe('$after-jobs');
  });

  it('keeps the current jobs state when the event cache restores an emptied copy of an older one', async () => {
    const { room, live, currentJobs } = await joinedRoom();
    await live(jobs('$jobs1'), jobs('$jobs2'));
    const restored = stateEvent(MINDROOM_BACKGROUND_JOBS_EVENT, AGENT, '$restored', {});

    // As `insertCachedRoomTimeline` does: live, from the cache, not as state.
    await room.addLiveEvents([restored], { fromCache: true, addToState: false });

    expect(currentJobs()).toBe('$jobs2');
    expect(room.findEventById('$jobs2')?.getContent()).toHaveProperty('jobs');
  });
});
