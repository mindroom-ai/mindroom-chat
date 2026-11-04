import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { Icons } from 'folds';
import { markRoomAndThreadsAsRead } from './readReceipts';
import { settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import { useMatrixClient } from '../../hooks/useMatrixClient';
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
  const mx = useMatrixClient();
  // A private receipt when the user hides their read activity.
  const [privateReceipts] = useSetting(settingsAtom, 'hideActivity');

  const markRead = () => {
    void markRoomAndThreadsAsRead(mx, props.room.roomId, privateReceipts);
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
