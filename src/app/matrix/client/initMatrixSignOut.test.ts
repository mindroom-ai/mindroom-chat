import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import type { StoredSession } from '../session/sessions';
import { cancelConnectingSession, logoutStoredSession } from '../../account/lifecycle/initMatrix';

const lifecycle = vi.hoisted(() => ({
  removeStoredSession: vi.fn(async (): Promise<void> => undefined),
  removeSessionAndReload: vi.fn(async (): Promise<void> => undefined),
}));
const server = vi.hoisted(() => ({
  logout: vi.fn(async (_stopClient?: boolean): Promise<object> => ({})),
  createMatrixClient: vi.fn(),
}));

vi.mock('../../account/lifecycle/sessionLifecycle', () => lifecycle);
vi.mock('./matrixClientFactory', () => ({
  createMatrixClient: server.createMatrixClient.mockImplementation(() => ({
    logout: server.logout,
  })),
}));
vi.mock('../../native/cloudflareAccess', () => ({
  renewExpiredCloudflareAccess: vi.fn(async () => undefined),
}));

const session = { sessionId: 'bob-session', userId: '@bob:hs.test' } as StoredSession;

describe('signing out an inactive account', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs it out on the server, then removes it', async () => {
    const order: string[] = [];
    server.logout.mockImplementationOnce(async () => {
      order.push('server logout');
      return {};
    });
    lifecycle.removeStoredSession.mockImplementationOnce(async () => {
      order.push('removed here');
    });
    const stored = { ...session, baseUrl: 'https://hs.test', deviceId: 'BOB', accessToken: 'b' };

    await logoutStoredSession(stored);

    expect(server.createMatrixClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://hs.test',
        accessToken: 'b',
        deviceId: 'BOB',
        localTimeoutMs: 5_000,
      })
    );
    expect(server.logout).toHaveBeenCalledWith(true);
    expect(order).toEqual(['server logout', 'removed here']);
  });

  it('removes it also when its server logout fails', async () => {
    server.logout.mockRejectedValueOnce(new Error('offline'));

    await logoutStoredSession(session);

    expect(lifecycle.removeStoredSession).toHaveBeenCalledWith(session);
  });
});

describe('canceling a connecting session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs out with a bounded timeout, then removes and reloads at nextHref', async () => {
    const order: string[] = [];
    server.logout.mockImplementationOnce(async () => {
      order.push('server logout');
      return {};
    });
    lifecycle.removeSessionAndReload.mockImplementationOnce(async () => {
      order.push('remove and reload');
    });
    const stored = { ...session, baseUrl: 'https://hs.test', deviceId: 'BOB', accessToken: 'b' };

    await cancelConnectingSession(stored, '/login/https%3A%2F%2Fhs.test');

    expect(server.createMatrixClient).toHaveBeenCalledWith(
      expect.objectContaining({
        baseUrl: 'https://hs.test',
        accessToken: 'b',
        deviceId: 'BOB',
        localTimeoutMs: 5_000,
      })
    );
    expect(server.logout).toHaveBeenCalledWith(true);
    expect(lifecycle.removeSessionAndReload).toHaveBeenCalledWith(
      stored,
      undefined,
      '/login/https%3A%2F%2Fhs.test'
    );
    expect(order).toEqual(['server logout', 'remove and reload']);
  });

  it('stops and aborts the client before logout and forwards it to removal', async () => {
    const order: string[] = [];
    const mx = {
      stopClient: vi.fn(() => {
        order.push('stop client');
      }),
      http: {
        abort: vi.fn(() => {
          order.push('abort http');
        }),
      },
    } as unknown as MatrixClient;
    server.logout.mockImplementationOnce(async () => {
      order.push('server logout');
      return {};
    });
    lifecycle.removeSessionAndReload.mockImplementationOnce(async () => {
      order.push('remove and reload');
    });

    await cancelConnectingSession(session, '/login/https%3A%2F%2Fhs.test?addAccount=1', mx);

    expect(order).toEqual(['stop client', 'abort http', 'server logout', 'remove and reload']);
    expect(lifecycle.removeSessionAndReload).toHaveBeenCalledWith(
      session,
      mx,
      '/login/https%3A%2F%2Fhs.test?addAccount=1'
    );
  });

  it('still removes the session and reloads when server logout rejects', async () => {
    server.logout.mockRejectedValueOnce(new Error('offline'));

    await cancelConnectingSession(session, '/login/https%3A%2F%2Fhs.test');

    expect(lifecycle.removeSessionAndReload).toHaveBeenCalledWith(
      session,
      undefined,
      '/login/https%3A%2F%2Fhs.test'
    );
  });
});
