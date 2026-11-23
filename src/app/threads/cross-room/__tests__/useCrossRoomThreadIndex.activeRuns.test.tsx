// @vitest-environment jsdom
import { createStore, Provider } from 'jotai';
import { createClient, MatrixEvent, Room, RoomEvent, RoomStateEvent } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { allRoomsAtom } from '../../../matrix/state/roomList';
import { MINDROOM_ACTIVE_RUNS_EVENT } from '../../../matrix/protocol/activeRunsContract';
import { threadBoardColumn } from '../../board/threadBoardColumns';
import { crossRoomThreadIndexAtom, getCrossRoomThreadIndexKey } from '../crossRoomThreadIndex';
import { useCrossRoomThreadIndex } from '../useCrossRoomThreadIndex';

const { matrixClientMock, activeSessionMock } = vi.hoisted(() => ({
  matrixClientMock: vi.fn(),
  activeSessionMock: vi.fn(),
}));

vi.mock('../../../matrix/hooks/useMatrixClient', () => ({
  useMatrixClient: matrixClientMock,
}));
vi.mock('../../../matrix/session/useSessionStore', () => ({
  useActiveSession: activeSessionMock,
}));

const ROOM_ID = '!room:example.org';
const VIEWER = '@me:example.org';
const AGENT = '@mindroom_helper:example.org';
const HUMAN = '@alice:example.org';
const START_TS = 1_763_839_200_000;

let serial = 0;
let renderer: ReactTestRenderer | undefined;

const makeState = (
  type: string,
  stateKey: string,
  content: Record<string, unknown>,
  sender = stateKey,
  ts = Date.now()
) =>
  new MatrixEvent({
    event_id: `$st_${++serial}`,
    room_id: ROOM_ID,
    sender,
    state_key: stateKey,
    type,
    origin_server_ts: ts,
    content,
  });

const makeMsg = (
  eventId: string,
  sender: string,
  content: Record<string, unknown>,
  ts = Date.now()
) =>
  new MatrixEvent({
    event_id: eventId,
    room_id: ROOM_ID,
    sender,
    type: 'm.room.message',
    origin_server_ts: ts,
    content,
  });

const activeRuns = (
  threads: { thread_id: string | null }[],
  { sender = AGENT, ttlMs = 30_000, ts = Date.now() } = {}
) =>
  makeState(
    MINDROOM_ACTIVE_RUNS_EVENT,
    sender,
    { version: 1, updated_at: ts, ttl_ms: ttlMs, threads },
    sender,
    ts
  );

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(START_TS);
});

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
  vi.useRealTimers();
});

const setupRoom = async () => {
  const client = createClient({
    baseUrl: 'http://localhost:1',
    userId: VIEWER,
    timelineSupport: true,
  });
  vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
  const room = new Room(ROOM_ID, client, VIEWER, { timelineSupport: true });
  room.updateMyMembership('join');
  vi.spyOn(client, 'getRoom').mockImplementation((id) => (id === ROOM_ID ? room : null));
  vi.spyOn(client, 'getUserId').mockReturnValue(VIEWER);
  matrixClientMock.mockReturnValue(client);
  activeSessionMock.mockReturnValue({ sessionId: 'sess-1', userId: VIEWER });

  const root = makeMsg('$root', VIEWER, { msgtype: 'm.text', body: 'Start thread' }, START_TS);
  const reply = makeMsg(
    '$reply',
    AGENT,
    {
      msgtype: 'm.text',
      body: 'Reply',
      'io.mindroom.stream_status': 'streaming',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
    },
    START_TS + 100
  );
  await room.addLiveEvents(
    [
      makeState('m.room.member', AGENT, { membership: 'join' }),
      makeState('m.room.member', HUMAN, { membership: 'join' }),
      root,
      reply,
    ],
    { addToState: true }
  );
  room.createThread('$root', root, [reply], false);

  const store = createStore();
  store.set(allRoomsAtom, { type: 'INITIALIZE', rooms: [ROOM_ID] });
  function Probe() {
    useCrossRoomThreadIndex();
    return null;
  }
  act(() => {
    renderer = create(
      <Provider store={store}>
        <Probe />
      </Provider>
    );
  });
  act(() => {
    vi.advanceTimersByTime(250);
  });

  const emitActiveRuns = async (event: MatrixEvent) => {
    await act(async () => {
      await room.addLiveEvents([event], { addToState: true });
      client.emit(RoomStateEvent.Events, event, room.currentState, null);
      vi.advanceTimersByTime(250);
    });
  };
  const entryOf = (id: string) =>
    store.get(crossRoomThreadIndexAtom).entries.get(getCrossRoomThreadIndexKey(ROOM_ID, id));

  return { client, room, store, emitActiveRuns, entryOf };
};

describe('useCrossRoomThreadIndex active_runs', () => {
  it('sets Working from active_runs only, clears on removal/expiry/redaction/leave, and never creates phantom entries', async () => {
    const { client, room, emitActiveRuns, entryOf } = await setupRoom();

    // Streaming reply without active_runs is NOT Working.
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(false);
    expect(
      threadBoardColumn(entryOf('$root')!.threadRecord, { hasJob: false, now: Date.now() })
    ).toBe('open');

    // Non-agent state is ignored; unknown thread IDs never create phantom index entries.
    await emitActiveRuns(activeRuns([{ thread_id: '$root' }], { sender: HUMAN }));
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(false);

    await emitActiveRuns(activeRuns([{ thread_id: '$root' }, { thread_id: '$unknown' }]));
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(true);
    expect(
      threadBoardColumn(entryOf('$root')!.threadRecord, { hasJob: false, now: Date.now() })
    ).toBe('working');
    expect(entryOf('$unknown')).toBeUndefined();

    // Clearing active_runs drops Working.
    await emitActiveRuns(activeRuns([]));
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(false);

    // Expiry timer clears Working automatically.
    await emitActiveRuns(activeRuns([{ thread_id: '$root' }], { ttlMs: 30_000 }));
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(30_250);
    });
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(false);

    // Redaction clears Working immediately.
    const toRedact = activeRuns([{ thread_id: '$root' }], { ttlMs: 180_000 });
    await emitActiveRuns(toRedact);
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(true);
    const redaction = new MatrixEvent({
      event_id: '$red_1',
      room_id: ROOM_ID,
      sender: AGENT,
      type: 'm.room.redaction',
      redacts: toRedact.getId()!,
      origin_server_ts: Date.now(),
      content: {},
    });
    await act(async () => {
      toRedact.makeRedacted(redaction, room);
      room.emit(RoomEvent.Redaction, redaction, room);
      vi.advanceTimersByTime(250);
    });
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(false);

    // Agent leave clears Working immediately.
    await emitActiveRuns(activeRuns([{ thread_id: '$root' }], { ttlMs: 180_000 }));
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(true);
    const leaveEv = makeState('m.room.member', AGENT, { membership: 'leave' });
    await act(async () => {
      await room.addLiveEvents([leaveEv], { addToState: true });
      client.emit(RoomStateEvent.Members, leaveEv, room.currentState, room.getMember(AGENT)!);
      vi.advanceTimersByTime(250);
    });
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(false);
  });

  it('recovers Working when a renewal lands right as the previous TTL lapses', async () => {
    const { client, room, emitActiveRuns, entryOf } = await setupRoom();
    await emitActiveRuns(activeRuns([{ thread_id: '$root' }], { ttlMs: 30_000 }));
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(true);

    // Jump wall clock past expiry without firing the timer, then rebuild $root via a pin update.
    vi.setSystemTime(Date.now() + 35_000);
    const pinEvent = makeState('m.room.pinned_events', '', { pinned: ['$root'] }, VIEWER);
    await act(async () => {
      await room.addLiveEvents([pinEvent], { addToState: true });
      client.emit(RoomStateEvent.Events, pinEvent, room.currentState, null);
      vi.advanceTimersByTime(250);
    });
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(false);

    // Renewed heartbeat with identical thread set restores Working.
    const renewal = activeRuns([{ thread_id: '$root' }], { ttlMs: 30_000, ts: Date.now() });
    await emitActiveRuns(renewal);
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(true);

    // Must remain Working until the renewed TTL expires.
    await act(async () => {
      vi.advanceTimersByTime(25_000);
    });
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(6_000);
    });
    expect(entryOf('$root')?.threadRecord.status.isStreaming).toBe(false);
  });
});
