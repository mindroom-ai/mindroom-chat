import { Fragment, type MouseEventHandler, useLayoutEffect, useMemo, useRef } from 'react';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { revealDirectionControls } from '../../ui/directional';
import { NavCategory } from '../../ui/nav/NavItem';
import { NavCategoryHeader } from '../../ui/nav/NavCategoryHeader';
import { useCategoryHandler } from '../../ui/nav/useCategoryHandler';
import { useClosedNavCategoriesAtom } from '../../ui/nav/useClosedNavCategories';
import { UnreadBadge, UnreadBadgeCenter } from '../../ui/UnreadBadge';
import { RoomNavCategoryButton } from '../room-nav/RoomNavCategoryButton';
import { useRoomOrders } from '../room-nav/roomOrder';
import { SortableRoomList, SortableRoomRow } from '../room-nav/SortableRoomList';
import { RoomNavItem } from '../room-nav/RoomNavItem';
import { SubRoomRows, type SubRoomTree, buildSubRoomList } from '../room-nav/SubRoomRows';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import {
  getRoomNotificationMode,
  useRoomsNotificationPreferencesContext,
} from '../../matrix/hooks/useRoomsNotificationPreferences';
import { useRoomName } from '../../matrix/hooks/useRoomMeta';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { useVisibleRooms } from '../../matrix/state/archivedRooms';
import { navigationRoomToUnreadAtom } from '../../notifications/navigationUnread';
import { mDirectAtom } from '../../matrix/state/mDirectList';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { chatRoomParentsAtom, roomToParentsAtom } from '../../matrix/state/roomToParents';
import { getSpaceRoomPath } from '../../routes/pathUtils';
import { getSpaceSearchRooms } from '../../matrix/state/useSpaceSearchRooms';
import { sortRoomIdsByName } from '../../lib/nameOrder';
import {
  type SpaceRoomSection as SpaceRoomSectionData,
  collectShortcutRoomIds,
  getCollapsedSectionUnread,
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
        chatRooms
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

  return {
    spaceRooms,
    sections,
    shortcutRoomIds,
    onCategoryClick,
    onReorder: roomOrders.save,
    onSortByName:
      manualSectionIds.length > 0 ? () => roomOrders.reset(manualSectionIds) : undefined,
  };
}

type SectionCategoryButtonProps = {
  label: string;
  ownDirection?: boolean;
  categoryId: string;
  closed: boolean;
  unread?: { highlight: boolean };
  onClick: MouseEventHandler<HTMLElement>;
};

/** Collapsible heading for a space room section, with a compact unread dot while collapsed. */
function SectionCategoryButton({
  label,
  ownDirection,
  categoryId,
  closed,
  unread,
  onClick,
}: SectionCategoryButtonProps) {
  const { t } = useTranslation();
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

type CollapsedSectionUnreadProps = Omit<SectionCategoryButtonProps, 'closed' | 'unread'> & {
  shownRoomIds: readonly string[];
  selectedRoomId: string | undefined;
};

/**
 * Subscribes to unread state only while a section is collapsed, so expanded sections and room rows
 * do not re-render when unread counts change.
 */
function CollapsedSectionUnread({
  shownRoomIds,
  selectedRoomId,
  ...props
}: CollapsedSectionUnreadProps) {
  const unreads = useAtomValue(navigationRoomToUnreadAtom);
  const unread = getCollapsedSectionUnread(true, shownRoomIds, selectedRoomId, unreads);
  return <SectionCategoryButton {...props} closed unread={unread} />;
}

type SectionHeaderButtonProps = Omit<SectionCategoryButtonProps, 'unread'> & {
  shownRoomIds: readonly string[];
  selectedRoomId: string | undefined;
};

/** Renders the section heading button, mounting the unread subscription only while collapsed. */
function SectionHeaderButton({
  closed,
  shownRoomIds,
  selectedRoomId,
  onClick,
  ...props
}: SectionHeaderButtonProps) {
  const restoreFocusRef = useRef<{ parent: Element; wasClosed: boolean } | null>(null);
  const handleClick: MouseEventHandler<HTMLElement> = (event) => {
    const target = event.currentTarget;
    restoreFocusRef.current =
      typeof document !== 'undefined' && document.activeElement === target && target.parentElement
        ? { parent: target.parentElement, wasClosed: closed }
        : null;
    onClick(event);
  };
  useLayoutEffect(() => {
    const pending = restoreFocusRef.current;
    if (!pending || pending.wasClosed === closed) return;
    restoreFocusRef.current = null;
    pending.parent.querySelector<HTMLElement>('[data-category-id]')?.focus();
  }, [closed]);

  return closed ? (
    <CollapsedSectionUnread
      {...props}
      shownRoomIds={shownRoomIds}
      selectedRoomId={selectedRoomId}
      onClick={handleClick}
    />
  ) : (
    <SectionCategoryButton {...props} closed={false} onClick={handleClick} />
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
  const subspace = section.isRoot ? undefined : client.getRoom(section.spaceId) ?? undefined;
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
    <NavCategory>
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
