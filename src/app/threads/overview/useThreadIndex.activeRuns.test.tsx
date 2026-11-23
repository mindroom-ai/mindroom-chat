// @vitest-environment jsdom
import { createClient, MatrixEvent, Room } from 'matrix-js-sdk';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import { createThreadRecordChanges } from '../../event-store/threads/threadRecord';
import { classifyThreadWorkflow } from '../../event-store/threads/threadWorkflow';
import { MINDROOM_ACTIVE_RUNS_EVENT } from '../../matrix/protocol/activeRunsContract';
import { buildThreadIndexRecordMaps } from './threadIndexRecords';
import { useThreadIndex } from './useThreadIndex';

vi.mock('../../schedules/useScheduledTaskEvents', () => {
  const events: MatrixEvent[] = [];
  return { useScheduledTaskEvents: () => events };
});
const writers = new Map<string, string[]>();
vi.mock('../../event-store/threads/threadWriters', async (original) => ({
  ...(await original<typeof import('../../event-store/threads/threadWriters')>()),
  useThreadWriters: () => writers,
}));
vi.mock('../../event-store/threads/useThreadPinning', () => {
  const pins: string[] = [];
  return { usePinnedEventIds: () => pins };
});
vi.mock('../usePinnedThreadEvents', () => {
  const events: MatrixEvent[] = [];
  return { usePinnedThreadEvents: () => events };
});
vi.mock('./useRoomThreadList', () => {
  const result = {
    threads: [],
    loading: false,
    loadedSuccessfully: true,
    fullyLoaded: true,
    retry: vi.fn(),
  };
  return { useRoomThreadList: () => result };
});
vi.mock('./threadOverviewCacheHydration', () => ({
  useThreadOverviewCacheHydration: () => undefined,
  useThreadOverviewRelationUpdates: () => undefined,
}));
vi.mock('./threadIndexRecords', async (original) => {
  const module = await original<typeof import('./threadIndexRecords')>();
  return { ...module, buildThreadIndexRecordMaps: vi.fn(module.buildThreadIndexRecordMaps) };
});

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

describe('useThreadIndex active_runs', () => {
  it('uses active_runs as the single source of truth for Working without rebuilding base records', async () => {
    const client = createClient({
      baseUrl: 'http://localhost:1',
      userId: VIEWER,
      timelineSupport: true,
    });
    vi.spyOn(client, 'supportsThreads').mockReturnValue(true);
    const room = new Room(ROOM_ID, client, VIEWER, { timelineSupport: true });
    const root = makeMsg('$root', VIEWER, { msgtype: 'm.text', body: 'Start thread' }, START_TS);
    const other = makeMsg('$other', VIEWER, { msgtype: 'm.text', body: 'Idle thread' }, START_TS);
    // Even with a streaming reply in the thread timeline, active_runs alone governs Working.
    const reply = makeMsg(
      '$reply',
      AGENT,
      {
        msgtype: 'm.text',
        body: 'Working...',
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
        other,
        reply,
      ],
      { addToState: true }
    );
    room.createThread('$root', root, [reply], false);

    const options: Parameters<typeof useThreadIndex>[0] = {
      room,
      threadId: undefined,
      eventId: undefined,
      focusedRoomOverviewRequested: false,
      compactViewRequested: true,
      effectiveViewMode: 'threaded',
      linkedTimelines: [],
      renderableEventEntries: [root, other].map((event, absoluteIndex) => ({
        event,
        absoluteIndex,
      })),
      ignoredUsersSet: new Set(),
      showHiddenEvents: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
      summaryMap: new Map(),
      threadResolutionMap: new Map([
        ['$root', { isResolved: false, tags: null }],
        ['$other', { isResolved: false, tags: null }],
      ]),
      currentUserId: VIEWER,
      requestedThreadFilterState: createDefaultThreadFilterState(),
      threadSortFreezeState: null,
      overviewRefreshCounter: 0,
      overviewChanges: createThreadRecordChanges(),
      sessionId: 'session',
      mx: client,
      onStoreThreadSummary: vi.fn(),
    };

    let latest!: ReturnType<typeof useThreadIndex>;
    function Probe() {
      latest = useThreadIndex(options);
      return null;
    }

    // Start with active_runs already active so base records are built with isStreaming: true.
    await room.addLiveEvents([activeRuns([{ thread_id: '$root' }])], { addToState: true });
    act(() => {
      renderer = create(<Probe />);
    });
    expect(latest.normalThreadRecordMap.get('$root')?.status.isStreaming).toBe(true);
    expect(latest.compactThreadRecordMap.get('$root')?.status.isStreaming).toBe(true);
    expect(
      classifyThreadWorkflow(latest.normalThreadRecordMap.get('$root')!.status, Date.now())
    ).toBe('working');
    expect(latest.normalThreadRecordMap.get('$other')?.status.isStreaming).toBe(false);
    vi.mocked(buildThreadIndexRecordMaps).mockClear();

    // Heartbeat with unchanged threads keeps record map references intact.
    const normalBefore = latest.normalThreadRecordMap;
    const compactBefore = latest.compactThreadRecordMap;
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    await act(async () => {
      await room.addLiveEvents([activeRuns([{ thread_id: '$root' }], { ts: Date.now() })], {
        addToState: true,
      });
    });
    expect(latest.normalThreadRecordMap).toBe(normalBefore);
    expect(latest.compactThreadRecordMap).toBe(compactBefore);

    // Clearing active_runs flips isStreaming back to false even though base record had true.
    await act(async () => {
      await room.addLiveEvents([activeRuns([])], { addToState: true });
    });
    expect(buildThreadIndexRecordMaps).not.toHaveBeenCalled();
    expect(latest.normalThreadRecordMap.get('$root')?.status.isStreaming).toBe(false);
    expect(
      classifyThreadWorkflow(latest.normalThreadRecordMap.get('$root')!.status, Date.now())
    ).toBe('needsYou');

    // Non-agent, room-mode null, and malformed events are ignored for thread cards.
    await act(async () => {
      await room.addLiveEvents(
        [
          activeRuns([{ thread_id: '$root' }], { sender: HUMAN }),
          activeRuns([{ thread_id: null }]),
        ],
        { addToState: true }
      );
    });
    expect(latest.normalThreadRecordMap.get('$root')?.status.isStreaming).toBe(false);

    // Expiry timer clears Working automatically.
    await act(async () => {
      await room.addLiveEvents([activeRuns([{ thread_id: '$root' }], { ttlMs: 30_000 })], {
        addToState: true,
      });
    });
    expect(latest.normalThreadRecordMap.get('$root')?.status.isStreaming).toBe(true);
    act(() => {
      vi.advanceTimersByTime(30_001);
    });
    expect(latest.normalThreadRecordMap.get('$root')?.status.isStreaming).toBe(false);

    // Leaving agent drops Working immediately.
    await act(async () => {
      await room.addLiveEvents(
        [
          activeRuns([{ thread_id: '$root' }]),
          makeState('m.room.member', AGENT, { membership: 'leave' }),
        ],
        { addToState: true }
      );
    });
    expect(latest.normalThreadRecordMap.get('$root')?.status.isStreaming).toBe(false);
  });
});
