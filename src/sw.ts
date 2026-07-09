/// <reference lib="WebWorker" />

import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { looksLikeMediaRequest, validMediaRequest } from './swMediaAuth';
import { buildAuthenticatedMediaRequestInit } from './swMediaFetch';

export type {};
declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
};

const precacheManifest = self.__WB_MANIFEST;
precacheAndRoute(precacheManifest);
cleanupOutdatedCaches();

const navigationFallbackDenylist = [
  /^\/api(?:\/|$)/,
  /^\/(?:[^/]+\/)?_matrix(?:\/|$)/,
  /^\/(?:[^/]+\/)?_synapse(?:\/|$)/,
  /^\/(?:[^/]+\/)?\.well-known(?:\/|$)/,
  // Static documents (the embedded Element Call widget iframe navigates to
  // /public/element-call/index.html); serving the app shell instead leaves
  // calls stuck on "Joining" because the widget never boots. Workbox matches
  // the denylist against pathname + search, so "?" is a valid boundary too
  // (fragments never reach the service worker, so "#" is not).
  /^\/(?:[^/]+\/)?public(?:\/|\?|$)/,
];

// createHandlerBoundToURL throws for non-precached URLs, which would fail
// the whole service worker evaluation (the dev server injects an empty
// manifest; a misconfigured build could omit the shell). Register the
// navigation fallback only when its precondition — a precached index.html —
// actually holds. The media-auth fetch handler below works without it.
const precachesAppShell = precacheManifest.some(
  (entry) => (typeof entry === 'string' ? entry : entry.url) === 'index.html'
);
if (precachesAppShell) {
  registerRoute(
    new NavigationRoute(createHandlerBoundToURL('index.html'), {
      denylist: navigationFallbackDenylist,
    })
  );
}

type SessionInfo = {
  accessToken: string;
  baseUrl: string;
};

/**
 * Store session per client (tab)
 */
const sessions = new Map<string, SessionInfo>();

const clientToResolve = new Map<string, (value: SessionInfo | undefined) => void>();
const clientToSessionPromise = new Map<string, Promise<SessionInfo | undefined>>();

async function cleanupDeadClients() {
  const activeClients = await self.clients.matchAll();
  const activeIds = new Set(activeClients.map((c) => c.id));

  Array.from(sessions.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      sessions.delete(id);
      clientToResolve.delete(id);
      clientToSessionPromise.delete(id);
    }
  });
}

function setSession(clientId: string, accessToken: any, baseUrl: any) {
  if (typeof accessToken === 'string' && typeof baseUrl === 'string') {
    sessions.set(clientId, { accessToken, baseUrl });
  } else {
    // Logout or invalid session
    sessions.delete(clientId);
  }

  const resolveSession = clientToResolve.get(clientId);
  if (resolveSession) {
    resolveSession(sessions.get(clientId));
    clientToResolve.delete(clientId);
    clientToSessionPromise.delete(clientId);
  }
}

function requestSession(client: Client): Promise<SessionInfo | undefined> {
  const promise =
    clientToSessionPromise.get(client.id) ??
    new Promise((resolve) => {
      clientToResolve.set(client.id, resolve);
      client.postMessage({ type: 'requestSession' });
    });

  if (!clientToSessionPromise.has(client.id)) {
    clientToSessionPromise.set(client.id, promise);
  }

  return promise;
}

async function requestSessionWithTimeout(
  clientId: string,
  timeoutMs = 3000
): Promise<SessionInfo | undefined> {
  const client = await self.clients.get(clientId);
  if (!client) return undefined;

  const sessionPromise = requestSession(client);

  const timeout = new Promise<undefined>((resolve) => {
    setTimeout(() => resolve(undefined), timeoutMs);
  });

  return Promise.race([sessionPromise, timeout]);
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      await self.clients.claim();
      await cleanupDeadClients();
    })()
  );
});

/**
 * Receive session updates from clients
 */
self.addEventListener('message', (event: ExtendableMessageEvent) => {
  const client = event.source as Client | null;
  if (!client) return;

  const { type, accessToken, baseUrl } = event.data || {};

  if (type === 'setSession') {
    setSession(client.id, accessToken, baseUrl);
    cleanupDeadClients();
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

const fetchAuthenticatedMedia = async (request: Request, token: string): Promise<Response> => {
  const init = buildAuthenticatedMediaRequestInit(request, token);
  return request.mode === 'no-cors' ? fetch(request.url, init) : fetch(request, init);
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
