import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SSOAction } from 'matrix-js-sdk';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { createMatrixClient, createMatrixFetchFn } from '../../matrix/client/matrixClientFactory';
import { useAutoDiscoveryInfo } from '../../matrix/hooks/useAutoDiscoveryInfo';
import { SSOLogin } from './SSOLogin';
import { claimSsoLogin, SSO_NONCE_PARAM } from './ssoReturn';
import { SsoStartCheckProvider, type SsoStartCheck } from './unlistedServer';

// With a start check (a server the deployment does not list), a sign-in button leaves for the
// homeserver, and notes the sign-in, only once the check lets it go.

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

const HOMESERVER = 'https://evil-hs.example';
const SSO_URL = `${HOMESERVER}/_matrix/client/v3/login/sso/redirect`;
const getSsoLoginUrl = vi.fn(() => SSO_URL);

/** sessionStorage and localStorage for the node environment, where window is replaced. */
const memoryStorage = (): Storage => {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => {
      items.delete(key);
    },
    setItem: (key, value) => {
      items.set(key, value);
    },
  };
};

const assign = vi.fn();
const originalWindow = globalThis.window;

const buttonByText = (renderer: ReturnType<typeof create>, text: string) =>
  renderer.root
    .findAllByType('button')
    .find((node) => node.findAllByType('span').some((span) => span.children.join('') === text));

const nonceOfReturn = (): string | null => {
  const [returnUrl] = getSsoLoginUrl.mock.calls.at(-1) as unknown as [string];
  return new URL(returnUrl.replace(/^mindroom:/, 'https:')).searchParams.get(SSO_NONCE_PARAM);
};

/** Renders the buttons under a check that holds each start until the test lets it go. */
const renderChecked = (props: Partial<React.ComponentProps<typeof SSOLogin>> = {}) => {
  const held: Array<() => void> = [];
  const check: SsoStartCheck = (start) => held.push(start);
  const renderer = create(
    React.createElement(
      SsoStartCheckProvider,
      { value: check },
      React.createElement(SSOLogin, {
        redirectUrl: 'https://chat.example/login/evil-hs.example/',
        action: SSOAction.LOGIN,
        ...props,
      })
    )
  );
  return { renderer, held };
};

const press = async (renderer: ReturnType<typeof create>, text: string) => {
  const preventDefault = vi.fn();
  await act(async () => {
    await buttonByText(renderer, text)?.props.onClick({ preventDefault });
  });
  return preventDefault;
};

describe('SSOLogin with a start check', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: { assign },
        history: { replaceState: vi.fn() },
        dispatchEvent: vi.fn(),
        setTimeout: vi.fn(),
        sessionStorage: memoryStorage(),
        localStorage: memoryStorage(),
      },
    });
    vi.mocked(useAutoDiscoveryInfo).mockReturnValue({ 'm.homeserver': { base_url: HOMESERVER } });
    vi.mocked(createMatrixClient).mockReturnValue({ getSsoLoginUrl } as never);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: originalWindow });
  });

  it('keeps the web link from leaving and notes nothing until the check lets it go', async () => {
    const { renderer, held } = renderChecked();
    const nonce = nonceOfReturn();

    const preventDefault = await press(renderer, 'Continue with SSO');
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(held).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
    // A return carrying this page's nonce is still refused: the sign-in was never noted.
    expect(claimSsoLogin('token', nonce)).toBeUndefined();

    act(() => held[0]?.());
    expect(assign).toHaveBeenCalledWith(SSO_URL);
    expect(claimSsoLogin('token', nonce)).toBe(HOMESERVER);
  });

  it('leaves nothing behind when the person says no', async () => {
    const { renderer, held } = renderChecked();
    const nonce = nonceOfReturn();
    await press(renderer, 'Continue with SSO');
    expect(held).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
    expect(claimSsoLogin('token', nonce)).toBeUndefined();
  });

  it('opens the native in-app browser only after the check', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('android');
    vi.mocked(Browser.open).mockResolvedValue();
    const { renderer, held } = renderChecked({
      redirectUrl: 'mindroom://auth/login/evil-hs.example',
    });
    const nonce = nonceOfReturn();

    const preventDefault = await press(renderer, 'Continue with SSO');
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(Browser.open).not.toHaveBeenCalled();
    expect(claimSsoLogin('token', nonce)).toBeUndefined();

    await act(async () => {
      held[0]?.();
      await Promise.resolve();
    });
    expect(Browser.open).toHaveBeenCalledWith({ url: SSO_URL, presentationStyle: 'fullscreen' });
    expect(assign).not.toHaveBeenCalled();
    expect(claimSsoLogin('token', nonce)).toBe(HOMESERVER);
  });

  it('starts native Sign in with Apple, which posts to the server, only after the check', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(true);
    signInWithApple.mockResolvedValue({ identityToken: 'apple-id-token', nonce: 'apple' });
    const exchange = vi.fn(async () => new Response(JSON.stringify({ loginToken: 'issued' })));
    vi.mocked(createMatrixFetchFn).mockReturnValue(exchange);
    const { renderer, held } = renderChecked({
      providers: [{ id: 'apple', name: 'Apple', brand: 'apple' }],
      redirectUrl: 'mindroom://auth/login/evil-hs.example',
    });

    await press(renderer, 'Sign in with Apple');
    expect(signInWithApple).not.toHaveBeenCalled();
    expect(exchange).not.toHaveBeenCalled();

    await act(async () => {
      held[0]?.();
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });
    expect(signInWithApple).toHaveBeenCalledTimes(1);
    expect(exchange).toHaveBeenCalledWith(
      `${HOMESERVER}/_matrix/client/unstable/org.mindroom.login/apple`,
      expect.objectContaining({ method: 'POST' })
    );
  });
});
