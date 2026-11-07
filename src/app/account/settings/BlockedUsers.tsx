import { FormEvent, useState } from 'react';
import { Box, Button, Chip, Icon, Icons, Input, Spinner, Text, color } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useIgnoredUsers } from '../../matrix/hooks/useIgnoredUsers';
import { useAlive } from '../../lib/hooks/useAlive';
import { SettingTile } from '../../ui/SettingTile';
import { isUserId } from '../../matrix/matrix';
import { SettingsCard } from '../../ui/settings/SettingsCard';

const KEY = 'featureUi.settings.account.ignoredUserList';

/**
 * The account's ignore list (`m.ignored_user_list`): the server stops delivering their messages
 * and invites. Add a user ID to block it; the chip of a blocked user unblocks it.
 */
export function BlockedUsers() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const alive = useAlive();
  const blocked = useIgnoredUsers();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const candidate = draft.trim();
  const canBlock =
    isUserId(candidate) && candidate !== client.getUserId() && !blocked.includes(candidate);

  const store = (next: string[]) => {
    setSaving(true);
    setFailed(false);
    return client
      .setIgnoredUsers(next)
      .then(() => true)
      .catch(() => {
        if (alive()) setFailed(true);
        return false;
      })
      .finally(() => alive() && setSaving(false));
  };

  const block = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canBlock) return;
    void store([...blocked, candidate]).then((ok) => ok && alive() && setDraft(''));
  };

  const unblockLabel = t(`${KEY}.unblock`);

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {t(`${KEY}.blockedUsers`)}
      </Text>
      <SettingsCard>
        <SettingTile
          focusId="blockedUsers"
          title={t(`${KEY}.selectUser`)}
          description={t(`${KEY}.preventReceivingMessagesOrInvitesFromUser`)}
        >
          <Box as="form" gap="200" alignItems="Center" onSubmit={block}>
            <Box grow="Yes" direction="Column">
              <Input
                aria-label={t(`${KEY}.selectUser`)}
                placeholder="@user:server"
                value={draft}
                onChange={(event) => setDraft(event.currentTarget.value)}
                variant="Background"
                size="300"
                radii="300"
                autoComplete="off"
                spellCheck={false}
              />
            </Box>
            <Button
              type="submit"
              size="300"
              radii="300"
              variant="Critical"
              fill="Soft"
              disabled={!canBlock || saving}
              before={saving ? <Spinner size="50" variant="Critical" /> : undefined}
            >
              <Text size="B300">{t(`${KEY}.block`)}</Text>
            </Button>
          </Box>
          {failed && (
            <Text size="T200" role="alert" style={{ color: color.Critical.Main }}>
              {t(
                'featureUi.settings.emojisStickers.globalPacks.failedToApplyChangesPleaseTryAgain'
              )}
            </Text>
          )}
        </SettingTile>
        {blocked.length > 0 && (
          <SettingTile title={t(`${KEY}.users`)}>
            <Box gap="200" wrap="Wrap">
              {blocked.map((userId) => (
                <Chip
                  key={userId}
                  radii="Pill"
                  variant="Secondary"
                  disabled={saving}
                  aria-label={`${unblockLabel} ${userId}`}
                  after={<Icon size="50" src={Icons.Cross} />}
                  onClick={() => void store(blocked.filter((id) => id !== userId))}
                >
                  <Text size="T200">
                    <bdi>{userId}</bdi>
                  </Text>
                </Chip>
              ))}
            </Box>
          </SettingTile>
        )}
      </SettingsCard>
    </Box>
  );
}
