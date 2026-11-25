import { useMemo, useState } from 'react';
import { Text } from 'folds';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { dateTimeFormat } from '../lib/time';
import { ProviderModelIcon } from '../ui/ProviderModelIcon';
import type { DailyAccountUsage, ProviderAccountUsage, ProviderUsageSnapshot, TokenMix } from './providerUsageProtocol';
import { accountDisplayTitle, formatWholePercent, providerAccentColor } from './QuotaBar';
import * as css from './UsagePage.css';

const UNATTRIBUTED_COLOR = '#94a3b8';
const MIX_COLORS = ['#22c58b', '#f0a53a', '#7c6af7', '#ec4899'] as const;
const AGENT_PALETTE = ['#7c6af7', '#d97757', '#10a37f', '#3b82f6', '#f59e0b', '#ec4899', '#14b8a6'];

type ChartMetric = 'cost' | 'tokens';
type BreakdownTab = 'models' | 'agents' | 'accounts';

export const formatCompactTokens = (tokens: number, language: string): string =>
  new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens);

export const formatUsd = (amount: number, language: string): string =>
  new Intl.NumberFormat(language, { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);

export const formatShortUsd = (amount: number, language: string): string =>
  new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
    ...(amount >= 1000
      ? { notation: 'compact' as const, maximumFractionDigits: 1 }
      : { maximumFractionDigits: amount === 0 || amount >= 10 ? 0 : 1 }),
  }).format(amount);

const formatExactInt = (value: number, language: string): string =>
  new Intl.NumberFormat(language).format(Math.round(value));

const formatShare = (value: number, total: number, language: string): string => {
  const pct = total > 0 ? (value / total) * 100 : 0;
  if (pct <= 0) return formatWholePercent(0, language);
  return pct < 1 ? `<${formatWholePercent(1, language)}` : formatWholePercent(pct, language);
};

const formatDay = (isoDay: string, language: string, withWeekday = false): string => {
  const parsed = Date.parse(`${isoDay}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return isoDay;
  return dateTimeFormat(language, { ...(withWeekday ? { weekday: 'short' } : {}), month: 'short', day: 'numeric', timeZone: 'UTC' }).format(parsed);
};

const sum = (values: Iterable<number>): number => {
  let total = 0;
  for (const v of values) total += v;
  return total;
};

const accountDayVal = (day: DailyAccountUsage, id: string, isCost: boolean): number =>
  isCost ? (day.cost_by_account?.[id] ?? 0) : (day.by_account[id] ?? 0);

const unattrDayVal = (day: DailyAccountUsage, isCost: boolean): number =>
  isCost ? (day.unattributed_cost_usd ?? 0) : day.unattributed_tokens;

const dayTotalTokens = (day: DailyAccountUsage): number =>
  sum(Object.values(day.by_account)) + day.unattributed_tokens;

const dayTotalCost = (day: DailyAccountUsage): number | null =>
  day.cost_by_account === undefined && (day.unattributed_cost_usd ?? null) === null
    ? null
    : sum(Object.values(day.cost_by_account ?? {})) + (day.unattributed_cost_usd ?? 0);

const snapshotTotals = (snapshot: ProviderUsageSnapshot) => {
  const totalTokens = sum(snapshot.accounts.map((a) => a.tokens_7d)) + snapshot.unattributed_tokens_7d;
  const knownCosts = [...snapshot.accounts.map((a) => a.cost_usd_7d), snapshot.unattributed_cost_usd_7d].filter(
    (c): c is number => c !== null
  );
  return { totalTokens, totalCost: knownCosts.length > 0 ? sum(knownCosts) : null };
};

const tokenMixTotal = (mix: TokenMix | undefined): number =>
  mix ? mix.cache_read_tokens + mix.cache_write_tokens + mix.input_tokens + mix.output_tokens : 0;

const accountSub = (account: ProviderAccountUsage, title: string): string | undefined => {
  const raw = account.plan || account.account_label || undefined;
  return raw && !title.endsWith(`· ${raw.trim()}`) ? raw : undefined;
};

export function ModelChips({ keys, max = 6 }: { keys: readonly string[]; max?: number }) {
  if (keys.length === 0) return null;
  const hidden = keys.slice(max);
  return (
    <div className={css.ChipRow}>
      {keys.slice(0, max).map((key) => (
        <span key={key} className={css.ModelChip}>{key}</span>
      ))}
      {hidden.length > 0 && (
        <span className={css.ModelChip} title={hidden.join(', ')}>+{hidden.length}</span>
      )}
    </div>
  );
}

function TokenMixBar({ mix, compact = false, language }: { mix: TokenMix; compact?: boolean; language: string }) {
  const { t } = useTranslation();
  const total = tokenMixTotal(mix);
  if (total <= 0) return null;
  const parts = [
    { key: 'cr', tokens: mix.cache_read_tokens, color: MIX_COLORS[0], label: t('mindroomUi.usage.cacheRead') },
    { key: 'cw', tokens: mix.cache_write_tokens, color: MIX_COLORS[1], label: t('mindroomUi.usage.cacheWrite') },
    { key: 'in', tokens: mix.input_tokens, color: MIX_COLORS[2], label: t(compact ? 'mindroomUi.usage.inputShort' : 'mindroomUi.usage.inputTokens') },
    { key: 'out', tokens: mix.output_tokens, color: MIX_COLORS[3], label: t(compact ? 'mindroomUi.usage.outputShort' : 'mindroomUi.usage.outputTokens') },
  ].map((p) => ({ ...p, pct: (p.tokens / total) * 100 }));

  const ariaLabel = t('mindroomUi.usage.tokenMixAria', {
    cacheRead: formatWholePercent(parts[0]!.pct, language),
    cacheWrite: formatWholePercent(parts[1]!.pct, language),
    input: formatWholePercent(parts[2]!.pct, language),
    output: formatWholePercent(parts[3]!.pct, language),
  });

  return (
    <>
      <div className={css.MixBar} data-compact={compact || undefined} role="img" aria-label={ariaLabel}>
        {parts.map((p) =>
          p.tokens > 0 ? <span key={p.key} className={css.MixSegment} style={{ inlineSize: `${p.pct}%`, backgroundColor: p.color }} /> : null
        )}
      </div>
      <div className={css.MixLegend}>
        {parts.map((p) => (
          <span key={p.key} className={css.RowInline}>
            <span className={css.ColorDot} style={{ backgroundColor: p.color }} aria-hidden="true" />
            <span className={css.MutedText}>{p.label}</span>
            <strong>{formatWholePercent(p.pct, language)}</strong>
          </span>
        ))}
      </div>
    </>
  );
}

function Sparkline({ values, stroke }: { values: readonly number[]; stroke: string }) {
  if (values.length < 2 || !values.some((v) => v > 0)) return null;
  const max = Math.max(1, ...values);
  const points = values.map((v, i) => `${((i / (values.length - 1)) * 64 + 2).toFixed(1)},${(18 - (v / max) * 16).toFixed(1)}`).join(' ');
  return (
    <svg width={68} height={20} viewBox="0 0 68 20" aria-hidden="true" data-sparkline="">
      <polyline fill="none" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" points={points} />
    </svg>
  );
}

export function UsageOverviewSection({ snapshot, language }: { snapshot: ProviderUsageSnapshot; language: string }) {
  const { t } = useTranslation();
  const { totalTokens, totalCost } = snapshotTotals(snapshot);
  const costDays = snapshot.daily_7d.map(dayTotalCost).filter((c): c is number => c !== null);
  const prior3 = costDays.length >= 6 ? sum(costDays.slice(-6, -3)) : 0;
  const spendTrendPct = prior3 > 0 ? Math.round(((sum(costDays.slice(-3)) - prior3) / prior3) * 100) : undefined;

  let peakDay: { day: string; tokens: number } | undefined;
  for (const day of snapshot.daily_7d) {
    const tokens = dayTotalTokens(day);
    if (tokens > (peakDay?.tokens ?? 0)) peakDay = { day: day.day, tokens };
  }
  const cacheSavings = snapshot.cache_savings_usd_7d;

  return (
    <>
      <div className={css.KpiGrid} data-testid="usage-kpi-row" data-single={totalCost === null || undefined}>
        {totalCost !== null && (
          <div className={css.KpiCard}>
            <div className={css.RowBetween}>
              <span className={css.MutedText}>{t('mindroomUi.usage.kpiSpend7d')}</span>
              {spendTrendPct !== undefined && (
                <span
                  className={css.PillBadge}
                  data-testid="spend-trend-badge"
                  data-tone={spendTrendPct > 0 ? 'warn' : spendTrendPct < 0 ? 'ok' : undefined}
                  title={t('mindroomUi.usage.trendVsPrior3d', { delta: `${spendTrendPct >= 0 ? '+' : ''}${spendTrendPct}%` })}
                >
                  {`${spendTrendPct >= 0 ? '+' : ''}${spendTrendPct}%`}
                </span>
              )}
            </div>
            <span className={css.KpiValue} data-testid="total-cost-7d">{formatUsd(totalCost, language)}</span>
            <span className={css.MutedText}>
              {t('mindroomUi.usage.perDayAvg', { value: formatShortUsd(totalCost / 7, language) })}
            </span>
          </div>
        )}
        <div className={css.KpiCard}>
          <span className={css.MutedText}>{t('mindroomUi.usage.kpiTokens7d')}</span>
          <span className={css.KpiValue} data-testid="total-tokens-7d">{formatCompactTokens(totalTokens, language)}</span>
          {peakDay ? (
            <span className={css.MutedText}>
              {t('mindroomUi.usage.peakAndAvg', {
                day: formatDay(peakDay.day, language),
                tokens: formatCompactTokens(peakDay.tokens, language),
                avg: formatCompactTokens(totalTokens / 7, language),
              })}
            </span>
          ) : (
            totalTokens > 0 && (
              <span className={css.MutedText}>
                {t('mindroomUi.usage.perDayAvg', { value: formatCompactTokens(totalTokens / 7, language) })}
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
                {t('mindroomUi.usage.savedViaCache', { cost: formatShortUsd(cacheSavings, language) })}
              </span>
            )}
          </div>
          <TokenMixBar mix={snapshot.token_mix_7d} language={language} />
        </section>
      )}
    </>
  );
}

const findDominantAccount = (snapshot: ProviderUsageSnapshot, isCost: boolean): ProviderAccountUsage | undefined => {
  const totals = snapshot.accounts
    .map((account) => ({ account, total: sum(snapshot.daily_7d.map((day) => accountDayVal(day, account.id, isCost))) }))
    .filter((e) => e.total > 0)
    .sort((a, b) => b.total - a.total);
  const grand = sum(totals.map((e) => e.total)) + sum(snapshot.daily_7d.map((day) => unattrDayVal(day, isCost)));
  const top = totals[0];
  return totals.length >= 2 && top && grand > 0 && top.total / grand >= 0.7 ? top.account : undefined;
};

export function UsageDailySection({
  snapshot,
  colors,
  language,
}: {
  snapshot: ProviderUsageSnapshot;
  colors: ReadonlyMap<string, string>;
  language: string;
}) {
  const { t } = useTranslation();
  const hasDailyCost = snapshot.daily_7d.some((day) => dayTotalCost(day) !== null);
  const [metricPref, setMetricPref] = useState<ChartMetric>('cost');
  const [hideDominant, setHideDominant] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const isCost = hasDailyCost && metricPref === 'cost';

  const dominant = useMemo(() => findDominantAccount(snapshot, isCost), [snapshot, isCost]);
  const hidingDominant = hideDominant && Boolean(dominant);
  const visibleAccounts = hidingDominant ? snapshot.accounts.filter((a) => a.id !== dominant?.id) : snapshot.accounts;

  const dayTotals = snapshot.daily_7d.map(
    (day) => sum(visibleAccounts.map((a) => accountDayVal(day, a.id, isCost))) + unattrDayVal(day, isCost)
  );
  const maxVal = Math.max(0, ...dayTotals);
  const avgVal = dayTotals.length > 0 ? sum(dayTotals) / dayTotals.length : 0;

  const defaultDay = (() => {
    for (let i = snapshot.daily_7d.length - 1; i >= 0; i -= 1) {
      if ((dayTotals[i] ?? 0) > 0) return snapshot.daily_7d[i]?.day ?? null;
    }
    return snapshot.daily_7d[snapshot.daily_7d.length - 1]?.day ?? null;
  })();
  const activeDayIso = selectedDay && snapshot.daily_7d.some((d) => d.day === selectedDay) ? selectedDay : defaultDay;
  const selIndex = snapshot.daily_7d.findIndex((d) => d.day === activeDayIso);
  const selDay = selIndex >= 0 ? snapshot.daily_7d[selIndex] : undefined;
  const vsAvgPct = avgVal > 0 && selIndex >= 0 ? Math.round((((dayTotals[selIndex] ?? 0) - avgVal) / avgVal) * 100) : undefined;
  const selTokens = selDay ? sum(visibleAccounts.map((a) => selDay.by_account[a.id] ?? 0)) + selDay.unattributed_tokens : 0;
  const selCost = selDay && hasDailyCost ? sum(visibleAccounts.map((a) => selDay.cost_by_account?.[a.id] ?? 0)) + (selDay.unattributed_cost_usd ?? 0) : null;

  const dayRows = selDay
    ? [
        ...visibleAccounts.flatMap((account) => {
          const tokens = selDay.by_account[account.id] ?? 0;
          const cost = selDay.cost_by_account && account.id in selDay.cost_by_account ? (selDay.cost_by_account[account.id] ?? 0) : null;
          return tokens > 0 || (cost !== null && cost > 0)
            ? [{ id: account.id, name: accountDisplayTitle(account, snapshot.accounts), color: colors.get(account.id) ?? providerAccentColor(account.provider), tokens, cost, isUnattributed: false }]
            : [];
        }),
        ...(selDay.unattributed_tokens > 0 || (selDay.unattributed_cost_usd ?? 0) > 0
          ? [{ id: '__unattributed__', name: t('mindroomUi.usage.unattributed'), color: UNATTRIBUTED_COLOR, tokens: selDay.unattributed_tokens, cost: selDay.unattributed_cost_usd ?? null, isUnattributed: true }]
          : []),
      ].sort((a, b) => (isCost ? (b.cost ?? -1) - (a.cost ?? -1) || b.tokens - a.tokens : b.tokens - a.tokens || (b.cost ?? -1) - (a.cost ?? -1)))
    : [];

  const formatAxis = (val: number) => (isCost ? formatShortUsd(val, language) : formatCompactTokens(val, language));
  const dominantName = dominant ? accountDisplayTitle(dominant, snapshot.accounts) : '';

  return (
    <section className={css.SectionCard} data-testid="daily-activity-card">
      <div className={css.RowBetween}>
        <div>
          <h2 className={css.SectionHeading}>{t(isCost ? 'mindroomUi.usage.dailySpendTitle' : 'mindroomUi.usage.dailyTokensTitle')}</h2>
          <span className={css.MutedText}>{t(hasDailyCost ? 'mindroomUi.usage.dailySubtitleCost' : 'mindroomUi.usage.dailySubtitleTokens')}</span>
        </div>
        {(hasDailyCost || dominant) && (
          <div className={css.RowWrap}>
            {hasDailyCost && (
              <div className={css.Segmented} role="group" aria-label={t('mindroomUi.usage.chartMetricLabel')}>
                {(['cost', 'tokens'] as const).map((mode) => {
                  const label = t(mode === 'cost' ? 'mindroomUi.usage.metricSpend' : 'mindroomUi.usage.metricTokens');
                  return (
                    <button key={mode} type="button" className={css.SegmentTab} aria-pressed={isCost === (mode === 'cost')} title={label} onClick={() => setMetricPref(mode)}>
                      {label}
                    </button>
                  );
                })}
              </div>
            )}
            {dominant && (
              <button
                type="button"
                className={css.ActionButton}
                data-testid="hide-dominant-btn"
                aria-pressed={hidingDominant}
                title={t(hidingDominant ? 'mindroomUi.usage.resetFilterTooltip' : 'mindroomUi.usage.hideDominantTooltip', { account: dominantName })}
                onClick={() => setHideDominant((prev) => !prev)}
              >
                {t(hidingDominant ? 'mindroomUi.usage.resetFilter' : 'mindroomUi.usage.hideDominant')}
              </button>
            )}
          </div>
        )}
      </div>

      {snapshot.daily_7d.length === 0 ? (
        <Text size="T200" priority="300">{t('mindroomUi.usage.noDailyData')}</Text>
      ) : (
        <>
          <div className={css.ChartPlot} data-testid="daily-usage-chart">
            <div className={css.ChartYAxis} aria-hidden="true">
              <span>{formatAxis(maxVal)}</span>
              <span>{formatAxis(maxVal / 2)}</span>
              <span>0</span>
            </div>
            <div className={css.ChartBars}>
              {snapshot.daily_7d.map((day, index) => {
                const total = dayTotals[index] ?? 0;
                const selected = day.day === activeDayIso;
                const barTokens = sum(visibleAccounts.map((a) => day.by_account[a.id] ?? 0)) + day.unattributed_tokens;
                const barAria = isCost
                  ? t('mindroomUi.usage.dailyBarCostAria', { day: formatDay(day.day, language, true), cost: formatUsd(total, language), tokens: formatCompactTokens(barTokens, language) })
                  : t('mindroomUi.usage.dailyBarAria', { day: formatDay(day.day, language, true), tokens: formatCompactTokens(total, language) });
                const segs = [
                  ...visibleAccounts.map((a) => ({ key: a.id, val: accountDayVal(day, a.id, isCost), color: colors.get(a.id) })),
                  { key: '__unattr__', val: unattrDayVal(day, isCost), color: UNATTRIBUTED_COLOR },
                ];
                return (
                  <button key={day.day} type="button" className={css.ChartDayButton} data-day={day.day} aria-pressed={selected} aria-label={barAria} title={barAria} onClick={() => setSelectedDay(day.day)}>
                    <span className={css.ChartTopVal} data-selected={selected || undefined}>{formatAxis(total)}</span>
                    <div className={css.ChartBarTrack} data-selected={selected || undefined}>
                      {maxVal > 0 && segs.map((s) => (s.val > 0 ? <div key={s.key} className={css.ChartBarSegment} style={{ blockSize: `${Math.max(2, (s.val / maxVal) * 100)}%`, backgroundColor: s.color }} /> : null))}
                    </div>
                    <span className={css.ChartDayLabel} data-selected={selected || undefined}>{formatDay(day.day, language)}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {selDay && (
            <div className={css.DayDetail} data-testid="day-detail-drawer">
              <div className={css.RowBetween}>
                <div className={css.RowWrap}>
                  <strong>{formatDay(selDay.day, language, true)}</strong>
                  {vsAvgPct !== undefined && (
                    <span className={css.PillBadge} data-tone={vsAvgPct > 10 ? 'warn' : 'ok'}>
                      {t('mindroomUi.usage.vs7dAvg', { delta: `${vsAvgPct >= 0 ? '+' : ''}${vsAvgPct}` })}
                    </span>
                  )}
                </div>
                <div className={css.RowInline}>
                  {selCost !== null && (
                    <>
                      <span className={css.DayDetailCost}>{formatUsd(selCost, language)}</span>
                      <span className={css.MutedText} aria-hidden="true">·</span>
                    </>
                  )}
                  <strong title={formatExactInt(selTokens, language)}>
                    {t('mindroomUi.usage.tokensShortUnit', { tokens: formatCompactTokens(selTokens, language) })}
                  </strong>
                </div>
              </div>
              {dayRows.length === 0 ? (
                <span className={css.MutedText}>{t('mindroomUi.usage.noDayActivity')}</span>
              ) : (
                <table className={css.DayTable}>
                  <tbody>
                    {dayRows.map((row) => (
                      <tr key={row.id} data-day-account={row.isUnattributed ? undefined : row.id} data-testid={row.isUnattributed ? 'day-unattributed-row' : undefined}>
                        <td>
                          <span className={css.RowInline}>
                            <span className={css.ColorDot} style={{ backgroundColor: row.color }} aria-hidden="true" />
                            <span>{row.name}</span>
                          </span>
                        </td>
                        <td className={css.NumericCell} title={formatExactInt(row.tokens, language)}>
                          <span className={css.MutedText}>{formatCompactTokens(row.tokens, language)}</span>
                        </td>
                        {hasDailyCost && (
                          <td className={css.NumericCell}>
                            <strong>{row.cost === null ? '—' : formatUsd(row.cost, language)}</strong>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

type BreakdownItem = {
  id: string;
  title: string;
  mono: boolean;
  subtitle?: string;
  color: string;
  tokens: number;
  cost: number | null;
  costEstimated?: boolean;
  mix?: TokenMix;
  spark?: readonly number[];
  modelKeys?: readonly string[];
  testId?: string;
};

const sortBySpendThenTokens = <T extends { cost: number | null; tokens: number }>(a: T, b: T) =>
  (b.cost ?? -1) - (a.cost ?? -1) || b.tokens - a.tokens;

const buildBreakdown = (
  tab: BreakdownTab,
  snapshot: ProviderUsageSnapshot,
  colors: ReadonlyMap<string, string>,
  t: TFunction
): { items: BreakdownItem[]; idleAccounts: ProviderAccountUsage[] } => {
  if (tab === 'models' && snapshot.top_models_7d) {
    const accountsById = new Map(snapshot.accounts.map((a) => [a.id, a]));
    return {
      idleAccounts: [],
      items: snapshot.top_models_7d
        .map<BreakdownItem>((m, i) => {
          const acc = m.account_id ? accountsById.get(m.account_id) : undefined;
          const origin = acc ? accountDisplayTitle(acc, snapshot.accounts) : m.provider;
          const runs = m.run_count > 0 ? t('mindroomUi.usage.runCount', { count: m.run_count }) : undefined;
          return {
            id: `m:${i}:${m.provider}:${m.model}:${m.account_id ?? ''}`,
            title: m.model,
            mono: true,
            subtitle: runs ? `${origin} · ${runs}` : origin,
            color: (acc ? colors.get(acc.id) : undefined) ?? providerAccentColor(m.provider),
            tokens: m.tokens_7d,
            cost: m.cost_usd_7d,
            mix: m.token_mix_7d,
            spark: m.daily_tokens_7d,
          };
        })
        .sort(sortBySpendThenTokens),
    };
  }
  if (tab === 'agents' && snapshot.top_agents_7d) {
    return {
      idleAccounts: [],
      items: snapshot.top_agents_7d
        .map<BreakdownItem>((g, i) => ({
          id: `g:${i}:${g.entity}`,
          title: g.entity,
          mono: false,
          subtitle: t('mindroomUi.usage.runCount', { count: g.run_count }),
          color: AGENT_PALETTE[i % AGENT_PALETTE.length] ?? providerAccentColor(),
          tokens: g.tokens_7d,
          cost: g.cost_usd_7d,
          mix: g.token_mix_7d,
          spark: g.daily_tokens_7d,
        }))
        .sort(sortBySpendThenTokens),
    };
  }
  const active: BreakdownItem[] = [];
  const idle: ProviderAccountUsage[] = [];
  for (const account of snapshot.accounts) {
    if (account.tokens_7d === 0 && (account.cost_usd_7d ?? 0) === 0) {
      idle.push(account);
      continue;
    }
    const title = accountDisplayTitle(account, snapshot.accounts);
    active.push({
      id: `a:${account.id}`,
      title,
      mono: false,
      subtitle: accountSub(account, title),
      color: colors.get(account.id) ?? providerAccentColor(account.provider),
      tokens: account.tokens_7d,
      cost: account.cost_usd_7d,
      costEstimated: account.cost_estimated,
      mix: account.token_mix_7d,
      spark: snapshot.daily_7d.length >= 2 ? snapshot.daily_7d.map((d) => d.by_account[account.id] ?? 0) : undefined,
      modelKeys: account.model_keys,
    });
  }
  if (snapshot.unattributed_tokens_7d > 0 || (snapshot.unattributed_cost_usd_7d ?? 0) > 0) {
    active.push({
      id: 'a:__unattributed__',
      title: t('mindroomUi.usage.unattributed'),
      mono: false,
      color: UNATTRIBUTED_COLOR,
      tokens: snapshot.unattributed_tokens_7d,
      cost: snapshot.unattributed_cost_usd_7d,
      spark: snapshot.daily_7d.length >= 2 ? snapshot.daily_7d.map((d) => d.unattributed_tokens) : undefined,
      testId: 'unattributed-row',
    });
  }
  return { items: active.sort(sortBySpendThenTokens), idleAccounts: idle };
};

export function UsageBreakdownSection({
  snapshot,
  colors,
  language,
}: {
  snapshot: ProviderUsageSnapshot;
  colors: ReadonlyMap<string, string>;
  language: string;
}) {
  const { t } = useTranslation();
  const { totalTokens, totalCost } = snapshotTotals(snapshot);
  const hasModels = (snapshot.top_models_7d?.length ?? 0) > 0;
  const hasAgents = (snapshot.top_agents_7d?.length ?? 0) > 0;
  const availableTabs: BreakdownTab[] = [...(hasModels ? (['models'] as const) : []), ...(hasAgents ? (['agents'] as const) : []), 'accounts'];
  const [tabPref, setTabPref] = useState<BreakdownTab | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showIdle, setShowIdle] = useState(false);

  const activeTab: BreakdownTab = tabPref && availableTabs.includes(tabPref) ? tabPref : hasModels ? 'models' : 'accounts';
  const { items, idleAccounts } = useMemo(() => buildBreakdown(activeTab, snapshot, colors, t), [activeTab, snapshot, colors, t]);
  const tabLabel = (tab: BreakdownTab) =>
    t(tab === 'models' ? 'mindroomUi.usage.tabModels' : tab === 'agents' ? 'mindroomUi.usage.tabAgents' : 'mindroomUi.usage.tabAccounts');

  return (
    <section className={css.SectionCard} data-testid="where-usage-goes">
      <div className={css.RowBetween}>
        <div>
          <h2 className={css.SectionHeading}>{t('mindroomUi.usage.whereUsageGoes')}</h2>
          <span className={css.MutedText}>{t('mindroomUi.usage.whereUsageGoesSub')}</span>
        </div>
        <div className={css.Segmented} role="tablist" aria-label={t('mindroomUi.usage.whereUsageGoes')}>
          {availableTabs.map((tab) => {
            const label = tabLabel(tab);
            return (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={activeTab === tab}
                title={label}
                className={css.SegmentTab}
                onClick={() => {
                  setTabPref(tab);
                  setExpandedId(null);
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={css.RankList} role="tabpanel" aria-label={tabLabel(activeTab)}>
        {items.map((item) => {
          const open = expandedId === item.id;
          const useCostShare = totalCost !== null && totalCost > 0 && item.cost !== null;
          const pct = useCostShare ? (item.cost! / totalCost) * 100 : totalTokens > 0 ? (item.tokens / totalTokens) * 100 : 0;
          const costDisplay =
            item.cost === null
              ? null
              : item.costEstimated
                ? t('mindroomUi.usage.estimatedCost', { cost: formatUsd(item.cost, language) })
                : formatUsd(item.cost, language);

          return (
            <div key={item.id} className={css.RankCard} data-testid={item.testId}>
              <button type="button" className={css.RankButton} aria-expanded={open} data-breakdown-row={item.id} onClick={() => setExpandedId(open ? null : item.id)}>
                <div className={css.RankRow}>
                  <span className={css.RowInline}>
                    <span className={css.ColorDot} style={{ backgroundColor: item.color }} aria-hidden="true" />
                    <span className={css.RankTitleWrap}>
                      <span className={css.RankTitle} data-mono={item.mono || undefined}>{item.title}</span>
                      {item.subtitle && <span className={css.MutedText}>{` · ${item.subtitle}`}</span>}
                    </span>
                  </span>
                  <span className={css.RankMetrics}>
                    {costDisplay !== null ? (
                      <>
                        <strong>{costDisplay}</strong>
                        <span className={css.MutedText}>{` · ${formatCompactTokens(item.tokens, language)}`}</span>
                      </>
                    ) : (
                      <strong>{formatCompactTokens(item.tokens, language)}</strong>
                    )}
                  </span>
                </div>
                <div className={css.ShareTrack} aria-hidden="true">
                  <span className={css.ShareFill} style={{ inlineSize: `${pct > 0 ? Math.max(1.5, Math.min(100, pct)).toFixed(1) : '0'}%`, backgroundColor: item.color }} />
                </div>
              </button>

              {open && (
                <div className={css.RankDrawer} data-testid="breakdown-drawer">
                  <div className={css.RowBetween}>
                    <span className={css.MutedText}>
                      {useCostShare
                        ? t('mindroomUi.usage.shareOfSpend', { share: formatShare(item.cost!, totalCost, language) })
                        : t('mindroomUi.usage.shareOfTokens', { share: formatShare(item.tokens, totalTokens, language) })}
                    </span>
                    {item.spark && item.spark.length >= 2 && item.spark.some((v) => v > 0) && (
                      <span className={css.RowInline}>
                        <span className={css.MutedText}>{t('mindroomUi.usage.trend7d')}</span>
                        <Sparkline values={item.spark} stroke={item.color} />
                      </span>
                    )}
                  </div>
                  {item.mix && tokenMixTotal(item.mix) > 0 && <TokenMixBar mix={item.mix} compact language={language} />}
                  {item.modelKeys && item.modelKeys.length > 0 && <ModelChips keys={item.modelKeys} max={6} />}
                </div>
              )}
            </div>
          );
        })}

        {activeTab === 'accounts' && idleAccounts.length > 0 && (
          <>
            <button
              type="button"
              className={css.IdleToggle}
              data-testid="idle-accounts-toggle"
              aria-expanded={showIdle}
              title={t('mindroomUi.usage.idleAccountsLabel', { count: idleAccounts.length })}
              onClick={() => setShowIdle((prev) => !prev)}
            >
              <span>{t('mindroomUi.usage.idleAccountsLabel', { count: idleAccounts.length })}</span>
              <span>{t(showIdle ? 'mindroomUi.usage.hide' : 'mindroomUi.usage.show')}</span>
            </button>
            {showIdle &&
              idleAccounts.map((account) => {
                const title = accountDisplayTitle(account, snapshot.accounts);
                const sub = accountSub(account, title);
                return (
                  <div key={account.id} className={css.IdleRow} data-idle-account={account.id}>
                    <span className={css.RowInline}>
                      <ProviderModelIcon provider={account.provider} size={18} />
                      <span>{sub ? `${title} · ${sub}` : title}</span>
                    </span>
                    <span>{t('mindroomUi.usage.zeroTokens')}</span>
                  </div>
                );
              })}
          </>
        )}
      </div>
    </section>
  );
}
