import React, { useCallback } from 'react';
import { Icon, Icons, MenuItem, Text } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomsUnread } from '../../state/hooks/unread';
import { useSetting } from '../../state/hooks/settings';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { settingsAtom } from '../../state/settings';
import { markRoomAndThreadsAsRead } from './readReceipts';

type MindroomMarkRoomsReadMenuItemProps = {
  onClose: () => void;
  roomIds: string[];
};

export function MindroomMarkRoomsReadMenuItem({
  onClose,
  roomIds,
}: MindroomMarkRoomsReadMenuItemProps) {
  const mx = useMatrixClient();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const unread = useRoomsUnread(roomIds, roomToUnreadAtom);

  const handleMarkAsRead = useCallback(() => {
    if (!unread) return;
    roomIds.forEach((roomId) => {
      void markRoomAndThreadsAsRead(mx, roomId, hideActivity);
    });
    onClose();
  }, [hideActivity, mx, onClose, roomIds, unread]);

  return (
    <MenuItem
      onClick={handleMarkAsRead}
      size="300"
      after={<Icon size="100" src={Icons.CheckTwice} />}
      radii="300"
      aria-disabled={!unread}
      disabled={!unread}
    >
      <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
        Mark as Read
      </Text>
    </MenuItem>
  );
}
