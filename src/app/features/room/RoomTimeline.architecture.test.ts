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

  it('delegates cache payload serialization prep to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('const withStateTargetEvents');
    expect(source).not.toContain('serializeEventsForCache(');
  });

  it('delegates cache persistence snapshots to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('persistRoomEventCacheSnapshot');
    expect(source).toContain('persistThreadEventCacheSnapshot');
    expect(source).not.toContain('saveRoomEventsToCache(');
    expect(source).not.toContain('saveThreadEventsToCache(');
    expect(source).not.toContain('serializeRoomCacheEvents(room');
    expect(source).not.toContain('serializeThreadCacheEvents(room');
  });

  it('delegates overview cache hydration to the MindRoom thread namespace', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain("from './useThreadOverviewCacheHydration'");
    expect(source).toContain("from '../../mindroom/threads/threadOverviewCacheHydration'");
  });

  it('delegates cached thread page stitching to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('cachedThreadEvents.unshift(...cachedPage.events)');
    expect(source).toContain('loadCachedThreadSnapshot');
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
    expect(source).not.toContain('normalizeCachedRoomEvents');
  });
});
