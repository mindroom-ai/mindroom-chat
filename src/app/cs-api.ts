// Unauthenticated client-server API calls made before there is a MatrixClient: server discovery
// (specification "Server Discovery", `/.well-known/matrix/client`) and `/_matrix/client/versions`.

import { trimTrailingSlash } from './utils/common';















  FAIL_INSECURE = 'FAIL_INSECURE',
}









};

const LOCAL_HOSTNAME = /^(?:localhost|.+\.local|.+\.localhost)$/i;

const isPrivateIPv4 = (hostname: string): boolean => {
  const parts = hostname.split('.').map(Number);
  if (
    parts.length !== 4 ||
    parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
  ) {
    return false;
  }
  const [a, b] = parts;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254)
  );
};

const isLocalHostname = (hostname: string): boolean => {
  const bare = hostname.replace(/^\[|\]$/g, '');
  if (bare === '::1' || /^f[cd][0-9a-f]{2}:/i.test(bare) || /^fe80:/i.test(bare)) return true;
  return LOCAL_HOSTNAME.test(bare) || isPrivateIPv4(bare);
};

/**
 * Homeservers must be reached over HTTPS, except on the local network (localhost, `.local`,
 * private addresses), where plain HTTP is common during development and self-hosting.
 */
export const isAllowedHomeserverBaseUrl = (baseUrl: string): boolean => {
  try {
    const url = new URL(baseUrl);
    if (url.protocol === 'https:') return true;
    return url.protocol === 'http:' && isLocalHostname(url.hostname);
  } catch {
    return false;
  }
};

const withScheme = (server: string): string =>
  /^https?:\/\//i.test(server) ? server : `https://${server}`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const fallbackInfo = (baseUrl: string): AutoDiscoveryInfo => ({
  'm.homeserver': { base_url: baseUrl },











  if (!isAllowedHomeserverBaseUrl(host)) {
    return [{ host, action: AutoDiscoveryAction.FAIL_INSECURE }, undefined];
  }

  let response: Response;
  try {
    response = await request(`${host}/.well-known/matrix/client`, { method: 'GET' });
  } catch {
    return [{ host, action: AutoDiscoveryAction.FAIL_PROMPT }, undefined];
  }
  if (response.status === 404) return [undefined, fallbackInfo(host)];
  if (response.status !== 200)
    return [{ host, action: AutoDiscoveryAction.FAIL_PROMPT }, undefined];

  let content: unknown;
  try {
    content = await response.json();
  } catch {
    return [{ host, action: AutoDiscoveryAction.FAIL_PROMPT }, undefined];
  }
  const homeserver = isRecord(content) ? content['m.homeserver'] : undefined;
  const baseUrl = isRecord(homeserver) ? homeserver.base_url : undefined;
  if (typeof baseUrl !== 'string' || baseUrl.trim() === '') {
    return [{ host, action: AutoDiscoveryAction.FAIL_PROMPT }, undefined];
  }
  const normalizedBaseUrl = trimTrailingSlash(baseUrl.trim());
  if (!isAllowedHomeserverBaseUrl(normalizedBaseUrl)) {
    return [{ host, action: AutoDiscoveryAction.FAIL_INSECURE }, undefined];
  }

  return [
    undefined,
    {
      ...(content as Record<string, unknown>),
      'm.homeserver': { ...(homeserver as Record<string, unknown>), base_url: normalizedBaseUrl },
    } as AutoDiscoveryInfo,
  ];
};

const DEFAULT_VERSIONS_TIMEOUT_MS = 20_000;

const withTimeout = <T>(task: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Request timed out')), timeoutMs);
    task.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });

/** The homeserver's `/_matrix/client/versions`; rejects on a non-2xx answer or after a timeout. */
export const specVersions = async (
  request: typeof fetch,
  baseUrl: string,
  timeoutMs = DEFAULT_VERSIONS_TIMEOUT_MS
): Promise<SpecVersions> => {
  const url = `${trimTrailingSlash(baseUrl)}/_matrix/client/versions`;
  const response = await withTimeout(request(url, { method: 'GET' }), timeoutMs);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`HTTP ${response.status}`);
  }
  const body = (await response.json()) as SpecVersions;
  if (!isRecord(body) || !Array.isArray(body.versions)) {
    throw new Error('Invalid versions response');
  }
  return body;
};
