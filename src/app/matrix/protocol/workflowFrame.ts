import type { LiveOrder } from './liveFrame';

/** Event type of the ephemeral frames that stream a MindRoom workflow run. */
export const WORKFLOW_FRAME_EVENT_TYPE = 'io.mindroom.workflow';

export const WORKFLOW_RUN_ID_PATTERN = /^wf-[0-9a-f]{32}$/;

const WORKFLOW_RUN_STATUSES = [
  'starting',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
  'interrupted',
] as const;

export type WorkflowRunStatus = (typeof WORKFLOW_RUN_STATUSES)[number];

const WORKFLOW_NODE_STATUSES = [
  'queued',
  'running',
  'waiting',
  'completed',
  'failed',
  'cancelled',
  'indeterminate',
] as const;

export type WorkflowNodeStatus = (typeof WORKFLOW_NODE_STATUSES)[number];

const WORKFLOW_WAITING_REASONS = ['approval', 'user', 'peer'] as const;

export type WorkflowWaitingOn = (typeof WORKFLOW_WAITING_REASONS)[number];

const LIVE_RUN_STATUSES: ReadonlySet<WorkflowRunStatus> = new Set([
  'starting',
  'running',
  'waiting',
]);

export const isLiveWorkflowRunStatus = (status: WorkflowRunStatus): boolean =>
  LIVE_RUN_STATUSES.has(status);

export type WorkflowRunUsage = {
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  costUsd?: number;
  attemptCostUsd?: number;
  projectedCostUsd?: number;
  costUnknown: boolean;
};

export type WorkflowNodeUsage = {
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  costUsd?: number;
};

export type WorkflowRunCounts = {
  queued: number;
  running: number;
  waiting: number;
  completed: number;
  failed: number;
  indeterminate: number;
  cached: number;
};

export type WorkflowRunMeta = {
  agent: string;
  threadId: string | null;
  title: string | null;
  name?: string | null;
  requester?: string | null;
  status: WorkflowRunStatus;
  attempt: number;
  startedAt: number;
  endedAt: number | null;
  maxConcurrent: number;
  maxCostUsd: number | null;
  large: boolean;
  counts: WorkflowRunCounts;
  usage: WorkflowRunUsage;
};

export type WorkflowRunNode = {
  id: string;
  kind: string;
  label: string;
  name: string | null;
  phase: number | null;
  group: string | null;
  status: WorkflowNodeStatus;
  waitingOn: WorkflowWaitingOn | null;
  agent?: string;
  model?: string;
  run?: string;
  subagent?: string;
  job?: string;
  session: string | null;
  turns: number;
  startedAt: number | null;
  endedAt: number | null;
  cached: boolean;
  error: string | null;
  usage?: WorkflowNodeUsage;
};

export type WorkflowRunGroup = {
  id: string;
  kind: string;
  phase: number | null;
  parent: string | null;
  total: number;
  done: number;
  failed: number;
};

export type WorkflowRunEdge = {
  from: string;
  to: string;
  kind: string;
  count: number;
};

export type WorkflowRunOmitted = {
  queued: number;
  running: number;
  waiting: number;
  completed: number;
  failed: number;
  edges: number;
  groups: number;
  phases: number;
  log: number;
};

export type WorkflowRunGraph = {
  phases: string[];
  groups: WorkflowRunGroup[];
  nodes: WorkflowRunNode[];
  edges: WorkflowRunEdge[];
  log: string[];
  omitted: WorkflowRunOmitted;
};

export type WorkflowRunDelta = {
  nodes?: WorkflowRunNode[];
  groups?: WorkflowRunGroup[];
  edges?: WorkflowRunEdge[];
  logAppend?: string[];
};

export type WorkflowFrame = { run: string; meta: WorkflowRunMeta } & LiveOrder &
  ({ snapshot: WorkflowRunGraph } | { delta: WorkflowRunDelta });

const MAX_LOG_LINES = 50;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isNonNegativeInt = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

const isNullableString = (value: unknown): value is string | null =>
  value === null || typeof value === 'string';

const isRunStatus = (value: unknown): value is WorkflowRunStatus =>
  typeof value === 'string' && (WORKFLOW_RUN_STATUSES as readonly string[]).includes(value);

const isNodeStatus = (value: unknown): value is WorkflowNodeStatus =>
  typeof value === 'string' && (WORKFLOW_NODE_STATUSES as readonly string[]).includes(value);

const parseWaitingOn = (value: unknown): WorkflowWaitingOn | null =>
  typeof value === 'string' && (WORKFLOW_WAITING_REASONS as readonly string[]).includes(value)
    ? (value as WorkflowWaitingOn)
    : null;

/**
 * Parses a cost field: live frames carry numbers, while signed run cards format floats as decimal
 * strings of at most six places.
 */
export const parseCostUsd = (value: unknown): number | undefined => {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }
  if (typeof value === 'string' && /^\d+(?:\.\d+)?$/.test(value.trim())) {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
  }
  return undefined;
};

export const parseWorkflowRunCounts = (value: unknown): WorkflowRunCounts | null => {
  if (!isRecord(value)) return null;
  const { queued, running, waiting, completed, failed, indeterminate = 0, cached = 0 } = value;
  if (
    !isNonNegativeInt(queued) ||
    !isNonNegativeInt(running) ||
    !isNonNegativeInt(waiting) ||
    !isNonNegativeInt(completed) ||
    !isNonNegativeInt(failed) ||
    !isNonNegativeInt(indeterminate) ||
    !isNonNegativeInt(cached)
  ) {
    return null;
  }
  return { queued, running, waiting, completed, failed, indeterminate, cached };
};

export const parseWorkflowRunUsage = (value: unknown): WorkflowRunUsage | null => {
  if (!isRecord(value)) return null;
  const {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    tool_calls: toolCalls,
    cost_usd: rawCostUsd,
    attempt_cost_usd: rawAttemptCostUsd,
    projected_cost_usd: rawProjectedCostUsd,
    cost_unknown: costUnknown = false,
  } = value;
  if (
    !isNonNegativeInt(inputTokens) ||
    !isNonNegativeInt(outputTokens) ||
    !isNonNegativeInt(toolCalls) ||
    typeof costUnknown !== 'boolean'
  ) {
    return null;
  }
  const costUsd = parseCostUsd(rawCostUsd);
  const attemptCostUsd = parseCostUsd(rawAttemptCostUsd);
  const projectedCostUsd = parseCostUsd(rawProjectedCostUsd);
  return {
    inputTokens,
    outputTokens,
    toolCalls,
    ...(costUsd !== undefined ? { costUsd } : {}),
    ...(attemptCostUsd !== undefined ? { attemptCostUsd } : {}),
    ...(projectedCostUsd !== undefined ? { projectedCostUsd } : {}),
    costUnknown,
  };
};

const parseNodeUsage = (value: unknown): WorkflowNodeUsage | undefined => {
  if (!isRecord(value)) return undefined;
  const {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
    tool_calls: toolCalls,
    cost_usd: rawCostUsd,
  } = value;
  if (
    !isNonNegativeInt(inputTokens) ||
    !isNonNegativeInt(outputTokens) ||
    !isNonNegativeInt(toolCalls)
  ) {
    return undefined;
  }
  const costUsd = parseCostUsd(rawCostUsd);
  return {
    inputTokens,
    outputTokens,
    toolCalls,
    ...(costUsd !== undefined ? { costUsd } : {}),
  };
};

const parseNode = (value: unknown): WorkflowRunNode | null => {
  if (!isRecord(value)) return null;
  const {
    id,
    kind,
    label,
    name = null,
    phase = null,
    group = null,
    status,
    waiting_on: waitingOn = null,
    agent,
    model,
    run,
    subagent,
    job,
    session = null,
    turns = 0,
    started_at: startedAt = null,
    ended_at: endedAt = null,
    cached = false,
    error = null,
  } = value;
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    typeof kind !== 'string' ||
    kind.length === 0 ||
    typeof label !== 'string' ||
    !isNullableString(name) ||
    !(phase === null || isNonNegativeInt(phase)) ||
    !isNullableString(group) ||
    !isNodeStatus(status) ||
    !isNullableString(session) ||
    !isNonNegativeInt(turns) ||
    !(startedAt === null || isFiniteNumber(startedAt)) ||
    !(endedAt === null || isFiniteNumber(endedAt)) ||
    typeof cached !== 'boolean' ||
    !isNullableString(error)
  ) {
    return null;
  }
  const usage = parseNodeUsage(value.usage);
  return {
    id,
    kind,
    label,
    name,
    phase,
    group,
    status,
    waitingOn: parseWaitingOn(waitingOn),
    ...(typeof agent === 'string' && agent.length > 0 ? { agent } : {}),
    ...(typeof model === 'string' && model.length > 0 ? { model } : {}),
    ...(typeof run === 'string' && run.length > 0 ? { run } : {}),
    ...(typeof subagent === 'string' && subagent.length > 0 ? { subagent } : {}),
    ...(typeof job === 'string' && job.length > 0 ? { job } : {}),
    session,
    turns,
    startedAt,
    endedAt,
    cached,
    error,
    ...(usage ? { usage } : {}),
  };
};

const parseGroup = (value: unknown): WorkflowRunGroup | null => {
  if (!isRecord(value)) return null;
  const { id, kind, phase = null, parent = null, total, done, failed } = value;
  if (
    typeof id !== 'string' ||
    id.length === 0 ||
    typeof kind !== 'string' ||
    kind.length === 0 ||
    !(phase === null || isNonNegativeInt(phase)) ||
    !isNullableString(parent) ||
    !isNonNegativeInt(total) ||
    !isNonNegativeInt(done) ||
    !isNonNegativeInt(failed)
  ) {
    return null;
  }
  return { id, kind, phase, parent, total, done, failed };
};

const parseEdge = (value: unknown): WorkflowRunEdge | null => {
  if (!isRecord(value)) return null;
  const { from, to, kind = 'message', count } = value;
  if (
    typeof from !== 'string' ||
    from.length === 0 ||
    typeof to !== 'string' ||
    to.length === 0 ||
    typeof kind !== 'string' ||
    kind.length === 0 ||
    !isNonNegativeInt(count)
  ) {
    return null;
  }
  return { from, to, kind, count };
};

const parseOmitted = (value: unknown): WorkflowRunOmitted => {
  const zero: WorkflowRunOmitted = {
    queued: 0,
    running: 0,
    waiting: 0,
    completed: 0,
    failed: 0,
    edges: 0,
    groups: 0,
    phases: 0,
    log: 0,
  };
  if (!isRecord(value)) return zero;
  const num = (field: unknown) => (isNonNegativeInt(field) ? field : 0);
  return {
    queued: num(value.queued),
    running: num(value.running),
    waiting: num(value.waiting),
    completed: num(value.completed),
    failed: num(value.failed),
    edges: num(value.edges),
    groups: num(value.groups),
    phases: num(value.phases),
    log: num(value.log),
  };
};

const parseStringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/** Parses a workflow graph snapshot, dropping malformed rows while keeping the rest. */
export const parseWorkflowRunGraph = (value: unknown): WorkflowRunGraph | null => {
  if (!isRecord(value)) return null;
  const groups = Array.isArray(value.groups)
    ? value.groups.flatMap((row) => {
        const parsed = parseGroup(row);
        return parsed ? [parsed] : [];
      })
    : [];
  const nodes = Array.isArray(value.nodes)
    ? value.nodes.flatMap((row) => {
        const parsed = parseNode(row);
        return parsed ? [parsed] : [];
      })
    : [];
  const edges = Array.isArray(value.edges)
    ? value.edges.flatMap((row) => {
        const parsed = parseEdge(row);
        return parsed ? [parsed] : [];
      })
    : [];
  return {
    phases: parseStringList(value.phases),
    groups,
    nodes,
    edges,
    log: parseStringList(value.log),
    omitted: parseOmitted(value.omitted),
  };
};

const parseDelta = (value: unknown): WorkflowRunDelta | null => {
  if (!isRecord(value)) return null;
  const delta: WorkflowRunDelta = {};
  if (Array.isArray(value.nodes)) {
    delta.nodes = value.nodes.flatMap((row) => {
      const parsed = parseNode(row);
      return parsed ? [parsed] : [];
    });
  }
  if (Array.isArray(value.groups)) {
    delta.groups = value.groups.flatMap((row) => {
      const parsed = parseGroup(row);
      return parsed ? [parsed] : [];
    });
  }
  if (Array.isArray(value.edges)) {
    delta.edges = value.edges.flatMap((row) => {
      const parsed = parseEdge(row);
      return parsed ? [parsed] : [];
    });
  }
  if (Array.isArray(value.log_append)) {
    delta.logAppend = parseStringList(value.log_append);
  }
  return delta;
};

const parseMeta = (value: unknown): WorkflowRunMeta | null => {
  if (!isRecord(value)) return null;
  const {
    agent,
    thread_id: threadId = null,
    title = null,
    name,
    requester,
    status,
    attempt,
    started_at: startedAt,
    ended_at: endedAt = null,
    max_concurrent: maxConcurrent = 0,
    max_cost_usd: rawMaxCostUsd = null,
    large = false,
  } = value;
  const counts = parseWorkflowRunCounts(value.counts);
  const usage = parseWorkflowRunUsage(value.usage);
  if (
    typeof agent !== 'string' ||
    agent.length === 0 ||
    !isNullableString(threadId) ||
    !isNullableString(title) ||
    !isRunStatus(status) ||
    !isNonNegativeInt(attempt) ||
    !isFiniteNumber(startedAt) ||
    !(endedAt === null || isFiniteNumber(endedAt)) ||
    !isNonNegativeInt(maxConcurrent) ||
    typeof large !== 'boolean' ||
    !counts ||
    !usage
  ) {
    return null;
  }
  const maxCostUsd = rawMaxCostUsd === null ? null : (parseCostUsd(rawMaxCostUsd) ?? null);
  return {
    agent,
    threadId,
    title,
    ...(typeof name === 'string' && name.length > 0 ? { name } : {}),
    ...(requester === null || (typeof requester === 'string' && requester.length > 0)
      ? { requester }
      : {}),
    status,
    attempt,
    startedAt,
    endedAt,
    maxConcurrent,
    maxCostUsd,
    large,
    counts,
    usage,
  };
};

/** Parses an `io.mindroom.workflow` ephemeral frame, or returns null when invalid. */
export const parseWorkflowFrame = (content: unknown): WorkflowFrame | null => {
  if (!isRecord(content) || content.v !== 1) return null;
  const { run, sid, seq } = content;
  if (typeof run !== 'string' || !WORKFLOW_RUN_ID_PATTERN.test(run)) return null;
  if (typeof sid !== 'string' || sid.length === 0 || !isNonNegativeInt(seq)) return null;
  const meta = parseMeta(content.meta);
  if (!meta) return null;
  const hasSnapshot = 'snapshot' in content;
  const hasDelta = 'delta' in content;
  if (hasSnapshot === hasDelta) return null;
  if (hasSnapshot) {
    const snapshot = parseWorkflowRunGraph(content.snapshot);
    return snapshot ? { run, sid, seq, meta, snapshot } : null;
  }
  const delta = parseDelta(content.delta);
  return delta ? { run, sid, seq, meta, delta } : null;
};

const mergeById = <T extends { id: string }>(existing: readonly T[], updates: readonly T[]): T[] => {
  if (updates.length === 0) return existing as T[];
  const byId = new Map<string, number>();
  const next = existing.slice();
  existing.forEach((row, index) => byId.set(row.id, index));
  updates.forEach((row) => {
    const index = byId.get(row.id);
    if (index === undefined) {
      byId.set(row.id, next.length);
      next.push(row);
    } else {
      next[index] = row;
    }
  });
  return next;
};

const mergeEdges = (
  existing: readonly WorkflowRunEdge[],
  updates: readonly WorkflowRunEdge[]
): WorkflowRunEdge[] => {
  if (updates.length === 0) return existing as WorkflowRunEdge[];
  const byKey = new Map<string, number>();
  const next = existing.slice();
  const keyOf = (edge: WorkflowRunEdge) => `${edge.from}\0${edge.to}`;
  existing.forEach((edge, index) => byKey.set(keyOf(edge), index));
  updates.forEach((edge) => {
    const key = keyOf(edge);
    const index = byKey.get(key);
    if (index === undefined) {
      byKey.set(key, next.length);
      next.push(edge);
    } else {
      next[index] = edge;
    }
  });
  return next;
};

/**
 * Applies a delta to a workflow graph while preserving object references for untouched rows so
 * memoized node chips only re-render when their own row changed.
 */
export const applyWorkflowRunDelta = (
  graph: WorkflowRunGraph,
  delta: WorkflowRunDelta
): WorkflowRunGraph => {
  const nodes = delta.nodes ? mergeById(graph.nodes, delta.nodes) : graph.nodes;
  const groups = delta.groups ? mergeById(graph.groups, delta.groups) : graph.groups;
  const edges = delta.edges ? mergeEdges(graph.edges, delta.edges) : graph.edges;
  const log =
    delta.logAppend && delta.logAppend.length > 0
      ? [...graph.log, ...delta.logAppend].slice(-MAX_LOG_LINES)
      : graph.log;
  return {
    phases: graph.phases,
    omitted: graph.omitted,
    nodes,
    groups,
    edges,
    log,
  };
};
