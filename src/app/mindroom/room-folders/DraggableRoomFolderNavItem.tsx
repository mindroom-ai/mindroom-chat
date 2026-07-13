import React, { CSSProperties } from 'react';
import { useDraggable, useDroppable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Box, Icon, IconButton, Icons, color, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { SidebarRowDragSource } from '../../components/sidebar/Sidebar.css';
import { RoomFolderNavRow } from './roomFolderNavRows';
import { RoomFolderDropTarget } from './roomFolderDnd';

const draggableRoomStyle = (
  transform: ReturnType<typeof useDraggable>['transform'],
  dragging: boolean,
  over: boolean
): CSSProperties => ({
  transform: CSS.Translate.toString(transform),
  opacity: dragging ? 0.45 : undefined,
  outline: over ? `${config.borderWidth.B600} solid ${color.Success.Main}` : undefined,
  borderRadius: config.radii.R400,
});

type DraggableRoomFolderNavItemProps = {
  row: Extract<RoomFolderNavRow, { type: 'room' }>;
  roomName: string;
  children: React.ReactNode;
};

export function DraggableRoomFolderNavItem({
  row,
  roomName,
  children,
}: DraggableRoomFolderNavItemProps) {
  const { t } = useTranslation();
  const draggable = useDraggable({
    id: `home-room:${row.key}`,
    data: { roomId: row.roomId },
  });
  const droppable = useDroppable({
    id: `home-room-drop:${row.key}`,
    data: {
      categoryKind: row.categoryKind,
      parentId: row.parentId,
    } satisfies RoomFolderDropTarget,
  });

  return (
    <div
      ref={(node) => {
        draggable.setNodeRef(node);
        droppable.setNodeRef(node);
      }}
      className={SidebarRowDragSource}
      style={draggableRoomStyle(draggable.transform, draggable.isDragging, droppable.isOver)}
      data-room-drag-row={row.roomId}
    >
      <Box alignItems="Center">
        <IconButton
          ref={draggable.setActivatorNodeRef}
          aria-label={t('nav.dragRoom', { room: roomName })}
          variant="Background"
          fill="None"
          size="300"
          radii="300"
          style={{ touchAction: 'none' }}
          {...draggable.attributes}
          {...draggable.listeners}
        >
          <Icon src={Icons.HorizontalDots} size="50" />
        </IconButton>
        <Box grow="Yes" style={{ minWidth: 0 }}>
          {children}
        </Box>
      </Box>
    </div>
  );
}
