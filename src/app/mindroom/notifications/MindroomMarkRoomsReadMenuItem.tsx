import React from 'react';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text } from 'folds';
import { MenuItem } from '../../components/glass/GlassPrimitives';
import { useMarkRoomsRead } from './useMarkRoomsRead';

/**
 * "Mark all as read" in a list's menu (Home, a space): reads every listed room with its threads.
 * With nothing listed it stays in the menu, focusable but inert.
 */
export function MindroomMarkRoomsReadMenuItem({
  roomIds,
  onClose,
}: {
  roomIds: readonly string[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const markRead = useMarkRoomsRead();
  const empty = roomIds.length === 0;

  return (
    <MenuItem
      size="300"
      radii="300"
      after={<Icon size="100" src={Icons.CheckTwice} />}
      aria-disabled={empty || undefined}
      onClick={() => {
        if (empty) return;
        markRead(roomIds);
        onClose();
      }}
    >
      <Text style={{ flexGrow: 1 }} as="span" size="T300" truncate>
        {t('mindroomUi.notifications.mindroomMarkRoomsReadMenuItem.markAsRead')}
      </Text>
    </MenuItem>
  );
}
