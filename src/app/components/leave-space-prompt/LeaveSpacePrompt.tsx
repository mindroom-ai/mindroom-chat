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
  Text,
  color,
  config,
  toRem,
} from 'folds';
import { Dialog, Header, IconButton } from '../glass/GlassPrimitives';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAlive } from '../../hooks/useAlive';
import { stopPropagation } from '../../utils/keyboard';

type LeaveSpacePromptProps = {
  roomId: string;
  /** Runs after the server accepted the leave, so the caller can open another page. */
  onLeft: () => void;
  requestClose: () => void;
};

const TITLE_ID = 'leave-space-prompt-title';
const DIALOG_WIDTH = `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(400)})`;

/** Escape (kept from the page behind) and a click outside both dismiss the prompt. */
const dismissible = (onDismiss: () => void): FocusTrapOptions => ({
  onDeactivate: onDismiss,
  escapeDeactivates: stopPropagation,
  clickOutsideDeactivates: true,
  initialFocus: false,
});

/**
 * Confirms leaving a space. The space's rooms stay joined; if the server refuses, the dialog
 * stays open and shows why.
 */
export function LeaveSpacePrompt({ roomId, onLeft, requestClose }: LeaveSpacePromptProps) {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const [pending, setPending] = useState(false);
  const [refusal, setRefusal] = useState<string>();

  const leave = async () => {
    if (pending) return;
    setPending(true);
    setRefusal(undefined);
    try {
      await client.leave(roomId);
      if (alive()) onLeft();
    } catch (failure) {
      if (!alive()) return;
      setPending(false);
      setRefusal(failure instanceof Error && failure.message ? failure.message : String(failure));
    }
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap focusTrapOptions={dismissible(requestClose)}>
          <Dialog
            role="alertdialog"
            aria-labelledby={TITLE_ID}
            style={{ width: '100%', maxWidth: DIALOG_WIDTH }}
          >
            <Header
              size="500"
              style={{ paddingLeft: config.space.S400, paddingRight: config.space.S200 }}
            >
              <Text id={TITLE_ID} size="H4" style={{ flexGrow: 1 }}>
                {t('sharedUi.leaveSpacePrompt.leaveSpace')}
              </Text>
              <IconButton
                size="300"
                radii="300"
                aria-label={t('sharedUi.leaveRoomPrompt.close')}
                onClick={requestClose}
              >
                <Icon size="200" src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box
              direction="Column"
              gap="400"
              style={{ padding: `0 ${config.space.S400} ${config.space.S400}` }}
            >
              <Text size="T300" priority="400">
                {t('sharedUi.leaveSpacePrompt.areYouSureYouWantToLeaveThisSpace')}
              </Text>
              {refusal !== undefined && (
                <Text size="T300" role="alert" style={{ color: color.Critical.Main }}>
                  {t('sharedUi.leaveSpacePrompt.leaveFailed', { error: refusal })}
                </Text>
              )}
              <Button
                variant="Critical"
                size="500"
                disabled={pending}
                onClick={() => void leave()}
                before={pending ? <Spinner variant="Critical" fill="Solid" size="200" /> : null}
              >
                <Text size="B500">
                  {pending
                    ? t('sharedUi.leaveSpacePrompt.leaving')
                    : t('sharedUi.leaveSpacePrompt.leave')}
                </Text>
              </Button>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
