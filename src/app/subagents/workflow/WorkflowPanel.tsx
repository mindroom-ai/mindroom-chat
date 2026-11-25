import {
  type KeyboardEvent,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { Room } from 'matrix-js-sdk';
import { Box, Text } from 'folds';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { useRelativeTime } from '../../i18n/useRelativeTime';
import { ScreenSize, useScreenSizeContext } from '../../lib/hooks/useScreenSize';
import { localDigits } from '../../lib/localDigits';
import { timeHourMinuteSecond } from '../../lib/time';
import { useMatrixClient } from '../../matrix/hooks/useMatrixClient';
import { useRoomBackgroundJobs } from '../../matrix/hooks/useRoomBackgroundJobs';
import { isLiveWorkflowRunStatus } from '../../matrix/protocol/workflowFrame';
import { stopBackgroundJobs } from '../../matrix/send/cancelBackgroundJob';
import { type SubagentRun, useRoomSubagentRuns } from '../../messages/live/subagentRunStore';
import { getWorkflowRunStore, useWorkflowRun } from '../../messages/live/workflowRunStore';
import { workflowRunHeading } from '../../messages/workflow-run/workflowRunLabels';
import {
  useCanCancelBackgroundJob,
  useLiveClock,
  WorkflowRunControls,
  WorkflowRunMetrics,
  WorkflowRunTitleBadges,
} from '../../messages/workflow-run/WorkflowRunSummary';
import * as cardCss from '../../messages/workflow-run/WorkflowRunCard.css';
import { SWIPE_PRIORITY } from '../../navigation/interactiveSwipe';
import { RoomPanelEdgeSwipeContext } from '../../navigation/roomPanelEdgeSwipeContext';
import { useEdgeSwipeBack } from '../../navigation/useEdgeSwipeBack';
import { useHour24Clock } from '../../preferences/useHour24Clock';
import { documentIsRightToLeft, ownDirectionBlock, ownDirectionLine } from '../../ui/directional';
import { PanelHeaderControls } from '../../ui/panels/PanelFrame';
import { Header as SidePanelHeader } from '../../ui/panels/SidePanel.css';
import { useAgentProfile } from '../AgentAvatar';
import { Failure } from '../subagentsPanel.css';
import { WorkflowGraphView } from './WorkflowGraph';
import {
  isLiveWorkflowNodeStatus,
  layoutWorkflowRunGraph,
  messageEndpointName,
  routeEndpointName,
} from './workflowGraphModel';
import { WorkflowInspectorEmpty, WorkflowNodeInspector } from './WorkflowInspector';
import * as css from './workflowPanel.css';

type WorkflowTab = 'flow' | 'steps' | 'messages' | 'log';
const TABS: readonly WorkflowTab[] = ['flow', 'steps', 'messages', 'log'];
const NARROW_SPLIT_REM = 36;
const isNarrowSplit = (split: HTMLElement | null): boolean => {
  if (!split) return false;
  const rootPx =
    typeof getComputedStyle === 'function'
      ? Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16
      : 16;
  return split.getBoundingClientRect().width < NARROW_SPLIT_REM * rootPx;
};

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

/** Live workflow graph side panel: header actions, Flow/Steps/Messages/Log tabs, sticky inspector. */
export function WorkflowPanel({
  room,
  run,
  threadId = null,
  onClose,
  readOnly = false,
}: WorkflowPanelProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const [hour24Clock] = useHour24Clock();
  const tabsId = useId();
  const mx = useMatrixClient();
  const entry = useWorkflowRun(room.roomId, run);
  useEffect(() => getWorkflowRunStore(mx).pin(room.roomId, run), [mx, room.roomId, run]);
  const subagentRuns = useRoomSubagentRuns(room.roomId);
  const { jobs } = useRoomBackgroundJobs(room);
  const canCancel = useCanCancelBackgroundJob(room, readOnly);
  const mobile = useScreenSizeContext() === ScreenSize.Mobile;
  const swipeHandledByRoom = useContext(RoomPanelEdgeSwipeContext);
  useEdgeSwipeBack(onClose, mobile && !swipeHandledByRoom, { priority: SWIPE_PRIORITY.PANEL });

  const isLive = entry ? isLiveWorkflowRunStatus(entry.status) : false;
  const now = useLiveClock(isLive);
  const [activeTab, setActiveTab] = useState<WorkflowTab>('flow');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const tabRefs = useRef<Partial<Record<WorkflowTab, HTMLButtonElement | null>>>({});
  const splitRef = useRef<HTMLDivElement | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const scrollInspectorRef = useRef(false);

  useEffect(() => {
    scrollInspectorRef.current = false;
    setActiveTab('flow');
    setSelectedId(null);
    setErrorBanner(null);
  }, [room.roomId, run]);

  const handleSelect = useCallback((id: string) => {
    setSelectedId((cur) => {
      const next = cur === id ? null : id;
      if (next !== null) scrollInspectorRef.current = true;
      return next;
    });
  }, []);
  const selectNode = useCallback((id: string) => setSelectedId(id), []);
  const jumpToNode = useCallback((id: string) => {
    scrollInspectorRef.current = true;
    setSelectedId(id);
    setActiveTab('flow');
  }, []);
  const subagentsByRun = useMemo(
    () => new Map<string, SubagentRun>(subagentRuns.map((s) => [s.run, s])),
    [subagentRuns]
  );
  const scriptLabel = t('mindroomUi.workflowRun.node.script');
  const graph = entry?.graph;
  const layout = useMemo(
    () => (graph ? layoutWorkflowRunGraph(graph, scriptLabel) : null),
    [graph, scriptLabel]
  );
  const staleRelative = useRelativeTime(entry?.stale ? entry.lastFrameAt : undefined);
  const agentProfile = useAgentProfile(room, entry?.agent ?? '');
  const runJob = jobs.find((job) => job.kind === 'workflow' && job.workflow === run);
  const effectiveThreadId = entry ? entry.threadId : threadId;

  const nodesById = useMemo(
    () => new Map(graph?.nodes.map((n) => [n.id, n]) ?? []),
    [graph?.nodes]
  );
  const selectedNode = selectedId ? nodesById.get(selectedId) : undefined;
  useEffect(() => {
    if (!scrollInspectorRef.current || !selectedNode) return;
    scrollInspectorRef.current = false;
    const el = inspectorRef.current;
    if (el && isNarrowSplit(splitRef.current) && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [activeTab, selectedNode]);
  const selectedSessionId = selectedNode
    ? (selectedNode.session ?? (selectedNode.kind === 'session' ? selectedNode.id : null))
    : null;
  const canStopNode = Boolean(
    selectedNode?.job && isLiveWorkflowNodeStatus(selectedNode.status) && canCancel
  );
  const stopNode = useCallback(
    async (jobId: string) => {
      setErrorBanner(null);
      if (!(await stopBackgroundJobs(mx, room, effectiveThreadId, { jobId }, [jobId])))
        setErrorBanner(t('activity.actions.failed'));
    },
    [effectiveThreadId, mx, room, t]
  );

  const edges = graph?.edges ?? [];
  const messages = graph?.messages ?? [];
  const logLines = graph?.log ?? [];
  const messageCount =
    messages.length > 0 ? messages.length : edges.reduce((sum, e) => sum + e.count, 0);
  const heading = entry ? workflowRunHeading(entry, t) : t('mindroomUi.workflowRun.title');
  const omitted = graph?.omitted;
  const hasOmitted = Boolean(omitted && Object.values(omitted).some(Boolean));
  const omittedSteps = omitted
    ? omitted.queued + omitted.running + omitted.waiting + omitted.completed + omitted.failed
    : 0;
  const omittedMessages = omitted?.messages ?? 0;
  const omittedEdges = omitted?.edges ?? 0;
  const omittedMessageTab = messages.length > 0 ? omittedMessages : omittedMessages + omittedEdges;
  const omittedLog = omitted?.log ?? 0;
  const askAgentLine = entry
    ? t('mindroomUi.workflowRun.panel.askAgent', { agent: agentProfile.name || entry.agent })
    : '';

  const tabCountText = (count: number, omittedCount: number): string | undefined => {
    if (count === 0 && omittedCount > 0) return undefined;
    const digits = localDigits(String(count), language);
    return omittedCount > 0 ? `${digits}+` : digits;
  };

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const rtl = documentIsRightToLeft();
    const nextIdx =
      event.key === 'ArrowRight'
        ? (index + (rtl ? -1 : 1) + TABS.length) % TABS.length
        : event.key === 'ArrowLeft'
          ? (index + (rtl ? 1 : -1) + TABS.length) % TABS.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? TABS.length - 1
              : -1;
    if (nextIdx < 0) return;
    event.preventDefault();
    const target = TABS[nextIdx]!;
    setActiveTab(target);
    tabRefs.current[target]?.focus();
  };

  const tabMeta: Record<WorkflowTab, { label: string; countText?: string }> = {
    flow: { label: t('mindroomUi.workflowRun.panel.flow') },
    steps: {
      label: t('mindroomUi.workflowRun.panel.steps'),
      countText: tabCountText(layout?.stepCount ?? 0, omittedSteps),
    },
    messages: {
      label: t('mindroomUi.workflowRun.node.messages'),
      countText: tabCountText(messageCount, omittedMessageTab),
    },
    log: {
      label: t('mindroomUi.workflowRun.panel.log'),
      countText: tabCountText(logLines.length, omittedLog),
    },
  };

  const omittedNotice = entry && hasOmitted && omitted && (
    <div className={css.InsetBox}>
      {OMITTED_ROWS.filter(([k]) => omitted[k] > 0).map(([k, msg]) => (
        <Text key={k} size="T200" priority="300">
          {t(msg, { count: omitted[k] })}
        </Text>
      ))}
      <Text size="T200" priority="300">
        {askAgentLine}
      </Text>
    </div>
  );

  const showSplit =
    entry &&
    (activeTab === 'flow' || activeTab === 'steps') &&
    ((layout && layout.bands.length > 0) || Boolean(selectedNode));

  return (
    <section tabIndex={-1} className={css.Panel} aria-label={heading} data-testid="workflow-panel">
      <header className={SidePanelHeader}>
        <Box direction="Column" gap="100" style={{ flex: '1 1 5rem', minInlineSize: 0 }}>
          <div className={cardCss.Row} style={{ gap: '4px' }}>
            <WorkflowRunTitleBadges heading={heading} view={entry} asHeading />
          </div>
          {entry && <WorkflowRunMetrics view={entry} isLive={isLive} now={now} />}
        </Box>
        <PanelHeaderControls onClose={onClose} closeLabel={t('mindroomUi.workflowRun.panel.close')}>
          <WorkflowRunControls
            room={room}
            run={run}
            view={entry}
            jobId={runJob?.jobId ?? null}
            threadId={effectiveThreadId}
            readOnly={readOnly}
            onError={setErrorBanner}
          />
        </PanelHeaderControls>
      </header>
      {entry && graph && (
        <div
          className={css.TabBar}
          role="tablist"
          aria-label={t('mindroomUi.workflowRun.panel.viewsLabel')}
        >
          {TABS.map((id, idx) => {
            const { label, countText } = tabMeta[id];
            const selected = activeTab === id;
            return (
              <button
                key={id}
                id={`${tabsId}-tab-${id}`}
                ref={(el) => {
                  tabRefs.current[id] = el;
                }}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={selected ? `${tabsId}-panel-${id}` : undefined}
                tabIndex={selected ? 0 : -1}
                className={css.TabButton}
                onClick={() => setActiveTab(id)}
                onKeyDown={(e) => onTabKeyDown(e, idx)}
              >
                <span>{label}</span>
                {countText !== undefined && (
                  <>
                    {' '}
                    <span className={css.MutedNum}>{countText}</span>
                  </>
                )}
              </button>
            );
          })}
        </div>
      )}
      <div className={css.Body}>
        {errorBanner && (
          <Text role="alert" size="T200" className={Failure}>
            {errorBanner}
          </Text>
        )}
        {(!entry || !graph) && (
          <Text size="T300" priority="300" className={css.Empty}>
            {t('mindroomUi.workflowRun.panel.waitingForUpdate')}
          </Text>
        )}
        {entry?.stale && (
          <Text size="T200" className={css.StaleBanner}>
            {t('mindroomUi.workflowRun.panel.stale', { time: staleRelative })}
          </Text>
        )}
        {entry && graph && (
          <div
            role="tabpanel"
            id={`${tabsId}-panel-${activeTab}`}
            aria-labelledby={`${tabsId}-tab-${activeTab}`}
            tabIndex={0}
            className={css.TabPanel}
          >
            {showSplit && (
              <div ref={splitRef} className={css.SplitLayout}>
                <div className={css.Band}>
                  {layout && layout.bands.length > 0 && (
                    <WorkflowGraphView
                      mode={activeTab === 'steps' ? 'steps' : 'flow'}
                      bands={layout.bands}
                      sessionsById={layout.sessionsById}
                      peerBridgesByGroup={layout.peerBridgesByGroup}
                      room={room}
                      subagentsByRun={subagentsByRun}
                      selectedId={selectedId}
                      selectedSessionId={selectedSessionId}
                      now={now}
                      onSelect={handleSelect}
                    />
                  )}
                  {omittedNotice}
                </div>
                {selectedNode ? (
                  <WorkflowNodeInspector
                    room={room}
                    threadId={effectiveThreadId}
                    node={selectedNode}
                    subagentRun={
                      selectedNode.run ? subagentsByRun.get(selectedNode.run) : undefined
                    }
                    session={
                      selectedNode.session
                        ? layout?.sessionsById.get(selectedNode.session)
                        : undefined
                    }
                    nodesById={nodesById}
                    edges={edges}
                    messages={messages}
                    now={now}
                    canStop={canStopNode}
                    inspectorRef={inspectorRef}
                    onSelect={selectNode}
                    onStopNode={(jobId) => void stopNode(jobId)}
                  />
                ) : (
                  <WorkflowInspectorEmpty />
                )}
              </div>
            )}
            {(activeTab === 'flow' || activeTab === 'steps') && !showSplit && omittedNotice}
            {activeTab === 'messages' && (
              <>
                {messages.length > 0 ? (
                  <ul className={css.MessageList}>
                    {messages.map((msg) => {
                      const fromName = messageEndpointName(
                        nodesById,
                        msg.from,
                        msg.fromName,
                        'from',
                        scriptLabel
                      );
                      const toName = messageEndpointName(
                        nodesById,
                        msg.to,
                        msg.toName,
                        'to',
                        scriptLabel
                      );
                      const renderEndpoint = (id: string | null, name: string) =>
                        id && nodesById.has(id) ? (
                          <button
                            type="button"
                            className={css.MessageNodeLink}
                            onClick={() => jumpToNode(id)}
                          >
                            <bdi>{name}</bdi>
                          </button>
                        ) : (
                          <bdi className={css.StrongText}>{name}</bdi>
                        );
                      return (
                        <li key={msg.seq} className={css.MessageCard}>
                          <div className={css.MessageHeader}>
                            <span className={css.MessageRoute} dir="ltr">
                              {renderEndpoint(msg.from, fromName)}
                              <span aria-hidden="true">→</span>
                              {renderEndpoint(msg.to, toName)}
                            </span>
                            {msg.sentAt !== null && (
                              <time
                                className={css.MutedNum}
                                dateTime={new Date(msg.sentAt * 1000).toISOString()}
                              >
                                {timeHourMinuteSecond(msg.sentAt * 1000, hour24Clock, language)}
                              </time>
                            )}
                          </div>
                          <p className={css.MessageText} {...ownDirectionBlock}>
                            {msg.text}
                          </p>
                        </li>
                      );
                    })}
                  </ul>
                ) : edges.length > 0 ? (
                  <ul className={css.MessageList}>
                    {edges.map((e) => {
                      const fromName = routeEndpointName(nodesById, e.from, 'from', scriptLabel);
                      const toName = routeEndpointName(nodesById, e.to, 'to', scriptLabel);
                      return (
                        <li key={`${e.from}->${e.to}`} className={css.MessageRow}>
                          <span dir="ltr" aria-hidden="true">
                            <bdi>{fromName}</bdi> → <bdi>{toName}</bdi>
                          </span>
                          <span className={css.CountBadge} aria-hidden="true">
                            {localDigits(String(e.count), language)}
                          </span>
                          <span className={css.VisuallyHidden}>
                            {t('mindroomUi.workflowRun.node.routeTo', {
                              from: fromName,
                              to: toName,
                              count: e.count,
                            })}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  omittedMessages === 0 &&
                  omittedEdges === 0 && (
                    <Text size="T200" priority="300" className={css.Empty}>
                      {t('mindroomUi.workflowRun.panel.noMessages')}
                    </Text>
                  )
                )}
                {(omittedMessages > 0 || omittedEdges > 0) && (
                  <div className={css.InsetBox}>
                    {omittedMessages > 0 && (
                      <Text size="T200" priority="300">
                        {t('mindroomUi.workflowRun.panel.omittedMessages', {
                          count: omittedMessages,
                        })}
                      </Text>
                    )}
                    {omittedEdges > 0 && (
                      <Text size="T200" priority="300">
                        {t('mindroomUi.workflowRun.panel.omittedEdges', { count: omittedEdges })}
                      </Text>
                    )}
                    <Text size="T200" priority="300">
                      {askAgentLine}
                    </Text>
                  </div>
                )}
              </>
            )}
            {activeTab === 'log' && (
              <>
                {logLines.length > 0 ? (
                  <ul className={css.LogList}>
                    {logLines.map((line, i) => (
                      // Log lines are append-only text and can repeat across rounds.
                      // eslint-disable-next-line react/no-array-index-key
                      <li key={i} {...ownDirectionLine}>
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : (
                  omittedLog === 0 && (
                    <Text size="T200" priority="300" className={css.Empty}>
                      {t('mindroomUi.workflowRun.panel.noLog')}
                    </Text>
                  )
                )}
                {omittedLog > 0 && (
                  <div className={css.InsetBox}>
                    <Text size="T200" priority="300">
                      {t('mindroomUi.workflowRun.panel.omittedLog', { count: omittedLog })}
                    </Text>
                    <Text size="T200" priority="300">
                      {askAgentLine}
                    </Text>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
