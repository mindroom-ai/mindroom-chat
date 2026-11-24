import type { MatrixClient } from 'matrix-js-sdk';
import { clientSessions } from '../computer/clientSessions';

export type TriggerKind = 'webhook' | 'room_message' | 'thread_tag' | 'external_event';
export type TriggerRelation = 'target' | 'watch';
export type TriggerThreadMode = 'room' | 'thread' | 'new_thread' | 'origin';

export type RoomTrigger = {
  triggerId: string;
  kind: TriggerKind;
  relation: TriggerRelation;
  description: string;
  prompt: string | null;
  agent: string | null;
  targetRoomId: string | null;
  targetThreadId: string | null;
  threadMode: TriggerThreadMode;
  enabled: boolean;
  disabledReason: string | null;
  once: boolean;
  expiresAt: number | null;
  lastFiredAt: number | null;
  ownerUserId: string;
  canManage: boolean;
};

const TIMEOUT_MS = 8_000;
const KINDS = new Set<string>(['webhook', 'room_message', 'thread_tag', 'external_event']);
const RELATIONS = new Set<string>(['target', 'watch']);
const THREAD_MODES = new Set<string>(['room', 'thread', 'new_thread', 'origin']);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const optStr = (v: unknown): string | null | undefined =>
  v === null || v === undefined ? null : typeof v === 'string' ? v : undefined;
const optNum = (v: unknown): number | null | undefined =>
  v === null || v === undefined
    ? null
    : typeof v === 'number' && Number.isFinite(v)
      ? v
      : undefined;

export const roomTriggersPath = (roomId: string): string =>
  `/api/rooms/${encodeURIComponent(roomId)}/triggers`;

export const roomTriggerPath = (roomId: string, triggerId: string): string =>
  `${roomTriggersPath(roomId)}/${encodeURIComponent(triggerId)}`;

/** Parses one backend TriggerRow defensively; unknown fields are ignored and malformed rows drop. */
export const parseTriggerRow = (raw: unknown): RoomTrigger | null => {
  if (!isRecord(raw)) return null;
  const {
    trigger_id: id,
    kind,
    relation,
    description,
    thread_mode: threadMode,
    enabled,
    once,
    owner_user_id: ownerUserId,
    can_manage: canManage,
  } = raw;
  const prompt = optStr(raw.prompt);
  const agent = optStr(raw.agent);
  const targetRoomId = optStr(raw.target_room_id);
  const targetThreadId = optStr(raw.target_thread_id);
  const disabledReason = optStr(raw.disabled_reason);
  const expiresAt = optNum(raw.expires_at);
  const lastFiredAt = optNum(raw.last_fired_at);

  if (
    typeof id !== 'string' ||
    id.trim().length === 0 ||
    typeof kind !== 'string' ||
    !KINDS.has(kind) ||
    typeof relation !== 'string' ||
    !RELATIONS.has(relation) ||
    typeof threadMode !== 'string' ||
    !THREAD_MODES.has(threadMode) ||
    typeof description !== 'string' ||
    typeof ownerUserId !== 'string' ||
    typeof enabled !== 'boolean' ||
    typeof once !== 'boolean' ||
    typeof canManage !== 'boolean' ||
    prompt === undefined ||
    agent === undefined ||
    targetRoomId === undefined ||
    targetThreadId === undefined ||
    disabledReason === undefined ||
    expiresAt === undefined ||
    lastFiredAt === undefined
  ) {
    return null;
  }

  return {
    triggerId: id,
    kind: kind as TriggerKind,
    relation: relation as TriggerRelation,
    description,
    prompt,
    agent,
    targetRoomId,
    targetThreadId,
    threadMode: threadMode as TriggerThreadMode,
    enabled,
    disabledReason: disabledReason?.trim() ? disabledReason : null,
    once,
    expiresAt,
    lastFiredAt,
    ownerUserId,
    canManage,
  };
};

/** Parses `{ triggers: [...] }`; malformed rows drop and duplicate IDs keep the first. */
export const parseRoomTriggersResponse = (raw: unknown): RoomTrigger[] => {
  if (!isRecord(raw) || !Array.isArray(raw.triggers)) return [];
  const seen = new Set<string>();
  const rows: RoomTrigger[] = [];
  for (const item of raw.triggers) {
    const parsed = parseTriggerRow(item);
    if (!parsed || seen.has(parsed.triggerId)) continue;
    seen.add(parsed.triggerId);
    rows.push(parsed);
  }
  return rows;
};

const sendWithTimeout = async (
  mx: MatrixClient,
  apiUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> => {
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

/** Returns `[]` on 404/401/403/network/timeout; rethrows only if `signal` aborted. */
export const fetchRoomTriggers = async (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  signal?: AbortSignal
): Promise<RoomTrigger[]> => {
  try {
    const res = await sendWithTimeout(mx, apiUrl, roomTriggersPath(roomId), {
      headers: { Accept: 'application/json' },
      signal,
    });
    return res.ok ? parseRoomTriggersResponse(await res.json()) : [];
  } catch (error) {
    if (signal?.aborted) throw error;
    return [];
  }
};

export class RoomTriggerMutationError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'RoomTriggerMutationError';
    this.status = status;
  }
}

export const setRoomTriggerEnabled = async (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  triggerId: string,
  enabled: boolean
): Promise<RoomTrigger | null> => {
  const res = await sendWithTimeout(mx, apiUrl, roomTriggerPath(roomId, triggerId), {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new RoomTriggerMutationError(`Update failed (${res.status}).`, res.status);
  return parseTriggerRow(await res.json().catch(() => undefined));
};

export const deleteRoomTrigger = async (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  triggerId: string
): Promise<void> => {
  const res = await sendWithTimeout(mx, apiUrl, roomTriggerPath(roomId, triggerId), {
    method: 'DELETE',
  });
  if (!res.ok) throw new RoomTriggerMutationError(`Delete failed (${res.status}).`, res.status);
};
