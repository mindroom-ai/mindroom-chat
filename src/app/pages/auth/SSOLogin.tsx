import { Avatar, AvatarImage, Box, Button, Text } from 'folds';
import { IIdentityProvider, SSOAction } from 'matrix-js-sdk';
import React, { useMemo, useRef } from 'react';
import { createMatrixClient } from '../../../client/matrixClientFactory';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import {
  getSSOProviderButtonTitle,
  hasAppleIdentityProvider,
  isAppleIdentityProvider,
  isGitHubIdentityProvider,
  isGoogleIdentityProvider,
  sortIdentityProviders,
} from './ssoProviders';
import AppleLogo from '../../../../public/res/svg/sso-apple-white.svg';
import GoogleLogo from '../../../../public/res/svg/sso-google.svg';
import GitHubLogo from '../../../../public/res/svg/sso-github.svg';
import { mxcUrlToHttp } from '../../utils/mediaUrl';
import { isNativeIOS, openNativeSsoBrowser } from '../../utils/nativeSso';

type SSOLoginProps = {
  providers?: IIdentityProvider[];
  redirectUrl: string;
  action?: SSOAction;
  saveScreenSpace?: boolean;
};
export function SSOLogin({ providers, redirectUrl, action, saveScreenSpace }: SSOLoginProps) {
  const discovery = useAutoDiscoveryInfo();
  const baseUrl = discovery['m.homeserver'].base_url;
  const mx = useMemo(() => createMatrixClient({ baseUrl }), [baseUrl]);
  const orderedProviders = sortIdentityProviders(providers);
  const appleProviderAvailable = hasAppleIdentityProvider(orderedProviders);
  const nativeIOS = isNativeIOS();
  const openingNativeSSORef = useRef(false);

  const handleSSONavigate =
    (url: string) =>
    async (evt: React.MouseEvent<HTMLElement>): Promise<void> => {
      if (!nativeIOS) return;

      evt.preventDefault();
      if (openingNativeSSORef.current) return;
      openingNativeSSORef.current = true;
      try {
        await openNativeSsoBrowser(url);
      } catch (error) {
        console.error('[SSO] Failed to open native iOS in-app browser', error);
      } finally {
        // Avoid multiple rapid taps creating overlapping SSO sessions/states.
        window.setTimeout(() => {
          openingNativeSSORef.current = false;
        }, 2000);
      }
    };

  const getProviderIconUrl = (provider: IIdentityProvider): string | undefined => {
    if (isAppleIdentityProvider(provider)) return AppleLogo;
    if (isGoogleIdentityProvider(provider)) return GoogleLogo;
    if (isGitHubIdentityProvider(provider)) return GitHubLogo;
    const homeserverIcon = provider.icon && mxcUrlToHttp(mx, provider.icon, false, 96, 96, 'crop', false);
    if (homeserverIcon) return homeserverIcon;

    return undefined;
  };

  const getSSOIdUrl = (ssoId?: string): string =>
    mx.getSsoLoginUrl(redirectUrl, 'sso', ssoId, action);

  const withoutIcon = providers
    ? orderedProviders.find((provider) => !getProviderIconUrl(provider))
    : true;

  const renderAsIcons = withoutIcon
    ? false
    : !appleProviderAvailable && saveScreenSpace && providers && providers.length > 2;

  return (
    <Box justifyContent="Center" gap="600" wrap="Wrap">
      {providers ? (
        orderedProviders.map((provider) => {
          const { id, name } = provider;
          const ssoUrl = getSSOIdUrl(id);
          const iconUrl = getProviderIconUrl(provider);
          const appleProvider = isAppleIdentityProvider(provider);
          const buttonTitle = getSSOProviderButtonTitle(provider, action);
          const navigationProps = nativeIOS ? {} : { as: 'a' as const, href: ssoUrl };

          if (renderAsIcons) {
            return (
              <Avatar
                style={{ cursor: 'pointer' }}
                key={id}
                {...navigationProps}
                onClick={handleSSONavigate(ssoUrl)}
                aria-label={buttonTitle}
                size="300"
                radii="300"
              >
                <AvatarImage src={iconUrl!} alt={name} title={buttonTitle} />
              </Avatar>
            );
          }

          return (
            <Button
              style={
                appleProvider
                  ? { width: '100%', backgroundColor: '#000', borderColor: '#000' }
                  : { width: '100%' }
              }
              key={id}
              {...navigationProps}
              onClick={handleSSONavigate(ssoUrl)}
              size="500"
              variant={appleProvider ? 'Primary' : 'Secondary'}
              fill={appleProvider ? 'Solid' : 'Soft'}
              outlined={!appleProvider}
              before={
                iconUrl && (
                  <img src={iconUrl} alt="" width={18} height={18} style={{ display: 'block' }} />
                )
              }
            >
              <Text
                align="Center"
                size="B500"
                truncate
                style={appleProvider ? { color: '#fff' } : undefined}
              >
                {buttonTitle}
              </Text>
            </Button>
          );
        })
      ) : (
        <Button
          style={{ width: '100%' }}
          {...(nativeIOS ? {} : { as: 'a' as const, href: getSSOIdUrl() })}
          onClick={handleSSONavigate(getSSOIdUrl())}
          size="500"
          variant="Secondary"
          fill="Soft"
          outlined
        >
          <Text align="Center" size="B500" truncate>
            Continue with SSO
          </Text>
        </Button>
      )}
    </Box>
  );
}
