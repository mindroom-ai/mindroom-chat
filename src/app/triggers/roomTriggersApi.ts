import type { MatrixClient } from 'matrix-js-sdk';
import { clientSessions } from '../computer/clientSessions';
import { isRecord } from '../lib/isRecord';

export type RoomTrigger = {
  triggerId: string;
  kind: string;
  relation: string;
  description: string;
  prompt: string | null;
  targetRoomId: string | null;
  targetThreadId: string | null;
  threadMode: string | null;
  enabled: boolean;
  disabledReason: string | null;
  lastFiredAt: number | null;
  ownerUserId: string;
  canManage: boolean;
};

const TIMEOUT_MS = 8_000;
const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const triggersPath = (roomId: string, triggerId?: string): string =>
  `/api/rooms/${encodeURIComponent(roomId)}/triggers${triggerId ? `/${encodeURIComponent(triggerId)}` : ''}`;

/** Parses one backend TriggerRow; unknown fields and unknown kind/thread_mode are kept safely. */
export const parseTriggerRow = (raw: unknown): RoomTrigger | null => {
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
    lastFiredAt: asNum(raw.last_fired_at),
    ownerUserId: raw.owner_user_id,
    canManage: raw.can_manage,
  };
};

/** Parses `{ triggers: [...] }`; returns `null` if the envelope is malformed. */
export const parseRoomTriggersResponse = (raw: unknown): RoomTrigger[] | null =>
  isRecord(raw) && Array.isArray(raw.triggers)
    ? raw.triggers.map(parseTriggerRow).filter((row): row is RoomTrigger => row !== null)
    : null;

const send = async (mx: MatrixClient, apiUrl: string, path: string, init: RequestInit = {}) => {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (init.signal?.aborted) controller.abort();
  else init.signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await clientSessions(mx, apiUrl).send(path, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    init.signal?.removeEventListener('abort', onAbort);
  }
};

const httpError = (status: number) =>
  Object.assign(new Error(`Request failed (${status}).`), { status });

/** Returns `null` on 404/401/403/network/timeout/bad payload; rethrows only if `signal` aborted. */
export const fetchRoomTriggers = async (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  signal?: AbortSignal
): Promise<RoomTrigger[] | null> => {
  try {
    const res = await send(mx, apiUrl, triggersPath(roomId), { signal });
    return res.ok ? parseRoomTriggersResponse(await res.json()) : null;
  } catch (error) {
    if (signal?.aborted) throw error;
    return null;
  }
};

export const setRoomTriggerEnabled = async (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  triggerId: string,
  enabled: boolean
): Promise<RoomTrigger | null> => {
  const res = await send(mx, apiUrl, triggersPath(roomId, triggerId), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw httpError(res.status);
  return parseTriggerRow(await res.json().catch(() => undefined));
};

export const deleteRoomTrigger = async (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  triggerId: string
): Promise<void> => {
  const res = await send(mx, apiUrl, triggersPath(roomId, triggerId), { method: 'DELETE' });
  if (!res.ok) throw httpError(res.status);
};
