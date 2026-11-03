import React, { useEffect, useState } from 'react';
import { Box, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../../hooks/useMatrixClient';
import { SettingTile } from '../../../components/setting-tile';
import { SettingsCard } from '../SettingsCard';

/** The email addresses the homeserver has on file for this account (`GET /account/3pid`). */
export function ContactInfo() {
  const { t } = useTranslation();
  const client = useMatrixClient();
  // undefined while loading; null when the server would not say.
  const [emails, setEmails] = useState<string[] | null>();

  useEffect(() => {
    let current = true;
    client.getThreePids().then(
      ({ threepids }) => {
        if (!current) return;
        setEmails(threepids.filter((pid) => pid.medium === 'email').map((pid) => pid.address));
      },
      () => current && setEmails(null)
    );
    return () => {
      current = false;
    };
  }, [client]);

  // Nothing to show on servers without email support, or before anything is known.
  if (emails === null || (emails !== undefined && emails.length === 0)) return null;

  return (
    <Box direction="Column" gap="100">
      <Text size="L400">{t('featureUi.settings.account.contactInfo.contactInformation')}</Text>
      <SettingsCard>
        <SettingTile
          title={t('featureUi.settings.account.contactInfo.emailAddress')}
          description={t(
            'featureUi.settings.account.contactInfo.emailAddressAttachedToYourAccount'
          )}
        >
          {emails === undefined ? (
            <Spinner size="50" variant="Secondary" />
          ) : (
            emails.map((email) => (
              <Text key={email} size="T300">
                {email}
              </Text>
            ))
          )}
        </SettingTile>
      </SettingsCard>
    </Box>
  );
}
