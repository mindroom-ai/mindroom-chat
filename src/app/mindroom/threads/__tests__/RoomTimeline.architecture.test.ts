import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const readRoomTimelineSource = (): string =>
  readFileSync(new URL('../MindroomRoomTimeline.tsx', import.meta.url), 'utf8').replaceAll(
    "from './",
    "from '../../mindroom/threads/"
  );

const readRoomTimelineSeamSource = (): string =>
  readFileSync(new URL('../../../features/room/RoomTimeline.tsx', import.meta.url), 'utf8');

const readRoomViewSource = (): string =>
  readFileSync(new URL('../MindroomRoomView.tsx', import.meta.url), 'utf8').replaceAll(
    "from './",
    "from '../../mindroom/threads/"
  );

const readRoomViewSeamSource = (): string =>
  readFileSync(new URL('../../../features/room/RoomView.tsx', import.meta.url), 'utf8');

const readRoomViewHeaderSource = (): string =>
  readFileSync(new URL('../MindroomRoomViewHeader.tsx', import.meta.url), 'utf8').replaceAll(
    "from '../",
    "from '../../mindroom/"
  );

const readRoomViewHeaderSeamSource = (): string =>
  readFileSync(new URL('../../../features/room/RoomViewHeader.tsx', import.meta.url), 'utf8');

const readRoomSource = (): string =>
  readFileSync(new URL('../MindroomRoom.tsx', import.meta.url), 'utf8').replaceAll(
    "from './",
    "from '../../mindroom/threads/"
  );

const readRoomSeamSource = (): string =>
  readFileSync(new URL('../../../features/room/Room.tsx', import.meta.url), 'utf8');

describe('RoomTimeline architecture', () => {
  it('keeps the generic room timeline file as a narrow MindRoom seam', () => {
    const source = readRoomTimelineSeamSource();

    expect(source).toContain("from '../../mindroom/threads/MindroomRoomTimeline'");
    expect(source).not.toContain('useMindroomThreadIndex');
    expect(source.split('\n').length).toBeLessThan(8);
  });

  it('keeps the generic room view file as a narrow MindRoom seam', () => {
    const source = readRoomViewSeamSource();

    expect(source).toContain("from '../../mindroom/threads/MindroomRoomView'");
    expect(source).not.toContain('useRoomViewThreadState');
    expect(source.split('\n').length).toBeLessThan(5);
  });

  it('keeps the generic room view header file as a narrow MindRoom seam', () => {
    const source = readRoomViewHeaderSeamSource();

    expect(source).toContain("from '../../mindroom/threads/MindroomRoomViewHeader'");
    expect(source).not.toContain('MindroomCommandPaletteHeaderButton');
    expect(source.split('\n').length).toBeLessThan(5);
  });

  it('keeps the generic room shell file as a narrow MindRoom seam', () => {
    const source = readRoomSeamSource();

    expect(source).toContain("from '../../mindroom/threads/MindroomRoom'");
    expect(source).not.toContain('useRoomThreadRouteRestore');
    expect(source.split('\n').length).toBeLessThan(5);
  });

  it('keeps MindRoom-owned room modules off their compatibility re-export seams', () => {
    const roomViewSource = readFileSync(
      new URL('../MindroomRoomView.tsx', import.meta.url),
      'utf8'
    );
    const timelineSource = readFileSync(
      new URL('../MindroomRoomTimeline.tsx', import.meta.url),
      'utf8'
    );
    const pinMenuSource = readFileSync(
      new URL('../../messages/MindroomRoomPinMenu.tsx', import.meta.url),
      'utf8'
    );
    const routerSource = readFileSync(
      new URL('../../../pages/Router.tsx', import.meta.url),
      'utf8'
    );

    expect(roomViewSource).toContain("from '../room-input/MindroomRoomInput'");
    expect(roomViewSource).toContain("from './MindroomRoomTimeline'");
    expect(roomViewSource).not.toContain("from '../../features/room/RoomInput'");
    expect(roomViewSource).not.toContain("from '../../features/room/RoomTimeline'");
    expect(readRoomSource()).toContain("from '../../mindroom/threads/MindroomCallChatView'");
    expect(readRoomSource()).not.toContain("from '../../features/room/CallChatView'");
    expect(timelineSource).toContain("from '../messages/MindroomMessage'");
    expect(timelineSource).not.toContain("from '../../features/room/message'");
    expect(pinMenuSource).toContain("from '../../features/room/message/EncryptedContent'");
    expect(pinMenuSource).not.toContain("from '../../features/room/message'");
    expect(routerSource).toContain("from '../mindroom/threads/MindroomRoom'");
    expect(routerSource).not.toContain("from '../features/room'");
  });

  it('delegates thread badge JSX rendering to the MindRoom badge seam', () => {
    const source = readRoomTimelineSource();

    expect(source).not.toContain('const renderThreadBadge');
    expect(source).not.toContain('getMindroomRoomTimelineThreadBadgeModel');
    expect(source).toContain('renderMindroomRoomTimelineThreadBadge');
  });

  it('delegates MindRoom timeline message policy to a fork-owned seam', () => {
    const source = readRoomTimelineSource();
    const timelineMessageSource = readFileSync(
      new URL('../roomTimelineMessageExtensions.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/roomTimelineMessageExtensions'");
    expect(source).not.toContain("from '../../mindroom/messages/toolApproval'");
    expect(source).not.toContain("from '../../mindroom/threads/threadBadgeViewModel'");
    expect(source).not.toContain('getToolApprovalRenderContent');
    expect(source).not.toContain('buildThreadBadgeViewModelFromRecord');
    expect(source).not.toContain('MINDROOM_ROOM_TIMELINE_APPROVAL_EVENT');
    expect(source).toContain('getMindroomRoomTimelineMessageRenderers');
    expect(source).toContain('getMindroomRoomTimelineApprovalContentIfSupported');
    expect(source).toContain('renderMindroomRoomTimelineThreadBadge');
    expect(timelineMessageSource).toContain("from '../messages/toolApproval'");
    expect(timelineMessageSource).toContain("from './threadBadgeViewModel'");
    expect(timelineMessageSource).toContain('getMindroomRoomTimelineMessageRenderers');
    expect(timelineMessageSource).toContain('getMindroomRoomTimelineApprovalContentIfSupported');
    expect(timelineMessageSource).toContain('getMindroomRoomTimelineThreadBadgeModel');
    expect(timelineMessageSource).toContain('renderMindroomRoomTimelineThreadBadge');
  });

  it('passes pending local echo state from base and edited events into message content', () => {
    const source = readRoomTimelineSource();

    expect(source).toContain("from '../messages/pendingLocalEcho'");
    expect(source).toContain(
      'isPendingLocalEchoEvent(mEvent) || isPendingLocalEchoEvent(editedEvent)'
    );
    expect(source).toContain('pendingSend={pendingSend}');
  });

  it('keeps reply/start-thread draft policy in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../roomTimelineReplyDraft.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/roomTimelineReplyDraft'");
    expect(source).not.toContain("rel_type: 'm.thread'");
    expect(source).not.toContain("'m.relates_to': relation");
    expect(implementationSource).toContain("rel_type: 'm.thread'");
    expect(implementationSource).toContain('getEditedEvent');
  });

  it('keeps renderability and preload counting outside RoomTimeline', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../roomTimelineEvents.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('export const isRenderableEvent =');
    expect(source).not.toContain('export const getRoomPreloadCounts =');
    expect(source).toContain("from '../../mindroom/threads/roomTimelineEvents'");
    expect(implementationSource).toContain('buildRoomSurfaceEventEntries');
  });

  it('keeps classic thread reply merging outside RoomTimeline', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../roomTimelineEvents.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('mergeClassicRoomThreadReplyEntries');
    expect(source).not.toContain('room.getThreads().forEach');
    expect(implementationSource).toContain('mergeClassicRoomThreadReplyEntries');
    expect(implementationSource).toContain('loadedRootEntries');
  });

  it('routes deep-history preload through the engine scheduler, not the SDK live timeline', () => {
    // CINNY-207 P4.3: the `useRoomEagerPreload` hook was deleted.
    // Deep-history sweep is now a band-4 job on the engine's
    // BackfillScheduler (`enqueueRoomDeepHistoryJob`) that persists
    // straight through `saveRoomEventsToCache` and NEVER calls
    // `mx.paginateEventTimeline` on the room's live timeline. Guard
    // both invariants: (a) the hook is gone, (b) the enqueue path is
    // present.
    const source = readRoomTimelineSource();
    const windowControllerSource = readFileSync(
      new URL('../roomTimelineWindowController.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('useRoomEagerPreload');
    expect(source).toContain('enqueueRoomDeepHistoryJob');
    expect(source).toContain('useRoomTimelineWindowController');
    expect(source).not.toContain("from '../../mindroom/threads/roomPreloadTarget'");
    expect(windowControllerSource).toContain("from './roomPreloadTarget'");
    expect(source).not.toContain('[eager-preload]');
  });

  it('keeps backfill network fetchers inside the engine (no direct createMessagesRequest in components)', () => {
    // CINNY-207 P4.3: any /messages fetch has to go through the
    // engine's BackfillScheduler (via `enqueueRoomDeepHistoryJob`,
    // `gapFillExecutor`, etc.). RoomTimeline and other render
    // components must never call `mx.createMessagesRequest` directly.
    const source = readRoomTimelineSource();
    expect(source).not.toContain('createMessagesRequest');
  });

  it('does not import raw event cache stores directly', () => {
    const source = readRoomTimelineSource();

    // CINNY-207 P2.3: the legacy `roomEventCache` / `threadEventCache`
    // shim files were deleted; the unified store is `./cacheStore`.
    // Neither the store nor the eventRepository seam may be imported
    // by the render component.
    expect(source).not.toContain("from './roomEventCache'");
    expect(source).not.toContain("from './threadEventCache'");
    expect(source).not.toContain("from './cacheStore'");
    expect(source).not.toContain("from '../../mindroom/threads/eventRepository'");
  });

  it('delegates room cache helper derivation to the event repository', () => {
    const source = readRoomTimelineSource();

    expect(source).not.toContain('const getMainTimelineCacheEvents');
    expect(source).not.toContain('export const shouldHydrateLatestRoomCache');
    expect(source).not.toContain('export const filterLatestRoomCacheHydrationEvents');
  });

  it('delegates thread cache coverage derivation to a fork-owned module', () => {
    const source = readRoomTimelineSource();

    expect(source).not.toContain('const getRoomDerivedThreadSnapshotState');
    expect(source).not.toContain('const isCompleteCachedThreadSnapshot');
    expect(source).not.toContain('const getAuthoritativeCachedThreadReplyCount');
    expect(source).not.toContain('const mergeThreadBackfillEvents');
  });

  it('delegates thread cache coverage decisions to a fork-owned module', () => {
    const source = readRoomTimelineSource();
    const windowControllerSource = readFileSync(
      new URL('../roomTimelineWindowController.ts', import.meta.url),
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
    const source = readRoomTimelineSource();

    expect(source).not.toContain('const withStateTargetEvents');
    expect(source).not.toContain('serializeEventsForCache(');
  });

  it('delegates cache persistence to the MindroomSyncEngine facade', () => {
    // CINNY-207 P3.3: the pre-strip
    // `useRoomCacheLifecycleController` / `useThreadCachePersistenceController`
    // hooks are gone; persistence is owned by MindroomSyncEngine (all
    // rooms, client-level). The component only consumes the persist
    // facade via `useMindroomSyncEngine` / `engine.persist.forRoom`
    // and hands the fns down to the fetch controllers.
    const source = readRoomTimelineSource();

    expect(source).not.toContain('persistRoomEventCacheSnapshot');
    expect(source).not.toContain('useRoomCacheLifecycleController');
    expect(source).not.toContain('useThreadCachePersistenceController');
    expect(source).not.toContain("from '../../mindroom/threads/threadCachePersistenceController'");
    expect(source).not.toContain("from '../../mindroom/threads/roomCacheLifecycleController'");
    expect(source).toContain('useMindroomSyncEngine');
    expect(source).toContain('syncEngine.persist.forRoom');
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
    const source = readRoomTimelineSource();
    const indexSource = readFileSync(
      new URL('../useMindroomThreadIndex.ts', import.meta.url),
      'utf8'
    );
    const overviewCacheHydrationSource = readFileSync(
      new URL('../threadOverviewCacheHydration.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain("from './useThreadOverviewCacheHydration'");
    expect(source).not.toContain('useThreadOverviewCacheHydration');
    expect(source).toContain('useMindroomThreadIndex');
    expect(indexSource).toContain('useThreadOverviewCachedMetadata');
    expect(indexSource).toContain('useThreadOverviewRelationUpdates');
    expect(indexSource).not.toContain('cachedMetadata.applyUpdate');
    expect(indexSource).not.toContain('resolveFetchedRelationOverviewUpdate');
    expect(overviewCacheHydrationSource).toContain('useThreadOverviewRelationUpdates');
    expect(overviewCacheHydrationSource).toContain('resolveFetchedRelationOverviewUpdate');
    expect(indexSource).not.toContain('setCachedThreadLastActivityTsMap');
    expect(indexSource).not.toContain('setCachedThreadLatestReplyPreviewMap');
    expect(indexSource).not.toContain('setCachedThreadLastSenderIdMap');
    expect(indexSource).not.toContain('setCachedThreadMessageCountMap');
    expect(indexSource).not.toContain('setCachedThreadCoverageMap');
  });

  it('delegates per-room thread index assembly to the MindRoom thread namespace', () => {
    const source = readRoomTimelineSource();
    const indexSource = readFileSync(
      new URL('../useMindroomThreadIndex.ts', import.meta.url),
      'utf8'
    );
    const recordMapSource = readFileSync(
      new URL('../threadIndexRecords.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useMindroomThreadIndex');
    expect(source).not.toContain('const normalThreadRecordMap = useMemo');
    expect(source).not.toContain('const compactThreadRecordMap = useMemo');
    expect(source).not.toContain('computeThreadRecordStatusCounts');
    expect(source).not.toContain('computeThreadRecordTagCounts');
    expect(indexSource).toContain('buildMindroomThreadIndexRecordMaps');
    expect(indexSource).not.toContain('buildThreadRecordMap');
    expect(recordMapSource).toContain('buildThreadRecordMap');
  });

  it('delegates thread timeline render state to the MindRoom thread namespace', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../useThreadTimelineState.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/useThreadTimelineState'");
    expect(source).toContain('useThreadTimelineState');
    expect(source).not.toContain("from '../../mindroom/threads/useThreadRenderState'");
    expect(source).not.toContain('const threadLinkedTimelines =');
    expect(source).not.toContain('const threadEventMap = useMemo');
    expect(implementationSource).toContain("from './useThreadRenderState'");
    expect(implementationSource).toContain('threadBackwardPaginationToken');
    expect(implementationSource).toContain('canPaginateThreadFront');
  });

  it('delegates room overview focus and filter helpers to the MindRoom thread namespace', () => {
    const source = readRoomTimelineSource();
    const windowControllerSource = readFileSync(
      new URL('../roomTimelineWindowController.ts', import.meta.url),
      'utf8'
    );
    const eventOpenControllerSource = readFileSync(
      new URL('../roomEventOpenController.ts', import.meta.url),
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
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../roomDeepLink.ts', import.meta.url),
      'utf8'
    );
    const indexSource = readFileSync(
      new URL('../useMindroomThreadIndex.ts', import.meta.url),
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
      new URL('../../../pages/client/ClientInitStorageAtom.tsx', import.meta.url),
      'utf8'
    );
    const clientStorageImplementationSource = readFileSync(
      new URL('../../cache/clientStorageAtoms.ts', import.meta.url),
      'utf8'
    );
    const roomSource = readRoomSource();
    const roomRouteRestoreSource = readFileSync(
      new URL('../useRoomThreadRouteRestore.ts', import.meta.url),
      'utf8'
    );
    const roomEscapeReadReceiptsSource = readFileSync(
      new URL('../useRoomEscapeReadReceipts.ts', import.meta.url),
      'utf8'
    );
    const clientLayoutSource = readFileSync(
      new URL('../../../pages/client/ClientLayout.tsx', import.meta.url),
      'utf8'
    );
    const routeRestoreSource = readFileSync(
      new URL('../../routing/clientRouteRestore.ts', import.meta.url),
      'utf8'
    );
    const sessionCleanupSource = readFileSync(
      new URL('../../cache/sessionCleanup.ts', import.meta.url),
      'utf8'
    );
    const sessionStoreSource = readFileSync(
      new URL('../../../state/sessions.ts', import.meta.url),
      'utf8'
    );
    const sessionStoreConfigSource = readFileSync(
      new URL('../../cache/sessionStoreConfig.ts', import.meta.url),
      'utf8'
    );
    const themeBootstrapSource = readFileSync(
      new URL('../../../theme/themeBootstrap.ts', import.meta.url),
      'utf8'
    );
    const initMatrixSource = readFileSync(
      new URL('../../../../client/initMatrix.ts', import.meta.url),
      'utf8'
    );

    expect(clientStorageSource).toContain("from '../../mindroom/cache/clientStorageAtoms'");
    expect(clientStorageSource).not.toContain("from '../../mindroom/threads/lastOpenThread'");
    expect(clientStorageSource).not.toContain("from '../../mindroom/recent-threads/recentThreads'");
    expect(clientStorageImplementationSource).toContain('registerLastOpenThreadAtom');
    expect(clientStorageImplementationSource).toContain('registerRecentThreadsAtom');
    expect(roomSource).not.toContain("from '../../mindroom/threads/lastOpenThread'");
    expect(roomSource).not.toContain("from '../../mindroom/recent-threads/recentThreads'");
    expect(roomSource).not.toContain("from '../../mindroom/notifications/readReceipts'");
    expect(roomSource).toContain("from '../../mindroom/threads/useRoomThreadRouteRestore'");
    expect(roomSource).toContain("from '../../mindroom/threads/useRoomEscapeReadReceipts'");
    expect(roomRouteRestoreSource).toContain("from './lastOpenThread'");
    expect(roomRouteRestoreSource).toContain('removeRecentThread');
    expect(roomEscapeReadReceiptsSource).toContain('markRoomAndThreadsAsRead');
    expect(roomEscapeReadReceiptsSource).toContain('markThreadAsRead');
    expect(clientLayoutSource).not.toContain("from '../../mindroom/threads/lastOpenThread'");
    expect(clientLayoutSource).toContain('getLastOpenThreadRestoreTarget');
    expect(routeRestoreSource).toContain("from '../threads/lastOpenThread'");
    expect(routeRestoreSource).toContain('getLastOpenThreadRestoreTarget');
    expect(sessionCleanupSource).toContain("from '../threads/lastOpenThread'");
    expect(sessionStoreSource).toContain("from '../mindroom/cache/sessionStoreConfig'");
    expect(sessionStoreSource).not.toContain("= 'mindroom_multi_account_store'");
    expect(sessionStoreSource).not.toContain("= 'mindroom-session-store-changed'");
    expect(sessionStoreConfigSource).toContain('MINDROOM_SESSION_STORE_KEY');
    expect(sessionStoreConfigSource).toContain('MINDROOM_SESSION_STORE_EVENT');
    expect(themeBootstrapSource).toContain("from '../mindroom/cache/sessionStoreConfig'");
    expect(themeBootstrapSource).not.toContain("= 'mindroom_multi_account_store'");
    expect(initMatrixSource).not.toContain("from '../app/state/lastOpenThread'");
  });

  it('does not keep unused top-level MindRoom compatibility wrappers', () => {
    const removedCompatibilityPaths = [
      '../../hooks/useIOSPushEnabled.ts',
      '../../hooks/useEdgeSwipeBack.ts',
      '../../hooks/useEdgeSwipeForward.ts',
      '../../hooks/useRoomEvent.ts',
      '../../hooks/useThreadScheduledTasks.ts',
      '../../hooks/useThreadStreamingState.ts',
      '../../components/message/ThreadIndicator.ts',
      '../../state/lastOpenThread.ts',
      '../../state/lastExitedThread.ts',
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

  it('does not keep transient implementation report files in the repo root', () => {
    const removedTransientRootPaths = [
      '../../../../../FINAL-PLAN.md',
      '../../../../../IMPLEMENTATION-REPORT.md',
    ];

    removedTransientRootPaths.forEach((path) => {
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
    const removedVoiceFeaturePaths = [
      '../../../features/room/useVoiceRecorder.ts',
      '../../../features/room/useVoiceRecorder.test.ts',
      '../../../features/room/VoiceRecorderDialog.test.ts',
      '../../../features/room/VoiceRecordingCapsule.tsx',
      '../../../features/room/VoiceRecordingCapsule.css.ts',
      '../../../features/room/VoiceRecordingCapsule.test.ts',
    ];
    const source = readFileSync(
      new URL('../../../features/room/RoomInput.tsx', import.meta.url),
      'utf8'
    );
    const mindroomRoomInputSource = readFileSync(
      new URL('../../room-input/MindroomRoomInput.tsx', import.meta.url),
      'utf8'
    );
    const roomInputExtensionsSource = readFileSync(
      new URL('../../room-input/RoomInputMindroomExtensions.tsx', import.meta.url),
      'utf8'
    );
    const controllerSource = readFileSync(
      new URL('../useRoomInputSendSessionController.ts', import.meta.url),
      'utf8'
    );
    const sessionSource = readFileSync(
      new URL('../roomInputSendSession.ts', import.meta.url),
      'utf8'
    );
    const voiceRecorderDialogSource = readFileSync(
      new URL('../../voice/VoiceRecorderDialog.tsx', import.meta.url),
      'utf8'
    );
    const voiceRecorderHookSource = readFileSync(
      new URL('../../voice/useVoiceRecorder.ts', import.meta.url),
      'utf8'
    );
    const voiceRecorderCapsuleSource = readFileSync(
      new URL('../../voice/VoiceRecordingCapsule.tsx', import.meta.url),
      'utf8'
    );

    removedRoomInputCompatibilityPaths.forEach((path) => {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    });
    removedVoiceFeaturePaths.forEach((path) => {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    });
    expect(source).toContain("from '../../mindroom/room-input/MindroomRoomInput'");
    expect(source).not.toContain('useRoomInputSendSessionController');
    expect(source.trim().split('\n').length).toBeLessThan(10);
    expect(mindroomRoomInputSource).toContain('useRoomInputSendSessionController');
    expect(mindroomRoomInputSource).toContain("from './RoomInputMindroomExtensions'");
    expect(mindroomRoomInputSource).not.toContain(
      "from '../../mindroom/threads/useRoomInputSendSessionController'"
    );
    expect(mindroomRoomInputSource).not.toContain("from '../../mindroom/commands/");
    expect(mindroomRoomInputSource).not.toContain("from '../../mindroom/voice/");
    expect(mindroomRoomInputSource).not.toContain(
      "from '../../mindroom/threads/composeMessageRelation'"
    );
    expect(mindroomRoomInputSource).not.toContain('MindroomRoomInputThreadIndicator');
    expect(mindroomRoomInputSource).not.toContain('Sending to this thread');
    expect(mindroomRoomInputSource).not.toContain('createRoomInputSendSessionState');
    expect(mindroomRoomInputSource).not.toContain('resolveRoomInputSendStep');
    expect(mindroomRoomInputSource).not.toContain('hasRoomInputSendFailures');
    expect(mindroomRoomInputSource).not.toContain('isSignalBridgeRoom');
    expect(roomInputExtensionsSource).toContain("from '../threads/composeMessageRelation'");
    expect(roomInputExtensionsSource).toContain("from '../commands/mindroomCommandQuery'");
    expect(roomInputExtensionsSource).toContain("from '../commands/MindroomCommandAutocomplete'");
    expect(roomInputExtensionsSource).toContain("from '../voice/VoiceRecorderDialog'");
    expect(roomInputExtensionsSource).toContain('MindroomRoomInputReplyContext');
    expect(roomInputExtensionsSource).not.toContain('Sending to this thread');
    expect(roomInputExtensionsSource).toContain(
      "from '../threads/useRoomInputSendSessionController'"
    );
    expect(controllerSource).toContain('createRoomInputSendSessionState');
    expect(controllerSource).toContain('resolveRoomInputSendStep');
    expect(controllerSource).toContain('isSignalBridgeRoom');
    expect(sessionSource).toContain('getRoomInputSendMode');
    expect(voiceRecorderDialogSource).toContain("from './useVoiceRecorder'");
    expect(voiceRecorderDialogSource).toContain("from './VoiceRecordingCapsule'");
    expect(voiceRecorderDialogSource).not.toContain("from '../../features/room/");
    expect(voiceRecorderHookSource).toContain("from './voiceRecorderMime'");
    expect(voiceRecorderHookSource).not.toContain("from '../../mindroom/voice/voiceRecorderMime'");
    expect(voiceRecorderCapsuleSource).toContain("from '../../components/voice/VoiceWaveform'");
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
    expect(
      existsSync(new URL('../../../features/room/threadMessagePreview.ts', import.meta.url))
    ).toBe(false);
  });

  it('keeps thread navigation seeding policy in MindRoom threads', () => {
    const hookSource = readFileSync(
      new URL('../../../hooks/useRoomNavigate.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../threadNavigation.ts', import.meta.url),
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
    const source = readRoomTimelineSource();
    const seedPrewarmControllerSource = readFileSync(
      new URL('../threadSeedPrewarmController.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('cachedThreadEvents.unshift(...cachedPage.events)');
    expect(source).not.toContain('loadThreadCachedSnapshot');
    expect(seedPrewarmControllerSource).toContain('loadThreadCachedSnapshot');
  });

  it('delegates cached thread event mapping and pagination reads to the event repository', () => {
    const source = readRoomTimelineSource();
    const paginationControllerSource = readFileSync(
      new URL('../threadPaginationCommandController.ts', import.meta.url),
      'utf8'
    );
    const cacheFirstSource = readFileSync(
      new URL('../threadOpenCacheFirst.ts', import.meta.url),
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
    const source = readRoomTimelineSource();
    const threadBootstrapSource = readFileSync(
      new URL('../threadBootstrap.ts', import.meta.url),
      'utf8'
    );
    // CINNY-207 P5.1 Commit 2: `fetchAllThreadRelations` moved to
    // `engine/threadRelationsFetcher.ts` so the `/relations` boundary
    // can be enforced by the dedicated engine-only guard below.
    // `threadBootstrap.ts` re-exports the engine symbol for the
    // existing unit-test surface — the assertion just checks the
    // symbol is still reachable from this file, not where it's
    // defined.
    const threadRelationsFetcherSource = readFileSync(
      new URL('../../engine/threadRelationsFetcher.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain("from '../../mindroom/threads/threadBootstrap'");
    expect(threadRelationsFetcherSource).toContain('export async function fetchAllThreadRelations');
    expect(threadBootstrapSource).toContain('fetchAllThreadRelations');
    expect(threadBootstrapSource).toContain('export const collectPriorityThreadSeedPrewarmRoots =');
    expect(threadBootstrapSource).toContain('export const getLoadedRoomThreadEvents =');
    expect(threadBootstrapSource).toContain('export const getLoadedRoomThreadSeedEvents =');
    expect(source).not.toContain('export async function fetchAllThreadRelations');
    expect(source).not.toContain('export const collectPriorityThreadSeedPrewarmRoots =');
    expect(source).not.toContain('export const getLoadedRoomThreadEvents =');
    expect(source).not.toContain('export const getLoadedRoomThreadSeedEvents =');
    expect(source).not.toContain('export const getCompactRootEventsNeedingBackfill =');
  });

  it('delegates thread seed prewarm queue orchestration to MindRoom threads', () => {
    const source = readRoomTimelineSource();

    expect(source).toContain('useThreadSeedPrewarmController');
    expect(source).toContain("from '../../mindroom/threads/threadSeedPrewarmController'");
    expect(source).not.toContain('visibleThreadSeedPrewarmQueueRef');
    expect(source).not.toContain('visibleThreadSeedPrewarmRunningRef');
    expect(source).not.toContain('visibleThreadSeedPrewarmGenerationRef');
  });

  it('delegates thread-open cache/network commands to MindRoom threads', () => {
    const source = readRoomTimelineSource();

    expect(source).toContain('useThreadOpenCacheController');
    expect(source).toContain("from '../../mindroom/threads/threadOpenCacheController'");
    expect(source).not.toContain('const refreshLatestThreadSlice = useCallback');
    expect(source).not.toContain('const backfillThreadRelationsIntoCache = useCallback');
    // CINNY-207 P5.1: `refreshLatestThreadRelationsTail` was deleted
    // from `threadOpenCacheController` — the reconciler owns the
    // post-open server verify now. The assertion stays so a future
    // "quick fix" that reintroduces it via a useCallback in the
    // component tripwires immediately.
    expect(source).not.toContain('const refreshLatestThreadRelationsTail = useCallback');
    expect(source).not.toContain('const hydrateThreadFromCache = useCallback');
  });

  it('delegates thread-open SDK bootstrap to MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const bootstrapSource = readFileSync(
      new URL('../threadOpenSdkBootstrap.ts', import.meta.url),
      'utf8'
    );
    const lifecycleSource = readFileSync(
      new URL('../threadOpenLifecycleController.ts', import.meta.url),
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
    const source = readRoomTimelineSource();
    const cacheFirstSource = readFileSync(
      new URL('../threadOpenCacheFirst.ts', import.meta.url),
      'utf8'
    );
    const lifecycleSource = readFileSync(
      new URL('../threadOpenLifecycleController.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('runThreadOpenCacheFirst');
    expect(lifecycleSource).toContain('runThreadOpenCacheFirst');
    expect(cacheFirstSource).toContain('thread-open-complete-cache-hit');
    expect(source).not.toContain('thread-open-complete-cache-hit');
    expect(source).not.toContain('shouldBackfillThreadRelationsFromCoverage');
    expect(source).not.toContain('hasUsableThreadCacheSnapshot');
  });

  // CINNY-207 P5.1 Commit 2: `threadOpenPostBootstrapRefresh.ts` was
  // deleted — its limit-200 fetchRelations is now the reconciler; its
  // forward-gap check (with the `'thread-open-forward-gap-check'`
  // log string that this guard used to hunt for) moved inline into
  // the lifecycle controller so we keep the same tripwire (the log
  // string remains a useful marker for debugging).
  it('keeps the forward-gap check + log string in the lifecycle controller (post-bootstrap-refresh deleted)', () => {
    const source = readRoomTimelineSource();
    const lifecycleSource = readFileSync(
      new URL('../threadOpenLifecycleController.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('runThreadOpenPostBootstrapRefresh');
    // The runner is gone entirely — assert it doesn't reappear as a
    // module or symbol reference. We check for `import { … } from …`
    // + `const … = require(…)` rather than raw string containment
    // so comments citing the pre-P5 name (for historical clarity)
    // don't trip the guard.
    expect(source).not.toMatch(/from ['"][^'"]*threadOpenPostBootstrapRefresh['"]/);
    expect(lifecycleSource).not.toMatch(/from ['"][^'"]*threadOpenPostBootstrapRefresh['"]/);
    expect(lifecycleSource).not.toMatch(/\brunThreadOpenPostBootstrapRefresh\(/);
    // Forward-gap check + log string lives in the lifecycle
    // controller now. The log string stays as-is so existing capture
    // consumers keep working.
    expect(lifecycleSource).toContain('thread-open-forward-gap-check');
    expect(source).not.toContain('thread-open-forward-gap-check');
    expect(source).not.toContain('computeReconciliationToken');
  });

  it('delegates thread-open target-event context loading to MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const targetEventSource = readFileSync(
      new URL('../threadOpenTargetEvent.ts', import.meta.url),
      'utf8'
    );
    const lifecycleSource = readFileSync(
      new URL('../threadOpenLifecycleController.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain('runThreadOpenTargetEvent');
    expect(lifecycleSource).toContain('runThreadOpenTargetEvent');
    expect(targetEventSource).toContain('setPendingThreadOpen');
    expect(source).not.toContain('evtThreadTimelineSet');
  });

  it('delegates thread-aware timeline refresh orchestration to MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const refreshHookSource = readFileSync(
      new URL('../useThreadAwareTimelineRefresh.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/useThreadAwareTimelineRefresh'");
    expect(refreshHookSource).toContain('RoomEvent.TimelineRefresh');
    expect(source).not.toContain('const useLiveTimelineRefresh');
    expect(source).not.toContain('threadRefreshInFlightRef');
  });

  it('keeps compact thread root data implementation in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../compactThreadRootData.ts', import.meta.url),
      'utf8'
    );
    const indexSource = readFileSync(
      new URL('../useMindroomThreadIndex.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain("from '../../mindroom/threads/compactThreadRootData'");
    expect(implementationSource).toContain('buildCompactThreadRootData');
    expect(implementationSource).toContain('isZeroReplyStandaloneThreadRootEvent');
    expect(indexSource).toContain("from './compactThreadRootData'");
  });

  it('keeps thread presentation derivation in MindRoom threads', () => {
    const implementationSource = readFileSync(
      new URL('../threadPresentation.ts', import.meta.url),
      'utf8'
    );

    expect(implementationSource).toContain('resolveThreadPresentationSnapshot');
    expect(implementationSource).toContain('getLatestThreadSummaryInfoFromEventSources');
  });

  it('keeps thread filter DSL parsing in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../threadFilterDsl.ts', import.meta.url),
      'utf8'
    );
    const indexSource = readFileSync(
      new URL('../useMindroomThreadIndex.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain("from '../../mindroom/threads/threadFilterDsl'");
    expect(implementationSource).toContain('parseThreadFilterQuery');
    expect(implementationSource).toContain('serializeThreadFilterQuery');
    expect(indexSource).toContain("from './threadFilterDsl'");
    expect(indexSource).toContain('parseThreadFilterQuery');
    expect(indexSource).toContain('applyParsedThreadFilterQuery');
  });

  it('keeps compact room view components in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../CompactRoomView.tsx', import.meta.url),
      'utf8'
    );
    const cardImplementationSource = readFileSync(
      new URL('../CompactThreadCard.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/CompactRoomView'");
    expect(implementationSource).toContain('useCompactThreadCardViewModels');
    expect(cardImplementationSource).toContain('CompactThreadCardViewModel');
  });

  it('keeps compact thread scheduled-label utilities in MindRoom threads', () => {
    const hookCompatibilityPath = new URL('../../../hooks/useThreadHeaderInfo.ts', import.meta.url);
    const hookImplementationSource = readFileSync(
      new URL('../useThreadHeaderInfo.ts', import.meta.url),
      'utf8'
    );
    const scheduledStatusHookSource = readFileSync(
      new URL('../useThreadScheduledStatus.ts', import.meta.url),
      'utf8'
    );
    const viewModelSource = readFileSync(
      new URL('../compactThreadCardViewModel.ts', import.meta.url),
      'utf8'
    );
    const scheduledTaskCompatibilityPath = new URL(
      '../../utils/scheduledTaskContract.ts',
      import.meta.url
    );
    const scheduledTaskImplementationSource = readFileSync(
      new URL('../scheduledTaskContract.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../compactThreadCardUtils.ts', import.meta.url),
      'utf8'
    );

    expect(existsSync(hookCompatibilityPath)).toBe(false);
    expect(hookImplementationSource).toContain("from './compactThreadCardUtils'");
    expect(hookImplementationSource).toContain("from './useThreadScheduledStatus'");
    expect(hookImplementationSource).not.toContain("from './scheduledTaskContract'");
    expect(hookImplementationSource).not.toContain("from './threadScheduledStatus'");
    expect(scheduledStatusHookSource).toContain("from './scheduledTaskContract'");
    expect(scheduledStatusHookSource).toContain("from './threadScheduledStatus'");
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
      new URL('../useThreadLastActivityTs.ts', import.meta.url),
      'utf8'
    );
    const threadIndicatorSource = readFileSync(
      new URL('../ThreadIndicator.tsx', import.meta.url),
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
      new URL('../../../components/message/Reply.tsx', import.meta.url),
      'utf8'
    );
    const replyStyleSource = readFileSync(
      new URL('../../../components/message/Reply.css.ts', import.meta.url),
      'utf8'
    );
    const indexSource = readFileSync(
      new URL('../../../components/message/index.ts', import.meta.url),
      'utf8'
    );
    const replyExtensionsSource = readFileSync(
      new URL('../../messages/replyExtensions.tsx', import.meta.url),
      'utf8'
    );
    const threadIndicatorSource = readFileSync(
      new URL('../ThreadIndicator.tsx', import.meta.url),
      'utf8'
    );
    const threadIndicatorViewModelSource = readFileSync(
      new URL('../threadIndicatorViewModel.ts', import.meta.url),
      'utf8'
    );
    const threadIndicatorStyleSource = readFileSync(
      new URL('../ThreadIndicator.css.ts', import.meta.url),
      'utf8'
    );

    expect(replySource).toContain("from '../../mindroom/messages/replyExtensions'");
    expect(replySource).not.toContain("from '../../mindroom/threads/ThreadIndicator'");
    expect(replySource).not.toContain("from '../../mindroom/threads/useRoomEvent'");
    expect(replySource).not.toContain('useThreadResolution');
    expect(replySource).not.toContain('useThreadScheduledTasks');
    expect(replySource).not.toContain('getThreadUnread');
    expect(replyExtensionsSource).toContain("from '../threads/ThreadIndicator'");
    expect(replyExtensionsSource).toContain("from '../threads/useRoomEvent'");
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
      new URL('../../command-palette/commandPaletteItems.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../commandPaletteThreadItems.ts', import.meta.url),
      'utf8'
    );

    expect(paletteSource).toContain("from '../threads/commandPaletteThreadItems'");
    expect(paletteSource).not.toContain('MINDROOM_THREAD_TAGS_EVENT');
    expect(paletteSource).not.toContain('aggregateThreadTagEvents');
    expect(paletteSource).not.toContain('buildThreadRecord');
    expect(paletteSource).not.toContain('makeRecentThreadsAtom');
    expect(paletteSource).not.toContain('buildPerTagEventContent');
    expect(paletteSource).not.toContain('resolveCanonicalThreadRootId');
    expect(implementationSource).toContain('useMindroomCommandPaletteThreadItems');
    expect(implementationSource).toContain('MINDROOM_THREAD_TAGS_EVENT');
    expect(implementationSource).toContain("from './threadTagSnapshots'");
    expect(implementationSource).not.toContain('aggregateThreadTagEvents');
    expect(implementationSource).toContain('makeRecentThreadsAtom');
    expect(implementationSource).toContain('buildThreadRecord');
    expect(implementationSource).toContain('resolveCanonicalThreadRootId');
    expect(implementationSource).toContain('mergeCommandPaletteThreadItems');
  });

  it('keeps command-palette opener widgets in MindRoom command-palette', () => {
    const roomHeaderSource = readRoomViewHeaderSource();
    const sidebarSearchTabSource = readFileSync(
      new URL('../../../pages/client/sidebar/SearchTab.tsx', import.meta.url),
      'utf8'
    );
    const headerButtonSource = readFileSync(
      new URL('../../command-palette/MindroomCommandPaletteHeaderButton.tsx', import.meta.url),
      'utf8'
    );
    const sidebarTabSource = readFileSync(
      new URL('../../command-palette/MindroomCommandPaletteSidebarTab.tsx', import.meta.url),
      'utf8'
    );

    expect(roomHeaderSource).toContain('MindroomCommandPaletteHeaderButton');
    expect(roomHeaderSource).not.toContain('commandPaletteOpenAtom');
    expect(sidebarSearchTabSource).toContain('MindroomCommandPaletteSidebarTab as SearchTab');
    expect(sidebarSearchTabSource).not.toContain('commandPaletteOpenAtom');
    expect(headerButtonSource).toContain('commandPaletteOpenAtom');
    expect(sidebarTabSource).toContain('commandPaletteOpenAtom');
  });

  it('keeps cache-aware room event loading in MindRoom threads', () => {
    const hookImplementationSource = readFileSync(
      new URL('../useRoomEvent.ts', import.meta.url),
      'utf8'
    );
    const replySource = readFileSync(
      new URL('../../../components/message/Reply.tsx', import.meta.url),
      'utf8'
    );
    const pinMenuSource = readFileSync(
      new URL('../../messages/MindroomRoomPinMenu.tsx', import.meta.url),
      'utf8'
    );
    const pinMenuSeamSource = readFileSync(
      new URL('../../../features/room/room-pin-menu/RoomPinMenu.tsx', import.meta.url),
      'utf8'
    );
    const replyExtensionsSource = readFileSync(
      new URL('../../messages/replyExtensions.tsx', import.meta.url),
      'utf8'
    );
    const pinnedExtensionsSource = readFileSync(
      new URL('../../messages/pinnedMessageExtensions.ts', import.meta.url),
      'utf8'
    );

    expect(hookImplementationSource).toContain('loadCachedThreadEvent');
    expect(hookImplementationSource).toContain("from './eventRepository'");
    expect(replySource).toContain("from '../../mindroom/messages/replyExtensions'");
    expect(pinMenuSource).toContain("from './pinnedMessageExtensions'");
    expect(pinMenuSeamSource).toContain("from '../../../mindroom/messages/MindroomRoomPinMenu'");
    expect(pinMenuSeamSource).not.toContain('useMindroomPinnedEvent');
    expect(replySource).not.toContain("from '../../mindroom/threads/useRoomEvent'");
    expect(pinMenuSource).not.toContain("from '../threads/useRoomEvent'");
    expect(pinMenuSource).not.toContain('MINDROOM_PINNED_TOOL_APPROVAL_EVENT');
    expect(pinMenuSource).not.toContain('isMindroomPinnedToolApprovalEvent');
    expect(pinMenuSource).not.toContain('renderMindroomPinnedToolApprovalEvent');
    expect(replyExtensionsSource).toContain("from '../threads/useRoomEvent'");
    expect(pinnedExtensionsSource).toContain("from '../threads/useRoomEvent'");
    expect(pinnedExtensionsSource).toContain('getMindroomPinnedMessageRenderers');
    expect(pinnedExtensionsSource).toContain('renderMindroomPinnedEncryptedMessageEvent');
  });

  it('keeps room thread overview controls in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../RoomThreadOverview.tsx', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/RoomThreadOverview'");
    expect(implementationSource).toContain('RoomThreadOverviewProps');
    expect(implementationSource).toContain('FILTER_PRESETS');
  });

  it('keeps room thread overview model in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../roomThreadOverviewModel.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/roomThreadOverviewModel'");
    expect(implementationSource).toContain('createDefaultThreadFilterState');
    expect(implementationSource).not.toContain('buildThreadMetadataMap');
    expect(implementationSource).not.toContain('buildVisibleThreadRootData');
  });

  it('keeps thread relation and route utilities in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const utilitySource = readFileSync(new URL('../threadUtils.ts', import.meta.url), 'utf8');
    const routeSource = readFileSync(new URL('../threadRouteUtils.ts', import.meta.url), 'utf8');
    const eventOpenSource = readFileSync(
      new URL('../roomEventOpenController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useRoomEventOpenController');
    expect(eventOpenSource).toContain("from './threadUtils'");
    expect(utilitySource).toContain('getPreferredVisibleThreadReplyEvents');
    expect(routeSource).toContain('resolveCanonicalThreadRootId');
  });

  it('keeps thread render identity utilities in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../threadRenderUtils.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/threadRenderUtils'");
    expect(implementationSource).toContain('mergeThreadRenderEvents');
    expect(implementationSource).toContain('buildResolveConfirmedEventId');
    expect(implementationSource).toContain('isThreadOnlyRoomActivity');
  });

  it('keeps thread render state merging in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const timelineStateSource = readFileSync(
      new URL('../useThreadTimelineState.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../useThreadRenderState.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/useThreadTimelineState'");
    expect(source).not.toContain("from '../../mindroom/threads/useThreadRenderState'");
    expect(timelineStateSource).toContain("from './useThreadRenderState'");
    expect(implementationSource).toContain('setSupplementalThreadEvents');
    expect(implementationSource).toContain('mergeThreadRenderEvents');
  });

  it('keeps thread tag state and hooks in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const tagsSource = readFileSync(new URL('../threadTags.ts', import.meta.url), 'utf8');
    const hookSource = readFileSync(new URL('../useRoomThreadTags.ts', import.meta.url), 'utf8');
    const singleThreadHookSource = readFileSync(
      new URL('../useThreadTags.ts', import.meta.url),
      'utf8'
    );
    const mutateHookSource = readFileSync(
      new URL('../useMutateThreadTags.ts', import.meta.url),
      'utf8'
    );
    const tagSnapshotsSource = readFileSync(
      new URL('../threadTagSnapshots.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/useRoomThreadTags'");
    expect(tagsSource).toContain('aggregateThreadTagEvents');
    expect(hookSource).toContain('useRoomThreadResolutionMap');
    expect(hookSource).toContain("from './threadTagSnapshots'");
    expect(hookSource).not.toContain('aggregateThreadTagEvents');
    expect(singleThreadHookSource).toContain("from './threadTagSnapshots'");
    expect(singleThreadHookSource).not.toContain('aggregateThreadTagEvents');
    expect(mutateHookSource).toContain("from './threadTagSnapshots'");
    expect(mutateHookSource).not.toContain('aggregateThreadTagEvents');
    expect(tagSnapshotsSource).toContain('aggregateThreadTagEvents');
  });

  it('keeps thread banner and tag UI in MindRoom threads', () => {
    const roomViewSource = readRoomViewSource();
    const bannerSource = readFileSync(
      new URL('../ThreadContextBanner.tsx', import.meta.url),
      'utf8'
    );
    const pickerSource = readFileSync(new URL('../ThreadTagPicker.tsx', import.meta.url), 'utf8');

    expect(roomViewSource).toContain("from '../../mindroom/threads/ThreadContextBanner'");
    expect(bannerSource).toContain('buildThreadHeaderViewModelFromRecord');
    expect(pickerSource).toContain('normalizeTagName');
  });

  it('keeps room-view thread state orchestration in MindRoom threads', () => {
    const roomViewSource = readRoomViewSource();
    const implementationSource = readFileSync(
      new URL('../useRoomViewThreadState.ts', import.meta.url),
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
    const roomViewSource = readRoomViewSource();
    const roomViewThreadStateSource = readFileSync(
      new URL('../useRoomViewThreadState.ts', import.meta.url),
      'utf8'
    );
    // CINNY-207 P2.3: the standalone `threadSummaryCache.ts` shim was
    // deleted — its exports moved into the unified `./cacheStore`
    // module. Summary state (`threadSummaryState.ts`) and the facade
    // (`threadSummaryStore.ts`) still live here and consume the store
    // directly.
    const stateSource = readFileSync(new URL('../threadSummaryState.ts', import.meta.url), 'utf8');
    const storeSource = readFileSync(new URL('../threadSummaryStore.ts', import.meta.url), 'utf8');
    const publishControllerSource = readFileSync(
      new URL('../threadSummaryPublishController.ts', import.meta.url),
      'utf8'
    );
    const timelineSource = readRoomTimelineSource();

    expect(roomViewSource).toContain("from '../../mindroom/threads/useRoomViewThreadState'");
    expect(roomViewSource).not.toContain("from '../../mindroom/threads/useRoomThreadSummaryState'");
    expect(roomViewThreadStateSource).toContain("from './threadSummaryStore'");
    expect(timelineSource).toContain(
      "from '../../mindroom/threads/threadSummaryPublishController'"
    );
    expect(timelineSource).not.toContain('threadSummaryInfoMap.forEach');
    expect(storeSource).toContain("from './cacheStore'");
    expect(storeSource).toContain("from './threadSummaryState'");
    expect(storeSource).toContain("from './useRoomThreadSummaryState'");
    expect(stateSource).toContain("from './cacheStore'");
    expect(stateSource).toContain('storeThreadSummaryInState');
    expect(publishControllerSource).toContain('useThreadSummaryPublishController');
  });

  it('keeps MindRoom message primitives in the MindRoom namespace', () => {
    const renderContentSource = readFileSync(
      new URL('../../../components/RenderMessageContent.tsx', import.meta.url),
      'utf8'
    );
    const mindroomRenderContentSource = readFileSync(
      new URL('../../messages/renderMindroomMessageContent.tsx', import.meta.url),
      'utf8'
    );
    const messageIndexSource = readFileSync(
      new URL('../../../components/message/index.ts', import.meta.url),
      'utf8'
    );
    const msgTypeRenderersSource = readFileSync(
      new URL('../../../components/message/MsgTypeRenderers.tsx', import.meta.url),
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
    const removedGenericMessageOwnershipPaths = [
      '../../../components/message/messageExtrasData.ts',
      '../../../components/message/MindroomMessageExtras.tsx',
      '../../../components/message/MindroomMessageExtras.css.ts',
    ];
    const roomMessageSeamSource = readFileSync(
      new URL('../../../features/room/message/Message.tsx', import.meta.url),
      'utf8'
    );
    const mindroomMessageSource = readFileSync(
      new URL('../../messages/MindroomMessage.tsx', import.meta.url),
      'utf8'
    );
    const roomMessageStyleSource = readFileSync(
      new URL('../../../features/room/message/styles.css.ts', import.meta.url),
      'utf8'
    );
    const parserSource = readFileSync(
      new URL('../../../plugins/react-custom-html-parser.tsx', import.meta.url),
      'utf8'
    );
    const customHtmlPolicySource = readFileSync(
      new URL('../../html/customHtmlPolicy.ts', import.meta.url),
      'utf8'
    );
    const customHtmlRendererSource = readFileSync(
      new URL('../../html/customHtmlRenderers.tsx', import.meta.url),
      'utf8'
    );
    const matrixMathStyleSource = readFileSync(
      new URL('../../html/MatrixMath.css.ts', import.meta.url),
      'utf8'
    );
    const searchResultPreviewSource = readFileSync(
      new URL('../../message-search/searchResultPreview.ts', import.meta.url),
      'utf8'
    );
    const customHtmlStyleSource = readFileSync(
      new URL('../../../styles/CustomHtml.css.ts', import.meta.url),
      'utf8'
    );
    const roomUtilsSource = readFileSync(
      new URL('../../../utils/room.ts', import.meta.url),
      'utf8'
    );
    const streamingHookImplementationSource = readFileSync(
      new URL('../useThreadStreamingState.ts', import.meta.url),
      'utf8'
    );
    const threadSummarySource = readFileSync(
      new URL('../../messages/threadSummary.ts', import.meta.url),
      'utf8'
    );
    const toolApprovalSource = readFileSync(
      new URL('../../messages/toolApproval.ts', import.meta.url),
      'utf8'
    );
    const aiRunSource = readFileSync(new URL('../../messages/aiRun.ts', import.meta.url), 'utf8');
    const blocksSource = readFileSync(new URL('../../messages/blocks.ts', import.meta.url), 'utf8');
    const longTextSource = readFileSync(
      new URL('../../messages/longText.ts', import.meta.url),
      'utf8'
    );
    const searchResultPolicySource = readFileSync(
      new URL('../../messages/searchResultPolicy.ts', import.meta.url),
      'utf8'
    );
    const longTextDownloadSource = readFileSync(
      new URL('../../messages/longTextDownload.ts', import.meta.url),
      'utf8'
    );
    const toolTraceSource = readFileSync(
      new URL('../../messages/toolTrace.ts', import.meta.url),
      'utf8'
    );
    const htmlBlocksSource = readFileSync(
      new URL('../../messages/MindroomHtmlBlocks.tsx', import.meta.url),
      'utf8'
    );
    const htmlBlocksStyleSource = readFileSync(
      new URL('../../messages/MindroomHtmlBlocks.css.ts', import.meta.url),
      'utf8'
    );
    const threadSummaryCardSource = readFileSync(
      new URL('../../messages/MindroomThreadSummaryCard.tsx', import.meta.url),
      'utf8'
    );
    const messageControlsSource = readFileSync(
      new URL('../../messages/MindroomMessageControls.tsx', import.meta.url),
      'utf8'
    );
    const streamingIndicatorSource = readFileSync(
      new URL('../../messages/StreamingIndicator.tsx', import.meta.url),
      'utf8'
    );
    const messageExtensionsSource = readFileSync(
      new URL('../../messages/messageExtensions.tsx', import.meta.url),
      'utf8'
    );
    const threadBadgeSource = readFileSync(
      new URL('../ThreadBadgeRenderer.tsx', import.meta.url),
      'utf8'
    );
    const metadataSource = readFileSync(
      new URL('../../messages/metadata.ts', import.meta.url),
      'utf8'
    );
    const editMetadataSource = readFileSync(
      new URL('../../messages/editMetadata.ts', import.meta.url),
      'utf8'
    );
    const editResolutionSource = readFileSync(
      new URL('../../messages/editResolution.ts', import.meta.url),
      'utf8'
    );
    const messageExtrasSource = readFileSync(
      new URL('../../messages/messageExtrasData.ts', import.meta.url),
      'utf8'
    );
    const messageExtrasComponentSource = readFileSync(
      new URL('../../messages/MindroomMessageExtras.tsx', import.meta.url),
      'utf8'
    );

    expect(renderContentSource).toContain('../mindroom/messages/renderMindroomMessageContent');
    expect(renderContentSource).not.toContain('../mindroom/messages/threadSummary');
    expect(renderContentSource).not.toContain('../mindroom/messages/toolApproval');
    expect(renderContentSource).not.toContain('../mindroom/messages/MindroomToolApprovalCard');
    expect(renderContentSource).not.toContain('../mindroom/messages/longText');
    expect(renderContentSource).not.toContain('../mindroom/messages/MindroomLongTextText');
    expect(renderContentSource).not.toContain('../mindroom/messages/aiRun');
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
    expect(mindroomRenderContentSource).toContain('./StreamingIndicator');
    expect(mindroomRenderContentSource).toContain('./messageExtrasData');
    expect(mindroomRenderContentSource).toContain('./MindroomMessageExtras');
    expect(mindroomRenderContentSource).not.toContain('../../components/message/messageExtrasData');
    expect(mindroomRenderContentSource).not.toContain(
      '../../components/message/MindroomMessageExtras'
    );
    expect(mindroomRenderContentSource).toContain('renderMindroomStreamingIndicator');
    expect(mindroomRenderContentSource).toContain('withMindroomToolTraceMarkerParserOptions');
    expect(roomMessageSeamSource).toContain("from '../../../mindroom/messages/MindroomMessage'");
    expect(roomMessageSeamSource).not.toContain('useMindroomMessageExtensionState');
    expect(roomMessageSeamSource.trim().split('\n').length).toBeLessThan(20);
    expect(mindroomMessageSource).toContain("from './messageExtensions'");
    expect(mindroomMessageSource).not.toContain(
      "from '../../../mindroom/messages/messageCopyText'"
    );
    expect(mindroomMessageSource).not.toContain(
      "from '../../../mindroom/messages/MindroomMessageControls'"
    );
    expect(mindroomMessageSource).not.toContain("from '../../../mindroom/messages/longText'");
    expect(mindroomMessageSource).not.toContain(
      "from '../../../mindroom/messages/MindroomLongTextText'"
    );
    expect(mindroomMessageSource).not.toContain("from '../../../mindroom/messages/aiRun'");
    expect(mindroomMessageSource).not.toContain("from '../../../mindroom/messages/aiRunDisplay'");
    expect(mindroomMessageSource).not.toContain('getLongTextDownloadName');
    expect(mindroomMessageSource).not.toContain('downloadMindroomLongTextSidecarBlob');
    expect(mindroomMessageSource).not.toContain('getMindroomAiRunModelLabel');
    expect(roomMessageStyleSource).not.toContain('MessageAiRunInfoButton');
    expect(parserSource).toContain("from '../mindroom/html/customHtmlRenderers'");
    expect(parserSource).not.toContain("from '../mindroom/messages/blocks'");
    expect(parserSource).not.toContain("from '../mindroom/messages/toolTrace'");
    expect(parserSource).not.toContain('renderMindroomHtmlBlock');
    expect(parserSource).not.toContain('data-mindroom-paste-marker');
    expect(parserSource).not.toContain('data-mx-maths');
    expect(parserSource).not.toContain('MINDROOM_BLOCK_META');
    expect(parserSource).not.toContain('MindroomCollapsibleBlock');
    expect(searchResultPreviewSource).toContain("from '../messages/searchResultPolicy'");
    expect(searchResultPreviewSource).not.toContain("from '../messages/longText'");
    expect(searchResultPreviewSource).not.toContain("content?.['io.mindroom.long_text']");
    expect(roomUtilsSource).toContain("from '../mindroom/messages/editResolution'");
    expect(roomUtilsSource).not.toContain("from '../mindroom/messages/editMetadata'");
    expect(roomUtilsSource).not.toContain("from '../mindroom/messages/editDebug'");
    expect(roomUtilsSource).not.toContain("from '../mindroom/messages/metadata'");
    expect(roomUtilsSource).not.toContain("key.startsWith('io.mindroom.')");
    expect(roomUtilsSource).not.toContain("key.startsWith('com.mindroom.')");
    expect(customHtmlStyleSource).not.toContain('MindroomBlock');
    expect(customHtmlStyleSource).not.toContain('MindroomToolGroup');
    expect(customHtmlStyleSource).not.toContain('MathInline');
    expect(customHtmlStyleSource).not.toContain('MathBlock');
    expect(streamingHookImplementationSource).toContain("from '../messages/aiRun'");
    expect(streamingHookImplementationSource).toContain('STREAM_STATUS_KEY');
    expect(messageIndexSource).not.toContain(
      "from '../../mindroom/messages/MindroomThreadSummaryCard'"
    );
    expect(msgTypeRenderersSource).not.toContain('function MindroomThreadSummaryCard');
    expect(msgTypeRenderersSource).not.toContain('StreamingIndicator');
    expect(msgTypeRenderersSource).not.toContain('isStreaming');
    removedMessageCompatibilityPaths.forEach((path) => {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    });
    removedGenericMessageOwnershipPaths.forEach((path) => {
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
    expect(customHtmlPolicySource).toContain('data-mindroom-paste-marker');
    expect(customHtmlPolicySource).toContain('data-mx-maths');
    expect(customHtmlRendererSource).toContain('renderMindroomHtmlBlock');
    expect(customHtmlRendererSource).toContain('renderMatrixMathHtmlElement');
    expect(matrixMathStyleSource).toContain('MathInline');
    expect(matrixMathStyleSource).toContain('MathBlock');
    expect(htmlBlocksStyleSource).toContain('ToolGroupItem');
    expect(threadSummaryCardSource).toContain('MindroomThreadSummaryCard');
    expect(messageControlsSource).toContain('useMindroomMessageControls');
    expect(messageControlsSource).toContain('MindroomAiRunControls');
    expect(messageControlsSource).toContain('MindroomDownloadOriginalMenuItem');
    expect(messageControlsSource).toContain('downloadMindroomLongTextSidecarBlob');
    expect(streamingIndicatorSource).toContain('AI is responding');
    expect(streamingIndicatorSource).toContain('renderMindroomStreamingIndicator');
    expect(messageExtensionsSource).toContain("from './MindroomMessageControls'");
    expect(messageExtensionsSource).toContain("from './messageCopyText'");
    expect(messageExtensionsSource).toContain('MindroomMessageExtensionShell');
    expect(messageExtensionsSource).toContain('MindroomMessageMenuExtensions');
    expect(threadBadgeSource).toContain("from '../messages/MindroomThreadSummaryCard'");
    expect(threadBadgeSource).not.toContain('MindroomThreadSummaryCard, ThreadIndicator');
    expect(metadataSource).toContain('isMindroomMessageMetadataKey');
    expect(editMetadataSource).toContain('isMindroomMessageMetadataKey');
    expect(editResolutionSource).toContain("from './editDebug'");
    expect(editResolutionSource).toContain("from './editMetadata'");
    expect(messageExtrasSource).toContain('MINDROOM_MESSAGE_EXTRAS_KEY');
    expect(messageExtrasComponentSource).toContain('MindroomMessageExtras');
  });

  it('keeps Local MindRoom settings implementation in the MindRoom namespace', () => {
    const removedLocalMindroomCompatibilityPaths = [
      '../settings/local-mindroom/LocalMindroom.tsx',
      '../settings/local-mindroom/api.ts',
      '../settings/local-mindroom/index.ts',
      '../settings/local-mindroom/mindroom.ts',
    ];
    const settingsSource = readFileSync(
      new URL('../../../features/settings/Settings.tsx', import.meta.url),
      'utf8'
    );
    const settingsMenuSource = readFileSync(
      new URL('../../../features/settings/settingsMenu.ts', import.meta.url),
      'utf8'
    );
    const pageSource = readFileSync(
      new URL('../../local-mindroom/LocalMindroom.tsx', import.meta.url),
      'utf8'
    );
    const apiSource = readFileSync(new URL('../../local-mindroom/api.ts', import.meta.url), 'utf8');
    const helperSource = readFileSync(
      new URL('../../local-mindroom/mindroom.ts', import.meta.url),
      'utf8'
    );
    const settingsMenuItemSource = readFileSync(
      new URL('../../local-mindroom/settingsMenu.ts', import.meta.url),
      'utf8'
    );
    const settingsPageSource = readFileSync(
      new URL('../../local-mindroom/settingsPage.ts', import.meta.url),
      'utf8'
    );
    const settingsRendererSource = readFileSync(
      new URL('../../local-mindroom/settingsRenderer.tsx', import.meta.url),
      'utf8'
    );
    const settingsExtensionsSource = readFileSync(
      new URL('../../settings/settingsExtensions.tsx', import.meta.url),
      'utf8'
    );
    const settingsMenuExtensionsSource = readFileSync(
      new URL('../../settings/settingsMenuExtensions.ts', import.meta.url),
      'utf8'
    );
    const generalSettingsSource = readFileSync(
      new URL('../../../features/settings/general/General.tsx', import.meta.url),
      'utf8'
    );

    removedLocalMindroomCompatibilityPaths.forEach((path) => {
      expect(existsSync(new URL(path, import.meta.url))).toBe(false);
    });
    expect(settingsSource).toContain("from '../../mindroom/settings/settingsExtensions'");
    expect(settingsSource).not.toContain("from '../../mindroom/local-mindroom/LocalMindroom'");
    expect(settingsSource).not.toContain("from '../../mindroom/local-mindroom/settingsRenderer'");
    expect(settingsSource).not.toContain("from './local-mindroom'");
    expect(settingsMenuSource).toContain("from '../../mindroom/settings/settingsMenuExtensions'");
    expect(settingsMenuSource).not.toContain("from '../../mindroom/local-mindroom/settingsMenu'");
    expect(settingsMenuSource).not.toContain("from '../../mindroom/branding/branding'");
    expect(generalSettingsSource).toContain("from '../../../mindroom/settings/settingsExtensions'");
    expect(generalSettingsSource).not.toContain(
      "from '../../../mindroom/settings/MindroomMessagePreloadLimitSetting'"
    );
    expect(pageSource).toContain('Connect Local MindRoom');
    expect(pageSource).toContain('resolveMindroomProvisioningRequest');
    expect(apiSource).toContain('LOCAL_MINDROOM_API_PATH');
    expect(helperSource).toContain('getMindroomPairingCommand');
    expect(settingsMenuItemSource).toContain('getLocalMindroomSettingsMenuItem');
    expect(settingsMenuItemSource).toContain('MINDROOM_APP_NAME');
    expect(settingsPageSource).toContain('LOCAL_MINDROOM_SETTINGS_PAGE');
    expect(settingsRendererSource).toContain('renderLocalMindroomSettingsPage');
    expect(settingsRendererSource).toContain('LocalMindroom');
    expect(settingsExtensionsSource).toContain("from '../local-mindroom/settingsRenderer'");
    // CINNY-207 P6.1 / D4: the "Message Preload Limit" tile was replaced
    // by MindroomPrefetchSettings (scope + current-room depth). The
    // settings extension entry point now points at that instead.
    expect(settingsExtensionsSource).toContain('MindroomPrefetchSettings');
    expect(settingsMenuExtensionsSource).toContain("from '../local-mindroom/settingsMenu'");
    expect(settingsMenuExtensionsSource).toContain("from '../local-mindroom/settingsPage'");
    expect(settingsMenuExtensionsSource).not.toContain('MindroomMessagePreloadLimitSetting');
    expect(settingsMenuExtensionsSource).not.toContain('MindroomPrefetchSettings');
  });

  it('keeps the Local MindRoom sidebar shortcut in the MindRoom namespace', () => {
    const compatibilityPath = new URL(
      '../../pages/client/sidebar/MindroomTab.tsx',
      import.meta.url
    );
    const sidebarIndexSource = readFileSync(
      new URL('../../../pages/client/sidebar/index.ts', import.meta.url),
      'utf8'
    );
    const sidebarNavSource = readFileSync(
      new URL('../../../pages/client/SidebarNav.tsx', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../sidebar/MindroomTab.tsx', import.meta.url),
      'utf8'
    );

    expect(existsSync(compatibilityPath)).toBe(false);
    expect(sidebarIndexSource).not.toContain('MindroomTab');
    expect(sidebarNavSource).toContain("from '../../mindroom/sidebar/MindroomTab'");
    expect(implementationSource).toContain('Local MindRoom');
    expect(implementationSource).toContain('LOCAL_MINDROOM_SETTINGS_PAGE');
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
      new URL('../../../pages/client/home/Home.tsx', import.meta.url),
      'utf8'
    );
    const directSource = readFileSync(
      new URL('../../../pages/client/direct/Direct.tsx', import.meta.url),
      'utf8'
    );
    const spaceSource = readFileSync(
      new URL('../../../pages/client/space/Space.tsx', import.meta.url),
      'utf8'
    );
    const panelSource = readFileSync(
      new URL('../../recent-threads/RecentThreadsPanel.tsx', import.meta.url),
      'utf8'
    );
    const summarySource = readFileSync(
      new URL('../../recent-threads/recentThreadSummaryUtils.ts', import.meta.url),
      'utf8'
    );
    const threadRecordSource = readFileSync(new URL('../threadRecord.ts', import.meta.url), 'utf8');
    const stateSource = readFileSync(
      new URL('../../recent-threads/recentThreads.ts', import.meta.url),
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
      new URL('../../../components/BackRouteHandler.tsx', import.meta.url),
      'utf8'
    );
    const mindroomBackRouteHandlerSource = readFileSync(
      new URL('../../native/MindroomBackRouteHandler.tsx', import.meta.url),
      'utf8'
    );
    const roomViewSource = readRoomViewSource();
    const roomViewThreadStateSource = readFileSync(
      new URL('../useRoomViewThreadState.ts', import.meta.url),
      'utf8'
    );
    const systemNotificationSource = readFileSync(
      new URL('../../../features/settings/notifications/SystemNotification.tsx', import.meta.url),
      'utf8'
    );
    const systemNotificationExtensionsSource = readFileSync(
      new URL('../../notifications/SystemNotificationMindroomExtensions.tsx', import.meta.url),
      'utf8'
    );
    const nativeSsoSource = readFileSync(
      new URL('../../native/nativeSso.ts', import.meta.url),
      'utf8'
    );
    const iosPushSource = readFileSync(new URL('../../native/iosPush.ts', import.meta.url), 'utf8');
    const iosPushNotificationSource = readFileSync(
      new URL('../../native/IOSPushNotification.tsx', import.meta.url),
      'utf8'
    );
    const clientNonUiSource = readFileSync(
      new URL('../../../pages/client/ClientNonUIFeatures.tsx', import.meta.url),
      'utf8'
    );
    const mindroomClientNonUiSource = readFileSync(
      new URL('../../client/MindroomClientNonUIFeatures.tsx', import.meta.url),
      'utf8'
    );

    expect(backRouteHandlerSource).not.toContain("from '../mindroom/native/useEdgeSwipeBack'");
    expect(mindroomBackRouteHandlerSource).toContain("from './useEdgeSwipeBack'");
    expect(mindroomBackRouteHandlerSource).toContain("from '../../components/BackRouteHandler'");
    expect(roomViewSource).not.toContain("from '../../mindroom/native/useEdgeSwipeBack'");
    expect(roomViewSource).not.toContain("from '../../mindroom/native/useEdgeSwipeForward'");
    expect(roomViewThreadStateSource).toContain("from '../native/useEdgeSwipeBack'");
    expect(roomViewThreadStateSource).toContain("from '../native/useEdgeSwipeForward'");
    expect(roomViewThreadStateSource).toContain('useEdgeSwipeBack(handleExitThread');
    expect(roomViewThreadStateSource).toContain('useEdgeSwipeForward(');
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
    expect(clientNonUiSource).toContain("from '../../mindroom/client/MindroomClientNonUIFeatures'");
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
    const compatibilityPath = new URL('../../../../client/matrixClientFactory.ts', import.meta.url);
    const initMatrixSource = readFileSync(
      new URL('../../../../client/initMatrix.ts', import.meta.url),
      'utf8'
    );
    const authFlowsLoaderSource = readFileSync(
      new URL('../../../components/AuthFlowsLoader.tsx', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../../matrix/matrixClientFactory.ts', import.meta.url),
      'utf8'
    );

    expect(existsSync(compatibilityPath)).toBe(false);
    expect(initMatrixSource).toContain("from '../app/mindroom/matrix/matrixClientFactory'");
    expect(authFlowsLoaderSource).toContain("from '../mindroom/matrix/matrixClientFactory'");
    expect(implementationSource).toContain('createMatrixFetchFn');
    expect(implementationSource).toContain("credentials: 'include'");
  });

  it('keeps MindRoom branding and hosted-auth policy in the MindRoom namespace', () => {
    const brandingSource = readFileSync(
      new URL('../../branding/branding.ts', import.meta.url),
      'utf8'
    );
    const clientBrandingSource = readFileSync(
      new URL('../../branding/clientBranding.ts', import.meta.url),
      'utf8'
    );
    const authPolicySource = readFileSync(
      new URL('../../auth/authPolicy.ts', import.meta.url),
      'utf8'
    );
    const authUiSource = readFileSync(new URL('../../auth/authUi.ts', import.meta.url), 'utf8');
    const authFooterSource = readFileSync(
      new URL('../../../pages/auth/AuthFooter.tsx', import.meta.url),
      'utf8'
    );
    const authLayoutSource = readFileSync(
      new URL('../../../pages/auth/AuthLayout.tsx', import.meta.url),
      'utf8'
    );
    const particleBackgroundSource = readFileSync(
      new URL(
        '../../../components/particle-background/MindRoomParticleBackground.tsx',
        import.meta.url
      ),
      'utf8'
    );
    const particleBackgroundCssSource = readFileSync(
      new URL(
        '../../../components/particle-background/MindRoomParticleBackground.css.ts',
        import.meta.url
      ),
      'utf8'
    );
    const ssoLoginSource = readFileSync(
      new URL('../../../pages/auth/SSOLogin.tsx', import.meta.url),
      'utf8'
    );
    const loginSource = readFileSync(
      new URL('../../../pages/auth/login/Login.tsx', import.meta.url),
      'utf8'
    );
    const passwordLoginSource = readFileSync(
      new URL('../../../pages/auth/login/PasswordLoginForm.tsx', import.meta.url),
      'utf8'
    );
    const tokenLoginSource = readFileSync(
      new URL('../../../pages/auth/login/TokenLogin.tsx', import.meta.url),
      'utf8'
    );
    const registerSource = readFileSync(
      new URL('../../../pages/auth/register/Register.tsx', import.meta.url),
      'utf8'
    );
    const passwordRegisterSource = readFileSync(
      new URL('../../../pages/auth/register/PasswordRegisterForm.tsx', import.meta.url),
      'utf8'
    );
    const welcomePageSource = readFileSync(
      new URL('../../../pages/client/WelcomePage.tsx', import.meta.url),
      'utf8'
    );
    const clientRootSource = readFileSync(
      new URL('../../../pages/client/ClientRoot.tsx', import.meta.url),
      'utf8'
    );
    const configConfigSource = readFileSync(
      new URL('../../../pages/ConfigConfig.tsx', import.meta.url),
      'utf8'
    );
    const splashScreenSource = readFileSync(
      new URL('../../../components/splash-screen/SplashScreen.tsx', import.meta.url),
      'utf8'
    );
    const mindRoomSplashScreenSource = readFileSync(
      new URL('../../../components/splash-screen/MindRoomSplashScreen.tsx', import.meta.url),
      'utf8'
    );
    const specVersionsSource = readFileSync(
      new URL('../../../pages/client/SpecVersions.tsx', import.meta.url),
      'utf8'
    );
    const featureCheckSource = readFileSync(
      new URL('../../../pages/FeatureCheck.tsx', import.meta.url),
      'utf8'
    );
    const aboutSource = readFileSync(
      new URL('../../../features/settings/about/About.tsx', import.meta.url),
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
    expect(authLayoutSource).toContain("from '../../components/particle-background'");
    expect(authLayoutSource).toContain('<MindRoomParticleBackground />');
    expect(particleBackgroundSource).toContain("from '../../mindroom/branding/clientBranding'");
    expect(particleBackgroundSource).toContain('@basnijholt/particular-drift/react');
    expect(particleBackgroundSource).toContain("position?: 'absolute' | 'fixed'");
    expect(particleBackgroundSource).toContain("position = 'absolute'");
    expect(particleBackgroundCssSource).toContain("position: 'absolute'");
    expect(particleBackgroundCssSource).toContain('ParticleBackgroundFixed');
    expect(particleBackgroundCssSource).toContain("position: 'fixed'");
    expect(particleBackgroundSource).toContain('imageUrl={MINDROOM_CLIENT_BRANDING.logoSrc}');
    expect(particleBackgroundSource).toContain('resolveMindRoomParticleCount');
    expect(particleBackgroundSource).toContain("cursorMode: 'repel'");
    expect(particleBackgroundSource).toContain('DESKTOP_PARTICLE_COUNT = 80000');
    expect(particleBackgroundSource).toContain('LOW_END_PARTICLE_COUNT = 28000');
    expect(particleBackgroundSource).toContain('particleCount,');
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
    expect(splashScreenSource).toContain("from '../particle-background'");
    expect(splashScreenSource).toContain('background?: ReactNode');
    expect(splashScreenSource).toContain('const resolvedBackground =');
    expect(splashScreenSource).toContain('MindRoomParticleBackground');
    expect(splashScreenSource).toContain('position="fixed"');
    expect(splashScreenSource).not.toContain('patternsCSS.BackgroundDotPattern');
    expect(splashScreenSource).not.toContain("'../../styles/Patterns.css'");
    expect(splashScreenSource).not.toContain('"../../styles/Patterns.css"');
    expect(splashScreenSource).not.toContain("from '../../pages/auth/AuthParticleBackground'");
    expect(mindRoomSplashScreenSource).not.toContain("from '../particle-background'");
    expect(mindRoomSplashScreenSource).not.toContain('MindRoomParticleBackground');
    expect(mindRoomSplashScreenSource).not.toContain('background={<');
    expect(mindRoomSplashScreenSource).toContain('<SplashScreen>');
    expect(clientRootSource).toContain('MindRoomSplashScreen');
    expect(configConfigSource).toContain('MindRoomSplashScreen');
    expect(specVersionsSource).toContain('MindRoomSplashScreen');
    expect(featureCheckSource).toContain('<SplashScreen>');
    expect(splashScreenSource).not.toContain("from '../../mindroom/branding/branding'");
    expect(aboutSource).toContain("from '../../../mindroom/branding/clientBranding'");
    expect(aboutSource).not.toContain("from '../../../mindroom/branding/branding'");
    expect(loginSource).not.toContain("=== 'mindroom.chat'");
    expect(registerSource).not.toContain("=== 'mindroom.chat'");
  });

  it('pins viewport-cover and room app-height invariants', () => {
    const indexSource = readFileSync(new URL('../../../../../index.html', import.meta.url), 'utf8');
    const roomViewSource = readRoomViewSource();

    expect(indexSource).toContain('viewport-fit=cover');
    expect(roomViewSource).toContain("height: 'var(--app-height, 100%)'");
  });

  it('keeps thread root route canonicalization in MindRoom threads', () => {
    const roomViewSource = readRoomViewSource();
    const roomViewThreadStateSource = readFileSync(
      new URL('../useRoomViewThreadState.ts', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../useThreadRootEvent.ts', import.meta.url),
      'utf8'
    );

    expect(roomViewSource).toContain("from '../../mindroom/threads/useRoomViewThreadState'");
    expect(roomViewSource).not.toContain("from '../../mindroom/threads/useThreadRootEvent'");
    expect(roomViewThreadStateSource).toContain("from './useThreadRootEvent'");
    expect(implementationSource).toContain('resolveCanonicalThreadRootId');
    expect(implementationSource).toContain('RoomEvent.LocalEchoUpdated');
  });

  it('delegates overview resume refresh orchestration to MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const targetSource = readFileSync(
      new URL('../threadOverviewRefreshTargets.ts', import.meta.url),
      'utf8'
    );
    const controllerSource = readFileSync(
      new URL('../threadOverviewResumeController.ts', import.meta.url),
      'utf8'
    );
    const counterSource = readFileSync(
      new URL('../threadOverviewRefreshCounter.ts', import.meta.url),
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
    const source = readRoomTimelineSource();
    const controllerSource = readFileSync(
      new URL('../threadSortFreezeController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/threadSortFreezeController'");
    expect(source).not.toContain('orderedRootIds: activeLiveOverviewThreadRootIds');
    expect(controllerSource).toContain('useThreadSortFreezeController');
    expect(controllerSource).toContain('resolveThreadSortFreezeUpdate');
  });

  it('keeps room thread-list loading in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const listSource = readFileSync(new URL('../roomThreadList.ts', import.meta.url), 'utf8');
    const hookSource = readFileSync(new URL('../useRoomThreadList.ts', import.meta.url), 'utf8');
    const indexSource = readFileSync(
      new URL('../useMindroomThreadIndex.ts', import.meta.url),
      'utf8'
    );

    expect(source).not.toContain("from '../../mindroom/threads/useRoomThreadList'");
    expect(listSource).toContain('loadRoomThreads');
    expect(listSource).toContain('getThreadUnread');
    expect(hookSource).toContain('useRoomThreadList');
    expect(indexSource).toContain("from './useRoomThreadList'");
  });

  it('delegates compact root edit backfill orchestration to MindRoom threads', () => {
    const source = readRoomTimelineSource();

    expect(source).toContain('useCompactRootEditBackfillController');
    expect(source).toContain("from '../../mindroom/threads/compactRootEditBackfillController'");
    expect(source).not.toContain('compactRootEditFetchAttemptedRef');
    expect(source).not.toContain('getCompactRootEventsNeedingBackfill');
    expect(source).not.toContain('compactRootBackfill:start');
  });

  it('delegates thread edit backfill orchestration to MindRoom threads', () => {
    const source = readRoomTimelineSource();

    expect(source).toContain('useThreadEditBackfillController');
    expect(source).toContain("from '../../mindroom/threads/threadEditBackfillController'");
    expect(source).not.toContain('const loadMissingThreadEdits = async');
    expect(source).not.toContain('shouldFetchThreadEditBackfill');
    expect(source).not.toContain('markThreadEditBackfillAttempted');
    expect(source).not.toContain('threadBackfill:start');
  });

  it('keeps live collapsible-message policy in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const componentSource = readFileSync(
      new URL('../CollapsibleMessage.tsx', import.meta.url),
      'utf8'
    );
    const implementationSource = readFileSync(
      new URL('../threadCollapsibleMessages.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/CollapsibleMessage'");
    expect(source).not.toContain("from '../../components/CollapsibleMessage'");
    expect(componentSource).toContain('CollapsibleMessageCollapseMode');
    expect(source).toContain("from '../../mindroom/threads/threadCollapsibleMessages'");
    expect(implementationSource).toContain('shouldTrackLiveCollapsibleMessage');
    expect(implementationSource).toContain('getLiveCollapsibleMessageExpandId');
    expect(source).not.toContain('export const shouldTrackLiveCollapsibleMessage');
    expect(source).not.toContain('export const getCollapsibleMessageMode');
  });

  it('delegates thread prepend scroll primitives to scroll utilities', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../timelineScrollUtils.ts', import.meta.url),
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
    const source = readRoomTimelineSource();

    expect(source).toContain('useThreadBackPaginationController');
    expect(source).not.toContain('pendingThreadBackPaginationAnchorRef');
    expect(source).not.toContain('setThreadPaginatingBack');
  });

  it('delegates thread pagination commands to MindRoom threads', () => {
    const source = readRoomTimelineSource();

    expect(source).toContain('useThreadPaginationCommandController');
    expect(source).toContain("from '../../mindroom/threads/threadPaginationCommandController'");
    expect(source).not.toContain('const handleThreadPaginateBack = useCallback');
    expect(source).not.toContain('const handleThreadPaginateFront = useCallback');
    expect(source).not.toContain('threadPaginatingFrontRef');
  });

  it('keeps timeline debug helpers in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../timelineDebug.ts', import.meta.url),
      'utf8'
    );
    const controllerSource = readFileSync(
      new URL('../timelineDebugController.ts', import.meta.url),
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
      new URL('../eventCacheTokenUtils.ts', import.meta.url),
      'utf8'
    );

    expect(implementationSource).toContain('mergeCachedPaginationTokens');
    expect(implementationSource).toContain('compareCachedPaginationAnchors');
  });

  it('keeps event cache edit helpers in MindRoom threads', () => {
    const implementationSource = readFileSync(
      new URL('../eventCacheEditUtils.ts', import.meta.url),
      'utf8'
    );

    expect(implementationSource).toContain('hydrateCachedEvents');
    expect(implementationSource).toContain('serializeEventsForCache');
    expect(implementationSource).toContain('reconcileRelationEventsWithAggregation');
  });

  it('keeps raw event cache stores in MindRoom threads under cacheStore', () => {
    // CINNY-207 P2.3: the legacy `roomEventCache.ts` / `threadEventCache.ts`
    // shim modules were deleted. The unified `./cacheStore` module owns
    // the DB name and every read/write API. `eventRepository.ts` is the
    // only sanctioned consumer besides sessionCleanup and
    // threadSummaryState (encoded here as an allowlist).
    const legacyNamesSource = readFileSync(
      new URL('../cacheStore/legacyCacheDbNames.ts', import.meta.url),
      'utf8'
    );
    const cacheStoreBarrelSource = readFileSync(
      new URL('../cacheStore/index.ts', import.meta.url),
      'utf8'
    );
    const repositorySource = readFileSync(
      new URL('../eventRepository.ts', import.meta.url),
      'utf8'
    );

    expect(legacyNamesSource).toContain('mindroom-room-event-cache');
    expect(legacyNamesSource).toContain('mindroom-thread-event-cache');
    expect(cacheStoreBarrelSource).toContain("from './cacheStoreEvents'");
    expect(repositorySource).toContain("from './cacheStore'");
    expect(repositorySource).not.toContain("from './roomEventCache'");
    expect(repositorySource).not.toContain("from './threadEventCache'");
    expect(repositorySource).not.toContain('../../features/room/roomEventCache');
    expect(repositorySource).not.toContain('../../features/room/threadEventCache');
  });

  it('keeps thread pagination reconciliation helpers in MindRoom threads', () => {
    const implementationSource = readFileSync(
      new URL('../threadPaginationUtils.ts', import.meta.url),
      'utf8'
    );

    expect(implementationSource).toContain('computeReconciliationToken');
    expect(implementationSource).toContain('reconcileThreadBackwardPagination');
  });

  it('keeps timeline pagination helpers in MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const implementationSource = readFileSync(
      new URL('../timelinePagination.ts', import.meta.url),
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
    const source = readRoomTimelineSource();
    const controllerSource = readFileSync(
      new URL('../timelinePaginationController.ts', import.meta.url),
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
    const source = readRoomTimelineSource();
    const controllerSource = readFileSync(
      new URL('../timelineReadReceiptController.ts', import.meta.url),
      'utf8'
    );
    const readReceiptsSource = readFileSync(
      new URL('../../notifications/readReceipts.ts', import.meta.url),
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

  it('delegates room menu mark-read ownership to MindRoom notifications', () => {
    const headerSource = readRoomViewHeaderSource();
    const navItemSource = readFileSync(
      new URL('../../../features/room-nav/RoomNavItem.tsx', import.meta.url),
      'utf8'
    );
    const menuItemSource = readFileSync(
      new URL('../../notifications/MindroomMarkRoomReadMenuItem.tsx', import.meta.url),
      'utf8'
    );

    expect(headerSource).toContain('MindroomMarkRoomReadMenuItem');
    expect(navItemSource).toContain('MindroomMarkRoomReadMenuItem');
    expect(headerSource).not.toContain('markRoomAndThreadsAsRead');
    expect(navItemSource).not.toContain('markRoomAndThreadsAsRead');
    expect(menuItemSource).toContain('markRoomAndThreadsAsRead');
    expect(menuItemSource).toContain("from './readReceipts'");
  });

  it('delegates page and sidebar list mark-read ownership to MindRoom notifications', () => {
    const pageSources = [
      new URL('../../../pages/client/home/Home.tsx', import.meta.url),
      new URL('../../../pages/client/direct/Direct.tsx', import.meta.url),
      new URL('../../../pages/client/space/Space.tsx', import.meta.url),
      new URL('../../../pages/client/sidebar/HomeTab.tsx', import.meta.url),
      new URL('../../../pages/client/sidebar/DirectTab.tsx', import.meta.url),
      new URL('../../../pages/client/sidebar/SpaceTabs.tsx', import.meta.url),
    ].map((url) => readFileSync(url, 'utf8'));
    const menuItemSource = readFileSync(
      new URL('../../notifications/MindroomMarkRoomsReadMenuItem.tsx', import.meta.url),
      'utf8'
    );

    pageSources.forEach((source) => {
      expect(source).toContain('MindroomMarkRoomsReadMenuItem');
      expect(source).not.toContain('markRoomAndThreadsAsRead');
    });
    expect(menuItemSource).toContain('markRoomAndThreadsAsRead');
    expect(menuItemSource).toContain("from './readReceipts'");
  });

  it('delegates notification-list room mark-read ownership to MindRoom notifications', () => {
    const notificationsSource = readFileSync(
      new URL('../../../pages/client/inbox/Notifications.tsx', import.meta.url),
      'utf8'
    );
    const chipSource = readFileSync(
      new URL('../../notifications/MindroomMarkRoomReadChip.tsx', import.meta.url),
      'utf8'
    );

    expect(notificationsSource).toContain('MindroomMarkRoomReadChip');
    expect(notificationsSource).not.toContain('markRoomAndThreadsAsRead');
    expect(chipSource).toContain('markRoomAndThreadsAsRead');
    expect(chipSource).toContain("from './readReceipts'");
  });

  it('delegates route focus and thread-open scroll effects to MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const controllerSource = readFileSync(
      new URL('../roomFocusScrollController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain('useRoomFocusScrollController');
    expect(source).not.toContain('pendingRoomFocusRef');
    expect(source).not.toContain('setupFocusObserver');
    expect(source).not.toContain('getRoomFocusScrollOptions');
    expect(source).not.toContain('shouldPinThreadToBottomOnOpen');
    expect(controllerSource).toContain('setupFocusObserver');
    expect(controllerSource).toContain('shouldPinThreadToBottomOnOpen');
  });

  it('delegates room jump and thread-card navigation handlers to MindRoom threads', () => {
    const source = readRoomTimelineSource();
    const controllerSource = readFileSync(
      new URL('../roomTimelineNavigationController.ts', import.meta.url),
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
    const source = readRoomTimelineSource();
    const subscriptionSource = readFileSync(
      new URL('../roomLiveEventArrive.ts', import.meta.url),
      'utf8'
    );
    const controllerSource = readFileSync(
      new URL('../roomLiveRenderController.ts', import.meta.url),
      'utf8'
    );

    expect(source).toContain("from '../../mindroom/threads/roomLiveRenderController'");
    expect(source).not.toContain('const useLiveEventArrive');
    expect(source).not.toContain('EventTimelineSetHandlerMap');
    expect(source).not.toContain('getLiveCollapsibleMessageExpandId');
    expect(source).not.toContain('room-thread-cache-persist-paginated');
    expect(controllerSource).toContain('useRoomLiveRenderController');
    expect(controllerSource).toContain('useLiveEventArrive');
    expect(controllerSource).toContain("from './roomLocalEchoRefresh'");
    expect(controllerSource).toContain('useRoomLocalEchoRefresh');
    expect(controllerSource).toContain('getLiveCollapsibleMessageExpandId');
    expect(controllerSource).toContain('room-thread-cache-persist-paginated');
    expect(subscriptionSource).toContain('useLiveEventArrive');
    expect(subscriptionSource).toContain('RoomEvent.Redaction');
  });

  it('delegates room cache pagination commands to MindRoom threads', () => {
    const source = readRoomTimelineSource();

    expect(source).toContain('useRoomPaginationCommandController');
    expect(source).toContain("from '../../mindroom/threads/roomPaginationCommandController'");
    expect(source).not.toContain('loadRoomCachedPaginationSnapshot');
    expect(source).not.toContain('resolveHydratedRoomBeforeToken');
    expect(source).not.toContain('THREAD_RELATION_TYPE');
  });

  it('keeps thread-open seed cache in the MindRoom thread namespace', () => {
    const source = readRoomTimelineSource();
    const lifecycleSource = readFileSync(
      new URL('../threadOpenLifecycleController.ts', import.meta.url),
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
    const source = readRoomTimelineSource();
    const hydrationControllerSource = readFileSync(
      new URL('../roomCacheHydrationController.ts', import.meta.url),
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
    const source = readRoomTimelineSource();
    const paginationControllerSource = readFileSync(
      new URL('../roomPaginationCommandController.ts', import.meta.url),
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

// CINNY-207 plan section 6.4: Phase 1 regression guards. Source-scan style,
// matching this file's idiom — behavioral coverage lives in the dedicated
// unit suites (RoomTimeline.cache.test.ts, eventCacheEditUtils.test.ts,
// and the engine suites at src/app/mindroom/engine/).
//
// The P1.1 room-cache persist sweep guard was removed in P3.3: the sweep
// itself is deleted; O(1)-per-live-event writes are now enforced
// structurally by the engine's per-event write-through (no bulk
// re-serialization codepath exists). Live-event coverage is asserted in
// `engine/engineWriteThrough.compaction.test.ts` and
// `engine/__tests__/engineAllRoomsCoverage.test.ts`.
describe('CINNY-207 Phase 1 cache guards', () => {
  it('keeps the cache write boundary rejecting standalone same-sender m.replace records (P1.4)', () => {
    const serializerSource = readFileSync(
      new URL('../eventCacheEditUtils.ts', import.meta.url),
      'utf8'
    );

    expect(serializerSource).toContain('isStandaloneSameSenderReplace');
    expect(serializerSource).toMatch(/if \(isStandaloneSameSenderReplace\(mEvent, eventById\)\) return;/);
  });
});
