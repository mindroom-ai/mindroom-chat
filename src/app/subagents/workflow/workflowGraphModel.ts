import type {
  WorkflowRunEdge,
  WorkflowRunGraph,
  WorkflowRunGroup,
  WorkflowRunNode,
  WorkflowRunOmitted,
} from '../../matrix/protocol/workflowFrame';
import type { SubagentRun } from '../../messages/live/subagentRunStore';

export type WorkflowGraphItem =
  | { type: 'node'; node: WorkflowRunNode; turns?: WorkflowRunNode[] }
  | { type: 'group'; group: WorkflowRunGroup; items: WorkflowGraphItem[] };

export type WorkflowGraphBand = {
  phase: string | null;
  items: WorkflowGraphItem[];
};

export type WorkflowGraphLayout = {
  bands: WorkflowGraphBand[];
  omitted: WorkflowRunOmitted;
};

export type Box = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const MAX_PREVIEW_CHARS = 300;
const NODE_ID_PATTERN = /^n(\d+)$/;

/** Start order from public node/group IDs (`n17` -> 17); non-numeric IDs sort after in code-point order. */
const idNumber = (id: string): number => {
  const match = NODE_ID_PATTERN.exec(id);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
};

const compareIds = (a: string, b: string): number => {
  const diff = idNumber(a) - idNumber(b);
  if (diff !== 0) return diff;
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

const itemId = (item: WorkflowGraphItem): string =>
  item.type === 'group' ? item.group.id : item.node.id;

const sortItems = (items: WorkflowGraphItem[]): WorkflowGraphItem[] =>
  items.sort((a, b) => compareIds(itemId(a), itemId(b)));

/**
 * Organizes a workflow graph into phase bands, nested group boxes, and session turn stacks in
 * start order. Orphaned nodes/groups whose containers were omitted stay at the top level of their
 * band, and cyclic parent chains are cut safely so every group appears exactly once.
 */
export const layoutWorkflowRunGraph = (graph: WorkflowRunGraph): WorkflowGraphLayout => {
  const groupById = new Map<string, WorkflowRunGroup>();
  graph.groups.forEach((group) => groupById.set(group.id, group));

  // Cut any cyclic parent references so group nesting always forms a forest.
  const effectiveParent = new Map<string, string | null>();
  graph.groups.forEach((group) => {
    let parent = group.parent && groupById.has(group.parent) ? group.parent : null;
    if (parent !== null) {
      const seen = new Set<string>([group.id]);
      let cursor: string | null = parent;
      while (cursor !== null) {
        if (seen.has(cursor)) {
          // Break the cycle at the link from the higher-ordered ID (or current group).
          parent = null;
          break;
        }
        seen.add(cursor);
        const nextParent: string | null = groupById.get(cursor)?.parent ?? null;
        cursor = nextParent && groupById.has(nextParent) ? nextParent : null;
      }
      // If `group` is part of a cycle, only cut the back-edge on the lowest-id node so the others
      // still nest cleanly under it without duplicating or dropping any group.
      if (parent === null && group.parent && groupById.has(group.parent)) {
        const cycleIds: string[] = [group.id];
        let walk: string | null = group.parent;
        while (walk && walk !== group.id && !cycleIds.includes(walk) && groupById.has(walk)) {
          cycleIds.push(walk);
          walk = groupById.get(walk)?.parent ?? null;
        }
        if (walk === group.id) {
          const rootId = [...cycleIds].sort(compareIds)[0];
          if (group.id !== rootId) parent = group.parent;
        }
      }
    }
    effectiveParent.set(group.id, parent);
  });

  // Group session turns under their session node when that session node is present in the frame.
  const nodeById = new Map<string, WorkflowRunNode>();
  graph.nodes.forEach((node) => nodeById.set(node.id, node));

  const turnsBySession = new Map<string, WorkflowRunNode[]>();
  const attachedTurnIds = new Set<string>();
  graph.nodes.forEach((node) => {
    if (node.session && node.session !== node.id && nodeById.has(node.session)) {
      const target = nodeById.get(node.session)!;
      // Avoid a 2-node session cycle.
      if (target.session === node.id) return;
      const list = turnsBySession.get(node.session) ?? [];
      list.push(node);
      turnsBySession.set(node.session, list);
      attachedTurnIds.add(node.id);
    }
  });
  turnsBySession.forEach((list) => list.sort((a, b) => compareIds(a.id, b.id)));

  const groupChildren = new Map<string, WorkflowGraphItem[]>();
  graph.groups.forEach((group) => groupChildren.set(group.id, []));

  const unphased: WorkflowGraphItem[] = [];
  const phased: WorkflowGraphItem[][] = graph.phases.map(() => []);

  const placeTopLevel = (item: WorkflowGraphItem, phase: number | null) => {
    if (phase !== null && phase >= 0 && phase < phased.length) {
      phased[phase]!.push(item);
    } else {
      unphased.push(item);
    }
  };

  // Attach nodes (excluding turns attached to a present session) to their group or phase band.
  graph.nodes.forEach((node) => {
    if (attachedTurnIds.has(node.id)) return;
    const turns = turnsBySession.get(node.id);
    const item: WorkflowGraphItem = turns ? { type: 'node', node, turns } : { type: 'node', node };
    if (node.group && groupChildren.has(node.group)) {
      groupChildren.get(node.group)!.push(item);
    } else {
      placeTopLevel(item, node.phase);
    }
  });

  // Build group items bottom-up safely via memoized recursion over the acyclic parent map.
  const builtGroups = new Map<string, WorkflowGraphItem>();
  const buildGroupItem = (id: string, visiting = new Set<string>()): WorkflowGraphItem => {
    const existing = builtGroups.get(id);
    if (existing) return existing;
    const group = groupById.get(id)!;
    const children = [...(groupChildren.get(id) ?? [])];
    visiting.add(id);
    graph.groups.forEach((candidate) => {
      if (effectiveParent.get(candidate.id) === id && !visiting.has(candidate.id)) {
        children.push(buildGroupItem(candidate.id, visiting));
      }
    });
    visiting.delete(id);
    sortItems(children);
    const item: WorkflowGraphItem = { type: 'group', group, items: children };
    builtGroups.set(id, item);
    return item;
  };

  graph.groups.forEach((group) => {
    if (effectiveParent.get(group.id) === null) {
      placeTopLevel(buildGroupItem(group.id), group.phase);
    }
  });

  const bands: WorkflowGraphBand[] = [];
  if (unphased.length > 0) {
    bands.push({ phase: null, items: sortItems(unphased) });
  }
  graph.phases.forEach((phase, index) => {
    bands.push({ phase, items: sortItems(phased[index]!) });
  });

  return { bands, omitted: graph.omitted };
};

const foldPriority = (item: WorkflowGraphItem): [number, number] => {
  if (item.type === 'group') {
    const { group } = item;
    if (group.failed > 0) return [1, idNumber(group.id)];
    if (group.done < group.total) return [2, idNumber(group.id)];
    return [4, -idNumber(group.id)];
  }
  const { node } = item;
  if (node.status === 'waiting') return [0, idNumber(node.id)];
  if (node.status === 'failed' || node.status === 'cancelled' || node.status === 'indeterminate') {
    return [1, idNumber(node.id)];
  }
  if (node.status === 'running') return [2, idNumber(node.id)];
  if (node.status === 'queued') return [3, idNumber(node.id)];
  // Completed: newest ended first, tie-broken by highest start order first.
  return [4, -(node.endedAt ?? idNumber(node.id))];
};

/**
 * Folds a large group's items to `limit`: up to the limit everything stays in start order; above
 * it waiting, failed, running, and queued items come first, followed by the newest completed ones.
 */
export const foldGroupItems = (
  items: readonly WorkflowGraphItem[],
  limit = 24
): { shown: WorkflowGraphItem[]; more: number } => {
  if (items.length <= limit) {
    return { shown: [...items], more: 0 };
  }
  const ordered = [...items].sort((a, b) => {
    const [aBucket, aRank] = foldPriority(a);
    const [bBucket, bRank] = foldPriority(b);
    if (aBucket !== bBucket) return aBucket - bBucket;
    if (aRank !== bRank) return aRank - bRank;
    return compareIds(itemId(a), itemId(b));
  });
  return {
    shown: ordered.slice(0, limit),
    more: ordered.length - limit,
  };
};

/** Keeps only message edges whose source and target chips are both currently rendered. */
export const shownEdges = (
  edges: readonly WorkflowRunEdge[],
  shownNodeIds: ReadonlySet<string>
): WorkflowRunEdge[] => edges.filter((edge) => shownNodeIds.has(edge.from) && shownNodeIds.has(edge.to));

/**
 * Computes one cubic Bezier SVG path between two chip boxes: bottom-center to top-center when
 * `to` lies below `from`, top-center to bottom-center when above, else between facing sides.
 */
export const edgePath = (from: Box, to: Box): string => {
  const fromCenterX = from.x + from.width / 2;
  const fromCenterY = from.y + from.height / 2;
  const toCenterX = to.x + to.width / 2;
  const toCenterY = to.y + to.height / 2;

  if (to.y >= from.y + from.height) {
    const x1 = fromCenterX;
    const y1 = from.y + from.height;
    const x2 = toCenterX;
    const y2 = to.y;
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  }
  if (from.y >= to.y + to.height) {
    const x1 = fromCenterX;
    const y1 = from.y;
    const x2 = toCenterX;
    const y2 = to.y + to.height;
    const midY = (y1 + y2) / 2;
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  }
  const toRight = toCenterX >= fromCenterX;
  const x1 = toRight ? from.x + from.width : from.x;
  const y1 = fromCenterY;
  const x2 = toRight ? to.x : to.x + to.width;
  const y2 = toCenterY;
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
};

/**
 * Returns a short preview for a node's joined sub-agent run: `meta.result`, else the last
 * non-empty line of `docs.md`, truncated to 300 characters.
 */
export const nodeResultPreview = (
  _node: WorkflowRunNode,
  run: SubagentRun | undefined
): string | undefined => {
  if (!run) return undefined;
  const rawResult = run.meta.result?.trim();
  if (rawResult) {
    return rawResult.length > MAX_PREVIEW_CHARS
      ? `${rawResult.slice(0, MAX_PREVIEW_CHARS - 1)}…`
      : rawResult;
  }
  const lines = run.docs.md
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const lastLine = lines[lines.length - 1];
  if (!lastLine) return undefined;
  return lastLine.length > MAX_PREVIEW_CHARS
    ? `${lastLine.slice(0, MAX_PREVIEW_CHARS - 1)}…`
    : lastLine;
};
