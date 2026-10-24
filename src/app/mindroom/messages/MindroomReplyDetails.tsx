import React, { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Text } from 'folds';
import { useAppLanguageCode } from '../../hooks/useAppLanguageCode';
import { ProviderModelIcon } from '../models/ProviderModelIcon';
import type { ThreadConversationCost } from '../threads/threadConversationCost';
import { useThreadConversationCost } from '../threads/useThreadConversationCost';
import { MindroomAiRunInfo } from './aiRun';
import {
  formatMindroomAiRunNumber,
  formatMindroomAiRunTimeToFirstToken,
  formatMindroomCostUsd,
  getMindroomAiRunCompactModelLabel,
  getMindroomAiRunContextBarSegments,
  getMindroomAiRunContextLabel,
  getMindroomAiRunTokenParts,
} from './aiRunDisplay';
import * as css from './MindroomReplyDetails.css';

// Enough bars to read a long thread's shape without each one shrinking to a hairline.
const MAX_HISTORY_BARS = 40;

function Section({
  title,
  value,
  children,
}: {
  title: string;
  value?: string;
  children: ReactNode;
}) {
  return (
    <section className={css.Section}>
      <div className={css.SectionHeader}>
        <Text as="h3" size="L400" priority="300">
          {title}
        </Text>
        {value && (
          <Text size="T300" className={css.HeaderValue}>
            {value}
          </Text>
        )}
      </div>
      {children}
    </section>
  );
}

/** Each priced reply's cost as a bar, this reply highlighted, in a window around it for long threads. */
function CostHistory({ threadCost, index }: { threadCost: ThreadConversationCost; index: number }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const { replies, complete } = threadCost;
  const start = Math.max(
    0,
    Math.min(index - MAX_HISTORY_BARS / 2, replies.length - MAX_HISTORY_BARS)
  );
  const shown = replies.slice(start, start + MAX_HISTORY_BARS);
  const highest = Math.max(...shown.map(({ usd }) => usd));
  return (
    <div>
      {/* A list, so each reply's cost can be read without the hover titles. */}
      <ol
        className={css.Bars}
        aria-label={t('mindroomUi.messages.mindroomReplyDetails.costHistory')}
      >
        {shown.map(({ eventId, usd }, offset) => {
          const position = start + offset;
          const place = position < index ? 'earlier' : position === index ? 'current' : 'later';
          const cost = formatMindroomCostUsd(usd, language);
          const label = complete
            ? t('mindroomUi.messages.mindroomReplyDetails.costHistoryBar', {
                index: position + 1,
                cost,
              })
            : cost;
          return (
            <li
              key={eventId}
              data-position={place}
              aria-current={place === 'current' ? 'true' : undefined}
              className={css.Bar[place]}
              style={{ height: `${Math.max(8, highest > 0 ? (usd / highest) * 100 : 0)}%` }}
              title={label}
            >
              <span className={css.HiddenLabel}>{label}</span>
            </li>
          );
        })}
      </ol>
      {complete ? (
        <div className={css.Axis.numbered}>
          <span>
            {t('mindroomUi.messages.mindroomReplyDetails.replyNumber', { index: start + 1 })}
          </span>
          <span>
            {t('mindroomUi.messages.mindroomReplyDetails.costHistoryPosition', {
              index: index + 1,
              count: replies.length,
            })}
          </span>
          <span>
            {t('mindroomUi.messages.mindroomReplyDetails.replyNumber', {
              index: start + shown.length,
            })}
          </span>
        </div>
      ) : (
        <div className={css.Axis.unnumbered}>
          <span>{t('mindroomUi.messages.mindroomReplyDetails.thisReply')}</span>
        </div>
      )}
    </div>
  );
}

function CostCard({ costUsd, eventId }: { costUsd: number; eventId?: string }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const threadCost = useThreadConversationCost();
  const throughReply = eventId ? threadCost?.byEventId.get(eventId) : undefined;
  const index =
    threadCost && eventId ? threadCost.replies.findIndex((reply) => reply.eventId === eventId) : -1;
  const conversationCost = throughReply && formatMindroomCostUsd(throughReply.usd, language);
  return (
    <section
      className={css.CostCard}
      aria-label={t('mindroomUi.messages.mindroomReplyDetails.cost')}
    >
      <div className={throughReply ? css.CostFigures.two : css.CostFigures.one}>
        <div className={css.CostFigure}>
          <span className={css.CostLabel}>
            {t('mindroomUi.messages.mindroomReplyDetails.thisReply')}
          </span>
          <span className={css.CostValue}>{formatMindroomCostUsd(costUsd, language)}</span>
        </div>
        {threadCost && throughReply && (
          <div className={css.CostFigure}>
            <span className={css.CostLabel}>
              {t('mindroomUi.messages.mindroomReplyDetails.conversationSoFar')}
            </span>
            <span className={css.CostValue}>
              {threadCost.complete
                ? conversationCost
                : t('mindroomUi.messages.mindroomReplyDetails.atLeastCost', {
                    cost: conversationCost,
                  })}
            </span>
            <span className={css.CostNote}>
              {threadCost.complete
                ? t('mindroomUi.messages.mindroomReplyDetails.replyCount', {
                    count: throughReply.replyCount,
                  })
                : t('mindroomUi.messages.mindroomReplyDetails.loadedReplyCount', {
                    count: throughReply.replyCount,
                  })}
            </span>
          </div>
        )}
      </div>
      {threadCost && index >= 0 && threadCost.replies.length > 1 && (
        <CostHistory threadCost={threadCost} index={index} />
      )}
    </section>
  );
}

function Tokens({ info }: { info: MindroomAiRunInfo }) {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const tokens = getMindroomAiRunTokenParts(info, t);
  if (!tokens) return null;
  return (
    <Section
      title={t('mindroomUi.messages.mindroomReplyDetails.tokens')}
      value={formatMindroomAiRunNumber(tokens.total, language)}
    >
      <div className={css.Meter} aria-hidden>
        {tokens.parts.map((part) => (
          <span
            key={part.key}
            className={css.Segment[part.key]}
            style={{ width: `${part.percentage}%` }}
          />
        ))}
      </div>
      <ul className={css.Legend}>
        {tokens.parts.map((part) => (
          <Text as="li" key={part.key} size="T200" className={css.LegendItem}>
            <span className={css.Swatch[part.key]} aria-hidden />
            <Text as="span" size="T200" priority="300">
              {part.label}
            </Text>{' '}
            {formatMindroomAiRunNumber(part.tokens, language)}
          </Text>
        ))}
      </ul>
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
    <Section title={t('mindroomUi.messages.mindroomReplyDetails.contextWindow')} value={usage}>
      {segments && (
        // The bar's track is the unused part of the window; the heading gives the numbers.
        <div className={css.Meter} aria-hidden>
          {segments.map((segment) => (
            <span
              key={segment.key}
              className={css.Segment[segment.key]}
              style={{ width: `${segment.percentage}%` }}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function Activity({ info }: { info: MindroomAiRunInfo }) {
  const { t } = useTranslation();
  const firstToken = formatMindroomAiRunTimeToFirstToken(info.timeToFirstToken);
  if (info.toolCount === undefined && !firstToken) return null;
  return (
    <Text as="div" size="T200" priority="300" className={css.Meta}>
      {info.toolCount !== undefined && (
        <span>
          {t('mindroomUi.messages.mindroomReplyDetails.toolCallCount', { count: info.toolCount })}
        </span>
      )}
      {firstToken && (
        <span>
          {t('mindroomUi.messages.mindroomReplyDetails.timeToFirstToken')}{' '}
          <span className={css.MetaValue}>{firstToken}</span>
        </span>
      )}
    </Text>
  );
}

const STATUS_LABEL_KEYS = {
  error: 'mindroomUi.messages.mindroomReplyDetails.failed',
  cancelled: 'mindroomUi.messages.mindroomReplyDetails.stopped',
} as const;

const isFlaggedStatus = (status: string | undefined): status is keyof typeof STATUS_LABEL_KEYS =>
  status === 'error' || status === 'cancelled';

/** What a MindRoom reply ran on, what it and the conversation cost, and what it used. */
export function MindroomReplyDetails({
  info,
  eventId,
}: {
  info: MindroomAiRunInfo;
  eventId?: string;
}) {
  const { t } = useTranslation();
  const modelLabel = getMindroomAiRunCompactModelLabel(info);
  const modelSource = [info.modelProvider, info.modelId].filter(Boolean).join(' · ');
  const status = info.status?.toLowerCase();

  return (
    <div className={css.Body}>
      {(modelLabel || isFlaggedStatus(status)) && (
        <div className={css.Lead}>
          {modelLabel && (
            <span className={css.Tile}>
              <ProviderModelIcon provider={info.modelProvider} id={info.modelId} size={20} />
            </span>
          )}
          <div className={css.ModelName}>
            {modelLabel && (
              <Text size="T400" truncate>
                <b>{modelLabel}</b>
              </Text>
            )}
            {modelSource && (
              <Text size="T200" priority="300" className={css.ModelSource}>
                {modelSource}
              </Text>
            )}
          </div>
          {isFlaggedStatus(status) && (
            <span className={css.Status[status]}>{t(STATUS_LABEL_KEYS[status])}</span>
          )}
        </div>
      )}
      {info.costUsd !== undefined && <CostCard costUsd={info.costUsd} eventId={eventId} />}
      <Tokens info={info} />
      <ContextWindow info={info} />
      <Activity info={info} />
      {(info.modelConfig || info.runId || info.sessionId) && (
        <details>
          <Text as="summary" size="T200" priority="300" className={css.TechnicalSummary}>
            {t('mindroomUi.messages.mindroomReplyDetails.technicalDetails')}
          </Text>
          <dl className={css.TechnicalRows}>
            {(
              [
                [t('mindroomUi.messages.mindroomReplyDetails.configuredModel'), info.modelConfig],
                [t('mindroomUi.messages.mindroomReplyDetails.runId'), info.runId],
                [t('mindroomUi.messages.mindroomReplyDetails.sessionId'), info.sessionId],
              ] as const
            ).map(([label, value]) =>
              value === undefined ? null : (
                <React.Fragment key={label}>
                  <Text as="dt" size="T200" priority="300">
                    {label}
                  </Text>
                  <Text as="dd" size="T200" className={css.Identifier}>
                    {value}
                  </Text>
                </React.Fragment>
              )
            )}
          </dl>
        </details>
      )}
    </div>
  );
}
