import React, { MouseEvent, useMemo, useState } from 'react';
import { Avatar, AvatarImage, Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { Capacitor } from '@capacitor/core';
import { SSOAction, type IIdentityProvider } from 'matrix-js-sdk';
import { createMatrixClient, createMatrixFetchFn } from '../../mindroom/matrix/matrixClientFactory';
import { hasCloudflareAccess } from '../../mindroom/native/cloudflareAccess';
import {
  isNativeApp,
  isNativeIOS,
  openNativeSsoBrowser,
  signInWithNativeApple,
} from '../../mindroom/auth/authUi';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import {
  getSSOProviderButtonTitle,
  isAppleIdentityProvider,
  sortIdentityProviders,
} from './ssoProviders';
import {
  createSsoNonce,
  rememberIssuedLoginToken,
  rememberSsoAttempt,
  withSsoNonce,
} from './ssoReturn';

/** Which flow the buttons start, and how they are laid out. */
type SSOButtonOptions = {
  action?: SSOAction;
  /** Shows providers as compact buttons in a row. */
  saveScreenSpace?: boolean;
};

type SSOLoginProps = SSOButtonOptions & {
  providers?: IIdentityProvider[];
  /** Where the homeserver sends the browser back with a login token. */
  redirectUrl: string;
};

const runningNatively = (): boolean => Capacitor.isNativePlatform() && isNativeApp();

/**
 * The fetch for the native Apple exchange, which answers with a login token for `baseUrl`. The
 * token is noted before the exchange hands it to the login page, whose address has no nonce.
 */
const noteIssuedToken =
  (request: typeof fetch, baseUrl: string): typeof fetch =>
  async (input, init) => {
    const response = await request(input, init);
    if (!response.ok) return response;
    const body: unknown = await response.json();
    const token =
      body && typeof body === 'object' ? (body as Record<string, unknown>).loginToken : '';
    if (typeof token === 'string' && token) rememberIssuedLoginToken(token, baseUrl);
    return new Response(JSON.stringify(body), {
      status: response.status,
      headers: response.headers,
    });
  };

/**
 * Single sign-on buttons. On the web they are plain links to the
 * homeserver's SSO redirect; in the native app they open an in-app browser
 * (or Sign in with Apple), since leaving the app would lose the callback.
 * Each press first notes the sign-in (`ssoReturn.ts`), so the login page
 * exchanges only a token that this sign-in brought back.
 */
export function SSOLogin({ action, providers, redirectUrl, saveScreenSpace }: SSOLoginProps) {
  const homeserverUrl = useAutoDiscoveryInfo()['m.homeserver'].base_url;
  const { t } = useTranslation();
  const orderedProviders = useMemo(() => sortIdentityProviders(providers), [providers]);
  // Unauthenticated client, used only to build SSO redirect and media URLs.
  const loginClient = useMemo(
    () => createMatrixClient({ baseUrl: homeserverUrl }),
    [homeserverUrl]
  );
  const inNativeShell = runningNatively();
  const [nonce] = useState(createSsoNonce);
  const returnUrl = useMemo(() => withSsoNonce(redirectUrl, nonce), [redirectUrl, nonce]);

  const ssoUrl = (providerId?: string): string =>
    loginClient.getSsoLoginUrl(returnUrl, 'sso', providerId, action);

  const openInNativeBrowser = async (event: MouseEvent, url: string) => {
    event.preventDefault();
    try {
      await openNativeSsoBrowser(url, hasCloudflareAccess(homeserverUrl));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[SSO] Failed to open native browser', error);
    }
  };

  const signInWithApple = async (event: MouseEvent, provider: IIdentityProvider, url: string) => {
    event.preventDefault();
    try {
      await signInWithNativeApple({
        baseUrl: homeserverUrl,
        ssoUrl: url,
        ephemeral: hasCloudflareAccess(homeserverUrl),
        providerId: provider.id,
        redirectUrl,
        request: noteIssuedToken(createMatrixFetchFn(fetch), homeserverUrl),
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[SSO] Native Apple sign-in failed', error);
    }
  };

  const nativeAppleAvailable = isNativeIOS() && Capacitor.isPluginAvailable('MindRoomAuth');

  const renderButton = (
    key: string,
    url: string,
    label: string,
    onNativeClick: (event: MouseEvent) => void,
    icon?: string
  ) => (
    <Button
      key={key}
      // A link styled as a button: no link underline under its label.
      style={{ width: saveScreenSpace ? undefined : '100%', textDecoration: 'none' }}
      size="500"
      variant="Secondary"
      fill="Soft"
      outlined
      {...(inNativeShell ? {} : { as: 'a' as const, href: url })}
      onClick={(event: MouseEvent) => {
        rememberSsoAttempt(nonce, homeserverUrl);
        if (inNativeShell) onNativeClick(event);
      }}
      before={
        icon ? (
          <Avatar size="200" radii="300">
            <AvatarImage src={icon} alt={label} />
          </Avatar>
        ) : undefined
      }
    >
      <Text align="Center" size="B500" truncate>
        {label}
      </Text>
    </Button>
  );

  if (orderedProviders.length === 0) {
    const url = ssoUrl();
    return (
      <Box direction="Column" gap="200">
        {renderButton('sso', url, t('sharedUi.sSOLogin.continueWithSso'), (event) =>
          openInNativeBrowser(event, url)
        )}
      </Box>
    );
  }

  return (
    <Box
      direction={saveScreenSpace ? 'Row' : 'Column'}
      gap="200"
      wrap="Wrap"
      justifyContent="Center"
    >
      {orderedProviders.map((provider) => {
        const url = ssoUrl(provider.id);
        const icon = provider.icon
          ? mxcUrlToHttp(loginClient, provider.icon, false) ?? undefined
          : undefined;
        const apple = isAppleIdentityProvider(provider);
        return renderButton(
          provider.id,
          url,
          getSSOProviderButtonTitle(provider, t, action),
          (event) =>
            apple && nativeAppleAvailable
              ? signInWithApple(event, provider, url)
              : openInNativeBrowser(event, url),
          icon
        );
      })}
    </Box>
  );
}
