import React, { useId, useState } from 'react';
import { EventType, Room } from 'matrix-js-sdk';
import FocusTrap from 'focus-trap-react';
import {
  Box,
  Button,
  Dialog,
  Header,
  Icon,
  IconButton,
  Icons,
  Overlay,
  OverlayBackdrop,
  OverlayCenter,
  Spinner,
  Text,
  color,
  config,
} from 'folds';
import { useTranslation } from 'react-i18next';
import { StateEvent } from '../../../types/matrix/room';
import { useMatrixClient } from '../../hooks/useMatrixClient';
import { usePowerLevels } from '../../hooks/usePowerLevels';
import { useRoomCreators } from '../../hooks/useRoomCreators';
import { useRoomPermissions } from '../../hooks/useRoomPermissions';
import { getViaServers } from '../../plugins/via-servers';
import { stopPropagation } from '../../utils/keyboard';

type AddRoomToSpacePromptProps = {
  room: Room;
  space: Room;
  onAdded?: () => void;
  onCancel: () => void;
};

export function AddRoomToSpacePrompt({
  room,
  space,
  onAdded,
  onCancel,
}: AddRoomToSpacePromptProps) {
  const { t } = useTranslation();
  const mx = useMatrixClient();
  const titleId = useId();
  const descriptionId = useId();
  const creators = useRoomCreators(space);
  const permissions = useRoomPermissions(creators, usePowerLevels(space));
  const canAdd = permissions.stateEvent(StateEvent.SpaceChild, mx.getSafeUserId());
  const [adding, setAdding] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleAdd = async () => {
    if (!canAdd || adding) return;
    setAdding(true);
    setFailed(false);
    try {
      const content = {
        auto_join: false,
        suggested: false,
        via: getViaServers(room),
      };
      await mx.sendStateEvent(space.roomId, EventType.SpaceChild, content, room.roomId);
      onAdded?.();
      onCancel();
    } catch {
      setFailed(true);
      setAdding(false);
    }
  };

  return (
    <Overlay open backdrop={<OverlayBackdrop />}>
      <OverlayCenter>
        <FocusTrap
          focusTrapOptions={{
            onDeactivate: onCancel,
            clickOutsideDeactivates: !adding,
            escapeDeactivates: adding ? false : stopPropagation,
          }}
        >
          <Dialog
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            variant="Surface"
          >
            <Header
              style={{ padding: `0 ${config.space.S200} 0 ${config.space.S400}` }}
              variant="Surface"
              size="500"
            >
              <Box grow="Yes">
                <Text id={titleId} size="H4">
                  {t('nav.addRoomToSpace')}
                </Text>
              </Box>
              <IconButton
                size="300"
                onClick={onCancel}
                radii="300"
                disabled={adding}
                aria-label={t('nav.close')}
              >
                <Icon src={Icons.Cross} />
              </IconButton>
            </Header>
            <Box style={{ padding: config.space.S400, paddingTop: 0 }} direction="Column" gap="400">
              <Text id={descriptionId} size="T300">
                {t('nav.addRoomToSpaceDescription', { room: room.name, space: space.name })}
              </Text>
              {!canAdd && (
                <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
                  {t('nav.addRoomToSpacePermissionDenied')}
                </Text>
              )}
              {failed && (
                <Text role="alert" size="T200" style={{ color: color.Critical.Main }}>
                  {t('nav.addRoomToSpaceFailed')}
                </Text>
              )}
              <Box justifyContent="End" gap="200">
                <Button
                  autoFocus={!canAdd}
                  onClick={onCancel}
                  variant="Secondary"
                  disabled={adding}
                >
                  <Text size="B400">{t('nav.cancel')}</Text>
                </Button>
                <Button
                  autoFocus={canAdd}
                  onClick={handleAdd}
                  variant="Primary"
                  disabled={!canAdd || adding}
                >
                  {adding && <Spinner size="100" />}
                  <Text size="B400">{t('nav.add')}</Text>
                </Button>
              </Box>
            </Box>
          </Dialog>
        </FocusTrap>
      </OverlayCenter>
    </Overlay>
  );
}
