import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Spinner, Text } from 'folds';
import { IconAlertTriangle, IconGauge, IconRefresh } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useAppLanguageCode } from '../i18n/useAppLanguageCode';
import { useRelativeTime } from '../i18n/useRelativeTime';
import { ScreenSize, useScreenSizeContext } from '../lib/hooks/useScreenSize';
import { Page, PageContent, PageHeader } from '../ui/page/Page';
import { PageScroll } from '../ui/page/PageScroll';
import { ProviderModelIcon } from '../ui/ProviderModelIcon';
import type { ProviderAccountUsage } from './providerUsageProtocol';
import { accountChartColor, accountDisplayTitle, QuotaBar } from './QuotaBar';
import { useProviderUsage } from './useProviderUsage';
import {
  formatCompactTokens,
  formatUsd,
  ModelChips,
  UsageBreakdownSection,
  UsageDailySection,
  UsageOverviewSection,
} from './UsageTokensView';
import * as css from './UsagePage.css';

const COUNTDOWN_TICK_MS = 60_000;
const SUBSCRIPTION_QUOTA_PROVIDERS = new Set(['codex', 'claude_code']);

const useMinuteClock = (active: boolean, resetKey?: string): number => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (!active) return undefined;
    const id = window.setInterval(() => setNow(Date.now()), COUNTDOWN_TICK_MS);
    return () => window.clearInterval(id);
  }, [active, resetKey]);
  return now;
};

const isSubscriptionAccount = (account: ProviderAccountUsage): boolean =>
  account.windows.length > 0 ||
  SUBSCRIPTION_QUOTA_PROVIDERS.has(account.provider.toLowerCase()) ||
  (account.unavailable_reason !== undefined &&
    account.unavailable_reason !== null &&
    account.unavailable_reason !== 'unsupported');

function SubscriptionAccountCard({
  account,
  allAccounts,
  spanFull,
  language,
  now,
}: {
  account: ProviderAccountUsage;
  allAccounts: readonly ProviderAccountUsage[];
  spanFull: boolean;
  language: string;
  now: number;
}) {
  const { t } = useTranslation();
  const title = accountDisplayTitle(account, allAccounts);
  const rawPlan = account.plan || account.account_label || undefined;
  const planText = rawPlan && !title.endsWith(`· ${rawPlan.trim()}`) ? rawPlan : undefined;
  const spendText =
    account.cost_usd_7d !== null
      ? account.cost_estimated
        ? t('mindroomUi.usage.estimatedCost', { cost: formatUsd(account.cost_usd_7d, language) })
        : formatUsd(account.cost_usd_7d, language)
      : undefined;

  return (
    <article
      className={css.AccountCard}
      data-account-card={account.id}
      data-span-full={spanFull || undefined}
    >
      <div className={css.CardHeader}>
        <div className={css.RowInline}>
          <ProviderModelIcon provider={account.provider} size={20} />
          <div className={css.RowWrap}>
            <span className={css.CardName}>{title}</span>
            {planText && <span className={css.PillBadge}>{planText}</span>}
            {account.stale && (
              <Badge variant="Warning" fill="Soft" radii="300" data-stale-badge="">
                <Text size="L400">{t('mindroomUi.usage.stale')}</Text>
              </Badge>
            )}
          </div>
        </div>
        <div className={css.CardStats}>
          {spendText ? (
            <>
              <strong>{spendText}</strong>
              <span className={css.MutedText}>
                {formatCompactTokens(account.tokens_7d, language)}
              </span>
            </>
          ) : (
            <span className={css.MutedText}>
              {t('mindroomUi.usage.tokens7d', {
                tokens: formatCompactTokens(account.tokens_7d, language),
              })}
            </span>
          )}
        </div>
      </div>

      <div className={css.WindowsList}>
        {account.windows.length > 0 ? (
          account.windows.map((window) => (
            <QuotaBar key={window.id} window={window} provider={account.provider} now={now} />
          ))
        ) : (
          <div
            className={css.NoLimitNote}
            data-unavailable-reason={account.unavailable_reason ?? 'limits_unavailable'}
          >
            <span>
              {account.unavailable_reason === 'not_signed_in'
                ? t('mindroomUi.usage.notSignedIn')
                : t('mindroomUi.usage.limitsUnavailable')}
            </span>
          </div>
        )}
      </div>

      {account.model_keys.length > 0 && (
        <div className={css.ChipFooter}>
          <ModelChips keys={account.model_keys} max={6} />
        </div>
      )}
    </article>
  );
}

export function UsagePage() {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const usage = useProviderUsage();
  const { ensureLoaded, snapshot } = usage;

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const checkedAtMs = snapshot ? Date.parse(snapshot.checked_at) : Number.NaN;
  const relativeUpdated = useRelativeTime(Number.isFinite(checkedAtMs) ? checkedAtMs : undefined);
  const now = useMinuteClock(Boolean(snapshot), snapshot?.checked_at);

  const colors = useMemo(() => {
    const usedColors = new Set<string>();
    return new Map(
      (snapshot?.accounts ?? []).map((account, index) => [
        account.id,
        accountChartColor(account, index, usedColors),
      ])
    );
  }, [snapshot?.accounts]);

  const subscriptionAccounts = useMemo(
    () => (snapshot?.accounts ?? []).filter(isSubscriptionAccount),
    [snapshot?.accounts]
  );

  const hasAnyUsageData =
    Boolean(snapshot) &&
    ((snapshot?.accounts.length ?? 0) > 0 ||
      (snapshot?.unattributed_tokens_7d ?? 0) > 0 ||
      (snapshot?.top_models_7d?.length ?? 0) > 0 ||
      (snapshot?.top_agents_7d?.length ?? 0) > 0);

  return (
    <Page data-testid="usage-view">
      <PageHeader className={css.UsageHeader}>
        <div className={css.HeaderInner}>
          <div className={css.RowInline}>
            <IconGauge size={22} stroke={1.8} aria-hidden="true" />
            <Text as="h1" size="H3" truncate>
              {t('mindroomUi.usage.title')}
            </Text>
          </div>
          <div className={css.RowWrap}>
            {usage.runtimes.length > 1 && (
              <select
                className={css.RuntimeSelect}
                aria-label={t('mindroomUi.usage.runtimeLabel')}
                title={t('mindroomUi.usage.runtimeLabel')}
                value={usage.selectedRuntimeId ?? ''}
                onChange={(event) => usage.selectRuntime(event.target.value)}
              >
                {usage.runtimes.map((runtime) => (
                  <option key={runtime.id} value={runtime.id}>
                    {runtime.userId} ({runtime.deviceId})
                  </option>
                ))}
              </select>
            )}
            {relativeUpdated && (
              <span className={css.MutedText}>
                {t('mindroomUi.usage.updatedAgo', { time: relativeUpdated })}
              </span>
            )}
            {usage.available && (
              <button
                type="button"
                className={css.ActionButton}
                aria-label={t('mindroomUi.usage.refresh')}
                title={t('mindroomUi.usage.refresh')}
                disabled={usage.refreshing}
                onClick={() => usage.refresh(true)}
              >
                {usage.refreshing ? (
                  <Spinner size="100" variant="Secondary" />
                ) : (
                  <IconRefresh size={15} stroke={1.9} aria-hidden="true" />
                )}
                <span>{t('mindroomUi.usage.refresh')}</span>
              </button>
            )}
          </div>
        </div>
      </PageHeader>
      <PageScroll>
        <PageContent>
          {usage.loading && !usage.available ? (
            <div className={css.CenterState} role="status">
              <Spinner size="300" variant="Secondary" />
              <Text size="T300" priority="300">
                {t('mindroomUi.usage.loading')}
              </Text>
            </div>
          ) : !snapshot ? (
            <div className={css.CenterState} data-testid="usage-unavailable">
              <IconGauge size={36} stroke={1.5} aria-hidden="true" />
              <Text as="h2" size="H4">
                {t('mindroomUi.usage.unavailableTitle')}
              </Text>
              <Text size="T300" priority="300">
                {t('mindroomUi.usage.unavailableBody')}
              </Text>
              <Button variant="Secondary" radii="300" onClick={() => usage.refresh(true)}>
                <Text size="B400">{t('mindroomUi.usage.retry')}</Text>
              </Button>
            </div>
          ) : (
            <div className={css.PageStack}>
              {snapshot.partial && (
                <div className={css.PartialNotice} role="status" data-testid="partial-data-notice">
                  <IconAlertTriangle size={16} stroke={1.8} aria-hidden="true" />
                  <span>{t('mindroomUi.usage.partialData')}</span>
                </div>
              )}

              {!hasAnyUsageData ? (
                <div className={css.CenterState}>
                  <Text size="T300" priority="300">
                    {t('mindroomUi.usage.noAccounts')}
                  </Text>
                </div>
              ) : (
                <>
                  <UsageOverviewSection snapshot={snapshot} language={language} />

                  {subscriptionAccounts.length > 0 && (
                    <section data-testid="subscription-quotas-section">
                      <div className={css.SectionKicker}>
                        <h2 className={css.KickerTitle}>
                          {t('mindroomUi.usage.subscriptionQuotas')}
                        </h2>
                        {subscriptionAccounts.some((a) => a.windows.some((w) => Boolean(w.resets_at && w.window_duration_mins && w.window_duration_mins > 0))) && (
                          <span className={css.MutedText}>{t('mindroomUi.usage.paceLegend')}</span>
                        )}
                      </div>
                      <div
                        className={css.CardGrid}
                        data-testid="usage-limits-grid"
                        data-mobile={phone || undefined}
                      >
                        {subscriptionAccounts.map((account, index) => (
                          <SubscriptionAccountCard
                            key={account.id}
                            account={account}
                            allAccounts={snapshot.accounts}
                            spanFull={
                              !phone &&
                              subscriptionAccounts.length % 2 === 1 &&
                              index === subscriptionAccounts.length - 1
                            }
                            language={language}
                            now={now}
                          />
                        ))}
                      </div>
                    </section>
                  )}

                  <UsageDailySection snapshot={snapshot} colors={colors} language={language} />
                  <UsageBreakdownSection snapshot={snapshot} colors={colors} language={language} />
                </>
              )}
            </div>
          )}
        </PageContent>
      </PageScroll>
    </Page>
  );
}
