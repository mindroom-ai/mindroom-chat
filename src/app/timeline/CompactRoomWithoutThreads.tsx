import { Box, Button, Text, config } from 'folds';
import { useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';
import { tourAtom } from '../navigation/tourState';
import { EmptyState } from '../threads/overview/CompactRoomView.css';

/**
 * The start of a Compact room that has no thread at all, where its cards would begin: the same
 * "No threads" box the cards show when a filter hides them all, which here also says how to start
 * a thread and opens the Quick tour. It stands in for the room's intro, whose name and topic the
 * header above already shows.
 */
export function CompactRoomWithoutThreads() {
  const { t } = useTranslation();
  const setTour = useSetAtom(tourAtom);
  return (
    <div data-compact-room-without-threads="" style={{ paddingInline: config.space.S300 }}>
      <Box className={EmptyState}>
        <Box direction="Column" alignItems="Center" gap="100">
          <Text size="T300" priority="300" align="Center">
            {t('mindroomUi.threads.compactRoomView.noThreads')}
          </Text>
          <Text size="T300" priority="300" align="Center">
            {t('tour.entries.noThreadsHint')}
          </Text>
          <Button
            data-tour-entry="empty-room"
            size="300"
            radii="300"
            variant="Primary"
            fill="None"
            onClick={() => setTour({ level: 'quick' })}
          >
            <Text size="B300">{t('tour.entries.howThreadsWork')}</Text>
          </Button>
        </Box>
      </Box>
    </div>
  );
}
