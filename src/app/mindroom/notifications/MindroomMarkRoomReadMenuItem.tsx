import React from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Icon, Icons, Text } from 'folds';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { markRoomAndThreadsAsRead } from './readReceipts';

/** "Mark as read" in a room's menu: reads the room and every thread in it, then closes the menu. */
export function MindroomMarkRoomReadMenuItem({
  room,
  onClose,
}: {
  room: Room;











      onClick={() => {
        markRoomAndThreadsAsRead(mx, room.roomId, hideActivity);
        onClose();
      }}
    >
      <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
        {t('mindroomUi.notifications.mindroomMarkRoomReadMenuItem.markAsRead')}
      </Text>
    </MenuItem>
  );
}
