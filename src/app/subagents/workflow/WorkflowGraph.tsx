import { Fragment, memo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Text } from 'folds';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { localDigits } from '../../lib/localDigits';
import type { WorkflowRunGroup, WorkflowRunNode } from '../../matrix/protocol/workflowFrame';
import type { SubagentRun } from '../../messages/live/subagentRunStore';
import {
  formatWorkflowElapsed,
  workflowNodeWaitLabel,
} from '../../messages/workflow-run/workflowRunLabels';
import { ownDirectionLine } from '../../ui/directional';
import { AgentAvatar, useAgentProfile } from '../AgentAvatar';
import {
  foldGroupItems,
  getWorkflowNodeMetrics,
  groupFlowItems,
  isCollapsiblePlumbingItem,
  isLiveWorkflowNodeStatus,
  type WorkflowGraphBand,
  type WorkflowGraphItem,
  type WorkflowPeerBridge,
  type WorkflowSessionInfo,
} from './workflowGraphModel';
import {
  formatNodeErrorBadge,
  GroupHeaderRow,
  isSessionHighlighted,
  resolveSessionLabel,
  ShowMoreButton,
  WorkflowStepsItems,
} from './WorkflowSteps';
import * as css from './workflowPanel.css';

export { isLiveWorkflowNodeStatus };

export type WorkflowGraphViewProps = {
  bands: readonly WorkflowGraphBand[];
  room: Room;
  subagentsByRun: ReadonlyMap<string, SubagentRun>;
  sessionsById: ReadonlyMap<string, WorkflowSessionInfo>;
  peerBridgesByGroup: ReadonlyMap<string, readonly WorkflowPeerBridge[]>;
  selectedId: string | null;
  selectedSessionId: string | null;
  now: number;
  onSelect: (id: string) => void;
};

type RenderCtx = Omit<WorkflowGraphViewProps, 'bands'> & { t: TFunction; language: string };

const FORK_ONE = ['M 50 0 L 50 18'];
const FORK_TWO = ['M 50 0 C 50 9, 25 9, 25 18', 'M 50 0 C 50 9, 75 9, 75 18'];
const JOIN_TWO = ['M 25 0 C 25 9, 50 9, 50 18', 'M 75 0 C 75 9, 50 9, 50 18'];
const FORK_THREE = ['M 50 0 C 50 9, 17 9, 17 18', 'M 50 0 L 50 18', 'M 50 0 C 50 9, 83 9, 83 18'];
const JOIN_THREE = ['M 17 0 C 17 9, 50 9, 50 18', 'M 50 0 L 50 18', 'M 83 0 C 83 9, 50 9, 50 18'];

function FlowArrowSvg() {
  return (
    <div className={css.FlowConnector} aria-hidden="true">
      <svg viewBox="0 0 16 16" width="16" height="16">
        <path d="M 8 0 L 8 13 M 4.5 9.5 L 8 13.5 L 11.5 9.5" className={css.ConnectorPath} />
      </svg>
    </div>
  );
}

/** Responsive fork/join curves synced via CSS @container queries to BranchGrid's 1/2/3 columns. */
function ForkJoinSvg({ direction, count }: { direction: 'fork' | 'join'; count: number }) {
  const two = direction === 'fork' ? FORK_TWO : JOIN_TWO;
  const three = direction === 'fork' ? FORK_THREE : JOIN_THREE;
  const draw = (paths: readonly string[]) =>
    paths.map((d) => (
      <path key={d} d={d} className={css.ConnectorPath} vectorEffect="non-scaling-stroke" />
    ));
  return (
    <svg
      className={css.ForkJoinSvg}
      viewBox="0 0 100 18"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {count <= 1 ? (
        draw(FORK_ONE)
      ) : count === 2 ? (
        <>
          <g className={css.ForkVis.two}>{draw(two)}</g>
          <g className={css.ForkVis.one}>{draw(FORK_ONE)}</g>
        </>
      ) : (
        <>
          <g className={css.ForkVis.three}>{draw(three)}</g>
          <g className={css.ForkVis.twoMid}>{draw(two)}</g>
          <g className={css.ForkVis.one}>{draw(FORK_ONE)}</g>
        </>
      )}
    </svg>
  );
}

function PeerBridges({
  bridges,
  t,
  language,
}: {
  bridges: readonly WorkflowPeerBridge[];
  t: TFunction;
  language: string;
}) {
  if (!bridges.length) return null;
  return (
    <div className={css.CenterWrap}>
      {bridges.map((b) => (
        <span key={b.key} className={css.PeerBridgePill}>
          <span dir="ltr" aria-hidden="true">
            <bdi>{b.fromLabel}</bdi> {b.bidirectional ? '↔' : '→'} <bdi>{b.toLabel}</bdi> ·{' '}
            {localDigits(String(b.count), language)}
          </span>
          <span className={css.VisuallyHidden}>
            {t(
              b.bidirectional
                ? 'mindroomUi.workflowRun.node.routeBetween'
                : 'mindroomUi.workflowRun.node.routeTo',
              { from: b.fromLabel, to: b.toLabel, count: b.count }
            )}
          </span>
        </span>
      ))}
    </div>
  );
}

/** Leaf card memoized by shallow props so live deltas re-render only the nodes they update. */
const WorkflowNodeCard = memo(function WorkflowNodeCard({
  node,
  subagentRun,
  sessionLabel,
  room,
  selected,
  sessionHighlighted,
  now,
  t,
  language,
  onSelect,
}: {
  node: WorkflowRunNode;
  subagentRun?: SubagentRun;
  sessionLabel?: string;
  room: Room;
  selected: boolean;
  sessionHighlighted: boolean;
  now: number;
  t: TFunction;
  language: string;
  onSelect: (id: string) => void;
}) {
  const agentProfile = useAgentProfile(room, node.agent ?? '');
  const { model, tokens, cost, elapsed } = getWorkflowNodeMetrics(node, subagentRun, now, language);
  const errorBadge = node.status === 'failed' ? formatNodeErrorBadge(node.error, t) : undefined;
  const note = node.cached
    ? t('mindroomUi.workflowRun.node.reused')
    : node.status === 'queued'
      ? t('mindroomUi.workflowRun.node.queued')
      : node.status === 'indeterminate'
        ? t('mindroomUi.workflowRun.node.mayHaveRun')
        : node.status === 'waiting' && node.waitingOn
          ? workflowNodeWaitLabel(node.waitingOn, t)
          : undefined;
  const meta = [
    node.agent ? agentProfile.name : undefined,
    model,
    node.kind === 'session' && node.turns > 0
      ? t('mindroomUi.workflowRun.node.sessionTurns', { count: node.turns })
      : undefined,
    tokens,
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
      data-session-highlighted={sessionHighlighted || undefined}
      onClick={() => onSelect(node.id)}
    >
      <span className={css.ChipTop}>
        <span className={css.NodeDot[node.status]} aria-hidden />
        {node.agent && <AgentAvatar agent={agentProfile} size="200" />}
        <span className={css.ChipLabel} {...ownDirectionLine}>
          {node.label}
        </span>
        {sessionLabel && (
          <span className={css.SessionBadge} {...ownDirectionLine}>
            @{sessionLabel}
          </span>
        )}
      </span>
      {meta.length > 0 && (
        <span className={css.ChipMeta}>
          {meta.map((part, i) => (
            // Metadata fragments are static positional badges per card.
            // eslint-disable-next-line react/no-array-index-key
            <span key={i}>{part}</span>
          ))}
        </span>
      )}
      {errorBadge && (
        <span className={css.ErrorPill} {...ownDirectionLine}>
          {errorBadge}
        </span>
      )}
      {note && <span className={css.ChipNote}>{note}</span>}
    </button>
  );
});

const WorkflowPlumbingChip = memo(function WorkflowPlumbingChip({
  node,
  selected,
  language,
  onSelect,
}: {
  node: WorkflowRunNode;
  selected: boolean;
  language: string;
  onSelect: (id: string) => void;
}) {
  const elapsed = formatWorkflowElapsed(node.startedAt, node.endedAt, null, language);
  return (
    <button
      type="button"
      className={css.PlumbingPill}
      aria-pressed={selected}
      data-workflow-chip-id={node.id}
      data-workflow-node-status={node.status}
      onClick={() => onSelect(node.id)}
    >
      <span className={css.NodeDot[node.status]} aria-hidden />
      <span className={css.ChipLabel} {...ownDirectionLine}>
        {node.label}
      </span>
      {elapsed && <span className={css.MutedNum}>{elapsed}</span>}
    </button>
  );
});

function PlumbingGroupPill({ nodes, ctx }: { nodes: readonly WorkflowRunNode[]; ctx: RenderCtx }) {
  const [expanded, setExpanded] = useState(false);
  const open = expanded || nodes.some((n) => n.id === ctx.selectedId);
  return (
    <div className={css.CenterWrap}>
      <button
        type="button"
        className={css.PlumbingPill}
        aria-expanded={open}
        onClick={() => setExpanded((cur) => !cur)}
      >
        <span className={css.NodeDot.completed} aria-hidden />
        <span>{ctx.t('mindroomUi.workflowRun.panel.setupSteps', { count: nodes.length })}</span>
      </button>
      {open &&
        nodes.map((node) => (
          <WorkflowPlumbingChip
            key={node.id}
            node={node}
            selected={ctx.selectedId === node.id}
            language={ctx.language}
            onSelect={ctx.onSelect}
          />
        ))}
    </div>
  );
}

function renderFlowNode(item: Extract<WorkflowGraphItem, { type: 'node' }>, ctx: RenderCtx) {
  const selected = ctx.selectedId === item.node.id;
  if (isCollapsiblePlumbingItem(item)) {
    return (
      <div className={css.CenterWrap}>
        <WorkflowPlumbingChip
          node={item.node}
          selected={selected}
          language={ctx.language}
          onSelect={ctx.onSelect}
        />
      </div>
    );
  }
  return (
    <div className={css.Stack}>
      <WorkflowNodeCard
        node={item.node}
        subagentRun={item.node.run ? ctx.subagentsByRun.get(item.node.run) : undefined}
        sessionLabel={resolveSessionLabel(item.node, ctx.sessionsById)}
        room={ctx.room}
        selected={selected}
        sessionHighlighted={isSessionHighlighted(item.node, selected, ctx.selectedSessionId)}
        now={isLiveWorkflowNodeStatus(item.node.status) ? ctx.now : 0}
        t={ctx.t}
        language={ctx.language}
        onSelect={ctx.onSelect}
      />
      {item.children && item.children.length > 0 && (
        <div className={css.IndentRail}>
          <WorkflowFlowList items={item.children} ctx={ctx} />
        </div>
      )}
    </div>
  );
}

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
  const parallel = group.kind === 'parallel' || group.kind === 'foreach';
  const { shown, more } = expanded
    ? { shown: items, more: 0 }
    : foldGroupItems(items, 24, !parallel);
  const total = Math.max(1, group.total);
  const done = Math.min(group.done, group.total);
  const pct = Math.min(100, Math.round((done / total) * 100));
  const tone =
    group.failed > 0 ? 'failed' : group.total > 0 && done >= group.total ? 'done' : 'live';
  const branchVariant = shown.length <= 1 ? 'one' : shown.length === 2 ? 'two' : 'many';
  const bridges = ctx.peerBridgesByGroup.get(group.id) ?? [];

  return (
    <div className={css.GroupBox} data-workflow-group-id={group.id}>
      <GroupHeaderRow group={group} t={ctx.t} />
      <div className={css.ProgressTrack} aria-hidden="true">
        <div className={css.ProgressFill[tone]} style={{ inlineSize: `${pct}%` }} />
      </div>
      {parallel ? (
        <>
          {shown.length > 0 && <ForkJoinSvg direction="fork" count={shown.length} />}
          {shown.length > 0 && (
            <div className={css.BranchGrid[branchVariant]}>
              {shown.map((item) =>
                item.type === 'group' ? (
                  <WorkflowGroupBox
                    key={item.group.id}
                    group={item.group}
                    items={item.items}
                    ctx={ctx}
                  />
                ) : (
                  <Fragment key={item.node.id}>{renderFlowNode(item, ctx)}</Fragment>
                )
              )}
            </div>
          )}
          <PeerBridges bridges={bridges} t={ctx.t} language={ctx.language} />
          {shown.length > 0 && <ForkJoinSvg direction="join" count={shown.length} />}
        </>
      ) : (
        <>
          <WorkflowFlowList items={shown} ctx={ctx} />
          <PeerBridges bridges={bridges} t={ctx.t} language={ctx.language} />
        </>
      )}
      {more > 0 && <ShowMoreButton count={more} t={ctx.t} onExpand={() => setExpanded(true)} />}
    </div>
  );
}

function WorkflowFlowList({ items, ctx }: { items: readonly WorkflowGraphItem[]; ctx: RenderCtx }) {
  const flowItems = groupFlowItems(items);
  return (
    <div className={css.GraphCanvas}>
      {flowItems.map((item, idx) => (
        <Fragment
          key={
            item.type === 'group'
              ? item.group.id
              : item.type === 'plumb_group'
                ? item.id
                : item.node.id
          }
        >
          {idx > 0 && <FlowArrowSvg />}
          {item.type === 'group' ? (
            <WorkflowGroupBox group={item.group} items={item.items} ctx={ctx} />
          ) : item.type === 'plumb_group' ? (
            <PlumbingGroupPill nodes={item.nodes} ctx={ctx} />
          ) : (
            renderFlowNode(item, ctx)
          )}
        </Fragment>
      ))}
    </div>
  );
}

/** Visual flow graph (`flow`) or compact outline tree (`steps`) for a workflow run. */
export function WorkflowGraphView({
  bands,
  mode,
  ...rest
}: WorkflowGraphViewProps & { mode: 'flow' | 'steps' }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const ctx: RenderCtx = { ...rest, t, language };
  return (
    <div className={mode === 'flow' ? css.GraphCanvas : css.Band}>
      {bands.map((band, index) => (
        <Fragment key={band.phase ?? `unphased-${index}`}>
          {mode === 'flow' && index > 0 && <FlowArrowSvg />}
          <section className={css.Band}>
            {band.phase !== null && (
              <div className={css.PhaseHeader}>
                <Text as="h3" size="T200" className={css.PhaseHeading} {...ownDirectionLine}>
                  {band.phase}
                </Text>
              </div>
            )}
            {mode === 'flow' ? (
              <WorkflowFlowList items={band.items} ctx={ctx} />
            ) : (
              <WorkflowStepsItems items={band.items} ctx={ctx} />
            )}
          </section>
        </Fragment>
      ))}
    </div>
  );
}
