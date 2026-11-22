// @vitest-environment jsdom
import React from 'react';
import { act, create } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SSOAction } from 'matrix-js-sdk';
import { Capacitor } from '@capacitor/core';
import { createMatrixClient, createMatrixFetchFn } from '../../matrix/client/matrixClientFactory';
import { useAutoDiscoveryInfo } from '../../matrix/hooks/useAutoDiscoveryInfo';
import { SSOLogin } from './SSOLogin';
import { claimSsoLogin, SSO_NONCE_PARAM } from './ssoReturn';

// How the sign-in buttons prepare the return that `ssoReturn.ts` checks.

const signInWithApple = vi.fn();

vi.mock('folds', async () => {
  const reactModule = await import('react');
  const passThrough =
    (tag: string) =>
    ({ children, ...props }: { children?: React.ReactNode; [key: string]: unknown }) =>
      reactModule.createElement(tag, props, children);
  return {
    Avatar: passThrough('div'),
    AvatarImage: () => reactModule.createElement('img'),
    Box: passThrough('div'),
    Button: passThrough('button'),
    Text: passThrough('span'),
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isPluginAvailable: vi.fn(), isNativePlatform: vi.fn(), getPlatform: vi.fn() },
  registerPlugin: vi.fn(() => ({ authenticate: vi.fn(), signInWithApple })),
}));
vi.mock('@capacitor/browser', () => ({ Browser: { close: vi.fn(), open: vi.fn() } }));
vi.mock('../../matrix/client/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
  createMatrixFetchFn: vi.fn(),
}));
vi.mock('../../native/cloudflareAccess', () => ({ hasCloudflareAccess: () => false }));
vi.mock('../../matrix/hooks/useAutoDiscoveryInfo', () => ({ useAutoDiscoveryInfo: vi.fn() }));

const HOMESERVER = 'https://matrix.example.org';
const getSsoLoginUrl = vi.fn(
  (_ret: string) => `${HOMESERVER}/_matrix/client/v3/login/sso/redirect`
);

const buttonByText = (renderer: ReturnType<typeof create>, text: string) =>
  renderer.root
    .findAllByType('button')
    .find((node) => node.findAllByType('span').some((span) => span.children.join('') === text));

const nonceOfReturn = (): string | null => {
  const [returnUrl] = getSsoLoginUrl.mock.calls.at(-1) as unknown as [string];
  return new URL(returnUrl).searchParams.get(SSO_NONCE_PARAM);
};

describe('SSOLogin return', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
    vi.mocked(useAutoDiscoveryInfo).mockReturnValue({ 'm.homeserver': { base_url: HOMESERVER } });
    vi.mocked(createMatrixClient).mockReturnValue({ getSsoLoginUrl } as never);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
  });

  it('sends the homeserver back to an address with a nonce, noted when the button is pressed', async () => {
    const renderer = create(
      React.createElement(SSOLogin, {
        redirectUrl: 'https://chat.example/login/example.org/?addAccount=1',
        action: SSOAction.LOGIN,
      })
    );
    const nonce = nonceOfReturn();
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    const [returnUrl] = getSsoLoginUrl.mock.calls.at(-1) as unknown as [string];
    expect(new URL(returnUrl).searchParams.get('addAccount')).toBe('1');
    // Rendering alone notes nothing: a return before the press is refused.
    expect(claimSsoLogin('token', nonce)).toBeUndefined();

    await act(async () => {
      buttonByText(renderer, 'Continue with SSO')?.props.onClick({ preventDefault: vi.fn() });
    });
    expect(claimSsoLogin('token', nonce)).toBe(HOMESERVER);
  });

  it('notes the token the native Apple exchange returns, so the login page takes it', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    signInWithApple.mockResolvedValue({ identityToken: 'apple-id-token', nonce: 'apple' });
    vi.mocked(createMatrixFetchFn).mockReturnValue(
      vi.fn(async () => new Response(JSON.stringify({ loginToken: 'issued-token' })))
    );
    const replaceState = vi.spyOn(window.history, 'replaceState');

    const renderer = create(
      React.createElement(SSOLogin, {
        action: SSOAction.LOGIN,
        providers: [{ id: 'apple', name: 'Apple', brand: 'apple' }],
        redirectUrl: 'mindroom://auth/login/example.org',
      })
    );
    await act(async () => {
      await buttonByText(renderer, 'Sign in with Apple')?.props.onClick({
        preventDefault: vi.fn(),
      });
    });

    expect(replaceState).toHaveBeenCalledWith(
      null,
      '',
      '/login/example.org?loginToken=issued-token'
    );
    expect(claimSsoLogin('someone-elses-token', null)).toBeUndefined();
    expect(claimSsoLogin('issued-token', null)).toBe(HOMESERVER);
  });

  it('treats nativeAppleAvailable as false in the desktop app and opens Apple via desktop SSO', async () => {
    const startSignIn = vi.fn(async () => ({
      ok: true as const,
      value: 'http://127.0.0.1:45678/auth/rand/login/example.org?ssoNonce=x',
    }));
    const openSignIn = vi.fn(async () => ({ ok: true as const, value: undefined }));
    Object.defineProperty(window, 'mindroomDesktop', {
      configurable: true,
      value: {
        onShellEvent: vi.fn(() => vi.fn()),
        setMediaSession: vi.fn(() => ({ ok: true as const, value: undefined })),
        startSignIn,
        openSignIn,
        appUrl: {
          addListener: vi.fn(async () => ({ remove: vi.fn() })),
          getLaunchUrl: vi.fn(async () => undefined),
        },
      },
    });
    getSsoLoginUrl.mockImplementation(
      (ret: string) =>
        `${HOMESERVER}/_matrix/client/v3/login/sso/redirect/apple?redirectUrl=${encodeURIComponent(
          ret
        )}`
    );
    try {
      const renderer = create(
        React.createElement(SSOLogin, {
          action: SSOAction.LOGIN,
          providers: [{ id: 'apple', name: 'Apple', brand: 'apple' }],
          redirectUrl: 'mindroom://auth/login/example.org',
        })
      );
      const nonce = nonceOfReturn();
      await act(async () => {
        buttonByText(renderer, 'Sign in with Apple')?.props.onClick({
          preventDefault: vi.fn(),
        });
        await Promise.resolve();
      });
      expect(signInWithApple).not.toHaveBeenCalled();
      expect(startSignIn).toHaveBeenCalledWith({
        homeserver: HOMESERVER,
        callback: `/login/example.org?ssoNonce=${nonce}`,
      });
      expect(openSignIn).toHaveBeenCalledTimes(1);
    } finally {
      Reflect.deleteProperty(window, 'mindroomDesktop');
    }
  });
});
