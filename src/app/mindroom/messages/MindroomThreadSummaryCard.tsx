import React, { ReactNode } from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import { MessageEditedContent } from '../../components/message/content';
import { MessageTextBody } from '../../components/message/layout';
import {
  formatMindroomThreadSummaryMessageCount,
  type MindroomThreadSummaryInfo,
} from './threadSummary';
import * as css from './MindroomThreadSummaryCard.css';

type RenderBodyProps = {
  body: string;
  customBody?: string;
};

type MindroomThreadSummaryCardProps = {
  edited?: boolean;
  compact?: boolean;
  summaryInfo: MindroomThreadSummaryInfo;
  renderBody: (props: RenderBodyProps) => ReactNode;
};

export function MindroomThreadSummaryCard({
  edited,
  compact,
  summaryInfo,
  renderBody,
}: MindroomThreadSummaryCardProps) {
  const summaryText = summaryInfo.summaryText ?? 'Thread summary';
  const messageCountLabel =
    typeof summaryInfo.messageCount === 'number'
      ? formatMindroomThreadSummaryMessageCount(summaryInfo.messageCount)
      : undefined;
  const provenanceLabel = messageCountLabel
    ? `AI summary of last ${messageCountLabel}`
    : 'AI-generated thread summary';

  return (
    <Box
      className={css.ThreadSummaryCard}
      direction="Column"
      gap="100"
      aria-label="AI thread summary"
    >
      <Box className={css.ThreadSummaryHeader}>
        <Box as="span" className={css.ThreadSummaryLabel}>
          <Icon size="50" src={Icons.Bulb} />
          <Text as="span" size="T200">
            {provenanceLabel}
          </Text>
        </Box>
      </Box>

      <MessageTextBody
        preWrap
        className={compact ? css.ThreadSummaryBodyCompact : css.ThreadSummaryBody}
      >
        {renderBody({ body: summaryText })}
        {edited && <MessageEditedContent />}
      </MessageTextBody>
    </Box>
  );
}
