import { Fragment, type MouseEventHandler, useCallback, useMemo, useReducer, useRef } from 'react';
import classNames from 'classnames';
import { useAtom, useAtomValue } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { NavCategory } from '../../ui/nav/NavItem';
import { useCategoryHandler } from '../../ui/nav/useCategoryHandler';
import { useClosedNavCategoriesAtom } from '../../ui/nav/useClosedNavCategories';
import { type RoomSortMode, useRoomOrders } from '../room-nav/roomOrder';
import {
  type ActivityTrackedSection,
  getRoomActivityTimestamp,
  useRoomActivityListener,
} from '../room-nav/roomActivity';
import {
  SortableRoomList,
  SortableRoomRow,
  useRoomSectionDrop,
} from '../room-nav/SortableRoomList';
import { RoomNavItem } from '../room-nav/RoomNavItem';
import { SubRoomRows } from '../room-nav/SubRoomRows';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../matrix/hooks/useRoomsNotificationPreferences';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { useVisibleRooms } from '../../matrix/state/archivedRooms';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { chatRoomParentsAtom, roomToParentsAtom } from '../../matrix/state/roomToParents';
import { getSpaceRoomPath } from '../../routes/pathUtils';
import { getSpaceSearchRooms } from '../../matrix/state/useSpaceSearchRooms';
import { sortRoomIdsByName } from '../../lib/nameOrder';
import type { SpaceMenuGroupsProps } from '../../spaces/SpaceActions';
import { moveSpaceRoom } from '../../spaces/lobby/spaceChildren';
import { getDescendantSubspaces, getSpaceRoomSections } from '../../spaces/spaceRoomSections';
import {
  type SpaceSectionTreeNode,
  buildSpaceSectionTree,
  collectShortcutRoomIds,
  findSelectedDescendantSection,
} from '../../spaces/spaceSectionTree';
import {
  type RenderedSpaceRoomSection,
  buildRenderedSpaceSections,
  collectInheritedOrders,
  toActivityTrackedSection,
  useSpaceEditPermissions,
} from './spaceSectionHelpers';
import { SpaceSectionHeader } from './SpaceSectionHeader';
import * as css from './SpaceRoomSection.css';

export type { RenderedSpaceRoomSection };

const EMPTY_CHILD_NODES: readonly SpaceSectionTreeNode<RenderedSpaceRoomSection>[] = [];

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
  const canEditSpace = useSpaceEditPermissions(trackedSpaceIds, joinedRoomSet);

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
    return buildRenderedSpaceSections({
      client,
      rawSections,
      rootAncestors,
      closedCategories,
      roomToParents,
      chatRooms,
      roomOrders,
      selectedRoomId,
      sectionsRef,
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

  const sectionTree = useMemo(() => buildSpaceSectionTree(sections), [sections]);

  const trackedSections = useMemo<ActivityTrackedSection[]>(
    () => sections.map(toActivityTrackedSection),
    [sections]
  );
  useRoomActivityListener(trackedSections, bumpActivity);

  const shortcutRoomIds = useMemo(
    () => collectShortcutRoomIds(sectionTree, selectedRoomId),
    [sectionTree, selectedRoomId]
  );

  const movingRoomIdsRef = useRef(new Set<string>());
  const roomOrdersRef = useRef(roomOrders);
  roomOrdersRef.current = roomOrders;
  sectionsRef.current = sections;

  const canMoveRoom = useCallback(
    (sourceSpaceId: string, targetSpaceId: string, roomId: string): boolean => {
      if (sourceSpaceId === targetSpaceId) return false;
      if (movingRoomIdsRef.current.has(roomId)) return false;
      const parents = roomToParents.get(roomId);
      if (!parents?.has(sourceSpaceId)) return false;
      // The room must show in the target after the move, and a room a sub-space lists is left
      // out of the spaces above it. So a target that links the room already takes it only from
      // a sub-space below it, and no other sub-space below the target may still link it.
      const below = new Set(
        getDescendantSubspaces(client, targetSpaceId, joinedRoomIds, roomToParents)
      );
      if (parents.has(targetSpaceId) && !below.has(sourceSpaceId)) return false;
      if ([...parents].some((id) => id !== sourceSpaceId && below.has(id))) return false;
      return canEditSpace(sourceSpaceId) && canEditSpace(targetSpaceId);
    },
    [client, joinedRoomIds, roomToParents, canEditSpace]
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
    sectionTree,
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
  /** Nested descendant sub-space tree nodes under this section. */
  childNodes?: readonly SpaceSectionTreeNode<RenderedSpaceRoomSection>[];
  /** Deduplicated visible rooms across this section and all descendants (for collapsed unread roll-up). */
  subtreeShownRoomIds?: readonly string[];
  /** Nesting depth (0 for top-level Home spaces and direct Space sub-spaces). */
  depth?: number;
  spaceId: string;
  spaceIdOrAlias: string;
  selectedRoomId: string | undefined;
  onCategoryClick: MouseEventHandler<HTMLElement>;
  onReorder: (spaceId: string, order: string[]) => void;
  /** Custom path builder (e.g. `getHomeRoomPath` on Home); keeps room actions in that view. */
  roomPath?: (roomIdOrAlias: string) => string;
  /** Include `Space overview` in the section's space options menu. */
  showOverview?: boolean;
  /** Use calm quiet dots for collapsed unread state (Home sidebar). */
  quietUnread?: boolean;
  /** Optional sidebar pin entry for the section's space options menu (or resolver per section). */
  pinMode?:
    | SpaceMenuGroupsProps['pinMode']
    | ((section: RenderedSpaceRoomSection) => SpaceMenuGroupsProps['pinMode']);
};

/** One collapsible room section (and its nested sub-spaces) in a Space or Home sidebar. */
export function SpaceRoomSection({
  section,
  childNodes = EMPTY_CHILD_NODES,
  subtreeShownRoomIds,
  depth = 0,
  spaceId,
  spaceIdOrAlias,
  selectedRoomId,
  onCategoryClick,
  onReorder,
  roomPath,
  showOverview,
  quietUnread = false,
  pinMode,
}: SpaceRoomSectionProps) {
  const client = useMatrixClient();
  const notificationPreferences = useRoomsNotificationPreferencesContext();
  const sectionDrop = useRoomSectionDrop(section.spaceId);
  const sectionSpace = client.getRoom(section.spaceId) ?? undefined;
  if (!sectionSpace) return null;
  const parentSpace = section.parentSpaceId
    ? (client.getRoom(section.parentSpaceId) ?? undefined)
    : undefined;

  const { className: sectionDropClassName, ...sectionDropProps } = sectionDrop;
  const resolvedPinMode = typeof pinMode === 'function' ? pinMode(section) : pinMode;
  const selectedDescendantOwner =
    section.closed &&
    selectedRoomId !== undefined &&
    !section.listedRoomIds.includes(selectedRoomId)
      ? findSelectedDescendantSection(childNodes, selectedRoomId)
      : undefined;
  const selectedDescendantRoom =
    selectedDescendantOwner && selectedRoomId !== undefined
      ? (client.getRoom(selectedRoomId) ?? undefined)
      : undefined;
  const visibleChildren = section.closed ? EMPTY_CHILD_NODES : childNodes;
  const unreadShownRoomIds = subtreeShownRoomIds ?? section.shownRoomIds;

  const previewPath = roomPath ?? ((roomId: string) => getSpaceRoomPath(spaceIdOrAlias, roomId));

  // A room's row, the same at top level and under the room it sits under, except that there it
  // frames its hash.
  const rowProps = (room: Room, showTimes = section.showTimes) => ({
    room,
    selected: room.roomId === selectedRoomId,
    linkPath: previewPath(getCanonicalAliasOrRoomId(client, room.roomId)),
    notificationMode: getRoomNotificationMode(notificationPreferences, room.roomId),
    spaceId: roomPath ? undefined : spaceId,
    activityTimestamp: showTimes ? getRoomActivityTimestamp(room) || undefined : undefined,
  });
  const renderSubRoom = (room: Room) => <RoomNavItem {...rowProps(room)} subRoom />;

  // A retained active room from a collapsed descendant renders as a plain non-draggable row so
  // releasing a drag inside this collapsed parent cannot drop it onto the parent space.
  const roomRows =
    section.closed && selectedDescendantOwner && selectedDescendantRoom ? (
      <RoomNavItem
        {...rowProps(selectedDescendantRoom, selectedDescendantOwner.showTimes)}
        removeFromSpaceId={selectedDescendantOwner.spaceId}
      />
    ) : (
      <SortableRoomList
        listId={section.spaceId}
        roomIds={section.listedRoomIds}
        onReorder={(order) => onReorder(section.spaceId, order)}
        reorderDisabled={section.mode === 'recent'}
      >
        {section.listedRoomIds.map((roomId) => {
          const room = client.getRoom(roomId);
          if (!room) return null;
          return (
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
          );
        })}
      </SortableRoomList>
    );

  const hasRoomRows = section.listedRoomIds.length > 0 || selectedDescendantRoom !== undefined;
  const hasNestedBody = hasRoomRows || visibleChildren.length > 0;

  return (
    <NavCategory
      {...sectionDropProps}
      className={classNames(sectionDropClassName, !section.isRoot && css.SpaceSectionNode)}
      data-depth={section.isRoot ? undefined : depth}
      data-expanded={!section.isRoot && !section.closed ? 'true' : undefined}
    >
      <SpaceSectionHeader
        space={sectionSpace}
        parentSpace={parentSpace}
        isRoot={section.isRoot}
        isEmpty={section.isEmpty && childNodes.length === 0}
        categoryId={section.categoryId}
        closed={section.closed}
        shownRoomIds={unreadShownRoomIds}
        selectedRoomId={selectedRoomId}
        onCategoryClick={onCategoryClick}
        sort={section.sort}
        showOverview={showOverview}
        quietUnread={quietUnread}
        pinMode={resolvedPinMode}
        headingLevel={3 + depth}
      />
      {section.isRoot
        ? roomRows
        : hasNestedBody && (
            <div className={css.NestedChildren}>
              {hasRoomRows && roomRows}
              {visibleChildren.map((child) => (
                <SpaceRoomSection
                  key={child.section.categoryId}
                  section={child.section}
                  childNodes={child.children}
                  subtreeShownRoomIds={child.subtreeShownRoomIds}
                  depth={depth + 1}
                  spaceId={roomPath ? child.section.spaceId : spaceId}
                  spaceIdOrAlias={roomPath ? child.section.spaceId : spaceIdOrAlias}
                  selectedRoomId={selectedRoomId}
                  onCategoryClick={onCategoryClick}
                  onReorder={onReorder}
                  roomPath={roomPath}
                  showOverview={showOverview}
                  quietUnread={quietUnread}
                  pinMode={pinMode}
                />
              ))}
            </div>
          )}
    </NavCategory>
  );
}
