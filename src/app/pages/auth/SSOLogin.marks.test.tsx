import React from 'react';
import { create, type ReactTestInstance } from 'react-test-renderer';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SSOAction, type IIdentityProvider } from 'matrix-js-sdk';
import { Capacitor } from '@capacitor/core';
import { createMatrixClient } from '../../mindroom/matrix/matrixClientFactory';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { SSOLogin } from './SSOLogin';
import * as css from './SSOLogin.css';

// Which mark each sign-in button shows in front of its label: the client's own for Apple, Google
// and GitHub, whatever icon the homeserver lists for them; the homeserver's icon for any other.

vi.mock('folds', async () => {
  const reactModule = await import('react');
  type Props = { children?: React.ReactNode; [key: string]: unknown };
  const passThrough =
    (tag: string) =>
    ({ children, ...props }: Props) =>
      reactModule.createElement(tag, props, children);
  return {
    Avatar: passThrough('div'),
    AvatarImage: (props: Props) => reactModule.createElement('img', props),
    Box: passThrough('div'),
    // The `before` slot is rendered ahead of the label, as folds does.
    Button: ({ children, before, as: _as, ...props }: Props) =>
      reactModule.createElement('button', props, before as React.ReactNode, children),
    Text: passThrough('span'),
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: { isPluginAvailable: vi.fn(), isNativePlatform: vi.fn(), getPlatform: vi.fn() },
  registerPlugin: vi.fn(() => ({ authenticate: vi.fn(), signInWithApple: vi.fn() })),
}));
vi.mock('@capacitor/browser', () => ({ Browser: { close: vi.fn(), open: vi.fn() } }));
vi.mock('../../mindroom/matrix/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
  createMatrixFetchFn: vi.fn(),
}));
vi.mock('../../mindroom/native/cloudflareAccess', () => ({ hasCloudflareAccess: () => false }));
vi.mock('../../hooks/useAutoDiscoveryInfo', () => ({ useAutoDiscoveryInfo: vi.fn() }));

const HOMESERVER = 'https://hs.example';
const mediaUrlOf = (mxc: string) =>
  `${HOMESERVER}/_matrix/media/v3/download/${mxc.slice('mxc://'.length)}`;

const render = (providers: IIdentityProvider[]) =>
  create(
    React.createElement(SSOLogin, {
      providers,
      redirectUrl: 'https://chat.example/login/hs.example/',
      action: SSOAction.LOGIN,
    })
  );

const buttonFor = (renderer: ReturnType<typeof create>, label: string): ReactTestInstance => {
  const button = renderer.root
    .findAllByType('button')
    .find((node) => node.findAllByType('span').some((span) => span.children.join('') === label));
  if (!button) throw new Error(`No button labelled ${label}`);
  return button;
};

const markOf = (button: ReactTestInstance) => {
  const images = button.findAllByType('img');
  return images.length === 1 ? (images[0]?.props as Record<string, unknown>) : undefined;
};

describe('SSOLogin provider marks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAutoDiscoveryInfo).mockReturnValue({ 'm.homeserver': { base_url: HOMESERVER } });
    vi.mocked(createMatrixClient).mockReturnValue({
      getSsoLoginUrl: vi.fn(() => `${HOMESERVER}/_matrix/client/v3/login/sso/redirect`),
      getHomeserverUrl: () => HOMESERVER,
      mxcUrlToHttp: vi.fn(mediaUrlOf),
    } as never);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.isPluginAvailable).mockReturnValue(false);
  });

  it.each([
    ['Sign in with Apple', { id: 'oidc-apple', name: 'Apple', brand: 'apple' }, 'sso-apple-white.svg'],
    ['Continue with Google', { id: 'google', name: 'Google' }, 'sso-google.svg'],
    ['Continue with GitHub', { id: 'oidc', name: 'GitHub', brand: 'github' }, 'sso-github.svg'],
  ])('%s shows the bundled mark, not the icon the server lists', (label, provider, file) => {
    const renderer = render([{ ...provider, icon: 'mxc://hs.example/server-icon' }]);

    const mark = markOf(buttonFor(renderer, label));
    expect(String(mark?.src)).toMatch(new RegExp(`/${file.replace('.', '\\.')}$`));
    expect(mark?.src).not.toBe(mediaUrlOf('mxc://hs.example/server-icon'));
    // Decorative: the label alone names the button.
    expect(mark?.alt).toBe('');
  });

  it('shows an unknown provider with the icon its homeserver lists', () => {
    const renderer = render([
      { id: 'oidc-keycloak', name: 'Keycloak', icon: 'mxc://hs.example/keycloak' },
    ]);

    const mark = markOf(buttonFor(renderer, 'Continue with Keycloak'));
    expect(mark?.src).toBe(mediaUrlOf('mxc://hs.example/keycloak'));
    expect(mark?.alt).toBe('');
  });

  it('shows no mark for an unknown provider without an icon', () => {
    const renderer = render([{ id: 'oidc-keycloak', name: 'Keycloak' }]);

    expect(markOf(buttonFor(renderer, 'Continue with Keycloak'))).toBeUndefined();
  });

  it('gives only the Apple button its black style, and only the GitHub mark its dark-theme colour', () => {
    const renderer = render([
      { id: 'apple', name: 'Apple', brand: 'apple' },
      { id: 'google', name: 'Google', brand: 'google' },
      { id: 'github', name: 'GitHub', brand: 'github' },
    ]);

    const apple = buttonFor(renderer, 'Sign in with Apple');
    const google = buttonFor(renderer, 'Continue with Google');
    const github = buttonFor(renderer, 'Continue with GitHub');
    expect(apple.props.className).toBe(css.AppleButton);
    expect(google.props.className).toBeUndefined();
    expect(github.props.className).toBeUndefined();
    expect(String(markOf(github)?.className)).toContain(css.GitHubMark);
    expect(String(markOf(google)?.className)).not.toContain(css.GitHubMark);
    expect(String(markOf(apple)?.className)).not.toContain(css.GitHubMark);
  });
});
