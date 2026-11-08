import React, { useEffect, useState } from 'react';
import { Box, Spinner, Text } from 'folds';
import { ThreepidMedium } from 'matrix-js-sdk';
import { useTranslation } from 'react-i18next';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { SettingTile } from '../../ui/SettingTile';
import { SettingsCard } from '../../ui/settings/SettingsCard';

const KEY = 'featureUi.settings.account.contactInfo';

/**
 * The email addresses the homeserver has on file for this account (`GET /account/3pid`). The
 * section stays while the addresses load and when there are none; only a server that refuses the
 * request (no third-party ID support) leaves it out.
 */
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
        setEmails(
          threepids.filter((pid) => pid.medium === ThreepidMedium.Email).map((pid) => pid.address)
        );
      },
      () => current && setEmails(null)
    );
    return () => {
      current = false;
    };
  }, [client]);

  if (emails === null) return null;

  let addresses: React.ReactNode;
  if (emails === undefined) addresses = <Spinner size="50" variant="Secondary" />;
  else if (emails.length === 0) {
    addresses = (
      <Text size="T300" priority="300">
        {t('featureUi.settings.notifications.systemNotification.yourAccountDoesNotHaveAnyEmail')}
      </Text>
    );
  } else {
    addresses = emails.map((email) => (
      <Text key={email} size="T300">
        {email}
      </Text>
    ));
  }

  return (
    <Box direction="Column" gap="100">
      <Text size="L400" data-settings-heading="">
        {t(`${KEY}.contactInformation`)}
      </Text>
      <SettingsCard>
        <SettingTile
          focusId="email"
          title={t(`${KEY}.emailAddress`)}
          description={t(`${KEY}.emailAddressAttachedToYourAccount`)}
        >
          {addresses}
        </SettingTile>
      </SettingsCard>
    </Box>
  );
}
