import { ClientPrefix, Method, type MatrixClient } from 'matrix-js-sdk';
import { AuthenticationCancelled } from '../account/uia/useAuthenticatedAction';
import type { UiaRunner } from '../account/watch/connectWatch';
import { errorMessage } from '../lib/errorMessage';
import { hasCloudflareAccess } from '../native/cloudflareAccess';
import { sameHomeserver } from './desktopPairingProtocol';

export type DesktopLoginTokenResult =
  /** `expiresAt`: when the login token runs out (milliseconds since the epoch). */
  | { kind: 'token'; loginToken: string; expiresAt: number }
  /** The helper has to sign in through the browser instead. */
  | { kind: 'unsupported' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: string };

export type DesktopLoginTokenOptions = {
  /** The homeserver the agent's offer names; a token of another server is of no use there. */
  homeserverUrl?: string;
  /** Whether the agent's offer says the homeserver sits behind Cloudflare Access. */
  cloudflareAccess?: boolean;
  now?: () => number;
};

type LoginFlow = { type: string; get_login_token?: boolean };

/**
 * Mints a one-time login token (`POST /login/get_token`, MSC3882, spec v1.7) so the Mac helper
 * signs in as a device of this account without a browser. The token stays in memory: it goes to
 * the helper once and is never stored or logged.
 */
export const mintDesktopLoginToken = async (
  mx: MatrixClient,
  run: UiaRunner,
  { homeserverUrl, cloudflareAccess = false, now = Date.now }: DesktopLoginTokenOptions = {}
): Promise<DesktopLoginTokenResult> => {
  try {
    const own = mx.getHomeserverUrl();
    // Behind Cloudflare Access the helper first gets an Access session of its own, an interactive
    // step a short-lived token may not outlast, so it signs in through the browser there.
    if (cloudflareAccess || hasCloudflareAccess(own)) return { kind: 'unsupported' };
    if (homeserverUrl !== undefined && !sameHomeserver(own, homeserverUrl))
      return { kind: 'unsupported' };
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion -- the types do not check without it
    const { flows } = (await mx.loginFlows()) as { flows: LoginFlow[] };
    if (!flows.some((flow) => flow.type === 'm.login.token' && flow.get_login_token === true))
      return { kind: 'unsupported' };
    const token = await run((auth) =>
      mx.http.authedRequest<{ login_token?: unknown; expires_in_ms?: unknown }>(
        Method.Post,
        '/login/get_token',
        undefined,
        auth ? { auth } : {},
        { prefix: ClientPrefix.V1 }
      )
    );
    const { login_token: loginToken, expires_in_ms: expiresIn } = token;
    if (typeof loginToken !== 'string' || !loginToken || typeof expiresIn !== 'number')
      return { kind: 'failed', reason: 'Homeserver returned an invalid login token.' };
    return { kind: 'token', loginToken, expiresAt: now() + expiresIn };
  } catch (error) {
    if (error instanceof AuthenticationCancelled) return { kind: 'cancelled' };
    return { kind: 'failed', reason: errorMessage(error) };
  }
};
