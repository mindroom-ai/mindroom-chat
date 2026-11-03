import React from 'react';
import { Box, Text } from 'folds';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { getLoginPath } from '../../pathUtils';
import { PasswordResetForm } from './PasswordResetForm';

export function ResetPassword() {
  const { t } = useTranslation();
  const { server } = useOutletContext<{ server: string }>();
  const [searchParams] = useSearchParams();
  return (
    <Box direction="Column" gap="500">
      <Text size="H2" priority="400">
        {t('featureUi.auth.resetPassword.title')}
      </Text>
      <PasswordResetForm defaultEmail={searchParams.get('email') ?? undefined} />
      <Text align="Center">
        <Trans
          i18nKey="sharedUi.resetPassword.accountLink"
          components={{ authLink: <Link to={getLoginPath(server)} /> }}
        />
      </Text>
    </Box>
  );
}
