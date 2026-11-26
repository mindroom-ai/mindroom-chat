import { useEffect, useMemo, useState } from 'react';
import { isRecord } from '../../lib/isRecord';
import {
  getSafeLocalStorage,
  getStorageItemSafe,
  setStorageItemSafe,
} from '../../lib/safeLocalStorage';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { dictationAvailabilityStorageKey } from '../../preferences/accountStorageKeys';
import { clientSessions, type ClientSessions } from '../../computer/clientSessions';
import { useComputerApiUrls } from '../../computer/useComputerApiUrl';
import { useRoomMindroomServer } from '../../computer/useRoomMindroomServer';
import {
  expireTransientDictationCache,
  probeDictationAvailability,
  readCachedDictationAvailability,
  readCachedDictationRetryAt,
} from './api';

export type DictationServerInfo = {
  available: boolean;
  confirmed: boolean;
  temporarilyUnavailable: boolean;
  apiUrl: string | undefined;
  roomId: string | undefined;
  sessions: ClientSessions | undefined;
};

/**
 * Dictation requires browser microphone capture plus Web Audio AudioWorklet.
 * On runtimes where `navigator.mediaDevices` or AudioWorklet is unavailable this returns false so
 * Dictate stays hidden.
 */
export const isDictationSupported = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function' &&
  (typeof AudioContext !== 'undefined' ||
    typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined') &&
  typeof AudioWorkletNode !== 'undefined';

const MAX_PERSISTED_ROOMS = 128;

const readPersistedAvailabilityMap = (userId: string): Map<string, boolean> => {
  const raw = getStorageItemSafe(getSafeLocalStorage(), dictationAvailabilityStorageKey(userId));
  if (!raw) return new Map();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return new Map();
    const entries = new Map<string, boolean>();
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === 'boolean') entries.set(key, value);
    }
    return entries;
  } catch {
    return new Map();
  }
};

const readPersistedDictationAvailability = (userId: string, roomId?: string): boolean | undefined =>
  readPersistedAvailabilityMap(userId).get(roomId ?? '');

const writePersistedDictationAvailability = (
  userId: string,
  roomId: string | undefined,
  value: boolean
): void => {
  const entries = readPersistedAvailabilityMap(userId);
  const roomKey = roomId ?? '';
  if (entries.get(roomKey) === value && entries.size <= MAX_PERSISTED_ROOMS) return;
  entries.delete(roomKey);
  entries.set(roomKey, value);
  while (entries.size > MAX_PERSISTED_ROOMS) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
  setStorageItemSafe(
    getSafeLocalStorage(),
    dictationAvailabilityStorageKey(userId),
    JSON.stringify(Object.fromEntries(entries))
  );
};

/**
 * Resolves the MindRoom server for dictation and probes `/api/dictation/v1/status` using the
 * shared TTL cache:
 * - Follows the same server discovery model as `CallTranscription` (`useRoomMindroomServer`) and
 *   `ComputerSettings` (`useComputerApiUrls`): waits until `useRoomMindroomServer` settles
 *   (`!pending`), prefers the room's MindRoom server when available, and otherwise falls back to
 *   `useComputerApiUrls().urls[0]` (for human DMs or when `roomId` is omitted).
 * - Preserves `trustedServerOrigins` allowlist filtering whenever `mindroom.computers.apiUrl` or
 *   `mindroom.computers.trustedApiUrls` is set, requires OpenID token binding
 *   (`useOpenIdBinding() === true`) for discovered servers, respects explicit user disable
 *   (`preference === ''`) for the non-room fallback, and allows automatic server discovery on
 *   multi-tenant deployments that leave both deployment fields unset.
 * - After a transient 503/network status failure, keeps the mic button visible and disabled
 *   (`temporarilyUnavailable: true`) when this room previously had dictation persisted, and
 *   automatically retries with bounded exponential backoff (30 s -> 60 s -> 120 s -> 240 s -> 5 min),
 *   paused while hidden and resuming on `visibilitychange`, `focus`, and `online`.
 */
export const useDictationServer = (roomId?: string): DictationServerInfo => {
  const mx = useMatrixClient();
  const userId = mx.getUserId() || undefined;
  const supported = isDictationSupported();
  const roomServer = useRoomMindroomServer(mx, roomId ?? '');
  const computerUrls = useComputerApiUrls();
  const apiUrl =
    supported && !roomServer.pending ? (roomServer.apiUrl ?? computerUrls.urls[0]) : undefined;

  const sessions = useMemo(() => (apiUrl ? clientSessions(mx, apiUrl) : undefined), [apiUrl, mx]);
  const [retryTick, setRetryTick] = useState(0);

  const cached = sessions ? readCachedDictationAvailability(sessions, roomId) : undefined;
  const [probed, setProbed] = useState<
    | { sessions: ClientSessions; roomId: string | undefined; value: boolean; transient: boolean }
    | undefined
  >(undefined);

  useEffect(() => {
    if (!sessions || !apiUrl) {
      if (
        supported &&
        userId &&
        !roomServer.pending &&
        readPersistedDictationAvailability(userId, roomId) === true
      ) {
        writePersistedDictationAvailability(userId, roomId, false);
      }
      return undefined;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let removeListeners: (() => void) | undefined;

    const clearRetryTimer = () => {
      if (retryTimer !== undefined) {
        clearTimeout(retryTimer);
        retryTimer = undefined;
      }
    };

    const cleanup = () => {
      cancelled = true;
      clearRetryTimer();
      removeListeners?.();
      removeListeners = undefined;
    };

    const isVisible = () =>
      typeof document === 'undefined' || document.visibilityState !== 'hidden';

    const attachTransientRecovery = () => {
      if (readCachedDictationRetryAt(sessions, roomId) === undefined) return;

      const triggerRetry = () => {
        if (cancelled) return;
        cleanup();
        setRetryTick((tick) => tick + 1);
      };

      const armTimer = () => {
        clearRetryTimer();
        if (cancelled || !isVisible()) return;
        const retryAt = readCachedDictationRetryAt(sessions, roomId);
        if (retryAt === undefined) return;
        retryTimer = setTimeout(triggerRetry, Math.max(0, retryAt - Date.now()));
      };

      armTimer();

      const cleanups: Array<() => void> = [];
      if (typeof document !== 'undefined' && typeof document.addEventListener === 'function') {
        const onVisibilityChange = () => {
          if (cancelled) return;
          if (!isVisible()) {
            clearRetryTimer();
            return;
          }
          const retryAt = readCachedDictationRetryAt(sessions, roomId);
          if (retryAt === undefined || Date.now() >= retryAt) triggerRetry();
          else armTimer();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        cleanups.push(() => document.removeEventListener('visibilitychange', onVisibilityChange));
      }

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        const onFocus = () => {
          if (cancelled || !isVisible()) return;
          const retryAt = readCachedDictationRetryAt(sessions, roomId);
          if (retryAt === undefined || Date.now() >= retryAt) triggerRetry();
        };
        const onOnline = () => {
          if (cancelled) return;
          expireTransientDictationCache(sessions, roomId);
          if (isVisible()) triggerRetry();
        };
        window.addEventListener('focus', onFocus);
        window.addEventListener('online', onOnline);
        cleanups.push(() => {
          window.removeEventListener('focus', onFocus);
          window.removeEventListener('online', onOnline);
        });
      }

      removeListeners = () => {
        cleanups.forEach((fn) => fn());
      };
    };

    const applyResult = (value: boolean) => {
      const transient = !value && readCachedDictationRetryAt(sessions, roomId) !== undefined;
      setProbed({ sessions, roomId, value, transient });
      if (userId && !transient) writePersistedDictationAvailability(userId, roomId, value);
      if (!value) attachTransientRecovery();
    };

    const hit = readCachedDictationAvailability(sessions, roomId);
    if (hit !== undefined) {
      applyResult(hit);
      return cleanup;
    }

    const controller = new AbortController();
    void probeDictationAvailability(sessions, roomId, controller.signal).then(
      (value) => {
        if (cancelled || controller.signal.aborted) return;
        applyResult(value);
      },
      () => undefined
    );
    return () => {
      controller.abort();
      cleanup();
    };
  }, [apiUrl, retryTick, roomId, roomServer.pending, sessions, supported, userId]);

  const persistedTrue = userId ? readPersistedDictationAvailability(userId, roomId) === true : false;
  const matchedProbed =
    probed !== undefined && probed.sessions === sessions && probed.roomId === roomId
      ? probed
      : undefined;
  const settled =
    sessions !== undefined
      ? (cached ?? matchedProbed?.value)
      : roomServer.pending
        ? undefined
        : false;
  const cachedTransient =
    sessions !== undefined && readCachedDictationRetryAt(sessions, roomId) !== undefined;
  const isTransient =
    cached !== undefined ? cachedTransient : cachedTransient || Boolean(matchedProbed?.transient);
  const temporarilyUnavailable =
    supported && sessions !== undefined && settled === false && isTransient && persistedTrue;
  const confirmed = supported && sessions !== undefined && settled === true;
  const available = temporarilyUnavailable || (supported && (settled ?? persistedTrue));

  return { available, confirmed, temporarilyUnavailable, apiUrl, roomId, sessions };
};
