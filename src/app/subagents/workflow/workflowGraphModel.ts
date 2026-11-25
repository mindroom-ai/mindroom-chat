import type { AiRunModelInfo } from '../../matrix/protocol/aiRun';
import { getAiRunCompactModelLabel } from '../../matrix/protocol/aiRunModelLabel';
import type {
  WorkflowNodeStatus,
  WorkflowRunGraph,
  WorkflowRunGroup,
  WorkflowRunNode,
} from '../../matrix/protocol/workflowFrame';
import { formatCostUsd } from '../../messages/agent-run/aiRunDisplay';
import type { SubagentRun } from '../../messages/live/subagentRunStore';
import { formatWorkflowElapsed } from '../../messages/workflow-run/workflowRunLabels';
import { formatTokens } from '../runUsage';

export type WorkflowGraphItem =
  | { type: 'node'; node: WorkflowRunNode; children?: WorkflowGraphItem[] }
  | { type: 'group'; group: WorkflowRunGroup; items: WorkflowGraphItem[] };
export type WorkflowFlowItem =
  WorkflowGraphItem | { type: 'plumb_group'; id: string; nodes: WorkflowRunNode[] };
export type WorkflowGraphBand = { phase: string | null; items: WorkflowGraphItem[] };
export type WorkflowSessionInfo = {
  id: string;
  label: string;
  name: string | null;
  model?: string;
  turns: number;
};
export type WorkflowPeerBridge = {
  key: string;
  fromId: string;
  toId: string;
  fromLabel: string;
  toLabel: string;
  bidirectional: boolean;
  count: number;
};
export type WorkflowGraphLayout = {
  bands: WorkflowGraphBand[];
  sessionsById: Map<string, WorkflowSessionInfo>;
  peerBridgesByGroup: Map<string, WorkflowPeerBridge[]>;
  stepCount: number;
};

const PLUMBING_KINDS: ReadonlySet<string> = new Set(['value', 'state', 'send', 'inbox', 'tool']);
const STATUS_RANK = {
  waiting: 0,
  failed: 1,
  cancelled: 1,
  indeterminate: 1,
  running: 2,
  queued: 3,
  completed: 4,
} as const;

export const isLiveWorkflowNodeStatus = (status: WorkflowNodeStatus): boolean =>
  status === 'queued' || status === 'running' || status === 'waiting';

export const isPlumbingKind = (kind: string): boolean => PLUMBING_KINDS.has(kind);

/** Completed leaf plumbing nodes render as compact pills and collapse in sequential Flow view. */
export const isCollapsiblePlumbingItem = (item: WorkflowGraphItem): boolean =>
  item.type === 'node' &&
  PLUMBING_KINDS.has(item.node.kind) &&
  item.node.status === 'completed' &&
  (!item.children || item.children.length === 0);

/** Groups 2+ consecutive completed leaf plumbing items into a single compact `plumb_group` pill. */
export const groupFlowItems = (items: readonly WorkflowGraphItem[]): WorkflowFlowItem[] => {
  const out: WorkflowFlowItem[] = [];
  let run: WorkflowRunNode[] = [];
  const flush = () => {
    if (run.length >= 2) out.push({ type: 'plumb_group', id: `plumb:${run[0]!.id}`, nodes: run });
    else if (run.length === 1) out.push({ type: 'node', node: run[0]! });
    run = [];
  };
  for (const item of items) {
    if (isCollapsiblePlumbingItem(item) && item.type === 'node') run.push(item.node);
    else {
      flush();
      out.push(item);
    }
  }
  flush();
  return out;
};

export const sessionBadgeLabel = (session: WorkflowSessionInfo | undefined): string | undefined =>
  session ? session.name?.trim() || session.label : undefined;

export const nodeDisplayName = (
  nodesById: ReadonlyMap<string, WorkflowRunNode>,
  id: string
): string => nodesById.get(id)?.name ?? nodesById.get(id)?.label ?? id;

/** Formats a workflow model label from joined sub-agent info or a raw `config@effort` string. */
export const formatWorkflowModelLabel = (
  model: string | undefined,
  subagentModel?: AiRunModelInfo
): string | undefined => {
  const compact = subagentModel ? getAiRunCompactModelLabel(subagentModel) : undefined;
  if (compact) return compact;
  const raw = model?.trim();
  if (!raw) return undefined;
  const match = /^([^\s@]+)@([^\s@]+)$/.exec(raw);
  return match ? `${match[1]} · ${match[2]}` : raw;
};

/** Shared model, token, cost, and elapsed display values for a workflow node. */
export const getWorkflowNodeMetrics = (
  node: WorkflowRunNode,
  subagentRun: SubagentRun | undefined,
  now: number,
  language: string
) => {
  const isLive = isLiveWorkflowNodeStatus(node.status);
  const usage = isLive ? (subagentRun?.meta.usage ?? node.usage) : node.usage;
  const tokensCount = usage ? usage.inputTokens + usage.outputTokens : 0;
  return {
    model: formatWorkflowModelLabel(node.model, subagentRun?.meta.model),
    tokens: tokensCount > 0 ? formatTokens(tokensCount, language) : undefined,
    cost:
      usage?.costUsd !== undefined && (usage.costUsd > 0 || tokensCount > 0)
        ? formatCostUsd(usage.costUsd, language)
        : undefined,
    elapsed: formatWorkflowElapsed(node.startedAt, node.endedAt, isLive ? now : null, language),
  };
};

const idNum = (id: string): number => {
  const m = /^n(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};
const compareIds = (a: string, b: string): number => idNum(a) - idNum(b) || a.localeCompare(b);
const itemId = (item: WorkflowGraphItem): string =>
  item.type === 'group' ? item.group.id : item.node.id;

/** Builds phase bands, session metadata, and in-group peer message bridges in one indexed pass. */
export const layoutWorkflowRunGraph = (graph: WorkflowRunGraph): WorkflowGraphLayout => {
  type Entry = {
    id: string;
    phase: number | null;
    parents: (string | null)[];
    node?: WorkflowRunNode;
    group?: WorkflowRunGroup;
  };
  const sessionsById = new Map<string, WorkflowSessionInfo>();
  const emittedTurnsBySession = new Map<string, number>();
  const nodesById = new Map<string, WorkflowRunNode>();
  for (const node of graph.nodes) {
    nodesById.set(node.id, node);
    if (node.kind === 'session') {
      sessionsById.set(node.id, {
        id: node.id,
        label: node.label,
        name: node.name,
        ...(node.model ? { model: node.model } : {}),
        turns: node.turns,
      });
    }
    if (node.session) {
      emittedTurnsBySession.set(node.session, (emittedTurnsBySession.get(node.session) ?? 0) + 1);
    }
  }

  // Prefer `node.group` over `node.session` so spawned turns stay inside Parallel / For each groups.
  const byId = new Map<string, Entry>([
    ...graph.nodes.map((node): [string, Entry] => [
      node.id,
      { id: node.id, phase: node.phase, parents: [node.group, node.session], node },
    ]),
    ...graph.groups.map((group): [string, Entry] => [
      group.id,
      { id: group.id, phase: group.phase, parents: [group.parent], group },
    ]),
  ]);
  const childrenOf = new Map<string, Entry[]>();
  const roots: Entry[] = [];
  for (const e of byId.values()) {
    const p = e.parents.find((id): id is string => !!id && id !== e.id && byId.has(id)) ?? null;
    if (p) (childrenOf.get(p) ?? childrenOf.set(p, []).get(p)!).push(e);
    else roots.push(e);
  }

  // Omit empty 0s session wrapper nodes whose emitted turns all live inside groups.
  const isRedundantSession = (e: Entry): boolean =>
    e.node?.kind === 'session' &&
    e.node.turns > 0 &&
    !e.node.error &&
    (emittedTurnsBySession.get(e.id) ?? 0) > 0 &&
    (childrenOf.get(e.id)?.length ?? 0) === 0;

  const visited = new Set<string>();
  const ancestorGroups = new Map<string, string[]>();
  let stepCount = 0;

  const build = (e: Entry, groupStack: string[]): WorkflowGraphItem => {
    visited.add(e.id);
    const nextGroups = e.group ? [...groupStack, e.group.id] : groupStack;
    if (e.node) {
      stepCount += 1;
      ancestorGroups.set(e.node.id, groupStack);
    }
    const kids: WorkflowGraphItem[] = [];
    for (const c of (childrenOf.get(e.id) ?? []).sort((a, b) => compareIds(a.id, b.id))) {
      if (visited.has(c.id)) continue;
      if (isRedundantSession(c)) visited.add(c.id);
      else kids.push(build(c, nextGroups));
    }
    if (e.group) return { type: 'group', group: e.group, items: kids };
    return kids.length
      ? { type: 'node', node: e.node!, children: kids }
      : { type: 'node', node: e.node! };
  };

  const unphased: WorkflowGraphItem[] = [];
  const phased: WorkflowGraphItem[][] = graph.phases.map(() => []);
  const place = (e: Entry) => {
    if (isRedundantSession(e)) {
      visited.add(e.id);
      return;
    }
    const item = build(e, []);
    if (e.phase !== null && e.phase >= 0 && e.phase < phased.length) phased[e.phase]!.push(item);
    else unphased.push(item);
  };

  roots.sort((a, b) => compareIds(a.id, b.id)).forEach(place);
  [...byId.values()]
    .filter((e) => !visited.has(e.id))
    .sort((a, b) => compareIds(a.id, b.id))
    .forEach((e) => {
      if (!visited.has(e.id)) place(e);
    });

  // Derive deduplicated / bidirectional peer message bridges per enclosing group.
  const bridgeMaps = new Map<string, Map<string, WorkflowPeerBridge>>();
  for (const edge of graph.edges) {
    if (edge.from === edge.to) continue;
    const fromGroups = ancestorGroups.get(edge.from);
    const toGroups = ancestorGroups.get(edge.to);
    if (!fromGroups?.length || !toGroups?.length) continue;
    let commonGroup: string | null = null;
    for (
      let i = 0;
      i < Math.min(fromGroups.length, toGroups.length) && fromGroups[i] === toGroups[i];
      i += 1
    ) {
      commonGroup = fromGroups[i]!;
    }
    if (!commonGroup) continue;
    const byPair =
      bridgeMaps.get(commonGroup) ?? bridgeMaps.set(commonGroup, new Map()).get(commonGroup)!;
    const pairKey = edge.from < edge.to ? `${edge.from}\0${edge.to}` : `${edge.to}\0${edge.from}`;
    const existing = byPair.get(pairKey);
    if (existing) {
      existing.count += edge.count;
      if (existing.fromId !== edge.from) existing.bidirectional = true;
    } else {
      byPair.set(pairKey, {
        key: pairKey,
        fromId: edge.from,
        toId: edge.to,
        fromLabel: nodeDisplayName(nodesById, edge.from),
        toLabel: nodeDisplayName(nodesById, edge.to),
        bidirectional: false,
        count: edge.count,
      });
    }
  }
  const peerBridgesByGroup = new Map(
    [...bridgeMaps.entries()].map(([groupId, byPair]) => [groupId, [...byPair.values()]])
  );

  const bands: WorkflowGraphBand[] = unphased.length ? [{ phase: null, items: unphased }] : [];
  graph.phases.forEach((phase, i) => bands.push({ phase, items: phased[i]! }));
  return { bands, sessionsById, peerBridgesByGroup, stepCount };
};

const foldPriority = (item: WorkflowGraphItem): [number, number] => {
  if (item.type === 'group') {
    const { group } = item;
    return group.failed > 0
      ? [1, idNum(group.id)]
      : group.done < group.total
        ? [2, idNum(group.id)]
        : [4, -idNum(group.id)];
  }
  const rank = STATUS_RANK[item.node.status];
  return [rank, rank === 4 ? -(item.node.endedAt ?? idNum(item.node.id)) : idNum(item.node.id)];
};

/** Folds a large group to `limit`: unfinished items first, then newest completed ones. */
export const foldGroupItems = (items: readonly WorkflowGraphItem[], limit = 24) => {
  if (items.length <= limit) return { shown: [...items], more: 0 };
  const ordered = [...items].sort((a, b) => {
    const [ab, ar] = foldPriority(a);
    const [bb, br] = foldPriority(b);
    return ab - bb || ar - br || compareIds(itemId(a), itemId(b));
  });
  return { shown: ordered.slice(0, limit), more: ordered.length - limit };
};

const FENCE_MULTILINE = /^```[^\n]*\n([\s\S]*?)\n?```$/;
const FENCE_INLINE = /^```(?:[a-zA-Z0-9_-]+\s+)?([\s\S]*?)```$/;

const stripSingleCodeFence = (text: string): string => {
  const trimmed = text.trim();
  const multi = FENCE_MULTILINE.exec(trimmed);
  if (multi && !multi[1]!.includes('```')) return multi[1]!.trim();
  const inline = FENCE_INLINE.exec(trimmed);
  if (inline && !inline[1]!.includes('```')) return inline[1]!.trim();
  return trimmed;
};

const formatPreview = (raw: string): string | undefined => {
  const cleaned = stripSingleCodeFence(raw);
  if (!cleaned) return undefined;
  if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(cleaned);
      if (parsed && typeof parsed === 'object') {
        const pretty = JSON.stringify(parsed, null, 2);
        if (pretty.length < 300) return pretty;
      }
    } catch {
      // Not valid JSON; display cleaned text as-is.
    }
  }
  return cleaned.length > 300 ? `${cleaned.slice(0, 299)}…` : cleaned;
};

/** Clean preview for a joined sub-agent run (`meta.result` else last non-empty `docs.md` line). */
export const nodeResultPreview = (run: SubagentRun | undefined): string | undefined => {
  if (!run) return undefined;
  const result = run.meta.result?.trim();
  if (result) return formatPreview(result);
  const md = run.docs.md.trim();
  if (!md) return undefined;
  if (stripSingleCodeFence(md) !== md) return formatPreview(md);
  const lastLine = md
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  return lastLine ? formatPreview(lastLine) : undefined;
};

/** Concise 1-line inline error badge for failed cards and outline rows. */
export const shortNodeError = (error: string | null): string | undefined => {
  const firstLine = error
    ?.split('\n')
    .map((l) => l.trim())
    .find(Boolean);
  if (!firstLine) return undefined;
  const stripped = firstLine.replace(/^error:\s*/i, '').trim() || firstLine;
  if (/\b(?:timed?\s*out|timeout(?:error)?)\b/i.test(stripped)) return 'Timeout';
  const clause = stripped.split(/[:;!?](?:\s|$)|\.(?:\s|$)/)[0]?.trim() || stripped;
  return clause.length > 40 ? `${clause.slice(0, 39).trimEnd()}…` : clause;
};
