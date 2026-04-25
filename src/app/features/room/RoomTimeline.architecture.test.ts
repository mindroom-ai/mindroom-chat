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
    const compatibilitySource = readFileSync(
      new URL('./roomTimelineEvents.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/roomTimelineEvents.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('export const isRenderableEvent =');
    expect(source).not.toContain('export const getRoomPreloadCounts =');
    expect(source).toContain("from '../../mindroom/threads/roomTimelineEvents'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/roomTimelineEvents'");
    expect(implementationSource).toContain('buildRoomSurfaceEventEntries');
    expect(compatibilitySource).not.toContain('KNOWN_EVENT_TYPES');
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
    const roomCacheLifecycleSource = readFileSync(
      new URL('../../mindroom/threads/roomCacheLifecycleController.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('persistRoomEventCacheSnapshot');
    expect(roomCacheLifecycleSource).toContain('persistRoomEventCacheSnapshot');
    expect(source).toContain('useRoomCacheLifecycleController');
    expect(source).toContain('useThreadCachePersistenceController');
    expect(source).toContain("from '../../mindroom/threads/threadCachePersistenceController'");
    expect(source).toContain("from '../../mindroom/threads/roomCacheLifecycleController'");
    expect(source).not.toContain('saveRoomEventsToCache(');
    expect(source).not.toContain('saveThreadEventsToCache(');
    expect(source).not.toContain('serializeRoomCacheEvents(room');
    expect(source).not.toContain('serializeThreadCacheEvents(room');
    expect(source).not.toContain('groupThreadCacheEvents');
    expect(source).not.toContain('getRoomDerivedThreadSnapshotState');
    expect(source).not.toContain('persistThreadEventCacheSnapshot');
    expect(source).not.toContain('persistThreadCacheFromRoomEventsSnapshot');
    expect(source).not.toContain('roomThreadCacheFlushQueuedRef');
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
    const seedPrewarmControllerSource = readFileSync(
      new URL('../../mindroom/threads/threadSeedPrewarmController.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('cachedThreadEvents.unshift(...cachedPage.events)');
    expect(source).not.toContain('loadThreadCachedSnapshot');
    expect(seedPrewarmControllerSource).toContain('loadThreadCachedSnapshot');
  });

  it('delegates cached thread event mapping and pagination reads to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const paginationControllerSource = readFileSync(
      new URL('../../mindroom/threads/threadPaginationCommandController.ts', import.meta.url),
      'utf8'
    );
    const cacheFirstSource = readFileSync(
      new URL('../../mindroom/threads/threadOpenCacheFirst.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('loadThreadCachedPaginationSnapshot');
    expect(paginationControllerSource).toContain('loadThreadCachedPaginationSnapshot');
    expect(cacheFirstSource).toContain('mapCachedThreadPageEvents');
    expect(source).not.toContain('mapCachedThreadPageEvents');
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

  it('delegates thread seed prewarm queue orchestration to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useThreadSeedPrewarmController');
    expect(source).toContain("from '../../mindroom/threads/threadSeedPrewarmController'");
    expect(source).not.toContain('visibleThreadSeedPrewarmQueueRef');
    expect(source).not.toContain('visibleThreadSeedPrewarmRunningRef');
    expect(source).not.toContain('visibleThreadSeedPrewarmGenerationRef');
  });

  it('delegates thread-open cache/network commands to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useThreadOpenCacheController');
    expect(source).toContain("from '../../mindroom/threads/threadOpenCacheController'");
    expect(source).not.toContain('const refreshLatestThreadSlice = useCallback');
    expect(source).not.toContain('const backfillThreadRelationsIntoCache = useCallback');
    expect(source).not.toContain('const refreshLatestThreadRelationsTail = useCallback');
    expect(source).not.toContain('const hydrateThreadFromCache = useCallback');
  });

  it('delegates thread-open SDK bootstrap to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const bootstrapSource = readFileSync(
      new URL('../../mindroom/threads/threadOpenSdkBootstrap.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('runThreadOpenSdkBootstrap');
    expect(bootstrapSource).toContain('thread-sdk-bootstrap-ready');
    expect(source).not.toContain('thread-sdk-bootstrap-context-error');
    expect(source).not.toContain('isPendingLocalEchoThreadRoot');
    expect(source).not.toContain('isZeroReplyStandaloneThreadRootEvent');
  });

  it('delegates thread-open cache-first decisions to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const cacheFirstSource = readFileSync(
      new URL('../../mindroom/threads/threadOpenCacheFirst.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('runThreadOpenCacheFirst');
    expect(cacheFirstSource).toContain('thread-open-complete-cache-hit');
    expect(source).not.toContain('thread-open-complete-cache-hit');
    expect(source).not.toContain('shouldBackfillThreadRelationsFromCoverage');
    expect(source).not.toContain('hasUsableThreadCacheSnapshot');
  });

  it('delegates thread-open post-bootstrap refresh to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const refreshSource = readFileSync(
      new URL('../../mindroom/threads/threadOpenPostBootstrapRefresh.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('runThreadOpenPostBootstrapRefresh');
    expect(refreshSource).toContain('thread-open-forward-gap-check');
    expect(source).not.toContain('thread-open-forward-gap-check');
    expect(source).not.toContain('computeReconciliationToken');
  });

  it('delegates thread-open target-event context loading to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const targetEventSource = readFileSync(
      new URL('../../mindroom/threads/threadOpenTargetEvent.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('runThreadOpenTargetEvent');
    expect(targetEventSource).toContain('setPendingThreadOpen');
    expect(source).not.toContain('evtThreadTimelineSet');
  });

  it('delegates thread-aware timeline refresh orchestration to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const refreshHookSource = readFileSync(
      new URL('../../mindroom/threads/useThreadAwareTimelineRefresh.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain(
      "from '../../mindroom/threads/useThreadAwareTimelineRefresh'"
    );
    expect(refreshHookSource).toContain('RoomEvent.TimelineRefresh');
    expect(source).not.toContain('const useLiveTimelineRefresh');
    expect(source).not.toContain('threadRefreshInFlightRef');
  });

  it('keeps compact thread root data implementation in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const compatibilitySource = readFileSync(
      new URL('./compactThreadRootData.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/compactThreadRootData.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/compactThreadRootData'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/compactThreadRootData'");
    expect(implementationSource).toContain('buildCompactThreadRootData');
    expect(implementationSource).toContain('isZeroReplyStandaloneThreadRootEvent');
    expect(compatibilitySource).not.toContain('getThreadRelationTargetId');
  });

  it('keeps thread presentation derivation in MindRoom threads', () => {
    const compatibilitySource = readFileSync(
      new URL('./threadPresentation.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/threadPresentation.ts', import.meta.url),
      'utf8'
    );

    expect(compatibilitySource).toContain("from '../../mindroom/threads/threadPresentation'");
    expect(implementationSource).toContain('resolveThreadPresentationSnapshot');
    expect(implementationSource).toContain('getLatestThreadSummaryInfoFromEventSources');
    expect(compatibilitySource).not.toContain('getLatestRenderableVisibleThreadReplyEvent');
  });

  it('keeps thread filter DSL parsing in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const compatibilitySource = readFileSync(
      new URL('./threadFilterDsl.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/threadFilterDsl.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/threadFilterDsl'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/threadFilterDsl'");
    expect(implementationSource).toContain('parseThreadFilterQuery');
    expect(implementationSource).toContain('serializeThreadFilterQuery');
    expect(compatibilitySource).not.toContain('looksLikeDslToken');
  });

  it('keeps compact room view components in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const compatibilitySource = readFileSync(new URL('./CompactRoomView.tsx', import.meta.url), 'utf8');
    const cardCompatibilitySource = readFileSync(
      new URL('./CompactThreadCard.tsx', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/CompactRoomView.tsx', import.meta.url),
      'utf8'
    );
    const cardImplementationSource = readFileSync(
      new URL('../../mindroom/threads/CompactThreadCard.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/CompactRoomView'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/CompactRoomView'");
    expect(cardCompatibilitySource).toContain("from '../../mindroom/threads/CompactThreadCard'");
    expect(implementationSource).toContain('useCompactThreadCardViewModels');
    expect(cardImplementationSource).toContain('CompactThreadCardViewModel');
    expect(compatibilitySource).not.toContain('useCompactThreadCardViewModels');
  });

  it('keeps compact thread scheduled-label utilities in MindRoom threads', () => {
    const hookSource = readFileSync(
      new URL('../../hooks/useThreadHeaderInfo.ts', import.meta.url),
      'utf8'
    );
    const viewModelSource = readFileSync(
      new URL('../../mindroom/threads/compactThreadCardViewModel.ts', import.meta.url),
      'utf8'
    );
    const compatibilitySource = readFileSync(
      new URL('./compactThreadCardUtils.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/compactThreadCardUtils.ts', import.meta.url),
      'utf8'
    );

    expect(hookSource).toContain("from '../mindroom/threads/compactThreadCardUtils'");
    expect(viewModelSource).toContain("from './compactThreadCardUtils'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/compactThreadCardUtils'");
    expect(implementationSource).toContain('formatScheduledTime');
    expect(implementationSource).toContain('getScheduledTimeUpdateInterval');
    expect(compatibilitySource).not.toContain('SIX_HOURS_MS');
  });

  it('keeps room thread overview controls in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const compatibilitySource = readFileSync(
      new URL('./RoomThreadOverview.tsx', import.meta.url),
      'utf8'
    );
    const cssCompatibilitySource = readFileSync(
      new URL('./RoomThreadOverview.css.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/RoomThreadOverview.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/RoomThreadOverview'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/RoomThreadOverview'");
    expect(cssCompatibilitySource).toContain("from '../../mindroom/threads/RoomThreadOverview.css'");
    expect(implementationSource).toContain('RoomThreadOverviewProps');
    expect(implementationSource).toContain('FILTER_PRESETS');
    expect(compatibilitySource).not.toContain('FILTER_PRESETS');
  });

  it('keeps room thread overview model in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const compatibilitySource = readFileSync(
      new URL('./roomThreadOverviewModel.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/roomThreadOverviewModel.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/roomThreadOverviewModel'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/roomThreadOverviewModel'");
    expect(implementationSource).toContain('createDefaultThreadFilterState');
    expect(implementationSource).toContain('buildThreadMetadataMap');
    expect(compatibilitySource).not.toContain('buildThreadMetadataMap');
  });

  it('keeps thread relation and route utilities in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const utilityCompatibilitySource = readFileSync(
      new URL('./threadUtils.ts', import.meta.url),
      'utf8'
    );
    const routeCompatibilitySource = readFileSync(
      new URL('./threadRouteUtils.ts', import.meta.url),
      'utf8'
    );
    const utilitySource = readFileSync(
      new URL('../../mindroom/threads/threadUtils.ts', import.meta.url),
      'utf8'
    );
    const routeSource = readFileSync(
      new URL('../../mindroom/threads/threadRouteUtils.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/threadUtils'");
    expect(utilityCompatibilitySource).toContain("from '../../mindroom/threads/threadUtils'");
    expect(routeCompatibilitySource).toContain("from '../../mindroom/threads/threadRouteUtils'");
    expect(utilitySource).toContain('getPreferredVisibleThreadReplyEvents');
    expect(routeSource).toContain('resolveCanonicalThreadRootId');
    expect(utilityCompatibilitySource).not.toContain('getPreferredVisibleThreadReplyEvents');
    expect(routeCompatibilitySource).not.toContain('resolveCanonicalThreadRootId');
  });

  it('keeps thread render identity utilities in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const compatibilitySource = readFileSync(
      new URL('./threadRenderUtils.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/threadRenderUtils.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/threadRenderUtils'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/threadRenderUtils'");
    expect(implementationSource).toContain('mergeThreadRenderEvents');
    expect(implementationSource).toContain('buildResolveConfirmedEventId');
    expect(implementationSource).toContain('isThreadOnlyRoomActivity');
    expect(compatibilitySource).not.toContain('getEffectiveReplacementEvent');
  });

  it('keeps thread render state merging in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const compatibilitySource = readFileSync(
      new URL('./useThreadRenderState.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/useThreadRenderState.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/useThreadRenderState'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/useThreadRenderState'");
    expect(implementationSource).toContain('setSupplementalThreadEvents');
    expect(implementationSource).toContain('mergeThreadRenderEvents');
    expect(compatibilitySource).not.toContain('fallbackThreadEventsRef');
  });

  it('keeps thread tag state and hooks in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const tagsCompatibilitySource = readFileSync(
      new URL('./threadTags.ts', import.meta.url),
      'utf8'
    );
    const hookCompatibilitySource = readFileSync(
      new URL('./useRoomThreadTags.ts', import.meta.url),
      'utf8'
    );
    const tagsSource = readFileSync(
      new URL('../../mindroom/threads/threadTags.ts', import.meta.url),
      'utf8'
    );
    const hookSource = readFileSync(
      new URL('../../mindroom/threads/useRoomThreadTags.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/useRoomThreadTags'");
    expect(tagsCompatibilitySource).toContain("from '../../mindroom/threads/threadTags'");
    expect(hookCompatibilitySource).toContain("from '../../mindroom/threads/useRoomThreadTags'");
    expect(tagsSource).toContain('aggregateThreadTagEvents');
    expect(hookSource).toContain('useRoomThreadResolutionMap');
    expect(tagsCompatibilitySource).not.toContain('aggregateThreadTagEvents');
    expect(hookCompatibilitySource).not.toContain('useRoomThreadResolutionMap');
  });

  it('keeps thread banner and tag UI in MindRoom threads', () => {
    const roomViewSource = readFileSync(new URL('./RoomView.tsx', import.meta.url), 'utf8');
    const bannerCompatibilitySource = readFileSync(
      new URL('./ThreadContextBanner.tsx', import.meta.url),
      'utf8'
    );
    const pickerCompatibilitySource = readFileSync(
      new URL('./ThreadTagPicker.tsx', import.meta.url),
      'utf8'
    );
    const bannerSource = readFileSync(
      new URL('../../mindroom/threads/ThreadContextBanner.tsx', import.meta.url),
      'utf8'
    );
    const pickerSource = readFileSync(
      new URL('../../mindroom/threads/ThreadTagPicker.tsx', import.meta.url),
      'utf8'
    );

    expect(roomViewSource).toContain("from '../../mindroom/threads/ThreadContextBanner'");
    expect(bannerCompatibilitySource).toContain("from '../../mindroom/threads/ThreadContextBanner'");
    expect(pickerCompatibilitySource).toContain("from '../../mindroom/threads/ThreadTagPicker'");
    expect(bannerSource).toContain('buildThreadHeaderViewModelFromRecord');
    expect(pickerSource).toContain('normalizeTagName');
    expect(bannerCompatibilitySource).not.toContain('buildThreadHeaderViewModelFromRecord');
    expect(pickerCompatibilitySource).not.toContain('normalizeTagName');
  });

  it('keeps thread summary cache and state in MindRoom threads', () => {
    const roomViewSource = readFileSync(new URL('./RoomView.tsx', import.meta.url), 'utf8');
    const cacheCompatibilitySource = readFileSync(
      new URL('./threadSummaryCache.ts', import.meta.url),
      'utf8'
    );
    const stateCompatibilitySource = readFileSync(
      new URL('./threadSummaryState.ts', import.meta.url),
      'utf8'
    );
    const cacheSource = readFileSync(
      new URL('../../mindroom/threads/threadSummaryCache.ts', import.meta.url),
      'utf8'
    );
    const stateSource = readFileSync(
      new URL('../../mindroom/threads/threadSummaryState.ts', import.meta.url),
      'utf8'
    );

    expect(roomViewSource).toContain("from '../../mindroom/threads/useRoomThreadSummaryState'");
    expect(cacheCompatibilitySource).toContain("from '../../mindroom/threads/threadSummaryCache'");
    expect(stateCompatibilitySource).toContain("from '../../mindroom/threads/threadSummaryState'");
    expect(cacheSource).toContain('loadCachedThreadSummaries');
    expect(stateSource).toContain('storeThreadSummaryInState');
    expect(cacheCompatibilitySource).not.toContain('indexedDB');
    expect(stateCompatibilitySource).not.toContain('useSyncExternalStore');
  });

  it('keeps thread root route canonicalization in MindRoom threads', () => {
    const roomViewSource = readFileSync(new URL('./RoomView.tsx', import.meta.url), 'utf8');
    const compatibilitySource = readFileSync(
      new URL('./useThreadRootEvent.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/useThreadRootEvent.ts', import.meta.url),
      'utf8'
    );

    expect(roomViewSource).toContain("from '../../mindroom/threads/useThreadRootEvent'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/useThreadRootEvent'");
    expect(implementationSource).toContain('resolveCanonicalThreadRootId');
    expect(implementationSource).toContain('RoomEvent.LocalEchoUpdated');
    expect(compatibilitySource).not.toContain('RoomEvent.LocalEchoUpdated');
  });

  it('delegates overview resume refresh orchestration to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useThreadOverviewResumeController');
    expect(source).toContain("from '../../mindroom/threads/threadOverviewResumeController'");
    expect(source).not.toContain('overviewResumeRefreshInFlightRef');
    expect(source).not.toContain('pendingOverviewResumeRefreshRef');
    expect(source).not.toContain('refreshOverviewThreadCacheFromRelations');
  });

  it('delegates compact root edit backfill orchestration to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useCompactRootEditBackfillController');
    expect(source).toContain("from '../../mindroom/threads/compactRootEditBackfillController'");
    expect(source).not.toContain('compactRootEditFetchAttemptedRef');
    expect(source).not.toContain('getCompactRootEventsNeedingBackfill');
    expect(source).not.toContain('compactRootBackfill:start');
  });

  it('delegates thread edit backfill orchestration to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useThreadEditBackfillController');
    expect(source).toContain("from '../../mindroom/threads/threadEditBackfillController'");
    expect(source).not.toContain('const loadMissingThreadEdits = async');
    expect(source).not.toContain('shouldFetchThreadEditBackfill');
    expect(source).not.toContain('markThreadEditBackfillAttempted');
    expect(source).not.toContain('threadBackfill:start');
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

  it('delegates thread pagination commands to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useThreadPaginationCommandController');
    expect(source).toContain("from '../../mindroom/threads/threadPaginationCommandController'");
    expect(source).not.toContain('const handleThreadPaginateBack = useCallback');
    expect(source).not.toContain('const handleThreadPaginateFront = useCallback');
    expect(source).not.toContain('threadPaginatingFrontRef');
  });

  it('delegates room cache pagination commands to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain('useRoomPaginationCommandController');
    expect(source).toContain("from '../../mindroom/threads/roomPaginationCommandController'");
    expect(source).not.toContain('loadRoomCachedPaginationSnapshot');
    expect(source).not.toContain('resolveHydratedRoomBeforeToken');
    expect(source).not.toContain('THREAD_RELATION_TYPE');
  });

  it('keeps thread-open seed cache in the MindRoom thread namespace', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).toContain("from '../../mindroom/threads/threadOpenSeedController'");
    expect(source).not.toContain("from './threadOpenSeedCache'");
    expect(source).not.toContain('thread-open-seed-scan');
    expect(source).not.toContain('THREAD_OPEN_PREWARM_WAIT_MS');
  });

  it('delegates latest room cache hydration decisions to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const hydrationControllerSource = readFileSync(
      new URL('../../mindroom/threads/roomCacheHydrationController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useRoomCacheHydrationController');
    expect(source).toContain("from '../../mindroom/threads/roomCacheHydrationController'");
    expect(source).not.toContain('loadLatestRoomCacheHydrationSnapshot');
    expect(hydrationControllerSource).toContain('loadLatestRoomCacheHydrationSnapshot');
    expect(source).not.toContain('loadLatestCachedRoomEvents');
    expect(source).not.toContain('shouldHydrateLatestRoomCache(');
    expect(source).not.toContain('filterLatestRoomCacheHydrationEvents(');
  });

  it('delegates cached room pagination reads to the event repository', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const paginationControllerSource = readFileSync(
      new URL('../../mindroom/threads/roomPaginationCommandController.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('loadRoomCachedPaginationSnapshot');
    expect(paginationControllerSource).toContain('loadRoomCachedPaginationSnapshot');
    expect(source).not.toContain('loadCachedRoomEventsBefore');
    expect(source).not.toContain('loadCachedRoomPaginationToken');
    expect(source).not.toContain('resolvePersistedRoomBeforeToken');
    expect(source).not.toContain('normalizeCachedRoomEvents');
  });
});
