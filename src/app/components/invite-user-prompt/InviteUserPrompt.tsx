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
      setError(t('sharedUi.inviteUserPrompt.invalidUserId'));
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
          : t('sharedUi.inviteUserPrompt.inviteFailed')
      );













          }}
        >
          <Dialog
            role="dialog"
            aria-labelledby="invite-user-prompt-title"
            style={{
              width: '100%',
              maxWidth: `min(calc(100vw - 2 * ${config.space.S400}), ${toRem(680)})`,
            }}
          >







                    {t('sharedUi.inviteUserPrompt.title')}
                  </Text>
                </Box>
                <IconButton
                  size="300"
                  radii="300"
                  onClick={requestClose}
















                    room={room}
                    inputValue={userId}
                    onInputChange={handleInputChange}
                    onSelect={handleInputChange}
                    disabled={inviting}
                    autoFocus
                  />
                </Box>
                <Box direction="Column" gap="100">
                  <Text size="L400">{t('sharedUi.inviteUserPrompt.reason')}</Text>
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
                  <Text size="B500">
                    {inviting
                      ? t('sharedUi.inviteUserPrompt.inviting')
                      : t('sharedUi.inviteUserPrompt.invite')}
                  </Text>
                </Button>
              </Box>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
