import React from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Icon, Icons, Spinner, Text, color } from 'folds';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useSelectedRoom } from '../../hooks/router/useSelectedRoom';
import { useCloseUserRoomProfile } from '../../state/hooks/userRoomProfile';
import { isMindroomAgentUserIdForViewer } from '../matrix/agentIdentity';
import { localizeVoiceErrorMessage } from '../voice/voiceErrorMessage';
import { hasMindroomVoiceCallsPresence, toAgentCallOrigin } from './agentCall';
import { useStartAgentCall } from './useStartAgentCall';

type AgentCallButtonProps = {
  /** The room the profile was opened from; a call started here remembers it as its origin. */
  roomId: string;
  userId: string;
  displayName?: string;
  /** The agent's presence status message, which advertises voice calls. */
  presenceStatus?: string;
};

/**
 * Calls a MindRoom agent from its profile. Offered only for voice-capable agents on the viewer's
 * homeserver; the conversation stays open and the profile closes once the call starts.
 */
export function AgentCallButton({
  roomId,
  userId,
  displayName,
  presenceStatus,
}: AgentCallButtonProps) {





  const { startAgentCall, supported, loading, error, unavailableReason } = useStartAgentCall();

  if (
    !supported ||
    !isMindroomAgentUserIdForViewer(userId, mx.getUserId() ?? undefined) ||
    !hasMindroomVoiceCallsPresence(presenceStatus)
  ) {
    return null;
  }

  // The open thread is the origin only when the profile belongs to the room on screen.
  const threadId =
    selectedRoomId === roomId ? searchParams.get('threadId') ?? undefined : undefined;

  const handleClick = async () => {
    const started = await startAgentCall(
      { userId, displayName },
      toAgentCallOrigin(roomId, threadId)
    );
    if (started) closeProfile();
  };

  const failure = error
    ? localizeVoiceErrorMessage(t, error, t('mindroomUi.calls.agentCallButton.startFailed'))
    : undefined;

  return (
    <Box direction="Column" gap="100">
      <Button
        size="300"
        variant="Secondary"
        fill="Soft"
        radii="300"
        disabled={loading || !!unavailableReason}
        before={
          loading ? (
            <Spinner size="100" variant="Secondary" fill="Soft" />
          ) : (
            <Icon size="100" src={Icons.Phone} />
          )
        }
        onClick={handleClick}
      >
        <Text size="B300">{t('mindroomUi.calls.agentCallButton.call')}</Text>
      </Button>
      {unavailableReason && (
        <Text size="T200" priority="300">
          {unavailableReason}
        </Text>
      )}
      {failure && (
        <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
          {failure}
        </Text>
      )}
    </Box>
  );
}
