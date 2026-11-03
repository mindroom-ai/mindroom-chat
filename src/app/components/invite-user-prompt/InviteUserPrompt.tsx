import React, { FormEventHandler, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Button,
  Icon,
  Icons,
  Input,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  color,
  config,
  toRem,
} from 'folds';
import type { Room } from 'matrix-js-sdk';
import { Dialog, Header, IconButton } from '../glass/GlassPrimitives';
import { InviteUserAutocomplete } from './InviteUserAutocomplete';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { useAlive } from '../../hooks/useAlive';
import { isUserId } from '../../utils/matrix';
import { stopPropagation } from '../../utils/keyboard';

type InviteUserPromptProps = {
  room: Room;
  requestClose: () => void;
};

type InviteFormTarget = EventTarget & {
  reasonInput?: { value: string };
};

const TITLE_ID = 'invite-user-prompt-title';

/** Title row: the heading the dialog is labelled by, and a close button at the end. */
function InvitePromptTitle({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const inset = { left: config.space.S400, right: config.space.S200 };
  return (
    <Header
      size="500"
      style={{ paddingBlock: 0, paddingLeft: inset.left, paddingRight: inset.right }}
    >
      <Text size="H4" id={TITLE_ID} style={{ flexGrow: 1 }}>
        {t('sharedUi.inviteUserPrompt.invite')}
      </Text>
      <IconButton
        aria-label={t('sharedUi.inviteUserPrompt.close')}
        onClick={onClose}
        radii="300"
        size="300"
      >
        <Icon src={Icons.Cross} />
      </IconButton>
    </Header>
  );
}

/** Dialog to invite someone to a room by user ID, with directory suggestions and a reason. */
export function InviteUserPrompt({ room, requestClose }: InviteUserPromptProps) {




  const [userId, setUserId] = useState('');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string>();

  const handleInputChange = (value: string) => {
    setError(undefined);
    setUserId(value);
  };

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (evt) => {
    evt.preventDefault();
    if (inviting) return;
    const target = userId.trim();
    if (!isUserId(target)) {
      setError(t('featureUi.createChat.pleaseEnterAValidUserId'));
      return;
    }
    const reason = (evt.target as InviteFormTarget).reasonInput?.value.trim() || undefined;

    setInviting(true);
    setError(undefined);
    try {
      await mx.invite(room.roomId, target, reason);
      if (alive()) requestClose();
    } catch (inviteError) {
      if (!alive()) return;
      setError(
        inviteError instanceof Error && inviteError.message
          ? inviteError.message
          : String(inviteError)
      );














          }}
        >
          <Dialog
            role="dialog"
            aria-labelledby={TITLE_ID}
            style={{
              width: '100%',
              maxWidth: `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(680)})`,
            }}
          >
            <Box direction="Column">
              <InvitePromptTitle onClose={requestClose} />
              <Box
                as="form"
                onSubmit={handleSubmit}
                direction="Column"
                gap="400"
                style={{ padding: config.space.S400, paddingTop: 0 }}
              >
                <Box direction="Column" gap="100">
                  <Text size="L400">{t('sharedUi.inviteUserPrompt.userId')}</Text>
                  <InviteUserAutocomplete
                    ref={inputRef}
                    room={room}
                    inputValue={userId}
                    onInputChange={handleInputChange}
                    onSelect={handleInputChange}
                    disabled={inviting}
                    autoFocus
                  />
                </Box>
                <Box direction="Column" gap="100">
                  <Text size="L400">{t('sharedUi.inviteUserPrompt.reasonOptional')}</Text>
                  <Input
                    name="reasonInput"
                    size="500"
                    variant="Background"
                    radii="300"
                    autoComplete="off"
                    readOnly={inviting}
                  />
                </Box>
                {error && (
                  <Text size="T300" style={{ color: color.Critical.Main }} role="alert">
                    {error}
                  </Text>
                )}
                <Button
                  type="submit"
                  variant="Primary"
                  size="500"
                  disabled={inviting}
                  before={
                    inviting ? <Spinner fill="Solid" variant="Primary" size="200" /> : undefined
                  }
                >
                  <Text size="B500">{t('sharedUi.inviteUserPrompt.invite')}</Text>
                </Button>
              </Box>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
