import type { Ref } from 'react';
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
  messageEndpointName,
  nodeResultPreview,
  routeEndpointName,
  sessionBadgeLabel,
  type WorkflowSessionInfo,
} from './workflowGraphModel';
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
  const language = useAppLanguageCode();
  const jotaiStore = useStore();
  const agentProfile = useAgentProfile(room, node.agent ?? '');

  const { model, tokens, cost, elapsed } = getWorkflowNodeMetrics(node, subagentRun, now, language);
  const kpis: [string, string | undefined][] = [
    [t('mindroomUi.workflowRun.node.duration'), elapsed],
    [t('mindroomUi.workflowRun.node.tokens'), tokens],
    [t('mindroomUi.workflowRun.node.cost'), cost],
  ];
  const scriptLabel = t('mindroomUi.workflowRun.node.script');
  const preview = nodeResultPreview(subagentRun) ?? (node.preview?.trim() || undefined);
  const sessionName = sessionBadgeLabel(session);
  const hasMessages = messages.length > 0;
  const directMessages = hasMessages
    ? messages.filter((m) => m.from === node.id || m.to === node.id)
    : [];
  const sessionMessages =
    hasMessages && node.session
      ? messages.filter(
          (m) =>
            (m.from === node.session || m.to === node.session) &&
            m.from !== node.id &&
            m.to !== node.id
        )
      : [];
  const directOut = hasMessages ? [] : edges.filter((e) => e.from === node.id);
  const directIn = hasMessages ? [] : edges.filter((e) => e.to === node.id);
  const sessionOut =
    !hasMessages && node.session
      ? edges.filter((e) => e.from === node.session && e.to !== node.id)
      : [];
  const sessionIn =
    !hasMessages && node.session
      ? edges.filter((e) => e.to === node.session && e.from !== node.id)
      : [];
  const renderEdgeLinks = (
    outEdges: readonly WorkflowRunEdge[],
    inEdges: readonly WorkflowRunEdge[]
  ) => (
    <>
      {outEdges.map((e) => (
        <button
          key={`out:${e.from}->${e.to}`}
          type="button"
          className={css.PeerLinkButton}
          onClick={() => onSelect(e.to)}
        >
          {t('mindroomUi.workflowRun.node.messagesTo', {
            name: routeEndpointName(nodesById, e.to, 'to', scriptLabel),
            count: e.count,
          })}
        </button>
      ))}
      {inEdges.map((e) => (
        <button
          key={`in:${e.from}->${e.to}`}
          type="button"
          className={css.PeerLinkButton}
          onClick={() => onSelect(e.from)}
        >
          {t('mindroomUi.workflowRun.node.messagesFrom', {
            name: routeEndpointName(nodesById, e.from, 'from', scriptLabel),
            count: e.count,
          })}
        </button>
      ))}
    </>
  );
  const renderMessageItems = (items: readonly WorkflowRunMessage[], ownerId: string) =>
    items.map((m) => {
      const fromName = messageEndpointName(nodesById, m.from, m.fromName, 'from', scriptLabel);
      const toName = messageEndpointName(nodesById, m.to, m.toName, 'to', scriptLabel);
      const peerId = m.from === ownerId ? m.to : m.from;
      const clickablePeer = peerId && peerId !== node.id && nodesById.has(peerId) ? peerId : null;
      const content = (
        <>
          <span className={css.MessageHeader}>
            <span dir="ltr" aria-hidden="true">
              <bdi>{fromName}</bdi> → <bdi>{toName}</bdi>
            </span>
            <span className={css.VisuallyHidden}>
              {t('mindroomUi.workflowRun.node.messageRoute', { from: fromName, to: toName })}
            </span>
          </span>
          <span className={css.MessagePreview} {...ownDirectionBlock}>
            {m.text}
          </span>
        </>
      );
      return clickablePeer ? (
        <button
          key={m.seq}
          type="button"
          className={css.PeerMessageButton}
          onClick={() => onSelect(clickablePeer)}
        >
          {content}
        </button>
      ) : (
        <div key={m.seq} className={css.PeerMessageCard}>
          {content}
        </div>
      );
    });
  const canOpenSubagent = Boolean(node.run && subagentRun);

  return (
    <aside ref={inspectorRef} className={css.InspectorPane} data-workflow-node-details={node.id}>
      <div className={css.Stack}>
        <div className={css.ChipTop}>
          <span className={css.NodeDot[node.status]} aria-hidden />
          <Text as="h3" size="T300" className={css.StrongText} {...ownDirectionLine}>
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

      {(directMessages.length > 0 || directOut.length > 0 || directIn.length > 0) && (
        <div className={css.Stack}>
          <Text size="T200" className={css.StrongText}>
            {t('mindroomUi.workflowRun.node.messages')}
          </Text>
          {hasMessages
            ? renderMessageItems(directMessages, node.id)
            : renderEdgeLinks(directOut, directIn)}
        </div>
      )}

      {(sessionMessages.length > 0 || sessionOut.length > 0 || sessionIn.length > 0) && (
        <div className={css.Stack} data-workflow-session-messages={node.session ?? undefined}>
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
          {hasMessages && node.session
            ? renderMessageItems(sessionMessages, node.session)
            : renderEdgeLinks(sessionOut, sessionIn)}
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
