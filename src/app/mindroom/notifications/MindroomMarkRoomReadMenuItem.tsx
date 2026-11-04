import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { Icon, Icons, Text } from 'folds';
import { markRoomAndThreadsAsRead } from './readReceipts';
import { settingsAtom } from '../../state/settings';
import { useSetting } from '../../state/hooks/settings';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { MenuItem } from '../../components/glass/GlassPrimitives';

type MarkRoomReadItemProps = {
  /** The room whose main timeline and threads get read receipts. */
  room: Room;
  /** Dismisses the room menu once the receipts are on their way. */
  onClose: () => void;
};

const labelStyle = { flexGrow: 1 } as const;

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
    <MenuItem
      onClick={markRead}
      after={<Icon size="100" src={Icons.CheckTwice} />}
      size="300"
      radii="300"
    >
      <Text as="span" size="T300" align="Left" truncate style={labelStyle}>
        {t('mindroomUi.notifications.mindroomMarkRoomReadMenuItem.markAsRead')}
      </Text>
    </MenuItem>
  );
}
