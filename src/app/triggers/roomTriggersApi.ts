import type { MatrixClient } from 'matrix-js-sdk';
import { clientSessions } from '../computer/clientSessions';
import { isRecord } from '../lib/isRecord';

const GET_TIMEOUT_MS = 8_000;
const MUTATION_TIMEOUT_MS = 30_000;
const MAX_TIMESTAMP_MS = 8.64e15;

const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asTimestamp = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= MAX_TIMESTAMP_MS ? v : null;
const triggersPath = (roomId: string, triggerId?: string): string =>
  `/api/rooms/${encodeURIComponent(roomId)}/triggers${triggerId ? `/${encodeURIComponent(triggerId)}` : ''}`;

/** Parses one backend TriggerRow; unknown fields and unknown kind/thread_mode are kept safely. */
const parseTriggerRow = (raw: unknown) => {
  if (
    !isRecord(raw) ||
    typeof raw.trigger_id !== 'string' ||
    !raw.trigger_id.trim() ||
    typeof raw.kind !== 'string' ||
    !raw.kind.trim() ||
    typeof raw.relation !== 'string' ||
    typeof raw.description !== 'string' ||
    typeof raw.owner_user_id !== 'string' ||
    typeof raw.enabled !== 'boolean' ||
    typeof raw.can_manage !== 'boolean'
  ) {
    return null;
  }
  return {
    triggerId: raw.trigger_id,
    kind: raw.kind,
    relation: raw.relation,
    description: raw.description,
    prompt: asStr(raw.prompt),
    targetRoomId: asStr(raw.target_room_id),
    targetThreadId: asStr(raw.target_thread_id),
    threadMode: asStr(raw.thread_mode),
    enabled: raw.enabled,
    disabledReason: asStr(raw.disabled_reason)?.trim() || null,
    lastFiredAt: asTimestamp(raw.last_fired_at),
    ownerUserId: raw.owner_user_id,
    canManage: raw.can_manage,
  };
};

export type RoomTrigger = NonNullable<ReturnType<typeof parseTriggerRow>>;

/** Parses `{ triggers: [...] }`; returns `null` if the envelope is malformed. */
export const parseRoomTriggersResponse = (raw: unknown): RoomTrigger[] | null =>
  isRecord(raw) && Array.isArray(raw.triggers)
    ? raw.triggers.map(parseTriggerRow).filter((row): row is RoomTrigger => row !== null)
    : null;

const send = async <T>(
  mx: MatrixClient,
  apiUrl: string,
  path: string,
  timeoutMs: number,
  init: RequestInit,
  onResponse: (res: Response) => Promise<T> | T
): Promise<T> => {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await clientSessions(mx, apiUrl).send(path, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    });
    return await onResponse(res);
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onAbort);
  }
};

/** Returns `null` on non-OK HTTP or malformed envelope; throws on network/timeout/abort. */
export const fetchRoomTriggers = (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  signal?: AbortSignal
): Promise<RoomTrigger[] | null> =>
  send(mx, apiUrl, triggersPath(roomId), GET_TIMEOUT_MS, { signal }, async (res) =>
    res.ok ? parseRoomTriggersResponse(await res.json()) : null
  );

const mutateTrigger = (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  triggerId: string,
  init: RequestInit
): Promise<void> =>
  send(mx, apiUrl, triggersPath(roomId, triggerId), MUTATION_TIMEOUT_MS, init, (res) => {
    if (!res.ok) throw new Error(`Request failed (${res.status}).`);
  });

export const setRoomTriggerEnabled = (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  triggerId: string,
  enabled: boolean
): Promise<void> =>
  mutateTrigger(mx, apiUrl, roomId, triggerId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });

export const deleteRoomTrigger = (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  triggerId: string
): Promise<void> => mutateTrigger(mx, apiUrl, roomId, triggerId, { method: 'DELETE' });
