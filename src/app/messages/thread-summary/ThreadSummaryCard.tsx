import { type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, Chip, Icon, Icons, Text } from 'folds';
import { MessageEditedContent } from '../content/FallbackContent';
import { MessageTextBody } from '../layout/layout';
import { Time } from '../Time';
import { useGlassHighlight } from '../../ui/glass/liquid/useLiquidGlass';
import type { MindroomThreadSummaryInfo } from '../../matrix/protocol/threadSummary';
import * as css from './ThreadSummaryCard.css';

type MindroomThreadSummaryCardProps = {
  summaryInfo: MindroomThreadSummaryInfo;
  /** Thread badges and overview rows: a single provenance line, no chip and no time. */
  compact?: boolean;
  /** The summary notice was edited. */
  edited?: boolean;
  renderBody: (props: { body: string; customBody?: string }) => ReactNode;
};

/**
 * A thread title (`io.mindroom.thread_summary` notice) rendered as a card: who wrote it (an
 * agent's model or a person editing it by hand) and how many messages it covers.
 */
export function MindroomThreadSummaryCard({
  summaryInfo,
  compact,
  edited,
  renderBody,
}: MindroomThreadSummaryCardProps) {
  const { t } = useTranslation();
  // The timeline card follows the pointer like the other glass cards; compact rows sit inside one.
  const glassRef = useGlassHighlight<HTMLElement>(undefined, !compact);
  const { isManual, summaryText, messageCount, generatedTs } = summaryInfo;
  const hasCount = typeof messageCount === 'number' && messageCount > 0;

  let label: string;
  if (isManual) {
    label = t('sharedUi.threadSummary.manual');
  } else if (compact && hasCount) {
    label = t('sharedUi.threadSummary.provenanceCount', { count: messageCount });
  } else {
    label = compact
      ? t('sharedUi.threadSummary.provenance')
      : t('mindroomUi.messages.mindroomThreadSummaryCard.aiThreadSummary');
  }

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
        {!compact && !isManual && hasCount && (
          <Chip as="span" size="400" radii="Pill" variant="SurfaceVariant" aria-disabled="true">
            <Text size="T200">
              {t('sharedUi.threadSummary.provenanceCount', { count: messageCount })}
            </Text>
          </Chip>
        )}
        {!compact && typeof generatedTs === 'number' && <Time ts={generatedTs} compact />}
      </div>
      <MessageTextBody className={compact ? css.ThreadSummaryBodyCompact : css.ThreadSummaryBody}>
        {renderBody({ body: summaryText ?? '' })}
        {edited && <MessageEditedContent />}
      </MessageTextBody>
    </Box>
  );
}
