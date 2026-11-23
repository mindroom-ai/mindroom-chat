import { useEffect, useMemo, useRef, useState } from 'react';
import { useAtomValue } from 'jotai';
import { useClientConfig } from '../../config/useClientConfig';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { trustedServerOrigins } from '../../computer/agentServer';
import { resolveComputerApiUrl } from '../../computer/api';
import { clientSessions, type ClientSessions } from '../../computer/clientSessions';
import {
  computerServicePreferenceAtom,
  resolveComputerServiceUrl,
} from '../../computer/computerServiceSettings';
import { useAgentServerUrls } from '../../computer/useAgentServers';
import { useRoomMindroomServer } from '../../computer/useRoomMindroomServer';
import {
  probeDictationAvailability,
  readCachedDictationAvailability,
  readCachedDictationRetryAt,
} from './api';

export type DictationServerInfo = {
  available: boolean;
  apiUrl: string | undefined;
  roomId: string | undefined;
  sessions: ClientSessions | undefined;
};

/**
 * Dictation requires browser microphone capture plus Web Audio AudioWorklet.
 * On Mac Catalyst (where `navigator.mediaDevices` is undefined) or older runtimes this returns
 * false so Dictate stays hidden and native voice messages remain untouched.
 */
export const isDictationSupported = (): boolean =>
  typeof navigator !== 'undefined' &&
  typeof navigator.mediaDevices?.getUserMedia === 'function' &&
  (typeof AudioContext !== 'undefined' ||
    typeof (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext !== 'undefined') &&
  typeof AudioWorkletNode !== 'undefined';

/**
 * Resolves the MindRoom server for dictation and probes `/api/dictation/v1/status` using the
 * shared TTL cache:
 * - Waits until `useRoomMindroomServer` settles (`!pending`) before choosing a fallback.
 * - Only uses origins explicitly trusted via the deployment `mindroom.computers.apiUrl`,
 *   `mindroom.computers.trustedApiUrls`, or the user's personal server setting (for both
 *   room-advertised servers and non-room fallbacks). Never sends microphone audio to an unchecked
 *   advertised origin.
 * - After a transient 503/network status failure (30 s TTL), schedules a one-shot retry after the
 *   TTL and also retries on window `online`/`focus` once stale.
 */
export const useDictationServer = (roomId?: string): DictationServerInfo => {
  const mx = useMatrixClient();
  const supported = isDictationSupported();
  const roomServer = useRoomMindroomServer(mx, roomId ?? '');
  const { computers } = useClientConfig().mindroom ?? {};
  const preference = useAtomValue(computerServicePreferenceAtom);
  const discoveredUrls = useAgentServerUrls();
  const configured = resolveComputerApiUrl(computers?.apiUrl);
  const personal = preference ? resolveComputerApiUrl(preference) : undefined;
  const trusted = useMemo(() => trustedServerOrigins(computers), [computers]);
  const isTrustedOrigin = (url: string): boolean =>
    url === personal || url === configured || Boolean(trusted?.has(url));

  let apiUrl: string | undefined;
  if (supported && !roomServer.pending) {
    if (roomServer.apiUrl && isTrustedOrigin(roomServer.apiUrl)) {
      apiUrl = roomServer.apiUrl;
    } else {
      const explicit = resolveComputerServiceUrl(preference, configured);
      apiUrl =
        explicit ??
        (preference === null && trusted
          ? discoveredUrls.find((url) => isTrustedOrigin(url))
          : undefined);
    }
  }

  const sessions = useMemo(() => (apiUrl ? clientSessions(mx, apiUrl) : undefined), [apiUrl, mx]);
  const [retryTick, setRetryTick] = useState(0);
  const autoRetriedKeyRef = useRef<string | undefined>(undefined);

  const cached = sessions ? readCachedDictationAvailability(sessions, roomId) : false;
  const [probed, setProbed] = useState<{
    sessions: ClientSessions | undefined;
    roomId: string | undefined;
    value: boolean;
  }>(() => ({ sessions, roomId, value: cached ?? false }));

  useEffect(() => {
    if (!sessions || !apiUrl) return undefined;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let removeListeners: (() => void) | undefined;
    const streakKey = `${apiUrl}|${roomId ?? ''}`;

    const attachTransientRecovery = () => {
      const retryAt = readCachedDictationRetryAt(sessions, roomId);
      if (retryAt === undefined) return;

      if (autoRetriedKeyRef.current !== streakKey) {
        const delay = Math.max(0, retryAt - Date.now());
        retryTimer = setTimeout(() => {
          if (cancelled) return;
          autoRetriedKeyRef.current = streakKey;
          setRetryTick((tick) => tick + 1);
        }, delay);
      }

      if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        const onRecover = () => {
          if (cancelled) return;
          if (Date.now() >= retryAt) setRetryTick((tick) => tick + 1);
        };
        window.addEventListener('online', onRecover);
        window.addEventListener('focus', onRecover);
        removeListeners = () => {
          window.removeEventListener('online', onRecover);
          window.removeEventListener('focus', onRecover);
        };
      }
    };

    const cleanup = () => {
      cancelled = true;
      if (retryTimer !== undefined) clearTimeout(retryTimer);
      removeListeners?.();
    };

    const hit = readCachedDictationAvailability(sessions, roomId);
    if (hit !== undefined) {
      setProbed({ sessions, roomId, value: hit });
      if (hit) autoRetriedKeyRef.current = undefined;
      else attachTransientRecovery();
      return cleanup;
    }

    const controller = new AbortController();
    void probeDictationAvailability(sessions, roomId, controller.signal).then(
      (value) => {
        if (cancelled || controller.signal.aborted) return;
        setProbed({ sessions, roomId, value });
        if (value) autoRetriedKeyRef.current = undefined;
        else attachTransientRecovery();
      },
      () => undefined
    );
    return () => {
      controller.abort();
      cleanup();
    };
  }, [apiUrl, retryTick, roomId, sessions]);

  const available =
    supported &&
    sessions !== undefined &&
    (cached ?? (probed.sessions === sessions && probed.roomId === roomId ? probed.value : false));

  return { available, apiUrl, roomId, sessions };
};
