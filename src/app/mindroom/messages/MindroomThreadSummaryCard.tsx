import React, { ReactNode } from 'react';
import { Box, Icon, Icons, Text } from 'folds';
import { useSetting } from '../../state/hooks/settings';
import { settingsAtom } from '../../state/settings';
import { MessageEditedContent } from '../../components/message/content';
import { MessageTextBody } from '../../components/message/layout';
import { Time } from '../../components/message/Time';
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
  const [hour24Clock] = useSetting(settingsAtom, 'hour24Clock');
  const [dateFormatString] = useSetting(settingsAtom, 'dateFormatString');
  const summaryText = summaryInfo.summaryText ?? 'Thread summary';
  const messageCountLabel =
    typeof summaryInfo.messageCount === 'number'
      ? formatMindroomThreadSummaryMessageCount(summaryInfo.messageCount)
      : undefined;
  const provenanceLabel = messageCountLabel
    ? `Generated from last ${messageCountLabel}`
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
          <Text size="T200">AI summary</Text>
        </Box>
        <Text as="span" size="T200" className={css.ThreadSummaryMeta}>
          {provenanceLabel}
        </Text>
        {summaryInfo.generatedTs && (
          <Time
            ts={summaryInfo.generatedTs}
            hour24Clock={hour24Clock}
            dateFormatString={dateFormatString}
          />
        )}
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
