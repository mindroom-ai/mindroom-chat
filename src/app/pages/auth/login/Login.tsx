import React, { useMemo } from 'react';
import { Box, Text, color } from 'folds';
import { Link, useSearchParams } from 'react-router-dom';
import { SSOAction } from 'matrix-js-sdk';
import { useAuthFlows } from '../../../hooks/useAuthFlows';
import { useAuthServer } from '../../../hooks/useAuthServer';
import { useParsedLoginFlows } from '../../../hooks/useParsedLoginFlows';
import { PasswordLoginForm } from './PasswordLoginForm';
import { SSOLogin } from '../SSOLogin';
import { TokenLogin } from './TokenLogin';
import { OrDivider } from '../OrDivider';
import { getLoginPath, getRegisterPath } from '../../pathUtils';
import { usePathWithOrigin } from '../../../hooks/usePathWithOrigin';
import { LoginPathSearchParams } from '../../paths';
import { useClientConfig } from '../../../hooks/useClientConfig';
import { hasAppleIdentityProvider } from '../ssoProviders';
import { buildNativeSsoRedirectUrl, isNativeIOS } from '../../../mindroom/native/nativeSso';
import { isAddAccountSearch, withAddAccountSearch } from '../addAccount';

const getLoginTokenSearchParam = () => {
  // when using hasRouter query params in existing route
  // gets ignored by react-router, so we need to read it ourself
  // we only need to read loginToken as it's the only param that
  // is provided by external entity. example: SSO login
  const parmas = new URLSearchParams(window.location.search);
  const loginToken = parmas.get('loginToken');
  return loginToken ?? undefined;
};

const useLoginSearchParams = (searchParams: URLSearchParams): LoginPathSearchParams =>
  useMemo(
    () => ({
      username: searchParams.get('username') ?? undefined,
      email: searchParams.get('email') ?? undefined,
      loginToken: searchParams.get('loginToken') ?? undefined,
    }),
    [searchParams]
  );

export function Login() {
  const server = useAuthServer();
  const { hashRouter, auth } = useClientConfig();
  const { loginFlows } = useAuthFlows();
  const [searchParams] = useSearchParams();
  const loginSearchParams = useLoginSearchParams(searchParams);
  const addAccount = isAddAccountSearch(searchParams);
  const webSsoRedirectUrl = usePathWithOrigin(getLoginPath(server));
  const ssoRedirectUrl = useMemo(() => {
    const redirectPath = addAccount ? withAddAccountSearch(webSsoRedirectUrl) : webSsoRedirectUrl;
    if (isNativeIOS()) {
      return buildNativeSsoRedirectUrl(redirectPath);
    }

    return redirectPath;
  }, [addAccount, webSsoRedirectUrl]);
  const loginTokenForHashRouter = getLoginTokenSearchParam();
  const absoluteLoginPath = addAccount ? withAddAccountSearch(webSsoRedirectUrl) : webSsoRedirectUrl;

  if (hashRouter?.enabled && loginTokenForHashRouter) {
    const loginTokenUrl = new URL(absoluteLoginPath);
    loginTokenUrl.searchParams.set('loginToken', loginTokenForHashRouter);
    window.location.replace(loginTokenUrl.toString());
  }

  const parsedFlows = useParsedLoginFlows(loginFlows.flows);
  const serverWithoutScheme = server.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const isMindroomServer = serverWithoutScheme.toLowerCase() === 'mindroom.chat';
  const disablePasswordLogin = auth?.disablePasswordLogin === true || isMindroomServer;
  const showPasswordLogin = parsedFlows.password !== undefined && !disablePasswordLogin;
  const registrationAllowed = auth?.allowRegistration !== false;
  const requireAppleProvider = auth?.requireAppleProvider === true;
  const appleProviderAvailable = hasAppleIdentityProvider(parsedFlows.sso?.identity_providers);

  return (
    <Box direction="Column" gap="500">
      <Text size="H2" priority="400">
        Login
      </Text>
      {requireAppleProvider && !appleProviderAvailable && (
        <Text style={{ color: color.Critical.Main }} size="T300">
          This client requires Sign in with Apple. Configure the homeserver SSO provider list to
          include Apple.
        </Text>
      )}
      {parsedFlows.token && loginSearchParams.loginToken && (
        <TokenLogin token={loginSearchParams.loginToken} addAccount={addAccount} />
      )}
      {showPasswordLogin && (
        <>
          <PasswordLoginForm
            defaultUsername={loginSearchParams.username}
            defaultEmail={loginSearchParams.email}
            addAccount={addAccount}
          />
          <span data-spacing-node />
          {parsedFlows.sso && <OrDivider />}
        </>
      )}
      {parsedFlows.sso && (
        <>
          <SSOLogin
            providers={parsedFlows.sso.identity_providers}
            redirectUrl={ssoRedirectUrl}
            action={SSOAction.LOGIN}
            saveScreenSpace={showPasswordLogin}
          />
          <span data-spacing-node />
        </>
      )}
      {!showPasswordLogin && !parsedFlows.sso && (
        <>
          <Text style={{ color: color.Critical.Main }}>
            {disablePasswordLogin
              ? `Password login is disabled on "${server}". Use SSO to sign in.`
              : `This client does not support login on "${server}" server. Password and SSO based login method not found.`}
          </Text>
          <span data-spacing-node />
        </>
      )}
      {registrationAllowed && !isMindroomServer && (
        <Text align="Center">
          Do not have an account?{' '}
          <Link to={addAccount ? withAddAccountSearch(getRegisterPath(server)) : getRegisterPath(server)}>
            Register
          </Link>
        </Text>
      )}
    </Box>
  );
}
