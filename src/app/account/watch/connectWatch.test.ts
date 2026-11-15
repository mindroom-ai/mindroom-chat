import type { AuthDict, MatrixClient } from 'matrix-js-sdk';
import { describe, expect, it, vi } from 'vitest';
import { AuthenticationCancelled } from '../uia/useAuthenticatedAction';
import type { WatchCredentials, WatchSecrets } from '../../native/nativeWatch';
import { connectWatch, verifyWatch } from './connectWatch';

const access = vi.hoisted(() => ({ on: false }));
vi.mock('../../native/cloudflareAccess', () => ({ hasCloudflareAccess: () => access.on }));

const NOW = 1_800_000_000_000;

type GetToken = (auth?: AuthDict) => Promise<{ login_token: string; expires_in_ms: number }>;

const client = (options: {
  flows?: unknown[];
  getToken?: GetToken;
  crossSigningKeys?: boolean;
  exportBundle?: () => Promise<unknown>;
  devicesAfter?: number;
  /** The signing key the homeserver lists for the watch's device. */
  listedKey?: string;
}) => {
  let polls = 0;
  const crossSignDevice = vi.fn(async () => undefined);
  const exportSecretsBundle = vi.fn(
    options.exportBundle ?? (async () => ({ cross_signing: {}, backup: { key: 'k' } }))
  );
  const authedRequest = vi.fn(
    async (_method: string, _path: string, _query: unknown, body: { auth?: AuthDict }) =>
      (options.getToken ?? (async () => ({ login_token: 'tok', expires_in_ms: 120_000 })))(
        body.auth
      )
  );
  const mx = {
    loginFlows: vi.fn(async () => ({
      flows: options.flows ?? [{ type: 'm.login.token', get_login_token: true }],
    })),
    http: { authedRequest },
    getHomeserverUrl: () => 'https://mindroom.chat',
    getSafeUserId: () => '@bas:mindroom.chat',
    getCrypto: () => ({
      getCrossSigningStatus: async () => ({
        privateKeysCachedLocally: {
          masterKey: options.crossSigningKeys ?? true,
          selfSigningKey: options.crossSigningKeys ?? true,
          userSigningKey: options.crossSigningKeys ?? true,
        },
      }),
      exportSecretsBundle,
      getUserDeviceInfo: async () => {
        polls += 1;
        const devices = new Map<string, unknown>();
        if (polls > (options.devicesAfter ?? 0)) {
          devices.set('WATCH', { getFingerprint: () => options.listedKey ?? 'KEY' });
        }
        return new Map([['@bas:mindroom.chat', devices]]);
      },
      crossSignDevice,
    }),
  } as unknown as MatrixClient;
  return { mx, authedRequest, exportSecretsBundle, crossSignDevice };
};

const directRun = <T>(request: (auth?: AuthDict) => Promise<T>) => request();

describe('connectWatch', () => {
  it('says the homeserver cannot connect a watch when it does not offer login tokens', async () => {
    const { mx } = client({ flows: [{ type: 'm.login.token' }, { type: 'm.login.password' }] });
    const send = vi.fn();
    await expect(connectWatch(mx, send, directRun, () => NOW)).resolves.toEqual({
      kind: 'unsupported',
    });
    expect(send).not.toHaveBeenCalled();
  });

  it('says the homeserver cannot connect a watch behind Cloudflare Access', async () => {
    access.on = true;
    const { mx, authedRequest } = client({});
    const send = vi.fn();
    try {
      await expect(connectWatch(mx, send, directRun, () => NOW)).resolves.toEqual({
        kind: 'unsupported',
      });
    } finally {
      access.on = false;
    }
    expect(authedRequest).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('mints a token and sends the credentials to the watch', async () => {
    const { mx, authedRequest } = client({});
    const send = vi.fn(async (_message: WatchCredentials) => undefined);
    await expect(connectWatch(mx, send, directRun, () => NOW)).resolves.toEqual({
      kind: 'sent',
      expiresAt: NOW + 120_000,
    });
    expect(authedRequest).toHaveBeenCalledWith(
      'POST',
      '/login/get_token',
      undefined,
      {},
      {
        prefix: '/_matrix/client/v1',
      }
    );
    expect(send).toHaveBeenCalledWith({
      v: 1,
      kind: 'credentials',
      homeserverUrl: 'https://mindroom.chat',
      userId: '@bas:mindroom.chat',
      loginToken: 'tok',
      expiresAt: NOW + 120_000,
    });
  });

  it('runs the token request through interactive auth', async () => {
    const getToken: GetToken = async (auth) => {
      if (!auth) throw new Error('needs auth');
      return { login_token: 'after-auth', expires_in_ms: 60_000 };
    };
    const { mx } = client({ getToken });
    const send = vi.fn(async (_message: WatchCredentials) => undefined);
    const run = <T>(request: (auth?: AuthDict) => Promise<T>) =>
      request({ type: 'm.login.password', session: 's' });
    await connectWatch(mx, send, run, () => NOW);
    expect(send.mock.calls[0]?.[0].loginToken).toBe('after-auth');
  });

  it('reports a cancelled sign-in prompt', async () => {
    const { mx } = client({});
    const run = async () => {
      throw new AuthenticationCancelled();
    };
    await expect(connectWatch(mx, vi.fn(), run, () => NOW)).resolves.toEqual({
      kind: 'cancelled',
    });
  });

  it('reports other failures with their message', async () => {
    const { mx } = client({
      getToken: async () => {
        throw new Error('M_FORBIDDEN');
      },
    });
    await expect(connectWatch(mx, vi.fn(), directRun, () => NOW)).resolves.toEqual({
      kind: 'failed',
      reason: 'M_FORBIDDEN',
    });
  });
});

describe('verifyWatch', () => {
  const options = { timeoutMs: 1000, pollMs: 1 };
  const WATCH = { deviceId: 'WATCH', deviceKey: 'KEY' };

  it('cross-signs the watch once its keys are visible, then sends it the secrets bundle', async () => {
    const { mx, crossSignDevice } = client({ devicesAfter: 2 });
    const send = vi.fn(async (_message: WatchSecrets) => undefined);
    await expect(verifyWatch(mx, WATCH, send, options)).resolves.toBe('verified');
    expect(crossSignDevice).toHaveBeenCalledWith('WATCH');
    expect(send).toHaveBeenCalledWith({
      v: 1,
      kind: 'secrets',
      userId: '@bas:mindroom.chat',
      bundle: JSON.stringify({ cross_signing: {}, backup: { key: 'k' } }),
    });
  });

  it('refuses a device whose key on the homeserver is not the one the watch named', async () => {
    const { mx, crossSignDevice, exportSecretsBundle } = client({ listedKey: 'OTHER' });
    const send = vi.fn();
    await expect(verifyWatch(mx, WATCH, send, options)).rejects.toThrow(
      'The homeserver lists another key for the watch.'
    );
    expect(crossSignDevice).not.toHaveBeenCalled();
    expect(exportSecretsBundle).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('leaves the watch unverified when this device has no cross-signing keys', async () => {
    const { mx, crossSignDevice, exportSecretsBundle } = client({ crossSigningKeys: false });
    const send = vi.fn();
    await expect(verifyWatch(mx, WATCH, send, options)).resolves.toBe('no-cross-signing');
    expect(crossSignDevice).not.toHaveBeenCalled();
    expect(exportSecretsBundle).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the cross-signing keys and says so when there is no backup to share', async () => {
    // The export leaves the backup out when there is none; it does not fail.
    const bundle = { cross_signing: { master_key: 'm' } };
    const { mx, crossSignDevice } = client({ exportBundle: async () => bundle });
    const send = vi.fn(async (_message: WatchSecrets) => undefined);
    await expect(verifyWatch(mx, WATCH, send, options)).resolves.toBe('no-backup');
    expect(crossSignDevice).toHaveBeenCalledWith('WATCH');
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ bundle: JSON.stringify(bundle) }));
  });

  it('fails when the secrets cannot be exported', async () => {
    const { mx } = client({
      exportBundle: async () => {
        throw new Error('no backup version');
      },
    });
    const send = vi.fn();
    await expect(verifyWatch(mx, WATCH, send, options)).rejects.toThrow('no backup version');
    expect(send).not.toHaveBeenCalled();
  });

  it('gives up when the watch keys never show', async () => {
    const { mx, crossSignDevice } = client({ devicesAfter: Infinity });
    const send = vi.fn();
    await expect(verifyWatch(mx, WATCH, send, { timeoutMs: 20, pollMs: 1 })).resolves.toBe(
      'timeout'
    );
    expect(crossSignDevice).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
