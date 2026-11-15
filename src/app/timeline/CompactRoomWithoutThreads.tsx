import { Box, Button, Text, config } from 'folds';
import { useSetAtom } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { tourAtom } from '../navigation/tourState';
import { EmptyState } from '../threads/overview/CompactRoomView.css';

/**
 * The start of a Compact room that has no thread at all, where its cards would begin: the same
 * "No threads" box the cards show when a filter hides them all, which here also says how to start
 * a thread, to someone who may send messages in the room, and opens the Quick tour. It stands in
 * for the room's intro, whose name and topic the header above already shows.
 */
export function CompactRoomWithoutThreads({ room }: { room: Room }) {
  const { t } = useTranslation();
  const setTour = useSetAtom(tourAtom);
  // The hint points at the composer, which a room that takes no messages from this person
  // does not show.
  const myUserId = useMatrixClient().getSafeUserId();
  const canSend = useRoomPermissions(useRoomCreators(room), usePowerLevelsContext()).event(
    'm.room.message',
    myUserId
  );
  return (
    <div data-compact-room-without-threads="" style={{ paddingInline: config.space.S300 }}>
      <Box className={EmptyState}>
        <Box direction="Column" alignItems="Center" gap="100">
          <Text size="T300" priority="300" align="Center">
            {t('mindroomUi.threads.compactRoomView.noThreads')}
          </Text>
          {canSend && (
            <Text size="T300" priority="300" align="Center">
              {t('tour.entries.noThreadsHint')}
            </Text>
          )}
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
