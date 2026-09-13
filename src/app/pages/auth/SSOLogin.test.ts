import React from 'react';
import { act, create } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SSOAction } from 'matrix-js-sdk';
import { Capacitor } from '@capacitor/core';
import { Browser } from '@capacitor/browser';
import { createMatrixClient } from '../../mindroom/matrix/matrixClientFactory';
import { useAutoDiscoveryInfo } from '../../hooks/useAutoDiscoveryInfo';
import { SSOLogin } from './SSOLogin';

vi.mock('folds', async () => {
  const reactModule = await import('react');

  return {
    Avatar: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => reactModule.createElement('div', props, children),
    AvatarImage: () => reactModule.createElement('img'),
    Box: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => reactModule.createElement('div', props, children),
    Button: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => reactModule.createElement('button', props, children),
    Text: ({
      children,
      ...props
    }: {
      children: React.ReactNode;
      [key: string]: unknown;
    }) => reactModule.createElement('span', props, children),
  };
});

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn(),
    getPlatform: vi.fn(),
  },
}));

vi.mock('@capacitor/browser', () => ({
  Browser: {
    open: vi.fn(),
  },
}));

vi.mock('../../mindroom/matrix/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
}));

vi.mock('../../hooks/useAutoDiscoveryInfo', () => ({
  useAutoDiscoveryInfo: vi.fn(),
}));

const findButtonByText = (renderer: ReturnType<typeof create>, text: string) =>
  renderer.root.findAllByType('button').find((node) =>
    node.findAllByType('span').some((textNode) => textNode.children.join('') === text)
  );

describe('SSOLogin', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, 'window', {
      value: {
        setTimeout: vi.fn(),
      },
      configurable: true,
    });
    vi.mocked(useAutoDiscoveryInfo).mockReturnValue({
      'm.homeserver': {
        base_url: 'https://mindroom.chat',
      },
    });
    vi.mocked(createMatrixClient).mockReturnValue({
      getSsoLoginUrl: vi.fn(() => 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect'),
    } as never);
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
      return;
    }

    Object.defineProperty(globalThis, 'window', {
      value: originalWindow,
      configurable: true,
    });
  });

  it('opens SSO inside the in-app browser on native iOS', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Browser.open).mockResolvedValue();

    const renderer = create(
      React.createElement(SSOLogin, {
        redirectUrl: 'mindroom://auth/login/mindroom.chat',
        action: SSOAction.LOGIN,
      })
    );

    const continueButton = findButtonByText(renderer, 'Continue with SSO');
    const preventDefault = vi.fn();

    await act(async () => {
      await continueButton?.props.onClick({ preventDefault });
    });

    expect(continueButton?.props.href).toBeUndefined();
    expect(continueButton?.props.as).toBeUndefined();
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(vi.mocked(Browser.open)).toHaveBeenCalledWith({
      url: 'https://mindroom.chat/_matrix/client/v3/login/sso/redirect',
      presentationStyle: 'fullscreen',
    });
  });

  it('does not fall back to link navigation when native in-app browser open fails', async () => {
    const error = new Error('native browser unavailable');
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('ios');
    vi.mocked(Browser.open).mockRejectedValue(error);

    const renderer = create(
      React.createElement(SSOLogin, {
        redirectUrl: 'mindroom://auth/login/mindroom.chat',
        action: SSOAction.LOGIN,
      })
    );

    const continueButton = findButtonByText(renderer, 'Continue with SSO');
    const preventDefault = vi.fn();

    await act(async () => {
      await continueButton?.props.onClick({ preventDefault });
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[SSO] Failed to open native iOS in-app browser',
      error
    );
    consoleErrorSpy.mockRestore();
  });

  it('keeps default anchor navigation on non-native platforms', async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Capacitor.getPlatform).mockReturnValue('web');

    const renderer = create(
      React.createElement(SSOLogin, {
        redirectUrl: 'https://mindroom.chat/login/mindroom.chat',
        action: SSOAction.LOGIN,
      })
    );

    const continueButton = findButtonByText(renderer, 'Continue with SSO');
    const preventDefault = vi.fn();

    await act(async () => {
      await continueButton?.props.onClick({ preventDefault });
    });

    expect(continueButton?.props.href).toBe(
      'https://mindroom.chat/_matrix/client/v3/login/sso/redirect'
    );
    expect(continueButton?.props.as).toBe('a');
    expect(preventDefault).not.toHaveBeenCalled();
    expect(vi.mocked(Browser.open)).not.toHaveBeenCalled();
  });
});
