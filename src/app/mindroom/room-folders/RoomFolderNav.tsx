import React, { MouseEventHandler, useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  DragCancelEvent,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Icon,
  IconButton,
  Icons,
  Menu,
  MenuItem,
  PopOut,
  RectCords,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import { useAtom, useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { NavCategory, NavCategoryHeader } from '../../components/nav';
import { VirtualTile } from '../../components/virtualizer';
import { RoomNavCategoryButton, RoomNavItem } from '../../features/room-nav';
import {
  makeRoomSortableId,
  parseRoomSortableId,
} from '../../features/room-nav/SortableRoomNavItem';
import {
  RoomsNotificationPreferences,
  getRoomNotificationMode,
} from '../../hooks/useRoomsNotificationPreferences';
import { useCategoryHandler } from '../../hooks/useCategoryHandler';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useClosedNavCategoriesAtom } from '../../state/hooks/closedNavCategories';
import { roomToParentsAtom } from '../../state/room/roomToParents';
import { RoomToUnread } from '../../../types/matrix/room';
import { stopPropagation } from '../../utils/keyboard';
import { getCanonicalAliasOrRoomId } from '../../utils/matrix';
import { getHomeRoomPath, getSpacePath } from '../../pages/pathUtils';
import { suppressNextClickDefaultAfterPointerDrag } from '../../utils/sortableDrag';
import { DeleteRoomFolderPrompt, RoomFolderPrompt } from './RoomFolderPrompt';
import { AddRoomToSpacePrompt } from './AddRoomToSpacePrompt';
import { CreateRoomInSpaceButton } from './CreateRoomInSpaceButton';
import { DraggableRoomFolderNavItem } from './DraggableRoomFolderNavItem';
import { RoomFolderDropTarget, placeRoomInOrder, resolveRoomFolderDrop } from './roomFolderDnd';
import { useRoomFolders } from './RoomFoldersProvider';
import { RoomFolder } from './roomFolders';
import {
  RoomFolderNavRow,
  buildRoomFolderNavRows,
  collectRoomIdsByOrderKey,
} from './roomFolderNavRows';
import { useRoomFolderNavVirtualizer } from './useRoomFolderNavVirtualizer';
import { PendingSpaceDrop, useResolvedPendingSpaceDrop } from './useResolvedPendingSpaceDrop';

type DropTargetData = RoomFolderDropTarget;
const NO_CLOSED_CATEGORIES = new Set<string>();

function DroppableCategory({
  row,
  children,
}: {
  row: Extract<RoomFolderNavRow, { type: 'header' }>;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `home-category:${row.key}`,
    data: {
      categoryKind: row.categoryKind,
      parentId: row.folder?.id ?? row.spaceId,
      roomOrderKey: row.roomOrderKey,
    } satisfies DropTargetData,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        outline: isOver ? `${config.borderWidth.B600} solid ${color.Success.Main}` : undefined,
        borderRadius: config.radii.R400,
      }}
    >
      {children}
    </div>
  );
}

function FolderHeaderMenu({ folder }: { folder: RoomFolder }) {
  const { t } = useTranslation();
  const { renameFolder, deleteFolder } = useRoomFolders();
  const [anchor, setAnchor] = useState<RectCords>();
  const [rename, setRename] = useState(false);
  const [remove, setRemove] = useState(false);

  const handleOpen: MouseEventHandler<HTMLButtonElement> = (event) => {
    event.stopPropagation();
    setAnchor(event.currentTarget.getBoundingClientRect());
  };

  return (
    <>
      <PopOut
        anchor={anchor}
        position="Bottom"
        align="End"
        content={
          <FocusTrap
            focusTrapOptions={{
              initialFocus: false,
              returnFocusOnDeactivate: false,
              onDeactivate: () => setAnchor(undefined),
              clickOutsideDeactivates: true,
              escapeDeactivates: stopPropagation,
            }}
          >
            <Menu style={{ maxWidth: toRem(180), width: '100vw' }}>
              <Box direction="Column" gap="100" style={{ padding: config.space.S100 }}>
                <MenuItem
                  onClick={() => {
                    setAnchor(undefined);
                    setRename(true);
                  }}
                  size="300"
                  after={<Icon size="100" src={Icons.Pencil} />}
                  radii="300"
                >
                  <Text style={{ flexGrow: 1 }} size="T300">
                    {t('nav.renameRoomFolder')}
                  </Text>
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setAnchor(undefined);
                    setRemove(true);
                  }}
                  variant="Critical"
                  fill="None"
                  size="300"
                  after={<Icon size="100" src={Icons.Delete} />}
                  radii="300"
                >
                  <Text style={{ flexGrow: 1 }} size="T300">
                    {t('nav.deleteRoomFolder')}
                  </Text>
                </MenuItem>
              </Box>
            </Menu>
          </FocusTrap>
        }
      >
        <IconButton
          onClick={handleOpen}
          aria-label={t('nav.roomFolderOptions', { name: folder.name })}
          aria-pressed={!!anchor}
          variant="Background"
          fill="None"
          size="300"
          radii="300"
        >
          <Icon src={Icons.VerticalDots} size="50" />
        </IconButton>
      </PopOut>
      {rename && (
        <RoomFolderPrompt
          initialName={folder.name}
          onSubmit={(name) => renameFolder(folder.id, name)}
          onCancel={() => setRename(false)}
        />
      )}
      {remove && (
        <DeleteRoomFolderPrompt
          folderName={folder.name}
          onDelete={() => deleteFolder(folder.id)}
          onCancel={() => setRemove(false)}
        />
      )}
    </>
  );
}

type RoomFolderNavProps = {
  roomIds: string[];
  spaceIds: string[];
  selectedRoomId?: string;
  notificationPreferences: RoomsNotificationPreferences;
  roomToUnread: RoomToUnread;
  scrollElement: HTMLDivElement | null;
};

export function RoomFolderNav({
  roomIds,
  spaceIds,
  selectedRoomId,
  notificationPreferences,
  roomToUnread,
  scrollElement,
}: RoomFolderNavProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const navigate = useNavigate();
  const roomToParents = useAtomValue(roomToParentsAtom);
  const { folders, roomOrder, moveRoom, reorderRooms, saveError } = useRoomFolders();
  const [draggedRoomId, setDraggedRoomId] = useState<string>();
  const [pendingSpaceDrop, setPendingSpaceDrop] = useState<PendingSpaceDrop>();
  const clearPendingSpaceDrop = useCallback(() => setPendingSpaceDrop(undefined), []);
  const resolvedPendingSpaceDrop = useResolvedPendingSpaceDrop(
    mx,
    pendingSpaceDrop,
    roomIds,
    spaceIds,
    clearPendingSpaceDrop
  );
  const [closedCategories, setClosedCategories] = useAtom(useClosedNavCategoriesAtom());
  const handleCategoryClick = useCategoryHandler(setClosedCategories, (categoryId) =>
    closedCategories.has(categoryId)
  );
  const rows = useMemo(
    () =>
      buildRoomFolderNavRows(
        mx,
        roomIds,
        spaceIds,
        roomToParents,
        folders,
        roomOrder,
        closedCategories,
        roomToUnread,
        selectedRoomId
      ),
    [
      closedCategories,
      folders,
      mx,
      roomIds,
      roomOrder,
      roomToParents,
      roomToUnread,
      selectedRoomId,
      spaceIds,
    ]
  );
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const virtualizer = useRoomFolderNavVirtualizer(rows.length, scrollElement);
  const expandedRoomIdsByOrderKey = useMemo(() => {
    const expandedRows = buildRoomFolderNavRows(
      mx,
      roomIds,
      spaceIds,
      roomToParents,
      folders,
      roomOrder,
      NO_CLOSED_CATEGORIES,
      roomToUnread,
      selectedRoomId
    );
    return collectRoomIdsByOrderKey(expandedRows);
  }, [folders, mx, roomIds, roomOrder, roomToParents, roomToUnread, selectedRoomId, spaceIds]);
  const sortableRoomIds = useMemo(
    () =>
      rows.flatMap((row) =>
        row.type === 'room' ? [makeRoomSortableId(row.roomOrderKey, row.roomId)] : []
      ),
    [rows]
  );

  const makePlacement = (roomId: string, target: DropTargetData) => {
    const targetRoomIds = expandedRoomIdsByOrderKey.get(target.roomOrderKey) ?? [];
    return {
      orderKey: target.roomOrderKey,
      roomIds: placeRoomInOrder(targetRoomIds, roomId, target.targetRoomId),
    };
  };

  const handleDragStart = (event: DragStartEvent) => {
    setDraggedRoomId((event.active.data.current as { roomId?: string } | undefined)?.roomId);
  };
  const handleDragEnd = (event: DragEndEvent) => {
    suppressNextClickDefaultAfterPointerDrag(event.activatorEvent);
    setDraggedRoomId(undefined);
    const roomId = (event.active.data.current as { roomId?: string } | undefined)?.roomId;
    const target = event.over?.data.current as DropTargetData | undefined;
    if (!roomId || !target) return;

    const activeRoom = parseRoomSortableId(event.active.id.toString());
    const overRoom = event.over ? parseRoomSortableId(event.over.id.toString()) : undefined;
    if (
      activeRoom &&
      overRoom &&
      activeRoom.parentSpaceId === overRoom.parentSpaceId &&
      activeRoom.roomId !== overRoom.roomId
    ) {
      const groupRoomIds = rows.flatMap((row) =>
        row.type === 'room' && row.roomOrderKey === activeRoom.parentSpaceId ? [row.roomId] : []
      );
      const oldIndex = groupRoomIds.indexOf(activeRoom.roomId);
      const newIndex = groupRoomIds.indexOf(overRoom.roomId);
      if (oldIndex >= 0 && newIndex >= 0) {
        void reorderRooms(
          activeRoom.parentSpaceId,
          arrayMove(groupRoomIds, oldIndex, newIndex)
        ).catch(() => undefined);
      }
      return;
    }
    if (activeRoom?.parentSpaceId === target.roomOrderKey) return;

    const currentFolderId = folders.find((folder) => folder.roomIds.includes(roomId))?.id;
    const action = resolveRoomFolderDrop(roomId, target, roomToParents, currentFolderId);
    const placement = makePlacement(roomId, target);
    if (action?.type === 'move-personal') {
      void moveRoom(action.roomId, action.folderId, placement).catch(() => undefined);
    }
    if (action?.type === 'add-to-space') {
      setPendingSpaceDrop({ roomId: action.roomId, spaceId: action.spaceId, placement });
    }
  };
  const handleDragCancel = (event: DragCancelEvent) => {
    suppressNextClickDefaultAfterPointerDrag(event.activatorEvent);
    setDraggedRoomId(undefined);
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={{
        announcements: {
          onDragStart({ active }) {
            const roomId = (active.data.current as { roomId?: string } | undefined)?.roomId;
            return t('nav.roomDragStarted', { room: mx.getRoom(roomId ?? '')?.name ?? roomId });
          },
          onDragOver({ over }) {
            const target = over?.data.current as DropTargetData | undefined;
            if (!target) return undefined;
            const name =
              target.categoryKind === 'folder'
                ? folders.find((folder) => folder.id === target.parentId)?.name
                : target.categoryKind === 'space'
                ? mx.getRoom(target.parentId ?? '')?.name
                : t('nav.rooms');
            if (target.targetRoomId) {
              return t('nav.roomDragOverRoom', {
                room: mx.getRoom(target.targetRoomId)?.name ?? target.targetRoomId,
                target: name,
              });
            }
            return t('nav.roomDragOver', { target: name });
          },
          onDragEnd({ active, over }) {
            const roomId = (active.data.current as { roomId?: string } | undefined)?.roomId;
            const target = over?.data.current as DropTargetData | undefined;
            if (!roomId || !target) return t('nav.roomDragNoChange');
            const activeRoom = parseRoomSortableId(active.id.toString());
            const overRoom = over ? parseRoomSortableId(over.id.toString()) : undefined;
            if (
              activeRoom &&
              overRoom &&
              activeRoom.parentSpaceId === overRoom.parentSpaceId &&
              activeRoom.roomId !== overRoom.roomId
            ) {
              return t('nav.roomDragEnded');
            }
            const currentFolderId = folders.find((folder) => folder.roomIds.includes(roomId))?.id;
            return resolveRoomFolderDrop(roomId, target, roomToParents, currentFolderId)
              ? t('nav.roomDragEnded')
              : t('nav.roomDragNoChange');
          },
          onDragCancel() {
            return t('nav.roomDragCancelled');
          },
        },
      }}
    >
      <SortableContext items={sortableRoomIds} strategy={verticalListSortingStrategy}>
        <NavCategory>
          {saveError && (
            <Text
              role="alert"
              size="T200"
              style={{ color: color.Critical.Main, padding: `0 ${config.space.S200}` }}
            >
              {t('nav.roomFolderSaveFailed')}
            </Text>
          )}
          <div style={{ position: 'relative', height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtualItem) => {
              const row = rows[virtualItem.index];
              if (!row) return null;

              return (
                <VirtualTile
                  virtualItem={virtualItem}
                  key={row.key}
                  ref={virtualizer.measureElement}
                >
                  {row.type === 'header' ? (
                    <DroppableCategory row={row}>
                      <NavCategoryHeader>
                        <Icon
                          size="100"
                          src={
                            row.categoryKind === 'space'
                              ? Icons.Space
                              : row.categoryKind === 'folder'
                              ? Icons.Category
                              : Icons.Hash
                          }
                        />
                        <RoomNavCategoryButton
                          closed={closedCategories.has(row.categoryId)}
                          data-category-id={row.categoryId}
                          onClick={handleCategoryClick}
                        >
                          {row.folder?.name ??
                            (row.spaceId
                              ? mx.getRoom(row.spaceId)?.name ?? row.spaceId
                              : t('nav.rooms'))}
                        </RoomNavCategoryButton>
                        {row.folder && <FolderHeaderMenu folder={row.folder} />}
                        {row.spaceId && mx.getRoom(row.spaceId) && (
                          <CreateRoomInSpaceButton space={mx.getRoom(row.spaceId)!} />
                        )}
                        {row.spaceId && (
                          <IconButton
                            onClick={() =>
                              navigate(
                                getSpacePath(getCanonicalAliasOrRoomId(mx, row.spaceId as string))
                              )
                            }
                            aria-label={t('nav.openSpace', {
                              name: mx.getRoom(row.spaceId)?.name ?? row.spaceId,
                            })}
                            variant="Background"
                            fill="None"
                            size="300"
                            radii="300"
                          >
                            <Icon src={Icons.ArrowRight} size="50" />
                          </IconButton>
                        )}
                      </NavCategoryHeader>
                    </DroppableCategory>
                  ) : (
                    (() => {
                      const room = mx.getRoom(row.roomId);
                      if (!room) return null;
                      const roomIdOrAlias = getCanonicalAliasOrRoomId(mx, row.roomId);
                      return (
                        <DraggableRoomFolderNavItem
                          row={row}
                          roomName={room.name}
                          disabled={closedCategories.has(row.categoryId)}
                        >
                          <RoomNavItem
                            room={room}
                            selected={selectedRoomId === row.roomId}
                            linkPath={getHomeRoomPath(roomIdOrAlias)}
                            notificationMode={getRoomNotificationMode(
                              notificationPreferences,
                              room.roomId
                            )}
                            manageRoomFolders
                          />
                        </DraggableRoomFolderNavItem>
                      );
                    })()
                  )}
                </VirtualTile>
              );
            })}
          </div>
        </NavCategory>
      </SortableContext>
      <DragOverlay>
        {draggedRoomId ? (
          <Box
            style={{
              padding: `${config.space.S100} ${config.space.S300}`,
              backgroundColor: color.Surface.Container,
              borderRadius: config.radii.R400,
            }}
          >
            <Text size="B300">{mx.getRoom(draggedRoomId)?.name ?? draggedRoomId}</Text>
          </Box>
        ) : null}
      </DragOverlay>
      {resolvedPendingSpaceDrop && (
        <AddRoomToSpacePrompt
          room={resolvedPendingSpaceDrop.room}
          space={resolvedPendingSpaceDrop.space}
          onAdded={() => {
            void reorderRooms(
              resolvedPendingSpaceDrop.pending.placement.orderKey,
              resolvedPendingSpaceDrop.pending.placement.roomIds
            ).catch(() => undefined);
          }}
          onCancel={clearPendingSpaceDrop}
        />
      )}
    </DndContext>
  );
}
