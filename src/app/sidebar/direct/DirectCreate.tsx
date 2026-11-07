import { FormEvent, useEffect, useState } from 'react';
import { Box, Button, Spinner, Switch, Text, color, config } from 'folds';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SequenceCard } from '../../ui/SequenceCard';
import { InviteUserAutocomplete } from '../../members/invite/InviteUserAutocomplete';
import { SettingTile } from '../../ui/SettingTile';
import { Page } from '../../ui/page/Page';
import { PhonePageHeader } from '../../ui/page/PhonePageHeader';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useCapabilities } from '../../matrix/hooks/useCapabilities';
import { createDirectRoom, findDirectRoom } from '../../matrix/createRoom';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { isUserId } from '../../matrix/matrix';
import { getDirectCreateSearchParams } from '../../routes/pathSearchParam';
import { getDirectRoomPath } from '../../routes/pathUtils';
import { DIRECT_PATH } from '../../routes/paths';

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
  const [userIdDraft, setUserIdDraft] = useState(requestedUserId ?? '');
  const [encryption, setEncryption] = useState(true);
  const [creating, setCreating] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [failed, setFailed] = useState(false);
  // On phones the title moves into a title bar that leads back to Direct Messages.
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  // The room gets the server's default version, whose pinned levels createDirectRoom repeats.
  const roomVersion = useCapabilities()['m.room_versions']?.default;

  const existingRoomId = requestedUserId ? findDirectRoom(client, requestedUserId) : undefined;
  useEffect(() => {
    if (existingRoomId) navigate(getDirectRoomPath(existingRoomId), { replace: true });
  }, [existingRoomId, navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const userId = userIdDraft.trim();
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
      const roomId = await createDirectRoom(client, userId, { encryption, version: roomVersion });
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
      <Text size="L400">{t('featureUi.createChat.userId')}</Text>
      <InviteUserAutocomplete
        inputValue={userIdDraft}
        onInputChange={(value) => {
          setInvalid(false);
          setUserIdDraft(value);
        }}
        onSelect={(value) => {
          setInvalid(false);
          setUserIdDraft(value);
        }}
        disabled={creating}
        autoFocus={!requestedUserId}
        radii="400"
        variant={invalid ? 'Critical' : 'SurfaceVariant'}
        menuLabel={t('featureUi.createChat.userSuggestions')}
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
          {!phone && (
            <Text as="h1" size="H3">
              {t('sharedUi.directCreate.createChat')}
            </Text>
          )}
          <Text size="T300" priority="300">
            {t('sharedUi.directCreate.startAPrivateEncryptedChatByEnteringAUserId')}
          </Text>
        </Box>
        <Box
          as="form"
          direction="Column"
          gap="400"
          onSubmit={(event: FormEvent<HTMLFormElement>) => void handleSubmit(event)}
        >
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
