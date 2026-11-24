import { Fragment, type MouseEventHandler, useCallback, useMemo, useReducer, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { KnownMembership, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { NavCategory } from '../../ui/nav/NavItem';
import { useCategoryHandler } from '../../ui/nav/useCategoryHandler';
import { useClosedNavCategoriesAtom } from '../../ui/nav/useClosedNavCategories';
import { type RoomSortMode, useRoomOrders } from '../room-nav/roomOrder';
import {
  type ActivityTrackedSection,
  getRoomActivityTimestamp,
  orderRoomsForMode,
  useRoomActivityListener,
} from '../room-nav/roomActivity';
import {
  SortableRoomList,
  SortableRoomRow,
  useRoomSectionDrop,
} from '../room-nav/SortableRoomList';
import { RoomNavItem } from '../room-nav/RoomNavItem';
import { SubRoomRows, type SubRoomTree, buildSubRoomList } from '../room-nav/SubRoomRows';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../matrix/hooks/useRoomsNotificationPreferences';
import { useStateEventCallback } from '../../matrix/hooks/useStateEventCallback';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { useVisibleRooms } from '../../matrix/state/archivedRooms';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { chatRoomParentsAtom, roomToParentsAtom } from '../../matrix/state/roomToParents';
import { StateEvent } from '../../matrix/types/room';
import { getSpaceRoomPath } from '../../routes/pathUtils';
import { getSpaceSearchRooms } from '../../matrix/state/useSpaceSearchRooms';
import { sortRoomIdsByName } from '../../lib/nameOrder';
import { useForceUpdate } from '../../lib/hooks/useForceUpdate';
import { matchesEnum } from '../../lib/matchesEnum';
import { canSendState, moveSpaceRoom } from '../../spaces/lobby/spaceChildren';
import {
  type SpaceRoomSection as SpaceRoomSectionData,
  collectShortcutRoomIds,
  getDescendantSubspaces,
  getSpaceRoomSections,
} from './spaceRoomSections';
import { SpaceSectionHeader, type SubspaceSortOptions } from './SpaceSectionHeader';

export type RenderedSpaceRoomSection = SpaceRoomSectionData & {
  closed: boolean;
  tree: SubRoomTree;
  orderedTop: string[];
  shownRoomIds: string[];
  listedRoomIds: string[];
  mode: RoomSortMode;
  showTimes: boolean;
  inheritFrom: readonly string[] | undefined;
  sort?: SubspaceSortOptions;
};

const walkChain = (
  start: string | undefined,
  exclude: string,
  nextOf: (id: string) => string | undefined
): string[] => {
  const chain: string[] = [];
  const seen = new Set<string>([exclude]);
  let cur = start;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = nextOf(cur);
  }
  return chain;
};

const inheritsFromSpace = (
  section: Pick<RenderedSpaceRoomSection, 'spaceId' | 'inheritFrom'>,
  targetSpaceId: string,
  hasExplicitMode: (listId: string) => boolean
): boolean => {
  if (section.spaceId === targetSpaceId || hasExplicitMode(section.spaceId)) return false;
  const targetIndex = section.inheritFrom?.indexOf(targetSpaceId) ?? -1;
  if (targetIndex < 0) return false;
  return section
    .inheritFrom!.slice(0, targetIndex)
    .every((ancestorId) => !hasExplicitMode(ancestorId));
};

const collectInheritedOrders = (
  sections: readonly Pick<RenderedSpaceRoomSection, 'spaceId' | 'inheritFrom' | 'orderedTop'>[],
  targetSpaceId: string,
  hasExplicitMode: (listId: string) => boolean
): Record<string, readonly string[]> | undefined => {
  const inherited: Record<string, readonly string[]> = {};
  sections.forEach((section) => {
    if (
      section.orderedTop.length > 0 &&
      inheritsFromSpace(section, targetSpaceId, hasExplicitMode)
    ) {
      inherited[section.spaceId] = section.orderedTop;
    }
  });
  return Object.keys(inherited).length > 0 ? inherited : undefined;
};

export type SpaceSortControl = {
  mode: RoomSortMode;
  showTimes: boolean;
  hasSavedOrder: boolean;
  setMode: (mode: RoomSortMode) => void;
  setShowTimes: (show: boolean) => void;
};

/**
 * Derives a space's visible rooms, inline collapsible room/sub-space sections, shortcut order,
 * per-space and per-sub-space sort controls, live activity sorting, and drag-and-drop handlers.
 */
export function useSpaceRoomSections(
  spaceId: string,
  selectedRoomId: string | undefined,
  parentSpaceId?: string
) {
  const client = useMatrixClient();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const visibleJoinedRoomIds = useVisibleRooms(joinedRoomIds);
  const directRoomIds = useAtomValue(mDirectAtom);
  const roomToParents = useAtomValue(roomToParentsAtom);
  const chatRooms = useAtomValue(chatRoomParentsAtom);
  const closedCategoriesAtom = useClosedNavCategoriesAtom();
  const [closedCategories, setClosedCategories] = useAtom(closedCategoriesAtom);
  const isCategoryClosed = (categoryId: string) => closedCategories.has(categoryId);
  const onCategoryClick = useCategoryHandler(setClosedCategories, isCategoryClosed);

  const joinedRoomSet = useMemo(() => new Set(joinedRoomIds), [joinedRoomIds]);
  const descendantSubspaces = useMemo(
    () => getDescendantSubspaces(client, spaceId, joinedRoomIds, roomToParents),
    [client, spaceId, joinedRoomIds, roomToParents]
  );
  const trackedSpaceIds = useMemo(
    () => new Set([spaceId, ...descendantSubspaces]),
    [spaceId, descendantSubspaces]
  );
  const [powerLevelsVersion, refreshPowerLevels] = useForceUpdate();
  const handlePowerLevelsChange = useCallback(
    (event: MatrixEvent) => {
      if (
        matchesEnum(event.getType(), StateEvent.RoomPowerLevels) &&
        trackedSpaceIds.has(event.getRoomId() ?? '')
      ) {
        refreshPowerLevels();
      }
    },
    [trackedSpaceIds, refreshPowerLevels]
  );
  useStateEventCallback(client, handlePowerLevelsChange);

  const canEditSpace = useCallback(
    (targetSpaceId: string): boolean => {
      void powerLevelsVersion;
      if (!joinedRoomSet.has(targetSpaceId)) return false;
      const room = client.getRoom(targetSpaceId);
      return (
        room !== null &&
        matchesEnum(room.getMyMembership(), KnownMembership.Join) &&
        canSendState(client, room, StateEvent.SpaceChild)
      );
    },
    [client, joinedRoomSet, powerLevelsVersion]
  );

  // Mark as Read covers the rooms of the sub-spaces too; each section shows its space's own rooms
  // with their chat sub-rooms.
  const spaceRooms = useMemo(
    () => getSpaceSearchRooms(client, spaceId, visibleJoinedRoomIds, directRoomIds, roomToParents),
    [client, spaceId, visibleJoinedRoomIds, directRoomIds, roomToParents]
  );
  const spaceRoomsByName = useMemo(
    () => sortRoomIdsByName(client, spaceRooms),
    [client, spaceRooms]
  );
  const rawSections = useMemo(
    () =>
      getSpaceRoomSections(
        client,
        spaceId,
        joinedRoomIds,
        visibleJoinedRoomIds,
        spaceRoomsByName,
        directRoomIds,
        roomToParents,
        chatRooms,
        canEditSpace
      ),
    [
      client,
      spaceId,
      joinedRoomIds,
      visibleJoinedRoomIds,
      spaceRoomsByName,
      directRoomIds,
      roomToParents,
      chatRooms,
      canEditSpace,
    ]
  );
  const roomOrders = useRoomOrders();
  const [activityVersion, bumpActivity] = useReducer((count: number) => count + 1, 0);

  const rootAncestors = useMemo(
    () =>
      walkChain(parentSpaceId, spaceId, (id) =>
        [...(roomToParents.get(id) ?? [])].find(
          (parentId) =>
            joinedRoomSet.has(parentId) && Boolean(client.getRoom(parentId)?.isSpaceRoom())
        )
      ),
    [client, joinedRoomSet, parentSpaceId, roomToParents, spaceId]
  );

  const sectionsRef = useRef<RenderedSpaceRoomSection[]>([]);
  const sections = useMemo<RenderedSpaceRoomSection[]>(() => {
    void activityVersion;
    return rawSections.map((section) => {
      const closed = closedCategories.has(section.categoryId);
      const chain = [...new Set([...section.ancestorSpaceIds, ...rootAncestors])].filter(
        (id) => id !== section.spaceId
      );
      const inheritFrom = chain.length > 0 ? chain : undefined;
      const mode = roomOrders.modeOf(section.spaceId, inheritFrom);
      const showTimes = roomOrders.showTimesOf(section.spaceId, inheritFrom);
      const list = buildSubRoomList(
        section.ownRoomsByName,
        section.scopeRoomsByName,
        roomToParents,
        chatRooms,
        (top, tree) =>
          orderRoomsForMode(
            client,
            mode,
            top,
            (ids) => roomOrders.orderOf(section.spaceId, ids),
            tree
          ),
        closed,
        selectedRoomId
      );
      const sort: SubspaceSortOptions | undefined = section.isRoot
        ? undefined
        : {
            mode,
            inheritedMode: inheritFrom
              ? roomOrders.modeOf(inheritFrom[0]!, inheritFrom.slice(1))
              : 'name',
            overridden: roomOrders.hasExplicitMode(section.spaceId),
            showTimes,
            hasSavedOrder: roomOrders.hasSavedOrder(section.spaceId),
            onModeChange: (nextMode) =>
              roomOrders.setMode(
                section.spaceId,
                nextMode,
                list.orderedTop,
                nextMode === 'manual'
                  ? collectInheritedOrders(
                      sectionsRef.current,
                      section.spaceId,
                      roomOrders.hasExplicitMode
                    )
                  : undefined
              ),
            onShowTimesChange: (show) =>
              roomOrders.setShowTimes(section.spaceId, show, inheritFrom),
            onResetOverride: () => roomOrders.resetSubspaceOverride(section.spaceId),
          };
      return { ...section, closed, ...list, mode, showTimes, inheritFrom, sort };
    });
  }, [
    activityVersion,
    client,
    rawSections,
    rootAncestors,
    closedCategories,
    roomToParents,
    chatRooms,
    roomOrders,
    selectedRoomId,
  ]);

  const trackedSections = useMemo<ActivityTrackedSection[]>(
    () =>
      sections.map((section) => ({
        recent: section.mode === 'recent',
        showTimes: section.showTimes,
        baseTop: section.tree.top,
        orderedTop: section.orderedTop,
        tree: section.tree,
        trackedRoomIds: new Set(section.shownRoomIds),
      })),
    [sections]
  );
  useRoomActivityListener(trackedSections, bumpActivity);

  const shortcutRoomIds = useMemo(() => collectShortcutRoomIds(sections), [sections]);

  const movingRoomIdsRef = useRef(new Set<string>());
  const roomOrdersRef = useRef(roomOrders);
  roomOrdersRef.current = roomOrders;
  sectionsRef.current = sections;

  const canMoveRoom = useCallback(
    (sourceSpaceId: string, targetSpaceId: string, roomId: string): boolean => {
      if (sourceSpaceId === targetSpaceId) return false;
      if (movingRoomIdsRef.current.has(roomId)) return false;
      const parents = roomToParents.get(roomId);
      if (!parents?.has(sourceSpaceId) || parents.has(targetSpaceId)) return false;
      return canEditSpace(sourceSpaceId) && canEditSpace(targetSpaceId);
    },
    [roomToParents, canEditSpace]
  );

  const onMoveRoom = useCallback(
    async (sourceSpaceId: string, targetSpaceId: string, roomId: string) => {
      if (!canMoveRoom(sourceSpaceId, targetSpaceId, roomId)) return;
      const targetSpace = client.getRoom(targetSpaceId);
      if (!targetSpace) return;

      movingRoomIdsRef.current.add(roomId);
      try {
        await moveSpaceRoom(client, sourceSpaceId, targetSpace, roomId);
        const targetSection = sectionsRef.current.find(
          (section) => section.spaceId === targetSpaceId
        );
        roomOrdersRef.current.appendRoom(
          targetSpaceId,
          targetSection?.tree.top ?? [],
          roomId,
          targetSection?.inheritFrom
        );
      } catch {
        // Leave Matrix state authoritative if the move fails.
      } finally {
        movingRoomIdsRef.current.delete(roomId);
      }
    },
    [client, canMoveRoom]
  );

  const rootInheritFrom = rootAncestors.length > 0 ? rootAncestors : undefined;
  const rootSection = sections.find((section) => section.isRoot);
  const sort: SpaceSortControl = {
    mode: roomOrders.modeOf(spaceId, rootInheritFrom),
    showTimes: roomOrders.showTimesOf(spaceId, rootInheritFrom),
    hasSavedOrder: roomOrders.hasSavedOrder(spaceId),
    setMode: (nextMode) =>
      roomOrders.setMode(
        spaceId,
        nextMode,
        rootSection?.orderedTop,
        nextMode === 'manual'
          ? collectInheritedOrders(sections, spaceId, roomOrders.hasExplicitMode)
          : undefined
      ),
    setShowTimes: (show) => roomOrders.setShowTimes(spaceId, show, rootInheritFrom),
  };

  return {
    spaceRooms,
    sections,
    shortcutRoomIds,
    sort,
    onCategoryClick,
    onReorder: roomOrders.save,
    canMoveRoom,
    onMoveRoom,
  };
}

export type SpaceRoomSectionProps = {
  section: RenderedSpaceRoomSection;
  spaceId: string;
  spaceIdOrAlias: string;
  selectedRoomId: string | undefined;
  onCategoryClick: MouseEventHandler<HTMLElement>;
  onReorder: (spaceId: string, order: string[]) => void;
};

/** One collapsible room section in the Space sidebar (either the space's Rooms or a sub-space). */
export function SpaceRoomSection({
  section,
  spaceId,
  spaceIdOrAlias,
  selectedRoomId,
  onCategoryClick,
  onReorder,
}: SpaceRoomSectionProps) {
  const client = useMatrixClient();
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const sectionDrop = useRoomSectionDrop(section.spaceId);
  const sectionSpace = client.getRoom(section.spaceId) ?? undefined;
  if (!sectionSpace) return null;
  const parentSpace = section.parentSpaceId
    ? (client.getRoom(section.parentSpaceId) ?? undefined)
    : undefined;

  // A room's row, the same at top level and under the room it sits under, except that there it
  // frames its hash.
  const rowProps = (room: Room) => ({
    room,
    selected: room.roomId === selectedRoomId,
    linkPath: getSpaceRoomPath(spaceIdOrAlias, getCanonicalAliasOrRoomId(client, room.roomId)),
    notificationMode: getRoomNotificationMode(notificationPreferences, room.roomId),
    spaceId,
    activityTimestamp: section.showTimes ? getRoomActivityTimestamp(room) || undefined : undefined,
  });
  const renderSubRoom = (room: Room) => <RoomNavItem {...rowProps(room)} subRoom />;
  const previewPath = (roomId: string) => getSpaceRoomPath(spaceIdOrAlias, roomId);

  return (
    <NavCategory {...sectionDrop}>
      <SpaceSectionHeader
        space={sectionSpace}
        parentSpace={parentSpace}
        isRoot={section.isRoot}
        isEmpty={section.isEmpty}
        categoryId={section.categoryId}
        closed={section.closed}
        shownRoomIds={section.shownRoomIds}
        selectedRoomId={selectedRoomId}
        onCategoryClick={onCategoryClick}
        sort={section.sort}
      />
      <SortableRoomList
        listId={section.spaceId}
        roomIds={section.listedRoomIds}
        onReorder={(order) => onReorder(section.spaceId, order)}
        reorderDisabled={section.mode === 'recent'}
      >
        {section.listedRoomIds.map((roomId) => {
          const room = client.getRoom(roomId);
          return room ? (
            <Fragment key={roomId}>
              <SortableRoomRow {...rowProps(room)} removeFromSpaceId={section.spaceId} />
              {!section.closed && (
                <SubRoomRows
                  parent={room}
                  tree={section.tree}
                  renderRoom={renderSubRoom}
                  previewPath={previewPath}
                />
              )}
            </Fragment>
          ) : null;
        })}
      </SortableRoomList>
    </NavCategory>
  );
}
