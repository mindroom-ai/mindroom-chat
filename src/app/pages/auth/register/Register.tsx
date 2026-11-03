import React, { useMemo } from 'react';
import { Box, Text } from 'folds';
import { Link, Navigate, useOutletContext, useSearchParams } from 'react-router-dom';
import { Trans, useTranslation } from 'react-i18next';
import { SSOAction, type IIdentityProvider } from 'matrix-js-sdk';
import {
  AuthFlowsLoader,
  RegisterFlowStatus,
  type AuthFlows,
} from '../../../components/AuthFlowsLoader';
import { useAutoDiscoveryInfo } from '../../../hooks/useAutoDiscoveryInfo';
import { useClientConfig } from '../../../hooks/useClientConfig';
import {
  getMindroomAuthSsoRedirectUrl,
  shouldDisablePasswordLogin,
  shouldRequireAppleProvider,
  shouldUseSsoOnlyRegistration,
} from '../../../mindroom/auth/authUi';
import { getLoginPath, getOriginBaseUrl } from '../../pathUtils';
import { isAddAccountSearch, withAddAccountSearchIf } from '../addAccount';
import { FieldError } from '../FiledError';
import { SSOLogin } from '../SSOLogin';
import { hasAppleIdentityProvider } from '../ssoProviders';
import { PasswordRegisterForm, canRegisterWithPassword } from './PasswordRegisterForm';

const getSsoProviders = ({ loginFlows }: AuthFlows): IIdentityProvider[] | undefined => {
  const sso = loginFlows.flows.find((flow) => flow.type === 'm.login.sso') as
    | { identity_providers?: IIdentityProvider[] }
    | undefined;
  return sso ? sso.identity_providers ?? [] : undefined;
};

type RegisterMethodsProps = {
  server: string;
  baseUrl: string;
  authFlows: AuthFlows;
  ssoRedirectUrl: string;
};

/** What this client can offer for sign-up on the server, after the MindRoom auth policy. */
function RegisterMethods({ server, baseUrl, authFlows, ssoRedirectUrl }: RegisterMethodsProps) {
  const { t } = useTranslation();
  const { auth } = useClientConfig();
  const { registerFlows } = authFlows;
  const providers = getSsoProviders(authFlows);

  if (shouldRequireAppleProvider(server, auth) && !hasAppleIdentityProvider(providers)) {
    return (
      <FieldError
        message={t(
          'sharedUi.register.thisClientRequiresSignInWithAppleConfigureTheHomeserverSsoProvider'
        )}
      />
    );
  }

  if (shouldUseSsoOnlyRegistration(server)) {
    if (!providers) {
      return (
        <FieldError
          message={t(
            'sharedUi.register.ssoRegistrationIsRequiredOnThisHomeserverButNoSsoProvidersWere'
          )}
        />
      );
    }
    return (
      <Box direction="Column" gap="400">
        <Text size="T300">
          {t('sharedUi.register.thisHomeserverOnlyAllowsSignUpWithAppleGoogleOrGithub')}
        </Text>
        <SSOLogin providers={providers} redirectUrl={ssoRedirectUrl} action={SSOAction.REGISTER} />
      </Box>
    );
  }

  if (registerFlows.status === RegisterFlowStatus.Disabled) {
    return (
      <FieldError message={t('sharedUi.register.registrationHasBeenDisabledOnThisHomeserver')} />
    );
  }
  if (registerFlows.status === RegisterFlowStatus.RateLimited) {
    return (
      <FieldError message={t('sharedUi.register.youHaveBeenRateLimitedPleaseTryAfterSomeTime')} />
    );
  }
  if (registerFlows.status !== RegisterFlowStatus.FlowRequired) {
    return (
      <FieldError
        message={t('sharedUi.register.invalidRequestFailedToGetAnyRegistrationOptions')}
      />
    );
  }

  // A deployment without password sign-in offers no password sign-up either.
  const passwordSupported =
    canRegisterWithPassword(registerFlows.data) && !shouldDisablePasswordLogin(server, auth);
  if (!passwordSupported && !providers) {
    return (
      <FieldError
        message={t('sharedUi.register.thisApplicationDoesNotSupportRegistrationOnThisHomeserver')}
      />
    );
  }
  return (
    <Box direction="Column" gap="400">
      {passwordSupported && <PasswordRegisterForm baseUrl={baseUrl} />}
      {providers && (
        <SSOLogin
          providers={providers}
          redirectUrl={ssoRedirectUrl}
          action={SSOAction.REGISTER}
          saveScreenSpace={passwordSupported}
        />
      )}
    </Box>
  );
}

/**
 * Creates an account with a password or through single sign-on. A deployment that turned
 * registration off sends the page to login.
 */
export function Register() {
  const { t } = useTranslation();
  const { server } = useOutletContext<{ server: string }>();
  const baseUrl = useAutoDiscoveryInfo()['m.homeserver'].base_url;
  const { hashRouter, auth } = useClientConfig();
  const [searchParams] = useSearchParams();
  const addAccount = isAddAccountSearch(searchParams);

  // A completed SSO sign-up returns with a login token, which the login page exchanges.
  const ssoRedirectUrl = useMemo(
    () =>
      getMindroomAuthSsoRedirectUrl(
        `${getOriginBaseUrl(hashRouter)}${withAddAccountSearchIf(getLoginPath(server), addAccount)}`
      ),
    [hashRouter, server, addAccount]
  );

  const loginLink = withAddAccountSearchIf(getLoginPath(server), addAccount);
  if (auth?.allowRegistration === false) {
    return <Navigate to={loginLink} replace />;
  }

  return (
    <Box gap="500" direction="Column">
      <Text as="h1" size="H2" priority="400">
        {t('sharedUi.register.register')}
      </Text>
      <AuthFlowsLoader>
        {(authFlows) => (
          <RegisterMethods
            authFlows={authFlows}
            baseUrl={baseUrl}
            server={server}
            ssoRedirectUrl={ssoRedirectUrl}
          />
        )}
      </AuthFlowsLoader>
      <Text align="Center">
        <Trans
          i18nKey="sharedUi.register.accountLink"
          components={{ authLink: <Link to={loginLink} /> }}
        />
      </Text>
    </Box>
  );
}
