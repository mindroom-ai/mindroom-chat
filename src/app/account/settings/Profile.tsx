import { FormEventHandler, useEffect, useState } from 'react';
import { Avatar, Box, Button, Input, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { type MatrixClient, User, UserEvent } from 'matrix-js-sdk';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useUserProfile } from '../../members/useUserProfile';
import { useMediaAuthentication } from '../../matrix/hooks/useMediaAuthentication';
import { useFilePicker } from '../../lib/hooks/useFilePicker';
import { useAlive } from '../../lib/hooks/useAlive';
import { useCapabilities } from '../../matrix/hooks/useCapabilities';
import { SequenceCard } from '../../ui/SequenceCard';
import { SettingTile } from '../../ui/SettingTile';
import { UserAvatar } from '../../avatars/UserAvatar';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import { getMxIdLocalPart } from '../../matrix/matrix';
import { SequenceCardStyle } from '../../ui/settings/styles.css';

const AVATAR_PX = 160;

type Busy = 'uploading' | 'removing' | undefined;

/**
 * Tells every open view of this user's profile about a change right away. The server applies it
 * at once, but the cached user only hears of it with the next presence or membership update, and
 * an account without rooms has no cached user at all.
 */
const announceOwnProfile = (
  client: MatrixClient,
  change: { avatarUrl?: string; displayName?: string }
) => {
  const userId = client.getSafeUserId();
  let user = client.getUser(userId);
  if (!user) {
    user = new User(userId);
    client.store.storeUser(user);
  }
  if (change.avatarUrl !== undefined) {
    user.avatarUrl = change.avatarUrl || undefined;
    client.emit(UserEvent.AvatarUrl, undefined, user);
  }
  if (change.displayName !== undefined) {
    user.displayName = change.displayName;
    client.emit(UserEvent.DisplayName, undefined, user);
  }
};

function FailureNote({ shown }: { shown: boolean }) {
  const { t } = useTranslation();
  if (!shown) return null;
  return (
    <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
      {t('featureUi.settings.emojisStickers.globalPacks.failedToApplyChangesPleaseTryAgain')}
    </Text>
  );
}

/** The profile picture with Upload and Remove; removing asks first. */
function AvatarTile() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const authenticated = useMediaAuthentication();
  const userId = client.getSafeUserId();
  const { displayName, avatarUrl } = useUserProfile(userId);
  const [busy, setBusy] = useState<Busy>();
  const [failed, setFailed] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // Matrix spec, "Capabilities negotiation": a server may forbid profile picture changes.
  const locked = useCapabilities()['m.set_avatar_url']?.enabled === false;

  const shownName = displayName ?? getMxIdLocalPart(userId) ?? userId;
  const picture = avatarUrl
    ? mxcUrlToHttp(client, avatarUrl, authenticated, AVATAR_PX, AVATAR_PX, 'crop') ?? undefined
    : undefined;

  const run = (kind: Exclude<Busy, undefined>, change: () => Promise<string>) => {
    setBusy(kind);
    setFailed(false);
    change()
      .then((next) => announceOwnProfile(client, { avatarUrl: next }))
      .catch(() => alive() && setFailed(true))
      .finally(() => {
        if (!alive()) return;
        setBusy(undefined);
        setConfirmRemove(false);
      });
  };

  const pickImage = useFilePicker(
    (file: File) =>
      run('uploading', async () => {
        const { content_uri: mxc } = await client.uploadContent(file, {
          name: file.name,
          type: file.type,
        });
        await client.setAvatarUrl(mxc);
        return mxc;
      }),
    false,
    'image/*'
  );

  const removeAvatar = () =>
    run('removing', async () => {
      await client.setAvatarUrl('');
      return '';
    });

  const actions = confirmRemove ? (
    <Box direction="Column" gap="200">
      <Text size="T200">{t('featureUi.settings.account.profile.areYouSureYouWantToRemove')}</Text>
      <Box gap="200" wrap="Wrap">
        <Button
          size="300"
          radii="300"
          variant="Critical"
          fill="Soft"
          disabled={busy !== undefined}
          before={busy === 'removing' ? <Spinner size="50" variant="Critical" /> : undefined}
          onClick={removeAvatar}
        >
          <Text size="B300">{t('featureUi.settings.account.profile.removeAvatar')}</Text>
        </Button>
        <Button
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          disabled={busy !== undefined}
          onClick={() => setConfirmRemove(false)}
        >
          <Text size="B300">{t('featureUi.settings.account.accountDeactivation.cancel')}</Text>
        </Button>
      </Box>
    </Box>
  ) : (
    <Box gap="200" wrap="Wrap">
      <Button
        size="300"
        radii="300"
        variant="Secondary"
        fill="Soft"
        disabled={locked || busy !== undefined}
        before={busy === 'uploading' ? <Spinner size="50" variant="Secondary" /> : undefined}
        onClick={pickImage}
      >
        <Text size="B300">{t('featureUi.settings.account.profile.upload')}</Text>
      </Button>
      {avatarUrl && !locked && (
        <Button
          size="300"
          radii="300"
          variant="Critical"
          fill="None"
          disabled={busy !== undefined}
          onClick={() => setConfirmRemove(true)}
        >
          <Text size="B300">{t('featureUi.settings.account.profile.remove')}</Text>
        </Button>
      )}
    </Box>
  );

  return (
    <SettingTile
      focusId="avatar"
      title={t('featureUi.settings.account.profile.avatar')}
      before={
        <Avatar size="500" radii="300">
          <UserAvatar
            userId={userId}
            src={picture}
            alt={shownName}
            renderFallback={() => <Text size="H4">{shownName.charAt(0).toUpperCase()}</Text>}
          />
        </Avatar>
      }
    >
      {actions}
      <FailureNote shown={failed} />
    </SettingTile>
  );
}

/** Display name editor for the signed-in account. */
function DisplayNameTile() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const { displayName: savedName } = useUserProfile(client.getSafeUserId());
  const [draft, setDraft] = useState(savedName ?? '');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  // A new name from the server (or another device) replaces the draft.
  useEffect(() => setDraft(savedName ?? ''), [savedName]);

  const locked = useCapabilities()['m.set_displayname']?.enabled === false;
  const nextName = draft.trim();
  const canSave = !locked && nextName !== '' && nextName !== savedName;

  const handleSubmit: FormEventHandler<HTMLFormElement> = (event) => {
    event.preventDefault();
    if (!canSave) return;
    setFailed(false);
    setSaving(true);
    client
      .setDisplayName(nextName)
      .then(() => announceOwnProfile(client, { displayName: nextName }))
      .catch(() => alive() && setFailed(true))
      .finally(() => alive() && setSaving(false));
  };

  const label = t('featureUi.settings.account.profile.displayName');

  return (
    <SettingTile focusId="displayName" title={label}>
      <Box as="form" alignItems="Center" gap="200" onSubmit={handleSubmit}>
        <Box grow="Yes" direction="Column">
          <Input
            aria-label={label}
            variant="Background"
            size="400"
            radii="300"
            value={draft}
            readOnly={locked}
            onChange={(event) => setDraft(event.currentTarget.value)}
          />
        </Box>
        <Button
          type="submit"
          variant="Primary"
          fill="Soft"
          size="400"
          radii="300"
          disabled={saving || !canSave}
          before={saving ? <Spinner variant="Primary" fill="Soft" size="100" /> : undefined}
        >
          <Text size="B400">{t('featureUi.settings.account.profile.save')}</Text>
        </Button>
      </Box>
      <FailureNote shown={failed} />
    </SettingTile>
  );
}

/** Profile picture and display name of the signed-in account. */
export function Profile() {
  const { t } = useTranslation();

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {t('featureUi.settings.account.profile.profile')}
      </Text>
      <SequenceCard
        className={SequenceCardStyle}
        variant="SurfaceVariant"
        direction="Column"
        gap="400"
      >
        <AvatarTile />
        <DisplayNameTile />
      </SequenceCard>
    </Box>
  );
}
