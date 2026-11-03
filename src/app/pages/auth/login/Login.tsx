import React, { FormEventHandler, useEffect, useMemo, useState } from 'react';
import { Box, Button, Input, Spinner, Text, color } from 'folds';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { SSOAction, type IIdentityProvider } from 'matrix-js-sdk';
import { useAutoDiscoveryInfo } from '../../../hooks/useAutoDiscoveryInfo';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { createMatrixClient } from '../../../mindroom/matrix/matrixClientFactory';
import { getOriginBaseUrl, getRegisterPath, getResetPasswordPath } from '../../pathUtils';
import { isAddAccountSearch, withAddAccountSearchIf } from '../addAccount';
import { SSOLogin } from '../SSOLogin';
import { FieldError } from '../FiledError';
import { CustomLoginResponse, LoginFailure, login, useLoginComplete } from './loginUtil';

type LoginFlows = {
  password: boolean;
  sso: boolean;
  token: boolean;
  providers?: IIdentityProvider[];
};

const useLoginFlows = (baseUrl: string): LoginFlows | undefined => {
  const [flows, setFlows] = useState<LoginFlows>();
  useEffect(() => {
    let cancelled = false;
    createMatrixClient({ baseUrl })
      .loginFlows()
      .then(({ flows: list }) => {
        if (cancelled) return;
        const sso = list.find((flow) => flow.type === 'm.login.sso') as
          | { identity_providers?: IIdentityProvider[] }
          | undefined;
        setFlows({
          password: list.some((flow) => flow.type === 'm.login.password'),
          sso: !!sso,
          token: list.some((flow) => flow.type === 'm.login.token'),
          providers: sso?.identity_providers,
        });
      })
      .catch(() => {
        if (!cancelled) setFlows({ password: true, sso: false, token: false });
      });
    return () => {
      cancelled = true;
    };
  }, [baseUrl]);






  const { server } = useOutletContext<{ server: string }>();
  const baseUrl = useAutoDiscoveryInfo()['m.homeserver'].base_url;
  const { hashRouter, auth } = useClientConfig();
  const [searchParams] = useSearchParams();
  const loginToken = searchParams.get('loginToken');
  const addAccount = isAddAccountSearch(searchParams);
  const flows = useLoginFlows(baseUrl);
  const [result, setResult] = useState<CustomLoginResponse>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const storeFailed = useLoginComplete(result);

  const redirectUrl = useMemo(
    () =>
      `${getOriginBaseUrl(hashRouter)}${withAddAccountSearchIf(
        `/login/${encodeURIComponent(server)}/`,
        addAccount
      )}`,
    [hashRouter, server, addAccount]
  );

  useEffect(() => {
    if (!loginToken) return;
    setBusy(true);
    login(baseUrl, { type: 'm.login.token', token: loginToken })
      .then(setResult)
      .catch((loginError: unknown) =>
        setError(loginError instanceof LoginFailure ? loginError.message : String(loginError))
      )
      .finally(() => setBusy(false));
  }, [baseUrl, loginToken]);

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
          initial_device_display_name: 'MindRoom Client',
        } as never)
      );
    } catch (loginError) {
      setError(
        loginError instanceof LoginFailure && loginError.code === 'Forbidden'
          ? t('featureUi.auth.login.invalidCredentials')
          : loginError instanceof Error
          ? loginError.message
          : String(loginError)
      );
    } finally {
      setBusy(false);
    }
  };







      </Text>
      {storeFailed && (
        <Text style={{ color: color.Critical.Main }}>{t('featureUi.auth.storeFailed')}</Text>
      )}
      {passwordAllowed && (
        <Box as="form" onSubmit={handleSubmit} direction="Column" gap="400">
          <Box direction="Column" gap="100">
            <Text as="label" size="L400" priority="300">
              {t('featureUi.auth.login.username')}
            </Text>
            <Input
              name="usernameInput"
              variant="Background"
              size="500"
              required
              outlined
              autoComplete="username"








              type="password"
              variant="Background"
              size="500"
              required
              outlined
              autoComplete="current-password"
            />
            <Box justifyContent="End">
              <Text as={Link} size="T200" to={getResetPasswordPath(server)}>
                {t('featureUi.auth.login.forgotPassword')}
              </Text>
            </Box>
          </Box>
          {error && <FieldError message={error} />}
          <Button
            type="submit"
            variant="Primary"
            size="500"
            disabled={busy}
            before={busy ? <Spinner variant="Primary" fill="Solid" size="200" /> : undefined}
          >
            <Text as="span" size="B500">
              {t('featureUi.auth.login.submit')}
            </Text>
          </Button>
        </Box>
      )}
      {!passwordAllowed && error && <FieldError message={error} />}
      {flows?.sso && (
        <SSOLogin
          providers={flows.providers}
          redirectUrl={redirectUrl}
          action={SSOAction.LOGIN}
          saveScreenSpace={passwordAllowed}
        />
      )}
      {auth?.allowRegistration !== false && (
        <Text align="Center">
          <Trans
            i18nKey="sharedUi.login.accountLink"
            components={{
              authLink: <Link to={withAddAccountSearchIf(getRegisterPath(server), addAccount)} />,
            }}
          />
        </Text>
      )}
    </Box>
  );
}
