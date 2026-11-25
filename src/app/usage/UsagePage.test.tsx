// @vitest-environment jsdom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import contractFixture from './__fixtures__/providerUsageContract.json';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import type { ProviderUsageSnapshot } from './providerUsageProtocol';
import { accountChartColor, formatWholePercent, singleAccountForModels } from './QuotaBar';
import type { UseProviderUsageResult } from './useProviderUsage';
import { UsagePage } from './UsagePage';
import { formatShortUsd } from './UsageTokensView';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  usage: {} as UseProviderUsageResult,
}));

vi.mock('./useProviderUsage', () => ({
  useProviderUsage: () => mocks.usage,
}));

vi.mock('../i18n/useAppLanguageCode', () => ({
  useAppLanguageCode: () => 'en',
}));

vi.mock('../i18n/useRelativeTime', () => ({
  useRelativeTime: (ts: number | undefined) => (ts === undefined ? '' : 'just now'),
}));

vi.mock('react-i18next', async () => {
  const { translateFromEn } = await import('../../test/utils/i18n');
  return { useTranslation: () => ({ t: translateFromEn }) };
});

vi.mock('../ui/page/Page', () => ({
  Page: ({ children, ...rest }: React.HTMLAttributes<HTMLDivElement>) => (
    <div {...rest}>{children}</div>
  ),
  PageHeader: ({ children }: { children?: React.ReactNode }) => <header>{children}</header>,
  PageContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock('../ui/page/PageScroll', () => ({
  PageScroll: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

const cloneFixture = (): ProviderUsageSnapshot =>
  JSON.parse(JSON.stringify(contractFixture)) as ProviderUsageSnapshot;

const makeMinimalV1 = (): ProviderUsageSnapshot => {
  const snapshot = cloneFixture();
  delete snapshot.token_mix_7d;
  delete snapshot.cache_savings_usd_7d;
  delete snapshot.top_models_7d;
  delete snapshot.top_agents_7d;
  for (const account of snapshot.accounts) {
    delete account.token_mix_7d;
    account.cost_usd_7d = null;
  }
  for (const day of snapshot.daily_7d) {
    delete day.cost_by_account;
    delete day.unattributed_cost_usd;
  }
  return snapshot;
};

const makeUsageState = (patch: Partial<UseProviderUsageResult> = {}): UseProviderUsageResult => {
  const snapshot = 'snapshot' in patch ? patch.snapshot : cloneFixture();
  return {
    status: snapshot ? 'ready' : 'unavailable',
    available: !!snapshot,
    hasLowQuota: true,
    loading: false,
    refreshing: false,
    runtimes: snapshot
      ? [
          {
            id: '@mindroom_dev:example.org:DEV1',
            userId: '@mindroom_dev:example.org',
            deviceId: 'DEV1',
            curveKey: 'curve-1',
          },
        ]
      : [],
    selectedRuntimeId: snapshot ? '@mindroom_dev:example.org:DEV1' : undefined,
    snapshot,
    snapshotsByRuntime: snapshot ? { '@mindroom_dev:example.org:DEV1': snapshot } : {},
    selectRuntime: vi.fn(),
    ensureLoaded: vi.fn(),
    refresh: vi.fn(),
    ...patch,
  };
};

let container: HTMLDivElement;
let root: Root;

const renderPage = (usage: UseProviderUsageResult, screenSize = ScreenSize.Desktop) => {
  mocks.usage = usage;
  act(() => {
    root.render(
      <ScreenSizeProvider value={screenSize}>
        <UsagePage />
      </ScreenSizeProvider>
    );
  });
};

const findTab = (label: string): HTMLButtonElement | undefined =>
  [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(
    (el) => el.textContent?.trim() === label
  );

describe('UsagePage (M1 · A+ Unified) & QuotaBar', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-23T20:00:00Z'));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('renders unified KPIs, token & cache mix, subscription quotas with pace badges & model chips, and omits empty PAYG quota cards', () => {
    const snapshot = cloneFixture();
    snapshot.accounts[0]!.stale = true;
    snapshot.accounts[0]!.model_keys = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'];
    // Make Claude 7d window "On pace" (60% remaining vs 60% time left: 4.2d = 6048 mins from 20:00Z)
    snapshot.accounts[0]!.windows[1]!.remaining_percent = 61;
    snapshot.accounts[0]!.windows[1]!.resets_at = '2026-11-28T00:48:00Z';

    const usage = makeUsageState({ snapshot });
    renderPage(usage);

    expect(usage.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="total-cost-7d"]')?.textContent).toBe('$21.65');
    expect(container.querySelector('[data-testid="total-tokens-7d"]')?.textContent).toBe('31.6M');
    expect(container.querySelector('[data-testid="token-mix-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="cache-savings-badge"]')?.textContent).toContain(
      'Saved ~$6.9 via cache'
    );

    // Only the 3 subscription accounts render quota cards; PAYG Anthropic is NOT an empty card.
    expect(container.querySelectorAll('[data-account-card]')).toHaveLength(3);
    expect(container.querySelector('[data-account-card="anthropic:default"]')).toBeNull();
    expect(container.textContent).not.toContain('No subscription limit');

    // Pace ticks & explicit pace delta badges (ahead, on pace, fast burn; none for untimed OpenRouter).
    expect(container.querySelectorAll('[data-pace-tick]')).toHaveLength(4);
    const claudeCard = container.querySelector('[data-account-card="claude_code:default"]')!;
    expect(claudeCard.querySelector('[data-stale-badge]')).not.toBeNull();
    expect(claudeCard.textContent).toContain('62% left');
    expect(claudeCard.textContent).toContain('Resets in 2h 24m');
    expect(claudeCard.querySelector('[data-pace-tone="ahead"]')?.textContent).toBe('+14% ahead');
    expect(claudeCard.querySelector('[data-pace-tone="on_pace"]')?.textContent).toBe('On pace');
    // Model chips cap at 6 + overflow chip with hidden keys in title.
    expect(claudeCard.textContent).toContain('m6');
    expect(claudeCard.textContent).toContain('+2');
    expect(claudeCard.querySelector('[title="m7, m8"]')).not.toBeNull();

    const codexCard = container.querySelector('[data-account-card="codex:default"]')!;
    expect(codexCard.querySelector('[data-pace-tone="behind"]')?.textContent).toBe(
      '-50% fast burn'
    );

    const openRouterCard = container.querySelector('[data-account-card="openrouter:1"]')!;
    expect(openRouterCard.querySelector('[data-pace-badge]')).toBeNull();
    expect(openRouterCard.textContent).toContain('$31.60 / $50.00 left');

    const refreshButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Refresh"]'
    )!;
    act(() => refreshButton.click());
    expect(usage.refresh).toHaveBeenCalledWith(true);
  });

  it('shows 3-day spend trend badge only when at least 6 days have cost data', () => {
    const snapshot = cloneFixture();
    // Fixture only has 2 days -> no trend badge.
    renderPage(makeUsageState({ snapshot }));
    expect(container.querySelector('[data-testid="spend-trend-badge"]')).toBeNull();

    // 6 days: prior 3 sum = 30, last 3 sum = 39 -> +30% (warn)
    snapshot.daily_7d = [10, 10, 10, 12, 13, 14].map((cost, idx) => ({
      day: `2026-11-1${idx + 3}`,
      by_account: { 'openrouter:1': 1_000_000 },
      unattributed_tokens: 0,
      cost_by_account: { 'openrouter:1': cost },
      unattributed_cost_usd: 0,
    }));
    renderPage(makeUsageState({ snapshot }));
    const upBadge = container.querySelector('[data-testid="spend-trend-badge"]')!;
    expect(upBadge.textContent).toBe('+30%');
    expect(upBadge.getAttribute('data-tone')).toBe('warn');

    // Negative trend: prior 3 sum = 60, last 3 sum = 45 -> -25% (ok)
    snapshot.daily_7d = [20, 20, 20, 15, 15, 15].map((cost, idx) => ({
      day: `2026-11-1${idx + 3}`,
      by_account: { 'openrouter:1': 1_000_000 },
      unattributed_tokens: 0,
      cost_by_account: { 'openrouter:1': cost },
      unattributed_cost_usd: 0,
    }));
    renderPage(makeUsageState({ snapshot }));
    const downBadge = container.querySelector('[data-testid="spend-trend-badge"]')!;
    expect(downBadge.textContent).toBe('-25%');
    expect(downBadge.getAttribute('data-tone')).toBe('ok');
  });

  it('spans the trailing odd subscription card full-width on desktop, stacks on mobile, and skips section when no subscription accounts exist', () => {
    const snapshot = cloneFixture();
    renderPage(makeUsageState({ snapshot }), ScreenSize.Desktop);

    const grid = container.querySelector('[data-testid="usage-limits-grid"]')!;
    expect(grid.getAttribute('data-mobile')).toBeNull();
    expect(
      container.querySelector('[data-account-card="openrouter:1"]')!.getAttribute('data-span-full')
    ).toBe('true');

    renderPage(makeUsageState({ snapshot }), ScreenSize.Mobile);
    expect(
      container.querySelector('[data-testid="usage-limits-grid"]')!.getAttribute('data-mobile')
    ).toBe('true');
    expect(
      container.querySelector('[data-account-card="openrouter:1"]')!.getAttribute('data-span-full')
    ).toBeNull();

    // PAYG-only snapshot skips the Subscription quotas section entirely.
    const paygOnly = cloneFixture();
    paygOnly.accounts = [paygOnly.accounts[3]!];
    renderPage(makeUsageState({ snapshot: paygOnly }));
    expect(container.querySelector('[data-testid="subscription-quotas-section"]')).toBeNull();
    expect(container.querySelector('[data-testid="daily-activity-card"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="where-usage-goes"]')).not.toBeNull();
  });

  it('supports interactive day-bar selection, Spend/Tokens toggle, and Hide-dominant filtering', () => {
    const snapshot = cloneFixture();
    snapshot.daily_7d[0]!.cost_by_account!['anthropic:default'] = 0.4;
    snapshot.daily_7d[1]!.cost_by_account!['anthropic:default'] = 0.35;
    renderPage(makeUsageState({ snapshot }));

    // Defaults to Spend ($) and selects latest day with data (2026-11-18).
    const chartCard = container.querySelector('[data-testid="daily-activity-card"]')!;
    expect(chartCard.textContent).toContain('Daily estimated spend');
    const day17Btn = chartCard.querySelector<HTMLButtonElement>('button[data-day="2026-11-17"]')!;
    const day18Btn = chartCard.querySelector<HTMLButtonElement>('button[data-day="2026-11-18"]')!;
    expect(day18Btn.getAttribute('aria-pressed')).toBe('true');
    expect(day17Btn.getAttribute('aria-pressed')).toBe('false');

    const drawer = () => container.querySelector('[data-testid="day-detail-drawer"]')!;
    expect(drawer().textContent).toContain('$2.80');
    expect(drawer().textContent).toContain('$2.45');

    // Clicking earlier day updates selection and exact day totals.
    act(() => day17Btn.click());
    expect(day17Btn.getAttribute('aria-pressed')).toBe('true');
    expect(day18Btn.getAttribute('aria-pressed')).toBe('false');
    expect(drawer().textContent).toContain('$3.00');
    expect(drawer().textContent).toContain('$2.60');

    // OpenRouter is ~85% of spend -> Hide dominant button is visible and hides OpenRouter on click.
    const hideBtn = container.querySelector<HTMLButtonElement>('[data-testid="hide-dominant-btn"]')!;
    expect(hideBtn).not.toBeNull();
    expect(hideBtn.getAttribute('aria-pressed')).toBe('false');
    expect(hideBtn.textContent).toBe('Hide dominant');

    act(() => hideBtn.click());
    expect(hideBtn.getAttribute('aria-pressed')).toBe('true');
    expect(hideBtn.textContent).toBe('Reset filter');
    expect(drawer().querySelector('[data-day-account="openrouter:1"]')).toBeNull();
    expect(drawer().textContent).toContain('$0.40');

    act(() => hideBtn.click());
    expect(hideBtn.getAttribute('aria-pressed')).toBe('false');
    expect(drawer().querySelector('[data-day-account="openrouter:1"]')).not.toBeNull();

    // Switch to Tokens mode -> no account >= 70% of tokens, so Hide dominant disappears.
    const tokensMetricBtn = [...chartCard.querySelectorAll<HTMLButtonElement>('button')].find(
      (b) => b.textContent?.trim() === 'Tokens'
    )!;
    act(() => tokensMetricBtn.click());
    expect(tokensMetricBtn.getAttribute('aria-pressed')).toBe('true');
    expect(chartCard.textContent).toContain('Daily tokens');
    expect(container.querySelector('[data-testid="hide-dominant-btn"]')).toBeNull();
  });

  it('switches Models/Agents/Accounts, expands inline drawers with sparkline & mix, shows unattributed & partial notice, and folds idle accounts', () => {
    const snapshot = cloneFixture();
    snapshot.partial = true;
    snapshot.unattributed_tokens_7d = 500_000;
    snapshot.daily_7d[1]!.unattributed_tokens = 500_000;
    snapshot.accounts.push({
      id: 'ollama:local',
      provider: 'ollama',
      display_name: 'Ollama',
      account_label: 'Local',
      plan: 'Local',
      model_keys: ['local-model'],
      windows: [],
      checked_at: '2026-11-23T20:00:00Z',
      stale: false,
      tokens_7d: 0,
      cost_usd_7d: null,
      cost_estimated: false,
    });
    renderPage(makeUsageState({ snapshot }));

    expect(container.querySelector('[data-testid="partial-data-notice"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="day-unattributed-row"]')).not.toBeNull();

    // Defaults to Models tab, sorted by spend desc (neon-pro first).
    expect(findTab('Models')?.getAttribute('aria-selected')).toBe('true');
    const firstModelBtn = container.querySelector<HTMLButtonElement>('[data-breakdown-row]')!;
    expect(firstModelBtn.textContent).toContain('google/gemini-3-pro');
    expect(firstModelBtn.getAttribute('aria-expanded')).toBe('false');

    // Expand model row -> inline drawer with share, sparkline, and 4-part mini token mix.
    act(() => firstModelBtn.click());
    expect(firstModelBtn.getAttribute('aria-expanded')).toBe('true');
    const drawer = container.querySelector('[data-testid="breakdown-drawer"]')!;
    expect(drawer.textContent).toContain('Share of 7d spend');
    expect(drawer.querySelector('[data-sparkline]')).not.toBeNull();
    expect(drawer.textContent).toContain('Cache read');

    // Collapse by clicking again.
    act(() => firstModelBtn.click());
    expect(container.querySelector('[data-testid="breakdown-drawer"]')).toBeNull();

    // Switch to Agents tab.
    act(() => findTab('Agents')!.click());
    expect(findTab('Agents')?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-testid="where-usage-goes"]')?.textContent).toContain(
      'code'
    );
    expect(container.querySelector('[data-testid="where-usage-goes"]')?.textContent).toContain(
      '310 runs'
    );

    // Switch to Accounts tab: shows active accounts + Unattributed + folded idle account.
    act(() => findTab('Accounts')!.click());
    expect(findTab('Accounts')?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-testid="unattributed-row"]')).not.toBeNull();
    expect(container.querySelector('[data-idle-account="ollama:local"]')).toBeNull();

    // Expand PAYG Anthropic account row -> shows model_keys chip ("haiku").
    const anthropicRow = container.querySelector<HTMLButtonElement>(
      '[data-breakdown-row="a:anthropic:default"]'
    )!;
    act(() => anthropicRow.click());
    expect(container.querySelector('[data-testid="breakdown-drawer"]')?.textContent).toContain(
      'haiku'
    );

    // Toggle idle accounts open and closed.
    const idleToggle = container.querySelector<HTMLButtonElement>(
      '[data-testid="idle-accounts-toggle"]'
    )!;
    expect(idleToggle.textContent).toContain('1 idle account (0 tokens in 7d)');
    expect(idleToggle.getAttribute('aria-expanded')).toBe('false');

    act(() => idleToggle.click());
    expect(idleToggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-idle-account="ollama:local"]')?.textContent).toContain(
      'Ollama · Local'
    );

    act(() => idleToggle.click());
    expect(container.querySelector('[data-idle-account="ollama:local"]')).toBeNull();
  });

  it('gracefully degrades for minimal v1 snapshots with no optional fields or cost data', () => {
    const minimal = makeMinimalV1();
    renderPage(makeUsageState({ snapshot: minimal }));

    // Single Tokens KPI card (no spend KPI), no Token & Cache Mix card.
    expect(container.querySelector('[data-testid="total-cost-7d"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="usage-kpi-row"]')?.getAttribute('data-single')
    ).toBe('true');
    expect(container.querySelector('[data-testid="token-mix-card"]')).toBeNull();

    // Daily chart defaults to Tokens with no Spend ($) toggle.
    const chartCard = container.querySelector('[data-testid="daily-activity-card"]')!;
    expect(chartCard.textContent).toContain('Daily tokens');
    expect(chartCard.textContent).not.toContain('Spend ($)');

    // Where usage goes defaults to Accounts and omits Models & Agents tabs.
    expect(findTab('Models')).toBeUndefined();
    expect(findTab('Agents')).toBeUndefined();
    expect(findTab('Accounts')?.getAttribute('aria-selected')).toBe('true');

    // Expanding an account still renders share, sparkline from daily_7d, and model chips.
    const claudeRow = container.querySelector<HTMLButtonElement>(
      '[data-breakdown-row="a:claude_code:default"]'
    )!;
    act(() => claudeRow.click());
    const drawer = container.querySelector('[data-testid="breakdown-drawer"]')!;
    expect(drawer.textContent).toContain('Share of 7d tokens');
    expect(drawer.querySelector('[data-sparkline]')).not.toBeNull();
    expect(drawer.textContent).toContain('opus_native');
    expect(drawer.textContent).not.toContain('Cache read');
  });

  it('renders runtime switcher only when multiple runtimes answered and shows quiet unavailable state with Retry', () => {
    const multi = makeUsageState({
      runtimes: [
        { id: '@mindroom_a:x:D1', userId: '@mindroom_a:x', deviceId: 'D1', curveKey: 'c1' },
        { id: '@mindroom_b:x:D2', userId: '@mindroom_b:x', deviceId: 'D2', curveKey: 'c2' },
      ],
      selectedRuntimeId: '@mindroom_a:x:D1',
    });
    renderPage(multi);

    const select = container.querySelector<HTMLSelectElement>('select[aria-label="Runtime"]')!;
    expect(select.options).toHaveLength(2);
    act(() => {
      select.value = '@mindroom_b:x:D2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(multi.selectRuntime).toHaveBeenCalledWith('@mindroom_b:x:D2');

    const unavailable = makeUsageState({ snapshot: undefined, available: false });
    renderPage(unavailable);
    expect(container.querySelector('[data-testid="usage-unavailable"]')).not.toBeNull();
    const retry = [...container.querySelectorAll<HTMLButtonElement>('button')].find((b) =>
      b.textContent?.includes('Retry')
    )!;
    act(() => retry.click());
    expect(unavailable.refresh).toHaveBeenCalledWith(true);
  });

  it('shows Not signed in / Usage limits unavailable for subscription providers with empty windows while keeping uncapped metered accounts out of quotas', () => {
    const snapshot = cloneFixture();
    snapshot.accounts = [
      {
        ...snapshot.accounts[1]!,
        id: 'codex:not-signed-in',
        provider: 'codex',
        display_name: 'Codex',
        windows: [],
        unavailable_reason: 'not_signed_in',
      },
      {
        ...snapshot.accounts[0]!,
        id: 'claude_code:probe-failed',
        provider: 'claude_code',
        display_name: 'Claude Code',
        windows: [],
        unavailable_reason: 'probe_failed',
      },
      {
        ...snapshot.accounts[0]!,
        id: 'claude_code:empty-null',
        provider: 'claude_code',
        display_name: 'Claude Code',
        account_label: 'Alt',
        windows: [],
        unavailable_reason: null,
      },
      {
        ...snapshot.accounts[2]!,
        id: 'openrouter:uncapped',
        provider: 'openrouter',
        display_name: 'OpenRouter',
        account_label: null,
        plan: null,
        windows: [],
        unavailable_reason: null,
      },
    ];
    renderPage(makeUsageState({ snapshot }));

    expect(
      container.querySelector('[data-account-card="codex:not-signed-in"]')?.textContent
    ).toContain('Not signed in');
    expect(
      container.querySelector('[data-account-card="claude_code:probe-failed"]')?.textContent
    ).toContain('Usage limits unavailable');
    expect(
      container.querySelector('[data-account-card="claude_code:empty-null"]')?.textContent
    ).toContain('Usage limits unavailable');
    expect(container.querySelector('[data-account-card="openrouter:uncapped"]')).toBeNull();
    expect(container.textContent).not.toContain('No subscription limit');
  });

  it('disambiguates colliding account names and assigns distinct colors across cards, day detail, and Accounts breakdown', () => {
    const snapshot = makeMinimalV1();
    const or1 = snapshot.accounts[2]!;
    const or2 = {
      ...JSON.parse(JSON.stringify(or1)),
      id: 'openrouter:2',
      tokens_7d: 3_100_000,
    };
    snapshot.accounts = [or1, or2];
    snapshot.daily_7d = [
      {
        day: '2026-11-17',
        by_account: { 'openrouter:1': 900_000, 'openrouter:2': 400_000 },
        unattributed_tokens: 0,
      },
    ];
    renderPage(makeUsageState({ snapshot }));

    expect(container.querySelector('[data-account-card="openrouter:1"]')?.textContent).toContain(
      'OpenRouter · #1'
    );
    expect(container.querySelector('[data-account-card="openrouter:2"]')?.textContent).toContain(
      'OpenRouter · #2'
    );

    const dayDetail = container.querySelector('[data-testid="day-detail-drawer"]')!;
    expect(dayDetail.querySelector('[data-day-account="openrouter:1"]')?.textContent).toContain(
      'OpenRouter · #1'
    );
    expect(dayDetail.querySelector('[data-day-account="openrouter:2"]')?.textContent).toContain(
      'OpenRouter · #2'
    );
    const dot1 = dayDetail.querySelector<HTMLElement>(
      '[data-day-account="openrouter:1"] span[aria-hidden="true"]'
    )?.style.backgroundColor;
    const dot2 = dayDetail.querySelector<HTMLElement>(
      '[data-day-account="openrouter:2"] span[aria-hidden="true"]'
    )?.style.backgroundColor;
    expect(dot1).toBeTruthy();
    expect(dot2).toBeTruthy();
    expect(dot1).not.toBe(dot2);

    const breakdown = container.querySelector('[data-testid="where-usage-goes"]')!;
    expect(breakdown.textContent).toContain('OpenRouter · #1');
    expect(breakdown.textContent).toContain('OpenRouter · #2');

    const fullFixture = cloneFixture();
    const used = new Set<string>();
    const allocated = fullFixture.accounts.map((a, idx) => accountChartColor(a, idx, used));
    expect(new Set(allocated).size).toBe(fullFixture.accounts.length);
  });

  it('updates reset countdowns and pace ticks on a 2-hour-old snapshot using an independent minute clock', () => {
    vi.setSystemTime(new Date('2026-11-23T22:00:00Z'));
    const snapshot = cloneFixture();
    snapshot.checked_at = '2026-11-23T20:00:00Z';
    snapshot.accounts[0]!.windows[0]!.resets_at = '2026-11-23T22:05:00Z';
    renderPage(makeUsageState({ snapshot }));

    const claudeCard = () => container.querySelector('[data-account-card="claude_code:default"]')!;
    expect(claudeCard().textContent).toContain('Resets in 5m');

    act(() => {
      vi.advanceTimersByTime(2 * 60_000);
    });
    expect(claudeCard().textContent).toContain('Resets in 3m');

    act(() => {
      vi.advanceTimersByTime(4 * 60_000);
    });
    expect(claudeCard().textContent).toContain('Resets soon');
    const firstTick = claudeCard().querySelector<HTMLElement>('[data-pace-tick]')!;
    expect(firstTick.style.insetInlineStart).toBe('0%');

    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });

  it('maps model keys unambiguously and formats locale-aware percentages', () => {
    const { accounts } = cloneFixture();
    expect(singleAccountForModels(accounts, ['opus_native', 'sonnet_native'])?.id).toBe(
      'claude_code:default'
    );
    expect(singleAccountForModels(accounts, [])).toBeUndefined();
    expect(singleAccountForModels(accounts, ['opus_native', 'haiku'])).toBeUndefined();
    expect(singleAccountForModels(accounts, ['opus_native', 'unknown'])).toBeUndefined();

    expect(formatWholePercent(62, 'en')).toBe('62%');
    expect(formatWholePercent(62, 'tr')).toBe('%62');
    expect(formatWholePercent(62, 'fr')).toBe('62\u00a0%');
  });

  it('renders loading, empty-accounts, empty-daily, zero-day, and zero-mix states cleanly', () => {
    renderPage(makeUsageState({ snapshot: undefined, available: false, loading: true }));
    expect(container.textContent).toContain('Checking provider usage');

    const empty = makeMinimalV1();
    empty.accounts = [];
    empty.daily_7d = [];
    renderPage(makeUsageState({ snapshot: empty }));
    expect(container.textContent).toContain('No provider accounts reported yet.');

    const noDaily = cloneFixture();
    noDaily.daily_7d = [];
    noDaily.token_mix_7d = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_tokens: 0,
      cache_write_tokens: 0,
    };
    noDaily.cache_savings_usd_7d = 0;
    renderPage(makeUsageState({ snapshot: noDaily }));
    expect(container.querySelector('[data-testid="token-mix-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="cache-savings-badge"]')).toBeNull();
    expect(container.querySelector('[data-testid="daily-activity-card"]')?.textContent).toContain(
      'No daily usage recorded in the last 7 days.'
    );
    expect(container.querySelector('[data-testid="day-detail-drawer"]')).toBeNull();

    // Selecting a zero-activity day shows a quiet empty-day message in the drawer.
    const withZeroDay = cloneFixture();
    withZeroDay.daily_7d.unshift({
      day: '2026-11-16',
      by_account: {},
      unattributed_tokens: 0,
      cost_by_account: {},
      unattributed_cost_usd: 0,
    });
    renderPage(makeUsageState({ snapshot: withZeroDay }));
    const zeroDayBtn = container.querySelector<HTMLButtonElement>('button[data-day="2026-11-16"]')!;
    act(() => zeroDayBtn.click());
    expect(container.querySelector('[data-testid="day-detail-drawer"]')?.textContent).toContain(
      'No usage recorded on this day.'
    );
  });

  it('falls back cleanly when switching from a rich runtime snapshot to a minimal v1 snapshot and formats compact USD', () => {
    const rich = cloneFixture();
    rich.daily_7d[0]!.cost_by_account!['anthropic:default'] = 0.4;
    rich.daily_7d[1]!.cost_by_account!['anthropic:default'] = 0.35;
    renderPage(makeUsageState({ snapshot: rich }));
    act(() => findTab('Agents')!.click());
    expect(findTab('Agents')?.getAttribute('aria-selected')).toBe('true');

    // Click an earlier day and hide dominant before switching to a minimal snapshot.
    act(() => {
      container.querySelector<HTMLButtonElement>('button[data-day="2026-11-17"]')!.click();
    });
    act(() => {
      container.querySelector<HTMLButtonElement>('[data-testid="hide-dominant-btn"]')!.click();
    });

    // Switch to a minimal snapshot with different dates and no Agents/Models/cost data.
    const minimal = makeMinimalV1();
    minimal.daily_7d = [
      { day: '2026-11-20', by_account: { 'claude_code:default': 500_000 }, unattributed_tokens: 0 },
    ];
    renderPage(makeUsageState({ snapshot: minimal }));

    expect(findTab('Accounts')?.getAttribute('aria-selected')).toBe('true');
    expect(container.querySelector('[data-testid="daily-activity-card"]')?.textContent).toContain(
      'Daily tokens'
    );
    expect(
      container
        .querySelector('button[data-day="2026-11-20"]')
        ?.getAttribute('aria-pressed')
    ).toBe('true');
    expect(container.querySelector('[data-testid="hide-dominant-btn"]')).toBeNull();

    // Also verifies pace legend hides when only untimed credit-limit windows are shown.
    const creditOnly = cloneFixture();
    creditOnly.accounts = [creditOnly.accounts[2]!];
    renderPage(makeUsageState({ snapshot: creditOnly }));
    expect(
      container.querySelector('[data-testid="subscription-quotas-section"]')?.textContent
    ).not.toContain('Tick = even-pace target');

    expect(formatShortUsd(0, 'en')).toBe('$0');
    expect(formatShortUsd(3.24, 'en')).toBe('$3.2');
    expect(formatShortUsd(48.4, 'en')).toBe('$48');
    expect(formatShortUsd(1600, 'en')).toBe('$1.6K');
  });
});
