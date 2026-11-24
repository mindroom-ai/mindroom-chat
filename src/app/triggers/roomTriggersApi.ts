import type { MatrixClient } from 'matrix-js-sdk';
import { clientSessions } from '../computer/clientSessions';

const KINDS = ['webhook', 'room_message', 'thread_tag', 'external_event'] as const;
const RELATIONS = ['target', 'watch'] as const;
const THREAD_MODES = ['room', 'thread', 'new_thread', 'origin'] as const;

export type TriggerKind = (typeof KINDS)[number];
export type TriggerThreadMode = (typeof THREAD_MODES)[number];
export type RoomTrigger = {
  triggerId: string;
  kind: TriggerKind;
  relation: (typeof RELATIONS)[number];
  description: string;
  prompt: string | null;
  targetRoomId: string | null;
  targetThreadId: string | null;
  threadMode: TriggerThreadMode;
  enabled: boolean;
  disabledReason: string | null;
  lastFiredAt: number | null;
  ownerUserId: string;
  canManage: boolean;
};

const TIMEOUT_MS = 8_000;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isOneOf = <T extends string>(v: unknown, list: readonly T[]): v is T =>
  typeof v === 'string' && list.some((item) => item === v);
const asStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const asNum = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const triggersPath = (roomId: string, triggerId?: string): string =>
  `/api/rooms/${encodeURIComponent(roomId)}/triggers${triggerId ? `/${encodeURIComponent(triggerId)}` : ''}`;

/** Parses one backend TriggerRow; unknown fields are ignored and malformed rows drop. */
export const parseTriggerRow = (raw: unknown): RoomTrigger | null => {
  if (
    !isRecord(raw) ||
    typeof raw.trigger_id !== 'string' ||
    !raw.trigger_id.trim() ||
    !isOneOf(raw.kind, KINDS) ||
    !isOneOf(raw.relation, RELATIONS) ||
    !isOneOf(raw.thread_mode, THREAD_MODES) ||
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
    threadMode: raw.thread_mode,
    enabled: raw.enabled,
    disabledReason: asStr(raw.disabled_reason)?.trim() || null,
    lastFiredAt: asNum(raw.last_fired_at),
    ownerUserId: raw.owner_user_id,
    canManage: raw.can_manage,
  };
};

/** Parses `{ triggers: [...] }`; malformed rows drop. */
export const parseRoomTriggersResponse = (raw: unknown): RoomTrigger[] =>
  isRecord(raw) && Array.isArray(raw.triggers)
    ? raw.triggers.map(parseTriggerRow).filter((row): row is RoomTrigger => row !== null)
    : [];

const send = (mx: MatrixClient, apiUrl: string, path: string, init: RequestInit = {}) =>
  clientSessions(mx, apiUrl).send(path, {
    ...init,
    redirect: 'error',
    signal: init.signal
      ? AbortSignal.any([init.signal, AbortSignal.timeout(TIMEOUT_MS)])
      : AbortSignal.timeout(TIMEOUT_MS),
  });

const httpError = (status: number) =>
  Object.assign(new Error(`Request failed (${status}).`), { status });

/** Returns `[]` on 404/401/403/network/timeout; rethrows only if `signal` aborted. */
export const fetchRoomTriggers = async (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  signal?: AbortSignal
): Promise<RoomTrigger[]> => {
  try {
    const res = await send(mx, apiUrl, triggersPath(roomId), { signal });
    return res.ok ? parseRoomTriggersResponse(await res.json()) : [];
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
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
