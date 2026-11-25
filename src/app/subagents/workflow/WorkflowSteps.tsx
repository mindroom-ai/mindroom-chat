import { memo, useState } from 'react';
import type { TFunction } from 'i18next';
import { Button, Text } from 'folds';
import type { WorkflowRunGroup, WorkflowRunNode } from '../../matrix/protocol/workflowFrame';
import {
  formatWorkflowElapsed,
  workflowNodeStatusLabel,
} from '../../messages/workflow-run/workflowRunLabels';
import * as cardCss from '../../messages/workflow-run/WorkflowRunCard.css';
import { ownDirectionLine } from '../../ui/directional';
import {
  foldGroupItems,
  isLiveWorkflowNodeStatus,
  sessionBadgeLabel,
  shortNodeError,
  type WorkflowGraphItem,
  type WorkflowSessionInfo,
} from './workflowGraphModel';
import * as css from './workflowPanel.css';

const GROUP_KIND_KEYS = new Map([
  ['foreach', 'mindroomUi.workflowRun.group.foreach'],
  ['parallel', 'mindroomUi.workflowRun.group.parallel'],
  ['run', 'mindroomUi.workflowRun.group.run'],
  ['workflow', 'mindroomUi.workflowRun.group.workflow'],
] as const);

export const groupKindLabel = (kind: string, t: TFunction): string => {
  const key = GROUP_KIND_KEYS.get(kind as never);
  return key ? t(key) : kind;
};

export const formatNodeErrorBadge = (error: string | null, t: TFunction): string | undefined => {
  const short = shortNodeError(error);
  if (!short) return undefined;
  return short.kind === 'timeout' ? t('mindroomUi.workflowRun.node.timeout') : short.text;
};

export const isSessionHighlighted = (
  node: WorkflowRunNode,
  selected: boolean,
  selectedSessionId: string | null
): boolean =>
  !selected &&
  Boolean(
    selectedSessionId && (node.session === selectedSessionId || node.id === selectedSessionId)
  );

export const resolveSessionLabel = (
  node: WorkflowRunNode,
  sessionsById: ReadonlyMap<string, WorkflowSessionInfo>
): string | undefined =>
  node.session ? sessionBadgeLabel(sessionsById.get(node.session)) : undefined;

export function GroupHeaderRow({
  group,
  t,
  compact = false,
}: {
  group: WorkflowRunGroup;
  t: TFunction;
  compact?: boolean;
}) {
  return (
    <div className={css.GroupHeader}>
      <Text as="span" size={compact ? 'T200' : 'T300'} className={css.StrongText}>
        {groupKindLabel(group.kind, t)}
      </Text>
      <Text as="span" size="T200" priority="300" className={`${css.MutedNum} ${css.EndAlign}`}>
        {t('mindroomUi.workflowRun.group.progress', { done: group.done, total: group.total })}
      </Text>
      {group.failed > 0 && (
        <Text as="span" size="T200" className={cardCss.CriticalText}>
          {t('mindroomUi.workflowRun.group.failed', { count: group.failed })}
        </Text>
      )}
    </div>
  );
}

export function ShowMoreButton({
  count,
  t,
  onExpand,
}: {
  count: number;
  t: TFunction;
  onExpand: () => void;
}) {
  return (
    <div>
      <Button type="button" size="300" variant="Secondary" fill="Soft" onClick={onExpand}>
        <Text size="B300">{t('mindroomUi.workflowRun.panel.showMore', { count })}</Text>
      </Button>
    </div>
  );
}

export type StepsCtx = {
  sessionsById: ReadonlyMap<string, WorkflowSessionInfo>;
  selectedId: string | null;
  selectedSessionId: string | null;
  now: number;
  t: TFunction;
  language: string;
  onSelect: (id: string) => void;
};

const WorkflowStepRow = memo(function WorkflowStepRow({
  node,
  sessionLabel,
  selected,
  sessionHighlighted,
  now,
  t,
  language,
  onSelect,
}: {
  node: WorkflowRunNode;
  sessionLabel?: string;
  selected: boolean;
  sessionHighlighted: boolean;
  now: number;
  t: TFunction;
  language: string;
  onSelect: (id: string) => void;
}) {
  const isLive = isLiveWorkflowNodeStatus(node.status);
  const elapsed = formatWorkflowElapsed(
    node.startedAt,
    node.endedAt,
    isLive ? now : null,
    language
  );
  const errorBadge = node.status === 'failed' ? formatNodeErrorBadge(node.error, t) : undefined;
  const statusLabel = workflowNodeStatusLabel(node.status, t, node.waitingOn);
  return (
    <button
      type="button"
      className={css.StepRow}
      aria-pressed={selected}
      data-workflow-chip-id={node.id}
      data-workflow-node-status={node.status}
      data-session-highlighted={sessionHighlighted || undefined}
      onClick={() => onSelect(node.id)}
    >
      <span className={css.NodeDot[node.status]} aria-hidden />
      <span className={css.ChipLabel} {...ownDirectionLine}>
        {node.label}
      </span>
      <span className={css.VisuallyHidden}>{` (${statusLabel})`}</span>
      {sessionLabel && (
        <span className={css.SessionBadge} {...ownDirectionLine}>
          @{sessionLabel}
        </span>
      )}
      {errorBadge && (
        <span className={css.ErrorPill} {...ownDirectionLine}>
          {errorBadge}
        </span>
      )}
      {elapsed && <span className={`${css.MutedNum} ${css.EndAlign}`}>{elapsed}</span>}
    </button>
  );
});

function StepsGroup({
  group,
  items,
  ctx,
}: {
  group: WorkflowRunGroup;
  items: readonly WorkflowGraphItem[];
  ctx: StepsCtx;
}) {
  const [expanded, setExpanded] = useState(false);
  const parallel = group.kind === 'parallel' || group.kind === 'foreach';
  const { shown, more } = expanded
    ? { shown: items, more: 0 }
    : foldGroupItems(items, 24, !parallel);
  return (
    <div className={css.Stack} data-workflow-group-id={group.id}>
      <GroupHeaderRow group={group} t={ctx.t} compact />
      <div className={css.IndentRail}>
        <WorkflowStepsItems items={shown} ctx={ctx} />
        {more > 0 && <ShowMoreButton count={more} t={ctx.t} onExpand={() => setExpanded(true)} />}
      </div>
    </div>
  );
}

/** Compact vertical outline tree for the `Steps` tab; never collapses plumbing nodes. */
export function WorkflowStepsItems({
  items,
  ctx,
}: {
  items: readonly WorkflowGraphItem[];
  ctx: StepsCtx;
}) {
  return (
    <div className={css.Stack}>
      {items.map((item) => {
        if (item.type === 'group') {
          return <StepsGroup key={item.group.id} group={item.group} items={item.items} ctx={ctx} />;
        }
        const selected = ctx.selectedId === item.node.id;
        return (
          <div key={item.node.id} className={css.Stack}>
            <WorkflowStepRow
              node={item.node}
              sessionLabel={resolveSessionLabel(item.node, ctx.sessionsById)}
              selected={selected}
              sessionHighlighted={isSessionHighlighted(item.node, selected, ctx.selectedSessionId)}
              now={isLiveWorkflowNodeStatus(item.node.status) ? ctx.now : 0}
              t={ctx.t}
              language={ctx.language}
              onSelect={ctx.onSelect}
            />
            {item.children && item.children.length > 0 && (
              <div className={css.IndentRail}>
                <WorkflowStepsItems items={item.children} ctx={ctx} />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
