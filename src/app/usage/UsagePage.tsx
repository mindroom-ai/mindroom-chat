import { useEffect, useState } from 'react';
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
import { accountDisplayTitle, providerAccentColor, QuotaBar } from './QuotaBar';
import { useProviderUsage } from './useProviderUsage';
import { formatCompactTokens, formatUsd, UsageTokensView } from './UsageTokensView';
import * as css from './UsagePage.css';

type UsageTabId = 'limits' | 'tokens';

const COUNTDOWN_TICK_MS = 60_000;

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

const isPayAsYouGo = (account: ProviderAccountUsage): boolean => {
  const label = `${account.plan ?? ''} ${account.account_label ?? ''}`.toLowerCase();
  return (
    label.includes('pay-as-you-go') || label.includes('pay as you go') || label.includes('payg')
  );
};

const SUBSCRIPTION_QUOTA_PROVIDERS = new Set(['codex', 'claude_code']);

const isSubscriptionQuotaProvider = (provider: string): boolean =>
  SUBSCRIPTION_QUOTA_PROVIDERS.has(provider.toLowerCase());

function AccountLimitCard({
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
        <div className={css.CardIdentity}>
          <ProviderModelIcon provider={account.provider} size={20} />
          <span
            className={css.ProviderDot}
            style={{ backgroundColor: providerAccentColor(account.provider) }}
            aria-hidden="true"
          />
          <div className={css.CardTitles}>
            <span className={css.CardName}>{title}</span>
            {planText && <span className={css.MutedText}>{planText}</span>}
          </div>
        </div>
        {account.stale && (
          <Badge variant="Warning" fill="Soft" radii="300" data-stale-badge="">
            <Text size="L400">{t('mindroomUi.usage.stale')}</Text>
          </Badge>
        )}
      </div>

      <div className={css.WindowsList}>
        {account.windows.length > 0 ? (
          account.windows.map((window) => (
            <QuotaBar key={window.id} window={window} provider={account.provider} now={now} />
          ))
        ) : account.unavailable_reason || isSubscriptionQuotaProvider(account.provider) ? (
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
        ) : (
          <div className={css.NoLimitNote} data-no-limit="">
            {isPayAsYouGo(account) && <strong>{t('mindroomUi.usage.payAsYouGo')}</strong>}
            <span>{t('mindroomUi.usage.noSubscriptionLimit')}</span>
          </div>
        )}
      </div>

      <div className={css.CardFooter}>
        <span>
          {t('mindroomUi.usage.tokens7d', {
            tokens: formatCompactTokens(account.tokens_7d, language),
          })}
        </span>
        {spendText && <span>{spendText}</span>}
      </div>
    </article>
  );
}

export function UsagePage() {
  const { t } = useTranslation();
  const language = useAppLanguageCode();
  const phone = useScreenSizeContext() === ScreenSize.Mobile;
  const usage = useProviderUsage();
  const { ensureLoaded } = usage;
  const [activeTab, setActiveTab] = useState<UsageTabId>('limits');

  useEffect(() => {
    ensureLoaded();
  }, [ensureLoaded]);

  const checkedAtMs = usage.snapshot ? Date.parse(usage.snapshot.checked_at) : Number.NaN;
  const relativeUpdated = useRelativeTime(Number.isFinite(checkedAtMs) ? checkedAtMs : undefined);
  const now = useMinuteClock(
    Boolean(usage.snapshot) && activeTab === 'limits',
    usage.snapshot?.checked_at
  );

  return (
    <Page data-testid="usage-view">
      <PageHeader>
        <div className={css.HeaderInner}>
          <div className={css.HeaderTitle}>
            <IconGauge size={22} stroke={1.8} aria-hidden="true" />
            <Text as="h1" size="H3" truncate>
              {t('mindroomUi.usage.title')}
            </Text>
          </div>
          <div className={css.HeaderControls}>
            {usage.runtimes.length > 1 && (
              <select
                className={css.RuntimeSelect}
                aria-label={t('mindroomUi.usage.runtimeLabel')}
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
                className={css.RefreshButton}
                aria-label={t('mindroomUi.usage.refresh')}
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
          ) : !usage.snapshot ? (
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
            <>
              <div className={css.Toolbar}>
                <div
                  className={css.Segmented}
                  role="tablist"
                  aria-label={t('mindroomUi.usage.title')}
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'limits'}
                    className={css.SegmentTab}
                    onClick={() => setActiveTab('limits')}
                  >
                    {t('mindroomUi.usage.tabsLimits')}
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'tokens'}
                    className={css.SegmentTab}
                    onClick={() => setActiveTab('tokens')}
                  >
                    {t('mindroomUi.usage.tabsTokens')}
                  </button>
                </div>
              </div>

              {usage.snapshot.partial && (
                <div className={css.PartialNotice} role="status" data-testid="partial-data-notice">
                  <IconAlertTriangle size={16} stroke={1.8} aria-hidden="true" />
                  <span>{t('mindroomUi.usage.partialData')}</span>
                </div>
              )}

              {activeTab === 'limits' ? (
                usage.snapshot.accounts.length === 0 ? (
                  <div className={css.CenterState}>
                    <Text size="T300" priority="300">
                      {t('mindroomUi.usage.noAccounts')}
                    </Text>
                  </div>
                ) : (
                  <div
                    className={css.CardGrid}
                    data-testid="usage-limits-grid"
                    data-mobile={phone || undefined}
                  >
                    {usage.snapshot.accounts.map((account, index) => {
                      const isOddLast =
                        !phone &&
                        usage.snapshot!.accounts.length % 2 === 1 &&
                        index === usage.snapshot!.accounts.length - 1;
                      return (
                        <AccountLimitCard
                          key={account.id}
                          account={account}
                          allAccounts={usage.snapshot!.accounts}
                          spanFull={isOddLast}
                          language={language}
                          now={now}
                        />
                      );
                    })}
                  </div>
                )
              ) : (
                <UsageTokensView snapshot={usage.snapshot} language={language} />
              )}
            </>
          )}
        </PageContent>
      </PageScroll>
    </Page>
  );
}
