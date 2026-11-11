// The service worker: precaches the app shell and what a signed-in start needs for offline and
// installed starts, keeps the build's other files the first time a page loads them, keeps the
// language catalogs and overlays the pages use, answers app navigations with the shell, and adds
// the access token to authenticated media requests, which an <img> cannot send itself.
//
// Session handshake with the page (src/sw/swSession.ts): the page posts
// `{ type: 'setSession', accessToken, baseUrl }` (an empty token signs the tab out). When a media
// request arrives from a tab with no session, the worker posts `{ type: 'requestSession' }` to
// that tab and waits up to three seconds for the answer.
//
// An upgrade waits until no page of the previous build is left, unless a page posts
// `{ type: 'takeOver' }` (src/app/config/appUpdate.ts, when the person reloads for the new version).
// A worker that replaces another app's worker (the legacy app this origin served before) takes
// over at once instead: that worker never hands its pages over, so they would keep the other app
// through every reload. A new worker tells the two apart by asking the active one
// `{ type: 'identify' }` over a message port; this client's workers answer, the other app's do not.

import {
  cleanupOutdatedCaches,
  PrecacheController,
  PrecacheRoute,
  type PrecacheEntry,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { looksLikeMediaRequest, validMediaRequest } from './swMediaAuth';
import { recallAvatar, rememberAvatar } from './avatarCache';
import { fetchWithDevelopmentCache } from './swDevelopmentCache';
import { fetchBuildAsset, isBuildAssetRequest, keepOnlyBuildFiles } from './swRuntimeAssets';
import {
  fetchLanguageCatalog,
  isLanguageCatalogRequest,
  keepLanguageOverlays,
} from './swLanguageFiles';
import { buildAuthenticatedMediaRequestInit } from './swMediaFetch';
import {
  fetchNavigationWithShellFallback,
  navigationFallbackExcludePathPattern,
  NON_DISRUPTIVE_UPDATE_PARAM,
  readNavigationFallbackExcludePaths,
  RUNTIME_NAVIGATION_PATHS,
} from '../boot/serviceWorkerNavigation';
import { withPageFraming } from './serviceWorkerFraming';
import { precacheFetchPlugin } from './swPrecacheFetch';

// The DOM library has no service worker scope types; these are the parts this worker uses.
type WorkerClient = { id: string; url: string; postMessage: (message: unknown) => void };
type ExtendableEventLike = Event & { waitUntil: (promise: Promise<unknown>) => void };
type FetchEventLike = ExtendableEventLike & {
  clientId: string;
  request: Request;
  respondWith: (response: Promise<Response>) => void;
};
type MessageEventLike = {
  data: unknown;
  ports?: readonly MessagePort[];
  source?: { id?: string; url?: string } | null;
};
type WorkerLike = { postMessage: (message: unknown, transfer: Transferable[]) => void };
/** What the build wrote into the worker (scripts/precache-plan.mjs); absent in development. */
type BuildInventory = { files: string[]; localeOverlays: Record<string, string> };
type ServiceWorkerScope = {
  __WB_MANIFEST: Array<PrecacheEntry | string>;
  __MINDROOM_BUILD_INVENTORY?: BuildInventory;
  location: { href: string; origin: string };
  registration: { active: WorkerLike | null; unregister: () => Promise<boolean> };
  clients: {
    claim: () => Promise<void>;
    get: (id: string) => Promise<WorkerClient | undefined>;
  };
  skipWaiting: () => Promise<void>;
  addEventListener(
    type: 'install' | 'activate',
    listener: (event: ExtendableEventLike) => void
  ): void;
  addEventListener(type: 'fetch', listener: (event: FetchEventLike) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
};

declare const self: ServiceWorkerScope;

const precacheManifest = self.__WB_MANIFEST;
const buildInventory = self.__MINDROOM_BUILD_INVENTORY;
const precacheController = new PrecacheController({ plugins: [precacheFetchPlugin] });
precacheController.addToCacheList(precacheManifest);
cleanupOutdatedCaches();

// Registrations made by a current page carry this marker. Without it the registration belongs
// to an older page that reloads when a new worker activates, so the worker retires it instead.
const supportsNonDisruptiveUpdates = (() => {
  try {
    return new URL(self.location.href).searchParams.get(NON_DISRUPTIVE_UPDATE_PARAM) === '1';
  } catch {
    return false;
  }
})();

/** What this client's workers answer `{ type: 'identify' }` with. */
const WORKER_IDENTITY = { app: 'mindroom-client' };
/** How long an installing worker waits for the active one to say it is this client's. */
const IDENTIFY_TIMEOUT_MS = 5_000;

/** Whether `worker` is this client's: it answers `identify` in time. */
const isThisClientsWorker = (worker: WorkerLike): Promise<boolean> =>
  new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = (ours: boolean) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(ours);
    };
    const timer = setTimeout(() => finish(false), IDENTIFY_TIMEOUT_MS);
    channel.port1.onmessage = ({ data }: MessageEvent<unknown>) => {
      const { app } = (data ?? {}) as { app?: unknown };
      finish(app === WORKER_IDENTITY.app);
    };
    try {
      worker.postMessage({ type: 'identify' }, [channel.port2]);
    } catch {
      finish(false);
    }
  });

self.addEventListener('install', (event) => {
  const { active } = self.registration;
  if (active && !supportsNonDisruptiveUpdates) {
    // Queue the unregister but do not wait for it: it only completes after this install ends.
    void self.registration.unregister().catch(() => false);
    event.waitUntil(Promise.resolve());
    return;
  }
  event.waitUntil(
    (async () => {
      const [, upgradesThisClient] = await Promise.all([
        precacheController.install(event as never),
        active ? isThisClientsWorker(active) : false,
      ]);
      // This build's overlay for each language the pages used, for the first offline start.
      await keepLanguageOverlays(buildInventory?.localeOverlays, self.location.href);
      // A first install takes over at once, and so does one that replaces another app's worker; an
      // upgrade of this client's worker waits until no page uses the old one.
      if (!upgradesThisClient) await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      await precacheController.activate(event as never);
      // Files the previous build kept at runtime stay when this build still has them.
      await keepOnlyBuildFiles(buildInventory?.files, self.location.href);
      await self.clients.claim();
    })()
  );
});

// What the homeserver and the MindRoom runtime answer beside the app, also under a path prefix.
const backendPaths = [
  /^\/api(?:\/|$)/,
  /^\/(?:[^/]+\/)?_matrix(?:\/|$)/,
  /^\/(?:[^/]+\/)?_synapse(?:\/|$)/,
  /^\/(?:[^/]+\/)?\.well-known(?:\/|$)/,
];

// Paths the app shell must never answer: the backends and static documents under public/.
const navigationFallbackDenylist = [
  ...backendPaths,
  /^\/(?:[^/]+\/)?public(?:\/|\?|$)/,
  // The PDF viewer's frame page (public/pdf-frame.html).
  /^\/(?:[^/]+\/)?pdf-frame\.html(?:\?|$)/,
  ...RUNTIME_NAVIGATION_PATHS.map(navigationFallbackExcludePathPattern),
  ...readNavigationFallbackExcludePaths(self.location.href).map(
    navigationFallbackExcludePathPattern
  ),
];

const precachesAppShell = precacheManifest.some(
  (entry) => (typeof entry === 'string' ? entry : entry.url) === 'index.html'
);

// Navigation is registered first so app routes get the shell; the shell lookup stays cache-only
// so a miss falls through to the original network navigation. The shell carries index.html's
// framing headers, so the pairing page gets its own back.
if (precachesAppShell) {
  registerRoute(
    new NavigationRoute(
      ({ request }) =>
        fetchNavigationWithShellFallback(request, () =>
          precacheController.matchPrecache('index.html')
        ).then((response) => withPageFraming(request.url, response)),
      { denylist: navigationFallbackDenylist }
    )
  );
}
// The development worker precaches nothing; it keeps what it serves for offline starts instead:
// app pages (not the paths the shell never answers) and every file but the backends' answers.
if (!precachesAppShell) {
  registerRoute(
    ({ request, url }) =>
      request.method === 'GET' &&
      url.origin === self.location.origin &&
      !(request.mode === 'navigate' ? navigationFallbackDenylist : backendPaths).some((pattern) =>
        pattern.test(url.pathname)
      ),
    ({ event }) => fetchWithDevelopmentCache(event as unknown as FetchEventLike, self.location.href)
  );
}
registerRoute(new PrecacheRoute(precacheController));
// A build precaches only what a signed-in start needs; its other files are kept on first use.
if (precachesAppShell) {
  registerRoute(
    ({ request }) => isBuildAssetRequest(request, self.location.href),
    ({ event }) => fetchBuildAsset(event as unknown as FetchEventLike)
  );
  registerRoute(
    ({ request }) => isLanguageCatalogRequest(request, self.location.href),
    ({ event }) => fetchLanguageCatalog(event as unknown as FetchEventLike)
  );
}

type MediaSession = { accessToken: string; baseUrl: string };

const SESSION_REQUEST_TIMEOUT_MS = 3_000;
const sessions = new Map<string, MediaSession>();
const pendingSessionRequests = new Map<string, Set<(session?: MediaSession) => void>>();

const isUsableSession = (value: Record<string, unknown>): value is MediaSession => {
  if (typeof value.accessToken !== 'string' || value.accessToken === '') return false;
  if (typeof value.baseUrl !== 'string') return false;
  try {
    return /^https?:$/.test(new URL(value.baseUrl).protocol);
  } catch {
    return false;
  }
};

const isSameOriginSource = (source: MessageEventLike['source']): boolean => {
  if (!source?.url) return false;
  try {
    return new URL(source.url).origin === self.location.origin;
  } catch {
    return false;
  }
};

const resolvePendingSession = (clientId: string, session?: MediaSession): void => {
  const waiters = pendingSessionRequests.get(clientId);
  pendingSessionRequests.delete(clientId);
  waiters?.forEach((resolve) => resolve(session));
};

self.addEventListener('message', (event) => {
  const { data, ports, source } = event;
  if (!data || typeof data !== 'object') return;
  // A new worker of this origin, while it installs, asks whether this one is this client's.
  if ((data as Record<string, unknown>).type === 'identify') {
    ports?.[0]?.postMessage(WORKER_IDENTITY);
    return;
  }
  if (!source?.id || !isSameOriginSource(source)) return;
  const message = data as Record<string, unknown>;
  // A waiting worker takes over now; its activation then claims every open page.
  if (message.type === 'takeOver') {
    void self.skipWaiting();
    return;
  }
  // A page loaded past the worker (a hard reload) stays without one until the worker claims it.
  if (message.type === 'claim') {
    self.clients.claim().catch(() => undefined);
    return;
  }
  if (message.type !== 'setSession') return;

  if (isUsableSession(message)) {
    const session = { accessToken: message.accessToken, baseUrl: message.baseUrl };
    sessions.set(source.id, session);
    resolvePendingSession(source.id, session);
  } else {
    sessions.delete(source.id);
    resolvePendingSession(source.id, undefined);
  }
});

/** Asks the tab for its session; concurrent requests from one tab share one question. */
const requestSession = (clientId: string): Promise<MediaSession | undefined> =>
  new Promise((resolve) => {
    let waiters = pendingSessionRequests.get(clientId);
    const isFirst = !waiters;
    if (!waiters) {
      waiters = new Set();
      pendingSessionRequests.set(clientId, waiters);
    }
    const currentWaiters = waiters;
    const timer = setTimeout(() => {
      currentWaiters.delete(waiter);
      if (currentWaiters.size === 0 && pendingSessionRequests.get(clientId) === currentWaiters) {
        pendingSessionRequests.delete(clientId);
      }
      resolve(undefined);
    }, SESSION_REQUEST_TIMEOUT_MS);
    const waiter = (session?: MediaSession) => {
      clearTimeout(timer);
      resolve(session);
    };
    currentWaiters.add(waiter);

    if (isFirst) {
      void self.clients
        .get(clientId)
        .then((client) => client?.postMessage({ type: 'requestSession' }))
        .catch(() => undefined);
    }
  });

const fetchMedia = async (clientId: string, request: Request): Promise<Response> => {
  const session = sessions.get(clientId) ?? (clientId ? await requestSession(clientId) : undefined);
  // An avatar loaded is kept for offline starts, and a kept one answers when the network fails,
  // also before an offline page has told the worker its session.
  try {
    if (session && validMediaRequest(request.url, session.baseUrl)) {
      const response = await fetch(
        request,
        buildAuthenticatedMediaRequestInit(request, session.accessToken)
      );
      if (response.ok) void rememberAvatar(request.url, response.clone());
      return response;
    }
    return await fetch(request);
  } catch (error) {
    const kept = await recallAvatar(request.url);
    if (kept) return kept;
    throw error;
  }
};

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !looksLikeMediaRequest(request.url)) return;
  event.respondWith(fetchMedia(event.clientId, request));
});
