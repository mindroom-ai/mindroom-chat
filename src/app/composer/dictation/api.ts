import {
  MindroomServerError,
  untilAborted,
  type ClientSessions,
} from '../../computer/clientSessions';

const API_PATH = '/api/dictation/v1';
export const DICTATION_STATUS_CACHE_TTL_MS = 5 * 60 * 1000;
const TRANSIENT_CACHE_TTL_MS = 30 * 1000;

export type DictationStatus = {
  enabled: boolean;
  maxSegmentSeconds: number;
  maxSegmentBytes: number;
};

export type DictationTranscribeResult = {
  text: string;
  seconds: number;
};

export type DictationRefusalCode =
  'forbidden' | 'not-found' | 'invalid' | 'too-many-requests' | 'unavailable' | 'too-large';

export class DictationApiError extends MindroomServerError {
  readonly code?: DictationRefusalCode;

  /** Milliseconds to wait before retrying, parsed from `Retry-After`. */
  readonly retryAfterMs?: number;

  constructor(message: string, status: number, code?: DictationRefusalCode, retryAfterMs?: number) {
    super(message, status);
    this.name = 'DictationApiError';
    this.code = code;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Parses `Retry-After` as delay seconds or an HTTP date into milliseconds from now. */
export const readRetryAfterMs = (value: string | null): number | undefined => {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;
  const date = Date.parse(trimmed);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
};

const refusal = async (response: Response): Promise<DictationApiError> => {
  let message = `Dictation request failed (${response.status}).`;
  let code: DictationRefusalCode | undefined;
  try {
    const body = (await response.json()) as { error?: unknown; detail?: unknown; code?: unknown };
    const text = body.error ?? body.detail;
    if (typeof text === 'string' && text.trim()) message = text.trim().slice(0, 300);
    if (typeof body.code === 'string') code = body.code as DictationRefusalCode;
  } catch {
    // Non-JSON response; HTTP status suffices.
  }
  return new DictationApiError(
    message,
    response.status,
    code,
    readRetryAfterMs(response.headers.get('Retry-After'))
  );
};

/** Client for MindRoom's `/api/dictation/v1` routes via `ClientSessions`. */
export class DictationClient {
  private readonly sessions: ClientSessions;

  constructor(sessions: ClientSessions) {
    this.sessions = sessions;
  }

  private async sendJson<T>(path: string, init: RequestInit): Promise<T> {
    const response = await this.sessions.send(`${API_PATH}${path}`, init);
    if (!response.ok) throw await refusal(response);
    try {
      return (await response.json()) as T;
    } catch {
      throw new DictationApiError('MindRoom answered with something that is not JSON.', 0);
    }
  }

  status(roomId?: string, signal?: AbortSignal): Promise<DictationStatus> {
    const query = roomId ? `?room_id=${encodeURIComponent(roomId)}` : '';
    return this.sendJson<DictationStatus>(`/status${query}`, { method: 'GET', signal });
  }

  transcribe(
    wav: Blob,
    opts: { prompt?: string; roomId?: string } = {},
    signal?: AbortSignal
  ): Promise<DictationTranscribeResult> {
    const query = opts.roomId ? `?room_id=${encodeURIComponent(opts.roomId)}` : '';
    const form = new FormData();
    form.append('audio', wav, 'speech.wav');
    if (opts.prompt) form.append('prompt', opts.prompt);
    return this.sendJson<DictationTranscribeResult>(`/transcribe${query}`, {
      method: 'POST',
      body: form,
      signal,
    });
  }
}

type StatusCacheEntry = {
  value?: boolean;
  expiresAt: number;
  transient?: boolean;
  pending?: Promise<boolean>;
};

const statusCache = new WeakMap<ClientSessions, Map<string, StatusCacheEntry>>();

const getSessionCache = (sessions: ClientSessions): Map<string, StatusCacheEntry> => {
  let map = statusCache.get(sessions);
  if (!map) {
    map = new Map();
    statusCache.set(sessions, map);
  }
  return map;
};

/** Returns a fresh cached availability answer synchronously, or undefined when uncached/expired. */
export const readCachedDictationAvailability = (
  sessions: ClientSessions,
  roomId?: string,
  now = Date.now()
): boolean | undefined => {
  const entry = statusCache.get(sessions)?.get(roomId ?? '');
  if (!entry || entry.value === undefined || entry.expiresAt <= now) return undefined;
  return entry.value;
};

/**
 * Returns the timestamp at which a cached transient status failure becomes stale and eligible for
 * retry, or undefined if no transient failure is recorded.
 */
export const readCachedDictationRetryAt = (
  sessions: ClientSessions,
  roomId?: string
): number | undefined => {
  const entry = statusCache.get(sessions)?.get(roomId ?? '');
  if (!entry?.transient || entry.value !== false) return undefined;
  return entry.expiresAt;
};

/**
 * Probes `/api/dictation/v1/status` with a 5-minute TTL cache deduplicated across mounted
 * main and thread composers. `403`/`404` caches false silently.
 */
export const probeDictationAvailability = (
  sessions: ClientSessions,
  roomId?: string,
  signal?: AbortSignal,
  now = Date.now
): Promise<boolean> => {
  const key = roomId ?? '';
  const map = getSessionCache(sessions);
  const existing = map.get(key);
  const currentTime = now();

  if (existing && existing.value !== undefined && existing.expiresAt > currentTime) {
    return Promise.resolve(existing.value);
  }
  if (existing?.pending) {
    return untilAborted(existing.pending, signal);
  }

  const client = new DictationClient(sessions);
  const pending = client.status(roomId).then(
    (status) => {
      const value = Boolean(status.enabled);
      map.set(key, { value, expiresAt: now() + DICTATION_STATUS_CACHE_TTL_MS, transient: false });
      return value;
    },
    (error: unknown) => {
      const permanent =
        error instanceof MindroomServerError && (error.status === 403 || error.status === 404);
      const ttl = permanent ? DICTATION_STATUS_CACHE_TTL_MS : TRANSIENT_CACHE_TTL_MS;
      map.set(key, { value: false, expiresAt: now() + ttl, transient: !permanent });
      return false;
    }
  );

  map.set(key, { value: existing?.value, expiresAt: existing?.expiresAt ?? 0, pending });
  return untilAborted(pending, signal);
};
