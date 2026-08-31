import React from 'react';
import { Box, Button, Spinner, Text } from 'folds';

import { AsyncState, AsyncStatus } from '../../../hooks/useAsyncCallback';
import { canRetryJoinRoom } from '../../../utils/joinRoom';

type InviteJoinActionsProps = {
  joinState: AsyncState<void, unknown>;
  leaveState: AsyncState<unknown, unknown>;
  onJoin: () => void;
  onLeave: () => void;
};

export function InviteJoinActions({
  joinState,
  leaveState,
  onJoin,
  onLeave,
}: InviteJoinActionsProps) {
  const joining =
    joinState.status === AsyncStatus.Loading || joinState.status === AsyncStatus.Success;
  const leaving =
    leaveState.status === AsyncStatus.Loading || leaveState.status === AsyncStatus.Success;
  const recoveryRequired =
    joinState.status === AsyncStatus.Error && !canRetryJoinRoom(joinState.error);
  const actionsDisabled = joining || leaving || recoveryRequired;

  return (
    <Box gap="200" shrink="No" alignItems="Center">
      <Button
        onClick={onLeave}
        size="300"
        variant="Secondary"
        radii="300"
        fill="Soft"
        disabled={actionsDisabled}
        before={leaving ? <Spinner variant="Secondary" size="100" /> : undefined}
      >
        <Text size="B300">Decline</Text>
      </Button>
      <Button
        onClick={onJoin}
        size="300"
        variant="Success"
        fill="Soft"
        radii="300"
        outlined
        disabled={actionsDisabled}
        before={joining ? <Spinner variant="Success" fill="Soft" size="100" /> : undefined}
      >
        <Text size="B300">Accept</Text>
      </Button>
    </Box>
  );
}
