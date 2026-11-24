import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { Button, Icon, IconButton, Icons, Text } from 'folds';
import { subscribeRelativeTimeClock, useRelativeTime } from '../../i18n/useRelativeTime';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { usePowerLevels } from '../../matrix/hooks/usePowerLevels';
import { useRoomBackgroundJobs } from '../../matrix/hooks/useRoomBackgroundJobs';
import { useRoomCreators } from '../../matrix/hooks/useRoomCreators';
import { useRoomPermissions } from '../../matrix/hooks/useRoomPermissions';
import { MINDROOM_BACKGROUND_JOB_CANCEL_EVENT } from '../../matrix/protocol/backgroundJobsContract';
import {
  isLiveWorkflowRunStatus,
  type WorkflowRunEdge,
  type WorkflowRunNode,
} from '../../matrix/protocol/workflowFrame';
import { stopBackgroundJobs } from '../../matrix/send/cancelBackgroundJob';
import { type SubagentRun, useRoomSubagentRuns } from '../../messages/live/subagentRunStore';
import { useWorkflowRun } from '../../messages/live/workflowRunStore';
import {
  workflowNodeStatusLabel,
  workflowRunHeading,
  workflowRunStatusLabel,
} from '../../messages/workflow-run/workflowRunLabels';
import {
  useWorkflowRunActions,
  WorkflowRunActionButtons,
  WorkflowRunMetrics,
} from '../../messages/workflow-run/WorkflowRunSummary';
import * as cardCss from '../../messages/workflow-run/WorkflowRunCard.css';
import { SWIPE_PRIORITY } from '../../navigation/interactiveSwipe';
import { RoomPanelEdgeSwipeContext } from '../../navigation/roomPanelEdgeSwipeContext';
import { openSubagentsPanel } from '../../navigation/subagentsPanel';
import { useEdgeSwipeBack } from '../../navigation/useEdgeSwipeBack';
import { ownDirectionBlock, ownDirectionLine } from '../../ui/directional';
import { Header as SidePanelHeader } from '../../ui/panels/SidePanel.css';
import { useAgentProfile } from '../AgentAvatar';
import { Failure } from '../subagentsPanel.css';
import { isLiveWorkflowNodeStatus, WorkflowGraphBands } from './WorkflowGraph';
import {
  edgePath,
  layoutWorkflowRunGraph,
  nodeResultPreview,
  type Box,
} from './workflowGraphModel';
import * as css from './workflowPanel.css';

const OMITTED_STATUS_ROWS = [
  ['queued', 'mindroomUi.workflowRun.panel.omitted.queued'],
  ['running', 'mindroomUi.workflowRun.panel.omitted.running'],
  ['waiting', 'mindroomUi.workflowRun.panel.omitted.waiting'],
  ['failed', 'mindroomUi.workflowRun.panel.omitted.failed'],
  ['completed', 'mindroomUi.workflowRun.panel.omitted.done'],
] as const;

const useMeasuredEdgePaths = (
  canvasRef: React.RefObject<HTMLDivElement>,
  edges: readonly WorkflowRunEdge[]
) => {
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
      if (!canvas || edgesRef.current.length === 0) {
        setPaths((prev) => (prev.length === 0 ? prev : []));
        return;
      }
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
        const a = boxes.get(e.from);
        const b = boxes.get(e.to);
        return a && b ? [{ key: `${e.from}->${e.to}`, d: edgePath(a, b) }] : [];
      });
      setPaths((prev) =>
        prev.length === next.length &&
        prev.every((p, i) => p.key === next[i]?.key && p.d === next[i]?.d)
          ? prev
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
  }, [canvasRef, edgesKey]);

  return paths;
};

export type WorkflowPanelProps = {
  room: Room;
  run: string;
  threadId?: string | null;
  onClose: () => void;
  readOnly?: boolean;
};

/** Live workflow graph side panel: header actions, phase bands, SVG message edges, inspector, log. */
export function WorkflowPanel({
  room,
  run,
  threadId = null,
  onClose,
  readOnly = false,
}: WorkflowPanelProps) {
  const { t } = useTranslation();
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
  const [nodeStopError, setNodeStopError] = useState<string | null>(null);
  useEffect(() => {
    setSelectedId(null);
    setNodeStopError(null);
  }, [room.roomId, run]);
  const handleSelect = useCallback(
    (id: string) => setSelectedId((cur) => (cur === id ? null : id)),
    []
  );

  const subagentsByRun = useMemo(
    () => new Map<string, SubagentRun>(subagentRuns.map((s) => [s.run, s])),
    [subagentRuns]
  );
  const graph = entry?.graph;
  const layout = useMemo(() => (graph ? layoutWorkflowRunGraph(graph) : null), [graph]);
  const canvasRef = useRef<HTMLDivElement>(null);
  const edgePaths = useMeasuredEdgePaths(canvasRef, graph?.edges ?? []);

  const staleRelative = useRelativeTime(entry?.stale ? entry.lastFrameAt : undefined);
  const agentProfile = useAgentProfile(room, entry?.agent ?? '');
  const runJob = jobs.find((job) => job.kind === 'workflow' && job.workflow === run);
  const effectiveThreadId = entry?.threadId ?? threadId;
  const actions = useWorkflowRunActions({
    room,
    roomId: room.roomId,
    run,
    jobId: runJob?.jobId ?? null,
    requester: entry?.requester,
    status: entry?.status ?? 'starting',
    attempt: entry?.attempt ?? 1,
    threadId: effectiveThreadId,
    readOnly: readOnly || !entry,
  });

  const nodesById = useMemo(
    () => new Map(graph?.nodes.map((n) => [n.id, n]) ?? []),
    [graph?.nodes]
  );
  const selectedNode = selectedId ? nodesById.get(selectedId) : undefined;
  const selectedSubagent = selectedNode?.run ? subagentsByRun.get(selectedNode.run) : undefined;
  const selectedPreview = selectedNode ? nodeResultPreview(selectedSubagent) : undefined;
  const selectedEdges = useMemo(
    () => (selectedNode && graph ? graph.edges.filter((e) => e.from === selectedNode.id) : []),
    [graph, selectedNode]
  );

  const handleStopNode = async (node: WorkflowRunNode) => {
    if (!node.job) return;
    setNodeStopError(null);
    if (!(await stopBackgroundJobs(mx, room, effectiveThreadId, { jobId: node.job }, [node.job]))) {
      setNodeStopError(t('activity.actions.failed'));
    }
  };

  const heading = entry ? workflowRunHeading(entry, t) : t('mindroomUi.workflowRun.title');
  const showSavedName = !!entry?.name && !!entry.title && entry.name !== entry.title;
  const omitted = graph?.omitted;
  const omittedLines = omitted
    ? OMITTED_STATUS_ROWS.filter(([key]) => omitted[key] > 0).map(([key, msg]) =>
        t(msg, { count: omitted[key] })
      )
    : [];
  const errorBanner = actions.actionError ?? nodeStopError;

  return (
    <section tabIndex={-1} className={css.Panel} aria-label={heading} data-testid="workflow-panel">
      <header className={SidePanelHeader}>
        <div className={css.HeaderMain}>
          <div className={cardCss.Row} style={{ gap: '4px' }}>
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
            <WorkflowRunMetrics
              counts={entry.counts}
              usage={entry.usage}
              startedAt={entry.startedAt}
              endedAt={entry.endedAt}
              isLive={isLive}
            />
          )}
        </div>
        <div className={css.HeaderActions}>
          <WorkflowRunActionButtons room={room} actions={actions} />
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
        {errorBanner && (
          <Text role="alert" size="T200" className={Failure}>
            {errorBanner}
          </Text>
        )}
        {!entry && (
          <Text size="T300" priority="300" className={css.Empty}>
            {t('mindroomUi.workflowRun.panel.waitingForUpdate')}
          </Text>
        )}
        {entry?.stale && (
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
            <WorkflowGraphBands
              bands={layout.bands}
              room={room}
              subagentsByRun={subagentsByRun}
              selectedId={selectedId}
              now={now}
              onSelect={handleSelect}
            />
          </div>
        )}

        {entry && selectedNode && (
          <div className={css.InsetBox} data-workflow-node-details={selectedNode.id}>
            <Text as="h3" size="T300" className={css.StrongText} {...ownDirectionLine}>
              {selectedNode.label}
            </Text>
            <Text size="T200" priority="300">
              {workflowNodeStatusLabel(selectedNode.status, t)}
            </Text>
            {selectedNode.error && (
              <div>
                <Text size="T200" className={css.StrongText}>
                  {t('mindroomUi.workflowRun.node.error')}
                </Text>
                <Text size="T200" className={Failure} {...ownDirectionBlock}>
                  {selectedNode.error}
                </Text>
              </div>
            )}
            {selectedPreview && (
              <div>
                <Text size="T200" className={css.StrongText}>
                  {t('mindroomUi.workflowRun.node.result')}
                </Text>
                <Text size="T200" {...ownDirectionBlock}>
                  {selectedPreview}
                </Text>
              </div>
            )}
            {selectedEdges.length > 0 && (
              <div>
                <Text size="T200" className={css.StrongText}>
                  {t('mindroomUi.workflowRun.node.messages')}
                </Text>
                {selectedEdges.map((edge) => (
                  <Text key={`${edge.from}->${edge.to}`} size="T200">
                    {t('mindroomUi.workflowRun.node.messagesTo', {
                      name:
                        nodesById.get(edge.to)?.name ?? nodesById.get(edge.to)?.label ?? edge.to,
                      count: edge.count,
                    })}
                  </Text>
                ))}
              </div>
            )}
            {(selectedNode.run ||
              (selectedNode.job && isLiveWorkflowNodeStatus(selectedNode.status) && canCancel)) && (
              <div className={cardCss.Row}>
                {selectedNode.run && (
                  <Button
                    type="button"
                    size="300"
                    variant="Secondary"
                    fill="Soft"
                    disabled={!selectedSubagent}
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
                {selectedNode.job && isLiveWorkflowNodeStatus(selectedNode.status) && canCancel && (
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
            {selectedNode.run && !selectedSubagent && (
              <Text size="T200" priority="300">
                {t('mindroomUi.workflowRun.node.detailsUnavailable')}
              </Text>
            )}
          </div>
        )}

        {entry && omitted && Object.values(omitted).some(Boolean) && (
          <div className={css.InsetBox}>
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

        {entry && graph && graph.log.length > 0 && (
          <div>
            <Text as="h3" size="T200" priority="300" className={css.StrongText}>
              {t('mindroomUi.workflowRun.panel.log')}
            </Text>
            <ul className={css.LogList}>
              {graph.log.map((line, index) => (
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
