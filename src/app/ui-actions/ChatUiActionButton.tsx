import { useContext, useEffect, useMemo, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import type { MatrixEvent } from 'matrix-js-sdk';
import { Box, Button, Icon, Icons, Text } from 'folds';
import type { ChatUiAction } from '../matrix/protocol/chatUiProtocol';
import { ChatUiActionContext, type TextRequest } from './ChatUiActionProvider';
import { copyToClipboard } from '../lib/dom';
import { useRoom } from '../matrix/hooks/useRoom';
import { usePowerLevelsContext } from '../matrix/hooks/usePowerLevels';
import { useRoomCreators } from '../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../matrix/hooks/useRoomPermissions';
import { useStateEvent } from '../matrix/hooks/useStateEvent';
import { StateEvent } from '../matrix/types/room';

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

/** Canvases off: says so (outside the dimmed notice body), and offers a text-version request. */
function AskForText({ action, request }: { action: CanvasAction; request: TextRequest }) {
  const { t } = useTranslation();
  const text = t('mindroomUi.uiActions.textVersionRequest', { title: action.canvas.title });
  const offerAtom = useMemo(() => request.offer(action.threadId, text), [request, action, text]);
  // Follows the composer: Copy only while it holds other work (or the request), Ask once it is empty.
  const composer = useAtomValue(offerAtom);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [composer]);
  // No request where no composer shows: an upgraded room, or one this member cannot post in.
  const room = useRoom();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevelsContext());
  const canPost =
    !useStateEvent(room, StateEvent.RoomTombstone) &&
    permissions.event('m.room.message', room.client.getSafeUserId());
  const onClick = () => {
    if (composer === 'empty') request.fill(action, text);
    else void copyToClipboard(text).then(setCopied);
  };
  const status = { empty: 'hint', offered: 'added', busy: copied ? 'copied' : 'kept' } as const;
  return (
    <Box direction="Column" alignItems="Start" gap="200" style={{ marginTop: '0.25rem' }}>
      <Text size="T200" priority="400">
        {t('mindroomUi.uiActions.canvasOff')}
      </Text>
      {canPost && (
        <Box alignItems="Center" gap="300" wrap="Wrap">
          <Button size="300" variant="Secondary" fill="Soft" radii="300" onClick={onClick}>
            <Text size="B300">
              {t(`mindroomUi.uiActions.${composer === 'empty' ? 'askForText' : 'copyRequest'}`)}
            </Text>
          </Button>
          <Text size="T200" priority="400" role="status">
            {t(`mindroomUi.uiActions.askForTextStatus.${status[composer]}`)}
          </Text>
        </Box>
      )}
    </Box>
  );
}

/**
 * The button under an agent's UI request notice ("View computer", "Open canvas", ...). It is
 * shown only to the user the request is for, a canvas's to every joined member, and says why when
 * the action cannot run now.
 */
export function ChatUiActionButton({
  event,
  compact = false,
}: {
  event: MatrixEvent;
  /** Header placement: renders just the button without outer margin or an inline reason note. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const actions = useContext(ChatUiActionContext);
  const action = actions?.read(event);
  if (!actions || !action) return null;
  if (action.action === 'show_canvas' && actions.textRequest) {
    return compact ? null : <AskForText action={action} request={actions.textRequest} />;
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
  const button = (
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
  );
  if (compact) return button;

  return (
    <Box direction="Column" alignItems="Start" gap="100" style={{ marginTop: '0.5rem' }}>
      {button}
      {reason && (
        <Text size="T200" priority="300" role="note">
          {reason}
        </Text>
      )}
    </Box>
  );
}
