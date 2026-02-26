import { IIdentityProvider, SSOAction } from 'matrix-js-sdk';

const APPLE_PROVIDER_KEY = 'apple';

const normalizeProviderValue = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : undefined;
};

export const isAppleIdentityProvider = (provider: IIdentityProvider): boolean => {
  const brand = normalizeProviderValue(provider.brand);
  if (brand === APPLE_PROVIDER_KEY) return true;

  const providerId = normalizeProviderValue(provider.id);
  if (providerId?.includes(APPLE_PROVIDER_KEY)) return true;

  const providerName = normalizeProviderValue(provider.name);
  if (providerName?.includes(APPLE_PROVIDER_KEY)) return true;

  return false;
};

export const hasAppleIdentityProvider = (providers?: IIdentityProvider[]): boolean =>
  Boolean(providers?.some(isAppleIdentityProvider));

export const sortIdentityProviders = (providers?: IIdentityProvider[]): IIdentityProvider[] => {
  if (!providers) return [];

  const appleProviders: IIdentityProvider[] = [];
  const otherProviders: IIdentityProvider[] = [];

  providers.forEach((provider) => {
    if (isAppleIdentityProvider(provider)) {
      appleProviders.push(provider);
      return;
    }
    otherProviders.push(provider);
  });

  return [...appleProviders, ...otherProviders];
};

export const getSSOProviderButtonTitle = (
  provider: IIdentityProvider,
  action?: SSOAction
): string => {
  if (isAppleIdentityProvider(provider)) {
    return action === SSOAction.REGISTER ? 'Sign up with Apple' : 'Sign in with Apple';
  }

  return `Continue with ${provider.name}`;
};
