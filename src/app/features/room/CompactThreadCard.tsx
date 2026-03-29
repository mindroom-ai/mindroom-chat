import React from 'react';
import { Badge, Box, Icon, Icons, Text } from 'folds';
import { useRelativeTime } from '../../hooks/useRelativeTime';
import {
  getThreadOverviewSummaryText,
  type AttentionState,
  type ThreadOverviewMetadata,
} from './roomThreadOverviewModel';
import * as css from './CompactRoomView.css';

const numberFormatter = new Intl.NumberFormat();
const SUMMARY_FALLBACK_LIMIT = 100;

const truncateSummaryText = (value: string): string =>
  value.length <= SUMMARY_FALLBACK_LIMIT
    ? value
    : `${value.slice(0, SUMMARY_FALLBACK_LIMIT - 1).trimEnd()}...`;

const getMessageCountLabel = (messageCount: number): string => {
  const formattedCount = numberFormatter.format(messageCount);
  return `${formattedCount} ${messageCount === 1 ? 'msg' : 'msgs'}`;
};

const getAttentionStatusText = (attentionState: AttentionState): string => {
  switch (attentionState) {
    case 'needs-attention':
      return 'Needs attention';
    case 'waiting':
      return 'Waiting on response';
    case 'streaming':
      return 'Agent streaming';
    case 'resolved':
      return 'Resolved';
    case 'idle':
    default:
      return 'Idle';
  }
};

export type CompactThreadCardProps = {
  threadRootId: string;
  metadata: ThreadOverviewMetadata;
  attentionState: AttentionState;
  onClick: (threadRootId: string) => void;
};

export function CompactThreadCard({
  threadRootId,
  metadata,
  attentionState,
  onClick,
}: CompactThreadCardProps) {
  const relativeTime = useRelativeTime(metadata.lastActivityTs || undefined);
  const summaryText = truncateSummaryText(
    getThreadOverviewSummaryText(metadata) ?? 'Thread started'
  );
  const agentDisplayName = metadata.participantDisplayName;
  const messageCountLabel = getMessageCountLabel(metadata.messageCount);
  const attentionStatusText = getAttentionStatusText(attentionState);
  const ariaLabel = [
    `Open thread: ${summaryText}`,
    attentionStatusText,
    messageCountLabel,
    agentDisplayName ? `Participant ${agentDisplayName}` : undefined,
    relativeTime ? `Last activity ${relativeTime}` : undefined,
  ]
    .filter(Boolean)
    .join('. ');
  const screenReaderStatusText = `Thread status: ${attentionStatusText}.`;

  return (
    <button
      className={css.Card}
      type="button"
      onClick={() => onClick(threadRootId)}
      data-thread-root-id={threadRootId}
      aria-label={ariaLabel}
    >
      <Box className={`${css.Row} ${css.SummaryRow}`}>
        <Box className={css.SummaryLead}>
          <span
            className={css.AttentionDot({ state: attentionState })}
            data-attention-state={attentionState}
            aria-hidden="true"
          />
          <span className={css.ScreenReaderText}>{screenReaderStatusText}</span>
          <Text className={css.SummaryText} size="B300" truncate>
            {summaryText}
          </Text>
        </Box>
        {relativeTime && (
          <Text className={css.TimeText} size="T200" priority="300">
            {relativeTime}
          </Text>
        )}
      </Box>

      <Box className={css.Row}>
        {agentDisplayName ? (
          <Text
            className={`${css.MetaText} ${css.MetaTruncate}`}
            size="T200"
            priority="300"
            truncate
          >
            {agentDisplayName}
          </Text>
        ) : (
          <span className={css.MetaSpacer} aria-hidden="true" />
        )}
        <Text className={css.MetaText} size="T200" priority="300">
          {messageCountLabel}
        </Text>
        {metadata.isResolved && (
          <Badge as="span" size="400" variant="Success" fill="Soft" radii="Pill" outlined>
            <Box as="span" alignItems="Center" gap="100">
              <Icon size="50" src={Icons.CheckTwice} />
              <Text size="T200">Resolved</Text>
            </Box>
          </Badge>
        )}
      </Box>
    </button>
  );
}
