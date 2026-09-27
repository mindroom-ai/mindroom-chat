// @vitest-environment jsdom

import React from 'react';
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConnectPage } from './ConnectPage';
import {
  approveLocalMindroomPairCode,
  inspectLocalMindroomPairCode,
  LocalMindroomApiError,
  type LocalMindroomPairDevice,
} from './api';
import { useClientConfig } from '../../hooks/useClientConfig';
import { createMatrixClient } from '../matrix/matrixClientFactory';
import { getAfterLoginRedirectPath } from '../../pages/afterLoginRedirectPath';
import { getActiveSession, getSessionStore, putSession, removeSession } from '../../state/sessions';

vi.mock('folds', async () => {
  const reactModule = await import('react');
  type Props = { children?: React.ReactNode; [key: string]: unknown };
  const element =
    (tag: string) =>
    ({ children, before, after, as, ...props }: Props) =>
      reactModule.createElement(
        (as as string | undefined) ?? tag,
        props,
        before as React.ReactNode,
        children,
        after as React.ReactNode
      );

  return {
    Box: element('div'),
    Button: element('button'),
    Header: element('header'),
    Input: (props: Props) => reactModule.createElement('input', props),
    Scroll: element('div'),
    Spinner: () => null,
    Text: element('span'),
    color: {
      Critical: { Main: 'critical' },
      Success: { Main: 'success' },
      Warning: { Main: 'warning' },
    },
  };
});

vi.mock('../../pages/auth/styles.css', () => ({
  AuthCard: 'auth-card',
  AuthCardContent: 'auth-card-content',
  AuthHeader: 'auth-header',
  AuthLayout: 'auth-layout',
  AuthLayoutPersistentParticle: 'auth-layout-persistent-particle',
  AuthLogo: 'auth-logo',
}));

vi.mock('../../components/particle-background', () => ({
  ParticleBackgroundSurface: () => null,
  usePersistentParticleBackground: () => false,
}));

vi.mock('../../hooks/useClientConfig', () => ({
  useClientConfig: vi.fn(),
}));

vi.mock('../matrix/matrixClientFactory', () => ({
  createMatrixClient: vi.fn(),
}));

vi.mock('./api', async () => ({
  ...(await vi.importActual<typeof import('./api')>('./api')),
  approveLocalMindroomPairCode: vi.fn(),
  inspectLocalMindroomPairCode: vi.fn(),
}));

const inspectMock = vi.mocked(inspectLocalMindroomPairCode);
const approveMock = vi.mocked(approveLocalMindroomPairCode);

const pendingDevice = (): LocalMindroomPairDevice => ({
  client_name: 'studio-mac',
  created_at: new Date(Date.now() - 2 * 60_000).toISOString(),
  expires_at: new Date(Date.now() + 8 * 60_000).toISOString(),
  status: 'pending',
});

const storeSession = (userId: string, baseUrl: string, refreshToken?: string) =>
  putSession({
    baseUrl,
    userId,
    deviceId: 'DEVICE',
    accessToken: `${userId}-access`,
    refreshToken,
  });

function LocationProbe() {
  const location = useLocation();
  return <output>{`${location.pathname}${location.search}`}</output>;
}

let renderer: ReactTestRenderer | undefined;

const renderAt = async (entry: string) => {
  await act(async () => {
    renderer = create(
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/connect" element={<ConnectPage />} />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>
    );
  });
  await act(async () => {
    await Promise.resolve();
  });
};

const flush = () =>
  act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });

const textOf = (node: ReactTestInstance | undefined = renderer?.root): string =>
  (node?.children ?? [])
    .map((child) => (typeof child === 'string' ? child : textOf(child)))
    .join(' ');

const findButton = (label: string): ReactTestInstance => {
  const button = renderer?.root
    .findAllByType('button')
    .find((candidate) => textOf(candidate).includes(label));
  if (!button) throw new Error(`Missing button: ${label}\n${textOf()}`);
  return button;
};

const click = async (label: string) => {
  await act(async () => {
    findButton(label).props.onClick();
  });
  await flush();
};

beforeEach(() => {
  vi.mocked(useClientConfig).mockReturnValue({
    sidebar: { mindRoomProvisioningUrl: 'https://mindroom.chat' },
  });
  inspectMock.mockImplementation(async () => pendingDevice());
  approveMock.mockImplementation(async () => ({ ...pendingDevice(), status: 'approved' }));
});

afterEach(() => {
  renderer?.unmount();
  renderer = undefined;
  localStorage.clear();
  vi.clearAllMocks();
});

describe('ConnectPage', () => {
  it('inspects the code and approves it with the only eligible account', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');

    await renderAt('/connect?code=abcd-efgh');

    expect(inspectMock).toHaveBeenCalledWith(
      'ABCD-EFGH',
      '@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );
    expect(textOf()).toContain('studio-mac');
    expect(textOf()).toContain('Started 2 minutes ago');
    expect(textOf()).toContain('Only approve if you just started this on your own machine.');

    await click('Approve as @alice:mindroom.chat');

    expect(approveMock).toHaveBeenCalledWith(
      'ABCD-EFGH',
      '@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );
    expect(textOf()).toContain('Connected. You can return to your terminal.');
    expect(() => findButton('Approve as')).toThrow();
  });

  it('approves with a chosen non-active account without switching the active account', async () => {
    const first = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    storeSession('@bob:mindroom.chat', 'https://mindroom.chat');
    const active = storeSession('@carol:matrix.org', 'https://matrix-client.matrix.org');

    await renderAt('/connect?code=ABCD-EFGH');

    expect(textOf()).not.toContain('@carol:matrix.org');
    await click('@alice:mindroom.chat');

    expect(inspectMock).toHaveBeenLastCalledWith(
      'ABCD-EFGH',
      '@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );

    await click('Approve as @alice:mindroom.chat');

    expect(approveMock).toHaveBeenCalledWith(
      'ABCD-EFGH',
      '@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );
    expect(getActiveSession()?.sessionId).toBe(active.sessionId);
    expect(getActiveSession()?.sessionId).not.toBe(first.sessionId);
  });

  it('locks the account choice while approving and drops a result for an account no longer chosen', async () => {
    const alice = storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    storeSession('@bob:mindroom.chat', 'https://mindroom.chat');
    let finishApprove: (device: LocalMindroomPairDevice) => void = () => undefined;
    approveMock.mockImplementation(
      () =>
        new Promise<LocalMindroomPairDevice>((resolve) => {
          finishApprove = resolve;
        })
    );

    await renderAt('/connect?code=ABCD-EFGH');
    await click('@alice:mindroom.chat');
    await click('Approve as @alice:mindroom.chat');

    expect(findButton('@bob:mindroom.chat').props.disabled).toBe(true);

    await act(async () => {
      removeSession(alice.sessionId);
    });
    await flush();
    await act(async () => {
      finishApprove({ ...pendingDevice(), status: 'approved' });
    });
    await flush();

    expect(textOf()).not.toContain('Connected. You can return to your terminal.');
    expect(findButton('Approve as @bob:mindroom.chat').props.disabled).toBe(false);
  });

  it('refreshes an expired stored token, saves it, and retries once', async () => {
    const session = storeSession('@alice:mindroom.chat', 'https://mindroom.chat', 'refresh-a');
    const refreshToken = vi
      .fn()
      .mockResolvedValue({ access_token: 'access-b', refresh_token: 'refresh-b' });
    vi.mocked(createMatrixClient).mockReturnValue({ refreshToken } as never);
    inspectMock.mockRejectedValueOnce(
      new LocalMindroomApiError('Invalid Matrix access token', 401)
    );

    await renderAt('/connect?code=ABCD-EFGH');
    await flush();

    expect(refreshToken).toHaveBeenCalledWith('refresh-a');
    expect(inspectMock.mock.calls.map((call) => call[1])).toEqual([
      '@alice:mindroom.chat-access',
      'access-b',
    ]);
    expect(getSessionStore().sessions).toEqual([
      expect.objectContaining({
        sessionId: session.sessionId,
        accessToken: 'access-b',
        refreshToken: 'refresh-b',
      }),
    ]);
    expect(textOf()).toContain('studio-mac');
  });

  it('offers add-account with a return to this code when no account can approve', async () => {
    storeSession('@carol:matrix.org', 'https://matrix-client.matrix.org');

    await renderAt('/connect?code=ABCD-EFGH');

    expect(inspectMock).not.toHaveBeenCalled();
    await click('Sign in to approve');

    expect(getAfterLoginRedirectPath()).toBe('/connect?code=ABCD-EFGH');
    expect(textOf(renderer?.root.findByType('output'))).toBe('/login?addAccount=1');
  });

  it('offers plain login when no account is active', async () => {
    await renderAt('/connect?code=ABCD-EFGH');

    await click('Sign in to approve');

    expect(getAfterLoginRedirectPath()).toBe('/connect?code=ABCD-EFGH');
    expect(textOf(renderer?.root.findByType('output'))).toBe('/login');
  });

  it('asks for a code when the link has none and continues with the entered code', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');

    await renderAt('/connect');
    expect(inspectMock).not.toHaveBeenCalled();

    const input = renderer!.root.findByType('input');
    await act(async () => {
      input.props.onChange({ currentTarget: { value: 'abcd efgh' } });
    });
    await act(async () => {
      renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });
    await flush();

    expect(inspectMock).toHaveBeenCalledWith(
      'ABCD-EFGH',
      '@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );
  });

  it('explains an expired code', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    inspectMock.mockRejectedValue(new LocalMindroomApiError('Pair code expired', 410));

    await renderAt('/connect?code=ABCD-EFGH');

    expect(textOf()).toContain('This code has expired.');
    expect(findButton('Approve as @alice:mindroom.chat').props.disabled).toBe(true);
  });

  it('renders PairCodeForm beneath expired error so user can enter new code', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    inspectMock.mockRejectedValue(new LocalMindroomApiError('Pair code expired', 410));

    await renderAt('/connect?code=ABCD-EFGH');

    const input = renderer!.root.findByType('input');
    await act(async () => {
      input.props.onChange({ currentTarget: { value: 'wxyz-1234' } });
    });
    await act(async () => {
      renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });
    await flush();

    expect(inspectMock).toHaveBeenLastCalledWith(
      'WXYZ-1234',
      '@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );
  });

  it('renders PairCodeForm beneath not-found error so user can enter new code', async () => {
    storeSession('@alice:mindroom.chat', 'https://mindroom.chat');
    inspectMock.mockRejectedValue(new LocalMindroomApiError('Code not found', 404));

    await renderAt('/connect?code=ABCD-EFGH');

    const input = renderer!.root.findByType('input');
    await act(async () => {
      input.props.onChange({ currentTarget: { value: 'new1-2345' } });
    });
    await act(async () => {
      renderer!.root.findByType('form').props.onSubmit({ preventDefault: vi.fn() });
    });
    await flush();

    expect(inspectMock).toHaveBeenLastCalledWith(
      'NEW1-2345',
      '@alice:mindroom.chat-access',
      'https://mindroom.chat'
    );
  });

  it('shows iOS app guidance with code in no-eligible-account state', async () => {
    storeSession('@carol:matrix.org', 'https://matrix-client.matrix.org');

    await renderAt('/connect?code=ABCD-EFGH');

    expect(textOf()).toContain('Already signed in on the MindRoom app?');
    expect(textOf()).toContain('Settings → Local MindRoom');
    expect(textOf()).toContain('ABCD-EFGH');
    expect(() => findButton('Sign in to approve')).not.toThrow();
  });
});
