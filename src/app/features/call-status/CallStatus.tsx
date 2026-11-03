import React from 'react';
import { Box, Icon, IconButton, Icons, Line, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import type { CallEmbed } from '../../plugins/call/CallEmbed';
import { useCallJoined } from '../../hooks/useCallEmbed';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { useCallFailureNotice } from '../../mindroom/calls/useCallFailureNotice';
import { useCallFailureDismissal } from '../../mindroom/calls/useCallFailureDismissal';
import { ContainerColor } from '../../styles/ContainerColor.css';
import { LiveChip } from './LiveChip';
import { CallRoomName } from './CallRoomName';
import { CallControl } from './CallControl';
import * as css from './styles.css';












  const { room, startedAfterTs } = callEmbed as unknown as { room: Room; startedAfterTs?: number };
  const joined = useCallJoined(callEmbed);
  const selectedRoomId = useSelectedRoom();
  const failure = useCallFailureNotice(room, joined, startedAfterTs);
  const { dismissFailure, visibleFailure } = useCallFailureDismissal(joined, failure);
  const callRoomOpen = selectedRoomId === room.roomId;

  return (
    <Box direction="Column" className={ContainerColor({ variant: 'Background' })}>
      {visibleFailure && !callRoomOpen && (
        <Box
          alignItems="Center"
          gap="200"
          className={ContainerColor({ variant: 'Critical' })}
          style={{ padding: '4px 12px' }}
        >
          <Box grow="Yes" role="alert">
            <Text size="T200" style={{ color: color.Critical.OnContainer }}>
              {visibleFailure.message}
            </Text>
          </Box>
          <IconButton
            size="300"
            radii="300"
            variant="Critical"
            aria-label={t('featureUi.callStatus.dismissError')}
            onClick={dismissFailure}
          >
            <Icon size="50" src={Icons.Cross} />
          </IconButton>
        </Box>
      )}
      <Box className={css.CallStatus} alignItems="Center" gap="300">
        <LiveChip />
        <Box grow="Yes" style={{ minWidth: 0 }}>
          <CallRoomName room={room} />
        </Box>
        <Line className={css.ControlDivider} direction="Vertical" variant="Background" />
        <CallControl callEmbed={callEmbed} />
      </Box>
    </Box>
  );
}
