import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text } from 'folds';
import { ErrorBoundary } from 'react-error-boundary';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { RoomEvent, type Room } from 'matrix-js-sdk';
import { reportBoundaryError } from '../../bug-reports/error-reporting/errorReporting';
import {
  addTagFilter,
  applyFrozenThreadOrder,
  createDefaultThreadFilterState,
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
import { hasActiveMindroomAgent } from '../../matrix/protocol/agentIdentity';
import { useSpaceNavigationRooms } from '../../matrix/state/useSpaceSearchRooms';
import { useRoomNavigate } from '../../navigation/useRoomNavigate';
import { settingsAtom } from '../../preferences/settings';
import { useSetting } from '../../preferences/useSetting';
import {
  crossRoomThreadIndexAtom,
  type CrossRoomThreadIndexEntry,
} from '../../threads/cross-room/crossRoomThreadIndex';
import { getCompactRoomSectionsAtom } from '../../threads/overview/compactRoomSections';
import * as compactCss from '../../threads/overview/CompactRoomView.css';
import { roomThreadFilterAtomFamily } from '../../threads/overview/roomThreadFilterState';
import { RoomThreadOverview } from '../../threads/overview/RoomThreadOverview';
import { useSnoozeNow } from '../../threads/tags/useSnoozeNow';
import { revealDirectionControls } from '../../ui/directional';
import { Page } from '../../ui/page/Page';
import { SpaceRoomFilterBar } from './SpaceRoomFilterBar';
import { SpaceThreadComposer } from './SpaceThreadComposer';
import { SpaceThreadsHeader } from './SpaceThreadsHeader';
import { SpaceThreadsList } from './SpaceThreadsList';
import {
  collectSpaceThreadEntries,
  filterAndSortSpaceThreads,
  getRoomAccentColor,
  resolveActiveSpaceRoomIds,
  selectOnlySpaceRoom,
  toggleSpaceRoomSelection,
} from './spaceThreadsModel';
import * as css from './SpaceThreads.css';

function SpaceThreadsPageContent({ space }: { space: Room }) {
  const mx = useMatrixClient();
  const myUserId = mx.getSafeUserId();
  const { navigateRoomThread } = useRoomNavigate();
  const pageRef = useRef<HTMLDivElement>(null);

  const spaceIdOrAlias = getCanonicalAliasOrRoomId(mx, space.roomId);
  const spaceRoomIdList = useSpaceNavigationRooms(space.roomId);
  const spaceRooms = useMemo(
    () => spaceRoomIdList.map((id) => mx.getRoom(id)).filter((room): room is Room => Boolean(room)),
    [mx, spaceRoomIdList]
  );

  const roomMeta = useMemo(() => {
    const ids = new Set<string>();
    const byId = new Map<string, Room>();
    const nameById = new Map<string, string>();
    const accentById = new Map<string, string>();
    const orderedIds: string[] = [];
    const composerRooms = spaceRooms.map((room) => {
      const name = revealDirectionControls(room.name || room.roomId);
      const accentColor = getRoomAccentColor(room.roomId);
      ids.add(room.roomId);
      byId.set(room.roomId, room);
      nameById.set(room.roomId, name);
      accentById.set(room.roomId, accentColor);
      orderedIds.push(room.roomId);
      return { room, name, accentColor };
    });
    return { ids, byId, nameById, accentById, orderedIds, composerRooms };
  }, [spaceRooms]);

  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string> | undefined>(undefined);
  const [frozenKeys, setFrozenKeys] = useState<string[] | null>(null);
  const [timelineTick, setTimelineTick] = useState(0);

  useEffect(() => {
    setSelectedRoomIds(undefined);
    setFrozenKeys(null);
  }, [space.roomId]);

  useEffect(() => {
    const bump = () => setTimelineTick((tick) => tick + 1);
    spaceRooms.forEach((room) => {
      room.on?.(RoomEvent.Timeline, bump);
      room.on?.(RoomEvent.LocalEchoUpdated, bump);
    });
    return () => {
      spaceRooms.forEach((room) => {
        room.removeListener?.(RoomEvent.Timeline, bump);
        room.removeListener?.(RoomEvent.LocalEchoUpdated, bump);
      });
    };
  }, [spaceRooms]);

  const indexSnapshot = useAtomValue(crossRoomThreadIndexAtom);
  const [simpleMode] = useSetting(settingsAtom, 'simpleThreadFilters');
  const [storedFilterState, setFilterState] = useAtom(
    useMemo(() => roomThreadFilterAtomFamily(myUserId, space.roomId), [myUserId, space.roomId])
  );
  const filterState = storedFilterState ?? createDefaultThreadFilterState();
  const [compactSections, updateCompactSections] = useAtom(
    useMemo(() => getCompactRoomSectionsAtom(myUserId), [myUserId])
  );
  const hasMindroomAgents = useMemo(
    () => spaceRooms.some((room) => hasActiveMindroomAgent(room.getMembers?.() ?? [])),
    [spaceRooms]
  );
  const sectionsEnabled = hasMindroomAgents && compactSections.on;

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
        selectedRoomIds,
        filterState,
        simpleMode,
        snoozeNow,
        hasMindroomAgents,
        roomNameById: roomMeta.nameById,
        groupSections: sectionsEnabled,
      }),
    [
      allSpaceEntries,
      filterState,
      hasMindroomAgents,
      roomMeta.ids,
      roomMeta.nameById,
      sectionsEnabled,
      selectedRoomIds,
      simpleMode,
      snoozeNow,
    ]
  );

  const displayEntries = useMemo(() => {
    if (!frozenKeys || sectionsEnabled) return result.entries;
    const byKey = new Map(result.entries.map((entry) => [entry.key, entry] as const));
    return applyFrozenThreadOrder(
      frozenKeys,
      result.entries.map((entry) => entry.key)
    )
      .map((key) => byKey.get(key))
      .filter((entry): entry is CrossRoomThreadIndexEntry => Boolean(entry));
  }, [frozenKeys, result.entries, sectionsEnabled]);

  const activeRoomIds = resolveActiveSpaceRoomIds(roomMeta.orderedIds, selectedRoomIds);
  const updateFilter = useCallback(
    (mutate: (prev: ThreadFilterState) => ThreadFilterState) =>
      setFilterState((prev) => mutate(prev ?? createDefaultThreadFilterState())),
    [setFilterState]
  );
  const handleOpenThread = useCallback(
    (roomId: string, threadRootId: string) => navigateRoomThread(roomId, threadRootId),
    [navigateRoomThread]
  );

  const singleBucketTab: ThreadWorkflowBucket | undefined =
    !simpleMode && result.effectiveFilterState.tab && result.effectiveFilterState.tab !== 'all'
      ? result.effectiveFilterState.tab
      : undefined;
  const showLoading = !indexSnapshot.bootstrapped && result.entries.length === 0;
  const emptyKey = showLoading
    ? undefined
    : spaceRooms.length === 0
    ? 'no-rooms'
    : result.scopedTotalCount === 0
    ? 'no-threads'
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
          selectedRoomIds={selectedRoomIds}
          onSelectAll={() => setSelectedRoomIds(undefined)}
          onToggleRoom={(id) =>
            setSelectedRoomIds((cur) => toggleSpaceRoomSelection(cur, id, roomMeta.orderedIds))
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
            countsSettled={indexSnapshot.bootstrapped}
            onSelectTab={(tab) => updateFilter((prev) => selectThreadWorkflowTab(prev, tab))}
            tagCounts={result.tagCounts}
            state={result.effectiveFilterState}
            availableTags={result.availableTags}
            isThreadSortFrozen={Boolean(frozenKeys)}
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
            spaceId={space.roomId}
            rooms={roomMeta.composerRooms}
            activeRoomIds={activeRoomIds}
            fileDropContainerRef={pageRef}
            onThreadCreated={handleOpenThread}
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
      fallback={
        <Page>
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
      <SpaceThreadsPageContent space={space} />
    </ErrorBoundary>
  );
}
