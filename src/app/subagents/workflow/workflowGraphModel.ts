import type {
  WorkflowRunGraph,
  WorkflowRunGroup,
  WorkflowRunNode,
} from '../../matrix/protocol/workflowFrame';
import type { SubagentRun } from '../../messages/live/subagentRunStore';

export type WorkflowGraphItem =
  | { type: 'node'; node: WorkflowRunNode; children?: WorkflowGraphItem[] }
  | { type: 'group'; group: WorkflowRunGroup; items: WorkflowGraphItem[] };

export type WorkflowGraphBand = { phase: string | null; items: WorkflowGraphItem[] };
export type WorkflowGraphLayout = { bands: WorkflowGraphBand[] };
export type Box = { x: number; y: number; width: number; height: number };

const MAX_PREVIEW_CHARS = 300;

const idNum = (id: string): number => {
  const m = /^n(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};

const compareIds = (a: string, b: string): number => idNum(a) - idNum(b) || a.localeCompare(b);
const itemId = (item: WorkflowGraphItem): string =>
  item.type === 'group' ? item.group.id : item.node.id;

/**
 * Builds phase bands and nested node/group trees in one indexed pass: nodes attach to their
 * session or group, groups attach to their parent group or caller node, and orphans/cycles fall
 * back to their phase band while showing each entry once.
 */
export const layoutWorkflowRunGraph = (graph: WorkflowRunGraph): WorkflowGraphLayout => {
  type Entry =
    | {
        kind: 'node';
        id: string;
        phase: number | null;
        parent: string | null;
        node: WorkflowRunNode;
      }
    | {
        kind: 'group';
        id: string;
        phase: number | null;
        parent: string | null;
        group: WorkflowRunGroup;
      };

  const byId = new Map<string, Entry>();
  for (const node of graph.nodes) {
    byId.set(node.id, {
      kind: 'node',
      id: node.id,
      phase: node.phase,
      parent: node.session ?? node.group,
      node,
    });
  }
  for (const group of graph.groups) {
    byId.set(group.id, {
      kind: 'group',
      id: group.id,
      phase: group.phase,
      parent: group.parent,
      group,
    });
  }

  const childrenOf = new Map<string, Entry[]>();
  const roots: Entry[] = [];
  for (const entry of byId.values()) {
    const p =
      entry.parent && entry.parent !== entry.id && byId.has(entry.parent) ? entry.parent : null;
    if (p) {
      const list = childrenOf.get(p) ?? [];
      list.push(entry);
      childrenOf.set(p, list);
    } else {
      roots.push(entry);
    }
  }

  const visited = new Set<string>();
  const build = (entry: Entry): WorkflowGraphItem => {
    visited.add(entry.id);
    const kids = (childrenOf.get(entry.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .sort((a, b) => compareIds(a.id, b.id))
      .map(build);
    if (entry.kind === 'group') return { type: 'group', group: entry.group, items: kids };
    return kids.length > 0
      ? { type: 'node', node: entry.node, children: kids }
      : { type: 'node', node: entry.node };
  };

  const unphased: WorkflowGraphItem[] = [];
  const phased: WorkflowGraphItem[][] = graph.phases.map(() => []);
  const place = (entry: Entry) => {
    const item = build(entry);
    if (entry.phase !== null && entry.phase >= 0 && entry.phase < phased.length) {
      phased[entry.phase]!.push(item);
    } else {
      unphased.push(item);
    }
  };

  roots.sort((a, b) => compareIds(a.id, b.id)).forEach(place);
  // Any entries remaining unvisited belong to a parent cycle; promote them deterministically.
  [...byId.values()]
    .filter((entry) => !visited.has(entry.id))
    .sort((a, b) => compareIds(a.id, b.id))
    .forEach((entry) => {
      if (!visited.has(entry.id)) place(entry);
    });

  const bands: WorkflowGraphBand[] = [];
  if (unphased.length > 0) bands.push({ phase: null, items: unphased });
  graph.phases.forEach((phase, i) => bands.push({ phase, items: phased[i]! }));
  return { bands };
};

const foldPriority = (item: WorkflowGraphItem): [number, number] => {
  if (item.type === 'group') {
    const { group } = item;
    if (group.failed > 0) return [1, idNum(group.id)];
    return group.done < group.total ? [2, idNum(group.id)] : [4, -idNum(group.id)];
  }
  const { node } = item;
  if (node.status === 'waiting') return [0, idNum(node.id)];
  if (node.status === 'failed' || node.status === 'cancelled' || node.status === 'indeterminate') {
    return [1, idNum(node.id)];
  }
  if (node.status === 'running') return [2, idNum(node.id)];
  if (node.status === 'queued') return [3, idNum(node.id)];
  return [4, -(node.endedAt ?? idNum(node.id))];
};

/** Folds a large group to `limit`: unfinished items first, then newest completed ones. */
export const foldGroupItems = (
  items: readonly WorkflowGraphItem[],
  limit = 24
): { shown: WorkflowGraphItem[]; more: number } => {
  if (items.length <= limit) return { shown: [...items], more: 0 };
  const ordered = [...items].sort((a, b) => {
    const [ab, ar] = foldPriority(a);
    const [bb, br] = foldPriority(b);
    return ab - bb || ar - br || compareIds(itemId(a), itemId(b));
  });
  return { shown: ordered.slice(0, limit), more: ordered.length - limit };
};

/** Cubic Bezier SVG path between two chip boxes (vertical when stacked, horizontal otherwise). */
export const edgePath = (from: Box, to: Box): string => {
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  const tx = to.x + to.width / 2;
  const ty = to.y + to.height / 2;
  if (to.y >= from.y + from.height || from.y >= to.y + to.height) {
    const down = to.y >= from.y + from.height;
    const y1 = down ? from.y + from.height : from.y;
    const y2 = down ? to.y : to.y + to.height;
    const midY = (y1 + y2) / 2;
    return `M ${fx} ${y1} C ${fx} ${midY}, ${tx} ${midY}, ${tx} ${y2}`;
  }
  const right = tx >= fx;
  const x1 = right ? from.x + from.width : from.x;
  const x2 = right ? to.x : to.x + to.width;
  const midX = (x1 + x2) / 2;
  return `M ${x1} ${fy} C ${midX} ${fy}, ${midX} ${ty}, ${x2} ${ty}`;
};

/** Short preview for a joined sub-agent run (`meta.result` else last non-empty `docs.md` line). */
export const nodeResultPreview = (run: SubagentRun | undefined): string | undefined => {
  if (!run) return undefined;
  const text =
    run.meta.result?.trim() ||
    run.docs.md
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .pop();
  if (!text) return undefined;
  return text.length > MAX_PREVIEW_CHARS ? `${text.slice(0, MAX_PREVIEW_CHARS - 1)}…` : text;
};
