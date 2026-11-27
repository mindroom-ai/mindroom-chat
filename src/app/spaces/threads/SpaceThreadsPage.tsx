import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { MatrixClient, Room } from 'matrix-js-sdk';
import { reportBoundaryError } from '../../bug-reports/error-reporting/errorReporting';
import {
  addTagFilter,
  applyFrozenThreadOrder,
  applyThreadSearchQuery,
  createDefaultThreadFilterState,
  createThreadSortControlSignature,
  removeTagFilter,
  resetThreadFilterState,
  selectThreadWorkflowTab,
  showsFilteredEmptyState,
  type ThreadFilterState,
  type ThreadSortFreezeState,
} from '../../event-store/threads/roomThreadOverviewModel';
import { toggleThreadPerson } from '../../event-store/threads/threadPeopleFilter';
import { isConfirmedMatrixEventId } from '../../event-store/threads/threadRouteUtils';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import { usePinnedEventIdsByRoom } from '../../event-store/threads/useThreadPinning';
import { useIgnoredUsers } from '../../matrix/hooks/useIgnoredUsers';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useSpace } from '../../matrix/hooks/useSpace';
import { getRoomThreadMode } from '../../matrix/protocol/roomThreadMode';
import { createSessionId } from '../../matrix/session/sessions';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { chatRoomParentsAtom, roomToParentsAtom } from '../../matrix/state/roomToParents';
import {
  clearActivePhoneSwipeContext,
  setActivePhoneSwipeContext,
} from '../../navigation/phonePageSlide';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { settingsAtom } from '../../preferences/settings';
import { useSetting } from '../../preferences/useSetting';
import {
  crossRoomThreadIndexAtom,
  getCrossRoomThreadIndexKey,
} from '../../threads/cross-room/crossRoomThreadIndex';
import { getThreadSignalsReader } from '../../threads/cross-room/threadSignalsReader';
import { getCompactRoomSectionsAtom } from '../../threads/overview/compactRoomSections';
import { roomThreadFilterAtomFamily } from '../../threads/overview/roomThreadFilterState';
import { RoomThreadOverview } from '../../threads/overview/RoomThreadOverview';
import { ThreadPeopleFilter } from '../../threads/overview/ThreadPeopleFilter';
import { useThreadSortFreezeController } from '../../threads/overview/threadSortFreezeController';
import { useSnoozeNow } from '../../threads/tags/useSnoozeNow';
import { Page } from '../../ui/page/Page';
import type { ScrollAnchorMemory } from '../../ui/scrollAnchorMemory';
import { SpaceRoomFilter } from './SpaceRoomFilter';
import { SpaceThreadComposer } from './SpaceThreadComposer';
import { SpaceThreadsHeader } from './SpaceThreadsHeader';
import {
  SpaceThreadsList,
  SpaceThreadsNotice,
  type SpaceThreadsEmptyKey,
} from './SpaceThreadsList';
import {
  buildSpaceRoomFilterGroups,
  collectSpaceThreadEntries,
  filterAndSortSpaceThreads,
  pruneSpaceRoomSelection,
  toggleSpaceRoomGroupSelection,
  toggleSpaceRoomSelection,
} from './spaceThreadsModel';
import { useSpaceThreadsRooms } from './useSpaceThreadsRooms';
import * as css from './SpaceThreads.css';

const MAX_TIMEOUT_MS = 2 ** 31 - 1;
const EMPTY_PINNED_KEYS: readonly string[] = [];
const spaceThreadsScrollMemories = new WeakMap<MatrixClient, ScrollAnchorMemory>();
const getSpaceThreadsScrollMemory = (mx: MatrixClient): ScrollAnchorMemory => {
  let memory = spaceThreadsScrollMemories.get(mx);
  if (!memory) spaceThreadsScrollMemories.set(mx, (memory = new Map()));
  return memory;
};

function SpaceThreadsPageContent({ space }: { space: Room }) {
  const mx = useMatrixClient();
  const myUserId = mx.getSafeUserId();
  const sessionId = useMemo(() => createSessionId(mx.getHomeserverUrl(), myUserId), [mx, myUserId]);
  const ignoredUsers = useIgnoredUsers();
  const ignoredUsersSet = useMemo(() => new Set(ignoredUsers), [ignoredUsers]);
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const pageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const context = { sessionId, roomId: space.roomId, isSpaceThreads: true };
    setActivePhoneSwipeContext(context);
    return () => clearActivePhoneSwipeContext(context);
  }, [sessionId, space.roomId]);

  const {
    spaceRooms,
    roomsById,
    rooms,
    orderedRoomIds,
    hasMindroomAgents,
    threadListsSettled,
    metaVersion,
    timelineTick,
  } = useSpaceThreadsRooms(space.roomId);

  const [threadSortFreezeState, setThreadSortFreezeState] = useState<ThreadSortFreezeState | null>(
    null
  );

  const indexSnapshot = useAtomValue(crossRoomThreadIndexAtom);
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const directRoomIds = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const chatRooms = useAtomValue(chatRoomParentsAtom);
  const [simpleMode] = useSetting(settingsAtom, 'simpleThreadFilters');
  const [storedFilterState, setFilterState] = useAtom(
    useMemo(() => roomThreadFilterAtomFamily(myUserId, space.roomId), [myUserId, space.roomId])
  );
  const defaultFilterState = useMemo(() => createDefaultThreadFilterState(), []);
  const filterState = storedFilterState ?? defaultFilterState;
  const [compactSections, updateCompactSections] = useAtom(
    useMemo(() => getCompactRoomSectionsAtom(myUserId), [myUserId])
  );
  const sectionsEnabled = hasMindroomAgents && compactSections.on;
  const pinnedByRoom = usePinnedEventIdsByRoom(spaceRooms);
  const pinnedKeys = useMemo(() => {
    if (!sectionsEnabled || pinnedByRoom.size === 0) return EMPTY_PINNED_KEYS;
    const keys: string[] = [];
    pinnedByRoom.forEach((ids, roomId) => {
      for (let i = ids.length - 1; i >= 0; i -= 1) {
        keys.push(getCrossRoomThreadIndexKey(roomId, ids[i]!));
      }
    });
    return keys;
  }, [pinnedByRoom, sectionsEnabled]);
  const [quietClock, setQuietClock] = useState(() => ({
    enabled: sectionsEnabled,
    now: Date.now(),
  }));
  if (quietClock.enabled !== sectionsEnabled) {
    setQuietClock({
      enabled: sectionsEnabled,
      now: sectionsEnabled ? Date.now() : quietClock.now,
    });
  }

  const storedSelectedRoomIds = useMemo(
    () => (filterState.rooms?.length ? new Set(filterState.rooms) : undefined),
    [filterState.rooms]
  );
  const effectiveSelectedRoomIds = useMemo(
    () => pruneSpaceRoomSelection(storedSelectedRoomIds, orderedRoomIds),
    [orderedRoomIds, storedSelectedRoomIds]
  );
  const memberLookupRooms = useMemo(() => {
    if (!effectiveSelectedRoomIds) return rooms.map((item) => item.room);
    const active: Room[] = [];
    const rest: Room[] = [];
    rooms.forEach((item) => {
      if (effectiveSelectedRoomIds.has(item.room.roomId)) active.push(item.room);
      else rest.push(item.room);
    });
    return [...active, ...rest];
  }, [effectiveSelectedRoomIds, rooms]);
  const roomFilterGroups = useMemo(
    () =>
      buildSpaceRoomFilterGroups({
        mx,
        spaceId: space.roomId,
        roomsById,
        orderedRoomIds,
        joinedRoomIds,
        directs: directRoomIds,
        roomToParents,
        chatRooms,
      }),
    [
      chatRooms,
      directRoomIds,
      joinedRoomIds,
      mx,
      orderedRoomIds,
      roomToParents,
      roomsById,
      space.roomId,
    ]
  );
  const activeRoomIds = useMemo(
    () =>
      effectiveSelectedRoomIds
        ? orderedRoomIds.filter((roomId) => effectiveSelectedRoomIds.has(roomId))
        : orderedRoomIds,
    [effectiveSelectedRoomIds, orderedRoomIds]
  );

  const allSpaceEntries = useMemo(() => {
    void timelineTick;
    return collectSpaceThreadEntries(indexSnapshot.entries, spaceRooms, myUserId, ignoredUsersSet);
  }, [ignoredUsersSet, indexSnapshot.entries, myUserId, spaceRooms, timelineTick]);
  const snoozeNow = useSnoozeNow(
    useMemo(() => allSpaceEntries.map((entry) => entry.snoozedUntilTs), [allSpaceEntries])
  );
  const quietNow = Math.max(snoozeNow, quietClock.now);

  const result = useMemo(
    () =>
      filterAndSortSpaceThreads({
        entries: allSpaceEntries,
        roomsById,
        selectedRoomIds: effectiveSelectedRoomIds,
        filterState,
        simpleMode,
        snoozeNow,
        quietNow,
        hasMindroomAgents,
        groupSections: sectionsEnabled,
        pinnedKeys,
        signalsOf: sectionsEnabled
          ? (entry) => {
              const room = roomsById.get(entry.roomId)?.room;
              return room
                ? getThreadSignalsReader(mx).read(room, entry, myUserId, quietNow)
                : undefined;
            }
          : undefined,
      }),
    [
      allSpaceEntries,
      effectiveSelectedRoomIds,
      filterState,
      hasMindroomAgents,
      mx,
      myUserId,
      pinnedKeys,
      quietNow,
      roomsById,
      sectionsEnabled,
      simpleMode,
      snoozeNow,
    ]
  );

  const nextQuietWakeTs = result.nextQuietWakeTs;
  useEffect(() => {
    if (!sectionsEnabled || nextQuietWakeTs === undefined) return undefined;
    const timer = setTimeout(
      () => setQuietClock({ enabled: true, now: Date.now() }),
      Math.max(0, Math.min(nextQuietWakeTs - Date.now(), MAX_TIMEOUT_MS))
    );
    return () => clearTimeout(timer);
  }, [nextQuietWakeTs, quietClock.now, sectionsEnabled]);

  const sortControlSignature = useMemo(
    () =>
      `${createThreadSortControlSignature({
        state: result.effectiveFilterState,
        viewMode: 'compact',
      })}|${activeRoomIds.join(',')}`,
    [activeRoomIds, result.effectiveFilterState]
  );
  const effectiveSortFreezeState =
    hasMindroomAgents && !simpleMode && !sectionsEnabled ? threadSortFreezeState : null;
  useThreadSortFreezeController({
    activeLiveOverviewThreadRootIds: result.orderedKeys,
    setThreadSortFreezeState,
    threadId: undefined,
    threadSortControlSignature: sortControlSignature,
    threadSortFreezeState: effectiveSortFreezeState,
  });
  const displayKeys = useMemo(
    () =>
      effectiveSortFreezeState && effectiveSortFreezeState.controlSignature === sortControlSignature
        ? applyFrozenThreadOrder(effectiveSortFreezeState.orderedRootIds, result.orderedKeys)
        : result.orderedKeys,
    [effectiveSortFreezeState, result.orderedKeys, sortControlSignature]
  );

  const updateFilter = useCallback(
    (mutate: (prev: ThreadFilterState) => ThreadFilterState) =>
      setFilterState((prev) => mutate(prev ?? defaultFilterState)),
    [defaultFilterState, setFilterState]
  );
  const updateRoomSelection = useCallback(
    (
      mutate: (
        current: ReadonlySet<string> | undefined,
        allRoomIds: readonly string[]
      ) => Set<string> | undefined
    ) =>
      updateFilter((prev) => {
        const current = pruneSpaceRoomSelection(
          prev.rooms?.length ? new Set(prev.rooms) : undefined,
          orderedRoomIds
        );
        const next = mutate(current, orderedRoomIds);
        return { ...prev, rooms: next ? [...next].sort() : undefined };
      }),
    [orderedRoomIds, updateFilter]
  );
  const handleOpenThread = useCallback(
    (roomId: string, threadRootId: string) =>
      navigateRoomThread(roomId, threadRootId, undefined, { returnToOrigin: true }),
    [navigateRoomThread]
  );
  const handleThreadCreated = useCallback(
    (roomId: string, eventId: string) => {
      if (getRoomThreadMode(mx.getRoom(roomId)) === 'room') {
        if (isConfirmedMatrixEventId(eventId)) navigateRoom(roomId, eventId);
        else navigateRoom(roomId);
        return;
      }
      navigateRoomThread(roomId, eventId, undefined, { returnToOrigin: true });
    },
    [mx, navigateRoom, navigateRoomThread]
  );

  const singleBucketTab: ThreadWorkflowBucket | undefined =
    result.effectiveFilterState.tab && result.effectiveFilterState.tab !== 'all'
      ? result.effectiveFilterState.tab
      : undefined;
  const isSettled = indexSnapshot.bootstrapped && threadListsSettled;
  const showLoading = !isSettled && result.scopedTotalCount === 0;
  const overviewShowsFilteredEmpty = showsFilteredEmptyState(
    displayKeys.length,
    result.scopedTotalCount,
    result.effectiveFilterState
  );
  const emptyKey: SpaceThreadsEmptyKey | undefined = showLoading
    ? undefined
    : spaceRooms.length === 0
      ? 'no-rooms'
      : allSpaceEntries.length === 0
        ? 'no-threads'
        : displayKeys.length === 0 && !overviewShowsFilteredEmpty
          ? 'no-matching'
          : undefined;

  return (
    <Page ref={pageRef} data-space-threads-page={space.roomId}>
      <SpaceThreadsHeader
        space={space}
        activeRoomCount={activeRoomIds.length}
        totalRoomCount={spaceRooms.length}
        showSpaceSwitcher
      />

      <div className={css.PageBody}>
        {spaceRooms.length > 0 && (
          <div className={css.OverviewSlot}>
            <RoomThreadOverview
              roomsFilter={
                <SpaceRoomFilter
                  rooms={rooms}
                  roomCounts={result.roomCounts}
                  selectedRoomIds={effectiveSelectedRoomIds}
                  groups={roomFilterGroups}
                  onSelectAll={() => updateFilter((prev) => ({ ...prev, rooms: undefined }))}
                  onToggleRoom={(id) =>
                    updateRoomSelection((current, allRoomIds) =>
                      toggleSpaceRoomSelection(current, id, allRoomIds)
                    )
                  }
                  onToggleRoomGroup={(groupRoomIds) =>
                    updateRoomSelection((current, allRoomIds) =>
                      toggleSpaceRoomGroupSelection(current, groupRoomIds, allRoomIds)
                    )
                  }
                />
              }
              peopleFilter={
                <ThreadPeopleFilter
                  rooms={memberLookupRooms}
                  records={result.scopedRecords}
                  selected={result.effectiveFilterState.people}
                  onToggle={(userId) =>
                    updateFilter((prev) => ({
                      ...prev,
                      people: toggleThreadPerson(prev.people, userId),
                    }))
                  }
                  onClear={() => updateFilter((prev) => ({ ...prev, people: undefined }))}
                />
              }
              roomId={space.roomId}
              hasMindroomAgents={hasMindroomAgents}
              threadCount={displayKeys.length}
              totalThreadCount={result.scopedTotalCount}
              statusCounts={result.statusCounts}
              bucketCounts={result.bucketCounts}
              countsSettled={isSettled}
              onSelectTab={(tab) => updateFilter((prev) => selectThreadWorkflowTab(prev, tab))}
              tagCounts={result.tagCounts}
              state={result.effectiveFilterState}
              availableTags={Object.keys(result.tagCounts)}
              isThreadSortFrozen={Boolean(effectiveSortFreezeState)}
              onSortDirectionChange={() => {
                setThreadSortFreezeState(null);
                updateFilter((prev) => ({
                  ...prev,
                  sortBy: 'lastReply',
                  sortDirection: prev.sortDirection === 'desc' ? 'asc' : 'desc',
                }));
              }}
              onToggleThreadSortFreeze={() =>
                setThreadSortFreezeState((cur) =>
                  cur
                    ? null
                    : {
                        controlSignature: sortControlSignature,
                        orderedRootIds: result.orderedKeys,
                      }
                )
              }
              onToggleUnresolvedOnly={() =>
                updateFilter((prev) => ({
                  ...prev,
                  resolved: prev.resolved === 'exclude' ? 'any' : 'exclude',
                }))
              }
              onToggleForMe={() => updateFilter((prev) => ({ ...prev, forMe: !prev.forMe }))}
              onReset={() => setFilterState(resetThreadFilterState())}
              onAddTag={(tag) => updateFilter((prev) => addTagFilter(prev, tag))}
              onRemoveTag={(tag) => updateFilter((prev) => removeTagFilter(prev, tag))}
              onClearTags={() => updateFilter((prev) => ({ ...prev, tags: new Map() }))}
              onSearchQueryChange={(query) =>
                updateFilter((prev) => applyThreadSearchQuery(prev, query, hasMindroomAgents))
              }
              threadSections={sectionsEnabled}
              onToggleThreadSections={
                hasMindroomAgents
                  ? () => updateCompactSections({ type: 'SET_ON', on: !compactSections.on })
                  : undefined
              }
            />
          </div>
        )}

        <SpaceThreadsList
          entryKeys={displayKeys}
          entryByKey={result.entryByKey}
          sections={sectionsEnabled ? result.sections : undefined}
          foldedSections={compactSections.folded}
          singleBucketTab={singleBucketTab}
          onToggleSectionFold={(id) => updateCompactSections({ type: 'TOGGLE_FOLD', id })}
          roomsById={roomsById}
          pinnedByRoom={pinnedByRoom}
          showRoomBadge={activeRoomIds.length > 1}
          snoozeNow={snoozeNow}
          metaVersion={metaVersion}
          showLoading={showLoading}
          emptyKey={emptyKey}
          scrollMemory={getSpaceThreadsScrollMemory(mx)}
          scrollMemoryKey={space.roomId}
          indexPending={!isSettled}
          onOpenThread={handleOpenThread}
        />

        {spaceRooms.length > 0 && (
          <SpaceThreadComposer
            spaceId={space.roomId}
            rooms={rooms}
            roomsById={roomsById}
            activeRoomIds={activeRoomIds}
            fileDropContainerRef={pageRef}
            onThreadCreated={handleThreadCreated}
          />
        )}
      </div>
    </Page>
  );
}

export function SpaceThreadsPage() {
  const space = useSpace();
  const { t } = useTranslation();
  return (
    <ErrorBoundary
      key={space.roomId}
      fallback={
        <Page>
          <SpaceThreadsHeader space={space} />
          <div className={css.ThreadListScroll}>
            <SpaceThreadsNotice message={t('spaceThreads.error.title')} />
          </div>
        </Page>
      }
      onError={(error: unknown, info) => reportBoundaryError(error, info.componentStack)}
    >
      <SpaceThreadsPageContent space={space} />
    </ErrorBoundary>
  );
}
