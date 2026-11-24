import { Fragment, type MouseEventHandler, useCallback, useMemo, useRef } from 'react';
import { atom, useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { KnownMembership, type MatrixEvent, type Room } from 'matrix-js-sdk';
import { revealDirectionControls } from '../../ui/directional';
import { NavCategory } from '../../ui/nav/NavItem';
import { NavCategoryHeader } from '../../ui/nav/NavCategoryHeader';
import { useCategoryHandler } from '../../ui/nav/useCategoryHandler';
import { useClosedNavCategoriesAtom } from '../../ui/nav/useClosedNavCategories';
import { UnreadBadge, UnreadBadgeCenter } from '../../ui/UnreadBadge';
import { RoomNavCategoryButton } from '../room-nav/RoomNavCategoryButton';
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
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { useStateEventCallback } from '../../matrix/hooks/useStateEventCallback';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { useVisibleRooms } from '../../matrix/state/archivedRooms';
import { navigationRoomToUnreadAtom } from '../../notifications/navigationUnread';
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
  type CollapsedSectionUnread,
  type SpaceRoomSection as SpaceRoomSectionData,
  collectShortcutRoomIds,
  getCollapsedSectionUnread,
  getDescendantSubspaces,
  getSpaceRoomSections,
} from './spaceRoomSections';

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
    [canMoveRoom, client]
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

const EMPTY_UNREAD_ATOM = atom((): CollapsedSectionUnread | undefined => undefined);

type SectionHeaderButtonProps = {
  label: string;
  ownDirection?: boolean;
  categoryId: string;
  closed: boolean;
  shownRoomIds: readonly string[];
  selectedRoomId: string | undefined;
  onClick: MouseEventHandler<HTMLElement>;
};

/**
 * Collapsible heading for a space room section. Keeps one button mounted across toggles
 * (preserving keyboard focus) and subscribes to unread state only while collapsed.
 */
function SectionHeaderButton({
  label,
  ownDirection,
  categoryId,
  closed,
  shownRoomIds,
  selectedRoomId,
  onClick,
}: SectionHeaderButtonProps) {
  const { t } = useTranslation();
  const unreadAtom = useMemo(
    () =>
      closed
        ? atom((get) =>
            getCollapsedSectionUnread(
              true,
              shownRoomIds,
              selectedRoomId,
              get(navigationRoomToUnreadAtom)
            )
          )
        : EMPTY_UNREAD_ATOM,
    [closed, shownRoomIds, selectedRoomId]
  );
  const unread = useAtomValue(unreadAtom);

  return (
    <RoomNavCategoryButton
      closed={closed}
      ownDirection={ownDirection}
      data-category-id={categoryId}
      aria-label={unread ? t('featureUi.spaceNav.subspaceUnread', { name: label }) : undefined}
      after={
        unread && (
          <UnreadBadgeCenter>
            <span data-unread>
              <UnreadBadge count={0} highlight={unread.highlight} />
            </span>
          </UnreadBadgeCenter>
        )
      }
      onClick={onClick}
    >
      {label}
    </RoomNavCategoryButton>
  );
}

/** Sub-space section heading that subscribes to live room name updates. */
function SubspaceCategoryButton({
  subspace,
  ...props
}: Omit<SectionHeaderButtonProps, 'label' | 'ownDirection'> & { subspace: Room }) {
  const name = revealDirectionControls(useRoomName(subspace));
  return <SectionHeaderButton {...props} label={name} ownDirection />;
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
  const { t } = useTranslation();
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const sectionDrop = useRoomSectionDrop(section.spaceId);
  const subspace = section.isRoot ? undefined : (client.getRoom(section.spaceId) ?? undefined);
  if (!section.isRoot && !subspace) return null;

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
      <NavCategoryHeader>
        {subspace ? (
          <SubspaceCategoryButton
            subspace={subspace}
            categoryId={section.categoryId}
            closed={section.closed}
            shownRoomIds={section.shownRoomIds}
            selectedRoomId={selectedRoomId}
            onClick={onCategoryClick}
          />
        ) : (
          <SectionHeaderButton
            label={t('sharedUi.space.rooms')}
            categoryId={section.categoryId}
            closed={section.closed}
            shownRoomIds={section.shownRoomIds}
            selectedRoomId={selectedRoomId}
            onClick={onCategoryClick}
          />
        )}
      </NavCategoryHeader>
      <SortableRoomList
        listId={section.spaceId}
        roomIds={section.listedRoomIds}
        onReorder={(order) => onReorder(section.spaceId, order)}
      >
        {section.listedRoomIds.map((roomId) => {
          const room = client.getRoom(roomId);
          return room ? (
            <Fragment key={roomId}>
              <SortableRoomRow {...rowProps(room)} />
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
