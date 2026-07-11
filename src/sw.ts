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
const pendingSessionRequests = new Map<
  string,
  {
    promise: Promise<SessionInfo | undefined>;
    resolve: (session?: SessionInfo) => void;
    waiters: number;
  }
>();

async function cleanupDeadClients() {
  const activeClients = await self.clients.matchAll();
  const activeIds = new Set(activeClients.map((c) => c.id));

  Array.from(sessions.keys()).forEach((id) => {
    if (!activeIds.has(id)) {
      sessions.delete(id);
    }
  });
  Array.from(pendingSessionRequests.keys()).forEach((id) => {
    if (!activeIds.has(id)) pendingSessionRequests.delete(id);
  });
}

function setSession(clientId: string, accessToken: unknown, baseUrl: unknown) {
  let validBaseUrl: string | undefined;
  if (typeof baseUrl === 'string') {
    try {
      const parsedBaseUrl = new URL(baseUrl);
      if (parsedBaseUrl.protocol === 'https:' || parsedBaseUrl.protocol === 'http:') {
        validBaseUrl = parsedBaseUrl.toString();
      }
    } catch {
      // Invalid base URLs clear the client session below.
    }
  }

  if (typeof accessToken === 'string' && accessToken.length > 0 && validBaseUrl) {
    sessions.set(clientId, { accessToken, baseUrl: validBaseUrl });
  } else {
    // Logout or invalid session
    sessions.delete(clientId);
  }

  const pending = pendingSessionRequests.get(clientId);
  if (pending) {
    pending.resolve(sessions.get(clientId));
    pendingSessionRequests.delete(clientId);
  }
}

const requestSession = async (
  clientId: string,
  timeoutMs = 3000
): Promise<SessionInfo | undefined> => {
  const client = await self.clients.get(clientId);
  if (!client) return undefined;

  let pending = pendingSessionRequests.get(clientId);
  if (!pending) {
    let resolve: (session?: SessionInfo) => void = () => undefined;
    const promise = new Promise<SessionInfo | undefined>((nextResolve) => {
      resolve = nextResolve;
    });
    pending = { promise, resolve, waiters: 0 };
    pendingSessionRequests.set(clientId, pending);
    client.postMessage({ type: 'requestSession' });
  }

  pending.waiters += 1;
  const session = await Promise.race([
    pending.promise,
    new Promise<undefined>((resolve) => {
      setTimeout(resolve, timeoutMs);
    }),
  ]);
  pending.waiters -= 1;
  if (!session && pending.waiters === 0 && pendingSessionRequests.get(clientId) === pending) {
    pendingSessionRequests.delete(clientId);
  }
  return session;
};

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
  const source = event.source;
  if (!source || !('id' in source) || !('url' in source)) return;
  if (typeof source.id !== 'string' || typeof source.url !== 'string') return;

  try {
    if (new URL(source.url).origin !== self.location.origin) return;
  } catch {
    return;
  }

  const { type, accessToken, baseUrl } = event.data || {};

  if (type === 'setSession') {
    setSession(source.id, accessToken, baseUrl);
    cleanupDeadClients();
  }
});

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

        if (!session) {
          const requestedSession = await requestSession(event.clientId);
          if (requestedSession && validMediaRequest(url, requestedSession.baseUrl)) {
            return fetchAuthenticatedMediaWithFallback(event.request, requestedSession.accessToken);
          }
        }
      }

      return fetch(event.request);
    })()
  );
});
