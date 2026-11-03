import React, { useCallback, useMemo, useState } from 'react';
import { Box, Text } from 'folds';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { SSOAction, type IIdentityProvider, type ILoginFlowsResponse } from 'matrix-js-sdk';
import { AuthFlowsLoader } from '../../../components/AuthFlowsLoader';
import { useAutoDiscoveryInfo } from '../../../hooks/useAutoDiscoveryInfo';
import { useClientConfig } from '../../../hooks/useClientConfig';
import {
  getMindroomAuthSsoRedirectUrl,
  shouldDisablePasswordLogin,
  shouldRequireAppleProvider,
} from '../../../mindroom/auth/authUi';
import { getLoginPath, getOriginBaseUrl, getRegisterPath } from '../../pathUtils';
import { isAddAccountSearch, withAddAccountSearchIf } from '../addAccount';
import { SSOLogin } from '../SSOLogin';
import { FieldError } from '../FiledError';
import { hasAppleIdentityProvider } from '../ssoProviders';
import { PasswordLoginForm } from './PasswordLoginForm';
import { TokenLogin, TokenLoginError } from './TokenLogin';
import type { LoginError } from './loginUtil';

type ParsedLoginFlows = {
  password: boolean;
  token: boolean;
  sso?: { providers?: IIdentityProvider[] };
};

const parseLoginFlows = ({ flows }: ILoginFlowsResponse): ParsedLoginFlows => {
  const sso = flows.find((flow) => flow.type === 'm.login.sso') as
    | { identity_providers?: IIdentityProvider[] }
    | undefined;
  return {
    password: flows.some((flow) => flow.type === 'm.login.password'),
    token: flows.some((flow) => flow.type === 'm.login.token'),
    sso: sso ? { providers: sso.identity_providers } : undefined,
  };
};

type LoginMethodsProps = {
  server: string;
  baseUrl: string;
  flows: ParsedLoginFlows;
  ssoRedirectUrl: string;
};

/** The sign-in methods this client offers on the server, after the MindRoom auth policy. */
function LoginMethods({ server, baseUrl, flows, ssoRedirectUrl }: LoginMethodsProps) {
  const { t } = useTranslation();
  const { auth } = useClientConfig();
  const passwordDisabled = shouldDisablePasswordLogin(server, auth);
  const appleMissing =
    shouldRequireAppleProvider(server, auth) && !hasAppleIdentityProvider(flows.sso?.providers);
  const showPassword = flows.password && !passwordDisabled;
  const showSso = !!flows.sso && !appleMissing;

  return (
    <>
      {appleMissing && (
        <FieldError
          message={t(
            'sharedUi.login.thisClientRequiresSignInWithAppleConfigureTheHomeserverSsoProvider'
          )}
        />
      )}
      {showPassword && <PasswordLoginForm baseUrl={baseUrl} server={server} />}
      {flows.password && passwordDisabled && !flows.sso && (
        <FieldError
          message={t('sharedUi.login.passwordLoginIsDisabledOnValue1UseSsoToSignIn', {
            value1: server,
          })}
        />
      )}
      {!flows.password && !flows.sso && (
        <FieldError
          message={t('sharedUi.login.thisClientDoesNotSupportLoginOnValue1ServerPasswordAndSso', {
            value1: server,
          })}
        />
      )}
      {showSso && (
        <SSOLogin
          providers={flows.sso?.providers}
          redirectUrl={ssoRedirectUrl}
          action={SSOAction.LOGIN}
          saveScreenSpace={showPassword}
        />
      )}
    </>
  );
}

/** Sign in with a password, single sign-on, or a login token from an SSO redirect. */
export function Login() {
  const { t } = useTranslation();
  const { server } = useOutletContext<{ server: string }>();
  const baseUrl = useAutoDiscoveryInfo()['m.homeserver'].base_url;
  const { hashRouter, auth } = useClientConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const loginToken = searchParams.get('loginToken');
  const addAccount = isAddAccountSearch(searchParams);
  const [tokenError, setTokenError] = useState<LoginError>();

  // A rejected token leaves the address, so a reload does not try it again, and the
  // sign-in methods come back under the explanation.
  const handleTokenFailure = useCallback(
    (error: LoginError) => {
      setTokenError(error);
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          next.delete('loginToken');
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  // The homeserver sends the browser (or, in the native app, the app link) back here.
  const ssoRedirectUrl = useMemo(
    () =>
      getMindroomAuthSsoRedirectUrl(
        `${getOriginBaseUrl(hashRouter)}${withAddAccountSearchIf(getLoginPath(server), addAccount)}`
      ),
    [hashRouter, server, addAccount]
  );

  return (
    <Box direction="Column" gap="500">
      <Text as="h1" size="H2" priority="400">
        {t('sharedUi.login.login')}
      </Text>
      {tokenError && !loginToken && <TokenLoginError error={tokenError} />}
      {loginToken ? (
        <TokenLogin baseUrl={baseUrl} token={loginToken} onFailure={handleTokenFailure} />
      ) : (
        <AuthFlowsLoader>
          {({ loginFlows }) => (
            <LoginMethods
              server={server}
              baseUrl={baseUrl}
              flows={parseLoginFlows(loginFlows)}
              ssoRedirectUrl={ssoRedirectUrl}
            />
          )}
        </AuthFlowsLoader>
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
