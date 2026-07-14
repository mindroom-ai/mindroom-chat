import React from 'react';
import { useTranslation } from 'react-i18next';
import { SortableRoomNavItemContainer } from '../../features/room-nav/SortableRoomNavItem';
import { RoomFolderNavRow } from './roomFolderNavRows';
import { RoomFolderDropTarget } from './roomFolderDnd';

type DraggableRoomFolderNavItemProps = {
  row: Extract<RoomFolderNavRow, { type: 'room' }>;
  roomName: string;
  disabled?: boolean;
  children: React.ReactNode;
};

/**
 * Home uses the same whole-row sortable interaction as the Space navigator.
 * The additional data keeps cross-group folder and Space drops available.
 */
export function DraggableRoomFolderNavItem({
  row,
  roomName,
  disabled,
  children,
}: DraggableRoomFolderNavItemProps) {
  const { t } = useTranslation();
  return (
    <SortableRoomNavItemContainer
      groupId={row.roomOrderKey}
      roomId={row.roomId}
      disabled={disabled}
      dragLabel={t('nav.dragRoom', { room: roomName })}
      data={
        {
          categoryKind: row.categoryKind,
          parentId: row.parentId,
          roomOrderKey: row.roomOrderKey,
          targetRoomId: row.roomId,
        } satisfies RoomFolderDropTarget
      }
    >
      {children}
    </SortableRoomNavItemContainer>
  );
}
