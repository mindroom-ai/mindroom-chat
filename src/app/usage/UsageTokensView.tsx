import { useMemo } from 'react';
import { Box, Text } from 'folds';
import { useTranslation } from 'react-i18next';
import { dateTimeFormat } from '../lib/time';
import type { ProviderUsageSnapshot } from './providerUsageProtocol';
import { accountChartColor, accountDisplayTitle, formatWholePercent } from './QuotaBar';
import * as css from './UsagePage.css';

const UNATTRIBUTED_COLOR = '#94a3b8';

export const formatCompactTokens = (tokens: number, language: string): string =>
  new Intl.NumberFormat(language, { notation: 'compact', maximumFractionDigits: 1 }).format(tokens);

export const formatUsd = (amount: number, language: string): string =>
  new Intl.NumberFormat(language, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

const formatDay = (isoDay: string, language: string): string => {
  const parsed = Date.parse(`${isoDay}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return isoDay;
  return dateTimeFormat(language, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(
    parsed
  );
};

export function UsageTokensView({
  snapshot,
  language,
}: {
  snapshot: ProviderUsageSnapshot;
  language: string;
}) {
  const { t } = useTranslation();
  const colors = useMemo(() => {
    const usedColors = new Set<string>();
    return new Map(
      snapshot.accounts.map((account, index) => [
        account.id,
        accountChartColor(account, index, usedColors),
      ])
    );
  }, [snapshot.accounts]);

  const totalTokens =
    snapshot.accounts.reduce((sum, account) => sum + account.tokens_7d, 0) +
    snapshot.unattributed_tokens_7d;
  const knownCosts = [
    ...snapshot.accounts.map((account) => account.cost_usd_7d),
    snapshot.unattributed_cost_usd_7d,
  ].filter((cost): cost is number => cost !== null);
  const totalCost = knownCosts.length > 0 ? knownCosts.reduce((sum, v) => sum + v, 0) : null;
  const dayTotals = snapshot.daily_7d.map(
    (day) => Object.values(day.by_account).reduce((sum, v) => sum + v, 0) + day.unattributed_tokens
  );
  const maxDayTotal = Math.max(1, ...dayTotals);
  const showUnattributed = snapshot.unattributed_tokens_7d > 0;
  const formatShare = (tokens: number): string =>
    formatWholePercent(totalTokens > 0 ? (tokens / totalTokens) * 100 : 0, language);

  return (
    <div data-testid="usage-tokens-view">
      <div className={css.SummaryRow}>
        <div className={css.MetricCard}>
          <span className={css.MutedText}>{t('mindroomUi.usage.totalTokens7d')}</span>
          <span className={css.MetricValue} data-testid="total-tokens-7d">
            {formatCompactTokens(totalTokens, language)}
          </span>
        </div>
        {totalCost !== null && (
          <div className={css.MetricCard}>
            <span className={css.MutedText}>{t('mindroomUi.usage.totalCost7d')}</span>
            <span className={css.MetricValue}>{formatUsd(totalCost, language)}</span>
          </div>
        )}
      </div>

      <section className={css.SectionCard}>
        <Text size="L400" as="h2">
          {t('mindroomUi.usage.dailyChartTitle')}
        </Text>
        {snapshot.daily_7d.length === 0 ? (
          <Text size="T200" priority="300">
            {t('mindroomUi.usage.noDailyData')}
          </Text>
        ) : (
          <>
            <div className={css.ChartBars} data-testid="daily-usage-chart">
              {snapshot.daily_7d.map((day, dayIndex) => {
                const dayTotal = dayTotals[dayIndex] ?? 0;
                const label = formatDay(day.day, language);
                return (
                  <div key={day.day} className={css.DayColumn}>
                    <div
                      className={css.BarTrack}
                      role="img"
                      aria-label={t('mindroomUi.usage.dailyBarAria', {
                        day: label,
                        tokens: formatCompactTokens(dayTotal, language),
                      })}
                    >
                      {snapshot.accounts.map((account) => {
                        const tokens = day.by_account[account.id] ?? 0;
                        if (tokens <= 0) return null;
                        return (
                          <div
                            key={account.id}
                            className={css.BarSegment}
                            style={{
                              blockSize: `${(tokens / maxDayTotal) * 100}%`,
                              backgroundColor: colors.get(account.id),
                            }}
                          />
                        );
                      })}
                      {day.unattributed_tokens > 0 && (
                        <div
                          className={css.BarSegment}
                          style={{
                            blockSize: `${(day.unattributed_tokens / maxDayTotal) * 100}%`,
                            backgroundColor: UNATTRIBUTED_COLOR,
                          }}
                        />
                      )}
                    </div>
                    <span className={css.DayLabel}>{label}</span>
                  </div>
                );
              })}
            </div>
            <div className={css.Legend}>
              {snapshot.accounts.map((account) => (
                <span key={account.id} className={css.LegendItem} data-legend-account={account.id}>
                  <span
                    className={css.ProviderDot}
                    style={{ backgroundColor: colors.get(account.id) }}
                    aria-hidden="true"
                  />
                  {accountDisplayTitle(account, snapshot.accounts)}
                </span>
              ))}
              {showUnattributed && (
                <span className={css.LegendItem}>
                  <span
                    className={css.ProviderDot}
                    style={{ backgroundColor: UNATTRIBUTED_COLOR }}
                    aria-hidden="true"
                  />
                  {t('mindroomUi.usage.unattributed')}
                </span>
              )}
            </div>
          </>
        )}
      </section>

      <section className={css.SectionCard}>
        <Text size="L400" as="h2">
          {t('mindroomUi.usage.breakdownTitle')}
        </Text>
        <div className={css.TableWrap}>
          <table className={css.Table}>
            <thead>
              <tr>
                <th>{t('mindroomUi.usage.colAccount')}</th>
                <th className={css.NumericCell}>{t('mindroomUi.usage.colTokens')}</th>
                <th className={css.NumericCell}>{t('mindroomUi.usage.colShare')}</th>
                <th className={css.NumericCell}>{t('mindroomUi.usage.colSpend')}</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.accounts.map((account) => (
                <tr key={account.id}>
                  <td>
                    <Box alignItems="Center" gap="200">
                      <span
                        className={css.ProviderDot}
                        style={{ backgroundColor: colors.get(account.id) }}
                        aria-hidden="true"
                      />
                      <span>{accountDisplayTitle(account, snapshot.accounts)}</span>
                    </Box>
                  </td>
                  <td className={css.NumericCell}>
                    {formatCompactTokens(account.tokens_7d, language)}
                  </td>
                  <td className={css.NumericCell}>{formatShare(account.tokens_7d)}</td>
                  <td className={css.NumericCell}>
                    {account.cost_usd_7d === null
                      ? '—'
                      : account.cost_estimated
                        ? t('mindroomUi.usage.estimatedCost', {
                            cost: formatUsd(account.cost_usd_7d, language),
                          })
                        : formatUsd(account.cost_usd_7d, language)}
                  </td>
                </tr>
              ))}
              {showUnattributed && (
                <tr data-testid="unattributed-row">
                  <td>
                    <Box alignItems="Center" gap="200">
                      <span
                        className={css.ProviderDot}
                        style={{ backgroundColor: UNATTRIBUTED_COLOR }}
                        aria-hidden="true"
                      />
                      <span>{t('mindroomUi.usage.unattributed')}</span>
                    </Box>
                  </td>
                  <td className={css.NumericCell}>
                    {formatCompactTokens(snapshot.unattributed_tokens_7d, language)}
                  </td>
                  <td className={css.NumericCell}>
                    {formatShare(snapshot.unattributed_tokens_7d)}
                  </td>
                  <td className={css.NumericCell}>
                    {snapshot.unattributed_cost_usd_7d === null
                      ? '—'
                      : formatUsd(snapshot.unattributed_cost_usd_7d, language)}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
