import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Box, Button, Icon, Icons, Text } from 'folds';
import type { ChatUiAction } from '../matrix/protocol/chatUiProtocol';
import { ChatUiActionContext } from './ChatUiActionProvider';
import { copyToClipboard } from '../lib/dom';

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

/** Beside a canvas's title while canvases are off in this app: why it stays shut. */
export function CanvasOffNote() {
  const { t } = useTranslation();
  if (!useContext(ChatUiActionContext)?.askForText) return null;
  return (
    <Text as="span" size="T200" priority="300">
      {t('mindroomUi.uiActions.canvasOff')}
    </Text>
  );
}

/** With canvases off: a request for a text version, put in the thread's draft or else copied. */
function AskForText({ title, ask }: { title: string; ask: (text: string) => boolean }) {
  const { t } = useTranslation();
  const [state, setState] = useState<'hint' | 'added' | 'kept' | 'copied'>('hint');
  const request = t('mindroomUi.uiActions.textVersionRequest', { title });
  const copying = state === 'kept' || state === 'copied';
  const onClick = () => {
    if (!copying) setState(ask(request) ? 'added' : 'kept');
    else copyToClipboard(request).then((copied) => copied && setState('copied'));
  };
  return (
    <Box alignItems="Center" gap="300" wrap="Wrap" style={{ marginTop: '0.5rem' }}>
      <Button size="300" variant="Secondary" fill="Soft" radii="300" onClick={onClick}>
        <Text size="B300">
          {t(copying ? 'mindroomUi.uiActions.copyRequest' : 'mindroomUi.uiActions.askForText')}
        </Text>
      </Button>
      <Text size="T200" priority="300" role="status">
        {t(`mindroomUi.uiActions.askForTextStatus.${state}`)}
      </Text>
    </Box>
  );
}

/**
 * The button under an agent's UI request notice ("View computer", "Open canvas", ...). It is
 * shown only to the user the request is for, a canvas's to every joined member, and says why when
 * the action cannot run now.
 */
export function ChatUiActionButton({ event }: { event: MatrixEvent }) {
  const { t } = useTranslation();
  const actions = useContext(ChatUiActionContext);
  const action = actions?.read(event);
  if (!actions || !action) return null;
  const { askForText } = actions;
  if (action.action === 'show_canvas' && askForText) {
    return <AskForText title={action.canvas.title} ask={(text) => askForText(action, text)} />;
  }

  let label: string;
  switch (action.action) {
    case 'show_computer':
      label = t('mindroomUi.uiActions.viewComputer', { defaultValue: 'View computer' });
      break;
    case 'show_canvas':
      label = t('mindroomUi.uiActions.openCanvas', { defaultValue: 'Open canvas' });
      break;
    case 'open_settings':
      label = t('commandPalette.actions.openSettings', { defaultValue: 'Open Settings' });
      break;
    default:
      label = t('mindroomUi.uiActions.openMembers', { defaultValue: 'Open Members' });
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
