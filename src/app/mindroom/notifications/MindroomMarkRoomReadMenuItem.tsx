import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { useMarkRoomsRead } from './useMarkRoomsRead';
import { MenuEntry } from '../../components/MenuEntry';

type MarkRoomReadItemProps = {
  /** The room whose main timeline and threads get read receipts. */
  room: Room;
  /** Dismisses the room menu once the receipts are on their way. */
  onClose: () => void;
};

/** "Mark as read" in a room's menu: reads the room and every thread in it, then closes the menu. */
export function MindroomMarkRoomReadMenuItem(props: MarkRoomReadItemProps) {
  const { t } = useTranslation();
  const markRoomsRead = useMarkRoomsRead();

  const markRead = () => {
    void markRoomsRead([props.room.roomId]);
    props.onClose();
  };

  return (
    <MenuEntry
      label={t('mindroomUi.notifications.mindroomMarkRoomReadMenuItem.markAsRead')}
      icon={Icons.CheckTwice}
      onSelect={markRead}
    />
  );
}
