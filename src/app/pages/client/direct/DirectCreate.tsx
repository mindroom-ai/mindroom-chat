import React, { FormEventHandler, useEffect, useState } from 'react';
import { Box, Button, Input, Spinner, Switch, Text, color, config } from 'folds';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EventType, KnownMembership, Preset, Visibility } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { addRoomIdToMDirect, isUserId } from '../../../utils/matrix';
import { getDirectCreateSearchParams } from '../../pathSearchParam';
import { getDirectRoomPath } from '../../pathUtils';

type MDirectContent = Record<string, string[] | undefined>;

/** A joined direct room with `userId` the account already has, if any. */
const findDirectRoom = (
  mx: ReturnType<typeof useMatrixClient>,
  userId: string
): string | undefined => {
  const content = mx.getAccountData(EventType.Direct)?.getContent() as MDirectContent | undefined;
  return content?.[userId]?.find(
    (roomId) => mx.getRoom(roomId)?.getMyMembership() === KnownMembership.Join
  );
};

/**
 * `/direct/create/?userId=`: opens the direct room with that person, or
 * starts one. Without a user ID it asks for one.
 */





  const { userId: requestedUserId } = getDirectCreateSearchParams(searchParams);
  const [encryption, setEncryption] = useState(true);
  const [creating, setCreating] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);

  const existingRoomId = requestedUserId ? findDirectRoom(mx, requestedUserId) : undefined;
  useEffect(() => {
    if (existingRoomId) navigate(getDirectRoomPath(existingRoomId), { replace: true });
  }, [existingRoomId, navigate]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    const target = event.target as HTMLFormElement & { userIdInput: HTMLInputElement };
    const userId = target.userIdInput.value.trim();
    setFailed(false);





    const existing = findDirectRoom(mx, userId);
    if (existing) {
      navigate(getDirectRoomPath(existing));
      return;
    }
    setCreating(true);
    try {
      const { room_id: roomId } = await mx.createRoom({




        initial_state: encryption
          ? [
              {
                type: EventType.RoomEncryption,
                state_key: '',
                content: { algorithm: 'm.megolm.v1.aes-sha2' },
              },
            ]
          : [],
      });
      await addRoomIdToMDirect(mx, roomId, userId);
      navigate(getDirectRoomPath(roomId));
    } catch {
      setFailed(true);
    } finally {
      setCreating(false);
    }
  };

  if (existingRoomId) return null;








        placeholder="@user:server"
        defaultValue={requestedUserId}
        disabled={creating}
        required
        radii="400"
        size="500"
        variant={invalid ? 'Critical' : 'SurfaceVariant'}
      />
      {invalid ? (
        <Text size="T200" style={{ color: color.Critical.Main }}>
          {t('featureUi.createChat.pleaseEnterAValidUserId')}
        </Text>
      ) : null}
    </Box>
  );

  const encryptionToggle = (
    <Switch disabled={creating} value={encryption} variant="Primary" onChange={setEncryption} />
  );

  return (
    <Box
      direction="Column"
      gap="500"
      style={{
        padding: config.space.S400,
        width: '100%',
        maxWidth: '640px',
        margin: '0 auto',
        overflowY: 'auto',
      }}
    >
      <Box direction="Column" gap="100">
        <Text size="H3">{t('sharedUi.directCreate.createChat')}</Text>
        <Text size="T300" priority="300">
          {t('sharedUi.directCreate.startAPrivateEncryptedChatByEnteringAUserId')}
        </Text>
      </Box>
      <Box as="form" direction="Column" gap="400" onSubmit={handleSubmit}>
        {userIdField}
        <Box direction="Column" gap="100">
          <Text size="L400">{t('featureUi.createChat.options')}</Text>
          <SequenceCard
            direction="Column"
            variant="SurfaceVariant"
            style={{ padding: config.space.S300 }}
          >
            <SettingTile
              after={encryptionToggle}
              description={t('featureUi.createChat.onceThisFeatureIsEnabledItCan')}
              title={t('featureUi.createChat.endToEndEncryption')}
            />
          </SequenceCard>
        </Box>
        {failed && (
          <Text size="T300" style={{ color: color.Critical.Main }}>
            {t('featureUi.createChat.failed')}
          </Text>
        )}









        </Button>
      </Box>
    </Box>
  );
}
