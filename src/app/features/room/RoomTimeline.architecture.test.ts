import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('RoomTimeline architecture', () => {
  it('delegates thread badge JSX rendering to the MindRoom badge renderer', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(source).not.toContain('const renderThreadBadge');
    expect(source).toContain('MindroomRoomTimelineThreadBadgeRenderer');
  });

  it('delegates MindRoom timeline message policy to a fork-owned seam', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const timelineMessageSource = readFileSync(
      new URL('../../mindroom/threads/roomTimelineMessageExtensions.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/roomTimelineMessageExtensions'");
    expect(source).not.toContain("from '../../mindroom/messages/toolApproval'");
    expect(source).not.toContain("from '../../mindroom/threads/threadBadgeViewModel'");
    expect(source).not.toContain('getToolApprovalRenderContent');
    expect(source).not.toContain('buildThreadBadgeViewModelFromRecord');
    expect(timelineMessageSource).toContain("from '../messages/toolApproval'");
    expect(timelineMessageSource).toContain("from './threadBadgeViewModel'");
    expect(timelineMessageSource).toContain('getMindroomRoomTimelineApprovalContent');
    expect(timelineMessageSource).toContain('getMindroomRoomTimelineThreadBadgeModel');
  });

  it('keeps renderability and preload counting outside RoomTimeline', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/roomTimelineEvents.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('export const isRenderableEvent =');
    expect(source).not.toContain('export const getRoomPreloadCounts =');
    expect(source).toContain("from '../../mindroom/threads/roomTimelineEvents'");
    expect(implementationSource).toContain('buildRoomSurfaceEventEntries');
  });

  it('delegates eager room preload orchestration outside RoomTimeline', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const windowControllerSource = readFileSync(
      new URL('../../mindroom/threads/roomTimelineWindowController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useRoomEagerPreload');
    expect(source).toContain('useRoomTimelineWindowController');
    expect(source).not.toContain("from '../../mindroom/threads/roomPreloadTarget'");
    expect(windowControllerSource).toContain("from './roomPreloadTarget'");
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
    const windowControllerSource = readFileSync(
      new URL('../../mindroom/threads/roomTimelineWindowController.ts', import.meta.url),
      'utf8'
    );
    const eventOpenControllerSource = readFileSync(
      new URL('../../mindroom/threads/roomEventOpenController.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain("from '../../mindroom/threads/threadRoomFocus'");
    expect(windowControllerSource).toContain("from './threadRoomFocus'");
    expect(eventOpenControllerSource).toContain("from './threadRoomFocus'");
    expect(source).not.toContain('const getFilteredRoomOverviewEvents');
    expect(source).not.toContain('export const getRoomEventFocusTarget =');
    expect(source).not.toContain('export { getRoomEventFocusTarget');
    expect(source).not.toContain('export const getThreadFilteredEvents =');
    expect(source).not.toContain('export { getThreadFilteredEvents');
    expect(source).not.toContain('buildThreadRecordMap({');
  });

  it('keeps thread route deep-link resolution in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/roomDeepLink.ts', import.meta.url),
      'utf8'
    );
    const indexSource = readFileSync(
      new URL('../../mindroom/threads/useMindroomThreadIndex.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain("from '../../mindroom/threads/roomDeepLink'");
    expect(implementationSource).toContain('resolveRoomEventThreadRedirect');
    expect(implementationSource).toContain('getRoomEventThreadOpenTarget');
    expect(indexSource).toContain("from './roomDeepLink'");
    expect(indexSource).not.toContain('../../features/room/roomDeepLink');
    expect(source).not.toContain('export { getRoomEventThreadOpenTarget');
  });

  it('keeps last-open-thread state in MindRoom threads', () => {
    const clientStorageSource = readFileSync(
      new URL('../../pages/client/ClientInitStorageAtom.tsx', import.meta.url),
      'utf8'
    );
    const clientStorageImplementationSource = readFileSync(
      new URL('../../mindroom/cache/clientStorageAtoms.ts', import.meta.url),
      'utf8'
    );
    const roomSource = readFileSync(new URL('./Room.tsx', import.meta.url), 'utf8');
    const roomRouteRestoreSource = readFileSync(
      new URL('../../mindroom/threads/useRoomThreadRouteRestore.ts', import.meta.url),
      'utf8'
    );
    const clientLayoutSource = readFileSync(
      new URL('../../pages/client/ClientLayout.tsx', import.meta.url),
      'utf8'
    );
    const routeRestoreSource = readFileSync(
      new URL('../../mindroom/routing/clientRouteRestore.ts', import.meta.url),
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

    expect(clientStorageSource).toContain("from '../../mindroom/cache/clientStorageAtoms'");
    expect(clientStorageSource).not.toContain("from '../../mindroom/threads/lastOpenThread'");
    expect(clientStorageSource).not.toContain("from '../../mindroom/recent-threads/recentThreads'");
    expect(clientStorageImplementationSource).toContain('registerLastOpenThreadAtom');
    expect(clientStorageImplementationSource).toContain('registerRecentThreadsAtom');
    expect(roomSource).not.toContain("from '../../mindroom/threads/lastOpenThread'");
    expect(roomSource).not.toContain("from '../../mindroom/recent-threads/recentThreads'");
    expect(roomSource).toContain("from '../../mindroom/threads/useRoomThreadRouteRestore'");
    expect(roomRouteRestoreSource).toContain("from './lastOpenThread'");
    expect(roomRouteRestoreSource).toContain('removeRecentThread');
    expect(clientLayoutSource).not.toContain("from '../../mindroom/threads/lastOpenThread'");
    expect(clientLayoutSource).toContain('getLastOpenThreadRestoreTarget');
    expect(routeRestoreSource).toContain("from '../threads/lastOpenThread'");
    expect(routeRestoreSource).toContain('getLastOpenThreadRestoreTarget');
    expect(sessionCleanupSource).toContain("from '../threads/lastOpenThread'");
    expect(initMatrixSource).not.toContain("from '../app/state/lastOpenThread'");
  });

  it('does not keep unused top-level MindRoom compatibility wrappers', () => {
    const removedCompatibilityPaths = [
      '../../hooks/useIOSPushEnabled.ts',
      '../../hooks/useEdgeSwipeBack.ts',
      '../../hooks/useRoomEvent.ts',
      '../../hooks/useThreadScheduledTasks.ts',
      '../../hooks/useThreadStreamingState.ts',
      '../../components/message/ThreadIndicator.ts',
      '../../state/lastOpenThread.ts',
      '../../state/recentThreads.ts',
      '../../state/recentThreadsPanelHeight.ts',
      '../../state/recentThreadsPanelMobileExpanded.ts',
      '../../state/room/roomViewMode.ts',
      '../../utils/notifications.ts',
      '../../utils/iosPush.ts',
      '../../utils/nativeSso.ts',
    ];

    removedCompatibilityPaths.forEach((path) => {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    });
  });

  it('keeps room input auto-thread send sessions in MindRoom threads', () => {
    const removedRoomInputCompatibilityPaths = [
      './MindroomCommandAutocomplete.tsx',
      './VoiceRecorderDialog.tsx',
      './bridgeDetection.ts',
      './composeMessageRelation.ts',
      './mindroomCommandQuery.ts',
      './mindroomCommands.ts',
      './roomInputSendSession.ts',
      './voiceRecorderMime.ts',
    ];
    const source = readFileSync(new URL('./RoomInput.tsx', import.meta.url), 'utf8');
    const roomInputExtensionsSource = readFileSync(
      new URL('../../mindroom/room-input/RoomInputMindroomExtensions.tsx', import.meta.url),
      'utf8'
    );
    const controllerSource = readFileSync(
      new URL('../../mindroom/threads/useRoomInputSendSessionController.ts', import.meta.url),
      'utf8'
    );
    const sessionSource = readFileSync(
      new URL('../../mindroom/threads/roomInputSendSession.ts', import.meta.url),
      'utf8'
    );

    removedRoomInputCompatibilityPaths.forEach((path) => {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    });
    expect(source).toContain('useRoomInputSendSessionController');
    expect(source).toContain("from '../../mindroom/room-input/RoomInputMindroomExtensions'");
    expect(source).not.toContain("from '../../mindroom/threads/useRoomInputSendSessionController'");
    expect(source).not.toContain("from '../../mindroom/commands/");
    expect(source).not.toContain("from '../../mindroom/voice/");
    expect(source).not.toContain("from '../../mindroom/threads/composeMessageRelation'");
    expect(source).not.toContain('createRoomInputSendSessionState');
    expect(source).not.toContain('resolveRoomInputSendStep');
    expect(source).not.toContain('hasRoomInputSendFailures');
    expect(source).not.toContain('isSignalBridgeRoom');
    expect(roomInputExtensionsSource).toContain("from '../threads/composeMessageRelation'");
    expect(roomInputExtensionsSource).toContain("from '../commands/mindroomCommandQuery'");
    expect(roomInputExtensionsSource).toContain("from '../commands/MindroomCommandAutocomplete'");
    expect(roomInputExtensionsSource).toContain("from '../voice/VoiceRecorderDialog'");
    expect(roomInputExtensionsSource).toContain(
      "from '../threads/useRoomInputSendSessionController'"
    );
    expect(controllerSource).toContain('createRoomInputSendSessionState');
    expect(controllerSource).toContain('resolveRoomInputSendStep');
    expect(controllerSource).toContain('isSignalBridgeRoom');
    expect(sessionSource).toContain('getRoomInputSendMode');
  });

  it('does not keep stale low-level thread compatibility wrappers', () => {
    const removedThreadCompatibilityPaths = [
      './cacheDbMigrationUtils.ts',
      './CompactRoomView.css.ts',
      './CompactRoomView.tsx',
      './CompactThreadCard.tsx',
      './compactThreadRootData.ts',
      './compactThreadCardUtils.ts',
      './eventCacheEditUtils.ts',
      './eventCacheTokenUtils.ts',
      './RoomThreadOverview.css.ts',
      './RoomThreadOverview.tsx',
      './roomEventCache.ts',
      './roomDeepLink.ts',
      './roomPreloadTarget.ts',
      './roomThreadList.ts',
      './roomThreadOverviewModel.ts',
      './roomTimelineEvents.ts',
      './threadEventCache.ts',
      './threadEditBackfillUtils.ts',
      './threadFilterDsl.ts',
      './threadPaginationUtils.ts',
      './threadPresentation.ts',
      './threadRenderUtils.ts',
      './threadSummaryCache.ts',
      './threadSummarySelection.ts',
      './threadSummaryState.ts',
      './threadRouteUtils.ts',
      './threadTagColor.ts',
      './threadTagPending.ts',
      './threadTags.ts',
      './threadUtils.ts',
      './ThreadContextBanner.css.ts',
      './ThreadContextBanner.tsx',
      './ThreadTagPicker.tsx',
      './ThreadTagPill.tsx',
      './timelineDebug.ts',
      './timelinePagination.ts',
      './timelineScrollUtils.ts',
      './useMutateThreadTags.ts',
      './useRoomThreadList.ts',
      './useRoomThreadSummaryState.ts',
      './useRoomThreadTags.ts',
      './useThreadRenderState.ts',
      './useThreadRootEvent.ts',
      './useThreadTags.ts',
    ];

    removedThreadCompatibilityPaths.forEach((path) => {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    });
  });

  it('keeps thread navigation seeding policy in MindRoom threads', () => {
    const hookSource = readFileSync(
      new URL('../../hooks/useRoomNavigate.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/threadNavigation.ts', import.meta.url),
      'utf8'
    );

    expect(hookSource).toContain("from '../mindroom/threads/threadNavigation'");
    expect(hookSource).not.toContain("from '../mindroom/native/nativeSso'");
    expect(hookSource).not.toContain("from '../mindroom/threads/roomNavigateState'");
    expect(implementationSource).toContain('navigateMindroomRoomThread');
    expect(implementationSource).toContain('withRoomThreadExitTargetState');
    expect(implementationSource).toContain('isNativeIOS');
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
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/compactThreadRootData.ts', import.meta.url),
      'utf8'
    );
    const indexSource = readFileSync(
      new URL('../../mindroom/threads/useMindroomThreadIndex.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain("from '../../mindroom/threads/compactThreadRootData'");
    expect(implementationSource).toContain('buildCompactThreadRootData');
    expect(implementationSource).toContain('isZeroReplyStandaloneThreadRootEvent');
    expect(indexSource).toContain("from './compactThreadRootData'");
  });

  it('keeps thread presentation derivation in MindRoom threads', () => {
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/threadPresentation.ts', import.meta.url),
      'utf8'
    );

    expect(implementationSource).toContain('resolveThreadPresentationSnapshot');
    expect(implementationSource).toContain('getLatestThreadSummaryInfoFromEventSources');
  });

  it('keeps thread filter DSL parsing in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/threadFilterDsl.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/threadFilterDsl'");
    expect(implementationSource).toContain('parseThreadFilterQuery');
    expect(implementationSource).toContain('serializeThreadFilterQuery');
  });

  it('keeps compact room view components in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/CompactRoomView.tsx', import.meta.url),
      'utf8'
    );
    const cardImplementationSource = readFileSync(
      new URL('../../mindroom/threads/CompactThreadCard.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/CompactRoomView'");
    expect(implementationSource).toContain('useCompactThreadCardViewModels');
    expect(cardImplementationSource).toContain('CompactThreadCardViewModel');
  });

  it('keeps compact thread scheduled-label utilities in MindRoom threads', () => {
    const hookCompatibilityPath = new URL('../../hooks/useThreadHeaderInfo.ts', import.meta.url);
    const hookImplementationSource = readFileSync(
      new URL('../../mindroom/threads/useThreadHeaderInfo.ts', import.meta.url),
      'utf8'
    );
    const viewModelSource = readFileSync(
      new URL('../../mindroom/threads/compactThreadCardViewModel.ts', import.meta.url),
      'utf8'
    );
    const scheduledTaskCompatibilityPath = new URL(
      '../../utils/scheduledTaskContract.ts',
      import.meta.url
    );
    const scheduledTaskImplementationSource = readFileSync(
      new URL('../../mindroom/threads/scheduledTaskContract.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/compactThreadCardUtils.ts', import.meta.url),
      'utf8'
    );

    expect(existsSync(hookCompatibilityPath)).toBe(false);
    expect(hookImplementationSource).toContain("from './compactThreadCardUtils'");
    expect(hookImplementationSource).toContain("from './scheduledTaskContract'");
    expect(viewModelSource).toContain("from './compactThreadCardUtils'");
    expect(existsSync(scheduledTaskCompatibilityPath)).toBe(false);
    expect(scheduledTaskImplementationSource).toContain('parseScheduledTaskStateEvent');
    expect(implementationSource).toContain('formatScheduledTime');
    expect(implementationSource).toContain('getScheduledTimeUpdateInterval');
    expect(scheduledTaskImplementationSource).not.toContain('StateEvent.MindRoomScheduledTask');
  });

  it('keeps thread activity timestamp derivation in MindRoom threads', () => {
    const hookCompatibilityPath = new URL(
      '../../hooks/useThreadLastActivityTs.ts',
      import.meta.url
    );
    const hookImplementationSource = readFileSync(
      new URL('../../mindroom/threads/useThreadLastActivityTs.ts', import.meta.url),
      'utf8'
    );
    const threadIndicatorSource = readFileSync(
      new URL('../../mindroom/threads/ThreadIndicator.tsx', import.meta.url),
      'utf8'
    );

    expect(existsSync(hookCompatibilityPath)).toBe(false);
    expect(hookImplementationSource).toContain('getThreadLastActivityTs');
    expect(hookImplementationSource).toContain("from './threadUtils'");
    expect(threadIndicatorSource).toContain("from './useThreadLastActivityTs'");
    expect(hookImplementationSource).not.toContain("from '../mindroom/threads");
  });

  it('keeps thread indicator rendering in MindRoom threads', () => {
    const replySource = readFileSync(
      new URL('../../components/message/Reply.tsx', import.meta.url),
      'utf8'
    );
    const replyStyleSource = readFileSync(
      new URL('../../components/message/Reply.css.ts', import.meta.url),
      'utf8'
    );
    const indexSource = readFileSync(
      new URL('../../components/message/index.ts', import.meta.url),
      'utf8'
    );
    const threadIndicatorSource = readFileSync(
      new URL('../../mindroom/threads/ThreadIndicator.tsx', import.meta.url),
      'utf8'
    );
    const threadIndicatorViewModelSource = readFileSync(
      new URL('../../mindroom/threads/threadIndicatorViewModel.ts', import.meta.url),
      'utf8'
    );
    const threadIndicatorStyleSource = readFileSync(
      new URL('../../mindroom/threads/ThreadIndicator.css.ts', import.meta.url),
      'utf8'
    );

    expect(replySource).toContain("from '../../mindroom/threads/ThreadIndicator'");
    expect(replySource).toContain("from '../../mindroom/threads/useRoomEvent'");
    expect(replySource).not.toContain('useThreadResolution');
    expect(replySource).not.toContain('useThreadScheduledTasks');
    expect(replySource).not.toContain('getThreadUnread');
    expect(replyStyleSource).not.toContain('ThreadStreamingPulse');
    expect(indexSource).not.toContain('ThreadIndicator');
    expect(threadIndicatorSource).toContain("from './threadIndicatorViewModel'");
    expect(threadIndicatorViewModelSource).toContain('getThreadRootReplyCount');
    expect(threadIndicatorSource).toContain("from './useRoomThreadTags'");
    expect(threadIndicatorSource).toContain("from './useThreadScheduledTasks'");
    expect(threadIndicatorStyleSource).toContain('ThreadStreamingPulse');
  });

  it('keeps command-palette thread sourcing in MindRoom threads', () => {
    const paletteSource = readFileSync(
      new URL('../command-palette/commandPaletteItems.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/commandPaletteThreadItems.ts', import.meta.url),
      'utf8'
    );

    expect(paletteSource).toContain(
      "from '../../mindroom/threads/commandPaletteThreadItems'"
    );
    expect(paletteSource).not.toContain('MINDROOM_THREAD_TAGS_EVENT');
    expect(paletteSource).not.toContain('aggregateThreadTagEvents');
    expect(paletteSource).not.toContain('buildThreadRecord');
    expect(paletteSource).not.toContain('makeRecentThreadsAtom');
    expect(paletteSource).not.toContain('buildPerTagEventContent');
    expect(paletteSource).not.toContain('resolveCanonicalThreadRootId');
    expect(implementationSource).toContain('useMindroomCommandPaletteThreadItems');
    expect(implementationSource).toContain('MINDROOM_THREAD_TAGS_EVENT');
    expect(implementationSource).toContain('makeRecentThreadsAtom');
    expect(implementationSource).toContain('buildThreadRecord');
    expect(implementationSource).toContain('resolveCanonicalThreadRootId');
    expect(implementationSource).toContain('mergeCommandPaletteThreadItems');
  });

  it('keeps cache-aware room event loading in MindRoom threads', () => {
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

    expect(hookImplementationSource).toContain('loadCachedThreadEvent');
    expect(hookImplementationSource).toContain("from './eventRepository'");
    expect(replySource).toContain("from '../../mindroom/threads/useRoomEvent'");
    expect(pinMenuSource).toContain("from '../../../mindroom/threads/useRoomEvent'");
  });

  it('keeps room thread overview controls in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/RoomThreadOverview.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/RoomThreadOverview'");
    expect(implementationSource).toContain('RoomThreadOverviewProps');
    expect(implementationSource).toContain('FILTER_PRESETS');
  });

  it('keeps room thread overview model in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/roomThreadOverviewModel.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/roomThreadOverviewModel'");
    expect(implementationSource).toContain('createDefaultThreadFilterState');
    expect(implementationSource).toContain('buildThreadMetadataMap');
  });

  it('keeps thread relation and route utilities in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
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
    expect(utilitySource).toContain('getPreferredVisibleThreadReplyEvents');
    expect(routeSource).toContain('resolveCanonicalThreadRootId');
  });

  it('keeps thread render identity utilities in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/threadRenderUtils.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/threadRenderUtils'");
    expect(implementationSource).toContain('mergeThreadRenderEvents');
    expect(implementationSource).toContain('buildResolveConfirmedEventId');
    expect(implementationSource).toContain('isThreadOnlyRoomActivity');
  });

  it('keeps thread render state merging in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/useThreadRenderState.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/useThreadRenderState'");
    expect(implementationSource).toContain('setSupplementalThreadEvents');
    expect(implementationSource).toContain('mergeThreadRenderEvents');
  });

  it('keeps thread tag state and hooks in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const tagsSource = readFileSync(
      new URL('../../mindroom/threads/threadTags.ts', import.meta.url),
      'utf8'
    );
    const hookSource = readFileSync(
      new URL('../../mindroom/threads/useRoomThreadTags.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/useRoomThreadTags'");
    expect(tagsSource).toContain('aggregateThreadTagEvents');
    expect(hookSource).toContain('useRoomThreadResolutionMap');
  });

  it('keeps thread banner and tag UI in MindRoom threads', () => {
    const roomViewSource = readFileSync(new URL('./RoomView.tsx', import.meta.url), 'utf8');
    const bannerSource = readFileSync(
      new URL('../../mindroom/threads/ThreadContextBanner.tsx', import.meta.url),
      'utf8'
    );
    const pickerSource = readFileSync(
      new URL('../../mindroom/threads/ThreadTagPicker.tsx', import.meta.url),
      'utf8'
    );

    expect(roomViewSource).toContain("from '../../mindroom/threads/ThreadContextBanner'");
    expect(bannerSource).toContain('buildThreadHeaderViewModelFromRecord');
    expect(pickerSource).toContain('normalizeTagName');
  });

  it('keeps room-view thread state orchestration in MindRoom threads', () => {
    const roomViewSource = readFileSync(new URL('./RoomView.tsx', import.meta.url), 'utf8');
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/useRoomViewThreadState.ts', import.meta.url),
      'utf8'
    );

    expect(roomViewSource).toContain("from '../../mindroom/threads/useRoomViewThreadState'");
    expect(roomViewSource).not.toContain('roomThreadFilterAtomFamily');
    expect(roomViewSource).not.toContain('roomViewModeAtomFamily');
    expect(roomViewSource).not.toContain('bumpRecentThread');
    expect(roomViewSource).not.toContain('resolveRecentThreadSummaryText');
    expect(roomViewSource).not.toContain('getRoomThreadExitTargetFromHistoryState');
    expect(implementationSource).toContain('roomThreadFilterAtomFamily');
    expect(implementationSource).toContain('roomViewModeAtomFamily');
    expect(implementationSource).toContain('bumpRecentThread');
    expect(implementationSource).toContain('resolveRecentThreadSummaryText');
    expect(implementationSource).toContain('getRoomThreadExitTargetFromHistoryState');
  });

  it('keeps thread summary cache and state in MindRoom threads', () => {
    const roomViewSource = readFileSync(new URL('./RoomView.tsx', import.meta.url), 'utf8');
    const roomViewThreadStateSource = readFileSync(
      new URL('../../mindroom/threads/useRoomViewThreadState.ts', import.meta.url),
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
    const storeSource = readFileSync(
      new URL('../../mindroom/threads/threadSummaryStore.ts', import.meta.url),
      'utf8'
    );
    const publishControllerSource = readFileSync(
      new URL('../../mindroom/threads/threadSummaryPublishController.ts', import.meta.url),
      'utf8'
    );
    const timelineSource = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');

    expect(roomViewSource).toContain("from '../../mindroom/threads/useRoomViewThreadState'");
    expect(roomViewSource).not.toContain("from '../../mindroom/threads/useRoomThreadSummaryState'");
    expect(roomViewThreadStateSource).toContain("from './threadSummaryStore'");
    expect(timelineSource).toContain("from '../../mindroom/threads/threadSummaryPublishController'");
    expect(timelineSource).not.toContain('threadSummaryInfoMap.forEach');
    expect(storeSource).toContain("from './threadSummaryCache'");
    expect(storeSource).toContain("from './threadSummaryState'");
    expect(storeSource).toContain("from './useRoomThreadSummaryState'");
    expect(cacheSource).toContain('loadCachedThreadSummaries');
    expect(stateSource).toContain('storeThreadSummaryInState');
    expect(publishControllerSource).toContain('useThreadSummaryPublishController');
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
    const removedMessageCompatibilityPaths = [
      '../../components/message/mindroomThreadSummary.ts',
      '../../components/message/mindroomToolApproval.ts',
      '../../components/message/MindroomToolApprovalCard.tsx',
      '../../components/message/MindroomToolApprovalCard.css.ts',
      '../../components/message/mindroomAiRun.ts',
      '../../components/message/mindroomAiRunDisplay.ts',
      '../../components/message/mindroomBlocks.ts',
      '../../components/message/mindroomLongText.ts',
      '../../components/message/MindroomLongTextText.tsx',
      '../../components/message/mindroomThreadSummaryCard.css.ts',
      '../../components/message/mindroomToolTrace.ts',
    ];
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
    const searchResultPolicySource = readFileSync(
      new URL('../../mindroom/messages/searchResultPolicy.ts', import.meta.url),
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
    const editMetadataSource = readFileSync(
      new URL('../../mindroom/messages/editMetadata.ts', import.meta.url),
      'utf8'
    );
    const editResolutionSource = readFileSync(
      new URL('../../mindroom/messages/editResolution.ts', import.meta.url),
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
    expect(searchResultPreviewSource).toContain(
      "from '../../mindroom/messages/searchResultPolicy'"
    );
    expect(searchResultPreviewSource).not.toContain("from '../../mindroom/messages/longText'");
    expect(searchResultPreviewSource).not.toContain("content?.['io.mindroom.long_text']");
    expect(roomUtilsSource).toContain("from '../mindroom/messages/editResolution'");
    expect(roomUtilsSource).not.toContain("from '../mindroom/messages/editMetadata'");
    expect(roomUtilsSource).not.toContain("from '../mindroom/messages/editDebug'");
    expect(roomUtilsSource).not.toContain("from '../mindroom/messages/metadata'");
    expect(roomUtilsSource).not.toContain("key.startsWith('io.mindroom.')");
    expect(roomUtilsSource).not.toContain("key.startsWith('com.mindroom.')");
    expect(customHtmlStyleSource).not.toContain('MindroomBlock');
    expect(customHtmlStyleSource).not.toContain('MindroomToolGroup');
    expect(streamingHookImplementationSource).toContain("from '../messages/aiRun'");
    expect(streamingHookImplementationSource).toContain('STREAM_STATUS_KEY');
    expect(messageIndexSource).toContain(
      "from '../../mindroom/messages/MindroomThreadSummaryCard'"
    );
    expect(msgTypeRenderersSource).not.toContain('function MindroomThreadSummaryCard');
    removedMessageCompatibilityPaths.forEach((path) => {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    });
    expect(threadSummarySource).toContain('THREAD_SUMMARY_METADATA_KEY');
    expect(toolApprovalSource).toContain('MINDROOM_TOOL_APPROVAL_EVENT');
    expect(aiRunSource).toContain('AI_RUN_METADATA_KEY');
    expect(blocksSource).toContain('MINDROOM_TOOL_REF_HTML_REG_G');
    expect(longTextSource).toContain('LONG_TEXT_TAG');
    expect(searchResultPolicySource).toContain('hasMindroomLongTextMetadata');
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
    expect(editMetadataSource).toContain('isMindroomMessageMetadataKey');
    expect(editResolutionSource).toContain("from './editDebug'");
    expect(editResolutionSource).toContain("from './editMetadata'");
  });

  it('keeps Local MindRoom settings implementation in the MindRoom namespace', () => {
    const removedLocalMindroomCompatibilityPaths = [
      '../settings/local-mindroom/LocalMindroom.tsx',
      '../settings/local-mindroom/api.ts',
      '../settings/local-mindroom/index.ts',
      '../settings/local-mindroom/mindroom.ts',
    ];
    const settingsSource = readFileSync(
      new URL('../settings/Settings.tsx', import.meta.url),
      'utf8'
    );
    const settingsMenuSource = readFileSync(
      new URL('../settings/settingsMenu.ts', import.meta.url),
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
    const settingsMenuItemSource = readFileSync(
      new URL('../../mindroom/local-mindroom/settingsMenu.ts', import.meta.url),
      'utf8'
    );

    removedLocalMindroomCompatibilityPaths.forEach((path) => {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    });
    expect(settingsSource).toContain(
      "from '../../mindroom/local-mindroom/LocalMindroom'"
    );
    expect(settingsSource).not.toContain("from './local-mindroom'");
    expect(settingsMenuSource).toContain(
      "from '../../mindroom/local-mindroom/settingsMenu'"
    );
    expect(settingsMenuSource).not.toContain("from '../../mindroom/branding/branding'");
    expect(pageSource).toContain('Connect Local MindRoom');
    expect(pageSource).toContain('resolveMindroomProvisioningRequest');
    expect(apiSource).toContain('LOCAL_MINDROOM_API_PATH');
    expect(helperSource).toContain('getMindroomPairingCommand');
    expect(settingsMenuItemSource).toContain('getLocalMindroomSettingsMenuItem');
    expect(settingsMenuItemSource).toContain('MINDROOM_APP_NAME');
  });

  it('keeps the Local MindRoom sidebar shortcut in the MindRoom namespace', () => {
    const compatibilityPath = new URL(
      '../../pages/client/sidebar/MindroomTab.tsx',
      import.meta.url
    );
    const sidebarIndexSource = readFileSync(
      new URL('../../pages/client/sidebar/index.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/sidebar/MindroomTab.tsx', import.meta.url),
      'utf8'
    );

    expect(existsSync(compatibilityPath)).toBe(false);
    expect(sidebarIndexSource).toContain(
      "from '../../../mindroom/sidebar/MindroomTab'"
    );
    expect(implementationSource).toContain('Local MindRoom');
    expect(implementationSource).toContain('SettingsPages.LocalMindroomPage');
  });

  it('keeps the Recent Threads feature in the MindRoom namespace', () => {
    const removedRecentThreadsCompatibilityPaths = [
      '../recent-threads/RecentThreadEntry.tsx',
      '../recent-threads/RecentThreadsDivider.tsx',
      '../recent-threads/RecentThreadsPanel.tsx',
      '../recent-threads/index.ts',
      '../recent-threads/recentThreadSummaryUtils.ts',
      '../recent-threads/recentThreadsPanelUtils.ts',
      '../recent-threads/useResolvedRecentThreadsLayout.ts',
    ];
    const homeSource = readFileSync(
      new URL('../../pages/client/home/Home.tsx', import.meta.url),
      'utf8'
    );
    const directSource = readFileSync(
      new URL('../../pages/client/direct/Direct.tsx', import.meta.url),
      'utf8'
    );
    const spaceSource = readFileSync(
      new URL('../../pages/client/space/Space.tsx', import.meta.url),
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
    const stateSource = readFileSync(
      new URL('../../mindroom/recent-threads/recentThreads.ts', import.meta.url),
      'utf8'
    );

    removedRecentThreadsCompatibilityPaths.forEach((path) => {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    });
    [homeSource, directSource, spaceSource].forEach((source) => {
      expect(source).toContain("from '../../../mindroom/recent-threads/RecentThreadsPanel'");
      expect(source).not.toContain("from '../../../features/recent-threads'");
    });
    expect(panelSource).toContain('Recent Threads');
    expect(summarySource).toContain('resolveRecentThreadSummaryText');
    expect(threadRecordSource).toContain("from '../recent-threads/recentThreadSummaryUtils'");
    expect(stateSource).toContain('makeRecentThreadsAtom');
  });

  it('keeps native app integration helpers in the MindRoom namespace', () => {
    const backRouteHandlerSource = readFileSync(
      new URL('../../components/BackRouteHandler.tsx', import.meta.url),
      'utf8'
    );
    const roomViewSource = readFileSync(new URL('./RoomView.tsx', import.meta.url), 'utf8');
    const systemNotificationSource = readFileSync(
      new URL('../settings/notifications/SystemNotification.tsx', import.meta.url),
      'utf8'
    );
    const systemNotificationExtensionsSource = readFileSync(
      new URL(
        '../../mindroom/notifications/SystemNotificationMindroomExtensions.tsx',
        import.meta.url
      ),
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
    const iosPushNotificationSource = readFileSync(
      new URL('../../mindroom/native/IOSPushNotification.tsx', import.meta.url),
      'utf8'
    );
    const clientNonUiSource = readFileSync(
      new URL('../../pages/client/ClientNonUIFeatures.tsx', import.meta.url),
      'utf8'
    );
    const mindroomClientNonUiSource = readFileSync(
      new URL('../../mindroom/client/MindroomClientNonUIFeatures.tsx', import.meta.url),
      'utf8'
    );

    expect(backRouteHandlerSource).toContain("from '../mindroom/native/useEdgeSwipeBack'");
    expect(roomViewSource).toContain("from '../../mindroom/native/useEdgeSwipeBack'");
    expect(nativeSsoSource).toContain('buildNativeSsoRedirectUrl');
    expect(iosPushSource).toContain('resolveIOSPushConfig');
    expect(systemNotificationSource).toContain(
      "from '../../../mindroom/notifications/SystemNotificationMindroomExtensions'"
    );
    expect(systemNotificationSource).not.toContain(
      "from '../../../mindroom/native/IOSPushNotification'"
    );
    expect(systemNotificationSource).not.toContain("from '../../../mindroom/branding/branding'");
    expect(systemNotificationSource).not.toContain("from '../../../mindroom/native/iosPush'");
    expect(systemNotificationSource).not.toContain('MINDROOM_APP_NAME');
    expect(systemNotificationSource).not.toContain('MINDROOM_NOTIFICATION_BRAND');
    expect(systemNotificationExtensionsSource).toContain('MINDROOM_NOTIFICATION_BRAND');
    expect(systemNotificationExtensionsSource).toContain('IOSPushNotification');
    expect(clientNonUiSource).toContain(
      "from '../../mindroom/client/MindroomClientNonUIFeatures'"
    );
    expect(clientNonUiSource).not.toContain("from '../../mindroom/native/iosPush'");
    expect(clientNonUiSource).not.toContain("from '../../mindroom/native/useIOSPushEnabled'");
    expect(clientNonUiSource).not.toContain('MINDROOM_FAVICON_SRC');
    expect(mindroomClientNonUiSource).toContain('resolveIOSPushConfig');
    expect(mindroomClientNonUiSource).toContain('MINDROOM_FAVICON_SRC');
    expect(mindroomClientNonUiSource).toContain('MindroomNativeIOSPushFeature');
    expect(iosPushNotificationSource).toContain('resolveIOSPushConfig');
    expect(iosPushNotificationSource).toContain('MINDROOM_APP_NAME');
  });

  it('keeps MindRoom Matrix client fetch policy in the MindRoom namespace', () => {
    const compatibilityPath = new URL('../../../client/matrixClientFactory.ts', import.meta.url);
    const initMatrixSource = readFileSync(
      new URL('../../../client/initMatrix.ts', import.meta.url),
      'utf8'
    );
    const authFlowsLoaderSource = readFileSync(
      new URL('../../components/AuthFlowsLoader.tsx', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/matrix/matrixClientFactory.ts', import.meta.url),
      'utf8'
    );

    expect(existsSync(compatibilityPath)).toBe(false);
    expect(initMatrixSource).toContain(
      "from '../app/mindroom/matrix/matrixClientFactory'"
    );
    expect(authFlowsLoaderSource).toContain(
      "from '../mindroom/matrix/matrixClientFactory'"
    );
    expect(implementationSource).toContain('createMatrixFetchFn');
    expect(implementationSource).toContain("credentials: 'include'");
  });

  it('keeps MindRoom branding and hosted-auth policy in the MindRoom namespace', () => {
    const brandingSource = readFileSync(
      new URL('../../mindroom/branding/branding.ts', import.meta.url),
      'utf8'
    );
    const clientBrandingSource = readFileSync(
      new URL('../../mindroom/branding/clientBranding.ts', import.meta.url),
      'utf8'
    );
    const authPolicySource = readFileSync(
      new URL('../../mindroom/auth/authPolicy.ts', import.meta.url),
      'utf8'
    );
    const authUiSource = readFileSync(
      new URL('../../mindroom/auth/authUi.ts', import.meta.url),
      'utf8'
    );
    const authFooterSource = readFileSync(
      new URL('../../pages/auth/AuthFooter.tsx', import.meta.url),
      'utf8'
    );
    const authLayoutSource = readFileSync(
      new URL('../../pages/auth/AuthLayout.tsx', import.meta.url),
      'utf8'
    );
    const ssoLoginSource = readFileSync(
      new URL('../../pages/auth/SSOLogin.tsx', import.meta.url),
      'utf8'
    );
    const loginSource = readFileSync(
      new URL('../../pages/auth/login/Login.tsx', import.meta.url),
      'utf8'
    );
    const passwordLoginSource = readFileSync(
      new URL('../../pages/auth/login/PasswordLoginForm.tsx', import.meta.url),
      'utf8'
    );
    const tokenLoginSource = readFileSync(
      new URL('../../pages/auth/login/TokenLogin.tsx', import.meta.url),
      'utf8'
    );
    const registerSource = readFileSync(
      new URL('../../pages/auth/register/Register.tsx', import.meta.url),
      'utf8'
    );
    const passwordRegisterSource = readFileSync(
      new URL('../../pages/auth/register/PasswordRegisterForm.tsx', import.meta.url),
      'utf8'
    );
    const welcomePageSource = readFileSync(
      new URL('../../pages/client/WelcomePage.tsx', import.meta.url),
      'utf8'
    );
    const splashScreenSource = readFileSync(
      new URL('../../components/splash-screen/SplashScreen.tsx', import.meta.url),
      'utf8'
    );
    const aboutSource = readFileSync(
      new URL('../settings/about/About.tsx', import.meta.url),
      'utf8'
    );

    expect(brandingSource).toContain('MINDROOM_DEVICE_DISPLAY_NAME');
    expect(brandingSource).toContain('MINDROOM_CINNY_SOURCE_URL');
    expect(clientBrandingSource).toContain('MINDROOM_CLIENT_BRANDING');
    expect(clientBrandingSource).toContain('getMindroomWelcomePageContent');
    expect(authPolicySource).toContain('MINDROOM_HOMESERVER');
    expect(authUiSource).toContain('MINDROOM_AUTH_BRANDING');
    expect(authUiSource).toContain('getMindroomAuthSsoRedirectUrl');
    expect(authUiSource).toContain('shouldDisablePasswordLogin');
    expect(authUiSource).toContain('shouldUseSsoOnlyRegistration');
    expect(authFooterSource).toContain("from '../../mindroom/auth/authUi'");
    expect(authLayoutSource).toContain("from '../../mindroom/auth/authUi'");
    expect(ssoLoginSource).toContain("from '../../mindroom/auth/authUi'");
    expect(loginSource).toContain("from '../../../mindroom/auth/authUi'");
    expect(passwordLoginSource).toContain("from '../../../mindroom/auth/authUi'");
    expect(tokenLoginSource).toContain("from '../../../mindroom/auth/authUi'");
    expect(registerSource).toContain("from '../../../mindroom/auth/authUi'");
    expect(passwordRegisterSource).toContain("from '../../../mindroom/auth/authUi'");
    expect(authFooterSource).not.toContain("from '../../mindroom/branding/branding'");
    expect(authLayoutSource).not.toContain("from '../../mindroom/branding/branding'");
    expect(ssoLoginSource).not.toContain("from '../../mindroom/native/nativeSso'");
    expect(loginSource).not.toContain("from '../../../mindroom/native/nativeSso'");
    expect(loginSource).not.toContain("from '../../../mindroom/auth/authPolicy'");
    expect(registerSource).not.toContain("from '../../../mindroom/native/nativeSso'");
    expect(registerSource).not.toContain("from '../../../mindroom/auth/authPolicy'");
    expect(passwordLoginSource).not.toContain("from '../../../mindroom/branding/branding'");
    expect(tokenLoginSource).not.toContain("from '../../../mindroom/branding/branding'");
    expect(passwordRegisterSource).not.toContain("from '../../../mindroom/branding/branding'");
    expect(welcomePageSource).toContain("from '../../mindroom/branding/clientBranding'");
    expect(welcomePageSource).not.toContain("from '../../mindroom/branding/branding'");
    expect(splashScreenSource).toContain("from '../../mindroom/branding/clientBranding'");
    expect(splashScreenSource).not.toContain("from '../../mindroom/branding/branding'");
    expect(aboutSource).toContain("from '../../../mindroom/branding/clientBranding'");
    expect(aboutSource).not.toContain("from '../../../mindroom/branding/branding'");
    expect(loginSource).not.toContain("=== 'mindroom.chat'");
    expect(registerSource).not.toContain("=== 'mindroom.chat'");
  });

  it('keeps thread root route canonicalization in MindRoom threads', () => {
    const roomViewSource = readFileSync(new URL('./RoomView.tsx', import.meta.url), 'utf8');
    const roomViewThreadStateSource = readFileSync(
      new URL('../../mindroom/threads/useRoomViewThreadState.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/useThreadRootEvent.ts', import.meta.url),
      'utf8'
    );

    expect(roomViewSource).toContain("from '../../mindroom/threads/useRoomViewThreadState'");
    expect(roomViewSource).not.toContain("from '../../mindroom/threads/useThreadRootEvent'");
    expect(roomViewThreadStateSource).toContain("from './useThreadRootEvent'");
    expect(implementationSource).toContain('resolveCanonicalThreadRootId');
    expect(implementationSource).toContain('RoomEvent.LocalEchoUpdated');
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
    expect(listSource).toContain('loadRoomThreads');
    expect(listSource).toContain('getThreadUnread');
    expect(hookSource).toContain('useRoomThreadList');
    expect(indexSource).toContain("from './useRoomThreadList'");
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
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/timelineScrollUtils.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/timelineScrollUtils'");
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
    expect(implementationSource).toContain('createTimelineDebugTrace');
    expect(implementationSource).toContain('mindroom.debug.timeline');
    expect(controllerSource).toContain('useTimelineDebugTraceIds');
    expect(controllerSource).toContain('useTimelineDebugRangeController');
    expect(controllerSource).toContain("'room-surface'");
    expect(controllerSource).toContain("'thread-range'");
    expect(source).not.toContain('createTimelineDebugTrace');
    expect(source).not.toContain("'room-surface'");
    expect(source).not.toContain("'thread-range'");
  });

  it('keeps event cache token helpers in MindRoom threads', () => {
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/eventCacheTokenUtils.ts', import.meta.url),
      'utf8'
    );

    expect(implementationSource).toContain('mergeCachedPaginationTokens');
    expect(implementationSource).toContain('compareCachedPaginationAnchors');
  });

  it('keeps event cache edit helpers in MindRoom threads', () => {
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/eventCacheEditUtils.ts', import.meta.url),
      'utf8'
    );

    expect(implementationSource).toContain('hydrateCachedEvents');
    expect(implementationSource).toContain('serializeEventsForCache');
    expect(implementationSource).toContain('reconcileRelationEventsWithAggregation');
  });

  it('keeps raw event cache stores in MindRoom threads', () => {
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

    expect(roomStoreSource).toContain('mindroom-room-event-cache');
    expect(threadStoreSource).toContain('mindroom-thread-event-cache');
    expect(repositorySource).toContain("from './roomEventCache'");
    expect(repositorySource).toContain("from './threadEventCache'");
    expect(repositorySource).not.toContain('../../features/room/roomEventCache');
    expect(repositorySource).not.toContain('../../features/room/threadEventCache');
  });

  it('keeps thread pagination reconciliation helpers in MindRoom threads', () => {
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/threadPaginationUtils.ts', import.meta.url),
      'utf8'
    );

    expect(implementationSource).toContain('computeReconciliationToken');
    expect(implementationSource).toContain('reconcileThreadBackwardPagination');
  });

  it('keeps timeline pagination helpers in MindRoom threads', () => {
    const source = readFileSync(new URL('./RoomTimeline.tsx', import.meta.url), 'utf8');
    const implementationSource = readFileSync(
      new URL('../../mindroom/threads/timelinePagination.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/timelinePagination'");
    expect(implementationSource).toContain('recalibrateTimelinePagination');
    expect(implementationSource).toContain('getEventIdAbsoluteIndex');
    expect(implementationSource).toContain('getLinkedTimelines');
    expect(implementationSource).toContain('getActiveTimelineRange');
    expect(implementationSource).toContain('getRoomUnreadInfo');
    expect(source).not.toContain('export const getEventIdAbsoluteIndex');
    expect(source).not.toContain('export const getTimelineAndBaseIndex');
    expect(source).not.toContain('const getInitialTimeline');
    expect(source).not.toContain('export const getActiveTimelineRange');
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
    const readReceiptsSource = readFileSync(
      new URL('../../mindroom/notifications/readReceipts.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useTimelineReadReceiptController');
    expect(source).not.toContain('markRoomAndThreadsAsRead');
    expect(source).not.toContain('markMainTimelineAsRead');
    expect(controllerSource).toContain('markRoomAndThreadsAsRead');
    expect(controllerSource).toContain("from '../notifications/readReceipts'");
    expect(readReceiptsSource).toContain('markRoomAndThreadsAsRead');
    expect(readReceiptsSource).toContain("from '../threads/threadRenderUtils'");
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
