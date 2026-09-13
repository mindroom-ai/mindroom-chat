import { describe, expect, it } from 'vitest';
import { IIdentityProvider, SSOAction } from 'matrix-js-sdk';
import {
  getSSOProviderButtonTitle,
  hasAppleIdentityProvider,
  isAppleIdentityProvider,
  sortIdentityProviders,
} from './ssoProviders';

const provider = (id: string, name: string, brand?: string): IIdentityProvider => ({
  id,
  name,
  brand,
});

describe('isAppleIdentityProvider', () => {
  it('detects Apple provider by brand', () => {
    expect(isAppleIdentityProvider(provider('oidc-1', 'Corporate SSO', 'apple'))).toBe(true);
  });

  it('detects Apple provider by id and name fallback', () => {
    expect(isAppleIdentityProvider(provider('apple-oidc', 'Corporate SSO'))).toBe(true);
    expect(isAppleIdentityProvider(provider('oidc-1', 'Sign in with Apple'))).toBe(true);
  });

  it('returns false for non-Apple provider', () => {
    expect(isAppleIdentityProvider(provider('google-oidc', 'Google', 'google'))).toBe(false);
  });
});

describe('hasAppleIdentityProvider', () => {
  it('returns true when any provider is Apple', () => {
    expect(
      hasAppleIdentityProvider([provider('google', 'Google', 'google'), provider('apple', 'Apple')])
    ).toBe(true);
  });

  it('returns false for empty provider list', () => {
    expect(hasAppleIdentityProvider([])).toBe(false);
    expect(hasAppleIdentityProvider(undefined)).toBe(false);
  });
});

describe('sortIdentityProviders', () => {
  it('returns Apple providers first while preserving relative order', () => {
    const sorted = sortIdentityProviders([
      provider('google', 'Google', 'google'),
      provider('apple-1', 'Apple Work'),
      provider('github', 'GitHub', 'github'),
      provider('apple-2', 'Apple Personal'),
    ]);

    expect(sorted.map((item) => item.id)).toEqual(['apple-1', 'apple-2', 'google', 'github']);
  });
});

describe('getSSOProviderButtonTitle', () => {
  it('uses Apple-specific labels', () => {
    const appleProvider = provider('apple', 'Apple', 'apple');

    expect(getSSOProviderButtonTitle(appleProvider, SSOAction.LOGIN)).toBe('Sign in with Apple');
    expect(getSSOProviderButtonTitle(appleProvider, SSOAction.REGISTER)).toBe('Sign up with Apple');
  });

  it('uses generic labels for non-Apple providers', () => {
    const googleProvider = provider('google', 'Google', 'google');

    expect(getSSOProviderButtonTitle(googleProvider, SSOAction.LOGIN)).toBe('Continue with Google');
  });
});
