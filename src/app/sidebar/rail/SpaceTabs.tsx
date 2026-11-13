import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Icons, Text } from 'folds';
import { atom, useAtom, useAtomValue } from 'jotai';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import classNames from 'classnames';
import {
  DndContext,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  MouseSensor,
  closestCenter,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { SortableContext, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  SidebarAvatar,
  SidebarItem,
  SidebarItemBadge,
  SidebarItemTooltip,
  SidebarStack,
  SidebarStackSeparator,
} from '../../ui/sidebar/SidebarItem';
import { RoomAvatar } from '../../avatars/RoomAvatar';
import { UnreadBadge } from '../../ui/UnreadBadge';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useSelectedSpace } from '../../navigation/useSelectedSpace';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { InviteUserPrompt } from '../../members/invite/InviteUserPrompt';
import { allRoomsAtom } from '../../matrix/state/roomList';
import { roomToParentsAtom } from '../../matrix/state/roomToParents';
import { type SpaceOrderAtom, makeSpaceOrderAtom } from '../../spaces/sidebarOrder';
import { useNavToActivePathAtom } from '../../routes/useNavToActivePath';
import { useOpenRoomSettings } from '../../navigation/useRoomSettingsState';
import { getCanonicalAliasOrRoomId } from '../../matrix/matrix';
import { getRoomAvatarUrl, isSpace } from '../../matrix/room';
import { copyToClipboard } from '../../lib/dom';
import { preventClickDefaultsDuringPointerDrag } from '../../lib/sortableDrag';
import { LongPressTouchSensor } from '../../lib/longPressTouchSensor';
import { MarkRoomsReadMenuItem } from '../../notifications/MarkRoomsReadMenuItem';
import { moveStep } from '../../shortcuts/shortcuts';
import { getSpacePath, joinPathComponent } from '../../routes/pathUtils';
import { useSpaceRailRooms } from './spaceRailRooms';
import { revealRailEntry } from './RailScrollArea';
import { getSpaceShareLink } from '../space/spaceLink';
import { SidebarContextMenu, useSidebarContextMenu } from './SidebarContextMenu';
import {
  type SidebarDragItem,
  type SidebarFolder,
  type SidebarInstructionType,
  type SidebarItem as SidebarEntry,
  commitSidebarReorder,
} from '../../spaces/sidebarReorder';
import {
  getShownSidebarItems,
  unpinSpaceFromSidebar,
  useSavedSidebarItems,
  useTopLevelSpaceIds,
} from '../../spaces/sidebarSpaces';
import * as css from './SpaceTabs.css';
import { MenuEntry } from '../../ui/MenuEntry';
import { revealDirectionControls } from '../../ui/directional';

type DropAt = 'above' | 'below' | 'child';
const DROP_AT: Record<SidebarInstructionType, DropAt> = {
  'reorder-above': 'above',
  'reorder-below': 'below',
  'make-child': 'child',
};

/** The sortable ID of a rail entry: a space, a folder, or a space inside a folder. */
const dragId = (drag: SidebarDragItem): string => {
  if (typeof drag === 'string') return drag;
  return drag.spaceId ? `folder:${drag.folder.id}/${drag.spaceId}` : `folder:${drag.folder.id}`;
};

type DragData = { drag: SidebarDragItem };

const readDrag = (data: unknown): SidebarDragItem | undefined =>
  (data as { current?: DragData } | undefined)?.current?.drag;

// One local order atom per account, made once, so every rail of that account shares it.
const spaceOrderAtoms = new Map<string, SpaceOrderAtom>();
const spaceOrderAtomFor = (userId: string): SpaceOrderAtom => {
  let orderAtom = spaceOrderAtoms.get(userId);
  if (!orderAtom) {
    orderAtom = makeSpaceOrderAtom(userId);
    spaceOrderAtoms.set(userId, orderAtom);
  }
  return orderAtom;
};

/** Folders open in the rail in this session, by folder ID. */
export const openFoldersAtom = atom<ReadonlySet<string>>(new Set<string>());

/** "Invite" in a space's rail menu, for members allowed to invite. */
function InviteToSpaceItem({ space, onSelect }: { space: Room; onSelect: () => void }) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const permissions = useRoomPermissions(useRoomCreators(space), usePowerLevels(space));
  if (!permissions.action('invite', client.getUserId() ?? '')) return null;
  return (
    <MenuEntry label={t('sharedUi.spaceTabs.invite')} icon={Icons.UserPlus} onSelect={onSelect} />
  );
}

/** Makes a rail entry draggable and shows where a dragged one would land on it. */
function useRailSortable(drag: SidebarDragItem, hint: DropAt | undefined) {
  const { setNodeRef, listeners, transform, isDragging } = useSortable({
    id: dragId(drag),
    data: { drag } satisfies DragData,
  });
  const className = classNames(
    css.SpaceDragSource,
    hint && css.DropHint({ at: hint }),
    isDragging && css.SpaceDragging
  );
  // Only the pointer drags; the buttons inside keep their own keyboard behaviour and focus ring.
  const props = {
    ref: setNodeRef,
    className,
    style: { transform: CSS.Translate.toString(transform) },
    ...listeners,
  };
  return { props, dragging: isDragging };
}

/** Moves a rail entry one place up or down; ⌘ or Ctrl with Shift and an arrow key asks for it. */
type MoveEntry = (direction: -1 | 1) => void;

const moveKeyHandler = (move: MoveEntry) => (event: React.KeyboardEvent<HTMLElement>) => {
  const step = moveStep(event.nativeEvent);
  if (!step) return;
  event.preventDefault();
  move(step);
};

type SpaceTabProps = {
  space: Room;
  selected: boolean;
  /** Lets the navigation panel take the click, given whether the space is shown; true when it did. */
  onSelect?: (selected: boolean) => boolean;
  drag: SidebarDragItem;
  hint?: DropAt;
  /** Shown because the saved rail names it although it sits in another space. */
  pinned: boolean;
  onMove: MoveEntry;
};

function SpaceTab({ space, selected, onSelect, drag, hint, pinned, onMove }: SpaceTabProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const { roomId, name } = space;
  // Without a picture the rail shows the first two characters of the name, as written ("Mi" for
  // MindRoom); the button is named by the whole name, with its unread count.
  const letters = Array.from(name.trim()).slice(0, 2).join('');
  // The button is named by the whole name (`label`); the letters and the picture only show it.
  const initials = () => (
    <Text size="H4" aria-hidden>
      {letters}
    </Text>
  );
  const navigate = useNavigate();
  const isMobile = useScreenSizeContext() === ScreenSize.Mobile;
  const useAuthentication = useMediaAuthentication();
  const activePaths = useAtomValue(useNavToActivePathAtom());
  const { unread, rooms: spaceRooms } = useSpaceRailRooms(roomId);
  const avatarUrl = getRoomAvatarUrl(client, space, 96, useAuthentication);
  const openSpaceSettings = useOpenRoomSettings();
  const { anchor: menuAnchor, close: closeMenu, buttonProps } = useSidebarContextMenu();
  const [inviting, setInviting] = useState(false);
  const sortable = useRailSortable(drag, hint);

  // A finger that moves on after the long press that opened the menu drags the space instead.
  const dragging = sortable.dragging;
  useEffect(() => {
    if (dragging) closeMenu();
  }, [dragging, closeMenu]);
  const closeThen = (action: () => void) => () => {
    closeMenu();
    action();
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    // A click another handler already claimed (such as the end of a drag) changes nothing here.
    if (event.defaultPrevented) return;
    if (onSelect?.(selected)) return;
    const spacePath = getSpacePath(getCanonicalAliasOrRoomId(client, roomId));
    // On phones the first tap shows the space's list; a second one returns to its last room.
    if (isMobile && !selected) {
      navigate(spacePath);
      return;
    }
    const lastPath = activePaths.get(roomId);
    navigate(lastPath ? joinPathComponent(lastPath) : spacePath);
  };

  // The button's name says what the badge shows, so the badge itself stays out of the reading.
  // Direction controls in the name show as code points, so they cannot reorder it.
  const shownName = revealDirectionControls(name);
  let label = shownName;
  if (unread?.total)
    label = t('sharedUi.spaceTabs.nameUnread', { name: shownName, count: unread.total });
  else if (unread) label = t('featureUi.spaceNav.subspaceUnread', { name: shownName });
  const unreadBadge = unread ? (
    <SidebarItemBadge aria-hidden hasCount={unread.total > 0}>
      <UnreadBadge count={unread.total} highlight={unread.highlight > 0} />
    </SidebarItemBadge>
  ) : null;

  return (
    <div {...sortable.props}>
      <SidebarItem active={selected}>
        <SidebarItemTooltip tooltip={shownName}>
          {(triggerRef) => (
            <SidebarAvatar
              as="button"
              ref={triggerRef}
              size="400"
              data-id={roomId}
              onClick={handleClick}
              onKeyDown={moveKeyHandler(onMove)}
              {...buttonProps}
            >
              <RoomAvatar roomId={roomId} src={avatarUrl} alt="" renderFallback={initials} />
              <span className={css.HiddenName}>{label}</span>
            </SidebarAvatar>
          )}
        </SidebarItemTooltip>
        {unreadBadge}
        <SidebarContextMenu anchor={menuAnchor} onClose={closeMenu}>
          <MarkRoomsReadMenuItem roomIds={spaceRooms} onClose={closeMenu} />
          <InviteToSpaceItem space={space} onSelect={closeThen(() => setInviting(true))} />
          <MenuEntry
            label={t('sharedUi.spaceTabs.copyLink')}
            icon={Icons.Link}
            onSelect={closeThen(() => void copyToClipboard(getSpaceShareLink(client, space)))}
          />
          <MenuEntry
            label={t('sharedUi.spaceTabs.spaceSettings')}
            icon={Icons.Setting}
            onSelect={closeThen(() => openSpaceSettings(roomId))}
          />
          {pinned && (
            <MenuEntry
              label={t('sharedUi.spaceTabs.unpin')}
              icon={Icons.Pin}
              onSelect={closeThen(() => void unpinSpaceFromSidebar(client, roomId))}
            />
          )}
        </SidebarContextMenu>
        {inviting && <InviteUserPrompt room={space} requestClose={() => setInviting(false)} />}
      </SidebarItem>
    </div>
  );
}

/** One small picture (or the first letter) of a space on a closed folder's face. */
function FolderFaceTile({ space }: { space: Room }) {
  const client = useMatrixClient();
  const authenticated = useMediaAuthentication();
  return (
    <span className={css.FolderFaceTile}>
      <RoomAvatar
        alt=""
        roomId={space.roomId}
        src={getRoomAvatarUrl(client, space, 32, authenticated)}
        renderFallback={() => <span>{Array.from(space.name.trim())[0] ?? ''}</span>}
      />
    </span>
  );
}

type FolderTabProps = {
  folder: SidebarFolder;
  spaces: Room[];
  open: boolean;
  onToggle: () => void;
  /** Whether the selected space is one of the folder's. */
  holdsSelected: boolean;
  hint?: DropAt;
  onMove: MoveEntry;
};

/** A folder's name, or the names of its spaces when it has none. */
const folderLabel = (folder: SidebarFolder, spaces: Room[]): string =>
  revealDirectionControls(folder.name || spaces.map((space) => space.name).join(', '));

/** A folder's button: closed, a grid of its spaces; open, a button that closes it again. */
function FolderTab(props: FolderTabProps) {
  const { folder, spaces, open, onToggle, holdsSelected, hint, onMove } = props;
  const label = folderLabel(folder, spaces);
  const sortable = useRailSortable({ folder }, hint);
  return (
    <div {...sortable.props}>
      <SidebarItem active={!open && holdsSelected}>
        <SidebarItemTooltip tooltip={label}>
          {(triggerRef) => (
            <SidebarAvatar
              as="button"
              ref={triggerRef}
              size="400"
              aria-label={label}
              aria-expanded={open}
              data-folder-id={folder.id}
              className={open ? undefined : css.FolderFace}
              onKeyDown={moveKeyHandler(onMove)}
              onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                if (!event.defaultPrevented) onToggle();
              }}
            >
              {open ? (
                <Icon size="200" src={Icons.ChevronTop} />
              ) : (
                spaces
                  .slice(0, 4)
                  .map((space) => <FolderFaceTile key={space.roomId} space={space} />)
              )}
            </SidebarAvatar>
          )}
        </SidebarItemTooltip>
      </SidebarItem>
    </div>
  );
}

/**
 * Where the dragged entry lands on `over`: above or below it, or (for a space dropped on the
 * middle of a space or a folder) grouped with it in a folder.
 */
const dropInstruction = (
  active: SidebarDragItem,
  over: SidebarDragItem,
  overTop: number,
  overHeight: number,
  pointerY: number
): SidebarInstructionType => {
  const share = overHeight > 0 ? (pointerY - overTop) / overHeight : 0.5;
  const activeIsSpace = typeof active === 'string' || !!active.spaceId;
  const overTakesChildren = typeof over === 'string' || !over.spaceId;
  if (activeIsSpace && overTakesChildren && share > 0.3 && share < 0.7) return 'make-child';
  return share < 0.5 ? 'reorder-above' : 'reorder-below';
};

// The rail's entries do not slide aside while dragging; a hint marks the landing place instead.
const keepInPlace = () => null;

// The drag library's own announcements are English only; dragging is a pointer gesture here, and
// Alt with the arrow keys moves an entry from the keyboard.
const silent = () => undefined;
const silentAnnouncements = {
  onDragStart: silent,
  onDragMove: silent,
  onDragOver: silent,
  onDragEnd: silent,
  onDragCancel: silent,
};

type SpaceTabsProps = {
  /** Passed to each space's button; see `SpaceTabProps.onSelect`. */
  onSelect?: (selected: boolean) => boolean;
};

/**
 * The spaces in the icon rail, in the saved order with the device's own order on top, folders
 * included. Dragging a space reorders the rail; dropping it on another space or a folder groups
 * them in a folder.
 */
export function SpaceTabs({ onSelect }: SpaceTabsProps = {}) {
  const client = useMatrixClient();
  const { t } = useTranslation();
  const joinedRoomIds = useAtomValue(allRoomsAtom);
  const parentsByRoom = useAtomValue(roomToParentsAtom);
  const selectedSpaceId = useSelectedSpace();
  const saved = useSavedSidebarItems();
  const [localOrder, setLocalOrder] = useAtom(spaceOrderAtomFor(client.getSafeUserId()));
  const [openFolders, setOpenFolders] = useAtom(openFoldersAtom);
  const [hint, setHint] = useState<{ id: string; at: DropAt }>();
  const stackRef = useRef<HTMLDivElement>(null);

  const joinedSpaces = useMemo(
    () =>
      new Map(
        joinedRoomIds
          .map((roomId) => client.getRoom(roomId))
          .filter((room): room is Room => !!room && isSpace(room))
          .map((room) => [room.roomId, room])
      ),
    [client, joinedRoomIds]
  );
  const topLevelSpaces = useTopLevelSpaceIds();
  const items = useMemo(
    () =>
      getShownSidebarItems({
        saved,
        topLevelSpaces,
        isJoinedSpace: (roomId) => joinedSpaces.has(roomId),
        localOrder,
      }),
    [saved, topLevelSpaces, joinedSpaces, localOrder]
  );

  // A mouse drags after a short move; a finger moves on after a long press (which opens a space's
  // menu), so a swipe still scrolls the rail.
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(LongPressTouchSensor)
  );

  // Opening a space, from the rail or anywhere else, scrolls the rail to its entry (or to the
  // closed folder that holds it).
  const hasItems = items.length > 0;
  useEffect(() => {
    const entry = selectedSpaceId ? stackRef.current?.querySelector('[data-active]') : null;
    if (entry) revealRailEntry(entry);
  }, [selectedSpaceId, hasItems]);

  if (items.length === 0) return null;

  const isPinned = (roomId: string) => (parentsByRoom.get(roomId)?.size ?? 0) > 0;
  const draggedCenterY = (event: DragMoveEvent) => {
    const rect = event.active.rect.current.translated;
    return rect ? rect.top + rect.height / 2 : 0;
  };
  const instructionFor = (event: DragMoveEvent): SidebarInstructionType | undefined => {
    const active = readDrag(event.active.data);
    const over = event.over && readDrag(event.over.data);
    if (!active || !over || !event.over || event.over.id === event.active.id) return undefined;
    return dropInstruction(
      active,
      over,
      event.over.rect.top,
      event.over.rect.height,
      draggedCenterY(event)
    );
  };

  const commit = (
    item: SidebarDragItem,
    containerItem: SidebarDragItem,
    instructionType: SidebarInstructionType
  ) =>
    commitSidebarReorder({
      mx: client,
      orphanSpaces: topLevelSpaces,
      sidebarItems: items,
      accountDataSidebarItems: saved,
      item,
      containerItem,
      instructionType,
      setSpaceOrder: setLocalOrder,
    });

  const handleDragStart = (event: DragStartEvent) => {
    preventClickDefaultsDuringPointerDrag(event.activatorEvent);
  };
  const handleDragMove = (event: DragMoveEvent) => {
    const instruction = instructionFor(event);
    setHint(
      instruction && event.over ? { id: `${event.over.id}`, at: DROP_AT[instruction] } : undefined
    );
  };
  const handleDragEnd = (event: DragEndEvent) => {
    setHint(undefined);
    const instruction = instructionFor(event);
    const active = readDrag(event.active.data);
    const over = event.over && readDrag(event.over.data);
    if (!instruction || !active || !over) return;
    commit(active, over, instruction);
  };

  // The entries in the order the rail shows them, open folders' spaces included.
  const shownDrags: SidebarDragItem[] = items.flatMap((item): SidebarDragItem[] => {
    if (typeof item === 'string') return [item];
    const inside = openFolders.has(item.id)
      ? item.content.map((spaceId) => ({ folder: item, spaceId }))
      : [];
    return [{ folder: item }, ...inside];
  });
  const moveBy = (drag: SidebarDragItem, direction: -1 | 1) => {
    const index = shownDrags.findIndex((entry) => dragId(entry) === dragId(drag));
    const neighbour = shownDrags[index + direction];
    if (index < 0 || !neighbour) return;
    commit(drag, neighbour, direction < 0 ? 'reorder-above' : 'reorder-below');
  };

  const hintFor = (drag: SidebarDragItem) => (hint?.id === dragId(drag) ? hint.at : undefined);
  const toggleFolder = (folderId: string) => {
    const next = new Set(openFolders);
    if (next.has(folderId)) next.delete(folderId);
    else next.add(folderId);
    setOpenFolders(next);
  };

  const renderSpace = (spaceId: string, drag: SidebarDragItem) => {
    const space = joinedSpaces.get(spaceId);
    if (!space) return null;
    return (
      <SpaceTab
        key={dragId(drag)}
        space={space}
        selected={selectedSpaceId === spaceId}
        onSelect={onSelect}
        drag={drag}
        hint={hintFor(drag)}
        pinned={isPinned(spaceId)}
        onMove={(direction) => moveBy(drag, direction)}
      />
    );
  };

  const renderEntry = (item: SidebarEntry) => {
    if (typeof item === 'string') return renderSpace(item, item);
    const spaces = item.content
      .map((spaceId) => joinedSpaces.get(spaceId))
      .filter((space): space is Room => !!space);
    const open = openFolders.has(item.id);
    const folderTab = (
      <FolderTab
        key={dragId({ folder: item })}
        folder={item}
        spaces={spaces}
        open={open}
        onToggle={() => toggleFolder(item.id)}
        holdsSelected={!!selectedSpaceId && item.content.includes(selectedSpaceId)}
        hint={hintFor({ folder: item })}
        onMove={(direction) => moveBy({ folder: item }, direction)}
      />
    );
    if (!open) return folderTab;
    return (
      <div
        key={dragId({ folder: item })}
        className={css.FolderGroup}
        role="group"
        aria-label={folderLabel(item, spaces)}
      >
        {folderTab}
        {item.content.map((spaceId) => renderSpace(spaceId, { folder: item, spaceId }))}
      </div>
    );
  };

  // Spaces get their own stack under a rule, apart from the sections above them.
  return (
    <>
      <SidebarStackSeparator />
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setHint(undefined)}
        accessibility={{ announcements: silentAnnouncements }}
      >
        <SortableContext items={shownDrags.map(dragId)} strategy={keepInPlace}>
          <SidebarStack ref={stackRef} role="group" aria-label={t('sharedUi.roomTypes.spaces')}>
            {items.map(renderEntry)}
          </SidebarStack>
        </SortableContext>
      </DndContext>
    </>
  );
}
