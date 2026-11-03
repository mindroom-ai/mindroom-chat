// The page's side of the session handshake with the service worker (src/sw.ts). The worker
// adds the access token to authenticated media requests, which an <img> cannot send itself, so
// the page tells it the active session: `{ type: 'setSession', accessToken, baseUrl }`. An empty
// token signs the tab out. The worker asks with `{ type: 'requestSession' }` when a media request
// arrives from a tab it has no session for.

type SessionMessage = { type: 'setSession'; accessToken: string; baseUrl: string };

const getServiceWorker = (): ServiceWorkerContainer | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.serviceWorker ?? undefined;

/** Tells the controlling service worker this tab's session; a no-op without a controller. */
export const pushSessionToSW = (baseUrl?: string, accessToken?: string): void => {
  const controller = getServiceWorker()?.controller;
  if (!controller) return;
  const message: SessionMessage = {
    type: 'setSession',
    accessToken: accessToken ?? '',
    baseUrl: baseUrl ?? '',
  };
  controller.postMessage(message);
};

/**
 * Resolves true once a service worker controls the page, or false after `timeoutMs`. A page
 * loaded before its worker activated has no controller until `controllerchange`.
 */
export const waitForServiceWorkerControl = (timeoutMs = 3000): Promise<boolean> => {
  const serviceWorker = getServiceWorker();
  if (!serviceWorker) return Promise.resolve(false);
  if (serviceWorker.controller) return Promise.resolve(true);

  return new Promise((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (controlled: boolean) => {
      if (timer !== undefined) clearTimeout(timer);
      serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      resolve(controlled);
    };
    function handleControllerChange() {
      finish(true);
    }
    serviceWorker.addEventListener('controllerchange', handleControllerChange);
    timer = setTimeout(() => finish(!!serviceWorker.controller), timeoutMs);
  });
};

/**
 * Answers the worker's `requestSession` questions with the session `getSession` returns now.
 * Returns a function that stops answering.
 */
export const answerServiceWorkerSessionRequests = (
  getSession: () => { baseUrl: string; accessToken: string } | undefined
): (() => void) => {
  const serviceWorker = getServiceWorker();
  if (!serviceWorker) return () => undefined;
  const handleMessage = (event: MessageEvent) => {
    const data = event.data as { type?: unknown } | null;
    if (!data || data.type !== 'requestSession') return;
    const session = getSession();
    pushSessionToSW(session?.baseUrl, session?.accessToken);
  };
  serviceWorker.addEventListener('message', handleMessage);
  return () => serviceWorker.removeEventListener('message', handleMessage);
};
