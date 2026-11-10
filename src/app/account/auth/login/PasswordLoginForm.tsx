import { FormEvent, useState } from 'react';
import { Box, Button, Input, Spinner, Text } from 'folds';
import { Link, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { PasswordInput } from '../../../ui/PasswordInput';
import { getDeviceDisplayName } from '../authUi';
import { getResetPasswordPath } from '../../../routes/pathUtils';
import { isAddAccountSearch, withAddAccountSearchIf } from '../../../navigation/addAccount';
import { FieldError } from '../FiledError';
import {
  CustomLoginResponse,
  LoginError,
  LoginFailure,
  login,
  resolveMatrixIdHomeserver,
  useLoginComplete,
} from './loginUtil';
import { isServerChoiceAllowed } from '../authRouteUtils';
import { useClientConfig } from '../../../config/useClientConfig';
import { AuthField } from '../AuthField';

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
  /** The single sign-on the page offers beside the form, named for the hint after a rejection. */
  ssoProviderNames?: string;
};

/** Username (or email) and password login at the chosen homeserver. */
export function PasswordLoginForm({ baseUrl, server, ssoProviderNames }: PasswordLoginFormProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<CustomLoginResponse>();
  const [error, setError] = useState<LoginError>();
  const [busy, setBusy] = useState(false);
  const storeFailed = useLoginComplete(result);
  const clientConfig = useClientConfig();
  const [searchParams] = useSearchParams();
  const resetLink = withAddAccountSearchIf(
    getResetPasswordPath(server),
    isAddAccountSearch(searchParams)
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
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
      // A full Matrix ID may name another homeserver than the one picked above.
      const loginBaseUrl = await resolveMatrixIdHomeserver(user, baseUrl, (name) =>
        isServerChoiceAllowed(clientConfig, name)
      );
      setResult(
        await login(loginBaseUrl, {
          type: 'm.login.password',
          identifier:
            user.includes('@') && !user.startsWith('@')
              ? { type: 'm.id.thirdparty', medium: 'email', address: user }
              : { type: 'm.id.user', user },
          password,
          initial_device_display_name: getDeviceDisplayName(),
        } as never)
      );
    } catch (loginError) {
      setError(loginError instanceof LoginFailure ? loginError.code : LoginError.Unknown);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box
      as="form"
      direction="Column"
      gap="400"
      onSubmit={(event: FormEvent<HTMLFormElement>) => void handleSubmit(event)}
    >
      <AuthField caption={t('sharedUi.passwordLoginForm.username2')}>
        <Input
          autoComplete="username"
          name="usernameInput"
          outlined
          required
          size="500"
          variant="Background"
        />
      </AuthField>
      <AuthField caption={t('sharedUi.passwordLoginForm.password')}>
        <PasswordInput
          autoComplete="current-password"
          name="passwordInput"
          outlined
          required
          size="500"
          variant="Background"
        />
        <Box justifyContent="End">
          <Text as={Link} size="T200" to={resetLink}>
            {t('sharedUi.passwordLoginForm.forgotPassword')}
          </Text>
        </Box>
      </AuthField>
      {error && <FieldError message={t(LOGIN_ERROR_KEYS[error])} />}
      {error === LoginError.Forbidden && ssoProviderNames && (
        <Text size="T300" priority="400">
          {t('sharedUi.passwordLoginForm.mayUseSso', { provider: ssoProviderNames })}
        </Text>
      )}
      {storeFailed && (
        <FieldError
          message={t(
            'sharedUi.passwordLoginForm.loginSucceededButThisBrowserCouldNotSaveTheAccountCheckStorage'
          )}
        />
      )}
      {/* Beside single sign-on, the password is the second way in and its button says so. */}
      <Button
        type="submit"
        variant={ssoProviderNames ? 'Secondary' : 'Primary'}
        fill={ssoProviderNames ? 'Soft' : undefined}
        outlined={!!ssoProviderNames}
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
