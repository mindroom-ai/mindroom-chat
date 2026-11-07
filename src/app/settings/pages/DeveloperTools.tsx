import { useEffect, useState } from 'react';
import { Box, Button, Chip, Icon, Icons, Switch, Text, config, toRem } from 'folds';
import { useTranslation } from 'react-i18next';
import { ClientEvent, type MatrixClient, type MatrixEvent } from 'matrix-js-sdk';
import { useSetting } from '../../preferences/useSetting';
import { settingsAtom } from '../../preferences/settings';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { SettingTile } from '../../ui/SettingTile';
import { copyToClipboard } from '../../lib/dom';
import { SettingsPageFrame, type SettingsPageProps } from '../../ui/settings/SettingsPageFrame';
import { SettingsCard } from '../../ui/settings/SettingsCard';
import { SettingSwitchTile } from '../../ui/settings/SettingSwitchTile';

const TOOLS = 'featureUi.settings.developerTools.developTools';
const DATA = 'featureUi.settings.developerTools.accountData';

/** Copies the session's access token; the button says so once the copy really happened. */
function AccessTokenTile() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  const [copied, setCopied] = useState(false);

  return (
    <SettingTile
      focusId="accessToken"
      title={t(`${TOOLS}.accessToken`)}
      description={t(`${TOOLS}.copyAccessTokenToClipboard`)}
      after={
        <Button
          size="300"
          radii="300"
          variant="Secondary"
          fill="Soft"
          onClick={() => void copyToClipboard(client.getAccessToken() ?? '').then(setCopied)}
        >
          <Text size="B300">
            {copied ? t('featureUi.settings.account.matrixId.copied') : t(`${TOOLS}.copy`)}
          </Text>
        </Button>
      }
    />
  );
}

const byType = (client: MatrixClient): MatrixEvent[] =>
  [...client.store.accountData.values()].sort((a, b) => a.getType().localeCompare(b.getType()));

/** The global account data events this client holds, following changes. */
const useGlobalAccountData = (): MatrixEvent[] => {
  const client = useMatrixClient();
  const [events, setEvents] = useState(() => byType(client));

  useEffect(() => {
    const refresh = () => setEvents(byType(client));
    refresh();
    client.on(ClientEvent.AccountData, refresh);
    return () => {
      client.off(ClientEvent.AccountData, refresh);
    };
  }, [client]);

  return events;
};

/** Read-only view of the account data: a chip per event type that shows its JSON content. */
function AccountDataViewer() {
  const { t } = useTranslation();
  const events = useGlobalAccountData();
  const [open, setOpen] = useState<string>();
  const shown = events.find((event) => event.getType() === open);

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {t(`${DATA}.accountData`)}
      </Text>
      <SettingsCard>
        <SettingTile
          focusId="accountData"
          title={t(`${DATA}.global`)}
          description={t(`${DATA}.dataStoredInYourGlobalAccountData`)}
        >
          <Text size="T200" priority="300">
            {t(`${DATA}.total`, { count: events.length })}
          </Text>
          <Box gap="200" wrap="Wrap">
            {events.map((event) => {
              const type = event.getType();
              const expanded = type === open;
              return (
                <Chip
                  key={type}
                  radii="Pill"
                  variant={expanded ? 'Primary' : 'Secondary'}
                  aria-pressed={expanded}
                  aria-label={`${t(expanded ? `${DATA}.collapse` : `${DATA}.expand`)} ${type}`}
                  after={<Icon size="50" src={expanded ? Icons.ChevronTop : Icons.ChevronBottom} />}
                  onClick={() => setOpen(expanded ? undefined : type)}
                >
                  <Text size="T200">{type}</Text>
                </Chip>
              );
            })}
          </Box>
          {shown && (
            <Text
              as="pre"
              size="T200"
              style={{
                margin: 0,
                padding: config.space.S200,
                maxHeight: toRem(320),
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: 'monospace',
              }}
            >
              {JSON.stringify(shown.getContent(), null, 2)}
            </Text>
          )}
        </SettingTile>
      </SettingsCard>
    </Box>
  );
}

/**
 * The developer tools switch and the hidden timeline events; with the tools on, the access token
 * and the account data appear.
 */
export function DeveloperTools({ requestClose }: SettingsPageProps) {
  const { t } = useTranslation();
  const [developerTools, setDeveloperTools] = useSetting(settingsAtom, 'developerTools');
  const switchLabel = t(`${TOOLS}.enableDeveloperTools`);

  return (
    <SettingsPageFrame title={t('settings.nav.developerTools')} requestClose={requestClose}>
      <Box direction="Column" gap="100">
        <Text size="L400" data-settings-heading="">
          {t(`${TOOLS}.options`)}
        </Text>
        <SettingsCard>
          <SettingTile
            focusId="developerTools"
            title={switchLabel}
            after={
              <Switch
                variant="Primary"
                aria-label={switchLabel}
                value={developerTools}
                onChange={setDeveloperTools}
              />
            }
          />
          <SettingSwitchTile
            focusId="showHiddenEvents"
            setting="showHiddenEvents"
            title={t('settings.general.messages.showHiddenEvents')}
          />
          {developerTools && <AccessTokenTile />}
        </SettingsCard>
      </Box>
      {developerTools && <AccountDataViewer />}
    </SettingsPageFrame>
  );
}
