import { Box, Text, config } from 'folds';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '../threads/overview/CompactRoomView.css';

/**
 * The start of a Compact room that has no thread at all, where its cards would begin: the same
 * "No threads" box the cards show when a filter hides them all. It stands in for the room's
 * intro, whose name and topic the header above already shows.
 */
export function CompactRoomWithoutThreads() {
  const { t } = useTranslation();
  return (
    <div data-compact-room-without-threads="" style={{ paddingInline: config.space.S300 }}>
      <Box className={EmptyState}>
        <Text size="T300" priority="300">
          {t('mindroomUi.threads.compactRoomView.noThreads')}
        </Text>
      </Box>
    </div>
  );
}
