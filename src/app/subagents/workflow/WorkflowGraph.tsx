import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Button, ProgressBar, Text } from 'folds';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { getAiRunCompactModelLabel } from '../../matrix/protocol/aiRunModelLabel';
import type {
  WorkflowNodeStatus,
  WorkflowRunEdge,
  WorkflowRunGroup,
  WorkflowRunNode,
} from '../../matrix/protocol/workflowFrame';
import { formatCostUsd } from '../../messages/agent-run/aiRunDisplay';
import type { SubagentRun } from '../../messages/live/subagentRunStore';
import { formatWorkflowElapsed } from '../../messages/workflow-run/workflowRunLabels';
import * as cardCss from '../../messages/workflow-run/WorkflowRunCard.css';
import { ownDirectionLine } from '../../ui/directional';
import { AgentAvatar, useAgentProfile } from '../AgentAvatar';
import { formatTokens } from '../runUsage';
import {
  edgePath,
  foldGroupItems,
  type Box,
  type WorkflowGraphBand,
  type WorkflowGraphItem,
} from './workflowGraphModel';
import * as css from './workflowPanel.css';

const GROUP_KIND_KEYS = new Map([
  ['foreach', 'mindroomUi.workflowRun.group.foreach'],
  ['parallel', 'mindroomUi.workflowRun.group.parallel'],
  ['run', 'mindroomUi.workflowRun.group.run'],
  ['workflow', 'mindroomUi.workflowRun.group.workflow'],
] as const);
const WAITING_ON_KEYS = {
  user: 'mindroomUi.workflowRun.node.waitingOn.user',
  approval: 'mindroomUi.workflowRun.node.waitingOn.approval',
  peer: 'mindroomUi.workflowRun.node.waitingOn.peer',
} as const;

export const isLiveWorkflowNodeStatus = (status: WorkflowNodeStatus): boolean =>
  status === 'queued' || status === 'running' || status === 'waiting';

type RenderCtx = {
  room: Room;
  subagentsByRun: ReadonlyMap<string, SubagentRun>;
  selectedId: string | null;
  now: number;
  t: TFunction;
  language: string;
  onSelect: (id: string) => void;
};
type ChipProps = Omit<RenderCtx, 'subagentsByRun' | 'selectedId'> & {
  node: WorkflowRunNode;
  subagentRun?: SubagentRun;
  selected: boolean;
};

/** Leaf chip memoized by shallow props so deltas re-render only the nodes they update. */
const WorkflowNodeChip = memo(function WorkflowNodeChip({
  node,
  subagentRun,
  room,
  selected,
  now,
  t,
  language,
  onSelect,
}: ChipProps) {
  const agentProfile = useAgentProfile(room, node.agent ?? '');
  const model = subagentRun?.meta.model
    ? getAiRunCompactModelLabel(subagentRun.meta.model)
    : node.model;
  const usage = subagentRun?.meta.usage ?? node.usage;
  const tokens = usage ? usage.inputTokens + usage.outputTokens : 0;
  const cost =
    usage?.costUsd !== undefined && (usage.costUsd > 0 || tokens > 0)
      ? formatCostUsd(usage.costUsd, language)
      : undefined;
  const elapsed = formatWorkflowElapsed(
    node.startedAt,
    node.endedAt,
    isLiveWorkflowNodeStatus(node.status) ? now : null,
    language
  );
  const note = node.cached
    ? t('mindroomUi.workflowRun.node.reused')
    : node.status === 'queued'
    ? t('mindroomUi.workflowRun.node.queued')
    : node.status === 'indeterminate'
    ? t('mindroomUi.workflowRun.node.mayHaveRun')
    : node.status === 'waiting' && node.waitingOn
    ? t(WAITING_ON_KEYS[node.waitingOn])
    : undefined;
  const meta = [
    node.agent ? agentProfile.name : undefined,
    model,
    node.kind === 'session' && node.turns > 0
      ? t('mindroomUi.workflowRun.node.sessionTurns', { count: node.turns })
      : undefined,
    tokens > 0 ? formatTokens(tokens, language) : undefined,
    cost,
    elapsed,
  ].filter(Boolean);

  return (
    <button
      type="button"
      className={css.Chip}
      aria-pressed={selected}
      data-workflow-chip-id={node.id}
      data-workflow-node-status={node.status}
      onClick={() => onSelect(node.id)}
    >
      <span className={css.ChipTop}>
        <span className={css.NodeDot[node.status]} aria-hidden />
        {node.agent && <AgentAvatar agent={agentProfile} size="200" />}
        <span className={css.ChipLabel} {...ownDirectionLine}>
          {node.label}
        </span>
      </span>
      <span className={css.ChipMeta}>
        {meta.map((part, i) => (
          // Metadata fragments are static positional badges per chip.
          // eslint-disable-next-line react/no-array-index-key
          <span key={i}>{part}</span>
        ))}
      </span>
      {note && <span className={css.ChipNote}>{note}</span>}
    </button>
  );
});

function WorkflowGroupBox({
  group,
  items,
  ctx,
}: {
  group: WorkflowRunGroup;
  items: readonly WorkflowGraphItem[];
  ctx: RenderCtx;
}) {
  const [expanded, setExpanded] = useState(false);
  const { shown, more } = expanded ? { shown: items, more: 0 } : foldGroupItems(items);
  const kindKey = GROUP_KIND_KEYS.get(group.kind as never);
  return (
    <div className={css.GroupBox} data-workflow-group-id={group.id}>
      <div className={cardCss.Row} style={{ justifyContent: 'space-between' }}>
        <Text as="span" size="T300" className={css.StrongText}>
          {kindKey ? ctx.t(kindKey) : group.kind}
        </Text>
        <Text as="span" size="T200" priority="300">
          {ctx.t('mindroomUi.workflowRun.group.progress', { done: group.done, total: group.total })}
        </Text>
        {group.failed > 0 && (
          <Text as="span" size="T200" className={cardCss.CriticalText}>
            {ctx.t('mindroomUi.workflowRun.group.failed', { count: group.failed })}
          </Text>
        )}
      </div>
      <ProgressBar
        variant="Primary"
        size="300"
        min={0}
        max={Math.max(1, group.total)}
        value={Math.min(group.done, group.total)}
      />
      <WorkflowItemsList items={shown} ctx={ctx} />
      {more > 0 && (
        <div>
          <Button
            type="button"
            size="300"
            variant="Secondary"
            fill="Soft"
            onClick={() => setExpanded(true)}
          >
            <Text size="B300">
              {ctx.t('mindroomUi.workflowRun.panel.showMore', { count: more })}
            </Text>
          </Button>
        </div>
      )}
    </div>
  );
}

function WorkflowItemsList({
  items,
  ctx,
}: {
  items: readonly WorkflowGraphItem[];
  ctx: RenderCtx;
}) {
  return (
    <div className={css.ItemsGrid}>
      {items.map((item) =>
        item.type === 'group' ? (
          <WorkflowGroupBox key={item.group.id} group={item.group} items={item.items} ctx={ctx} />
        ) : (
          <div key={item.node.id} className={css.Stack}>
            <WorkflowNodeChip
              node={item.node}
              subagentRun={item.node.run ? ctx.subagentsByRun.get(item.node.run) : undefined}
              room={ctx.room}
              selected={ctx.selectedId === item.node.id}
              now={isLiveWorkflowNodeStatus(item.node.status) ? ctx.now : 0}
              t={ctx.t}
              language={ctx.language}
              onSelect={ctx.onSelect}
            />
            {item.children && item.children.length > 0 && (
              <div className={css.NestedChildren}>
                <WorkflowItemsList items={item.children} ctx={ctx} />
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

/** Renders phase bands, nested groups/turns, memoized chips, and the measured SVG edge overlay. */
export function WorkflowGraphCanvas({
  bands,
  edges,
  ...rest
}: Omit<RenderCtx, 't' | 'language'> & {
  bands: readonly WorkflowGraphBand[];
  edges: readonly WorkflowRunEdge[];
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const canvasRef = useRef<HTMLDivElement>(null);
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const edgesKey = useMemo(
    () => edges.map((e) => `${e.from}>${e.to}:${e.count}`).join(','),
    [edges]
  );
  const [paths, setPaths] = useState<{ key: string; d: string }[]>([]);

  useLayoutEffect(() => {
    const measure = () => {
      const canvas = canvasRef.current;
      if (!canvas || !edgesRef.current.length) return setPaths((p) => (p.length ? [] : p));
      const root = canvas.getBoundingClientRect();
      const boxes = new Map<string, Box>();
      canvas.querySelectorAll<HTMLElement>('[data-workflow-chip-id]').forEach((el) => {
        const id = el.dataset.workflowChipId;
        if (!id) return;
        const r = el.getBoundingClientRect();
        boxes.set(id, {
          x: r.left - root.left,
          y: r.top - root.top,
          width: r.width,
          height: r.height,
        });
      });
      const next = edgesRef.current.flatMap((e) => {
        const [a, b] = [boxes.get(e.from), boxes.get(e.to)];
        return a && b ? [{ key: `${e.from}->${e.to}`, d: edgePath(a, b) }] : [];
      });
      return setPaths((p) =>
        p.length === next.length && p.every((x, i) => x.key === next[i]?.key && x.d === next[i]?.d)
          ? p
          : next
      );
    };
    measure();
    const canvas = canvasRef.current;
    if (!canvas || !edgesKey || typeof ResizeObserver === 'undefined') return undefined;
    let rafId = 0;
    const observer = new ResizeObserver(() => {
      if (!rafId)
        rafId = window.requestAnimationFrame(() => {
          rafId = 0;
          measure();
        });
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [edgesKey]);

  const ctx: RenderCtx = { ...rest, t, language };
  return (
    <div ref={canvasRef} className={css.GraphCanvas}>
      {paths.length > 0 && (
        <svg className={css.EdgeOverlay} aria-hidden="true">
          {paths.map((edge) => (
            <path key={edge.key} d={edge.d} className={css.EdgePath} />
          ))}
        </svg>
      )}
      {bands.map((band, index) => (
        <section key={band.phase ?? `unphased-${index}`} className={css.Band}>
          {band.phase !== null && (
            <Text as="h3" size="T300" className={css.StrongText} {...ownDirectionLine}>
              {band.phase}
            </Text>
          )}
          <WorkflowItemsList items={band.items} ctx={ctx} />
        </section>
      ))}
    </div>
  );
}
