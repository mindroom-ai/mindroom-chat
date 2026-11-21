import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Chip, Icon, Icons, Text } from 'folds';
import { MessageEditedContent } from '../content/FallbackContent';
import { MessageTextBody } from '../layout/layout';
import { Time } from '../Time';
import { useGlassHighlight } from '../../ui/glass/liquid/useLiquidGlass';
import type { ThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import * as css from './ThreadSummaryCard.css';

type ThreadSummaryCardProps = {
  summaryInfo: ThreadSummaryInfo;
  /** The summary notice was edited. */
  edited?: boolean;
  renderBody: (props: { body: string; customBody?: string }) => ReactNode;
};

/**
 * A thread title (`io.mindroom.thread_summary` notice) rendered as a card: who wrote it (an
 * agent's model or a person editing it by hand) and how many messages it covers.
 */
export function ThreadSummaryCard({ summaryInfo, edited, renderBody }: ThreadSummaryCardProps) {
  const { t } = useTranslation();
  const glassRef = useGlassHighlight<HTMLElement>();
  const { isManual, summaryText, messageCount, generatedTs } = summaryInfo;
  const hasCount = typeof messageCount === 'number' && messageCount > 0;

  const label = isManual
    ? t('sharedUi.threadSummary.manual')
    : t('mindroomUi.messages.mindroomThreadSummaryCard.aiThreadSummary');

  return (
    // A group, not a region landmark: a timeline holds many summaries under the same name.
    <Box
      as="section"
      role="group"
      ref={glassRef}
      className={css.ThreadSummaryCard}
      direction="Column"
      gap="100"
      aria-label={label}
    >
      <div className={css.ThreadSummaryHeader}>
        <Text as="span" className={css.ThreadSummaryLabel} size="L400">
          <Icon size="50" src={Icons.Bulb} aria-hidden="true" />
          {label}
        </Text>
        {!isManual && hasCount && (
          <Chip as="span" size="400" radii="Pill" variant="SurfaceVariant" aria-disabled="true">
            <Text size="T200">
              {t('sharedUi.threadSummary.provenanceCount', { count: messageCount })}
            </Text>
          </Chip>
        )}
        {typeof generatedTs === 'number' && <Time ts={generatedTs} compact />}
      </div>
      <MessageTextBody className={css.ThreadSummaryBody}>
        {renderBody({ body: summaryText ?? '' })}
        {edited && <MessageEditedContent />}
      </MessageTextBody>
    </Box>
  );
}
