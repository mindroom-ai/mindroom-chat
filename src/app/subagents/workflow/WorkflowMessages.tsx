import { useTranslation } from 'react-i18next';
import { Text } from 'folds';
import { useAppLanguageCode } from '../../i18n/useAppLanguageCode';
import { localDigits } from '../../lib/localDigits';
import { timeHourMinuteSecond } from '../../lib/time';
import type {
  WorkflowRunEdge,
  WorkflowRunMessage,
  WorkflowRunNode,
} from '../../matrix/protocol/workflowFrame';
import { useHour24Clock } from '../../preferences/useHour24Clock';
import { ownDirectionBlock } from '../../ui/directional';
import { messageEndpointName, routeEndpointName } from './workflowGraphModel';
import * as msgCss from './workflowMessages.css';
import * as css from './workflowPanel.css';

/** Partitions a node's (or session's) messages and keeps any aggregate edges not covered by them. */
export const collectNodeMessagesAndEdges = (
  messages: readonly WorkflowRunMessage[],
  edges: readonly WorkflowRunEdge[],
  ownerId: string,
  excludePeerId?: string
) => {
  const nodeMessages = messages.filter(
    (m) =>
      (m.from === ownerId || m.to === ownerId) &&
      (!excludePeerId || (m.from !== excludePeerId && m.to !== excludePeerId))
  );
  const covered = new Set<string>();
  for (const m of nodeMessages) {
    if (m.from && m.to) covered.add(`${m.from}\0${m.to}`);
  }
  const outEdges = edges.filter(
    (e) => e.from === ownerId && e.to !== excludePeerId && !covered.has(`${e.from}\0${e.to}`)
  );
  const inEdges = edges.filter(
    (e) => e.to === ownerId && e.from !== excludePeerId && !covered.has(`${e.from}\0${e.to}`)
  );
  return { nodeMessages, outEdges, inEdges };
};

export type WorkflowNodeMessageItemsProps = {
  messages: readonly WorkflowRunMessage[];
  outEdges: readonly WorkflowRunEdge[];
  inEdges: readonly WorkflowRunEdge[];
  nodesById: ReadonlyMap<string, WorkflowRunNode>;
  ownerId: string;
  selectedNodeId: string;
  onSelect: (id: string) => void;
};

/** Renders a node's/session's message previews plus aggregate route links for any uncovered edges. */
export function WorkflowNodeMessageItems({
  messages,
  outEdges,
  inEdges,
  nodesById,
  ownerId,
  selectedNodeId,
  onSelect,
}: WorkflowNodeMessageItemsProps) {
  const { t } = useTranslation();
  const scriptLabel = t('mindroomUi.workflowRun.node.script');
  return (
    <>
      {messages.map((m) => {
        const fromName = messageEndpointName(nodesById, m.from, m.fromName, 'from', scriptLabel);
        const toName = messageEndpointName(nodesById, m.to, m.toName, 'to', scriptLabel);
        const peerId = m.from === ownerId ? m.to : m.from;
        const clickablePeer =
          peerId && peerId !== selectedNodeId && nodesById.has(peerId) ? peerId : null;
        const content = (
          <>
            <span className={msgCss.MessageHeader}>
              <span dir="ltr" aria-hidden="true">
                <bdi>{fromName}</bdi> → <bdi>{toName}</bdi>
              </span>
              <span className={css.VisuallyHidden}>
                {t('mindroomUi.workflowRun.node.messageRoute', { from: fromName, to: toName })}
              </span>
            </span>
            <span className={msgCss.MessagePreview} {...ownDirectionBlock}>
              {m.text}
            </span>
          </>
        );
        return clickablePeer ? (
          <button
            key={m.seq}
            type="button"
            className={msgCss.PeerMessageButton}
            onClick={() => onSelect(clickablePeer)}
          >
            {content}
          </button>
        ) : (
          <div key={m.seq} className={msgCss.PeerMessageCard}>
            {content}
          </div>
        );
      })}
      {outEdges.map((e) => (
        <button
          key={`out:${e.from}->${e.to}`}
          type="button"
          className={msgCss.PeerLinkButton}
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
          className={msgCss.PeerLinkButton}
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
}

export type WorkflowMessagesTabProps = {
  messages: readonly WorkflowRunMessage[];
  edges: readonly WorkflowRunEdge[];
  nodesById: ReadonlyMap<string, WorkflowRunNode>;
  omittedMessages: number;
  omittedEdges: number;
  askAgentLine: string;
  onJumpToNode: (id: string) => void;
};

/** Messages tab content: chronological message cards, legacy edge fallback, and omission notices. */
export function WorkflowMessagesTab({
  messages,
  edges,
  nodesById,
  omittedMessages,
  omittedEdges,
  askAgentLine,
  onJumpToNode,
}: WorkflowMessagesTabProps) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const [hour24Clock] = useHour24Clock();
  const scriptLabel = t('mindroomUi.workflowRun.node.script');

  const renderEndpoint = (id: string | null, name: string) =>
    id && nodesById.has(id) ? (
      <button type="button" className={msgCss.MessageNodeLink} onClick={() => onJumpToNode(id)}>
        <bdi>{name}</bdi>
      </button>
    ) : (
      <bdi className={css.StrongText}>{name}</bdi>
    );

  return (
    <>
      {messages.length > 0 ? (
        <ul className={msgCss.MessageList}>
          {messages.map((msg) => {
            const fromName = messageEndpointName(
              nodesById,
              msg.from,
              msg.fromName,
              'from',
              scriptLabel
            );
            const toName = messageEndpointName(nodesById, msg.to, msg.toName, 'to', scriptLabel);
            return (
              <li key={msg.seq} className={msgCss.MessageCard}>
                <div className={msgCss.MessageHeader}>
                  <span className={msgCss.MessageRoute} dir="ltr">
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
                <p className={msgCss.MessageText} {...ownDirectionBlock}>
                  {msg.text}
                </p>
              </li>
            );
          })}
        </ul>
      ) : edges.length > 0 ? (
        <ul className={msgCss.MessageList}>
          {edges.map((e) => {
            const fromName = routeEndpointName(nodesById, e.from, 'from', scriptLabel);
            const toName = routeEndpointName(nodesById, e.to, 'to', scriptLabel);
            return (
              <li key={`${e.from}->${e.to}`} className={msgCss.MessageRow}>
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
              {t('mindroomUi.workflowRun.panel.omittedMessages', { count: omittedMessages })}
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
  );
}
