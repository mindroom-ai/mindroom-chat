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
export type Box = { x: number; y: number; width: number; height: number };

const STATUS_RANK = {
  waiting: 0,
  failed: 1,
  cancelled: 1,
  indeterminate: 1,
  running: 2,
  queued: 3,
  completed: 4,
} as const;

const idNum = (id: string): number => {
  const m = /^n(\d+)$/.exec(id);
  return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
};
const compareIds = (a: string, b: string): number => idNum(a) - idNum(b) || a.localeCompare(b);
const itemId = (item: WorkflowGraphItem): string =>
  item.type === 'group' ? item.group.id : item.node.id;

/** Builds phase bands and nested node/group trees in one indexed pass. */
export const layoutWorkflowRunGraph = (graph: WorkflowRunGraph): { bands: WorkflowGraphBand[] } => {
  type Entry = {
    id: string;
    phase: number | null;
    parents: (string | null)[];
    node?: WorkflowRunNode;
    group?: WorkflowRunGroup;
  };
  const byId = new Map<string, Entry>([
    ...graph.nodes.map((node): [string, Entry] => [
      node.id,
      { id: node.id, phase: node.phase, parents: [node.session, node.group], node },
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

  const visited = new Set<string>();
  const build = (e: Entry): WorkflowGraphItem => {
    visited.add(e.id);
    const kids = (childrenOf.get(e.id) ?? [])
      .filter((c) => !visited.has(c.id))
      .sort((a, b) => compareIds(a.id, b.id))
      .map(build);
    if (e.group) return { type: 'group', group: e.group, items: kids };
    return kids.length
      ? { type: 'node', node: e.node!, children: kids }
      : { type: 'node', node: e.node! };
  };

  const unphased: WorkflowGraphItem[] = [];
  const phased: WorkflowGraphItem[][] = graph.phases.map(() => []);
  const place = (e: Entry) => {
    const item = build(e);
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

  const bands: WorkflowGraphBand[] = unphased.length ? [{ phase: null, items: unphased }] : [];
  graph.phases.forEach((phase, i) => bands.push({ phase, items: phased[i]! }));
  return { bands };
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

/** Cubic Bezier SVG path between two chip boxes (vertical when stacked, horizontal otherwise). */
export const edgePath = (from: Box, to: Box): string => {
  const fx = from.x + from.width / 2;
  const fy = from.y + from.height / 2;
  const tx = to.x + to.width / 2;
  const ty = to.y + to.height / 2;
  if (to.y >= from.y + from.height || from.y >= to.y + to.height) {
    const down = to.y >= from.y + from.height;
    const [y1, y2] = down ? [from.y + from.height, to.y] : [from.y, to.y + to.height];
    const mid = (y1 + y2) / 2;
    return `M ${fx} ${y1} C ${fx} ${mid}, ${tx} ${mid}, ${tx} ${y2}`;
  }
  const [x1, x2] = tx >= fx ? [from.x + from.width, to.x] : [from.x, to.x + to.width];
  const mid = (x1 + x2) / 2;
  return `M ${x1} ${fy} C ${mid} ${fy}, ${mid} ${ty}, ${x2} ${ty}`;
};

/** Short preview for a joined sub-agent run (`meta.result` else last non-empty `docs.md` line). */
export const nodeResultPreview = (run: SubagentRun | undefined): string | undefined => {
  const text =
    run?.meta.result?.trim() ||
    run?.docs.md
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .pop();
  return !text ? undefined : text.length > 300 ? `${text.slice(0, 299)}…` : text;
};
