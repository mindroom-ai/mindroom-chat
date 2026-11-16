// @vitest-environment jsdom
import { MatrixEvent, type MatrixClient, type Room } from 'matrix-js-sdk';
import { act, create } from 'react-test-renderer';
import { describe, expect, it, vi } from 'vitest';
import type { BackgroundJob } from '../../matrix/protocol/backgroundJobsContract';
import { createDefaultThreadFilterState } from '../../event-store/threads/roomThreadOverviewModel';
import { buildThreadIndexRecordMaps } from './threadIndexRecords';
import { useThreadIndex } from './useThreadIndex';

const live = vi.hoisted(() => ({ jobs: [] as BackgroundJob[] }));
vi.mock('../../background-jobs/useRoomBackgroundJobs', () => ({
  useRoomBackgroundJobs: () => ({ jobs: live.jobs }),
}));
vi.mock('../../schedules/useScheduledTaskEvents', () => {
  const events: MatrixEvent[] = [];
  return { useScheduledTaskEvents: () => events };
});
vi.mock('../../event-store/threads/threadWriters', async (original) => ({
  ...(await original<typeof import('../../event-store/threads/threadWriters')>()),
  useThreadWriters: () => writers,
}));
const writers = new Map<string, string[]>();
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
// No cache/network hydration in this test: the real record builder reads the supplied room.
vi.mock('./threadOverviewCacheHydration', () => ({
  useThreadOverviewCacheHydration: () => undefined,
  useThreadOverviewRelationUpdates: () => undefined,
}));
vi.mock('./threadIndexRecords', async (original) => {
  const module = await original<typeof import('./threadIndexRecords')>();
  return { ...module, buildThreadIndexRecordMaps: vi.fn(module.buildThreadIndexRecordMaps) };
});

describe('useThreadIndex background updates', () => {
  it('overlays job flags without rebuilding base records or reading unrelated history', () => {
    const roots = ['$job', '$other'].map(
      (id) =>
        new MatrixEvent({
          event_id: id,
          room_id: '!room:example.org',
          sender: '@me:example.org',
          type: 'm.room.message',
          origin_server_ts: 100,
          content: { msgtype: 'm.text', body: id },
        })
    );
    const getThread = vi.fn(() => undefined);
    const room = {
      roomId: '!room:example.org',
      threadsTimelineSets: [],
      getThread,
      findEventById: (id: string) => roots.find((event) => event.getId() === id),
      getUnfilteredTimelineSet: () => ({ relations: { getChildEventsForEvent: () => undefined } }),
      getMember: () => undefined,
      getEventReadUpTo: () => undefined,
    } as unknown as Room;
    const options: Parameters<typeof useThreadIndex>[0] = {
      room,
      threadId: undefined,
      eventId: undefined,
      focusedRoomOverviewRequested: false,
      compactViewRequested: false,
      effectiveViewMode: 'threaded',
      linkedTimelines: [],
      renderableEventEntries: roots.map((event, absoluteIndex) => ({ event, absoluteIndex })),
      ignoredUsersSet: new Set(),
      showHiddenEvents: false,
      hideMembershipEvents: false,
      hideNickAvatarEvents: false,
      summaryMap: new Map(),
      threadResolutionMap: new Map(
        roots.map((event) => [event.getId()!, { isResolved: false, tags: null }])
      ),
      currentUserId: '@me:example.org',
      requestedThreadFilterState: createDefaultThreadFilterState(),
      threadSortFreezeState: null,
      overviewRefreshCounter: 0,
      sessionId: 'session',
      mx: {} as MatrixClient,
      onStoreThreadSummary: vi.fn(),
    };
    let latest!: ReturnType<typeof useThreadIndex>;
    function Probe() {
      latest = useThreadIndex(options);
      return null;
    }
    live.jobs = [];
    let renderer!: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Probe />);
    });
    const baseMaps = vi.mocked(buildThreadIndexRecordMaps).mock.results.at(-1)!.value as ReturnType<
      typeof buildThreadIndexRecordMaps
    >;
    const original = latest.normalThreadRecordMap.get('$job')!;
    const other = latest.normalThreadRecordMap.get('$other')!;
    expect(original).toBeDefined();
    expect(other).toBeDefined();
    vi.mocked(buildThreadIndexRecordMaps).mockClear();
    getThread.mockClear();
    const publish = (status: string) => {
      live.jobs = [
        {
          jobId: 'job',
          agentId: '@mindroom_agent:example.org',
          threadId: '$job',
          status,
          kind: 'tool',
          tool: 'shell',
          startedAt: '2026-11-15T00:00:00Z',
        },
      ];
      act(() => renderer.update(<Probe />));
    };
    publish('running');
    expect(latest.normalThreadRecordMap.get('$job')?.status.hasBackgroundJob).toBe(true);
    expect(buildThreadIndexRecordMaps).not.toHaveBeenCalled();
    expect(getThread).not.toHaveBeenCalled();
    expect(latest.normalThreadRecordMap.get('$other')).toBe(other);
    expect(baseMaps.normalThreadRecordMap.get('$job')).toBe(original);
    expect(original.status.hasBackgroundJob).toBeUndefined();
    const running = latest.normalThreadRecordMap.get('$job');
    publish('running');
    expect(latest.normalThreadRecordMap.get('$job')).toBe(running);
    publish('awaiting_approval');
    expect(latest.normalThreadRecordMap.get('$job')?.status.hasBackgroundApproval).toBe(true);
    expect(latest.normalThreadRecordMap.get('$other')).toBe(other);
    live.jobs = [];
    act(() => renderer.update(<Probe />));
    expect(latest.normalThreadRecordMap.get('$job')).toBe(original);
    expect(buildThreadIndexRecordMaps).not.toHaveBeenCalled();
    expect(getThread).not.toHaveBeenCalled();
    act(() => renderer.unmount());
  });
});
