import { isRecord } from '../../lib/isRecord';
import type { LiveOrder } from './liveFrame';
import type { SubagentUsage } from './subagentFrame';

/** Ephemeral event type for live workflow graph snapshots and deltas. */
export const WORKFLOW_FRAME_EVENT_TYPE = 'io.mindroom.workflow';
export const WORKFLOW_RUN_ID_PATTERN = /^wf-[0-9a-f]{32}$/;
const MAX_LOG_LINES = 20;
const MAX_MESSAGES = 50;
const MAX_DATE_MS = 8.64e15;

const RUN_STATUSES = [
  'starting',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;
const NODE_STATUSES = [
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
  'indeterminate',
] as const;
const WAITING_REASONS = ['user', 'approval', 'peer'] as const;
const COUNT_KEYS = [
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'indeterminate',
  'cached',
] as const;
const OMITTED_KEYS = [
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'edges',
  'groups',
  'phases',
  'log',
  'messages',
] as const;

export type WorkflowRunStatus = (typeof RUN_STATUSES)[number];
export type WorkflowNodeStatus = (typeof NODE_STATUSES)[number];
export type WorkflowWaitingOn = (typeof WAITING_REASONS)[number];
export type WorkflowRunCounts = Record<(typeof COUNT_KEYS)[number], number>;
export type WorkflowRunOmitted = Record<(typeof OMITTED_KEYS)[number], number>;
export type WorkflowNodeUsage = SubagentUsage;
export type WorkflowRunUsage = SubagentUsage & { projectedCostUsd?: number; costUnknown: boolean };

const RUN_STATUS_SET: ReadonlySet<string> = new Set(RUN_STATUSES);
const NODE_STATUS_SET: ReadonlySet<string> = new Set(NODE_STATUSES);
const WAITING_SET: ReadonlySet<string> = new Set(WAITING_REASONS);

const isNonNegInt = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const isFiniteNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const nonNegInt = (v: unknown, fallback = 0): number => (isNonNegInt(v) ? v : fallback);
const nullStr = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const nullNum = (v: unknown): number | null => (isFiniteNum(v) ? v : null);
const validEpochSeconds = (v: unknown): number | null => {
  const n = nullNum(v);
  return n !== null && Math.abs(n * 1000) <= MAX_DATE_MS ? n : null;
};
export const optStr = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length > 0 ? v : undefined;
export const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((item): item is string => typeof item === 'string') : [];

export const isLiveWorkflowRunStatus = (status: WorkflowRunStatus): boolean =>
  status === 'starting' || status === 'running' || status === 'waiting';

/** Parses numeric costs (live frames) and decimal strings (signed cards). */
export const parseCostUsd = (v: unknown): number | undefined => {
  if (isFiniteNum(v)) return v >= 0 ? v : undefined;
  if (typeof v === 'string' && /^\d+(?:\.\d{1,6})?$/.test(v)) {
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
};

const parseKeyedInts = <K extends string>(
  raw: unknown,
  keys: readonly K[],
  required: boolean
): Record<K, number> | null => {
  if (!isRecord(raw))
    return required ? null : (Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>);
  const out = {} as Record<K, number>;
  for (const key of keys) {
    const val = raw[key];
    if (isNonNegInt(val)) out[key] = val;
    else if (required) return null;
    else out[key] = 0;
  }
  return out;
};

const parseCoreUsage = (v: unknown): SubagentUsage | undefined => {
  if (!isRecord(v)) return undefined;
  const { input_tokens: inputTokens, output_tokens: outputTokens, tool_calls: toolCalls } = v;
  if (!isNonNegInt(inputTokens) || !isNonNegInt(outputTokens) || !isNonNegInt(toolCalls))
    return undefined;
  const costUsd = parseCostUsd(v.cost_usd);
  return { inputTokens, outputTokens, toolCalls, ...(costUsd !== undefined ? { costUsd } : {}) };
};

const parseUsage = (v: unknown): WorkflowRunUsage | null => {
  const core = parseCoreUsage(v);
  if (!core || !isRecord(v)) return null;
  const projectedCostUsd = parseCostUsd(v.projected_cost_usd);
  return {
    ...core,
    ...(projectedCostUsd !== undefined ? { projectedCostUsd } : {}),
    costUnknown: v.cost_unknown === true,
  };
};

/** Reads the summary fields shared by live frame `meta` and durable run cards. */
export const parseRunSummary = (v: Record<string, unknown>, requireStartedAt: boolean) => {
  const { status, attempt, started_at: rawStarted, ended_at: rawEnded = null } = v;
  const counts = parseKeyedInts(v.counts, COUNT_KEYS, true);
  const usage = parseUsage(v.usage);
  if (
    typeof status !== 'string' ||
    !RUN_STATUS_SET.has(status) ||
    !isNonNegInt(attempt) ||
    !counts ||
    !usage
  )
    return null;
  if (requireStartedAt ? !isFiniteNum(rawStarted) : rawStarted != null && !isFiniteNum(rawStarted))
    return null;
  const name = optStr(v.name);
  return {
    title: nullStr(v.title),
    ...(name ? { name } : {}),
    status: status as WorkflowRunStatus,
    attempt,
    startedAt: nullNum(rawStarted),
    endedAt: nullNum(rawEnded),
    large: v.large === true,
    counts,
    usage,
  };
};
export type WorkflowRunSummaryFields = NonNullable<ReturnType<typeof parseRunSummary>>;

const readRows = <T>(raw: unknown, parse: (item: unknown) => T | null): T[] =>
  Array.isArray(raw) ? raw.map(parse).filter((item): item is T => item !== null) : [];

const parseNode = (v: unknown) => {
  if (!isRecord(v)) return null;
  const id = optStr(v.id);
  const { label, status } = v;
  if (
    !id ||
    typeof label !== 'string' ||
    typeof status !== 'string' ||
    !NODE_STATUS_SET.has(status)
  )
    return null;
  const [agent, model, run, job, preview, usage] = [
    optStr(v.agent),
    optStr(v.model),
    optStr(v.run),
    optStr(v.job),
    optStr(v.preview),
    parseCoreUsage(v.usage),
  ];
  return {
    id,
    kind: optStr(v.kind) ?? 'agent',
    label,
    name: nullStr(v.name),
    phase: isNonNegInt(v.phase) ? v.phase : null,
    group: optStr(v.group) ?? null,
    status: status as WorkflowNodeStatus,
    waitingOn:
      typeof v.waiting_on === 'string' && WAITING_SET.has(v.waiting_on)
        ? (v.waiting_on as WorkflowWaitingOn)
        : null,
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    ...(run ? { run } : {}),
    ...(job ? { job } : {}),
    ...(preview ? { preview } : {}),
    session: optStr(v.session) ?? null,
    turns: nonNegInt(v.turns, 1),
    startedAt: nullNum(v.started_at),
    endedAt: nullNum(v.ended_at),
    cached: v.cached === true,
    error: nullStr(v.error),
    ...(usage ? { usage } : {}),
  };
};
export type WorkflowRunNode = NonNullable<ReturnType<typeof parseNode>>;

const parseGroup = (v: unknown) => {
  if (!isRecord(v)) return null;
  const [id, kind] = [optStr(v.id), optStr(v.kind)];
  if (!id || !kind) return null;
  return {
    id,
    kind,
    phase: isNonNegInt(v.phase) ? v.phase : null,
    parent: optStr(v.parent) ?? null,
    total: nonNegInt(v.total),
    done: nonNegInt(v.done),
    failed: nonNegInt(v.failed),
  };
};
export type WorkflowRunGroup = NonNullable<ReturnType<typeof parseGroup>>;

const parseEdge = (v: unknown) => {
  if (!isRecord(v)) return null;
  const [from, to] = [optStr(v.from), optStr(v.to)];
  return from && to && isNonNegInt(v.count) && v.count >= 1 ? { from, to, count: v.count } : null;
};
export type WorkflowRunEdge = NonNullable<ReturnType<typeof parseEdge>>;

const parseMessage = (v: unknown) => {
  if (!isRecord(v)) return null;
  const { seq, text } = v;
  const from = optStr(v.from) ?? null;
  const to = optStr(v.to) ?? null;
  const fromName = optStr(v.from_name) ?? from;
  const toName = optStr(v.to_name) ?? to;
  if (!isNonNegInt(seq) || typeof text !== 'string' || !fromName || !toName) return null;
  return {
    seq,
    from,
    fromName,
    to,
    toName,
    text,
    sentAt: validEpochSeconds(v.sent_at),
  };
};
export type WorkflowRunMessage = NonNullable<ReturnType<typeof parseMessage>>;

/** Parses a workflow graph snapshot (used by live snapshots and durable card graphs). */
export const parseWorkflowRunGraph = (v: unknown) =>
  isRecord(v)
    ? {
        phases: stringList(v.phases),
        groups: readRows(v.groups, parseGroup),
        nodes: readRows(v.nodes, parseNode),
        edges: readRows(v.edges, parseEdge),
        messages: readRows(v.messages, parseMessage),
        log: stringList(v.log),
        omitted: parseKeyedInts(v.omitted, OMITTED_KEYS, false)!,
      }
    : null;
export type WorkflowRunGraph = NonNullable<ReturnType<typeof parseWorkflowRunGraph>>;

const parseDelta = (v: unknown) =>
  isRecord(v)
    ? {
        ...(Array.isArray(v.nodes) ? { nodes: readRows(v.nodes, parseNode) } : {}),
        ...(Array.isArray(v.groups) ? { groups: readRows(v.groups, parseGroup) } : {}),
        ...(Array.isArray(v.edges) ? { edges: readRows(v.edges, parseEdge) } : {}),
        ...(Array.isArray(v.messages_append)
          ? { messagesAppend: readRows(v.messages_append, parseMessage) }
          : {}),
        ...(Array.isArray(v.log_append) ? { logAppend: stringList(v.log_append) } : {}),
      }
    : null;
export type WorkflowRunDelta = NonNullable<ReturnType<typeof parseDelta>>;

const parseMeta = (v: unknown) => {
  if (!isRecord(v)) return null;
  const agent = optStr(v.agent);
  const summary = agent ? parseRunSummary(v, true) : null;
  if (!agent || !summary || summary.startedAt === null) return null;
  const requester = v.requester === null ? null : optStr(v.requester);
  return {
    ...summary,
    agent,
    threadId: nullStr(v.thread_id),
    startedAt: summary.startedAt,
    ...(requester !== undefined ? { requester } : {}),
  };
};
export type WorkflowRunMeta = NonNullable<ReturnType<typeof parseMeta>>;

export type WorkflowFrame = { run: string; meta: WorkflowRunMeta } & LiveOrder &
  ({ snapshot: WorkflowRunGraph } | { delta: WorkflowRunDelta });

/** Parses an `io.mindroom.workflow` ephemeral frame, or returns null when invalid. */
export const parseWorkflowFrame = (content: unknown): WorkflowFrame | null => {
  if (!isRecord(content) || content.v !== 1) return null;
  const { run, seq } = content;
  const sid = optStr(content.sid);
  if (typeof run !== 'string' || !WORKFLOW_RUN_ID_PATTERN.test(run) || !sid || !isNonNegInt(seq))
    return null;
  const meta = parseMeta(content.meta);
  const hasSnap = content.snapshot !== undefined;
  if (!meta || hasSnap === (content.delta !== undefined)) return null;
  if (hasSnap) {
    const snapshot = parseWorkflowRunGraph(content.snapshot);
    return snapshot ? { run, sid, seq, meta, snapshot } : null;
  }
  const delta = parseDelta(content.delta);
  return delta ? { run, sid, seq, meta, delta } : null;
};

const upsertBy = <T>(
  existing: readonly T[],
  updates: readonly T[],
  keyOf: (r: T) => string
): T[] => {
  if (!updates.length) return existing as T[];
  const next = [...existing];
  const byKey = new Map(next.map((row, i) => [keyOf(row), i]));
  for (const row of updates) {
    const key = keyOf(row);
    const idx = byKey.get(key);
    if (idx !== undefined) next[idx] = row;
    else {
      byKey.set(key, next.length);
      next.push(row);
    }
  }
  return next;
};

const mergeMessages = (
  existing: readonly WorkflowRunMessage[],
  updates: readonly WorkflowRunMessage[]
): WorkflowRunMessage[] => {
  if (!updates.length) return existing as WorkflowRunMessage[];
  return upsertBy(existing, updates, (m) => String(m.seq))
    .sort((a, b) => a.seq - b.seq)
    .slice(-MAX_MESSAGES);
};

/** Applies a delta while preserving object identity of untouched rows for memoized chips. */
export const applyWorkflowRunDelta = (
  graph: WorkflowRunGraph,
  delta: WorkflowRunDelta
): WorkflowRunGraph => ({
  ...graph,
  nodes: delta.nodes ? upsertBy(graph.nodes, delta.nodes, (n) => n.id) : graph.nodes,
  groups: delta.groups ? upsertBy(graph.groups, delta.groups, (g) => g.id) : graph.groups,
  edges: delta.edges
    ? upsertBy(graph.edges, delta.edges, (e) => `${e.from}\0${e.to}`)
    : graph.edges,
  messages: delta.messagesAppend
    ? mergeMessages(graph.messages, delta.messagesAppend)
    : graph.messages,
  log: delta.logAppend?.length
    ? [...graph.log, ...delta.logAppend].slice(-MAX_LOG_LINES)
    : graph.log,
});
