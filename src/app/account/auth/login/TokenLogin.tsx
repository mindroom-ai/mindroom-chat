import { useEffect, useRef, useState } from 'react';
import { Box, Spinner, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { getDeviceDisplayName } from '../authUi';
import { FieldError } from '../FiledError';
import {
  CustomLoginResponse,
  LoginError,
  LoginFailure,
  login,
  useLoginComplete,
} from './loginUtil';

const TOKEN_ERROR_KEYS = {
  [LoginError.ServerNotAllowed]: 'sharedUi.tokenLogin.failedToLoginUnknownReason',
  [LoginError.InvalidServer]: 'sharedUi.tokenLogin.failedToLoginUnknownReason',
  [LoginError.Forbidden]: 'sharedUi.tokenLogin.invalidLoginToken',
  [LoginError.UserDeactivated]: 'sharedUi.tokenLogin.thisAccountHasBeenDeactivated',
  [LoginError.InvalidRequest]: 'sharedUi.tokenLogin.failedToLoginPartOfYourRequestDataIsInvalid',
  [LoginError.RateLimited]:
    'sharedUi.tokenLogin.failedToLoginYourLoginRequestHasBeenRateLimitedByServer',
  [LoginError.Unknown]: 'sharedUi.tokenLogin.failedToLoginUnknownReason',
} as const;

/** The message for a login token the homeserver did not accept. */
export function TokenLoginError({ error }: { error: LoginError }) {
  const { t } = useTranslation();
  return <FieldError message={t(TOKEN_ERROR_KEYS[error])} />;
}

type TokenLoginProps = {
  baseUrl: string;
  /** The `loginToken` the homeserver's SSO redirect handed back. */
  token: string;
  /** Takes over when the exchange fails; without it the error shows here. */
  onFailure?: (error: LoginError) => void;
};

/** Exchanges the login token from an SSO redirect for a session. */
export function TokenLogin({ baseUrl, token, onFailure }: TokenLoginProps) {
  const { t } = useTranslation();
  const [result, setResult] = useState<CustomLoginResponse>();
  const [error, setError] = useState<LoginError>();
  const storeFailed = useLoginComplete(result);
  const failureRef = useRef(onFailure);
  failureRef.current = onFailure;

  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    login(baseUrl, {
      type: 'm.login.token',
      token,
      initial_device_display_name: getDeviceDisplayName(),
    } as never)
      .then((response) => {
        if (!cancelled) setResult(response);
      })
      .catch((loginError: unknown) => {
        if (cancelled) return;
        const code = loginError instanceof LoginFailure ? loginError.code : LoginError.Unknown;
        if (failureRef.current) failureRef.current(code);
        else setError(code);
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl, token]);

  if (error) return <TokenLoginError error={error} />;
  if (storeFailed) {
    return (
      <FieldError
        message={t(
          'sharedUi.tokenLogin.loginSucceededButThisBrowserCouldNotSaveTheAccountCheckStorage'
        )}
      />
    );
  }
  return (
    <Box justifyContent="Center" alignItems="Center" gap="200">
      <Spinner variant="Secondary" size="200" />
      <Text size="T300">{t('sharedUi.tokenLogin.tokenLogin')}</Text>
    </Box>
  );
}
