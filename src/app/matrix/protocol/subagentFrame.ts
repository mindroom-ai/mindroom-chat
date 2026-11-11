import { parseLiveFrame, type LiveDelta, type LiveDocs, type LiveOrder } from './liveFrame';

/** Event type of the ephemeral frames that stream a MindRoom sub-agent run. */
export const SUBAGENT_FRAME_EVENT_TYPE = 'io.mindroom.subagents';

const SUBAGENT_STATUSES = [
  'running',
  'awaiting_approval',
  'paused',
  'completed',
  'failed',
  'cancelled',
  'denied',
] as const;

export type SubagentStatus = (typeof SUBAGENT_STATUSES)[number];

export type SubagentMeta = {
  agent: string;
  caller: string;
  root: string;
  parent: string | null;
  threadId: string | null;
  source: 'delegate' | 'workflow';
  status: SubagentStatus;
  startedAt: number;
  endedAt: number | null;
  /** Only on snapshots. */
  task?: string;
  /** Only on snapshots of an ended run. */
  result?: string;
};

export type SubagentFrame = { run: string; meta: SubagentMeta } & LiveOrder &
  ({ snapshot: LiveDocs } | { delta: LiveDelta });

const ACTIVE_STATUSES: ReadonlySet<SubagentStatus> = new Set([
  'running',
  'awaiting_approval',
  'paused',
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isStatus = (value: unknown): value is SubagentStatus =>
  typeof value === 'string' && (SUBAGENT_STATUSES as readonly string[]).includes(value);

const parseMeta = (value: unknown): SubagentMeta | null => {
  if (!isRecord(value)) return null;
  const { agent, caller, root, parent, thread_id: threadId, source, status } = value;
  const { started_at: startedAt, ended_at: endedAt, task, result } = value;
  if (typeof agent !== 'string' || typeof caller !== 'string' || typeof root !== 'string') {
    return null;
  }
  if (!isNullableString(parent) || !isNullableString(threadId)) return null;
  if (source !== 'delegate' && source !== 'workflow') return null;
  if (!isStatus(status) || typeof startedAt !== 'number' || !Number.isFinite(startedAt)) {
    return null;
  }
  if (endedAt !== null && (typeof endedAt !== 'number' || !Number.isFinite(endedAt))) return null;
  if (task !== undefined && typeof task !== 'string') return null;
  // MindRoom sends `result: null` for an ended run without one.
  if (result !== undefined && result !== null && typeof result !== 'string') return null;
  return {
    agent,
    caller,
    root,
    parent,
    threadId,
    source,
    status,
    startedAt,
    endedAt,
    ...(task === undefined ? {} : { task }),
    ...(typeof result === 'string' ? { result } : {}),
  };
};

/** The frame in an `io.mindroom.subagents` content, or null unless it has the v1 shape. */
export const parseSubagentFrame = (content: unknown): SubagentFrame | null => {
  if (!isRecord(content)) return null;
  const { run } = content;
  if (typeof run !== 'string' || run.length === 0) return null;
  const meta = parseMeta(content.meta);
  if (!meta) return null;
  const live = parseLiveFrame({ ...content, reply: run });
  if (!live) return null;
  const { reply: _reply, ...order } = live;
  return { ...order, run, meta };
};

export const isActiveSubagentStatus = (status: SubagentStatus): boolean =>
  ACTIVE_STATUSES.has(status);
