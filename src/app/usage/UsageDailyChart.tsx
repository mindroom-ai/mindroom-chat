import { useMemo, useState } from 'react';
import { Text } from 'folds';
import { useTranslation } from 'react-i18next';
import type { ProviderAccountUsage, ProviderUsageSnapshot } from './providerUsageProtocol';
import { accountDisplayTitle, providerAccentColor } from './QuotaBar';
import {
  CALENDAR_DAYS,
  type CalendarDaySlot,
  formatCompactTokens,
  formatDay,
  formatExactInt,
  formatShortUsd,
  formatSignedPercent,
  formatUsd,
  sum,
  visibleDayCost,
  visibleDayTokens,
} from './usageCalendar';
import * as css from './UsagePage.css';

const UNATTRIBUTED_COLOR = '#94a3b8';

type ChartMetric = 'cost' | 'tokens';

const accountDayVal = (slot: CalendarDaySlot, id: string, isCost: boolean): number =>
  isCost ? (slot.cost_by_account?.[id] ?? 0) : (slot.by_account[id] ?? 0);

const unattrDayVal = (slot: CalendarDaySlot, isCost: boolean): number =>
  isCost ? (slot.unattributed_cost_usd ?? 0) : slot.unattributed_tokens;

const findDominantAccount = (
  accounts: readonly ProviderAccountUsage[],
  calendar: readonly CalendarDaySlot[],
  isCost: boolean
): ProviderAccountUsage | undefined => {
  const totals = accounts
    .map((account) => ({
      account,
      total: sum(calendar.map((slot) => accountDayVal(slot, account.id, isCost))),
    }))
    .filter((entry) => entry.total > 0)
    .sort((a, b) => b.total - a.total);
  const grand =
    sum(totals.map((entry) => entry.total)) + sum(calendar.map((s) => unattrDayVal(s, isCost)));
  const top = totals[0];
  return totals.length >= 2 && top && grand > 0 && top.total / grand >= 0.7
    ? top.account
    : undefined;
};

export function UsageDailyChart({
  snapshot,
  calendar,
  colors,
  language,
  compact,
}: {
  snapshot: ProviderUsageSnapshot;
  calendar: readonly CalendarDaySlot[];
  colors: ReadonlyMap<string, string>;
  language: string;
  compact: boolean;
}) {
  const { t } = useTranslation();
  const hasDailyCost = useMemo(
    () => calendar.some((slot) => visibleDayCost(slot, snapshot.accounts) !== null),
    [calendar, snapshot.accounts]
  );

  const [metricPref, setMetricPref] = useState<ChartMetric>('cost');
  const [hideDominant, setHideDominant] = useState(false);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const isCost = hasDailyCost && metricPref === 'cost';

  const dominant = useMemo(
    () => findDominantAccount(snapshot.accounts, calendar, isCost),
    [snapshot.accounts, calendar, isCost]
  );
  const hidingDominant = hideDominant && Boolean(dominant);
  const visibleAccounts = hidingDominant
    ? snapshot.accounts.filter((a) => a.id !== dominant?.id)
    : snapshot.accounts;

  const dayValues: Array<number | null> = calendar.map((slot) =>
    isCost ? visibleDayCost(slot, visibleAccounts) : visibleDayTokens(slot, visibleAccounts)
  );
  const maxVal = Math.max(0, ...dayValues.map((v) => v ?? 0));
  const avg7d = sum(dayValues.map((v) => v ?? 0)) / CALENDAR_DAYS;

  const defaultDay = (() => {
    for (let i = calendar.length - 1; i >= 0; i -= 1) {
      if ((dayValues[i] ?? 0) > 0) return calendar[i]?.day ?? null;
    }
    for (let i = calendar.length - 1; i >= 0; i -= 1) {
      const slot = calendar[i];
      if (slot && visibleDayTokens(slot, visibleAccounts) > 0) return slot.day;
    }
    return calendar[calendar.length - 1]?.day ?? null;
  })();

  const activeDayIso =
    selectedDay && calendar.some((slot) => slot.day === selectedDay) ? selectedDay : defaultDay;
  const selIndex = calendar.findIndex((slot) => slot.day === activeDayIso);
  const selDay = selIndex >= 0 ? calendar[selIndex] : undefined;
  const selMetricVal = selIndex >= 0 ? (dayValues[selIndex] ?? null) : null;
  const vsAvgRatio =
    selMetricVal !== null && avg7d > 0 ? (selMetricVal - avg7d) / avg7d : undefined;
  const selTokens = selDay ? visibleDayTokens(selDay, visibleAccounts) : 0;
  const selCost = selDay && hasDailyCost ? visibleDayCost(selDay, visibleAccounts) : null;

  const dayRows = selDay
    ? [
        ...visibleAccounts.flatMap((account) => {
          const tokens = selDay.by_account[account.id] ?? 0;
          const cost =
            selDay.cost_by_account &&
            Object.prototype.hasOwnProperty.call(selDay.cost_by_account, account.id)
              ? (selDay.cost_by_account[account.id] ?? 0)
              : null;
          return tokens > 0 || (cost !== null && cost > 0)
            ? [
                {
                  id: account.id,
                  name: accountDisplayTitle(account, snapshot.accounts),
                  color: colors.get(account.id) ?? providerAccentColor(account.provider),
                  tokens,
                  cost,
                  isUnattributed: false,
                },
              ]
            : [];
        }),
        ...(selDay.unattributed_tokens > 0 || (selDay.unattributed_cost_usd ?? 0) > 0
          ? [
              {
                id: '__unattributed__',
                name: t('mindroomUi.usage.unattributed'),
                color: UNATTRIBUTED_COLOR,
                tokens: selDay.unattributed_tokens,
                cost:
                  selDay.unattributed_cost_usd !== undefined &&
                  selDay.unattributed_cost_usd !== null
                    ? selDay.unattributed_cost_usd
                    : null,
                isUnattributed: true,
              },
            ]
          : []),
      ].sort((a, b) =>
        isCost
          ? (b.cost ?? -1) - (a.cost ?? -1) || b.tokens - a.tokens
          : b.tokens - a.tokens || (b.cost ?? -1) - (a.cost ?? -1)
      )
    : [];

  const formatAxis = (val: number) =>
    isCost ? formatShortUsd(val, language) : formatCompactTokens(val, language);
  const dominantName = dominant ? accountDisplayTitle(dominant, snapshot.accounts) : '';
  const dominantTooltip = dominant
    ? t(
        hidingDominant
          ? 'mindroomUi.usage.resetFilterTooltip'
          : 'mindroomUi.usage.hideDominantTooltip',
        { account: dominantName }
      )
    : '';

  return (
    <section className={css.SectionCard} data-testid="daily-activity-card">
      <div className={css.RowBetween}>
        <div>
          <h2 className={css.SectionHeading}>
            {t(isCost ? 'mindroomUi.usage.dailySpendTitle' : 'mindroomUi.usage.dailyTokensTitle')}
          </h2>
          <span className={css.MutedText}>
            {t(
              hasDailyCost
                ? 'mindroomUi.usage.dailySubtitleCost'
                : 'mindroomUi.usage.dailySubtitleTokens'
            )}
          </span>
        </div>

        {(hasDailyCost || dominant) && (
          <div className={css.RowWrap}>
            {hasDailyCost && (
              <div
                className={css.Segmented}
                role="group"
                aria-label={t('mindroomUi.usage.chartMetricLabel')}
              >
                {(['cost', 'tokens'] as const).map((mode) => {
                  const label = t(
                    mode === 'cost'
                      ? 'mindroomUi.usage.metricSpend'
                      : 'mindroomUi.usage.metricTokens'
                  );
                  return (
                    <button
                      key={mode}
                      type="button"
                      className={css.SegmentTab}
                      aria-pressed={isCost === (mode === 'cost')}
                      title={label}
                      onClick={() => setMetricPref(mode)}
                    >
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
                aria-label={dominantTooltip}
                title={dominantTooltip}
                onClick={() => setHideDominant((prev) => !prev)}
              >
                {t(
                  hidingDominant ? 'mindroomUi.usage.resetFilter' : 'mindroomUi.usage.hideDominant'
                )}
              </button>
            )}
          </div>
        )}
      </div>

      {snapshot.daily_7d.length === 0 ? (
        <Text size="T200" priority="300">
          {t('mindroomUi.usage.noDailyData')}
        </Text>
      ) : (
        <>
          <div className={css.ChartPlot} data-testid="daily-usage-chart">
            <div className={css.ChartYAxis} aria-hidden="true">
              <span>{formatAxis(maxVal)}</span>
              <span>{formatAxis(maxVal / 2)}</span>
              <span>0</span>
            </div>
            <div className={css.ChartBars}>
              {calendar.map((slot, index) => {
                const val = dayValues[index] ?? null;
                const selected = slot.day === activeDayIso;
                const barTokens = visibleDayTokens(slot, visibleAccounts);
                const fullDayLabel = formatDay(slot.day, language, 'full');
                const topLabel = isCost
                  ? val === null
                    ? '—'
                    : formatShortUsd(val, language)
                  : formatCompactTokens(val ?? 0, language);
                const barAria =
                  isCost && val !== null
                    ? t('mindroomUi.usage.dailyBarCostAria', {
                        day: fullDayLabel,
                        cost: formatUsd(val, language),
                        tokens: formatCompactTokens(barTokens, language),
                      })
                    : t('mindroomUi.usage.dailyBarAria', {
                        day: fullDayLabel,
                        tokens: formatCompactTokens(barTokens, language),
                      });
                const segs = [
                  ...visibleAccounts.map((a) => ({
                    key: a.id,
                    val: accountDayVal(slot, a.id, isCost),
                    color: colors.get(a.id),
                  })),
                  { key: '__unattr__', val: unattrDayVal(slot, isCost), color: UNATTRIBUTED_COLOR },
                ];

                return (
                  <button
                    key={slot.day}
                    type="button"
                    className={css.ChartDayButton}
                    data-day={slot.day}
                    aria-pressed={selected}
                    aria-label={barAria}
                    title={barAria}
                    onClick={() => setSelectedDay(slot.day)}
                  >
                    <span className={css.ChartTopVal} data-selected={selected || undefined}>
                      {topLabel}
                    </span>
                    <div className={css.ChartBarTrack} data-selected={selected || undefined}>
                      {maxVal > 0 &&
                        val !== null &&
                        val > 0 &&
                        segs.map((s) =>
                          s.val > 0 ? (
                            <div
                              key={s.key}
                              className={css.ChartBarSegment}
                              style={{
                                blockSize: `${Math.max(2, (s.val / maxVal) * 100)}%`,
                                backgroundColor: s.color,
                              }}
                            />
                          ) : null
                        )}
                    </div>
                    <span className={css.ChartDayLabel} data-selected={selected || undefined}>
                      {formatDay(slot.day, language, compact ? 'dayOnly' : 'short')}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {selDay && (
            <div className={css.DayDetail} data-testid="day-detail-drawer">
              <div className={css.RowBetween}>
                <div className={css.RowWrap}>
                  <strong>{formatDay(selDay.day, language, 'full')}</strong>
                  {vsAvgRatio !== undefined && (
                    <span
                      className={css.PillBadge}
                      data-testid="day-vs-avg-badge"
                      data-tone={Math.round(vsAvgRatio * 100) > 10 ? 'warn' : 'ok'}
                    >
                      {t('mindroomUi.usage.vs7dAvg', {
                        delta: formatSignedPercent(vsAvgRatio, language),
                      })}
                    </span>
                  )}
                </div>
                <div className={css.RowInline}>
                  {hasDailyCost && (
                    <>
                      {selCost !== null ? (
                        <span className={css.DayDetailCost}>{formatUsd(selCost, language)}</span>
                      ) : (
                        <span className={css.MutedText} data-testid="day-detail-cost-unknown">
                          —
                        </span>
                      )}
                      <span className={css.MutedText} aria-hidden="true">
                        ·
                      </span>
                    </>
                  )}
                  <strong>
                    {t('mindroomUi.usage.tokensShortUnit', {
                      tokens: formatExactInt(selTokens, language),
                    })}
                  </strong>
                </div>
              </div>

              {dayRows.length === 0 ? (
                <span className={css.MutedText}>{t('mindroomUi.usage.noDayActivity')}</span>
              ) : (
                <table className={css.DayTable}>
                  <tbody>
                    {dayRows.map((row) => (
                      <tr
                        key={row.id}
                        data-day-account={row.isUnattributed ? undefined : row.id}
                        data-testid={row.isUnattributed ? 'day-unattributed-row' : undefined}
                      >
                        <td className={css.DayNameCell}>
                          <span className={css.RowInline}>
                            <span
                              className={css.ColorDot}
                              style={{ backgroundColor: row.color }}
                              aria-hidden="true"
                            />
                            <span>{row.name}</span>
                          </span>
                        </td>
                        <td className={css.NumericCell}>
                          <span className={css.MutedText}>
                            {formatExactInt(row.tokens, language)}
                          </span>
                        </td>
                        {hasDailyCost && (
                          <td className={css.NumericCell}>
                            <strong>
                              {row.cost === null ? '—' : formatUsd(row.cost, language)}
                            </strong>
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
