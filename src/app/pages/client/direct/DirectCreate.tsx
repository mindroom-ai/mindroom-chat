import React, { FormEventHandler, useEffect, useState } from 'react';
import { Box, Button, Input, Spinner, Switch, Text, color, config } from 'folds';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { EventType, KnownMembership, Preset, Visibility } from 'matrix-js-sdk';
import { SequenceCard } from '../../../components/sequence-card';
import { SettingTile } from '../../../components/setting-tile';
import { Page } from '../../../components/page';
import { PhonePageHeader } from '../../../components/page/PhonePageHeader';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { ScreenSize, useScreenSizeContext } from '../../../hooks/useScreenSize';
import { addRoomIdToMDirect, isUserId } from '../../../utils/matrix';
import { getDirectCreateSearchParams } from '../../pathSearchParam';
import { getDirectRoomPath } from '../../pathUtils';
import { DIRECT_PATH } from '../../paths';

type MDirectContent = Record<string, string[] | undefined>;

/** A joined direct room with `userId` the account already has, if any. */
const findDirectRoom = (
  client: ReturnType<typeof useMatrixClient>,
  userId: string
): string | undefined => {
  const content = client.getAccountData(EventType.Direct)?.getContent() as
    | MDirectContent
    | undefined;
  return content?.[userId]?.find(
    (roomId) => client.getRoom(roomId)?.getMyMembership() === KnownMembership.Join
  );
};

const ENABLE_ENCRYPTION = {
  type: EventType.RoomEncryption,
  state_key: '',
  content: { algorithm: 'm.megolm.v1.aes-sha2' },
};

/**
 * `/direct/create/?userId=`: opens the direct room with that person, or
 * starts one. Without a user ID it asks for one.
 */
export function DirectCreate() {
  const client = useMatrixClient();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [query] = useSearchParams();
  const { userId: requestedUserId } = getDirectCreateSearchParams(query);
  const [encryption, setEncryption] = useState(true);
  const [creating, setCreating] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  // On phones the title moves into a title bar that leads back to Direct Messages.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;

  const existingRoomId = requestedUserId ? findDirectRoom(client, requestedUserId) : undefined;
  useEffect(() => {
    if (existingRoomId) navigate(getDirectRoomPath(existingRoomId), { replace: true });
  }, [existingRoomId, navigate]);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    const target = event.target as HTMLFormElement & { userIdInput: HTMLInputElement };
    const userId = target.userIdInput.value.trim();
    setFailed(false);
    const valid = isUserId(userId);
    setInvalid(!valid);
    if (!valid) return;
    const existing = findDirectRoom(client, userId);
    if (existing) {
      navigate(getDirectRoomPath(existing));
      return;
    }
    setCreating(true);
    try {
      const { room_id: roomId } = await client.createRoom({
        invite: [userId],
        is_direct: true,
        initial_state: encryption ? [ENABLE_ENCRYPTION] : [],
        // Spec "Creation" presets: trusted_private_chat gives the invitee the creator's power.
        preset: Preset.TrustedPrivateChat,
        visibility: Visibility.Private,
      });
      await addRoomIdToMDirect(client, roomId, userId);
      navigate(getDirectRoomPath(roomId));
    } catch {
      setFailed(true);
    } finally {
      setCreating(false);
    }
  };

  if (existingRoomId) return null;

  const userIdField = (
    <Box direction="Column" gap="100">
      <Text as="label" htmlFor="direct-create-user-id" size="L400">
        {t('featureUi.createChat.userId')}
      </Text>
      <Input
        id="direct-create-user-id"
        name="userIdInput"
        onChange={() => setInvalid(false)}
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
    <Page>
      <PhonePageHeader to={DIRECT_PATH} title={t('sharedUi.directCreate.createChat')} />
      <Box
        direction="Column"
        gap="500"
        style={{
          padding: config.space.S400,
          width: '100%',
          maxWidth: '640px',
          margin: '0 auto',
          overflowY: 'auto',
          flexGrow: 1,
          minHeight: 0,
        }}
      >
        <Box direction="Column" gap="100">
          {!phone && <Text size="H3">{t('sharedUi.directCreate.createChat')}</Text>}
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
          <Button
            type="submit"
            variant="Primary"
            size="500"
            radii="400"
            disabled={creating}
            before={creating ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined}
          >
            <Text size="B500">{t('featureUi.createChat.create')}</Text>
          </Button>
        </Box>
      </Box>
    </Page>
  );
}
