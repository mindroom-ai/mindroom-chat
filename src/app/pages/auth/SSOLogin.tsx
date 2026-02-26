import { Avatar, AvatarImage, Box, Button, Text } from 'folds';
import { IIdentityProvider, SSOAction } from 'matrix-js-sdk';
import React, { useMemo } from 'react';
import { createMatrixClient } from '../../../client/matrixClientFactory';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import {
  getSSOProviderButtonTitle,
  hasAppleIdentityProvider,
  isAppleIdentityProvider,
  sortIdentityProviders,
} from './ssoProviders';

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

  const getSSOIdUrl = (ssoId?: string): string =>
    mx.getSsoLoginUrl(redirectUrl, 'sso', ssoId, action);

  const withoutIcon = providers
    ? providers.find(
        (provider) => !provider.icon || !mx.mxcUrlToHttp(provider.icon, 96, 96, 'crop', false)
      )
    : true;

  const renderAsIcons = withoutIcon
    ? false
    : !appleProviderAvailable && saveScreenSpace && providers && providers.length > 2;

  return (
    <Box justifyContent="Center" gap="600" wrap="Wrap">
      {providers ? (
        orderedProviders.map((provider) => {
          const { id, name, icon } = provider;
          const iconUrl = icon && mx.mxcUrlToHttp(icon, 96, 96, 'crop', false);
          const appleProvider = isAppleIdentityProvider(provider);
          const buttonTitle = getSSOProviderButtonTitle(provider, action);

          if (renderAsIcons) {
            return (
              <Avatar
                style={{ cursor: 'pointer' }}
                key={id}
                as="a"
                href={getSSOIdUrl(id)}
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
              as="a"
              href={getSSOIdUrl(id)}
              size="500"
              variant={appleProvider ? 'Primary' : 'Secondary'}
              fill={appleProvider ? 'Solid' : 'Soft'}
              outlined={!appleProvider}
              before={
                !appleProvider &&
                iconUrl && (
                  <Avatar size="200" radii="300">
                    <AvatarImage src={iconUrl} alt={name} />
                  </Avatar>
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
          as="a"
          href={getSSOIdUrl()}
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
