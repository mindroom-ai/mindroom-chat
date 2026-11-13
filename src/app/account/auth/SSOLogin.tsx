import { MouseEvent, useMemo, useState } from 'react';
import { Avatar, AvatarImage, Box, Button, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import classNames from 'classnames';
import { Capacitor } from '@capacitor/core';
import { SSOAction, type IIdentityProvider } from 'matrix-js-sdk';
import { createMatrixClient, createMatrixFetchFn } from '../../matrix/client/matrixClientFactory';
import { hasCloudflareAccess } from '../../native/cloudflareAccess';
import {
  isNativeApp,
  isNativeIOS,
  openNativeSsoBrowser,
  signInWithNativeApple,
} from '../../native/nativeSso';
import { useAutoDiscoveryInfo } from '../../matrix/hooks/useAutoDiscoveryInfo';
import { mxcUrlToHttp } from '../../matrix/mediaUrl';
import appleMark from '../../../../public/res/svg/sso-apple-white.svg';
import githubMark from '../../../../public/res/svg/sso-github.svg';
import googleMark from '../../../../public/res/svg/sso-google.svg';
import {
  getKnownIdentityProvider,
  getSSOProviderButtonTitle,
  isAppleIdentityProvider,
  sortIdentityProviders,
  type KnownIdentityProvider,
} from './ssoProviders';
import * as css from './SSOLogin.css';
import {
  createSsoNonce,
  rememberIssuedLoginToken,
  rememberSsoAttempt,
  withSsoNonce,
} from './ssoReturn';
import { useSsoStartCheck } from './unlistedServer';

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

type Brand = NonNullable<KnownIdentityProvider>;

/** The mark this client ships for each provider it recognizes, whatever icon the server sends. */
const BRAND_MARKS: Record<Brand, string> = {
  apple: appleMark,
  google: googleMark,
  github: githubMark,
};

/** What goes in front of a provider's label: its bundled mark, or the server's icon. */
type ProviderMark = { brand?: Brand; src: string };

/**
 * A recognized provider always shows the bundled mark; any other shows the icon its homeserver
 * lists, as an HTTP URL of the server's media (none when it lists no icon).
 */
export const resolveProviderMark = (
  provider: IIdentityProvider,
  iconUrl: (mxc: string) => string | undefined
): ProviderMark | undefined => {
  const brand = getKnownIdentityProvider(provider);
  if (brand) return { brand, src: BRAND_MARKS[brand] };
  const src = provider.icon ? iconUrl(provider.icon) : undefined;
  return src ? { src } : undefined;
};

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
 * exchanges only a token that this sign-in brought back. On a server the
 * deployment does not offer, a press asks first (`unlistedServer.ts`).
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
  const inNativeShell = isNativeApp();
  const checkStart = useSsoStartCheck();
  const [nonce] = useState(createSsoNonce);
  const returnUrl = useMemo(() => withSsoNonce(redirectUrl, nonce), [redirectUrl, nonce]);

  const ssoUrl = (providerId?: string): string =>
    loginClient.getSsoLoginUrl(returnUrl, 'sso', providerId, action);

  const openInNativeBrowser = async (url: string) => {
    try {
      await openNativeSsoBrowser(url, hasCloudflareAccess(homeserverUrl));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[SSO] Failed to open native browser', error);
    }
  };

  const signInWithApple = async (provider: IIdentityProvider, url: string) => {
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

  // A press notes the sign-in, then leaves: through the link itself on the web, through the
  // in-app browser or Sign in with Apple natively. With a check, both wait for the person's yes.
  const press = (event: MouseEvent, url: string, startNative: () => Promise<void>) => {
    const leave = () => {
      rememberSsoAttempt(nonce, homeserverUrl);
      if (inNativeShell) void startNative();
      else window.location.assign(url);
    };
    if (checkStart) {
      event.preventDefault();
      checkStart(leave);
      return;
    }
    rememberSsoAttempt(nonce, homeserverUrl);
    if (!inNativeShell) return;
    event.preventDefault();
    void startNative();
  };

  // A mark is decorative (empty alt): the label stays the button's accessible name.
  const renderMark = (mark: ProviderMark) =>
    mark.brand ? (
      <img
        className={classNames(css.ProviderMark, mark.brand === 'github' && css.GitHubMark)}
        src={mark.src}
        alt=""
        data-sso-mark={mark.brand}
      />
    ) : (
      <Avatar size="200" radii="300">
        <AvatarImage src={mark.src} alt="" />
      </Avatar>
    );

  const renderButton = (
    key: string,
    url: string,
    label: string,
    startNative: () => Promise<void>,
    mark?: ProviderMark
  ) => (
    <Button
      key={key}
      className={mark?.brand === 'apple' ? css.AppleButton : undefined}
      // A link styled as a button: no link underline under its label.
      style={{ width: saveScreenSpace ? undefined : '100%', textDecoration: 'none' }}
      size="500"
      variant="Secondary"
      fill="Soft"
      outlined
      {...(inNativeShell ? {} : { as: 'a' as const, href: url })}
      onClick={(event: MouseEvent) => press(event, url, startNative)}
      before={mark ? renderMark(mark) : undefined}
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
        {renderButton('sso', url, t('sharedUi.sSOLogin.continueWithSso'), () =>
          openInNativeBrowser(url)
        )}
      </Box>
    );
  }

  return (
    <Box
      direction={saveScreenSpace ? 'Row' : 'Column'}
      // Full-width buttons stand apart like the cards of a list; a row of compact ones stays tight.
      gap={saveScreenSpace ? '200' : '600'}
      wrap="Wrap"
      justifyContent="Center"
    >
      {orderedProviders.map((provider) => {
        const url = ssoUrl(provider.id);
        const mark = resolveProviderMark(
          provider,
          (mxc) => mxcUrlToHttp(loginClient, mxc, false) ?? undefined
        );
        const apple = isAppleIdentityProvider(provider);
        return renderButton(
          provider.id,
          url,
          getSSOProviderButtonTitle(provider, t, action),
          () =>
            apple && nativeAppleAvailable
              ? signInWithApple(provider, url)
              : openInNativeBrowser(url),
          mark
        );
      })}
    </Box>
  );
}
