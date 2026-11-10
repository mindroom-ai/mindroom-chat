import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text } from 'folds';
import { Link, useOutletContext, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { SSOAction, type IIdentityProvider, type ILoginFlowsResponse } from 'matrix-js-sdk';
import { AuthFlowsLoader } from '../AuthFlowsLoader';
import { useAutoDiscoveryInfo } from '../../../matrix/hooks/useAutoDiscoveryInfo';
import { useClientConfig } from '../../../config/useClientConfig';
import {
  getAuthSsoRedirectUrl,
  shouldDisablePasswordLogin,
  shouldRequireAppleProvider,
} from '../authUi';
import { getLoginPath, getOriginBaseUrl, getRegisterPath } from '../../../routes/pathUtils';
import { isAddAccountSearch, withAddAccountSearchIf } from '../../../navigation/addAccount';
import { SSOLogin } from '../SSOLogin';
import { FieldError } from '../FiledError';
import { getSsoProviderNames, hasAppleIdentityProvider } from '../ssoProviders';
import { claimSsoLogin, SSO_NONCE_PARAM } from '../ssoReturn';
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

/**
 * The sign-in methods this client offers on the server, after the MindRoom auth policy. Single
 * sign-on comes first: on servers whose accounts are made by it, a password cannot sign anyone in.
 */
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
      {showSso && (
        <SSOLogin
          providers={flows.sso?.providers}
          redirectUrl={ssoRedirectUrl}
          action={SSOAction.LOGIN}
        />
      )}
      {showPassword && showSso && (
        <Text size="T200" priority="300" align="Center">
          {t('sharedUi.login.orSignInWithPassword')}
        </Text>
      )}
      {showPassword && (
        <PasswordLoginForm
          baseUrl={baseUrl}
          server={server}
          ssoProviderNames={showSso ? getSsoProviderNames(flows.sso?.providers) : undefined}
        />
      )}
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
    </>
  );
}

/** A login token in the address that no sign-in from this tab asked for. */
const NOT_STARTED_HERE = 'notStartedHere';
type TokenProblem = LoginError | typeof NOT_STARTED_HERE;

/** The token from an SSO return and the homeserver this tab sent that sign-in to. */
type TokenExchange = { token: string; baseUrl: string };

/** Sign in with a password, single sign-on, or a login token from an SSO redirect. */
export function Login() {
  const { t } = useTranslation();
  const { server } = useOutletContext<{ server: string }>();
  const baseUrl = useAutoDiscoveryInfo()['m.homeserver'].base_url;
  const { hashRouter, auth } = useClientConfig();
  const [searchParams, setSearchParams] = useSearchParams();
  const loginToken = searchParams.get('loginToken');
  const returnNonce = searchParams.get(SSO_NONCE_PARAM);
  const addAccount = isAddAccountSearch(searchParams);
  const [exchange, setExchange] = useState<TokenExchange>();
  const [tokenProblem, setTokenProblem] = useState<TokenProblem>();
  const handledToken = useRef<string>();

  // A token is exchanged only when a sign-in started in this tab brought it back, and only at
  // the homeserver that sign-in went to: the server named in the address is not trusted, since
  // a link can name any server (and carry anyone's token). Either way the token and the nonce
  // leave the address, so a reload does not try them again.
  useEffect(() => {
    if (!loginToken || handledToken.current === loginToken) return;
    handledToken.current = loginToken;
    const homeserver = claimSsoLogin(loginToken, returnNonce);
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        next.delete('loginToken');
        next.delete(SSO_NONCE_PARAM);
        return next;
      },
      { replace: true }
    );
    if (homeserver) {
      setTokenProblem(undefined);
      setExchange({ token: loginToken, baseUrl: homeserver });
    } else {
      setExchange(undefined);
      setTokenProblem(NOT_STARTED_HERE);
    }
  }, [loginToken, returnNonce, setSearchParams]);

  // A rejected token brings the sign-in methods back under the explanation.
  const handleTokenFailure = useCallback((error: LoginError) => {
    setExchange(undefined);
    setTokenProblem(error);
  }, []);

  // The homeserver sends the browser (or, in the native app, the app link) back here.
  const ssoRedirectUrl = useMemo(
    () =>
      getAuthSsoRedirectUrl(
        `${getOriginBaseUrl(hashRouter)}${withAddAccountSearchIf(getLoginPath(server), addAccount)}`
      ),
    [hashRouter, server, addAccount]
  );

  return (
    <Box direction="Column" gap="500">
      <Text size="H2" priority="400">
        {t('sharedUi.login.login')}
      </Text>
      {!exchange && tokenProblem === NOT_STARTED_HERE && (
        <FieldError message={t('sharedUi.tokenLogin.signInNotStartedHere')} />
      )}
      {!exchange && tokenProblem && tokenProblem !== NOT_STARTED_HERE && (
        <TokenLoginError error={tokenProblem} />
      )}
      {exchange && (
        <TokenLogin
          baseUrl={exchange.baseUrl}
          token={exchange.token}
          onFailure={handleTokenFailure}
        />
      )}
      {!exchange && !loginToken && (
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
            i18nKey="sharedUi.login.noAccountLink"
            components={{
              authLink: <Link to={withAddAccountSearchIf(getRegisterPath(server), addAccount)} />,
            }}
          />
        </Text>
      )}
    </Box>
  );
}
