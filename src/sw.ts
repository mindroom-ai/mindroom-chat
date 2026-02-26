/// <reference lib="WebWorker" />

import { looksLikeMediaRequest, validMediaRequest } from './swMediaAuth';

export type {};
declare const self: ServiceWorkerGlobalScope;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(self.clients.claim());
});

type SessionInfo = {
  accessToken: string;
  baseUrl: string;
};

/**
 * Store session per client (tab)
 */
const sessions = new Map<string, SessionInfo>();

async function cleanupDeadClients() {
  const activeClients = await self.clients.matchAll();
  const activeIds = new Set(activeClients.map((c) => c.id));

  Array.from(sessions.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      sessions.delete(id);
    }
  });
}

/**
 * Receive session updates from clients
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const client = event.source as Client | null;
  if (!client) return;

  const { type, accessToken, baseUrl } = event.data || {};

  if (type !== 'setSession') return;

  cleanupDeadClients();

  if (typeof accessToken === 'string' && typeof baseUrl === 'string') {
    sessions.set(client.id, { accessToken, baseUrl });
  } else {
    // Logout or invalid session
    sessions.delete(client.id);
  }
});

async function askForAccessToken(client: Client): Promise<string | undefined> {
  return new Promise((resolve) => {
    const responseKey = Math.random().toString(36);
    let listener: (messageEvent: ExtendableMessageEvent) => void = () => undefined;
    const timeoutId = setTimeout(() => {
      self.removeEventListener('message', listener);
      resolve(undefined);
    }, 1500);

    listener = (messageEvent: ExtendableMessageEvent) => {
      if (messageEvent.data?.responseKey !== responseKey) return;
      clearTimeout(timeoutId);
      self.removeEventListener('message', listener);
      resolve(typeof messageEvent.data?.token === 'string' ? messageEvent.data.token : undefined);
    };

    self.addEventListener('message', listener);
    client.postMessage({ responseKey, type: 'token' });
  });
}

const normalizeRequestCache = (request: Request): RequestCache =>
  request.cache === 'only-if-cached' ? 'default' : request.cache;

const authHeaders = (request: Request, token: string): Headers => {
  const headers = new Headers(request.headers);
  headers.set('Authorization', `Bearer ${token}`);
  return headers;
};

const fetchAuthenticatedMedia = async (request: Request, token: string): Promise<Response> => {
  const headers = authHeaders(request, token);
  const cache = normalizeRequestCache(request);

  if (request.mode === 'no-cors') {
    // no-cors requests cannot carry Authorization; upgrade to CORS for authenticated media.
    return fetch(request.url, {
      method: request.method,
      headers,
      mode: 'cors',
      credentials: 'omit',
      cache,
      redirect: request.redirect,
      referrer: request.referrer,
      referrerPolicy: request.referrerPolicy,
      integrity: request.integrity,
      keepalive: request.keepalive,
    });
  }

  return fetch(request, { headers, cache });
};

const fetchAuthenticatedMediaWithFallback = async (
  request: Request,
  token: string
): Promise<Response> => {
  try {
    return await fetchAuthenticatedMedia(request, token);
  } catch {
    // If authenticated fetch fails unexpectedly, fall back to the original request.
    return fetch(request);
  }
};

self.addEventListener('fetch', (event: FetchEvent) => {
  const { url, method } = event.request;

  if (method !== 'GET') return;
  if (!looksLikeMediaRequest(url)) return;

  event.respondWith(
    (async (): Promise<Response> => {
      if (event.clientId) {
        const session = sessions.get(event.clientId);
        if (session && validMediaRequest(url, session.baseUrl)) {
          return fetchAuthenticatedMediaWithFallback(event.request, session.accessToken);
        }

        // Fallback for clients still on the older token request/response flow.
        const client = await self.clients.get(event.clientId);
        if (client) {
          const token = await askForAccessToken(client);
          if (token) {
            return fetchAuthenticatedMediaWithFallback(event.request, token);
          }
        }
      }

      return fetch(event.request);
    })()
  );
});
