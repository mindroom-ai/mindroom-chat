import { useSyncExternalStore } from 'react';
import type { MatrixClient } from 'matrix-js-sdk';

/**
 * How long past its long-poll timeout a /sync request may stay unanswered before the connection
 * counts as lost. The homeserver answers a long poll by its timeout even when nothing happened,
 * so a request this late is stuck on the way.
 */
export const SYNC_STALL_MARGIN_MS = 20_000;

export type SyncStallWatch = {
  fetchFn: typeof globalThis.fetch;
  isStalled: () => boolean;
  subscribe: (listener: () => void) => () => void;
};

const watchByClient = new WeakMap<MatrixClient, SyncStallWatch>();

// A hidden page may be frozen with its requests, so a wait pauses while the page is hidden and
// starts again in full when it is shown.
const waitsToRestart = new Set<() => void>();
let watchingVisibility = false;

const watchVisibility = (): void => {
  if (watchingVisibility || typeof document === 'undefined') return;
  watchingVisibility = true;
  document.addEventListener('visibilitychange', () => {
    waitsToRestart.forEach((restart) => restart());
  });
};

const isPageHidden = (): boolean =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

const requestUrl = (input: Parameters<typeof fetch>[0]): URL | undefined => {
  try {
    if (input instanceof URL) return input;
    if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url);
    return new URL(String(input));
  } catch {
    return undefined;
  }
};

/** The long-poll timeout of a /sync request, in milliseconds; undefined for other requests. */
const syncTimeoutOf = (
  input: Parameters<typeof fetch>[0],
  init?: RequestInit
): number | undefined => {
  const fromRequest = typeof Request !== 'undefined' && input instanceof Request;
  const method = init?.method ?? (fromRequest ? input.method : 'GET');
  if (method.toUpperCase() !== 'GET') return undefined;
  const url = requestUrl(input);
  if (!url || !/\/_matrix\/client\/[^/]+\/sync$/.test(url.pathname)) return undefined;
  const timeout = Number(url.searchParams.get('timeout') ?? 0);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : 0;
};

/**
 * Notices /sync requests that get no answer. A network that drops packets without resetting
 * the connection (a stalled mobile link, a captive network) fails nothing, so neither the SDK nor
 * the homeserver check (homeserverReachability.ts) sees it: the SDK gives up on such a request
 * only 80 s after its timeout and reports an error after three of them. Here a /sync request
 * still unanswered `SYNC_STALL_MARGIN_MS` after its long-poll timeout makes the sync stalled, and
 * the next successful /sync answer ends that.
 */
export const createSyncStallWatch = (baseFetch: typeof globalThis.fetch): SyncStallWatch => {
  watchVisibility();
  const listeners = new Set<() => void>();
  let stalled = false;

  const setStalled = (next: boolean) => {
    if (stalled === next) return;
    stalled = next;
    listeners.forEach((listener) => listener());
  };

  const fetchFn: typeof globalThis.fetch = async (input, init) => {
    const timeout = syncTimeoutOf(input, init);
    if (timeout === undefined) return baseFetch(input, init);

    let timer: ReturnType<typeof setTimeout> | undefined;
    const restartWait = () => {
      clearTimeout(timer);
      timer = isPageHidden()
        ? undefined
        : setTimeout(() => setStalled(true), timeout + SYNC_STALL_MARGIN_MS);
    };
    waitsToRestart.add(restartWait);
    restartWait();
    try {
      const response = await baseFetch(input, init);
      if (response.ok) setStalled(false);
      return response;
    } finally {
      clearTimeout(timer);
      waitsToRestart.delete(restartWait);
    }
  };

  return {
    fetchFn,
    isStalled: () => stalled,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

export const bindSyncStallWatch = (mx: MatrixClient, watch: SyncStallWatch): void => {
  watchByClient.set(mx, watch);
};

const subscribeNever = () => () => undefined;
const neverStalled = () => false;

/** Whether the client's /sync requests stopped getting answers (see `createSyncStallWatch`). */
export const useSyncStalled = (mx: MatrixClient): boolean => {
  const watch = watchByClient.get(mx);
  return useSyncExternalStore(watch?.subscribe ?? subscribeNever, watch?.isStalled ?? neverStalled);
};
