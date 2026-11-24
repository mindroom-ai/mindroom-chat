import { Fragment, type MouseEventHandler, useCallback, useMemo, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { KnownMembership, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { NavCategory } from '../../ui/nav/NavItem';
import { useCategoryHandler } from '../../ui/nav/useCategoryHandler';
import { useClosedNavCategoriesAtom } from '../../ui/nav/useClosedNavCategories';
import { useRoomOrders } from '../room-nav/roomOrder';
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
import { SpaceSectionHeader } from './SpaceSectionHeader';

export type RenderedSpaceRoomSection = SpaceRoomSectionData & {
  closed: boolean;
  tree: SubRoomTree;
  shownRoomIds: string[];
  listedRoomIds: string[];
};

/**
 * Derives a space's visible rooms, inline collapsible room/sub-space sections, shortcut order,
 * collapse handler, manual reorder handler, and atomic "Sort by name" reset callback.
 */
export function useSpaceRoomSections(spaceId: string, selectedRoomId: string | undefined) {
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
  const sections = useMemo<RenderedSpaceRoomSection[]>(
    () =>
      rawSections.map((section) => {
        const closed = closedCategories.has(section.categoryId);
        const list = buildSubRoomList(
          section.ownRoomsByName,
          section.scopeRoomsByName,
          roomToParents,
          chatRooms,
          (top) => roomOrders.orderOf(section.spaceId, top),
          closed,
          selectedRoomId
        );
        return { ...section, closed, ...list };
      }),
    [rawSections, closedCategories, roomToParents, chatRooms, roomOrders, selectedRoomId]
  );
  const shortcutRoomIds = useMemo(() => collectShortcutRoomIds(sections), [sections]);
  const manualSectionIds = sections
    .filter((section) => roomOrders.isManual(section.spaceId))
    .map((section) => section.spaceId);

  const movingRoomIdsRef = useRef(new Set<string>());
  const roomOrdersRef = useRef(roomOrders);
  roomOrdersRef.current = roomOrders;
  const sectionsRef = useRef(sections);
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
        roomOrdersRef.current.appendRoom(targetSpaceId, targetSection?.tree.top ?? [], roomId);
      } catch {
        // Leave Matrix state authoritative if the move fails.
      } finally {
        movingRoomIdsRef.current.delete(roomId);
      }
    },
    [client, canMoveRoom]
  );

  return {
    spaceRooms,
    sections,
    shortcutRoomIds,
    onCategoryClick,
    onReorder: roomOrders.save,
    onSortByName:
      manualSectionIds.length > 0 ? () => roomOrders.reset(manualSectionIds) : undefined,
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
      />
      <SortableRoomList
        listId={section.spaceId}
        roomIds={section.listedRoomIds}
        onReorder={(order) => onReorder(section.spaceId, order)}
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
