import React, { useState } from 'react';
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
  Text,
  color,
  config,
  toRem,
} from 'folds';
import { Dialog, Header, IconButton } from '../glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAlive } from '../../hooks/useAlive';
import { stopPropagation } from '../../utils/keyboard';

type LeaveRoomPromptProps = {
  roomId: string;
  /** Runs once the server confirmed the leave, so the caller can move away from the room. */
  onLeft: () => void;
  requestClose: () => void;
};

type LeaveState = { kind: 'idle' } | { kind: 'leaving' } | { kind: 'failed'; reason: string };

const HEADING_ID = 'leave-room-prompt-heading';
const promptWidth = `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(400)})`;
const bodyPadding = `${config.space.S200} ${config.space.S400} ${config.space.S400}`;

// Escape and a click outside dismiss the prompt; Escape does not reach the room behind it.
const promptTrap = (dismiss: () => void): FocusTrapOptions => ({
  initialFocus: false,
  escapeDeactivates: stopPropagation,
  onDeactivate: dismiss,
  clickOutsideDeactivates: true,
});

const reasonOf = (failure: unknown): string =>
  failure instanceof Error && failure.message ? failure.message : String(failure);

/** Asks before leaving a room; a failed leave stays in the dialog with the server's reason. */
export function LeaveRoomPrompt({ roomId, onLeft, requestClose }: LeaveRoomPromptProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const isMounted = useAlive();
  const [leaveState, setLeaveState] = useState<LeaveState>({ kind: 'idle' });
  const leaving = leaveState.kind === 'leaving';

  const confirmLeave = () => {
    if (leaving) return;
    setLeaveState({ kind: 'leaving' });
    client.leave(roomId).then(
      () => {
        if (isMounted()) onLeft();
      },
      (failure: unknown) => {
        if (isMounted()) setLeaveState({ kind: 'failed', reason: reasonOf(failure) });
      }
    );
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={promptTrap(requestClose)}>
          <Dialog
            role="alertdialog"
            aria-labelledby={HEADING_ID}
            style={{ width: '100%', maxWidth: promptWidth }}
          >
            <Header
              size="500"
              style={{ paddingInline: `${config.space.S400} ${config.space.S200}` }}
            >
              <Text id={HEADING_ID} size="H4" style={{ flexGrow: 1 }}>
                {t('sharedUi.leaveRoomPrompt.leaveRoom')}
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
              <Text size="T300" priority="400">
                {t('sharedUi.leaveRoomPrompt.areYouSureYouWantToLeaveThisRoom')}
              </Text>
              {leaveState.kind === 'failed' && (
                <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
                  {t('sharedUi.leaveRoomPrompt.leaveFailed', { error: leaveState.reason })}
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
                <Text size="B500">
                  {t(
                    leaving ? 'sharedUi.leaveRoomPrompt.leaving' : 'sharedUi.leaveRoomPrompt.leave'
                  )}
                </Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
