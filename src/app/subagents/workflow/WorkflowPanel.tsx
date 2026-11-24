import { type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { Box, Button, Icon, IconButton, Icons, Text } from 'folds';
import { subscribeRelativeTimeClock, useRelativeTime } from '../../i18n/useRelativeTime';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomBackgroundJobs } from '../../matrix/hooks/useRoomBackgroundJobs';
import { isLiveWorkflowRunStatus, type WorkflowRunNode } from '../../matrix/protocol/workflowFrame';
import { stopBackgroundJobs } from '../../matrix/send/cancelBackgroundJob';
import { type SubagentRun, useRoomSubagentRuns } from '../../messages/live/subagentRunStore';
import { useWorkflowRun } from '../../messages/live/workflowRunStore';
import {
  workflowNodeStatusLabel,
  workflowRunHeading,
} from '../../messages/workflow-run/workflowRunLabels';
import {
  useCanCancelBackgroundJob,
  useWorkflowRunActions,
  WorkflowRunActionButtons,
  WorkflowRunMetrics,
  WorkflowRunTitleBadges,
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
import { isLiveWorkflowNodeStatus, WorkflowGraphCanvas } from './WorkflowGraph';
import { layoutWorkflowRunGraph, nodeResultPreview } from './workflowGraphModel';
import * as css from './workflowPanel.css';

const OMITTED_ROWS = [
  ['queued', 'mindroomUi.workflowRun.panel.omitted.queued'],
  ['running', 'mindroomUi.workflowRun.panel.omitted.running'],
  ['waiting', 'mindroomUi.workflowRun.panel.omitted.waiting'],
  ['failed', 'mindroomUi.workflowRun.panel.omitted.failed'],
  ['completed', 'mindroomUi.workflowRun.panel.omitted.done'],
] as const;

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
  const canCancel = useCanCancelBackgroundJob(room, readOnly);
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const swipeHandledByRoom = useContext(RoomPanelEdgeSwipeContext);
  useEdgeSwipeBack(onClose, mobile && !swipeHandledByRoom, { priority: SWIPE_PRIORITY.PANEL });

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
    if (!(await stopBackgroundJobs(mx, room, effectiveThreadId, { jobId: node.job }, [node.job])))
      setNodeStopError(t('activity.actions.failed'));
  };

  const heading = entry ? workflowRunHeading(entry, t) : t('mindroomUi.workflowRun.title');
  const omitted = graph?.omitted;
  const errorBanner = actions.actionError ?? nodeStopError;
  const sections: { label: string; body: ReactNode }[] = [];
  if (selectedNode?.error) {
    sections.push({
      label: t('mindroomUi.workflowRun.node.error'),
      body: (
        <Text size="T200" className={Failure} {...ownDirectionBlock}>
          {selectedNode.error}
        </Text>
      ),
    });
  }
  if (selectedPreview) {
    sections.push({
      label: t('mindroomUi.workflowRun.node.result'),
      body: (
        <Text size="T200" {...ownDirectionBlock}>
          {selectedPreview}
        </Text>
      ),
    });
  }
  if (selectedEdges.length > 0) {
    sections.push({
      label: t('mindroomUi.workflowRun.node.messages'),
      body: selectedEdges.map((e) => (
        <Text key={`${e.from}->${e.to}`} size="T200">
          {t('mindroomUi.workflowRun.node.messagesTo', {
            name: nodesById.get(e.to)?.name ?? nodesById.get(e.to)?.label ?? e.to,
            count: e.count,
          })}
        </Text>
      )),
    });
  }

  return (
    <section tabIndex={-1} className={css.Panel} aria-label={heading} data-testid="workflow-panel">
      <header className={SidePanelHeader}>
        <Box direction="Column" gap="100" grow="Yes" style={{ minInlineSize: 0 }}>
          <div className={cardCss.Row} style={{ gap: '4px' }}>
            <WorkflowRunTitleBadges
              heading={heading}
              name={entry?.name}
              title={entry?.title}
              status={entry?.status}
              asHeading
            />
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
        </Box>
        <Box alignItems="Center" gap="100" shrink="No">
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
        </Box>
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
          <WorkflowGraphCanvas
            bands={layout.bands}
            edges={graph?.edges ?? []}
            room={room}
            subagentsByRun={subagentsByRun}
            selectedId={selectedId}
            now={now}
            onSelect={handleSelect}
          />
        )}
        {entry && selectedNode && (
          <div className={css.InsetBox} data-workflow-node-details={selectedNode.id}>
            <Text as="h3" size="T300" className={css.StrongText} {...ownDirectionLine}>
              {selectedNode.label}
            </Text>
            <Text size="T200" priority="300">
              {workflowNodeStatusLabel(selectedNode.status, t)}
            </Text>
            {sections.map(({ label, body }) => (
              <div key={label}>
                <Text size="T200" className={css.StrongText}>
                  {label}
                </Text>
                {body}
              </div>
            ))}
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
            {OMITTED_ROWS.filter(([k]) => omitted[k] > 0).map(([k, msg]) => (
              <Text key={k} size="T200" priority="300">
                {t(msg, { count: omitted[k] })}
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
              {graph.log.map((line, i) => (
                // Log lines are append-only text and can repeat across rounds.
                // eslint-disable-next-line react/no-array-index-key
                <li key={i} {...ownDirectionLine}>
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
