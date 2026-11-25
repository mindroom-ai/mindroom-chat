import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Icon, IconButton, Icons, Text, color } from 'folds';
import type { Room } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomMembers } from '../../matrix/hooks/useRoomMembers';
import { ForkIcon } from '../../messages/ForkIcon';
import * as toolbarCss from '../../messages/styles.css';
import * as bannerCss from '../ThreadContextBanner.css';
import { targetHasUnsharedAgents } from './ForkToRoomDialog';

/**
 * Read-only header banner shown over a cross-room fork draft inside the target room: names the
 * source room, offers Back, and warns when agents in the target room cannot see the source room.
 */
export function CrossRoomForkDraftBanner({
  sourceRoom,
  targetRoom,
  onBack,
}: {
  sourceRoom: Room;
  targetRoom: Room;
  onBack?: () => void;
}) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const sourceMembers = useRoomMembers(client, sourceRoom.roomId);
  const targetMembers = useRoomMembers(client, targetRoom.roomId);
  const showAgentWarning = useMemo(
    () => targetHasUnsharedAgents(sourceMembers, targetMembers),
    [sourceMembers, targetMembers]
  );
  const sourceRoomName = sourceRoom.name || sourceRoom.roomId;

  return (
    <div className={bannerCss.Banner} data-cross-room-fork-banner="true">
      <Box direction="Column" gap="200">
        <Box alignItems="Center" gap="200" style={{ minWidth: 0 }}>
          {onBack && (
            <IconButton
              className={toolbarCss.MessageOptionsButton}
              variant="SurfaceVariant"
              fill="None"
              aria-label={t('thread.back')}
              onClick={onBack}
            >
              <Icon data-directional src={Icons.ArrowLeft} />
            </IconButton>
          )}
          <Icon size="100" src={ForkIcon} aria-hidden="true" />
          <Text size="H5" truncate>
            {t('threadFork.forkingFromRoom', { room: sourceRoomName })}
          </Text>
        </Box>
        {showAgentWarning && (
          <Box
            alignItems="Center"
            gap="200"
            data-cross-room-fork-agent-warning="true"
            style={{ color: color.Warning.Main }}
          >
            <Icon size="50" src={Icons.Warning} aria-hidden="true" />
            <Text size="T200">
              {t('threadFork.forkDraftAgentWarning', { room: sourceRoomName })}
            </Text>
          </Box>
        )}
      </Box>
    </div>
  );
}
