import { useContext, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Box, Button, Icon, Icons, Text } from 'folds';
import type { ChatUiAction } from '../matrix/protocol/chatUiProtocol';
import { ChatUiActionContext, type TextRequest } from './ChatUiActionProvider';
import { copyToClipboard } from '../lib/dom';

type CanvasAction = Extract<ChatUiAction, { action: 'show_canvas' }>;

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
  if (!useContext(ChatUiActionContext)?.textRequest) return null;
  return (
    <Text as="span" size="T200">
      {t('mindroomUi.uiActions.canvasOff')}
    </Text>
  );
}

/** With canvases off: a request for a text version, put in the thread's draft or else copied. */
function AskForText({ action, request }: { action: CanvasAction; request: TextRequest }) {
  const { t } = useTranslation();
  const text = t('mindroomUi.uiActions.textVersionRequest', { title: action.canvas.title });
  const offerAtom = useMemo(() => request.offer(action.threadId, text), [request, action, text]);
  // Follows the composer: Copy only while it holds other work (or the request), Ask once it is empty.
  const composer = useAtomValue(offerAtom);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [composer]);
  if (!request.canPost) return null;
  const onClick = () => {
    if (composer === 'empty') request.fill(action, text);
    else void copyToClipboard(text).then(setCopied);
  };
  const status = { empty: 'hint', offered: 'added', busy: copied ? 'copied' : 'kept' } as const;
  return (
    <Box alignItems="Center" gap="300" wrap="Wrap" style={{ marginTop: '0.5rem' }}>
      <Button size="300" variant="Secondary" fill="Soft" radii="300" onClick={onClick}>
        <Text size="B300">
          {t(
            composer === 'empty'
              ? 'mindroomUi.uiActions.askForText'
              : 'mindroomUi.uiActions.copyRequest'
          )}
        </Text>
      </Button>
      <Text size="T200" priority="300" role="status">
        {t(`mindroomUi.uiActions.askForTextStatus.${status[composer]}`)}
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
  if (action.action === 'show_canvas' && actions.textRequest) {
    return <AskForText action={action} request={actions.textRequest} />;
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
