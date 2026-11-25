import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProviderUsageSnapshot, TokenMix } from './providerUsageProtocol';
import { formatWholePercent } from './QuotaBar';
import {
  CALENDAR_DAYS,
  type CalendarDaySlot,
  computeSpendTrend3d,
  dayTotalTokens,
  formatCompactTokens,
  formatDay,
  formatShortUsd,
  formatSignedPercent,
  formatUsd,
  snapshotTotals,
  tokenMixTotal,
} from './usageCalendar';
import * as css from './UsagePage.css';

export { formatCompactTokens, formatShortUsd, formatUsd } from './usageCalendar';

const MIX_COLORS = ['#22c58b', '#f0a53a', '#7c6af7', '#ec4899'] as const;

export function ModelChips({ keys, max = 6 }: { keys: readonly string[]; max?: number }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  if (keys.length === 0) return null;
  const hidden = keys.slice(max);
  const shown = expanded ? keys : keys.slice(0, max);
  return (
    <div className={css.ChipRow}>
      {shown.map((key) => (
        <span key={key} className={css.ModelChip}>
          {key}
        </span>
      ))}
      {hidden.length > 0 && (
        <button
          type="button"
          className={css.ModelChipButton}
          data-model-chips-toggle=""
          aria-expanded={expanded}
          title={expanded ? t('mindroomUi.usage.hide') : hidden.join(', ')}
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? t('mindroomUi.usage.hide') : `+${hidden.length}`}
        </button>
      )}
    </div>
  );
}

export function TokenMixBar({
  mix,
  compact = false,
  language,
}: {
  mix: TokenMix;
  compact?: boolean;
  language: string;
}) {
  const { t } = useTranslation();
  const total = tokenMixTotal(mix);
  if (total <= 0) return null;

  const parts = [
    {
      key: 'cr',
      tokens: mix.cache_read_tokens,
      color: MIX_COLORS[0],
      label: t('mindroomUi.usage.cacheRead'),
    },
    {
      key: 'cw',
      tokens: mix.cache_write_tokens,
      color: MIX_COLORS[1],
      label: t('mindroomUi.usage.cacheWrite'),
    },
    {
      key: 'in',
      tokens: mix.input_tokens,
      color: MIX_COLORS[2],
      label: t(compact ? 'mindroomUi.usage.inputShort' : 'mindroomUi.usage.inputTokens'),
    },
    {
      key: 'out',
      tokens: mix.output_tokens,
      color: MIX_COLORS[3],
      label: t(compact ? 'mindroomUi.usage.outputShort' : 'mindroomUi.usage.outputTokens'),
    },
  ].map((p) => ({ ...p, pct: (p.tokens / total) * 100 }));

  const ariaLabel = t('mindroomUi.usage.tokenMixAria', {
    cacheRead: formatWholePercent(parts[0]!.pct, language),
    cacheWrite: formatWholePercent(parts[1]!.pct, language),
    input: formatWholePercent(parts[2]!.pct, language),
    output: formatWholePercent(parts[3]!.pct, language),
  });

  return (
    <>
      <div
        className={css.MixBar}
        data-compact={compact || undefined}
        role="img"
        aria-label={ariaLabel}
      >
        {parts.map((p) =>
          p.tokens > 0 ? (
            <span
              key={p.key}
              className={css.MixSegment}
              style={{ inlineSize: `${p.pct}%`, backgroundColor: p.color }}
            />
          ) : null
        )}
      </div>
      <div className={css.MixLegend}>
        {parts.map((p) => (
          <span key={p.key} className={css.RowInline}>
            <span
              className={css.ColorDot}
              style={{ backgroundColor: p.color }}
              aria-hidden="true"
            />
            <span className={css.MutedText}>{p.label}</span>
            <strong>{formatWholePercent(p.pct, language)}</strong>
          </span>
        ))}
      </div>
    </>
  );
}

export function Sparkline({
  values,
  stroke,
  ariaLabel,
}: {
  values: readonly number[];
  stroke: string;
  ariaLabel?: string;
}) {
  if (values.length < 2 || !values.some((v) => v > 0)) return null;
  const max = Math.max(1, ...values);
  const points = values
    .map(
      (v, i) =>
        `${((i / (values.length - 1)) * 64 + 2).toFixed(1)},${(18 - (v / max) * 16).toFixed(1)}`
    )
    .join(' ');
  return (
    <svg
      width={68}
      height={20}
      viewBox="0 0 68 20"
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel || undefined}
      aria-hidden={ariaLabel ? undefined : true}
      data-sparkline=""
    >
      <polyline
        fill="none"
        stroke={stroke}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={points}
      />
    </svg>
  );
}

export function UsageOverviewSection({
  snapshot,
  calendar,
  language,
}: {
  snapshot: ProviderUsageSnapshot;
  calendar: readonly CalendarDaySlot[];
  language: string;
}) {
  const { t } = useTranslation();
  const { totalTokens, totalCost } = snapshotTotals(snapshot);
  const trendRatio = computeSpendTrend3d(snapshot, calendar);
  const roundedTrendPct = trendRatio !== undefined ? Math.round(trendRatio * 100) : undefined;
  const trendLabel =
    trendRatio !== undefined ? formatSignedPercent(trendRatio, language) : undefined;

  let peakDay: { day: string; tokens: number } | undefined;
  for (const slot of calendar) {
    const tokens = dayTotalTokens(slot);
    if (tokens > (peakDay?.tokens ?? 0)) peakDay = { day: slot.day, tokens };
  }
  const cacheSavings = snapshot.cache_savings_usd_7d;

  return (
    <>
      <div
        className={css.KpiGrid}
        data-testid="usage-kpi-row"
        data-single={totalCost === null || undefined}
      >
        {totalCost !== null && (
          <div className={css.KpiCard}>
            <div className={css.RowBetween}>
              <span className={css.MutedText}>{t('mindroomUi.usage.kpiSpend7d')}</span>
              {trendLabel !== undefined && roundedTrendPct !== undefined && (
                <span
                  className={css.PillBadge}
                  data-testid="spend-trend-badge"
                  data-tone={roundedTrendPct > 0 ? 'warn' : roundedTrendPct < 0 ? 'ok' : undefined}
                  title={t('mindroomUi.usage.trendVsPrior3d', { delta: trendLabel })}
                >
                  {trendLabel}
                </span>
              )}
            </div>
            <span className={css.KpiValue} data-testid="total-cost-7d">
              {formatUsd(totalCost, language)}
            </span>
            <span className={css.MutedText}>
              {t('mindroomUi.usage.perDayAvg', {
                value: formatShortUsd(totalCost / CALENDAR_DAYS, language),
              })}
            </span>
          </div>
        )}

        <div className={css.KpiCard}>
          <span className={css.MutedText}>{t('mindroomUi.usage.kpiTokens7d')}</span>
          <span className={css.KpiValue} data-testid="total-tokens-7d">
            {formatCompactTokens(totalTokens, language)}
          </span>
          {peakDay ? (
            <span className={css.MutedText}>
              {t('mindroomUi.usage.peakAndAvg', {
                day: formatDay(peakDay.day, language, 'short'),
                tokens: formatCompactTokens(peakDay.tokens, language),
                avg: formatCompactTokens(totalTokens / CALENDAR_DAYS, language),
              })}
            </span>
          ) : (
            totalTokens > 0 && (
              <span className={css.MutedText}>
                {t('mindroomUi.usage.perDayAvg', {
                  value: formatCompactTokens(totalTokens / CALENDAR_DAYS, language),
                })}
              </span>
            )
          )}
        </div>
      </div>

      {tokenMixTotal(snapshot.token_mix_7d) > 0 && snapshot.token_mix_7d && (
        <section className={css.MixCard} data-testid="token-mix-card">
          <div className={css.RowBetween}>
            <h2 className={css.SectionHeading}>{t('mindroomUi.usage.tokenMixTitle')}</h2>
            {typeof cacheSavings === 'number' && cacheSavings > 0 && (
              <span className={css.PillBadge} data-tone="ok" data-testid="cache-savings-badge">
                {t('mindroomUi.usage.savedViaCache', {
                  cost: formatShortUsd(cacheSavings, language),
                })}
              </span>
            )}
          </div>
          <TokenMixBar mix={snapshot.token_mix_7d} language={language} />
        </section>
      )}
    </>
  );
}
