import React from 'react';
import { Box, Button, Text, color } from 'folds';

import { getJoinRoomErrorMessage, isRecoverableJoinRoomError } from '../../utils/joinRoom';

type JoinRoomErrorPromptProps = {
  error: unknown;
  onReload?: () => void;
};

export function JoinRoomErrorPrompt({ error, onReload }: JoinRoomErrorPromptProps) {
  const recoverable = isRecoverableJoinRoomError(error);
  const reload = onReload ?? (() => window.location.reload());

  return (
    <Box direction="Column" gap="200">
      <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
        {getJoinRoomErrorMessage(error)}
      </Text>
      {recoverable && (
        <Box>
          <Button
            aria-label="Reload app"
            onClick={reload}
            size="300"
            variant="Secondary"
            fill="Soft"
          >
            <Text size="B300">Reload App</Text>
          </Button>
        </Box>
      )}
    </Box>
  );
}
