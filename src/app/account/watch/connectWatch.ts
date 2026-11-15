import { ClientPrefix, Method, type AuthDict, type MatrixClient } from 'matrix-js-sdk';
import { AuthenticationCancelled } from '../uia/useAuthenticatedAction';
import { hasCloudflareAccess } from '../../native/cloudflareAccess';
import type { WatchCredentials, WatchDevice, WatchSecrets } from '../../native/nativeWatch';

export type ConnectResult =
  /** `expiresAt`: when the login token runs out (milliseconds since the epoch). */
  | { kind: 'sent'; expiresAt: number }
  | { kind: 'unsupported' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: string };

/** Runs a request again with each interactive-auth stage the server asks for (`useAuthenticatedAction`). */
export type UiaRunner = <T>(request: (auth?: AuthDict) => Promise<T>) => Promise<T>;

type LoginFlow = { type: string; get_login_token?: boolean };
type LoginTokenResponse = { login_token: string; expires_in_ms: number };

const describe = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Mints a login token (`POST /login/get_token`, MSC3882, spec v1.7) for the watch and sends it.
 * The watch signs in with it as a device of its own.
 */
export const connectWatch = async (
  mx: MatrixClient,
  send: (credentials: WatchCredentials) => Promise<void>,
  run: UiaRunner,
  now: () => number = Date.now
): Promise<ConnectResult> => {
  try {
    // The watch holds no Cloudflare Access session, so such a server rejects its every request.
    if (hasCloudflareAccess(mx.getHomeserverUrl())) return { kind: 'unsupported' };
    const { flows } = (await mx.loginFlows()) as { flows: LoginFlow[] };
    if (!flows.some((flow) => flow.type === 'm.login.token' && flow.get_login_token === true)) {
      return { kind: 'unsupported' };
    }
    const token = await run((auth) =>
      mx.http.authedRequest<LoginTokenResponse>(
        Method.Post,
        '/login/get_token',
        undefined,
        auth ? { auth } : {},
        { prefix: ClientPrefix.V1 }
      )
    );
    const expiresAt = now() + token.expires_in_ms;
    await send({
      v: 1,
      kind: 'credentials',
      homeserverUrl: mx.getHomeserverUrl(),
      userId: mx.getSafeUserId(),
      loginToken: token.login_token,
      expiresAt,
    });
    return { kind: 'sent', expiresAt };
  } catch (error) {
    if (error instanceof AuthenticationCancelled) return { kind: 'cancelled' };
    return { kind: 'failed', reason: describe(error) };
  }
};

export type VerifyResult = 'verified' | 'no-backup' | 'no-cross-signing' | 'timeout';

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Verifies the watch's new device: cross-signs it once its keys reach this client, so the account's
 * other devices and other people trust it, and only when the homeserver lists the signing key the
 * watch named for it (a server could list a device of its own under that id; this throws then).
 * Then sends it this account's secrets bundle (the private
 * cross-signing keys and the key backup's key), which makes the watch trust the account's devices in
 * turn and turns key backup on there, so it reads messages from before it signed in. Needs this
 * device to hold the cross-signing keys; without a key backup the bundle holds only those
 * (`no-backup`). An export that fails throws.
 */
export const verifyWatch = async (
  mx: MatrixClient,
  { deviceId, deviceKey }: Pick<WatchDevice, 'deviceId' | 'deviceKey'>,
  send: (secrets: WatchSecrets) => Promise<void>,
  { timeoutMs = 30_000, pollMs = 2_000 }: { timeoutMs?: number; pollMs?: number } = {}
): Promise<VerifyResult> => {
  const crypto = mx.getCrypto();
  if (!crypto) return 'no-cross-signing';
  const { privateKeysCachedLocally: keys } = await crypto.getCrossSigningStatus();
  if (!keys.masterKey || !keys.selfSigningKey || !keys.userSigningKey) return 'no-cross-signing';
  const userId = mx.getSafeUserId();
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // Polls one download at a time until the server lists the new device.
    // eslint-disable-next-line no-await-in-loop
    const listed = (await crypto.getUserDeviceInfo([userId], true)).get(userId)?.get(deviceId);
    if (listed) {
      if (listed.getFingerprint() !== deviceKey) {
        throw new Error('The homeserver lists another key for the watch.');
      }
      break;
    }
    if (Date.now() + pollMs > deadline) return 'timeout';
    // eslint-disable-next-line no-await-in-loop
    await wait(pollMs);
  }
  await crypto.crossSignDevice(deviceId);
  const bundle: unknown = await crypto.exportSecretsBundle?.();
  if (bundle === undefined) return 'no-backup';
  await send({ v: 1, kind: 'secrets', userId, bundle: JSON.stringify(bundle) });
  // The export leaves the key backup out when this account has none.
  const backup = (bundle as { backup?: unknown }).backup;
  return backup === undefined || backup === null ? 'no-backup' : 'verified';
};
