import React from 'react';
import { Box, Text } from 'folds';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { getLoginPath } from '../../pathUtils';
import { isAddAccountSearch, withAddAccountSearchIf } from '../addAccount';
import { PasswordResetForm } from './PasswordResetForm';

/** Sets a new password through the account's email, then points back to login. */
export function ResetPassword() {
  const { t } = useTranslation();
  const { server } = useOutletContext<{ server: string }>();
  const [searchParams] = useSearchParams();
  // Leaving for login keeps an add-account flow an add-account flow.
  const loginLink = withAddAccountSearchIf(getLoginPath(server), isAddAccountSearch(searchParams));
  return (
    <Box direction="Column" gap="500">
      <Text size="H2" priority="400">
        {t('sharedUi.resetPassword.resetPassword')}
      </Text>
      <PasswordResetForm
        defaultEmail={searchParams.get('email') ?? undefined}
        loginLink={loginLink}
      />
      <Text align="Center">
        <Trans
          i18nKey="sharedUi.resetPassword.accountLink"
          components={{ authLink: <Link to={loginLink} /> }}
        />
      </Text>
    </Box>
  );
}
