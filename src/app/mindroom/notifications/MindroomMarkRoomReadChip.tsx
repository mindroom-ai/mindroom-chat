import { useTranslation } from 'react-i18next';
import { Chip, Icon, Icons, Text } from 'folds';
import { useMarkRoomsRead } from './useMarkRoomsRead';

/** The "Mark as read" chip shown with a room's unread messages; reads its threads too. */
export function MindroomMarkRoomReadChip({ roomId }: { roomId: string }) {
  const { t } = useTranslation();
  const markRead = useMarkRoomsRead();
  const checkIcon = <Icon size="50" src={Icons.CheckTwice} />;

  return (
    <Chip
      before={checkIcon}
      radii="Pill"
      variant="SurfaceVariant"
      onClick={() => markRead([roomId])}
    >
      <Text size="L400">{t('mindroomUi.notifications.mindroomMarkRoomReadChip.markAsRead')}</Text>
    </Chip>
  );
}
