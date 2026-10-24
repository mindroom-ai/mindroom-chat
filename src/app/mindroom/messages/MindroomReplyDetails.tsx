import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'folds';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { ProviderModelIcon } from '../models/ProviderModelIcon';
import { useThreadConversationCost } from '../threads/useThreadConversationCost';
import { MindroomAiRunInfo } from './aiRun';
import {
  formatMindroomAiRunNumber,
  formatMindroomAiRunTimeToFirstToken,
  formatMindroomConversationCost,
  formatMindroomCostUsd,
  getMindroomAiRunCompactModelLabel,
  getMindroomAiRunContextBarSegments,
  getMindroomAiRunContextLabel,
} from './aiRunDisplay';
import * as css from './MindroomReplyDetails.css';

type Row = [label: string, value: string | undefined];

function Rows({
  rows,
  className = css.Rows,
  valueClassName = css.Value,
  size = 'T300',
}: {
  rows: Row[];
  className?: string;
  valueClassName?: string;
  size?: 'T200' | 'T300';
}) {
  return (
    <dl className={className}>
      {rows.map(([label, value]) =>
        value === undefined ? null : (
          <React.Fragment key={label}>
            <Text as="dt" size={size} priority="300">
              {label}
            </Text>
            <Text as="dd" size={size} className={valueClassName}>
              {value}
            </Text>
          </React.Fragment>
        )
      )}
    </dl>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={css.Section}>
      <Text as="h3" size="L400" priority="300">
        {title}
      </Text>
      {children}
    </section>
  );
}

/** A section of label and value rows that renders nothing when none of its values is known. */
function RowSection({ title, rows }: { title: string; rows: Row[] }) {
  if (rows.every(([, value]) => value === undefined)) return null;
  return (
    <Section title={title}>
      <Rows rows={rows} />
    </Section>
  );
}

function ContextWindow({ info }: { info: MindroomAiRunInfo }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const usage = getMindroomAiRunContextLabel(info, t, language);
  if (!usage) return null;
  const segments = getMindroomAiRunContextBarSegments(info, t);
  return (
    <Section title={t('mindroomUi.messages.mindroomReplyDetails.contextWindow')}>
      <Text size="T300">{usage}</Text>
      {segments && (
        <>
          {/* The legend below says what each part of the bar holds. */}
          <div className={css.ContextBar} aria-hidden>
            {segments.map((segment) => (
              <div
                key={segment.key}
                className={css.ContextBarSegment[segment.key]}
                style={{ width: `${segment.percentage}%` }}
              />
            ))}
          </div>
          <ul className={css.Legend}>
            {segments.map((segment) => (
              <Text as="li" key={segment.key} size="T200" className={css.LegendItem}>
                <span className={css.Swatch[segment.key]} aria-hidden />
                <Text as="span" size="T200" priority="300">
                  {segment.label}
                </Text>
                {formatMindroomAiRunNumber(segment.tokens, language)}
              </Text>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}

const STATUS_LABEL_KEYS = {
  error: 'mindroomUi.messages.mindroomReplyDetails.failed',
  cancelled: 'mindroomUi.messages.mindroomReplyDetails.stopped',
} as const;

const isFlaggedStatus = (status: string | undefined): status is keyof typeof STATUS_LABEL_KEYS =>
  status === 'error' || status === 'cancelled';

/** What a MindRoom reply ran on, what it cost, and what it used, grouped from most to least asked about. */
export function MindroomReplyDetails({
  info,
  eventId,
}: {
  info: MindroomAiRunInfo;
  eventId?: string;
}) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const threadCost = useThreadConversationCost();
  const number = (value: number | undefined) => formatMindroomAiRunNumber(value, language);

  const modelLabel = getMindroomAiRunCompactModelLabel(info);
  const modelSource = [info.modelProvider, info.modelId].filter(Boolean).join(' · ');
  const status = info.status?.toLowerCase();
  const throughReply = eventId ? threadCost?.byEventId.get(eventId) : undefined;

  return (
    <div className={css.Body}>
      {(modelLabel || isFlaggedStatus(status)) && (
        <div className={css.Lead}>
          {modelLabel && (
            <ProviderModelIcon provider={info.modelProvider} id={info.modelId} size={20} />
          )}
          <div className={css.ModelName}>
            {modelLabel && (
              <Text size="T400" truncate>
                {modelLabel}
              </Text>
            )}
            {modelSource && (
              <Text size="T200" priority="300" truncate>
                {modelSource}
              </Text>
            )}
          </div>
          {isFlaggedStatus(status) && (
            <span className={css.Status[status]}>{t(STATUS_LABEL_KEYS[status])}</span>
          )}
        </div>
      )}
      {info.costUsd !== undefined && (
        <RowSection
          title={t('mindroomUi.messages.mindroomReplyDetails.cost')}
          rows={[
            [
              t('mindroomUi.messages.mindroomReplyDetails.thisReply'),
              formatMindroomCostUsd(info.costUsd, language),
            ],
            [
              t('mindroomUi.messages.mindroomReplyDetails.conversationSoFar'),
              threadCost && throughReply
                ? formatMindroomConversationCost(throughReply, threadCost.complete, t, language)
                : undefined,
            ],
          ]}
        />
      )}
      <RowSection
        title={t('mindroomUi.messages.mindroomReplyDetails.tokens')}
        rows={[
          [t('mindroomUi.messages.mindroomReplyDetails.input'), number(info.inputTokens)],
          [t('mindroomUi.messages.mindroomReplyDetails.fromCache'), number(info.cacheReadTokens)],
          [
            t('mindroomUi.messages.mindroomReplyDetails.writtenToCache'),
            number(info.cacheWriteTokens),
          ],
          [t('mindroomUi.messages.mindroomReplyDetails.output'), number(info.outputTokens)],
          [t('mindroomUi.messages.mindroomReplyDetails.total'), number(info.totalTokens)],
        ]}
      />
      <ContextWindow info={info} />
      <RowSection
        title={t('mindroomUi.messages.mindroomReplyDetails.activity')}
        rows={[
          [t('mindroomUi.messages.mindroomReplyDetails.toolCalls'), number(info.toolCount)],
          [
            t('mindroomUi.messages.mindroomReplyDetails.timeToFirstToken'),
            formatMindroomAiRunTimeToFirstToken(info.timeToFirstToken),
          ],
        ]}
      />
      {(info.modelConfig || info.runId || info.sessionId) && (
        <details>
          <Text as="summary" size="T200" priority="300" className={css.TechnicalSummary}>
            {t('mindroomUi.messages.mindroomReplyDetails.technicalDetails')}
          </Text>
          <Rows
            className={css.TechnicalRows}
            valueClassName={css.Identifier}
            size="T200"
            rows={[
              [t('mindroomUi.messages.mindroomReplyDetails.configuredModel'), info.modelConfig],
              [t('mindroomUi.messages.mindroomReplyDetails.runId'), info.runId],
              [t('mindroomUi.messages.mindroomReplyDetails.sessionId'), info.sessionId],
            ]}
          />
        </details>
      )}
    </div>
  );
}
