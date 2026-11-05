import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { Box, Button, Icon, Icons, Spinner, Text, color } from 'folds';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { isMindroomAgentUserIdForViewer } from '../../matrix/protocol/agentIdentity';
import { hasVoiceCallsPresence } from './agentCall';
import { usePresenceStatuses } from './agentPresence';
import { AGENT_CALL_ERROR_KEYS, useAgentCaller } from './agentCaller';

type AgentCallButtonProps = {
  /** The room the profile was opened from; a call started here remembers it as its origin. */
  roomId: string;
  userId: string;
  displayName?: string;
  /** The agent's presence status message, which advertises voice calls. */
  presenceStatus?: string;
  /** The call started, so the profile can close. */
  onStarted?: () => void;
};

/**
 * The profile's "Call" button for a voice-capable MindRoom agent. The call is about the room the
 * profile was opened from, and about its open thread when the profile was opened inside one.
 */
export function AgentCallButton({
  roomId,
  userId,
  displayName,
  presenceStatus,
  onStarted,
}: AgentCallButtonProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const [search] = useSearchParams();
  const statuses = usePresenceStatuses(mx, presenceStatus === undefined ? [userId] : []);
  const status = presenceStatus ?? statuses.get(userId);
  const { call, pending, error } = useAgentCaller();

  if (
    !isMindroomAgentUserIdForViewer(userId, mx.getUserId() ?? undefined) ||
    !hasVoiceCallsPresence(status)
  ) {
    return null;
  }

  const start = async () => {
    const started = await call({
      agentUserId: userId,
      displayName,
      roomId,
      threadId: search.get('threadId') ?? undefined,
    });
    if (started) onStarted?.();
  };

  return (
    <Box direction="Column" gap="100">
      <Button
        size="300"
        radii="300"
        variant="Success"
        fill="Soft"
        disabled={pending}
        before={
          pending ? <Spinner size="100" variant="Success" /> : <Icon size="100" src={Icons.Phone} />
        }
        onClick={() => void start()}
      >
        <Text size="B300">{t('mindroomUi.calls.agentCallButton.call')}</Text>
      </Button>
      {error && (
        <Text size="T200" style={{ color: color.Critical.Main }} role="alert">
          {t(AGENT_CALL_ERROR_KEYS[error])}
        </Text>
      )}
    </Box>
  );
}
