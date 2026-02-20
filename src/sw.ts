/// <reference lib="WebWorker" />

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

const MEDIA_REQUEST_PATHS = [
  '/_matrix/client/v1/media/download',
  '/_matrix/client/v1/media/thumbnail',
] as const;

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
    const timeoutId = setTimeout(() => {
      self.removeEventListener('message', listener);
      resolve(undefined);
    }, 1500);

    const listener = (messageEvent: ExtendableMessageEvent) => {
      if (messageEvent.data?.responseKey !== responseKey) return;
      clearTimeout(timeoutId);
      self.removeEventListener('message', listener);
      resolve(typeof messageEvent.data?.token === 'string' ? messageEvent.data.token : undefined);
    };

    self.addEventListener('message', listener);
    client.postMessage({ responseKey, type: 'token' });
  });
}

function looksLikeMediaRequest(url: string): boolean {
  return MEDIA_REQUEST_PATHS.some((path) => url.includes(path));
}

function validMediaRequest(url: string, baseUrl: string): boolean {
  const normalizedBaseUrl = baseUrl.replace(/\/+$/, '');
  return MEDIA_REQUEST_PATHS.some((path) => url.startsWith(`${normalizedBaseUrl}${path}`));
}

function fetchConfig(token: string): RequestInit {
  return {
    headers: {
      Authorization: `Bearer ${token}`,
    },
    cache: 'default',
  };
}

self.addEventListener('fetch', (event: FetchEvent) => {
  const { url, method } = event.request;

  if (method !== 'GET') return;
  if (!looksLikeMediaRequest(url)) return;

  event.respondWith(
    (async (): Promise<Response> => {
      if (event.clientId) {
        const session = sessions.get(event.clientId);
        if (session && validMediaRequest(url, session.baseUrl)) {
          return fetch(event.request, fetchConfig(session.accessToken));
        }

        // Fallback for clients still on the older token request/response flow.
        const client = await self.clients.get(event.clientId);
        if (client) {
          const token = await askForAccessToken(client);
          if (token) {
            return fetch(event.request, fetchConfig(token));
          }
        }
      }

      return fetch(event.request);
    })()
  );
});
