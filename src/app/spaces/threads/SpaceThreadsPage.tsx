import { useCallback, useMemo, useRef, useState } from 'react';
import { Text } from 'folds';
import { ErrorBoundary } from 'react-error-boundary';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { reportBoundaryError } from '../../bug-reports/error-reporting/errorReporting';
import {
  addTagFilter,
  applyFrozenThreadOrder,
  createDefaultThreadFilterState,
  hasActiveThreadFilters,
  normalizeThreadSearchText as normalizeOverviewSearchText,
  removeTagFilter,
  resetThreadFilterState,
  selectThreadWorkflowTab,
  type ThreadFilterState,
} from '../../event-store/threads/roomThreadOverviewModel';
import {
  applyParsedThreadFilterQuery,
  parseThreadFilterQuery,
} from '../../event-store/threads/threadFilterDsl';
import type { ThreadWorkflowBucket } from '../../event-store/threads/threadWorkflow';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useSpace } from '../../matrix/hooks/useSpace';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { getRoomThreadMode } from '../../matrix/protocol/roomThreadMode';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { settingsAtom } from '../../preferences/settings';
import { useSetting } from '../../preferences/useSetting';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import { getThreadSignalsReader } from '../../threads/cross-room/threadSignalsReader';
import { getCompactRoomSectionsAtom } from '../../threads/overview/compactRoomSections';
import * as compactCss from '../../threads/overview/CompactRoomView.css';
import { roomThreadFilterAtomFamily } from '../../threads/overview/roomThreadFilterState';
import { RoomThreadOverview } from '../../threads/overview/RoomThreadOverview';
import { useSnoozeNow } from '../../threads/tags/useSnoozeNow';
import { Page } from '../../ui/page/Page';
import { SpaceRoomFilterBar } from './SpaceRoomFilterBar';
import { SpaceThreadComposer } from './SpaceThreadComposer';
import { SpaceThreadsHeader } from './SpaceThreadsHeader';
import { SpaceThreadsList, type SpaceThreadsEmptyKey } from './SpaceThreadsList';
import {
  collectSpaceThreadEntries,
  filterAndSortSpaceThreads,
  pruneSpaceRoomSelection,
  resolveActiveSpaceRoomIds,
  selectOnlySpaceRoom,
  toggleSpaceRoomSelection,
} from './spaceThreadsModel';
import { useSpaceThreadsRooms } from './useSpaceThreadsRooms';
import * as css from './SpaceThreads.css';

function SpaceThreadsPageContent({ space }: { space: Room }) {
  const mx = useMatrixClient();
  const myUserId = mx.getSafeUserId();
  const { navigateRoom, navigateRoomThread } = useRoomNavigate();
  const pageRef = useRef<HTMLDivElement>(null);

  const spaceIdOrAlias = getCanonicalAliasOrRoomId(mx, space.roomId);
  const { spaceRooms, roomMeta, hasMindroomAgents, threadListsSettled, timelineTick } =
    useSpaceThreadsRooms(space.roomId);

  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string> | undefined>(undefined);
  const [frozenKeys, setFrozenKeys] = useState<string[] | null>(null);

  const indexSnapshot = useAtomValue(crossRoomThreadIndexAtom);
  const [simpleMode] = useSetting(settingsAtom, 'simpleThreadFilters');
  const [storedFilterState, setFilterState] = useAtom(
    useMemo(() => roomThreadFilterAtomFamily(myUserId, space.roomId), [myUserId, space.roomId])
  );
  const filterState = storedFilterState ?? createDefaultThreadFilterState();
  const [compactSections, updateCompactSections] = useAtom(
    useMemo(() => getCompactRoomSectionsAtom(myUserId), [myUserId])
  );
  const sectionsEnabled = hasMindroomAgents && compactSections.on;

  const effectiveSelectedRoomIds = useMemo(
    () => pruneSpaceRoomSelection(selectedRoomIds, roomMeta.orderedIds),
    [roomMeta.orderedIds, selectedRoomIds]
  );
  const activeRoomIds = useMemo(
    () => resolveActiveSpaceRoomIds(roomMeta.orderedIds, effectiveSelectedRoomIds),
    [effectiveSelectedRoomIds, roomMeta.orderedIds]
  );

  const allSpaceEntries = useMemo(() => {
    void timelineTick;
    return collectSpaceThreadEntries(indexSnapshot.entries, spaceRooms, roomMeta.ids, myUserId);
  }, [indexSnapshot.entries, myUserId, roomMeta.ids, spaceRooms, timelineTick]);
  const snoozeNow = useSnoozeNow(
    useMemo(() => allSpaceEntries.map((entry) => entry.snoozedUntilTs), [allSpaceEntries])
  );

  const result = useMemo(
    () =>
      filterAndSortSpaceThreads({
        entries: allSpaceEntries,
        spaceRoomIds: roomMeta.ids,
        selectedRoomIds: effectiveSelectedRoomIds,
        filterState,
        simpleMode,
        snoozeNow,
        hasMindroomAgents,
        roomNameById: roomMeta.nameById,
        groupSections: sectionsEnabled,
        signalsOf: sectionsEnabled
          ? (entry) => {
              const room = roomMeta.byId.get(entry.roomId);
              return room
                ? getThreadSignalsReader(mx).read(room, entry, myUserId, snoozeNow)
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
      roomMeta.byId,
      roomMeta.ids,
      roomMeta.nameById,
      sectionsEnabled,
      simpleMode,
      snoozeNow,
    ]
  );

  const effectiveFrozenKeys =
    hasMindroomAgents && !simpleMode && !sectionsEnabled ? frozenKeys : null;
  const displayEntries = useMemo(() => {
    if (!effectiveFrozenKeys) return result.entries;
    const byKey = new Map(result.entries.map((entry) => [entry.key, entry] as const));
    return applyFrozenThreadOrder(
      effectiveFrozenKeys,
      result.entries.map((entry) => entry.key)
    )
      .map((key) => byKey.get(key))
      .filter((entry): entry is CrossRoomThreadIndexEntry => Boolean(entry));
  }, [effectiveFrozenKeys, result.entries]);

  const updateFilter = useCallback(
    (mutate: (prev: ThreadFilterState) => ThreadFilterState) =>
      setFilterState((prev) => mutate(prev ?? createDefaultThreadFilterState())),
    [setFilterState]
  );
  const handleOpenThread = useCallback(
    (roomId: string, threadRootId: string) => navigateRoomThread(roomId, threadRootId),
    [navigateRoomThread]
  );
  const handleThreadCreated = useCallback(
    (roomId: string, eventId: string) =>
      getRoomThreadMode(mx.getRoom(roomId)) === 'room'
        ? navigateRoom(roomId, eventId)
        : navigateRoomThread(roomId, eventId),
    [mx, navigateRoom, navigateRoomThread]
  );

  const singleBucketTab: ThreadWorkflowBucket | undefined =
    !simpleMode && result.effectiveFilterState.tab && result.effectiveFilterState.tab !== 'all'
      ? result.effectiveFilterState.tab
      : undefined;
  const showLoading = !indexSnapshot.bootstrapped && result.entries.length === 0;
  const overviewShowsFilteredEmpty =
    result.scopedTotalCount > 0 &&
    displayEntries.length === 0 &&
    hasActiveThreadFilters(result.effectiveFilterState);
  const emptyKey: SpaceThreadsEmptyKey | undefined = showLoading
    ? undefined
    : spaceRooms.length === 0
    ? 'no-rooms'
    : allSpaceEntries.length === 0
    ? 'no-threads'
    : displayEntries.length === 0 && !overviewShowsFilteredEmpty
    ? 'no-matching'
    : undefined;

  return (
    <Page ref={pageRef} data-space-threads-page={space.roomId}>
      <SpaceThreadsHeader
        space={space}
        spaceIdOrAlias={spaceIdOrAlias}
        activeRoomCount={activeRoomIds.length}
        totalRoomCount={spaceRooms.length}
      />

      <div className={css.PageBody}>
        <SpaceRoomFilterBar
          rooms={roomMeta.composerRooms.map(({ room, name, accentColor }) => ({
            roomId: room.roomId,
            name,
            count: result.roomCounts.get(room.roomId) ?? 0,
            accentColor,
          }))}
          totalCount={allSpaceEntries.length}
          selectedRoomIds={effectiveSelectedRoomIds}
          onSelectAll={() => setSelectedRoomIds(undefined)}
          onToggleRoom={(id) =>
            setSelectedRoomIds(
              toggleSpaceRoomSelection(effectiveSelectedRoomIds, id, roomMeta.orderedIds)
            )
          }
          onSelectOnlyRoom={(id) =>
            setSelectedRoomIds(selectOnlySpaceRoom(id, roomMeta.orderedIds))
          }
        />

        {spaceRooms.length > 0 && (
          <RoomThreadOverview
            roomId={space.roomId}
            hasMindroomAgents={hasMindroomAgents}
            threadCount={displayEntries.length}
            totalThreadCount={result.scopedTotalCount}
            statusCounts={result.statusCounts}
            bucketCounts={result.bucketCounts}
            countsSettled={indexSnapshot.bootstrapped && threadListsSettled}
            onSelectTab={(tab) => updateFilter((prev) => selectThreadWorkflowTab(prev, tab))}
            tagCounts={result.tagCounts}
            state={result.effectiveFilterState}
            availableTags={result.availableTags}
            isThreadSortFrozen={Boolean(effectiveFrozenKeys)}
            onSortDirectionChange={() =>
              updateFilter((prev) => ({
                ...prev,
                sortBy: 'lastReply',
                sortDirection: prev.sortDirection === 'desc' ? 'asc' : 'desc',
              }))
            }
            onToggleThreadSortFreeze={() =>
              setFrozenKeys((cur) => (cur ? null : result.entries.map((entry) => entry.key)))
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
              updateFilter((prev) =>
                hasMindroomAgents
                  ? applyParsedThreadFilterQuery(prev, parseThreadFilterQuery(query))
                  : { ...prev, freeText: normalizeOverviewSearchText(query), unsupportedQuery: '' }
              )
            }
            threadSections={sectionsEnabled}
            onToggleThreadSections={
              hasMindroomAgents
                ? () => updateCompactSections({ type: 'SET_ON', on: !compactSections.on })
                : undefined
            }
          />
        )}

        <SpaceThreadsList
          entries={displayEntries}
          sections={result.sections}
          sectionsEnabled={sectionsEnabled}
          foldedSections={compactSections.folded}
          singleBucketTab={singleBucketTab}
          onToggleSectionFold={(id) => updateCompactSections({ type: 'TOGGLE_FOLD', id })}
          roomById={roomMeta.byId}
          roomNameById={roomMeta.nameById}
          roomAccentById={roomMeta.accentById}
          showRoomBadge={activeRoomIds.length > 1}
          snoozeNow={snoozeNow}
          showLoading={showLoading}
          emptyKey={emptyKey}
          onOpenThread={handleOpenThread}
        />

        {spaceRooms.length > 0 && (
          <SpaceThreadComposer
            rooms={roomMeta.composerRooms}
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
  const mx = useMatrixClient();
  const space = useSpace();
  const { t } = useTranslation();
  const spaceIdOrAlias = getCanonicalAliasOrRoomId(mx, space.roomId);
  return (
    <ErrorBoundary
      fallback={
        <Page>
          <SpaceThreadsHeader space={space} spaceIdOrAlias={spaceIdOrAlias} />
          <div className={css.ThreadListScroll}>
            <div className={compactCss.EmptyState}>
              <Text size="T300" priority="400">
                {t('spaceThreads.error.title')}
              </Text>
            </div>
          </div>
        </Page>
      }
      onError={(error: unknown, info) => reportBoundaryError(error, info.componentStack)}
      resetKeys={[space.roomId]}
    >
      <SpaceThreadsPageContent key={space.roomId} space={space} />
    </ErrorBoundary>
  );
}
