import React, { MouseEvent, useMemo } from 'react';
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
} from '../../mindroom/native/nativeSso';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import {
  getSSOProviderButtonTitle,
  isAppleIdentityProvider,
  sortIdentityProviders,
} from './ssoProviders';








};

const runningNatively = (): boolean => Capacitor.isNativePlatform() && isNativeApp();

/**
 * Single sign-on buttons. On the web they are plain links to the
 * homeserver's SSO redirect; in the native app they open an in-app browser
 * (or Sign in with Apple), since leaving the app would lose the callback.
 */




  const mx = useMemo(() => createMatrixClient({ baseUrl }), [baseUrl]);
  const native = runningNatively();
  const sortedProviders = useMemo(() => sortIdentityProviders(providers), [providers]);

  const ssoUrl = (providerId?: string): string =>
    mx.getSsoLoginUrl(redirectUrl, providerId ? 'sso' : 'sso', providerId, action);

  const openInNativeBrowser = async (event: MouseEvent, url: string) => {
    event.preventDefault();
    try {
      await openNativeSsoBrowser(url, hasCloudflareAccess(baseUrl));
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[SSO] Failed to open native browser', error);
    }
  };

  const signInWithApple = async (event: MouseEvent, provider: IIdentityProvider, url: string) => {
    event.preventDefault();
    try {
      await signInWithNativeApple({
        baseUrl,
        ssoUrl: url,
        ephemeral: hasCloudflareAccess(baseUrl),
        providerId: provider.id,
        redirectUrl,
        request: createMatrixFetchFn(fetch),
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
      style={{ width: saveScreenSpace ? undefined : '100%' }}
      size="500"
      variant="Secondary"
      fill="Soft"
      outlined
      {...(native ? {} : { as: 'a' as const, href: url })}
      onClick={(event: MouseEvent) => {
        if (native) onNativeClick(event);
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

  if (sortedProviders.length === 0) {
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
      {sortedProviders.map((provider) => {
        const url = ssoUrl(provider.id);
        const icon = provider.icon
          ? mxcUrlToHttp(mx, provider.icon, false) ?? undefined
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
