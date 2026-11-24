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
const TRIGGER_KINDS = new Set<string>(['webhook', 'room_message', 'thread_tag', 'external_event']);
const TRIGGER_RELATIONS = new Set<string>(['target', 'watch']);
const THREAD_MODES = new Set<string>(['room', 'thread', 'new_thread', 'origin']);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) return null;
  return typeof value === 'string' ? value : undefined;
};

const optionalFiniteNumber = (value: unknown): number | null | undefined => {
  if (value === null || value === undefined) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
};

export const roomTriggersPath = (roomId: string): string =>
  `/api/rooms/${encodeURIComponent(roomId)}/triggers`;

export const roomTriggerPath = (roomId: string, triggerId: string): string =>
  `${roomTriggersPath(roomId)}/${encodeURIComponent(triggerId)}`;

/** Parses one backend TriggerRow defensively; unknown fields are ignored and malformed rows drop. */
export const parseTriggerRow = (raw: unknown): RoomTrigger | null => {
  if (!isRecord(raw)) return null;
  const triggerId =
    typeof raw.trigger_id === 'string' && raw.trigger_id.trim().length > 0
      ? raw.trigger_id
      : undefined;
  const kind =
    typeof raw.kind === 'string' && TRIGGER_KINDS.has(raw.kind)
      ? (raw.kind as TriggerKind)
      : undefined;
  const relation =
    typeof raw.relation === 'string' && TRIGGER_RELATIONS.has(raw.relation)
      ? (raw.relation as TriggerRelation)
      : undefined;
  const threadMode =
    typeof raw.thread_mode === 'string' && THREAD_MODES.has(raw.thread_mode)
      ? (raw.thread_mode as TriggerThreadMode)
      : undefined;
  const description = typeof raw.description === 'string' ? raw.description : undefined;
  const prompt = optionalString(raw.prompt);
  const agent = optionalString(raw.agent);
  const targetRoomId = optionalString(raw.target_room_id);
  const targetThreadId = optionalString(raw.target_thread_id);
  const disabledReason = optionalString(raw.disabled_reason);
  const expiresAt = optionalFiniteNumber(raw.expires_at);
  const lastFiredAt = optionalFiniteNumber(raw.last_fired_at);
  const ownerUserId = typeof raw.owner_user_id === 'string' ? raw.owner_user_id : undefined;

  if (
    triggerId === undefined ||
    kind === undefined ||
    relation === undefined ||
    threadMode === undefined ||
    description === undefined ||
    prompt === undefined ||
    agent === undefined ||
    targetRoomId === undefined ||
    targetThreadId === undefined ||
    disabledReason === undefined ||
    expiresAt === undefined ||
    lastFiredAt === undefined ||
    ownerUserId === undefined ||
    typeof raw.enabled !== 'boolean' ||
    typeof raw.once !== 'boolean' ||
    typeof raw.can_manage !== 'boolean'
  ) {
    return null;
  }

  return {
    triggerId,
    kind,
    relation,
    description,
    prompt,
    agent,
    targetRoomId,
    targetThreadId,
    threadMode,
    enabled: raw.enabled,
    disabledReason: disabledReason && disabledReason.trim().length > 0 ? disabledReason : null,
    once: raw.once,
    expiresAt,
    lastFiredAt,
    ownerUserId,
    canManage: raw.can_manage,
  };
};

/** Parses `{ triggers: [...] }`; malformed rows are dropped and duplicate trigger IDs keep the first. */
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

/** Runs `send` with an 8 s timeout combined with an optional caller `AbortSignal`. */
const sendWithTimeout = async (
  mx: MatrixClient,
  apiUrl: string,
  path: string,
  init: RequestInit = {}
): Promise<Response> => {
  const controller = new AbortController();
  const callerSignal = init.signal;
  const onCallerAbort = () => controller.abort();
  if (callerSignal?.aborted) controller.abort();
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await clientSessions(mx, apiUrl).send(path, {
      ...init,
      redirect: 'error',
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
};

/**
 * Fetches the room's triggers. Returns `[]` on 404 (older backend), 401/403, network error,
 * or timeout so the header entry stays hidden. Rethrows only if the caller's signal aborted.
 */
export const fetchRoomTriggers = async (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  signal?: AbortSignal
): Promise<RoomTrigger[]> => {
  try {
    const response = await sendWithTimeout(mx, apiUrl, roomTriggersPath(roomId), {
      headers: { Accept: 'application/json' },
      signal,
    });
    if (!response.ok) return [];
    return parseRoomTriggersResponse(await response.json());
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

/** Enables or disables a trigger owned by the caller via `PATCH`. */
export const setRoomTriggerEnabled = async (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  triggerId: string,
  enabled: boolean
): Promise<RoomTrigger | null> => {
  const response = await sendWithTimeout(mx, apiUrl, roomTriggerPath(roomId, triggerId), {
    method: 'PATCH',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!response.ok) {
    throw new RoomTriggerMutationError(
      `Could not update trigger (${response.status}).`,
      response.status
    );
  }
  const body: unknown = await response.json().catch(() => undefined);
  return parseTriggerRow(body);
};

/** Deletes a trigger owned by the caller via `DELETE`. */
export const deleteRoomTrigger = async (
  mx: MatrixClient,
  apiUrl: string,
  roomId: string,
  triggerId: string
): Promise<void> => {
  const response = await sendWithTimeout(mx, apiUrl, roomTriggerPath(roomId, triggerId), {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new RoomTriggerMutationError(
      `Could not delete trigger (${response.status}).`,
      response.status
    );
  }
};
