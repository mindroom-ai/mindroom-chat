import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { MenuEntry } from '../ui/MenuEntry';
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
    <MenuEntry
      label={t('mindroomUi.notifications.mindroomMarkRoomsReadMenuItem.markAsRead')}
      icon={Icons.CheckTwice}
      aria-disabled={empty || undefined}
      onSelect={() => {
        if (empty) return;
        void markRead(roomIds);
        onClose();
      }}
    />
  );
}
