import { type KeyboardEvent, useId, useMemo, useRef, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { ProviderModelIcon } from '../ui/ProviderModelIcon';
import type {
  ProviderAccountUsage,
  ProviderUsageSnapshot,
  TokenMix,
} from './providerUsageProtocol';
import { accountDisplayTitle, providerAccentColor } from './QuotaBar';
import {
  accountSubtitle,
  alignDailySeriesToCalendar7d,
  type CalendarDaySlot,
  formatCompactTokens,
  formatDay,
  formatShare,
  formatUsd,
  snapshotTotals,
  tokenMixTotal,
} from './usageCalendar';
import { ModelChips, Sparkline, TokenMixBar } from './UsageTokensView';
import * as css from './UsagePage.css';

const UNATTRIBUTED_COLOR = '#94a3b8';
const AGENT_PALETTE = ['#7c6af7', '#d97757', '#10a37f', '#3b82f6', '#f59e0b', '#ec4899', '#14b8a6'];

type BreakdownTab = 'models' | 'agents' | 'accounts';

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

const sparklineAriaLabel = (
  values: readonly number[],
  calendar: readonly CalendarDaySlot[],
  language: string,
  t: TFunction
): string => {
  const parts =
    values.length === calendar.length
      ? values.map(
          (val, i) =>
            `${formatDay(calendar[i]!.day, language, 'short')} ${formatCompactTokens(val, language)}`
        )
      : values.map((val) => formatCompactTokens(val, language));
  return `${t('mindroomUi.usage.trend7d')}: ${parts.join(', ')}`;
};

const buildBreakdown = (
  tab: BreakdownTab,
  snapshot: ProviderUsageSnapshot,
  calendar: readonly CalendarDaySlot[],
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
          const runs =
            m.run_count > 0 ? t('mindroomUi.usage.runCount', { count: m.run_count }) : undefined;
          return {
            id: `m:${i}:${m.provider}:${m.model}:${m.account_id ?? ''}`,
            title: m.model,
            mono: true,
            subtitle: runs ? `${origin} · ${runs}` : origin,
            color: (acc ? colors.get(acc.id) : undefined) ?? providerAccentColor(m.provider),
            tokens: m.tokens_7d,
            cost: m.cost_usd_7d,
            mix: m.token_mix_7d,
            spark: alignDailySeriesToCalendar7d(m.daily_tokens_7d, snapshot.daily_7d, calendar),
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
          spark: alignDailySeriesToCalendar7d(g.daily_tokens_7d, snapshot.daily_7d, calendar),
        }))
        .sort(sortBySpendThenTokens),
    };
  }

  const hasCalendar = snapshot.daily_7d.length > 0 && calendar.length >= 2;
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
      subtitle: accountSubtitle(account, title),
      color: colors.get(account.id) ?? providerAccentColor(account.provider),
      tokens: account.tokens_7d,
      cost: account.cost_usd_7d,
      costEstimated: account.cost_estimated,
      mix: account.token_mix_7d,
      spark: hasCalendar ? calendar.map((slot) => slot.by_account[account.id] ?? 0) : undefined,
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
      spark: hasCalendar ? calendar.map((slot) => slot.unattributed_tokens) : undefined,
      testId: 'unattributed-row',
    });
  }

  return { items: active.sort(sortBySpendThenTokens), idleAccounts: idle };
};

export function UsageBreakdown({
  snapshot,
  calendar,
  colors,
  language,
}: {
  snapshot: ProviderUsageSnapshot;
  calendar: readonly CalendarDaySlot[];
  colors: ReadonlyMap<string, string>;
  language: string;
}) {
  const { t } = useTranslation();
  const baseId = useId();
  const tabRefs = useRef<Partial<Record<BreakdownTab, HTMLButtonElement | null>>>({});

  const { totalTokens, totalCost } = snapshotTotals(snapshot);
  const hasModels = (snapshot.top_models_7d?.length ?? 0) > 0;
  const hasAgents = (snapshot.top_agents_7d?.length ?? 0) > 0;
  const availableTabs: BreakdownTab[] = [
    ...(hasModels ? (['models'] as const) : []),
    ...(hasAgents ? (['agents'] as const) : []),
    'accounts',
  ];

  const [tabPref, setTabPref] = useState<BreakdownTab | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showIdle, setShowIdle] = useState(false);

  const activeTab: BreakdownTab =
    tabPref && availableTabs.includes(tabPref) ? tabPref : hasModels ? 'models' : 'accounts';
  const { items, idleAccounts } = useMemo(
    () => buildBreakdown(activeTab, snapshot, calendar, colors, t),
    [activeTab, snapshot, calendar, colors, t]
  );

  const tabId = (tab: BreakdownTab) => `${baseId}-tab-${tab}`;
  const panelId = `${baseId}-panel`;
  const tabLabel = (tab: BreakdownTab) =>
    t(
      tab === 'models'
        ? 'mindroomUi.usage.tabModels'
        : tab === 'agents'
          ? 'mindroomUi.usage.tabAgents'
          : 'mindroomUi.usage.tabAccounts'
    );

  const selectTab = (tab: BreakdownTab, focus = false) => {
    setTabPref(tab);
    setExpandedId(null);
    if (focus) tabRefs.current[tab]?.focus();
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (availableTabs.length <= 1) return;
    const isRtl = window.getComputedStyle(event.currentTarget).direction === 'rtl';
    const step = isRtl ? -1 : 1;
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight')
      nextIndex = (index + step + availableTabs.length) % availableTabs.length;
    else if (event.key === 'ArrowLeft')
      nextIndex = (index - step + availableTabs.length) % availableTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = availableTabs.length - 1;
    if (nextIndex === undefined) return;
    event.preventDefault();
    const nextTab = availableTabs[nextIndex];
    if (nextTab) selectTab(nextTab, true);
  };

  return (
    <section className={css.SectionCard} data-testid="where-usage-goes">
      <div className={css.RowBetween}>
        <div>
          <h2 className={css.SectionHeading}>{t('mindroomUi.usage.whereUsageGoes')}</h2>
          <span className={css.MutedText}>{t('mindroomUi.usage.whereUsageGoesSub')}</span>
        </div>
        <div
          className={css.Segmented}
          role="tablist"
          aria-label={t('mindroomUi.usage.whereUsageGoes')}
        >
          {availableTabs.map((tab, index) => {
            const label = tabLabel(tab);
            const isSelected = activeTab === tab;
            return (
              <button
                key={tab}
                ref={(el) => {
                  tabRefs.current[tab] = el;
                }}
                id={tabId(tab)}
                type="button"
                role="tab"
                aria-selected={isSelected}
                aria-controls={panelId}
                tabIndex={isSelected ? 0 : -1}
                title={label}
                className={css.SegmentTab}
                onClick={() => selectTab(tab)}
                onKeyDown={(event) => handleTabKeyDown(event, index)}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div id={panelId} className={css.RankList} role="tabpanel" aria-labelledby={tabId(activeTab)}>
        {items.map((item) => {
          const open = expandedId === item.id;
          const useCostShare = totalCost !== null && totalCost > 0 && item.cost !== null;
          const pct = useCostShare
            ? (item.cost! / totalCost) * 100
            : totalTokens > 0
              ? (item.tokens / totalTokens) * 100
              : 0;
          const costDisplay =
            item.cost === null
              ? null
              : item.costEstimated
                ? t('mindroomUi.usage.estimatedCost', { cost: formatUsd(item.cost, language) })
                : formatUsd(item.cost, language);

          return (
            <div key={item.id} className={css.RankCard} data-testid={item.testId}>
              <button
                type="button"
                className={css.RankButton}
                aria-expanded={open}
                data-breakdown-row={item.id}
                onClick={() => setExpandedId(open ? null : item.id)}
              >
                <div className={css.RankRow}>
                  <span className={css.RowInline}>
                    <span
                      className={css.ColorDot}
                      style={{ backgroundColor: item.color }}
                      aria-hidden="true"
                    />
                    <span className={css.RankTitleWrap}>
                      <span className={css.RankTitle} data-mono={item.mono || undefined}>
                        {item.title}
                      </span>
                      {item.subtitle && (
                        <span className={css.MutedText}>{` · ${item.subtitle}`}</span>
                      )}
                    </span>
                  </span>
                  <span className={css.RankMetrics}>
                    {costDisplay !== null ? (
                      <>
                        <strong>{costDisplay}</strong>
                        <span className={css.MutedText}>
                          {` · ${formatCompactTokens(item.tokens, language)}`}
                        </span>
                      </>
                    ) : (
                      <strong>{formatCompactTokens(item.tokens, language)}</strong>
                    )}
                  </span>
                </div>
                <div className={css.ShareTrack} aria-hidden="true">
                  <span
                    className={css.ShareFill}
                    style={{
                      inlineSize: `${pct > 0 ? Math.max(1.5, Math.min(100, pct)).toFixed(1) : '0'}%`,
                      backgroundColor: item.color,
                    }}
                  />
                </div>
              </button>

              {open && (
                <div className={css.RankDrawer} data-testid="breakdown-drawer">
                  <div className={css.RowBetween}>
                    <span className={css.MutedText}>
                      {useCostShare
                        ? t('mindroomUi.usage.shareOfSpend', {
                            share: formatShare(item.cost!, totalCost, language),
                          })
                        : t('mindroomUi.usage.shareOfTokens', {
                            share: formatShare(item.tokens, totalTokens, language),
                          })}
                    </span>
                    {item.spark && item.spark.length >= 2 && item.spark.some((v) => v > 0) && (
                      <span className={css.RowInline}>
                        <span className={css.MutedText} aria-hidden="true">
                          {t('mindroomUi.usage.trend7d')}
                        </span>
                        <Sparkline
                          values={item.spark}
                          stroke={item.color}
                          ariaLabel={sparklineAriaLabel(item.spark, calendar, language, t)}
                        />
                      </span>
                    )}
                  </div>
                  {item.mix && tokenMixTotal(item.mix) > 0 && (
                    <TokenMixBar mix={item.mix} compact language={language} />
                  )}
                  {item.modelKeys && item.modelKeys.length > 0 && (
                    <ModelChips keys={item.modelKeys} max={6} />
                  )}
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
                const sub = accountSubtitle(account, title);
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
