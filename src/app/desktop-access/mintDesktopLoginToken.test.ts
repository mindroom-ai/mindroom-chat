import { ClientPrefix, Method, type AuthDict, type MatrixClient } from 'matrix-js-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticationCancelled } from '../account/uia/useAuthenticatedAction';
import { mintDesktopLoginToken } from './mintDesktopLoginToken';

const cfState = vi.hoisted(() => ({ enabled: false }));
vi.mock('../native/cloudflareAccess', () => ({
  hasCloudflareAccess: () => cfState.enabled,
}));

const NOW = 1_800_000_000_000;

const createClient = (options?: {
  homeserverUrl?: string;
  flows?: unknown[];
  getToken?: (auth?: AuthDict) => Promise<unknown>;
}) => {
  const authedRequest = vi.fn(
    async (_method: string, _path: string, _query: unknown, body: { auth?: AuthDict }) =>
      (options?.getToken ?? (async () => ({ login_token: 'tok-xyz', expires_in_ms: 120_000 })))(
        body.auth
      )
  );
  const mx = {
    getHomeserverUrl: () => options?.homeserverUrl ?? 'https://mindroom.chat',
    loginFlows: vi.fn(async () => ({
      flows: options?.flows ?? [{ type: 'm.login.token', get_login_token: true }],
    })),
    http: { authedRequest },
  } as unknown as MatrixClient;
  return { mx, authedRequest };
};

const directRun = <T>(request: (auth?: AuthDict) => Promise<T>) => request();

afterEach(() => {
  cfState.enabled = false;
});

describe('mintDesktopLoginToken', () => {
  it('mints a one-time MSC3882 login token via UIA and computes expiresAt', async () => {
    const { mx, authedRequest } = createClient({
      getToken: async (auth) => {
        if (!auth) throw new Error('missing auth');
        return { login_token: 'minted-123', expires_in_ms: 90_000 };
      },
    });
    const runUia = <T>(request: (auth?: AuthDict) => Promise<T>) =>
      request({ type: 'm.login.dummy', session: 'uia-1' });

    const result = await mintDesktopLoginToken(mx, runUia, { now: () => NOW });

    expect(result).toEqual({
      kind: 'token',
      loginToken: 'minted-123',
      expiresAt: NOW + 90_000,
    });
    expect(authedRequest).toHaveBeenCalledWith(
      Method.Post,
      '/login/get_token',
      undefined,
      { auth: { type: 'm.login.dummy', session: 'uia-1' } },
      { prefix: ClientPrefix.V1 }
    );
  });

  it('returns unsupported when Cloudflare Access is active locally or on the offer', async () => {
    cfState.enabled = true;
    const { mx, authedRequest } = createClient();
    await expect(mintDesktopLoginToken(mx, directRun)).resolves.toEqual({ kind: 'unsupported' });
    expect(authedRequest).not.toHaveBeenCalled();

    cfState.enabled = false;
    await expect(mintDesktopLoginToken(mx, directRun, { cloudflareAccess: true })).resolves.toEqual(
      { kind: 'unsupported' }
    );
    expect(authedRequest).not.toHaveBeenCalled();
  });

  it('returns unsupported when loginFlows lacks get_login_token: true or homeserver differs', async () => {
    const noTokenFlow = createClient({
      flows: [{ type: 'm.login.token' }, { type: 'm.login.password' }],
    });
    await expect(mintDesktopLoginToken(noTokenFlow.mx, directRun)).resolves.toEqual({
      kind: 'unsupported',
    });
    expect(noTokenFlow.authedRequest).not.toHaveBeenCalled();

    const otherHs = createClient({ homeserverUrl: 'https://mindroom.chat' });
    await expect(
      mintDesktopLoginToken(otherHs.mx, directRun, { homeserverUrl: 'https://other.example.org' })
    ).resolves.toEqual({ kind: 'unsupported' });
  });

  it('returns cancelled when the user cancels UIA', async () => {
    const { mx } = createClient();
    const cancelRun = async <T>(_request: (auth?: AuthDict) => Promise<T>): Promise<T> => {
      throw new AuthenticationCancelled();
    };
    await expect(mintDesktopLoginToken(mx, cancelRun)).resolves.toEqual({ kind: 'cancelled' });
  });

  it('returns failed on transport error or malformed token response', async () => {
    const transportFail = createClient({
      getToken: async () => {
        throw new Error('500 internal error');
      },
    });
    await expect(mintDesktopLoginToken(transportFail.mx, directRun)).resolves.toEqual({
      kind: 'failed',
      reason: '500 internal error',
    });

    const malformed = createClient({
      getToken: async () => ({ login_token: '', expires_in_ms: 1000 }),
    });
    await expect(mintDesktopLoginToken(malformed.mx, directRun)).resolves.toEqual({
      kind: 'failed',
      reason: 'Homeserver returned an invalid login token.',
    });
  });
});
