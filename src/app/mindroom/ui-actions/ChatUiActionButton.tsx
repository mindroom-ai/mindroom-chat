import React, { useContext } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Box, Button, Icon, Icons, Text } from 'folds';
import type { ChatUiAction } from './chatUiProtocol';
import { ChatUiActionContext } from './ChatUiActionProvider';

const actionIcon = (action: ChatUiAction) => {
  switch (action.action) {
    case 'show_computer':
      return Icons.Monitor;
    case 'show_canvas':
      return Icons.Category;
    case 'open_settings':
      return Icons.Setting;
    default:
      return Icons.User;
  }
};

/**
 * The button under an agent's UI request notice ("View computer", "Open canvas", ...). It is
 * shown only to the user the request is for, and says why when the action cannot run now.
 */
export function ChatUiActionButton({ event }: { event: MatrixEvent }) {
  const { t } = useTranslation();
  const actions = useContext(ChatUiActionContext);
  const action = actions?.read(event);
  if (!actions || !action) return null;

  let label: string;
  switch (action.action) {
    case 'show_computer':
      label = t('mindroomUi.uiActions.viewComputer', { defaultValue: 'View computer' });
      break;
    case 'show_canvas':
      label = t('mindroomUi.uiActions.openCanvas', { defaultValue: 'Open canvas' });
      break;
    case 'open_settings':
      label = t('mindroomUi.uiActions.openSettings', { defaultValue: 'Open settings' });
      break;
    default:
      label = t('mindroomUi.uiActions.showMembers', { defaultValue: 'Show members' });
  }
  const reason = actions.unavailable(action);

  return (
    <Box direction="Column" alignItems="Start" gap="100" style={{ marginTop: '0.5rem' }}>
      <Button
        size="300"
        variant="Secondary"
        fill="Soft"
        radii="300"
        disabled={!!reason}
        before={<Icon size="100" src={actionIcon(action)} />}
        onClick={() => actions.activate(event)}
      >
        <Text size="B300">{label}</Text>
      </Button>
      {reason && (
        <Text size="T200" priority="300" role="note">
          {reason}
        </Text>
      )}
    </Box>
  );
}
