import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('RoomTimeline architecture', () => {
  it('delegates thread badge JSX rendering to the MindRoom badge renderer', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('const renderThreadBadge');
    expect(source).toContain('ThreadBadgeRenderer');
  });

  it('keeps renderability and preload counting outside RoomTimeline', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('export const isRenderableEvent =');
    expect(source).not.toContain('export const getRoomPreloadCounts =');
    expect(source).toContain("from './roomTimelineEvents'");
  });

  it('delegates eager room preload orchestration outside RoomTimeline', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useRoomEagerPreload');
    expect(source).not.toContain('[eager-preload]');
  });

  it('does not import raw event cache stores directly', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain("from './roomEventCache'");
    expect(source).not.toContain("from './threadEventCache'");
    expect(source).toContain("from '../../mindroom/threads/eventRepository'");
  });

  it('delegates room cache helper derivation to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('const getMainTimelineCacheEvents');
    expect(source).not.toContain('export const shouldHydrateLatestRoomCache');
    expect(source).not.toContain('export const filterLatestRoomCacheHydrationEvents');
  });

  it('delegates thread cache coverage derivation to a fork-owned module', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('const getRoomDerivedThreadSnapshotState');
    expect(source).not.toContain('const isCompleteCachedThreadSnapshot');
    expect(source).not.toContain('const getAuthoritativeCachedThreadReplyCount');
    expect(source).not.toContain('const mergeThreadBackfillEvents');
  });

  it('delegates thread cache coverage decisions to a fork-owned module', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain("from '../../mindroom/threads/threadCacheCoverage'");
    expect(source).not.toContain('hydratedCachedPage.snapshotComplete === true &&');
    expect(source).not.toContain('hydratedCachedPage.relationSnapshotComplete === true &&');
    expect(source).toContain('showThreadLoadOlderMessages');
  });

  it('delegates cache payload serialization prep to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('const withStateTargetEvents');
    expect(source).not.toContain('serializeEventsForCache(');
  });

  it('delegates cache persistence snapshots to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('persistRoomEventCacheSnapshot');
    expect(source).toContain('persistThreadEventCacheSnapshot');
    expect(source).toContain('persistThreadCacheFromRoomEventsSnapshot');
    expect(source).not.toContain('saveRoomEventsToCache(');
    expect(source).not.toContain('saveThreadEventsToCache(');
    expect(source).not.toContain('serializeRoomCacheEvents(room');
    expect(source).not.toContain('serializeThreadCacheEvents(room');
    expect(source).not.toContain('groupThreadCacheEvents');
    expect(source).not.toContain('getRoomDerivedThreadSnapshotState');
  });

  it('delegates overview cache hydration to the MindRoom thread namespace', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain("from './useThreadOverviewCacheHydration'");
    expect(source).not.toContain('useThreadOverviewCacheHydration');
    expect(source).toContain('useMindroomThreadIndex');
  });

  it('delegates per-room thread index assembly to the MindRoom thread namespace', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useMindroomThreadIndex');
    expect(source).not.toContain('const normalThreadRecordMap = useMemo');
    expect(source).not.toContain('const compactThreadRecordMap = useMemo');
    expect(source).not.toContain('computeThreadRecordStatusCounts');
    expect(source).not.toContain('computeThreadRecordTagCounts');
  });

  it('delegates room overview focus and filter helpers to the MindRoom thread namespace', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain("from '../../mindroom/threads/threadRoomFocus'");
    expect(source).not.toContain('const getFilteredRoomOverviewEvents');
    expect(source).not.toContain('export const getRoomEventFocusTarget =');
    expect(source).not.toContain('export const getThreadFilteredEvents =');
    expect(source).not.toContain('buildThreadRecordMap({');
  });

  it('delegates cached thread page stitching to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('cachedThreadEvents.unshift(...cachedPage.events)');
    expect(source).toContain('loadThreadCachedSnapshot');
  });

  it('delegates cached thread event mapping and pagination reads to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('loadThreadCachedPaginationSnapshot');
    expect(source).toContain('mapCachedThreadPageEvents');
    expect(source).not.toContain('loadCachedThreadEventsBefore');
    expect(source).not.toContain('normalizeCachedThreadEvents');
  });

  it('delegates thread bootstrap, seed prewarm, and relation-fetch helpers to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain("from '../../mindroom/threads/threadBootstrap'");
    expect(source).not.toContain('export async function fetchAllThreadRelations');
    expect(source).not.toContain('export const collectPriorityThreadSeedPrewarmRoots =');
    expect(source).not.toContain('export const getLoadedRoomThreadEvents =');
    expect(source).not.toContain('export const getLoadedRoomThreadSeedEvents =');
    expect(source).not.toContain('export const getCompactRootEventsNeedingBackfill =');
  });

  it('delegates thread prepend scroll primitives to scroll utilities', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain("from './timelineScrollUtils'");
    expect(source).not.toContain('export const captureThreadPrependScrollAnchor');
    expect(source).not.toContain('export const restoreThreadPrependScrollAnchor');
    expect(source).not.toContain('const resolveThreadScrollContainer');
  });

  it('delegates thread back-pagination mutable state to the controller hook', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useThreadBackPaginationController');
    expect(source).not.toContain('pendingThreadBackPaginationAnchorRef');
    expect(source).not.toContain('setThreadPaginatingBack');
  });

  it('keeps thread-open seed cache in the MindRoom thread namespace', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain("from '../../mindroom/threads/threadOpenSeedCache'");
    expect(source).not.toContain("from './threadOpenSeedCache'");
  });

  it('delegates latest room cache hydration decisions to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('loadLatestRoomCacheHydrationSnapshot');
    expect(source).not.toContain('loadLatestCachedRoomEvents');
    expect(source).not.toContain('shouldHydrateLatestRoomCache(');
    expect(source).not.toContain('filterLatestRoomCacheHydrationEvents(');
  });

  it('delegates cached room pagination reads to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('loadRoomCachedPaginationSnapshot');
    expect(source).not.toContain('loadCachedRoomEventsBefore');
    expect(source).not.toContain('loadCachedRoomPaginationToken');
    expect(source).not.toContain('resolvePersistedRoomBeforeToken');
    expect(source).not.toContain('normalizeCachedRoomEvents');
  });
});
