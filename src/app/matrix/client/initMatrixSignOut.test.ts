import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StoredSession } from '../session/sessions';
import { logoutStoredSession } from '../../account/lifecycle/initMatrix';

const lifecycle = vi.hoisted(() => ({
  removeStoredSession: vi.fn(async () => undefined),
  removeSessionAndReload: vi.fn(),
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
      expect.objectContaining({ baseUrl: 'https://hs.test', accessToken: 'b', deviceId: 'BOB' })
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
