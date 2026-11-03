import React, { FormEventHandler, useState } from 'react';
import { Box, Button, Input, Spinner, Text } from 'folds';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PasswordInput } from '../../../components/password-input';
import { MINDROOM_AUTH_BRANDING } from '../../../mindroom/auth/authUi';
import { getResetPasswordPath } from '../../pathUtils';
import { FieldError } from '../FiledError';
import {
  CustomLoginResponse,
  LoginError,
  LoginFailure,
  login,
  useLoginComplete,
} from './loginUtil';

const LOGIN_ERROR_KEYS = {
  [LoginError.ServerNotAllowed]:
    'sharedUi.passwordLoginForm.loginWithCustomServerNotAllowedByYourClientInstance',
  [LoginError.InvalidServer]: 'sharedUi.passwordLoginForm.failedToFindYourMatrixIdServer',
  [LoginError.Forbidden]: 'sharedUi.passwordLoginForm.invalidUsernameOrPassword',
  [LoginError.UserDeactivated]: 'sharedUi.passwordLoginForm.thisAccountHasBeenDeactivated',
  [LoginError.InvalidRequest]:
    'sharedUi.passwordLoginForm.failedToLoginPartOfYourRequestDataIsInvalid',
  [LoginError.RateLimited]:
    'sharedUi.passwordLoginForm.failedToLoginYourLoginRequestHasBeenRateLimitedByServer',
  [LoginError.Unknown]: 'sharedUi.passwordLoginForm.failedToLoginUnknownReason',
} as const;

type PasswordLoginFormProps = {
  /** The homeserver base URL to log in at. */
  baseUrl: string;
  /** The server name, for the password reset link. */
  server: string;
};

/** Username (or email) and password login at the chosen homeserver. */
export function PasswordLoginForm({ baseUrl, server }: PasswordLoginFormProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<CustomLoginResponse>();
  const [error, setError] = useState<LoginError>();
  const [busy, setBusy] = useState(false);
  const storeFailed = useLoginComplete(result);

  const handleSubmit: FormEventHandler<HTMLFormElement> = async (event) => {
    event.preventDefault();
    const target = event.target as HTMLFormElement & {
      usernameInput: HTMLInputElement;
      passwordInput: HTMLInputElement;
    };
    const user = target.usernameInput.value.trim();
    const password = target.passwordInput.value;
    if (!user || !password) return;
    setBusy(true);
    setError(undefined);
    try {
      setResult(
        await login(baseUrl, {
          type: 'm.login.password',
          identifier:
            user.includes('@') && !user.startsWith('@')
              ? { type: 'm.id.thirdparty', medium: 'email', address: user }
              : { type: 'm.id.user', user },
          password,
          initial_device_display_name: MINDROOM_AUTH_BRANDING.deviceDisplayName,
        } as never)
      );
    } catch (loginError) {
      setError(loginError instanceof LoginFailure ? loginError.code : LoginError.Unknown);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box as="form" onSubmit={handleSubmit} direction="Column" gap="400">
      <Box direction="Column" gap="100">
        <Text as="label" size="L400" priority="300">
          {t('sharedUi.passwordLoginForm.username2')}
        </Text>
        <Input
          name="usernameInput"
          variant="Background"
          size="500"
          required
          outlined
          autoComplete="username"
        />
      </Box>
      <Box direction="Column" gap="100">
        <Text as="label" size="L400" priority="300">
          {t('sharedUi.passwordLoginForm.password')}
        </Text>
        <PasswordInput
          name="passwordInput"
          variant="Background"
          size="500"
          required
          outlined
          autoComplete="current-password"
        />
        <Box justifyContent="End">
          <Text as={Link} size="T200" to={getResetPasswordPath(server)}>
            {t('sharedUi.passwordLoginForm.forgetPassword')}
          </Text>
        </Box>
      </Box>
      {error && <FieldError message={t(LOGIN_ERROR_KEYS[error])} />}
      {storeFailed && (
        <FieldError
          message={t(
            'sharedUi.passwordLoginForm.loginSucceededButThisBrowserCouldNotSaveTheAccountCheckStorage'
          )}
        />
      )}
      <Button
        type="submit"
        variant="Primary"
        size="500"
        disabled={busy}
        before={busy ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined}
      >
        <Text as="span" size="B500">
          {t('sharedUi.passwordLoginForm.login')}
        </Text>
      </Button>
    </Box>
  );
}
