import { useTranslation } from 'react-i18next';
import { Chip, Icon, Icons, Text } from 'folds';
import { useMarkRoomsRead } from './useMarkRoomsRead';
import { MarkReadChip } from './MarkRoomReadChip.css';

/**
 * The "Mark as read" chip shown with a room's unread messages; reads its threads too, then calls
 * `onMarked` once the receipt has been sent. Beside a long room name it keeps its label on one
 * line: the name shrinks instead.
 */
export function MarkRoomReadChip({ roomId, onMarked }: { roomId: string; onMarked?: () => void }) {
  const { t } = useTranslation();
  const markRead = useMarkRoomsRead();
  const checkIcon = <Icon size="50" src={Icons.CheckTwice} />;

  return (
    <Chip
      className={MarkReadChip}
      before={checkIcon}
      radii="Pill"
      variant="SurfaceVariant"
      style={{ flexShrink: 0 }}
      onClick={() => {
        void markRead([roomId]).then(onMarked);
      }}
    >
      <Text size="L400">{t('mindroomUi.notifications.mindroomMarkRoomReadChip.markAsRead')}</Text>
    </Chip>
  );
}
