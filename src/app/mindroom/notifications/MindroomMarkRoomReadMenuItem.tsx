import React, { useCallback } from 'react';
import type { Room } from 'matrix-js-sdk';
import { Icon, Icons, MenuItem, Text } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useRoomUnread } from '../../state/hooks/unread';
import { useSetting } from '../../state/hooks/settings';
import { roomToUnreadAtom } from '../../state/room/roomToUnread';
import { settingsAtom } from '../../state/settings';
import { markRoomAndThreadsAsRead } from './readReceipts';

type MindroomMarkRoomReadMenuItemProps = {
  onClose: () => void;
  room: Room;
};

export function MindroomMarkRoomReadMenuItem({ onClose, room }: MindroomMarkRoomReadMenuItemProps) {
  const mx = useMatrixClient();
  const [hideActivity] = useSetting(settingsAtom, 'hideActivity');
  const unread = useRoomUnread(room.roomId, roomToUnreadAtom);

  const handleMarkAsRead = useCallback(() => {
    if (!unread) return;
    void markRoomAndThreadsAsRead(mx, room.roomId, hideActivity);
    onClose();
  }, [hideActivity, mx, onClose, room.roomId, unread]);

  return (
    <MenuItem
      onClick={handleMarkAsRead}
      size="300"
      after={<Icon size="100" src={Icons.CheckTwice} />}
      radii="300"
      aria-disabled={!unread}
    >
      <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
        Mark as Read
      </Text>
    </MenuItem>
  );
}
