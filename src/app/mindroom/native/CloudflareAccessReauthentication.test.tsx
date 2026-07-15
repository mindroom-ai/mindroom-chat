import React from 'react';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CloudflareAccessReauthentication } from './CloudflareAccessReauthentication';

const mocks = vi.hoisted(() => {
  const activeSession = {
    accessToken: 'matrix-token',
    baseUrl: 'https://matrix.example.test',
    deviceId: 'DEVICE',
    lastUsedAt: 1,
    sessionId: 'session-a',
    userId: '@user:example.test',
  };
  const requirement = {
    message: 'Organization sign-in required',
    scope: 'https://matrix.example.test/_matrix',
    url: 'https://matrix.example.test/_matrix/client/versions',
  };

  return {
    activeSession,
    removeSessionAndReload: vi.fn().mockResolvedValue(undefined),
    requirement,
    retryAuthentication: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock('folds', () => {
  const PassThrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  const Button = ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement('button', props, children);

  return {
    Box: PassThrough,
    Button,
    Dialog: PassThrough,
    Overlay: PassThrough,
    OverlayBackdrop: PassThrough,
    OverlayCenter: PassThrough,
    Text: PassThrough,
  };
});

vi.mock('focus-trap-react', () => ({
  default: ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children),
}));

vi.mock('../../../client/initMatrix', () => ({
  removeSessionAndReload: mocks.removeSessionAndReload,
}));

vi.mock('../../hooks/useSessionStore', () => ({
  useActiveSession: () => mocks.activeSession,
}));

vi.mock('./cloudflareAccess', () => ({
  getCloudflareAccessRequirement: () => mocks.requirement,
  retryCloudflareAccessAuthentication: mocks.retryAuthentication,
  subscribeToCloudflareAccessRequirement: () => () => undefined,
}));

describe('CloudflareAccessReauthentication', () => {
  let renderer: ReactTestRenderer | undefined;

  afterEach(async () => {
    if (renderer) {
      await act(async () => renderer?.unmount());
    }
    renderer = undefined;
    mocks.removeSessionAndReload.mockClear();
    mocks.retryAuthentication.mockClear();
  });

  it('lets a blocked user remove the active session without dismissing reauthentication', async () => {
    await act(async () => {
      renderer = create(<CloudflareAccessReauthentication />);
    });

    const buttons = renderer!.root.findAllByType('button');
    expect(buttons.map((button) => button.children.join(''))).toEqual(['Logout', 'Continue']);
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('Not now');

    await act(async () => {
      await buttons[0].props.onClick();
    });

    expect(mocks.removeSessionAndReload).toHaveBeenCalledWith(mocks.activeSession);
    expect(mocks.retryAuthentication).not.toHaveBeenCalled();
  });
});
