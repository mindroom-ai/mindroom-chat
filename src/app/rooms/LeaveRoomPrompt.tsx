import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import type { Options as FocusTrapOptions } from 'focus-trap';
import {
  Box,
  Button,
  Icon,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Switch,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import { Dialog, Header, IconButton } from '../ui/glass/GlassPrimitives';
import { SettingTile } from '../ui/SettingTile';
import { useMatrixClient } from '../matrix/hooks/useMatrixClient';
import { useCallActions } from '../calls/callStore';
import { useAlive } from '../lib/hooks/useAlive';
import { stopPropagation } from '../lib/keyboard';
import { describeKnownError } from '../lib/describeError';
import { ErrorDetail } from '../ui/ErrorDetail';

type LeaveRoomPromptProps = {
  roomId: string;
  /** Runs once the server confirmed the leave, so the caller can move away from the room. */
  onLeft: () => void;
  requestClose: () => void;
};

type LeaveState = { kind: 'idle' } | { kind: 'leaving' } | { kind: 'failed'; reason: unknown };

const HEADING_ID = 'leave-room-prompt-heading';
const promptWidth = `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(400)})`;
const bodyPadding = `${config.space.S200} ${config.space.S400} ${config.space.S400}`;

// Escape and a click outside dismiss the prompt; Escape does not reach the room behind it.
// Focus starts on the dialog itself, so a screen reader reads the question, and Enter or Space
// leaves nothing by accident.
const promptTrap = (dismiss: () => void): FocusTrapOptions => ({
  initialFocus: `#${HEADING_ID}-dialog`,
  escapeDeactivates: stopPropagation,
  onDeactivate: dismiss,
  clickOutsideDeactivates: true,
});

/**
 * Asks before leaving a room or a space; a failed leave stays in the dialog with the server's
 * reason. A room can be forgotten too (Matrix spec, `/forget`): it then leaves the account's room
 * list and history for good, though the person may join again later where the room allows it. A
 * space's rooms stay joined when it is left.
 */
export function LeaveRoomPrompt({ roomId, onLeft, requestClose }: LeaveRoomPromptProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const { leaveRoom } = useCallActions(client);
  const space = client.getRoom(roomId)?.isSpaceRoom() ?? false;
  const strings = space ? 'sharedUi.leaveSpacePrompt' : 'sharedUi.leaveRoomPrompt';
  const isMounted = useAlive();
  const [leaveState, setLeaveState] = useState<LeaveState>({ kind: 'idle' });
  const [forget, setForget] = useState(false);
  const leaving = leaveState.kind === 'leaving';

  const confirmLeave = () => {
    if (leaving) return;
    setLeaveState({ kind: 'leaving' });
    const done = leaveRoom(roomId);
    (forget ? done.then(() => client.forget(roomId)) : done).then(
      () => {
        if (isMounted()) onLeft();
      },
      (failure: unknown) => {
        if (isMounted()) setLeaveState({ kind: 'failed', reason: failure });
      }
    );
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={promptTrap(requestClose)}>
          <Dialog
            id={`${HEADING_ID}-dialog`}
            role="alertdialog"
            aria-labelledby={HEADING_ID}
            aria-describedby={`${HEADING_ID}-question`}
            tabIndex={-1}
            style={{ width: '100%', maxWidth: promptWidth, outline: 'none' }}
          >
            <Header
              size="500"
              style={{ paddingInline: `${config.space.S400} ${config.space.S200}` }}
            >
              <Text id={HEADING_ID} size="H4" style={{ flexGrow: 1 }}>
                {t(
                  space
                    ? 'sharedUi.leaveSpacePrompt.leaveSpace'
                    : 'sharedUi.leaveRoomPrompt.leaveRoom'
                )}
              </Text>
              <IconButton
                aria-label={t('sharedUi.leaveRoomPrompt.close')}
                size="300"
                radii="300"
                onClick={() => requestClose()}
              >
                <Icon src={Icons.Cross} size="200" />
              </IconButton>
            </Header>
            <Box direction="Column" gap="400" style={{ padding: bodyPadding }}>
              <Text id={`${HEADING_ID}-question`} size="T300" priority="400">
                {t(
                  space
                    ? 'sharedUi.leaveSpacePrompt.areYouSureYouWantToLeaveThisSpace'
                    : 'sharedUi.leaveRoomPrompt.areYouSureYouWantToLeaveThisRoom'
                )}
              </Text>
              {!space && (
                <SettingTile
                  title={t('sharedUi.leaveRoomPrompt.forget')}
                  description={t('sharedUi.leaveRoomPrompt.forgetDescription')}
                  after={
                    <Switch
                      variant="Critical"
                      aria-label={t('sharedUi.leaveRoomPrompt.forget')}
                      value={forget}
                      disabled={leaving}
                      onChange={setForget}
                    />
                  }
                />
              )}
              {leaveState.kind === 'failed' && (
                <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
                  {t(`${strings}.leaveFailed`, {
                    error: describeKnownError(t, leaveState.reason) ?? '',
                  })}
                  <ErrorDetail error={leaveState.reason} />
                </Text>
              )}
              <Button
                variant="Critical"
                size="500"
                disabled={leaving}
                onClick={confirmLeave}
                before={
                  leaving ? <Spinner variant="Critical" fill="Solid" size="200" /> : undefined
                }
              >
                <Text size="B500">{t(leaving ? `${strings}.leaving` : `${strings}.leave`)}</Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
