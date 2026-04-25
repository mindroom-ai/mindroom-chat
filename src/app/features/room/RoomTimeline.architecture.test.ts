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
    const targetCompatibilitySource = readFileSync(
      new URL('./roomPreloadTarget.ts', import.meta.url),
      'utf8'
    );
    const windowControllerSource = readFileSync(
      new URL('../../mindroom/threads/roomTimelineWindowController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useRoomEagerPreload');
    expect(source).toContain('useRoomTimelineWindowController');
    expect(source).not.toContain("from '../../mindroom/threads/roomPreloadTarget'");
    expect(windowControllerSource).toContain("from './roomPreloadTarget'");
    expect(targetCompatibilitySource).toContain("from '../../mindroom/threads/roomPreloadTarget'");
    expect(source).not.toContain('[eager-preload]');
  });

  it('does not import raw event cache stores directly', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain("from './roomEventCache'");
    expect(source).not.toContain("from './threadEventCache'");
    expect(source).not.toContain("from '../../mindroom/threads/eventRepository'");
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
    const windowControllerSource = readFileSync(
      new URL('../../mindroom/threads/roomTimelineWindowController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useRoomTimelineWindowController');
    expect(source).not.toContain("from '../../mindroom/threads/threadCacheCoverage'");
    expect(windowControllerSource).toContain("from './threadCacheCoverage'");
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

  it('keeps thread route deep-link resolution in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const compatibilitySource = readFileSync(
      new URL('./roomDeepLink.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/roomDeepLink.ts', import.meta.url),
      'utf8'
    );
    const indexSource = readFileSync(
      new URL('../../mindroom/threads/useMindroomThreadIndex.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/roomDeepLink'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/roomDeepLink'");
    expect(implementationSource).toContain('resolveRoomEventThreadRedirect');
    expect(implementationSource).toContain('getRoomEventThreadOpenTarget');
    expect(indexSource).toContain("from './roomDeepLink'");
    expect(indexSource).not.toContain('../../features/room/roomDeepLink');
  });

  it('keeps last-open-thread state in MindRoom threads', () => {
    const compatibilitySource = readFileSync(
      new URL('../../state/lastOpenThread.ts', import.meta.url),
      'utf8'
    );
    const clientStorageSource = readFileSync(
      new URL('../../pages/client/ClientInitStorageAtom.tsx', import.meta.url),
      'utf8'
    );
    const roomSource = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');
    const clientLayoutSource = readFileSync(
      new URL('../../pages/client/ClientLayout.tsx', import.meta.url),
      'utf8'
    );
    const sessionCleanupSource = readFileSync(
      new URL('../../mindroom/cache/sessionCleanup.ts', import.meta.url),
      'utf8'
    );
    const initMatrixSource = readFileSync(
      new URL('../../../client/initMatrix.ts', import.meta.url),
      'utf8'
    );

    expect(compatibilitySource.trim()).toBe("export * from '../mindroom/threads/lastOpenThread';");
    expect(clientStorageSource).toContain("from '../../mindroom/threads/lastOpenThread'");
    expect(roomSource).toContain("from '../../mindroom/threads/lastOpenThread'");
    expect(clientLayoutSource).toContain("from '../../mindroom/threads/lastOpenThread'");
    expect(sessionCleanupSource).toContain("from '../threads/lastOpenThread'");
    expect(initMatrixSource).not.toContain("from '../app/state/lastOpenThread'");
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
    const lifecycleSource = readFileSync(
      new URL('../../mindroom/threads/threadOpenLifecycleController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useThreadOpenLifecycleController');
    expect(source).not.toContain('runThreadOpenSdkBootstrap');
    expect(lifecycleSource).toContain('runThreadOpenSdkBootstrap');
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
    const lifecycleSource = readFileSync(
      new URL('../../mindroom/threads/threadOpenLifecycleController.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('runThreadOpenCacheFirst');
    expect(lifecycleSource).toContain('runThreadOpenCacheFirst');
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
    const lifecycleSource = readFileSync(
      new URL('../../mindroom/threads/threadOpenLifecycleController.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('runThreadOpenPostBootstrapRefresh');
    expect(lifecycleSource).toContain('runThreadOpenPostBootstrapRefresh');
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
    const lifecycleSource = readFileSync(
      new URL('../../mindroom/threads/threadOpenLifecycleController.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('runThreadOpenTargetEvent');
    expect(lifecycleSource).toContain('runThreadOpenTargetEvent');
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
    const indexSource = readFileSync(
      new URL('../../mindroom/threads/useMindroomThreadIndex.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain("from '../../mindroom/threads/compactThreadRootData'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/compactThreadRootData'");
    expect(implementationSource).toContain('buildCompactThreadRootData');
    expect(implementationSource).toContain('isZeroReplyStandaloneThreadRootEvent');
    expect(indexSource).toContain("from './compactThreadRootData'");
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
    const hookCompatibilitySource = readFileSync(
      new URL('../../hooks/useThreadHeaderInfo.ts', import.meta.url),
      'utf8'
    );
    const hookImplementationSource = readFileSync(
      new URL('../../mindroom/threads/useThreadHeaderInfo.ts', import.meta.url),
      'utf8'
    );
    const viewModelSource = readFileSync(
      new URL('../../mindroom/threads/compactThreadCardViewModel.ts', import.meta.url),
      'utf8'
    );
    const scheduledTaskCompatibilitySource = readFileSync(
      new URL('../../utils/scheduledTaskContract.ts', import.meta.url),
      'utf8'
    );
    const scheduledTaskImplementationSource = readFileSync(
      new URL('../../mindroom/threads/scheduledTaskContract.ts', import.meta.url),
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

    expect(hookCompatibilitySource).toContain("from '../mindroom/threads/useThreadHeaderInfo'");
    expect(hookImplementationSource).toContain("from './compactThreadCardUtils'");
    expect(hookImplementationSource).toContain("from './scheduledTaskContract'");
    expect(viewModelSource).toContain("from './compactThreadCardUtils'");
    expect(scheduledTaskCompatibilitySource).toContain(
      "from '../mindroom/threads/scheduledTaskContract'"
    );
    expect(scheduledTaskImplementationSource).toContain('parseScheduledTaskStateEvent');
    expect(compatibilitySource).toContain("from '../../mindroom/threads/compactThreadCardUtils'");
    expect(implementationSource).toContain('formatScheduledTime');
    expect(implementationSource).toContain('getScheduledTimeUpdateInterval');
    expect(hookCompatibilitySource).not.toContain('StateEvent.MindRoomScheduledTask');
    expect(compatibilitySource).not.toContain('SIX_HOURS_MS');
  });

  it('keeps thread activity timestamp derivation in MindRoom threads', () => {
    const hookCompatibilitySource = readFileSync(
      new URL('../../hooks/useThreadLastActivityTs.ts', import.meta.url),
      'utf8'
    );
    const hookImplementationSource = readFileSync(
      new URL('../../mindroom/threads/useThreadLastActivityTs.ts', import.meta.url),
      'utf8'
    );
    const replySource = readFileSync(
      new URL('../../components/message/Reply.tsx', import.meta.url),
      'utf8'
    );

    expect(hookCompatibilitySource).toContain(
      "from '../mindroom/threads/useThreadLastActivityTs'"
    );
    expect(hookImplementationSource).toContain('getThreadLastActivityTs');
    expect(hookImplementationSource).toContain("from './threadUtils'");
    expect(replySource).toContain("from '../../mindroom/threads/useThreadLastActivityTs'");
    expect(hookCompatibilitySource).not.toContain('isVisibleThreadReplyEvent');
  });

  it('keeps cache-aware room event loading in MindRoom threads', () => {
    const hookCompatibilitySource = readFileSync(
      new URL('../../hooks/useRoomEvent.ts', import.meta.url),
      'utf8'
    );
    const hookImplementationSource = readFileSync(
      new URL('../../mindroom/threads/useRoomEvent.ts', import.meta.url),
      'utf8'
    );
    const replySource = readFileSync(
      new URL('../../components/message/Reply.tsx', import.meta.url),
      'utf8'
    );
    const pinMenuSource = readFileSync(
      new URL('./room-pin-menu/RoomPinMenu.tsx', import.meta.url),
      'utf8'
    );

    expect(hookCompatibilitySource).toContain("from '../mindroom/threads/useRoomEvent'");
    expect(hookImplementationSource).toContain('loadCachedThreadEvent');
    expect(hookImplementationSource).toContain("from './eventRepository'");
    expect(replySource).toContain("from '../../mindroom/threads/useRoomEvent'");
    expect(pinMenuSource).toContain("from '../../../mindroom/threads/useRoomEvent'");
    expect(hookCompatibilitySource).not.toContain('loadCachedThreadEvent');
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
    const eventOpenSource = readFileSync(
      new URL('../../mindroom/threads/roomEventOpenController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useRoomEventOpenController');
    expect(eventOpenSource).toContain("from './threadUtils'");
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
    const publishControllerSource = readFileSync(
      new URL('../../mindroom/threads/threadSummaryPublishController.ts', import.meta.url),
      'utf8'
    );
    const timelineSource = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(roomViewSource).toContain("from '../../mindroom/threads/useRoomThreadSummaryState'");
    expect(timelineSource).toContain("from '../../mindroom/threads/threadSummaryPublishController'");
    expect(timelineSource).not.toContain('threadSummaryInfoMap.forEach');
    expect(cacheCompatibilitySource).toContain("from '../../mindroom/threads/threadSummaryCache'");
    expect(stateCompatibilitySource).toContain("from '../../mindroom/threads/threadSummaryState'");
    expect(cacheSource).toContain('loadCachedThreadSummaries');
    expect(stateSource).toContain('storeThreadSummaryInState');
    expect(publishControllerSource).toContain('useThreadSummaryPublishController');
    expect(cacheCompatibilitySource).not.toContain('indexedDB');
    expect(stateCompatibilitySource).not.toContain('useSyncExternalStore');
  });

  it('keeps MindRoom message primitives in the MindRoom namespace', () => {
    const renderContentSource = readFileSync(
      new URL('../../components/RenderMessageContent.tsx', import.meta.url),
      'utf8'
    );
    const mindroomRenderContentSource = readFileSync(
      new URL('../../mindroom/messages/renderMindroomMessageContent.tsx', import.meta.url),
      'utf8'
    );
    const messageIndexSource = readFileSync(
      new URL('../../components/message/index.ts', import.meta.url),
      'utf8'
    );
    const msgTypeRenderersSource = readFileSync(
      new URL('../../components/message/MsgTypeRenderers.tsx', import.meta.url),
      'utf8'
    );
    const threadSummaryCompatibilitySource = readFileSync(
      new URL('../../components/message/mindroomThreadSummary.ts', import.meta.url),
      'utf8'
    );
    const toolApprovalCompatibilitySource = readFileSync(
      new URL('../../components/message/mindroomToolApproval.ts', import.meta.url),
      'utf8'
    );
    const toolApprovalCardCompatibilitySource = readFileSync(
      new URL('../../components/message/MindroomToolApprovalCard.tsx', import.meta.url),
      'utf8'
    );
    const aiRunCompatibilitySource = readFileSync(
      new URL('../../components/message/mindroomAiRun.ts', import.meta.url),
      'utf8'
    );
    const aiRunDisplayCompatibilitySource = readFileSync(
      new URL('../../components/message/mindroomAiRunDisplay.ts', import.meta.url),
      'utf8'
    );
    const blocksCompatibilitySource = readFileSync(
      new URL('../../components/message/mindroomBlocks.ts', import.meta.url),
      'utf8'
    );
    const longTextCompatibilitySource = readFileSync(
      new URL('../../components/message/mindroomLongText.ts', import.meta.url),
      'utf8'
    );
    const longTextTextCompatibilitySource = readFileSync(
      new URL('../../components/message/MindroomLongTextText.tsx', import.meta.url),
      'utf8'
    );
    const toolTraceCompatibilitySource = readFileSync(
      new URL('../../components/message/mindroomToolTrace.ts', import.meta.url),
      'utf8'
    );
    const roomMessageSource = readFileSync(
      new URL('./message/Message.tsx', import.meta.url),
      'utf8'
    );
    const roomMessageStyleSource = readFileSync(
      new URL('./message/styles.css.ts', import.meta.url),
      'utf8'
    );
    const parserSource = readFileSync(
      new URL('../../plugins/react-custom-html-parser.tsx', import.meta.url),
      'utf8'
    );
    const searchResultPreviewSource = readFileSync(
      new URL('../message-search/searchResultPreview.ts', import.meta.url),
      'utf8'
    );
    const customHtmlStyleSource = readFileSync(
      new URL('../../styles/CustomHtml.css.ts', import.meta.url),
      'utf8'
    );
    const roomUtilsSource = readFileSync(new URL('../../utils/room.ts', import.meta.url), 'utf8');
    const streamingHookSource = readFileSync(
      new URL('../../hooks/useThreadStreamingState.ts', import.meta.url),
      'utf8'
    );
    const streamingHookImplementationSource = readFileSync(
      new URL('../../mindroom/threads/useThreadStreamingState.ts', import.meta.url),
      'utf8'
    );
    const threadSummarySource = readFileSync(
      new URL('../../mindroom/messages/threadSummary.ts', import.meta.url),
      'utf8'
    );
    const toolApprovalSource = readFileSync(
      new URL('../../mindroom/messages/toolApproval.ts', import.meta.url),
      'utf8'
    );
    const aiRunSource = readFileSync(
      new URL('../../mindroom/messages/aiRun.ts', import.meta.url),
      'utf8'
    );
    const blocksSource = readFileSync(
      new URL('../../mindroom/messages/blocks.ts', import.meta.url),
      'utf8'
    );
    const longTextSource = readFileSync(
      new URL('../../mindroom/messages/longText.ts', import.meta.url),
      'utf8'
    );
    const longTextDownloadSource = readFileSync(
      new URL('../../mindroom/messages/longTextDownload.ts', import.meta.url),
      'utf8'
    );
    const toolTraceSource = readFileSync(
      new URL('../../mindroom/messages/toolTrace.ts', import.meta.url),
      'utf8'
    );
    const htmlBlocksSource = readFileSync(
      new URL('../../mindroom/messages/MindroomHtmlBlocks.tsx', import.meta.url),
      'utf8'
    );
    const htmlBlocksStyleSource = readFileSync(
      new URL('../../mindroom/messages/MindroomHtmlBlocks.css.ts', import.meta.url),
      'utf8'
    );
    const threadSummaryCardSource = readFileSync(
      new URL('../../mindroom/messages/MindroomThreadSummaryCard.tsx', import.meta.url),
      'utf8'
    );
    const messageControlsSource = readFileSync(
      new URL('../../mindroom/messages/MindroomMessageControls.tsx', import.meta.url),
      'utf8'
    );
    const threadBadgeSource = readFileSync(
      new URL('../../mindroom/threads/ThreadBadgeRenderer.tsx', import.meta.url),
      'utf8'
    );
    const metadataSource = readFileSync(
      new URL('../../mindroom/messages/metadata.ts', import.meta.url),
      'utf8'
    );

    expect(renderContentSource).toContain("../mindroom/messages/renderMindroomMessageContent");
    expect(renderContentSource).not.toContain("../mindroom/messages/threadSummary");
    expect(renderContentSource).not.toContain("../mindroom/messages/toolApproval");
    expect(renderContentSource).not.toContain("../mindroom/messages/MindroomToolApprovalCard");
    expect(renderContentSource).not.toContain("../mindroom/messages/longText");
    expect(renderContentSource).not.toContain("../mindroom/messages/MindroomLongTextText");
    expect(renderContentSource).not.toContain("../mindroom/messages/aiRun");
    expect(renderContentSource).not.toContain('./message/mindroomThreadSummary');
    expect(renderContentSource).not.toContain('./message/mindroomToolApproval');
    expect(renderContentSource).not.toContain('./message/MindroomToolApprovalCard');
    expect(renderContentSource).not.toContain('./message/mindroomLongText');
    expect(renderContentSource).not.toContain('./message/MindroomLongTextText');
    expect(renderContentSource).not.toContain('./message/mindroomAiRun');
    expect(mindroomRenderContentSource).toContain('./threadSummary');
    expect(mindroomRenderContentSource).toContain('./toolApproval');
    expect(mindroomRenderContentSource).toContain('./MindroomToolApprovalCard');
    expect(mindroomRenderContentSource).toContain('./longText');
    expect(mindroomRenderContentSource).toContain('./MindroomLongTextText');
    expect(mindroomRenderContentSource).toContain('./aiRun');
    expect(mindroomRenderContentSource).toContain('withMindroomToolTraceMarkerParserOptions');
    expect(roomMessageSource).toContain("from '../../../mindroom/messages/MindroomMessageControls'");
    expect(roomMessageSource).not.toContain("from '../../../mindroom/messages/longText'");
    expect(roomMessageSource).not.toContain("from '../../../mindroom/messages/MindroomLongTextText'");
    expect(roomMessageSource).not.toContain("from '../../../mindroom/messages/aiRun'");
    expect(roomMessageSource).not.toContain("from '../../../mindroom/messages/aiRunDisplay'");
    expect(roomMessageSource).not.toContain('getLongTextDownloadName');
    expect(roomMessageSource).not.toContain('downloadMindroomLongTextSidecarBlob');
    expect(roomMessageSource).not.toContain('getMindroomAiRunModelLabel');
    expect(roomMessageStyleSource).not.toContain('MessageAiRunInfoButton');
    expect(parserSource).toContain("from '../mindroom/messages/MindroomHtmlBlocks'");
    expect(parserSource).not.toContain("from '../mindroom/messages/blocks'");
    expect(parserSource).not.toContain("from '../mindroom/messages/toolTrace'");
    expect(parserSource).not.toContain('MINDROOM_BLOCK_META');
    expect(parserSource).not.toContain('MindroomCollapsibleBlock');
    expect(searchResultPreviewSource).toContain("from '../../mindroom/messages/longText'");
    expect(searchResultPreviewSource).not.toContain("content?.['io.mindroom.long_text']");
    expect(roomUtilsSource).toContain("from '../mindroom/messages/metadata'");
    expect(roomUtilsSource).not.toContain("key.startsWith('io.mindroom.')");
    expect(roomUtilsSource).not.toContain("key.startsWith('com.mindroom.')");
    expect(customHtmlStyleSource).not.toContain('MindroomBlock');
    expect(customHtmlStyleSource).not.toContain('MindroomToolGroup');
    expect(streamingHookSource.trim()).toBe(
      "export * from '../mindroom/threads/useThreadStreamingState';"
    );
    expect(streamingHookImplementationSource).toContain("from '../messages/aiRun'");
    expect(streamingHookImplementationSource).toContain('STREAM_STATUS_KEY');
    expect(messageIndexSource).toContain(
      "from '../../mindroom/messages/MindroomThreadSummaryCard'"
    );
    expect(msgTypeRenderersSource).not.toContain('function MindroomThreadSummaryCard');
    expect(threadSummaryCompatibilitySource.trim()).toBe(
      "export * from '../../mindroom/messages/threadSummary';"
    );
    expect(toolApprovalCompatibilitySource.trim()).toBe(
      "export * from '../../mindroom/messages/toolApproval';"
    );
    expect(toolApprovalCardCompatibilitySource.trim()).toBe(
      "export { MindroomToolApprovalCard } from '../../mindroom/messages/MindroomToolApprovalCard';"
    );
    expect(aiRunCompatibilitySource.trim()).toBe(
      "export * from '../../mindroom/messages/aiRun';"
    );
    expect(aiRunDisplayCompatibilitySource.trim()).toBe(
      "export * from '../../mindroom/messages/aiRunDisplay';"
    );
    expect(blocksCompatibilitySource.trim()).toBe(
      "export * from '../../mindroom/messages/blocks';"
    );
    expect(longTextCompatibilitySource.trim()).toBe(
      "export * from '../../mindroom/messages/longText';"
    );
    expect(longTextTextCompatibilitySource.trim()).toBe(
      "export * from '../../mindroom/messages/MindroomLongTextText';"
    );
    expect(toolTraceCompatibilitySource.trim()).toBe(
      "export * from '../../mindroom/messages/toolTrace';"
    );
    expect(threadSummarySource).toContain('THREAD_SUMMARY_METADATA_KEY');
    expect(toolApprovalSource).toContain('MINDROOM_TOOL_APPROVAL_EVENT');
    expect(aiRunSource).toContain('AI_RUN_METADATA_KEY');
    expect(blocksSource).toContain('MINDROOM_TOOL_REF_HTML_REG_G');
    expect(longTextSource).toContain('LONG_TEXT_TAG');
    expect(longTextDownloadSource).toContain('getMindroomLongTextDownloadName');
    expect(toolTraceSource).toContain('getMindroomToolTraceEvents');
    expect(htmlBlocksSource).toContain('renderMindroomHtmlBlock');
    expect(htmlBlocksSource).toContain('withMindroomToolTraceMarkerParserOptions');
    expect(htmlBlocksSource).toContain('parseMindroomToolRefHtml');
    expect(htmlBlocksSource).toContain('getMindroomToolTraceEvents');
    expect(htmlBlocksStyleSource).toContain('ToolGroupItem');
    expect(threadSummaryCardSource).toContain('MindroomThreadSummaryCard');
    expect(messageControlsSource).toContain('useMindroomMessageControls');
    expect(messageControlsSource).toContain('MindroomAiRunControls');
    expect(messageControlsSource).toContain('MindroomDownloadOriginalMenuItem');
    expect(messageControlsSource).toContain('downloadMindroomLongTextSidecarBlob');
    expect(threadBadgeSource).toContain("from '../messages/MindroomThreadSummaryCard'");
    expect(threadBadgeSource).not.toContain('MindroomThreadSummaryCard, ThreadIndicator');
    expect(metadataSource).toContain('isMindroomMessageMetadataKey');
  });

  it('keeps Local MindRoom settings implementation in the MindRoom namespace', () => {
    const settingsSource = readFileSync(
      new URL('../settings/Settings.tsx', import.meta.url),
      'utf8'
    );
    const pageCompatibilitySource = readFileSync(
      new URL('../settings/local-mindroom/LocalMindroom.tsx', import.meta.url),
      'utf8'
    );
    const apiCompatibilitySource = readFileSync(
      new URL('../settings/local-mindroom/api.ts', import.meta.url),
      'utf8'
    );
    const helperCompatibilitySource = readFileSync(
      new URL('../settings/local-mindroom/mindroom.ts', import.meta.url),
      'utf8'
    );
    const pageSource = readFileSync(
      new URL('../../mindroom/local-mindroom/LocalMindroom.tsx', import.meta.url),
      'utf8'
    );
    const apiSource = readFileSync(
      new URL('../../mindroom/local-mindroom/api.ts', import.meta.url),
      'utf8'
    );
    const helperSource = readFileSync(
      new URL('../../mindroom/local-mindroom/mindroom.ts', import.meta.url),
      'utf8'
    );

    expect(settingsSource).toContain("import { LocalMindroom } from './local-mindroom'");
    expect(pageCompatibilitySource.trim()).toBe(
      "export { LocalMindroom } from '../../../mindroom/local-mindroom/LocalMindroom';"
    );
    expect(apiCompatibilitySource.trim()).toBe(
      "export * from '../../../mindroom/local-mindroom/api';"
    );
    expect(helperCompatibilitySource.trim()).toBe(
      "export * from '../../../mindroom/local-mindroom/mindroom';"
    );
    expect(pageSource).toContain('Connect Local MindRoom');
    expect(pageSource).toContain('resolveMindroomProvisioningRequest');
    expect(apiSource).toContain('LOCAL_MINDROOM_API_PATH');
    expect(helperSource).toContain('getMindroomPairingCommand');
  });

  it('keeps the Local MindRoom sidebar shortcut in the MindRoom namespace', () => {
    const compatibilitySource = readFileSync(
      new URL('../../pages/client/sidebar/MindroomTab.tsx', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/sidebar/MindroomTab.tsx', import.meta.url),
      'utf8'
    );

    expect(compatibilitySource.trim()).toBe(
      "export { MindroomTab } from '../../../mindroom/sidebar/MindroomTab';"
    );
    expect(implementationSource).toContain('Local MindRoom');
    expect(implementationSource).toContain('SettingsPages.LocalMindroomPage');
  });

  it('keeps the Recent Threads feature in the MindRoom namespace', () => {
    const panelCompatibilitySource = readFileSync(
      new URL('../recent-threads/RecentThreadsPanel.tsx', import.meta.url),
      'utf8'
    );
    const entryCompatibilitySource = readFileSync(
      new URL('../recent-threads/RecentThreadEntry.tsx', import.meta.url),
      'utf8'
    );
    const summaryCompatibilitySource = readFileSync(
      new URL('../recent-threads/recentThreadSummaryUtils.ts', import.meta.url),
      'utf8'
    );
    const panelSource = readFileSync(
      new URL('../../mindroom/recent-threads/RecentThreadsPanel.tsx', import.meta.url),
      'utf8'
    );
    const summarySource = readFileSync(
      new URL('../../mindroom/recent-threads/recentThreadSummaryUtils.ts', import.meta.url),
      'utf8'
    );
    const threadRecordSource = readFileSync(
      new URL('../../mindroom/threads/threadRecord.ts', import.meta.url),
      'utf8'
    );
    const stateCompatibilitySource = readFileSync(
      new URL('../../state/recentThreads.ts', import.meta.url),
      'utf8'
    );
    const stateSource = readFileSync(
      new URL('../../mindroom/recent-threads/recentThreads.ts', import.meta.url),
      'utf8'
    );

    expect(panelCompatibilitySource.trim()).toBe(
      "export { RecentThreadsPageNav, RecentThreadsPanel } from '../../mindroom/recent-threads/RecentThreadsPanel';"
    );
    expect(entryCompatibilitySource.trim()).toBe(
      "export { RecentThreadEntry } from '../../mindroom/recent-threads/RecentThreadEntry';"
    );
    expect(summaryCompatibilitySource.trim()).toBe(
      "export * from '../../mindroom/recent-threads/recentThreadSummaryUtils';"
    );
    expect(panelSource).toContain('Recent Threads');
    expect(summarySource).toContain('resolveRecentThreadSummaryText');
    expect(threadRecordSource).toContain("from '../recent-threads/recentThreadSummaryUtils'");
    expect(stateCompatibilitySource.trim()).toBe(
      "export * from '../mindroom/recent-threads/recentThreads';"
    );
    expect(stateSource).toContain('makeRecentThreadsAtom');
  });

  it('keeps native app integration helpers in the MindRoom namespace', () => {
    const nativeSsoCompatibilitySource = readFileSync(
      new URL('../../utils/nativeSso.ts', import.meta.url),
      'utf8'
    );
    const iosPushCompatibilitySource = readFileSync(
      new URL('../../utils/iosPush.ts', import.meta.url),
      'utf8'
    );
    const edgeSwipeCompatibilitySource = readFileSync(
      new URL('../../hooks/useEdgeSwipeBack.ts', import.meta.url),
      'utf8'
    );
    const iosPushHookCompatibilitySource = readFileSync(
      new URL('../../hooks/useIOSPushEnabled.ts', import.meta.url),
      'utf8'
    );
    const nativeSsoSource = readFileSync(
      new URL('../../mindroom/native/nativeSso.ts', import.meta.url),
      'utf8'
    );
    const iosPushSource = readFileSync(
      new URL('../../mindroom/native/iosPush.ts', import.meta.url),
      'utf8'
    );

    expect(nativeSsoCompatibilitySource.trim()).toBe(
      "export * from '../mindroom/native/nativeSso';"
    );
    expect(iosPushCompatibilitySource.trim()).toBe("export * from '../mindroom/native/iosPush';");
    expect(edgeSwipeCompatibilitySource.trim()).toBe(
      "export { useEdgeSwipeBack } from '../mindroom/native/useEdgeSwipeBack';"
    );
    expect(iosPushHookCompatibilitySource.trim()).toBe(
      "export { useIOSPushEnabled } from '../mindroom/native/useIOSPushEnabled';"
    );
    expect(nativeSsoSource).toContain('buildNativeSsoRedirectUrl');
    expect(iosPushSource).toContain('resolveIOSPushConfig');
  });

  it('keeps MindRoom branding and hosted-auth policy in the MindRoom namespace', () => {
    const brandingSource = readFileSync(
      new URL('../../mindroom/branding/branding.ts', import.meta.url),
      'utf8'
    );
    const authPolicySource = readFileSync(
      new URL('../../mindroom/auth/authPolicy.ts', import.meta.url),
      'utf8'
    );
    const authLayoutSource = readFileSync(
      new URL('../../pages/auth/AuthLayout.tsx', import.meta.url),
      'utf8'
    );
    const loginSource = readFileSync(
      new URL('../../pages/auth/login/Login.tsx', import.meta.url),
      'utf8'
    );
    const registerSource = readFileSync(
      new URL('../../pages/auth/register/Register.tsx', import.meta.url),
      'utf8'
    );

    expect(brandingSource).toContain('MINDROOM_DEVICE_DISPLAY_NAME');
    expect(brandingSource).toContain('MINDROOM_CINNY_SOURCE_URL');
    expect(authPolicySource).toContain('MINDROOM_HOMESERVER');
    expect(authLayoutSource).toContain("from '../../mindroom/branding/branding'");
    expect(loginSource).toContain("from '../../../mindroom/auth/authPolicy'");
    expect(registerSource).toContain("from '../../../mindroom/auth/authPolicy'");
    expect(loginSource).not.toContain("=== 'mindroom.chat'");
    expect(registerSource).not.toContain("=== 'mindroom.chat'");
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
    const targetSource = readFileSync(
      new URL('../../mindroom/threads/threadOverviewRefreshTargets.ts', import.meta.url),
      'utf8'
    );
    const controllerSource = readFileSync(
      new URL('../../mindroom/threads/threadOverviewResumeController.ts', import.meta.url),
      'utf8'
    );
    const counterSource = readFileSync(
      new URL('../../mindroom/threads/threadOverviewRefreshCounter.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useThreadOverviewResumeController');
    expect(source).toContain("from '../../mindroom/threads/threadOverviewResumeController'");
    expect(source).not.toContain("from '../../mindroom/threads/threadOverviewRefreshTargets'");
    expect(source).toContain("from '../../mindroom/threads/threadOverviewRefreshCounter'");
    expect(source).not.toContain('isVisibleThreadRootEvent');
    expect(source).not.toContain('ThreadEvent.NewReply');
    expect(targetSource).toContain('resolveThreadOverviewRefreshTargets');
    expect(targetSource).toContain('isVisibleThreadRootEvent');
    expect(controllerSource).toContain('resolveThreadOverviewRefreshTargets');
    expect(counterSource).toContain('useThreadOverviewRefreshCounter');
    expect(counterSource).toContain('ThreadEvent.NewReply');
    expect(source).not.toContain('overviewResumeRefreshInFlightRef');
    expect(source).not.toContain('pendingOverviewResumeRefreshRef');
    expect(source).not.toContain('refreshOverviewThreadCacheFromRelations');
  });

  it('delegates thread sort-freeze resnapshot policy to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const controllerSource = readFileSync(
      new URL('../../mindroom/threads/threadSortFreezeController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/threadSortFreezeController'");
    expect(source).not.toContain('orderedRootIds: activeLiveOverviewThreadRootIds');
    expect(controllerSource).toContain('useThreadSortFreezeController');
    expect(controllerSource).toContain('resolveThreadSortFreezeUpdate');
  });

  it('keeps room thread-list loading in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const listCompatibilitySource = readFileSync(
      new URL('./roomThreadList.ts', import.meta.url),
      'utf8'
    );
    const hookCompatibilitySource = readFileSync(
      new URL('./useRoomThreadList.ts', import.meta.url),
      'utf8'
    );
    const listSource = readFileSync(
      new URL('../../mindroom/threads/roomThreadList.ts', import.meta.url),
      'utf8'
    );
    const hookSource = readFileSync(
      new URL('../../mindroom/threads/useRoomThreadList.ts', import.meta.url),
      'utf8'
    );
    const indexSource = readFileSync(
      new URL('../../mindroom/threads/useMindroomThreadIndex.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain("from '../../mindroom/threads/useRoomThreadList'");
    expect(listCompatibilitySource).toContain("from '../../mindroom/threads/roomThreadList'");
    expect(hookCompatibilitySource).toContain("from '../../mindroom/threads/useRoomThreadList'");
    expect(listSource).toContain('loadRoomThreads');
    expect(listSource).toContain('getThreadUnread');
    expect(hookSource).toContain('useRoomThreadList');
    expect(indexSource).toContain("from './useRoomThreadList'");
    expect(listCompatibilitySource).not.toContain('fetchRoomThreads');
    expect(hookCompatibilitySource).not.toContain('ThreadEvent.NewReply');
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

  it('keeps live collapsible-message policy in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/threadCollapsibleMessages.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/threadCollapsibleMessages'");
    expect(implementationSource).toContain('shouldTrackLiveCollapsibleMessage');
    expect(implementationSource).toContain('getLiveCollapsibleMessageExpandId');
    expect(source).not.toContain('export const shouldTrackLiveCollapsibleMessage');
    expect(source).not.toContain('export const getCollapsibleMessageMode');
  });

  it('delegates thread prepend scroll primitives to scroll utilities', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const compatibilitySource = readFileSync(
      new URL('./timelineScrollUtils.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/timelineScrollUtils.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/timelineScrollUtils'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/timelineScrollUtils'");
    expect(implementationSource).toContain('captureThreadPrependScrollAnchor');
    expect(implementationSource).toContain('getTimelineTargetAnchor');
    expect(implementationSource).toContain('shouldRenderUnreadDividerAt');
    expect(implementationSource).toContain('getRoomFocusScrollOptions');
    expect(implementationSource).toContain('setupFocusObserver');
    expect(source).not.toContain('export const captureThreadPrependScrollAnchor');
    expect(source).not.toContain('export const restoreThreadPrependScrollAnchor');
    expect(source).not.toContain('export const getTimelineTargetAnchor');
    expect(source).not.toContain('export const shouldRenderUnreadDividerAt');
    expect(source).not.toContain('export const getRoomFocusScrollOptions');
    expect(source).not.toContain('export const setupFocusObserver');
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

  it('keeps timeline debug helpers in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const compatibilitySource = readFileSync(
      new URL('./timelineDebug.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/timelineDebug.ts', import.meta.url),
      'utf8'
    );
    const controllerSource = readFileSync(
      new URL('../../mindroom/threads/timelineDebugController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/timelineDebugController'");
    expect(source).not.toContain("from '../../mindroom/threads/timelineDebug'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/timelineDebug'");
    expect(implementationSource).toContain('createTimelineDebugTrace');
    expect(implementationSource).toContain('mindroom.debug.timeline');
    expect(controllerSource).toContain('useTimelineDebugTraceIds');
    expect(controllerSource).toContain('useTimelineDebugRangeController');
    expect(controllerSource).toContain("'room-surface'");
    expect(controllerSource).toContain("'thread-range'");
    expect(source).not.toContain('createTimelineDebugTrace');
    expect(source).not.toContain("'room-surface'");
    expect(source).not.toContain("'thread-range'");
    expect(compatibilitySource).not.toContain('console.log');
  });

  it('keeps event cache token helpers in MindRoom threads', () => {
    const compatibilitySource = readFileSync(
      new URL('./eventCacheTokenUtils.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/eventCacheTokenUtils.ts', import.meta.url),
      'utf8'
    );

    expect(compatibilitySource).toContain("from '../../mindroom/threads/eventCacheTokenUtils'");
    expect(implementationSource).toContain('mergeCachedPaginationTokens');
    expect(implementationSource).toContain('compareCachedPaginationAnchors');
    expect(compatibilitySource).not.toContain('localeCompare');
  });

  it('keeps event cache edit helpers in MindRoom threads', () => {
    const compatibilitySource = readFileSync(
      new URL('./eventCacheEditUtils.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/eventCacheEditUtils.ts', import.meta.url),
      'utf8'
    );

    expect(compatibilitySource).toContain("from '../../mindroom/threads/eventCacheEditUtils'");
    expect(implementationSource).toContain('hydrateCachedEvents');
    expect(implementationSource).toContain('serializeEventsForCache');
    expect(implementationSource).toContain('reconcileRelationEventsWithAggregation');
    expect(compatibilitySource).not.toContain('makeRedacted');
  });

  it('keeps raw event cache stores in MindRoom threads', () => {
    const roomCompatibilitySource = readFileSync(
      new URL('./roomEventCache.ts', import.meta.url),
      'utf8'
    );
    const threadCompatibilitySource = readFileSync(
      new URL('./threadEventCache.ts', import.meta.url),
      'utf8'
    );
    const migrationCompatibilitySource = readFileSync(
      new URL('./cacheDbMigrationUtils.ts', import.meta.url),
      'utf8'
    );
    const roomStoreSource = readFileSync(
      new URL('../../mindroom/threads/roomEventCache.ts', import.meta.url),
      'utf8'
    );
    const threadStoreSource = readFileSync(
      new URL('../../mindroom/threads/threadEventCache.ts', import.meta.url),
      'utf8'
    );
    const repositorySource = readFileSync(
      new URL('../../mindroom/threads/eventRepository.ts', import.meta.url),
      'utf8'
    );

    expect(roomCompatibilitySource).toContain("from '../../mindroom/threads/roomEventCache'");
    expect(threadCompatibilitySource).toContain("from '../../mindroom/threads/threadEventCache'");
    expect(migrationCompatibilitySource).toContain(
      "from '../../mindroom/threads/cacheDbMigrationUtils'"
    );
    expect(roomStoreSource).toContain('mindroom-room-event-cache');
    expect(threadStoreSource).toContain('mindroom-thread-event-cache');
    expect(repositorySource).toContain("from './roomEventCache'");
    expect(repositorySource).toContain("from './threadEventCache'");
    expect(repositorySource).not.toContain('../../features/room/roomEventCache');
    expect(repositorySource).not.toContain('../../features/room/threadEventCache');
  });

  it('keeps thread pagination reconciliation helpers in MindRoom threads', () => {
    const compatibilitySource = readFileSync(
      new URL('./threadPaginationUtils.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/threadPaginationUtils.ts', import.meta.url),
      'utf8'
    );

    expect(compatibilitySource).toContain("from '../../mindroom/threads/threadPaginationUtils'");
    expect(implementationSource).toContain('computeReconciliationToken');
    expect(implementationSource).toContain('reconcileThreadBackwardPagination');
    expect(compatibilitySource).not.toContain('Direction.Backward');
  });

  it('keeps timeline pagination helpers in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const compatibilitySource = readFileSync(
      new URL('./timelinePagination.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/timelinePagination.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/timelinePagination'");
    expect(compatibilitySource).toContain("from '../../mindroom/threads/timelinePagination'");
    expect(implementationSource).toContain('recalibrateTimelinePagination');
    expect(implementationSource).toContain('getEventIdAbsoluteIndex');
    expect(implementationSource).toContain('getLinkedTimelines');
    expect(implementationSource).toContain('getActiveTimelineRange');
    expect(implementationSource).toContain('getRoomUnreadInfo');
    expect(source).not.toContain('export const getEventIdAbsoluteIndex');
    expect(source).not.toContain('export const getTimelineAndBaseIndex');
    expect(source).not.toContain('const getInitialTimeline');
    expect(source).not.toContain('export const getActiveTimelineRange');
    expect(compatibilitySource).not.toContain('getRenderableEvents');
  });

  it('delegates timeline pagination commands to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const controllerSource = readFileSync(
      new URL('../../mindroom/threads/timelinePaginationController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/timelinePaginationController'");
    expect(source).not.toContain('const useTimelinePagination');
    expect(source).not.toContain('const useEventTimelineLoader');
    expect(controllerSource).toContain('useTimelinePagination');
    expect(controllerSource).toContain('useEventTimelineLoader');
    expect(controllerSource).toContain('paginateEventTimeline');
  });

  it('delegates timeline read receipt and bottom-anchor ownership to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const controllerSource = readFileSync(
      new URL('../../mindroom/threads/timelineReadReceiptController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useTimelineReadReceiptController');
    expect(source).not.toContain('markRoomAndThreadsAsRead');
    expect(source).not.toContain('markMainTimelineAsRead');
    expect(controllerSource).toContain('markRoomAndThreadsAsRead');
    expect(controllerSource).toContain('useIntersectionObserver');
    expect(controllerSource).toContain('useDocumentFocusChange');
  });

  it('delegates route focus and thread-open scroll effects to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const controllerSource = readFileSync(
      new URL('../../mindroom/threads/roomFocusScrollController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useRoomFocusScrollController');
    expect(source).not.toContain('pendingRoomFocusRef');
    expect(source).not.toContain('setupFocusObserver');
    expect(source).not.toContain('getRoomFocusScrollOptions');
    expect(source).not.toContain('shouldPinThreadToBottomOnOpen');
    expect(controllerSource).toContain('setupFocusObserver');
    expect(controllerSource).toContain('shouldPinThreadToBottomOnOpen');
    expect(controllerSource).toContain('restorePendingThreadBackPaginationAnchor');
  });

  it('delegates room jump and thread-card navigation handlers to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const controllerSource = readFileSync(
      new URL('../../mindroom/threads/roomTimelineNavigationController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useRoomTimelineNavigationController');
    expect(source).not.toContain("from '../../state/recentThreads'");
    expect(source).not.toContain('bumpRecentThread');
    expect(source).not.toContain('refreshLatestThreadSlice(threadId)');
    expect(controllerSource).toContain('bumpRecentThread');
    expect(controllerSource).toContain('handleJumpToLatest');
    expect(controllerSource).toContain('handleOpenCompactThread');
  });

  it('delegates live event arrival policy to MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const subscriptionSource = readFileSync(
      new URL('../../mindroom/threads/roomLiveEventArrive.ts', import.meta.url),
      'utf8'
    );
    const controllerSource = readFileSync(
      new URL('../../mindroom/threads/roomLiveEventController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/roomLiveEventController'");
    expect(source).not.toContain('const useLiveEventArrive');
    expect(source).not.toContain('EventTimelineSetHandlerMap');
    expect(source).not.toContain('getLiveCollapsibleMessageExpandId');
    expect(source).not.toContain('room-thread-cache-persist-paginated');
    expect(controllerSource).toContain('useRoomLiveEventController');
    expect(controllerSource).toContain('useLiveEventArrive');
    expect(controllerSource).toContain('getLiveCollapsibleMessageExpandId');
    expect(controllerSource).toContain('room-thread-cache-persist-paginated');
    expect(subscriptionSource).toContain('useLiveEventArrive');
    expect(subscriptionSource).toContain('RoomEvent.Redaction');
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
    const lifecycleSource = readFileSync(
      new URL('../../mindroom/threads/threadOpenLifecycleController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/threadOpenLifecycleController'");
    expect(source).not.toContain("from '../../mindroom/threads/threadOpenSeedController'");
    expect(lifecycleSource).toContain("from './threadOpenSeedController'");
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
