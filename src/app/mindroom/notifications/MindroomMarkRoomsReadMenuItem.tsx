import React, { useCallback } from 'react';
import { Icon, Icons, MenuItem, Text } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSetting } from '../../state/hooks/settings';
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

  const handleMarkAsRead = useCallback(() => {
    if (roomIds.length === 0) return;
    roomIds.forEach((roomId) => {
      void markRoomAndThreadsAsRead(mx, roomId, hideActivity);
    });
    onClose();
  }, [hideActivity, mx, onClose, roomIds]);

  return (
    <MenuItem
      onClick={handleMarkAsRead}
      size="300"
      after={<Icon size="100" src={Icons.CheckTwice} />}
      radii="300"
      aria-disabled={roomIds.length === 0}
    >
      <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
        Mark as Read
      </Text>
    </MenuItem>
  );
}
