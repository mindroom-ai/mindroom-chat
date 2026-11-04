import { Method, type IOpenIDToken, type MatrixClient } from 'matrix-js-sdk';

/** The `.well-known/matrix/client` key that lists a deployment's MatrixRTC backends (MSC4143). */
export const RTC_FOCI_WELL_KNOWN_KEY = 'org.matrix.msc4143.rtc_foci';

/** The client-server prefix of MSC4143's transport discovery endpoint. */
const RTC_TRANSPORTS_PREFIX = '/_matrix/client/unstable/org.matrix.msc4143';

/** A LiveKit backend as MatrixRTC memberships name it (MSC4195). */
export type LivekitFocus = {
  type: 'livekit';
  livekit_service_url: string;
  livekit_alias?: string;
};

const isHttpUrl = (value: unknown): value is string => {
  if (typeof value !== 'string' || value.trim() === '') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'https:' || protocol === 'http:';
  } catch {
    return false;
  }
};

/**
 * The authorization service URL of the first LiveKit entry in a list of MatrixRTC transports,
 * as `.well-known` (`rtc_foci`), `/rtc/transports` and memberships (`foci_preferred`) carry them.
 * Entries of other types, and ones without an HTTP(S) URL, are skipped.
 */
export const firstLivekitServiceUrl = (transports: unknown): string | undefined => {
  if (!Array.isArray(transports)) return undefined;
  const livekit = transports.find(
    (entry) =>
      !!entry &&
      typeof entry === 'object' &&
      (entry as { type?: unknown }).type === 'livekit' &&
      isHttpUrl((entry as { livekit_service_url?: unknown }).livekit_service_url)
  ) as LivekitFocus | undefined;
  return livekit?.livekit_service_url;
};

type FetchLike = typeof fetch;

const readWellKnownFocus = async (fetchFn: FetchLike, origin: string) => {
  const response = await fetchFn(`${origin.replace(/\/+$/, '')}/.well-known/matrix/client`, {
    method: 'GET',
  });
  if (!response.ok) return undefined;
  const content: unknown = await response.json();
  if (!content || typeof content !== 'object') return undefined;
  return firstLivekitServiceUrl((content as Record<string, unknown>)[RTC_FOCI_WELL_KNOWN_KEY]);
};

const readTransportsFocus = async (mx: MatrixClient) => {
  const body = await mx.http.authedRequest<{ rtc_transports?: unknown }>(
    Method.Get,
    '/rtc/transports',
    undefined,
    undefined,
    { prefix: RTC_TRANSPORTS_PREFIX }
  );
  return firstLivekitServiceUrl(body?.rtc_transports);
};

/** Each step of the search; one that throws (unreachable, CORS, 404) moves on to the next. */
const firstFound = async (
  steps: Array<() => Promise<string | undefined>>
): Promise<string | undefined> => {
  for (const step of steps) {
    // eslint-disable-next-line no-await-in-loop
    const found = await step().catch(() => undefined);
    if (found) return found;
  }
  return undefined;
};

/**
 * Finds the LiveKit authorization service of the account's deployment: first the server name's
 * `.well-known/matrix/client` (what MindRoom agents trust, so a call they should answer must
 * name the same URL), then the homeserver's MSC4143 `/rtc/transports`, then a `.well-known`
 * served at the homeserver's own URL (deployments whose server name has no web server).
 */
export const discoverLivekitServiceUrl = (
  mx: MatrixClient,
  fetchFn: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<string | undefined> => {
  const serverName = mx.getDomain();
  return firstFound([
    async () => (serverName ? readWellKnownFocus(fetchFn, `https://${serverName}`) : undefined),
    async () => readTransportsFocus(mx),
    async () => readWellKnownFocus(fetchFn, mx.baseUrl),
  ]);
};

const discoveries = new WeakMap<MatrixClient, Promise<string | undefined>>();

/** `discoverLivekitServiceUrl` once per client; a search that found nothing runs again next time. */
export const getLivekitServiceUrl = (mx: MatrixClient): Promise<string | undefined> => {
  const known = discoveries.get(mx);
  if (known) return known;
  const search = discoverLivekitServiceUrl(mx).then((url) => {
    if (!url) discoveries.delete(mx);
    return url;
  });
  discoveries.set(mx, search);
  return search;
};

/** What the authorization service hands back: where the LiveKit server is, and a token for it. */
export type SfuGrant = { url: string; jwt: string };

export class SfuGrantError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'SfuGrantError';
  }
}

const isLivekitUrl = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  try {
    const { protocol } = new URL(value);
    return protocol === 'wss:' || protocol === 'ws:';
  } catch {
    return false;
  }
};

/**
 * Trades a Matrix OpenID token for LiveKit credentials (`POST <service>/sfu/get`). The service
 * checks the token with the homeserver, names the LiveKit room after the Matrix room, and makes
 * the participant identity `<user id>:<device id>`, which MatrixRTC memberships use as well.
 */
export const requestSfuGrant = async (
  serviceUrl: string,
  { roomId, deviceId, token }: { roomId: string; deviceId: string; token: IOpenIDToken },
  fetchFn: FetchLike = globalThis.fetch.bind(globalThis)
): Promise<SfuGrant> => {
  const response = await fetchFn(`${serviceUrl.replace(/\/+$/, '')}/sfu/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      room: roomId,
      device_id: deviceId,
      openid_token: {
        access_token: token.access_token,
        token_type: token.token_type,
        matrix_server_name: token.matrix_server_name,
        expires_in: token.expires_in,
      },
    }),
  });
  if (!response.ok) {
    throw new SfuGrantError(`The call service answered ${response.status}`, response.status);
  }
  const grant: unknown = await response.json().catch(() => undefined);
  const { url, jwt } = (grant ?? {}) as { url?: unknown; jwt?: unknown };
  if (!isLivekitUrl(url) || typeof jwt !== 'string' || jwt === '') {
    throw new SfuGrantError('The call service sent no usable LiveKit credentials');
  }
  return { url, jwt };
};
