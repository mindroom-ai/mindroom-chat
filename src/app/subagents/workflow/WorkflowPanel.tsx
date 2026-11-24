import {
  memo,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { Button, Icon, IconButton, Icons, Text } from 'folds';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { subscribeRelativeTimeClock, useRelativeTime } from '../../i18n/useRelativeTime';
import { formatWorkDuration } from '../../lib/time';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomBackgroundJobs } from '../../matrix/hooks/useRoomBackgroundJobs';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { getAiRunCompactModelLabel } from '../../matrix/protocol/aiRunModelLabel';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from '../../matrix/protocol/backgroundJobsContract';
import {
  isLiveWorkflowRunStatus,
  type WorkflowNodeStatus,
  type WorkflowRunEdge,
  type WorkflowRunNode,
  type WorkflowRunOmitted,
} from '../../matrix/protocol/workflowFrame';
import { sendWorkflowRunResume } from '../../matrix/protocol/workflowRunContent';
import { cancelBackgroundJob } from '../../matrix/send/cancelBackgroundJob';
import { formatCostUsd } from '../../messages/agent-run/aiRunDisplay';
import { type SubagentRun, useRoomSubagentRuns } from '../../messages/live/subagentRunStore';
import { useWorkflowRun } from '../../messages/live/workflowRunStore';
import {
  workflowRunCostLine,
  workflowRunCountsLine,
  workflowRunHeading,
  workflowRunStatusLabel,
} from '../../messages/workflow-run/workflowRunLabels';
import { RoomPanelEdgeSwipeContext } from '../../navigation/roomPanelEdgeSwipeContext';
import { openSubagentsPanel } from '../../navigation/subagentsPanel';
import { SWIPE_PRIORITY } from '../../navigation/interactiveSwipe';
import { useEdgeSwipeBack } from '../../navigation/useEdgeSwipeBack';
import { ownDirectionBlock, ownDirectionLine } from '../../ui/directional';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { Header as SidePanelHeader } from '../../ui/panels/SidePanel.css';
import { AgentAvatar, useAgentProfile } from '../AgentAvatar';
import { formatTokens } from '../runUsage';
import {
  edgePath,
  foldGroupItems,
  layoutWorkflowRunGraph,
  nodeResultPreview,
  shownEdges,
  type Box,
  type WorkflowGraphItem,
} from './workflowGraphModel';
import * as cardCss from '../../messages/workflow-run/WorkflowRunCard.css';
import * as css from './workflowPanel.css';

const RESUME_TIMEOUT_MS = 15_000;

const GROUP_KIND_KEYS = {
  foreach: 'mindroomUi.workflowRun.group.foreach',
  parallel: 'mindroomUi.workflowRun.group.parallel',
  run: 'mindroomUi.workflowRun.group.run',
} as const;

const WAITING_ON_KEYS = {
  user: 'mindroomUi.workflowRun.node.waitingOn.user',
  approval: 'mindroomUi.workflowRun.node.waitingOn.approval',
  peer: 'mindroomUi.workflowRun.node.waitingOn.peer',
} as const;

const isLiveNodeStatus = (status: WorkflowNodeStatus): boolean =>
  status === 'queued' || status === 'running' || status === 'waiting';

type NodeChipProps = {
  node: WorkflowRunNode;
  turns?: WorkflowRunNode[];
  subagentRun?: SubagentRun;
  subagentsByRun: ReadonlyMap<string, SubagentRun>;
  room: Room;
  selectedId: string | null;
  now: number;
  t: TFunction;
  language: string;
  onSelect: (id: string) => void;
  onChipRender?: (id: string) => void;
};

const sameTurns = (a: WorkflowRunNode[] | undefined, b: WorkflowRunNode[] | undefined): boolean => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
};

const areChipPropsEqual = (prev: NodeChipProps, next: NodeChipProps): boolean => {
  if (prev.node !== next.node) return false;
  if (prev.subagentRun !== next.subagentRun) return false;
  if (
    prev.room !== next.room ||
    prev.onSelect !== next.onSelect ||
    prev.t !== next.t ||
    prev.language !== next.language
  ) {
    return false;
  }
  if (!sameTurns(prev.turns, next.turns)) return false;
  const prevSelected =
    prev.selectedId === prev.node.id || prev.turns?.some((t) => t.id === prev.selectedId);
  const nextSelected =
    next.selectedId === next.node.id || next.turns?.some((t) => t.id === next.selectedId);
  if (prevSelected !== nextSelected) return false;
  if (prevSelected && prev.selectedId !== next.selectedId) return false;
  const live = isLiveNodeStatus(next.node.status);
  if (live && prev.now !== next.now) return false;
  return true;
};

const WorkflowNodeChip = memo(function WorkflowNodeChip({
  node,
  turns,
  subagentRun,
  subagentsByRun,
  room,
  selectedId,
  now,
  t,
  language,
  onSelect,
  onChipRender,
}: NodeChipProps) {
  onChipRender?.(node.id);
  const agentProfile = useAgentProfile(room, node.agent ?? '');
  const selected = selectedId === node.id;

  const modelLabel = subagentRun?.meta.model
    ? getAiRunCompactModelLabel(subagentRun.meta.model)
    : node.model;

  const usage = subagentRun?.meta.usage ?? node.usage;
  const totalTokens = usage ? usage.inputTokens + usage.outputTokens : 0;
  const tokensText = totalTokens > 0 ? formatTokens(totalTokens, language) : undefined;
  const costText =
    usage?.costUsd !== undefined && (usage.costUsd > 0 || totalTokens > 0)
      ? formatCostUsd(usage.costUsd, language)
      : undefined;

  let elapsedText: string | undefined;
  if (node.startedAt !== null) {
    if (isLiveNodeStatus(node.status) && now > 0) {
      elapsedText = formatWorkDuration(Math.max(0, now - node.startedAt * 1000), language);
    } else if (node.endedAt !== null) {
      elapsedText = formatWorkDuration(
        Math.max(0, (node.endedAt - node.startedAt) * 1000),
        language
      );
    }
  }

  let statusNote: string | undefined;
  if (node.cached) {
    statusNote = t('mindroomUi.workflowRun.node.reused');
  } else if (node.status === 'queued') {
    statusNote = t('mindroomUi.workflowRun.node.queued');
  } else if (node.status === 'indeterminate') {
    statusNote = t('mindroomUi.workflowRun.node.mayHaveRun');
  } else if (node.status === 'waiting' && node.waitingOn) {
    statusNote = t(WAITING_ON_KEYS[node.waitingOn]);
  }

  return (
    <div className={css.ChipStack}>
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
          {tokensText && <span>{tokensText}</span>}
          {costText && <span>{costText}</span>}
          {elapsedText && <span>{elapsedText}</span>}
        </span>
        {statusNote && <span className={css.ChipNote}>{statusNote}</span>}
      </button>

      {turns && turns.length > 0 && (
        <div className={css.SessionTurns}>
          {turns.map((turn) => (
            <WorkflowNodeChip
              key={turn.id}
              node={turn}
              subagentRun={turn.run ? subagentsByRun.get(turn.run) : undefined}
              subagentsByRun={subagentsByRun}
              room={room}
              selectedId={selectedId}
              now={isLiveNodeStatus(turn.status) ? now : 0}
              t={t}
              language={language}
              onSelect={onSelect}
              onChipRender={onChipRender}
            />
          ))}
        </div>
      )}
    </div>
  );
},
areChipPropsEqual);

function WorkflowItemsList({
  items,
  room,
  subagentsByRun,
  selectedId,
  now,
  t,
  language,
  expandedGroups,
  onExpandGroup,
  onSelect,
  onChipRender,
}: {
  items: readonly WorkflowGraphItem[];
  room: Room;
  subagentsByRun: ReadonlyMap<string, SubagentRun>;
  selectedId: string | null;
  now: number;
  t: TFunction;
  language: string;
  expandedGroups: ReadonlySet<string>;
  onExpandGroup: (id: string) => void;
  onSelect: (id: string) => void;
  onChipRender?: (id: string) => void;
}) {
  return (
    <div className={css.ItemsGrid}>
      {items.map((item) => {
        if (item.type === 'node') {
          const { node, children } = item;
          const turns = children
            ?.filter((c): c is Extract<WorkflowGraphItem, { type: 'node' }> => c.type === 'node')
            .map((c) => c.node);
          return (
            <WorkflowNodeChip
              key={node.id}
              node={node}
              turns={turns}
              subagentRun={node.run ? subagentsByRun.get(node.run) : undefined}
              subagentsByRun={subagentsByRun}
              room={room}
              selectedId={selectedId}
              now={isLiveNodeStatus(node.status) ? now : 0}
              t={t}
              language={language}
              onSelect={onSelect}
              onChipRender={onChipRender}
            />
          );
        }

        const { group, items: children } = item;
        const expanded = expandedGroups.has(group.id);
        const { shown, more } = expanded ? { shown: children, more: 0 } : foldGroupItems(children);
        const kindLabel = Object.prototype.hasOwnProperty.call(GROUP_KIND_KEYS, group.kind)
          ? t(GROUP_KIND_KEYS[group.kind as keyof typeof GROUP_KIND_KEYS])
          : group.kind;
        const pct =
          group.total > 0 ? Math.min(100, Math.round((group.done / group.total) * 100)) : 0;

        return (
          <div key={group.id} className={css.GroupBox} data-workflow-group-id={group.id}>
            <div className={css.GroupHeader}>
              <Text as="span" size="T300" style={{ fontWeight: 600 }}>
                {kindLabel}
              </Text>
              <Text as="span" size="T200" priority="300">
                {t('mindroomUi.workflowRun.group.progress', {
                  done: group.done,
                  total: group.total,
                })}
              </Text>
              {group.failed > 0 && (
                <Text as="span" size="T200" className={css.GroupFailed}>
                  {t('mindroomUi.workflowRun.group.failed', { count: group.failed })}
                </Text>
              )}
            </div>
            <div
              className={css.GroupProgressTrack}
              role="progressbar"
              aria-valuenow={group.done}
              aria-valuemin={0}
              aria-valuemax={group.total}
            >
              <div className={css.GroupProgressFill} style={{ inlineSize: `${pct}%` }} />
            </div>
            <WorkflowItemsList
              items={shown}
              room={room}
              subagentsByRun={subagentsByRun}
              selectedId={selectedId}
              now={now}
              t={t}
              language={language}
              expandedGroups={expandedGroups}
              onExpandGroup={onExpandGroup}
              onSelect={onSelect}
              onChipRender={onChipRender}
            />
            {more > 0 && (
              <div>
                <Button
                  type="button"
                  size="300"
                  variant="Secondary"
                  fill="Soft"
                  onClick={() => onExpandGroup(group.id)}
                >
                  <Text size="B300">
                    {t('mindroomUi.workflowRun.panel.showMore', { count: more })}
                  </Text>
                </Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const collectShownIds = (
  items: readonly WorkflowGraphItem[],
  expandedGroups: ReadonlySet<string>,
  into: Set<string>
): void => {
  items.forEach((item) => {
    if (item.type === 'node') {
      into.add(item.node.id);
      if (item.children) collectShownIds(item.children, expandedGroups, into);
    } else {
      const shown = expandedGroups.has(item.group.id)
        ? item.items
        : foldGroupItems(item.items).shown;
      collectShownIds(shown, expandedGroups, into);
    }
  });
};

const hasAnyOmitted = (omitted: WorkflowRunOmitted): boolean =>
  omitted.queued > 0 ||
  omitted.running > 0 ||
  omitted.waiting > 0 ||
  omitted.failed > 0 ||
  omitted.completed > 0 ||
  omitted.edges > 0 ||
  omitted.groups > 0 ||
  omitted.phases > 0 ||
  omitted.log > 0;

export type WorkflowPanelProps = {
  room: Room;
  run: string;
  threadId?: string | null;
  onClose: () => void;
  readOnly?: boolean;
  /** Test hook invoked on each node chip render. */
  onChipRender?: (id: string) => void;
};

/**
 * Live workflow run graph panel: phase bands, group boxes, memoized agent chips, curved message
 * edges, selected-node inspector, omitted-row notices, and log tail.
 */
export function WorkflowPanel({
  room,
  run,
  threadId = null,
  onClose,
  readOnly = false,
  onChipRender,
}: WorkflowPanelProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const mx = useMatrixClient();
  const jotaiStore = useStore();
  const entry = useWorkflowRun(room.roomId, run);
  const subagentRuns = useRoomSubagentRuns(room.roomId);
  const { jobs } = useRoomBackgroundJobs(room);

  const viewerId = mx.getUserId();
  const permissions = useRoomPermissions(useRoomCreators(room), usePowerLevels(room));
  const canCancel =
    !readOnly && !!viewerId && permissions.event(MINDROOM_BACKGROUND_JOB_CANCEL_EVENT, viewerId);

  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const handledByRoom = useContext(RoomPanelEdgeSwipeContext);
  useEdgeSwipeBack(onClose, mobile && !handledByRoom, { priority: SWIPE_PRIORITY.PANEL });

  const isLive = entry ? isLiveWorkflowRunStatus(entry.status) : false;
  const [now, setNow] = useState(Date.now);
  useEffect(
    () => (isLive ? subscribeRelativeTimeClock(1_000, () => setNow(Date.now())) : undefined),
    [isLive]
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [stoppingJob, setStoppingJob] = useState<string | null>(null);
  const [resumingAt, setResumingAt] = useState<{ status: string; attempt: number } | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleSelect = useCallback((id: string) => {
    setSelectedId((current) => (current === id ? null : id));
  }, []);

  const handleExpandGroup = useCallback((groupId: string) => {
    setExpandedGroups((prev) => new Set([...prev, groupId]));
  }, []);

  const subagentsByRun = useMemo(() => {
    const map = new Map<string, SubagentRun>();
    subagentRuns.forEach((sub) => map.set(sub.run, sub));
    return map;
  }, [subagentRuns]);

  const layout = useMemo(
    () => (entry?.graph ? layoutWorkflowRunGraph(entry.graph) : null),
    [entry?.graph]
  );

  const shownNodeIds = useMemo(() => {
    const ids = new Set<string>();
    layout?.bands.forEach((band) => collectShownIds(band.items, expandedGroups, ids));
    return ids;
  }, [expandedGroups, layout]);

  const visibleEdges = useMemo(
    () => (entry?.graph ? shownEdges(entry.graph.edges, shownNodeIds) : []),
    [entry?.graph, shownNodeIds]
  );

  // Measure chip bounding boxes in one ResizeObserver + layout effect, throttled to rAF.
  const canvasRef = useRef<HTMLDivElement>(null);
  const [edgePaths, setEdgePaths] = useState<{ key: string; d: string }[]>([]);
  const hasEdgePathsRef = useRef(false);

  const measureEdges = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || visibleEdges.length === 0) {
      if (hasEdgePathsRef.current) {
        hasEdgePathsRef.current = false;
        setEdgePaths([]);
      }
      return;
    }
    const rootRect = canvas.getBoundingClientRect();
    const boxes = new Map<string, Box>();
    canvas.querySelectorAll<HTMLElement>('[data-workflow-chip-id]').forEach((el) => {
      const chipId = el.dataset.workflowChipId;
      if (!chipId) return;
      const rect = el.getBoundingClientRect();
      boxes.set(chipId, {
        x: rect.left - rootRect.left,
        y: rect.top - rootRect.top,
        width: rect.width,
        height: rect.height,
      });
    });
    const next: { key: string; d: string }[] = [];
    visibleEdges.forEach((edge: WorkflowRunEdge) => {
      const fromBox = boxes.get(edge.from);
      const toBox = boxes.get(edge.to);
      if (fromBox && toBox) {
        next.push({ key: `${edge.from}->${edge.to}`, d: edgePath(fromBox, toBox) });
      }
    });
    hasEdgePathsRef.current = next.length > 0;
    setEdgePaths(next);
  }, [visibleEdges]);

  useLayoutEffect(() => {
    measureEdges();
    const canvas = canvasRef.current;
    if (!canvas || visibleEdges.length === 0 || typeof ResizeObserver === 'undefined') {
      return undefined;
    }
    let rafId = 0;
    const observer = new ResizeObserver(() => {
      if (rafId) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = 0;
        measureEdges();
      });
    });
    observer.observe(canvas);
    return () => {
      observer.disconnect();
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [measureEdges, visibleEdges.length]);

  const staleRelative = useRelativeTime(entry?.stale ? entry.lastFrameAt : undefined);
  const agentProfile = useAgentProfile(room, entry?.agent ?? '');

  const runJob = jobs.find((job) => job.kind === 'workflow' && job.workflow === run);
  const stoppingRun = !!runJob && stoppingJob === runJob.jobId && isLive;
  const resuming =
    !!entry &&
    resumingAt !== null &&
    resumingAt.status === entry.status &&
    resumingAt.attempt === entry.attempt;

  useEffect(() => {
    if (!resuming) return undefined;
    const timer = window.setTimeout(() => setResumingAt(null), RESUME_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [resuming]);

  const nodesById = useMemo(() => {
    const map = new Map<string, WorkflowRunNode>();
    entry?.graph?.nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [entry?.graph]);

  const selectedNode = selectedId ? nodesById.get(selectedId) : undefined;
  const selectedSubagent = selectedNode?.run ? subagentsByRun.get(selectedNode.run) : undefined;
  const selectedPreview = selectedNode ? nodeResultPreview(selectedSubagent) : undefined;
  const selectedOutgoingEdges = useMemo(
    () =>
      selectedNode && entry?.graph
        ? entry.graph.edges.filter((edge) => edge.from === selectedNode.id)
        : [],
    [entry?.graph, selectedNode]
  );

  const effectiveThreadId = entry?.threadId ?? threadId;

  const handleStopRun = async () => {
    if (!runJob || stoppingRun) return;
    setActionError(null);
    setStoppingJob(runJob.jobId);
    try {
      await cancelBackgroundJob(mx, room, effectiveThreadId, { jobId: runJob.jobId });
    } catch {
      setStoppingJob(null);
      setActionError(t('activity.actions.failed'));
    }
  };

  const handleResumeRun = async () => {
    if (!entry || resuming) return;
    setActionError(null);
    setResumingAt({ status: entry.status, attempt: entry.attempt });
    try {
      await sendWorkflowRunResume(mx, room, effectiveThreadId, run);
    } catch {
      setResumingAt(null);
      setActionError(t('activity.actions.failed'));
    }
  };

  const handleStopNode = async (node: WorkflowRunNode) => {
    if (!node.job) return;
    setActionError(null);
    try {
      await cancelBackgroundJob(mx, room, effectiveThreadId, { jobId: node.job });
    } catch {
      setActionError(t('activity.actions.failed'));
    }
  };

  const heading = entry ? workflowRunHeading(entry, t) : t('mindroomUi.workflowRun.title');
  const showSavedName = !!entry?.name && !!entry.title && entry.name !== entry.title;
  const countsText = entry ? workflowRunCountsLine(entry.counts, t) : undefined;
  const costText = entry ? workflowRunCostLine(entry.usage, t, language) : undefined;

  let elapsedText: string | undefined;
  if (entry && entry.startedAt !== null) {
    if (isLive) {
      elapsedText = formatWorkDuration(Math.max(0, now - entry.startedAt * 1000), language);
    } else if (entry.endedAt !== null) {
      elapsedText = formatWorkDuration(
        Math.max(0, (entry.endedAt - entry.startedAt) * 1000),
        language
      );
    }
  }

  const showStop = isLive && canCancel && !!runJob;
  const canResume =
    !!entry &&
    !isLive &&
    !readOnly &&
    !!viewerId &&
    entry.requester != null &&
    viewerId === entry.requester;
  const showResume =
    canResume &&
    (entry.status === 'failed' || entry.status === 'cancelled' || entry.status === 'interrupted');
  const showRunAgain = canResume && entry.status === 'completed';

  const omitted = entry?.graph?.omitted;
  const omittedLines = omitted
    ? [
        omitted.queued > 0 &&
          t('mindroomUi.workflowRun.panel.omitted.queued', { count: omitted.queued }),
        omitted.running > 0 &&
          t('mindroomUi.workflowRun.panel.omitted.running', { count: omitted.running }),
        omitted.waiting > 0 &&
          t('mindroomUi.workflowRun.panel.omitted.waiting', { count: omitted.waiting }),
        omitted.failed > 0 &&
          t('mindroomUi.workflowRun.panel.omitted.failed', { count: omitted.failed }),
        omitted.completed > 0 &&
          t('mindroomUi.workflowRun.panel.omitted.done', { count: omitted.completed }),
      ].filter((line): line is string => !!line)
    : [];

  return (
    <section tabIndex={-1} className={css.Panel} aria-label={heading} data-testid="workflow-panel">
      <header className={SidePanelHeader}>
        <div className={css.HeaderMain}>
          <div className={css.HeaderTitleRow}>
            <Text as="h2" size="H4" truncate {...ownDirectionLine}>
              {heading}
            </Text>
            {showSavedName && entry?.name && (
              <span className={cardCss.Pill} {...ownDirectionLine}>
                {entry.name}
              </span>
            )}
            {entry && (
              <span className={cardCss.StatusPill[entry.status]}>
                {workflowRunStatusLabel(entry.status, t)}
              </span>
            )}
          </div>
          {entry && (
            <div className={css.HeaderMeta}>
              {countsText && (
                <Text as="span" size="T200" priority="300">
                  {countsText}
                </Text>
              )}
              {costText && (
                <Text as="span" size="T200" priority="300">
                  {costText}
                </Text>
              )}
              {elapsedText && (
                <Text as="span" size="T200" priority="300">
                  {elapsedText}
                </Text>
              )}
            </div>
          )}
        </div>
        <div className={css.HeaderActions}>
          {showStop && (
            <Button
              type="button"
              size="300"
              variant="Critical"
              fill="Soft"
              disabled={stoppingRun}
              onClick={() => void handleStopRun()}
            >
              <Text size="B300">
                {stoppingRun
                  ? t('mindroomUi.workflowRun.stopping')
                  : t('mindroomUi.workflowRun.stop')}
              </Text>
            </Button>
          )}
          {(showResume || showRunAgain) && (
            <Button
              type="button"
              size="300"
              variant="Primary"
              fill="Soft"
              disabled={resuming}
              onClick={() => void handleResumeRun()}
            >
              <Text size="B300">
                {resuming
                  ? t('mindroomUi.workflowRun.starting')
                  : showRunAgain
                  ? t('mindroomUi.workflowRun.runAgain')
                  : t('mindroomUi.workflowRun.resume')}
              </Text>
            </Button>
          )}
          <IconButton
            size="300"
            radii="300"
            variant="Surface"
            aria-label={t('mindroomUi.workflowRun.panel.close')}
            onClick={onClose}
          >
            <Icon size="200" src={Icons.Cross} />
          </IconButton>
        </div>
      </header>

      <div className={css.Body}>
        {actionError && (
          <Text role="alert" size="T200" className={cardCss.CriticalText}>
            {actionError}
          </Text>
        )}

        {!entry && (
          <Text size="T300" priority="300" className={css.Empty}>
            {t('mindroomUi.workflowRun.panel.waitingForUpdate')}
          </Text>
        )}

        {entry && entry.stale && (
          <Text size="T200" className={css.StaleBanner}>
            {t('mindroomUi.workflowRun.panel.stale', { time: staleRelative })}
          </Text>
        )}

        {entry && layout && layout.bands.length > 0 && (
          <div ref={canvasRef} className={css.GraphCanvas}>
            {edgePaths.length > 0 && (
              <svg className={css.EdgeOverlay} aria-hidden="true">
                {edgePaths.map((edge) => (
                  <path key={edge.key} d={edge.d} className={css.EdgePath} />
                ))}
              </svg>
            )}
            {layout.bands.map((band, index) => (
              <section key={band.phase ?? `unphased-${index}`} className={css.Band}>
                {band.phase !== null && (
                  <Text as="h3" size="T300" className={css.BandHeading} {...ownDirectionLine}>
                    {band.phase}
                  </Text>
                )}
                <WorkflowItemsList
                  items={band.items}
                  room={room}
                  subagentsByRun={subagentsByRun}
                  selectedId={selectedId}
                  now={now}
                  t={t}
                  language={language}
                  expandedGroups={expandedGroups}
                  onExpandGroup={handleExpandGroup}
                  onSelect={handleSelect}
                  onChipRender={onChipRender}
                />
              </section>
            ))}
          </div>
        )}

        {entry && selectedNode && (
          <div className={css.DetailsCard} data-workflow-node-details={selectedNode.id}>
            <Text as="h3" size="T300" style={{ fontWeight: 600 }} {...ownDirectionLine}>
              {selectedNode.label}
            </Text>
            <Text size="T200" priority="300">
              {selectedNode.status}
            </Text>
            {selectedNode.error && (
              <div className={css.DetailsBlock}>
                <Text size="T200" style={{ fontWeight: 600 }}>
                  {t('mindroomUi.workflowRun.node.error')}
                </Text>
                <Text size="T200" className={css.DetailsError} {...ownDirectionBlock}>
                  {selectedNode.error}
                </Text>
              </div>
            )}
            {selectedPreview && (
              <div className={css.DetailsBlock}>
                <Text size="T200" style={{ fontWeight: 600 }}>
                  {t('mindroomUi.workflowRun.node.result')}
                </Text>
                <Text size="T200" {...ownDirectionBlock}>
                  {selectedPreview}
                </Text>
              </div>
            )}
            {selectedOutgoingEdges.length > 0 && (
              <div className={css.DetailsBlock}>
                <Text size="T200" style={{ fontWeight: 600 }}>
                  {t('mindroomUi.workflowRun.node.messages')}
                </Text>
                {selectedOutgoingEdges.map((edge) => {
                  const target = nodesById.get(edge.to);
                  const targetName = target?.name ?? target?.label ?? edge.to;
                  return (
                    <Text key={`${edge.from}->${edge.to}`} size="T200">
                      {t('mindroomUi.workflowRun.node.messagesTo', {
                        name: targetName,
                        count: edge.count,
                      })}
                    </Text>
                  );
                })}
              </div>
            )}
            {(selectedNode.run ||
              (selectedNode.job && isLiveNodeStatus(selectedNode.status) && canCancel)) && (
              <div className={css.DetailsActions}>
                {selectedNode.run && (
                  <Button
                    type="button"
                    size="300"
                    variant="Secondary"
                    fill="Soft"
                    onClick={() =>
                      openSubagentsPanel(
                        jotaiStore,
                        room.roomId,
                        effectiveThreadId,
                        selectedNode.run
                      )
                    }
                  >
                    <Text size="B300">{t('mindroomUi.workflowRun.node.open')}</Text>
                  </Button>
                )}
                {selectedNode.job && isLiveNodeStatus(selectedNode.status) && canCancel && (
                  <Button
                    type="button"
                    size="300"
                    variant="Critical"
                    fill="Soft"
                    onClick={() => void handleStopNode(selectedNode)}
                  >
                    <Text size="B300">{t('mindroomUi.workflowRun.node.stop')}</Text>
                  </Button>
                )}
              </div>
            )}
          </div>
        )}

        {entry && omitted && (omittedLines.length > 0 || hasAnyOmitted(omitted)) && (
          <div className={css.OmittedSection}>
            {omittedLines.map((line) => (
              <Text key={line} size="T200" priority="300">
                {line}
              </Text>
            ))}
            <Text size="T200" priority="300">
              {t('mindroomUi.workflowRun.panel.askAgent', {
                agent: agentProfile.name || entry.agent,
              })}
            </Text>
          </div>
        )}

        {entry?.graph && entry.graph.log.length > 0 && (
          <div className={css.LogSection}>
            <Text as="h3" size="T200" priority="300" style={{ fontWeight: 600 }}>
              {t('mindroomUi.workflowRun.panel.log')}
            </Text>
            <ul className={css.LogList}>
              {entry.graph.log.map((line, index) => (
                // Log lines are append-only text and can repeat across rounds.
                // eslint-disable-next-line react/no-array-index-key
                <li key={index} {...ownDirectionLine}>
                  {line}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}
