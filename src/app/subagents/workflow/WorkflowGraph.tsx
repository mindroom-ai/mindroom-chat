import { memo, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Button, Text } from 'folds';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { formatWorkDuration } from '../../lib/time';
import { getAiRunCompactModelLabel } from '../../matrix/protocol/aiRunModelLabel';
import type {
  WorkflowNodeStatus,
  WorkflowRunGroup,
  WorkflowRunNode,
} from '../../matrix/protocol/workflowFrame';
import { formatCostUsd } from '../../messages/agent-run/aiRunDisplay';
import type { SubagentRun } from '../../messages/live/subagentRunStore';
import * as cardCss from '../../messages/workflow-run/WorkflowRunCard.css';
import { ownDirectionLine } from '../../ui/directional';
import { AgentAvatar, useAgentProfile } from '../AgentAvatar';
import { formatTokens } from '../runUsage';
import {
  foldGroupItems,
  type WorkflowGraphBand,
  type WorkflowGraphItem,
} from './workflowGraphModel';
import * as css from './workflowPanel.css';

const GROUP_KIND_KEYS = {
  foreach: 'mindroomUi.workflowRun.group.foreach',
  parallel: 'mindroomUi.workflowRun.group.parallel',
  run: 'mindroomUi.workflowRun.group.run',
  workflow: 'mindroomUi.workflowRun.group.workflow',
} as const;

const WAITING_ON_KEYS = {
  user: 'mindroomUi.workflowRun.node.waitingOn.user',
  approval: 'mindroomUi.workflowRun.node.waitingOn.approval',
  peer: 'mindroomUi.workflowRun.node.waitingOn.peer',
} as const;

export const isLiveWorkflowNodeStatus = (status: WorkflowNodeStatus): boolean =>
  status === 'queued' || status === 'running' || status === 'waiting';

type NodeChipProps = {
  node: WorkflowRunNode;
  subagentRun?: SubagentRun;
  room: Room;
  selected: boolean;
  now: number;
  t: TFunction;
  language: string;
  onSelect: (id: string) => void;
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
}: NodeChipProps) {
  const agentProfile = useAgentProfile(room, node.agent ?? '');
  const modelLabel = subagentRun?.meta.model
    ? getAiRunCompactModelLabel(subagentRun.meta.model)
    : node.model;
  const usage = subagentRun?.meta.usage ?? node.usage;
  const tokens = usage ? usage.inputTokens + usage.outputTokens : 0;
  const cost =
    usage?.costUsd !== undefined && (usage.costUsd > 0 || tokens > 0)
      ? formatCostUsd(usage.costUsd, language)
      : undefined;
  const elapsed =
    node.startedAt === null
      ? undefined
      : isLiveWorkflowNodeStatus(node.status) && now > 0
      ? formatWorkDuration(Math.max(0, now - node.startedAt * 1000), language)
      : node.endedAt !== null
      ? formatWorkDuration(Math.max(0, (node.endedAt - node.startedAt) * 1000), language)
      : undefined;
  const note = node.cached
    ? t('mindroomUi.workflowRun.node.reused')
    : node.status === 'queued'
    ? t('mindroomUi.workflowRun.node.queued')
    : node.status === 'indeterminate'
    ? t('mindroomUi.workflowRun.node.mayHaveRun')
    : node.status === 'waiting' && node.waitingOn
    ? t(WAITING_ON_KEYS[node.waitingOn])
    : undefined;

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
        {node.agent && <span>{agentProfile.name}</span>}
        {modelLabel && <span>{modelLabel}</span>}
        {node.kind === 'session' && node.turns > 0 && (
          <span>{t('mindroomUi.workflowRun.node.sessionTurns', { count: node.turns })}</span>
        )}
        {tokens > 0 && <span>{formatTokens(tokens, language)}</span>}
        {cost && <span>{cost}</span>}
        {elapsed && <span>{elapsed}</span>}
      </span>
      {note && <span className={css.ChipNote}>{note}</span>}
    </button>
  );
});

type ListProps = {
  items: readonly WorkflowGraphItem[];
  room: Room;
  subagentsByRun: ReadonlyMap<string, SubagentRun>;
  selectedId: string | null;
  now: number;
  t: TFunction;
  language: string;
  onSelect: (id: string) => void;
};

function WorkflowGroupBox({
  group,
  items,
  ...rest
}: Omit<ListProps, 'items'> & { group: WorkflowRunGroup; items: readonly WorkflowGraphItem[] }) {
  const [expanded, setExpanded] = useState(false);
  const { shown, more } = expanded ? { shown: items, more: 0 } : foldGroupItems(items);
  const kindLabel = Object.prototype.hasOwnProperty.call(GROUP_KIND_KEYS, group.kind)
    ? rest.t(GROUP_KIND_KEYS[group.kind as keyof typeof GROUP_KIND_KEYS])
    : group.kind;
  const pct = group.total > 0 ? Math.min(100, Math.round((group.done / group.total) * 100)) : 0;

  return (
    <div className={css.GroupBox} data-workflow-group-id={group.id}>
      <div className={cardCss.Row} style={{ justifyContent: 'space-between' }}>
        <Text as="span" size="T300" className={css.StrongText}>
          {kindLabel}
        </Text>
        <Text as="span" size="T200" priority="300">
          {rest.t('mindroomUi.workflowRun.group.progress', {
            done: group.done,
            total: group.total,
          })}
        </Text>
        {group.failed > 0 && (
          <Text as="span" size="T200" className={cardCss.CriticalText}>
            {rest.t('mindroomUi.workflowRun.group.failed', { count: group.failed })}
          </Text>
        )}
      </div>
      <div
        className={css.ProgressTrack}
        role="progressbar"
        aria-valuenow={group.done}
        aria-valuemin={0}
        aria-valuemax={group.total}
      >
        <div className={css.ProgressFill} style={{ inlineSize: `${pct}%` }} />
      </div>
      <WorkflowItemsList items={shown} {...rest} />
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
              {rest.t('mindroomUi.workflowRun.panel.showMore', { count: more })}
            </Text>
          </Button>
        </div>
      )}
    </div>
  );
}

function WorkflowItemsList(props: ListProps) {
  const { items, room, subagentsByRun, selectedId, now, t, language, onSelect } = props;
  return (
    <div className={css.ItemsGrid}>
      {items.map((item) =>
        item.type === 'group' ? (
          <WorkflowGroupBox
            key={item.group.id}
            group={item.group}
            items={item.items}
            room={room}
            subagentsByRun={subagentsByRun}
            selectedId={selectedId}
            now={now}
            t={t}
            language={language}
            onSelect={onSelect}
          />
        ) : (
          <div key={item.node.id} className={css.Column}>
            <WorkflowNodeChip
              node={item.node}
              subagentRun={item.node.run ? subagentsByRun.get(item.node.run) : undefined}
              room={room}
              selected={selectedId === item.node.id}
              now={isLiveWorkflowNodeStatus(item.node.status) ? now : 0}
              t={t}
              language={language}
              onSelect={onSelect}
            />
            {item.children && item.children.length > 0 && (
              <div className={css.NestedChildren}>
                <WorkflowItemsList {...props} items={item.children} />
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}

/** Renders phase band sections with nested groups, session turns, and memoized agent chips. */
export function WorkflowGraphBands({
  bands,
  ...rest
}: Omit<ListProps, 'items' | 't' | 'language'> & { bands: readonly WorkflowGraphBand[] }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  return (
    <>
      {bands.map((band, index) => (
        <section key={band.phase ?? `unphased-${index}`} className={css.Band}>
          {band.phase !== null && (
            <Text as="h3" size="T300" className={css.StrongText} {...ownDirectionLine}>
              {band.phase}
            </Text>
          )}
          <WorkflowItemsList items={band.items} t={t} language={language} {...rest} />
        </section>
      ))}
    </>
  );
}
