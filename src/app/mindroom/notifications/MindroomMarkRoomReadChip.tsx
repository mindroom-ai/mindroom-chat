import React from 'react';
import { useTranslation } from 'react-i18next';
import { Chip, Icon, Icons, Text } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { markRoomAndThreadsAsRead } from './readReceipts';

/** The "Mark as read" chip shown with a room's unread messages; reads its threads too. */
export function MindroomMarkRoomReadChip({ roomId }: { roomId: string }) {









      onClick={() => markRoomAndThreadsAsRead(mx, roomId, hideActivity)}
    >
      <Text size="L400">{t('mindroomUi.notifications.markAsRead')}</Text>
    </Chip>
  );
}
