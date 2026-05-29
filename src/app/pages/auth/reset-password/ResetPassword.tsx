import { Box, Text } from 'folds';
import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { getLoginPath } from '../../pathUtils';
import { useAuthServer } from '../../../hooks/useAuthServer';
import { PasswordResetForm } from './PasswordResetForm';
import { ResetPasswordPathSearchParams } from '../../paths';
import { isAddAccountSearch, withAddAccountSearchIf } from '../addAccount';

const useResetPasswordSearchParams = (
  searchParams: URLSearchParams
): ResetPasswordPathSearchParams =>
  useMemo(
    () => ({
      email: searchParams.get('email') ?? undefined,
    }),
    [searchParams]
  );

export function ResetPassword() {
  const server = useAuthServer();
  const [searchParams] = useSearchParams();
  const resetPasswordSearchParams = useResetPasswordSearchParams(searchParams);
  const addAccount = isAddAccountSearch(searchParams);

  return (
    <Box direction="Column" gap="500">
      <Text size="H2" priority="400">
        Reset Password
      </Text>
      <PasswordResetForm defaultEmail={resetPasswordSearchParams.email} addAccount={addAccount} />
      <span data-spacing-node />

      <Text align="Center">
        Remember your password?{' '}
        <Link to={withAddAccountSearchIf(getLoginPath(server), addAccount)}>Login</Link>
      </Text>
    </Box>
  );
}
