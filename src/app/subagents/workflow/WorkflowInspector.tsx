import { type Ref, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { useStore } from 'jotai';
import type { Room } from 'matrix-js-sdk';
import { Button, Text } from 'folds';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import type {
  WorkflowRunEdge,
  WorkflowRunMessage,
  WorkflowRunNode,
} from '../../matrix/protocol/workflowFrame';
import type { SubagentRun } from '../../messages/live/subagentRunStore';
import { workflowNodeStatusLabel } from '../../messages/workflow-run/workflowRunLabels';
import * as cardCss from '../../messages/workflow-run/WorkflowRunCard.css';
import { openSubagentsPanel } from '../../navigation/subagentsPanel';
import { ownDirectionBlock, ownDirectionLine } from '../../ui/directional';
import { AgentAvatar, useAgentProfile } from '../AgentAvatar';
import {
  getWorkflowNodeMetrics,
  nodeResultPreview,
  sessionBadgeLabel,
  type WorkflowSessionInfo,
} from './workflowGraphModel';
import { collectNodeMessagesAndEdges, WorkflowNodeMessageItems } from './WorkflowMessages';
import * as css from './workflowPanel.css';

export function WorkflowInspectorEmpty() {
  const { t } = useTranslation();
  return (
    <aside className={css.InspectorEmpty}>
      <Text size="T200" priority="300">
        {t('mindroomUi.workflowRun.panel.selectStep')}
      </Text>
    </aside>
  );
}

export type WorkflowNodeInspectorProps = {
  room: Room;
  threadId: string | null;
  node: WorkflowRunNode;
  subagentRun?: SubagentRun;
  session?: WorkflowSessionInfo;
  nodesById: ReadonlyMap<string, WorkflowRunNode>;
  edges: readonly WorkflowRunEdge[];
  messages: readonly WorkflowRunMessage[];
  now: number;
  canStop: boolean;
  inspectorRef?: Ref<HTMLElement>;
  onSelect: (id: string) => void;
  onStopNode: (jobId: string) => void;
};

/** Sticky inspector pane for the selected workflow node: KPIs, error, preview, peer links, actions. */
export function WorkflowNodeInspector({
  room,
  threadId,
  node,
  subagentRun,
  session,
  nodesById,
  edges,
  messages,
  now,
  canStop,
  inspectorRef,
  onSelect,
  onStopNode,
}: WorkflowNodeInspectorProps) {
  const { t } = useTranslation();
  const headingId = useId();
  const language = useAppLanguageCode();
  const jotaiStore = useStore();
  const agentProfile = useAgentProfile(room, node.agent ?? '');

  const { model, tokens, cost, elapsed } = getWorkflowNodeMetrics(node, subagentRun, now, language);
  const kpis: [string, string | undefined][] = [
    [t('mindroomUi.workflowRun.node.duration'), elapsed],
    [t('mindroomUi.workflowRun.node.tokens'), tokens],
    [t('mindroomUi.workflowRun.node.cost'), cost],
  ];
  const preview = nodeResultPreview(subagentRun) ?? (node.preview?.trim() || undefined);
  const sessionName = sessionBadgeLabel(session);
  const direct = collectNodeMessagesAndEdges(messages, edges, node.id);
  const sessionPeer = node.session
    ? collectNodeMessagesAndEdges(messages, edges, node.session, node.id)
    : null;
  const hasDirectPeer =
    direct.nodeMessages.length > 0 || direct.outEdges.length > 0 || direct.inEdges.length > 0;
  const hasSessionPeer = Boolean(
    sessionPeer &&
    (sessionPeer.nodeMessages.length > 0 ||
      sessionPeer.outEdges.length > 0 ||
      sessionPeer.inEdges.length > 0)
  );
  const canOpenSubagent = Boolean(node.run && subagentRun);

  return (
    <aside
      ref={inspectorRef}
      tabIndex={-1}
      aria-labelledby={headingId}
      className={css.InspectorPane}
      data-workflow-node-details={node.id}
    >
      <div className={css.Stack}>
        <div className={css.ChipTop}>
          <span className={css.NodeDot[node.status]} aria-hidden />
          <Text as="h3" id={headingId} size="T300" className={css.StrongText} {...ownDirectionLine}>
            {node.label}
          </Text>
          {sessionName && (
            <span className={css.SessionBadge} {...ownDirectionLine}>
              @{sessionName}
            </span>
          )}
        </div>
        <Text size="T200" priority="300">
          {workflowNodeStatusLabel(node.status, t, node.waitingOn)}
          {node.cached ? ` · ${t('mindroomUi.workflowRun.node.reused')}` : ''}
        </Text>
      </div>

      {(node.agent || model) && (
        <div className={css.ChipTop}>
          {node.agent && <AgentAvatar agent={agentProfile} size="200" />}
          <Text size="T200" priority="300" {...ownDirectionLine}>
            {[node.agent ? agentProfile.name : undefined, model].filter(Boolean).join(' · ')}
          </Text>
        </div>
      )}

      {kpis.some(([, value]) => Boolean(value)) && (
        <div className={css.KpiGrid}>
          {kpis.map(([label, value]) => (
            <div key={label} className={css.KpiCell}>
              <Text as="span" size="T200" priority="300">
                {label}
              </Text>
              <Text as="span" size="T200" className={css.KpiValue}>
                {value ?? '—'}
              </Text>
            </div>
          ))}
        </div>
      )}

      {node.error && (
        <div className={css.ErrorBox}>
          <Text size="T200" className={css.StrongText}>
            {t('mindroomUi.workflowRun.node.error')}
          </Text>
          <Text size="T200" {...ownDirectionBlock}>
            {node.error}
          </Text>
        </div>
      )}

      {preview && (
        <div className={css.Stack}>
          <Text size="T200" className={css.StrongText}>
            {t('mindroomUi.workflowRun.node.result')}
          </Text>
          <pre className={css.ResultPre} {...ownDirectionBlock}>
            {preview}
          </pre>
        </div>
      )}

      {hasDirectPeer && (
        <div className={css.Stack}>
          <Text size="T200" className={css.StrongText}>
            {t('mindroomUi.workflowRun.node.messages')}
          </Text>
          <WorkflowNodeMessageItems
            messages={direct.nodeMessages}
            outEdges={direct.outEdges}
            inEdges={direct.inEdges}
            nodesById={nodesById}
            ownerId={node.id}
            selectedNodeId={node.id}
            onSelect={onSelect}
          />
        </div>
      )}

      {hasSessionPeer && sessionPeer && node.session && (
        <div className={css.Stack} data-workflow-session-messages={node.session}>
          <div className={css.ChipTop}>
            <Text size="T200" className={css.StrongText}>
              {t('mindroomUi.workflowRun.node.messages')}
            </Text>
            {sessionName && (
              <span className={css.SessionBadge} {...ownDirectionLine}>
                @{sessionName}
              </span>
            )}
          </div>
          <WorkflowNodeMessageItems
            messages={sessionPeer.nodeMessages}
            outEdges={sessionPeer.outEdges}
            inEdges={sessionPeer.inEdges}
            nodesById={nodesById}
            ownerId={node.session}
            selectedNodeId={node.id}
            onSelect={onSelect}
          />
        </div>
      )}

      {(canOpenSubagent || (canStop && node.job)) && (
        <div className={cardCss.Row}>
          {canOpenSubagent && (
            <Button
              type="button"
              size="300"
              variant="Secondary"
              fill="Soft"
              onClick={() => openSubagentsPanel(jotaiStore, room.roomId, threadId, node.run)}
            >
              <Text size="B300">{t('mindroomUi.workflowRun.node.open')}</Text>
            </Button>
          )}
          {canStop && node.job && (
            <Button
              type="button"
              size="300"
              variant="Critical"
              fill="Soft"
              onClick={() => onStopNode(node.job!)}
            >
              <Text size="B300">{t('mindroomUi.workflowRun.node.stop')}</Text>
            </Button>
          )}
        </div>
      )}

      {node.run && !subagentRun && (
        <Text size="T200" priority="300">
          {t(
            preview
              ? 'mindroomUi.workflowRun.node.transcriptUnavailable'
              : 'mindroomUi.workflowRun.node.detailsUnavailable'
          )}
        </Text>
      )}
    </aside>
  );
}
