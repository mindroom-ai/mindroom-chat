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

describe('UsagePage & QuotaBar', () => {
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

  it('renders Limits cards, pace ticks, PAYG without 100% left, and stale badge', () => {
    const snapshot = cloneFixture();
    snapshot.accounts[0]!.stale = true;
    const usage = makeUsageState({ snapshot });
    renderPage(usage);

    expect(usage.ensureLoaded).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll('[data-account-card]')).toHaveLength(4);
    // Pace ticks appear for timed windows (4 across Claude Code & Codex), omitted for OpenRouter credit limit.
    expect(container.querySelectorAll('[data-pace-tick]')).toHaveLength(4);

    const claudeCard = container.querySelector('[data-account-card="claude_code:default"]')!;
    expect(claudeCard.querySelector('[data-stale-badge]')).not.toBeNull();
    expect(claudeCard.textContent).toContain('62% left');
    expect(claudeCard.textContent).toContain('Resets in 2h 24m');

    const paygCard = container.querySelector('[data-account-card="anthropic:default"]')!;
    expect(paygCard.textContent).toContain('Pay-as-you-go');
    expect(paygCard.textContent).toContain('No subscription limit');
    expect(paygCard.textContent).not.toContain('100% left');

    const refreshButton = container.querySelector(
      'button[aria-label="Refresh"]'
    ) as HTMLButtonElement;
    act(() => refreshButton.click());
    expect(usage.refresh).toHaveBeenCalledWith(true);
  });

  it('spans the odd last card full-width on desktop and stacks single-column on phone', () => {
    const snapshot = cloneFixture();
    snapshot.accounts = snapshot.accounts.slice(0, 3);
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
  });

  it('renders Tokens & Cost tab with daily chart, partial notice, and conditional Unattributed row', () => {
    const snapshot = cloneFixture();
    renderPage(makeUsageState({ snapshot }));

    const tokensTab = [...container.querySelectorAll('[role="tab"]')].find((el) =>
      el.textContent?.includes('Tokens & Cost')
    ) as HTMLButtonElement;
    act(() => tokensTab.click());

    expect(container.querySelector('[data-testid="usage-tokens-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="daily-usage-chart"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="unattributed-row"]')).toBeNull();
    expect(container.querySelector('[data-testid="partial-data-notice"]')).toBeNull();

    const withUnattributed = cloneFixture();
    withUnattributed.partial = true;
    withUnattributed.unattributed_tokens_7d = 500_000;
    withUnattributed.daily_7d[0]!.unattributed_tokens = 500_000;
    renderPage(makeUsageState({ snapshot: withUnattributed }));

    expect(container.querySelector('[data-testid="partial-data-notice"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="unattributed-row"]')).not.toBeNull();
  });

  it('renders runtime switcher only when multiple runtimes answered', () => {
    const usage = makeUsageState({
      runtimes: [
        { id: '@mindroom_a:x:D1', userId: '@mindroom_a:x', deviceId: 'D1', curveKey: 'c1' },
        { id: '@mindroom_b:x:D2', userId: '@mindroom_b:x', deviceId: 'D2', curveKey: 'c2' },
      ],
      selectedRuntimeId: '@mindroom_a:x:D1',
    });
    renderPage(usage);

    const select = container.querySelector('select[aria-label="Runtime"]') as HTMLSelectElement;
    expect(select).not.toBeNull();
    expect(select.options).toHaveLength(2);
    act(() => {
      select.value = '@mindroom_b:x:D2';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(usage.selectRuntime).toHaveBeenCalledWith('@mindroom_b:x:D2');
  });

  it('shows quiet unavailable state with Retry when no runtime answered', () => {
    const usage = makeUsageState({ snapshot: undefined, available: false });
    renderPage(usage);

    expect(container.querySelector('[data-testid="usage-unavailable"]')).not.toBeNull();
    const retry = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Retry')
    ) as HTMLButtonElement;
    act(() => retry.click());
    expect(usage.refresh).toHaveBeenCalledWith(true);
  });

  it('maps model keys to a single account only when unambiguous', () => {
    const { accounts } = cloneFixture();
    expect(singleAccountForModels(accounts, ['opus_native', 'sonnet_native'])?.id).toBe(
      'claude_code:default'
    );
    expect(singleAccountForModels(accounts, [])).toBeUndefined();
    expect(singleAccountForModels(accounts, ['opus_native', 'haiku'])).toBeUndefined();
    expect(singleAccountForModels(accounts, ['opus_native', 'unknown'])).toBeUndefined();
  });

  it('renders clear unavailable/not-signed-in notices for unavailable_reason instead of No subscription limit', () => {
    const snapshot = cloneFixture();
    snapshot.accounts = [
      {
        ...snapshot.accounts[3]!,
        id: 'codex:not-signed-in',
        provider: 'codex',
        display_name: 'Codex',
        windows: [],
        unavailable_reason: 'not_signed_in',
      },
      {
        ...snapshot.accounts[3]!,
        id: 'claude_code:probe-failed',
        provider: 'claude_code',
        display_name: 'Claude Code',
        windows: [],
        unavailable_reason: 'probe_failed',
      },
    ];
    renderPage(makeUsageState({ snapshot }));

    const notSignedCard = container.querySelector('[data-account-card="codex:not-signed-in"]')!;
    expect(notSignedCard.querySelector('[data-unavailable-reason="not_signed_in"]')).not.toBeNull();
    expect(notSignedCard.textContent).toContain('Not signed in');
    expect(notSignedCard.textContent).not.toContain('No subscription limit');
    expect(notSignedCard.textContent).not.toContain('100% left');

    const failedCard = container.querySelector('[data-account-card="claude_code:probe-failed"]')!;
    expect(failedCard.querySelector('[data-unavailable-reason="probe_failed"]')).not.toBeNull();
    expect(failedCard.textContent).toContain('Usage limits unavailable');
    expect(failedCard.textContent).not.toContain('No subscription limit');
    expect(failedCard.textContent).not.toContain('100% left');
  });

  it('renders Usage limits unavailable instead of No subscription limit for codex/claude_code accounts with empty windows and null unavailable_reason', () => {
    const snapshot = cloneFixture();
    snapshot.accounts = [
      {
        ...snapshot.accounts[1]!,
        id: 'codex:empty-windows',
        provider: 'codex',
        display_name: 'Codex',
        account_label: null,
        plan: 'plus',
        windows: [],
        unavailable_reason: null,
      },
      {
        ...snapshot.accounts[0]!,
        id: 'claude_code:empty-windows',
        provider: 'claude_code',
        display_name: 'Claude Code',
        account_label: null,
        plan: 'max',
        windows: [],
        unavailable_reason: undefined,
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

    const codexCard = container.querySelector('[data-account-card="codex:empty-windows"]')!;
    expect(codexCard.textContent).toContain('Usage limits unavailable');
    expect(codexCard.textContent).not.toContain('No subscription limit');
    expect(codexCard.querySelector('[data-no-limit]')).toBeNull();

    const claudeCard = container.querySelector('[data-account-card="claude_code:empty-windows"]')!;
    expect(claudeCard.textContent).toContain('Usage limits unavailable');
    expect(claudeCard.textContent).not.toContain('No subscription limit');
    expect(claudeCard.querySelector('[data-no-limit]')).toBeNull();

    const openRouterCard = container.querySelector('[data-account-card="openrouter:uncapped"]')!;
    expect(openRouterCard.textContent).toContain('No subscription limit');
    expect(openRouterCard.querySelector('[data-no-limit]')).not.toBeNull();
  });

  it('disambiguates colliding same-provider account names across cards, chart legend, and table', () => {
    const snapshot = cloneFixture();
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

    const tokensTab = [...container.querySelectorAll('[role="tab"]')].find((el) =>
      el.textContent?.includes('Tokens & Cost')
    ) as HTMLButtonElement;
    act(() => tokensTab.click());

    expect(container.querySelector('[data-legend-account="openrouter:1"]')?.textContent).toContain(
      'OpenRouter · #1'
    );
    expect(container.querySelector('[data-legend-account="openrouter:2"]')?.textContent).toContain(
      'OpenRouter · #2'
    );
    const tableText = container.querySelector('table')?.textContent ?? '';
    expect(tableText).toContain('OpenRouter · #1');
    expect(tableText).toContain('OpenRouter · #2');
  });

  it('updates reset countdowns and pace ticks past reset on a 2-hour-old snapshot using an independent minute clock', () => {
    // Snapshot was checked 2 hours ago (when useRelativeTime no longer ticks every minute).
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
    const firstTick = claudeCard().querySelector('[data-pace-tick]') as HTMLElement;
    expect(firstTick.style.insetInlineStart).toBe('0%');

    // Unmounting clears the countdown interval.
    act(() => root.unmount());
    expect(vi.getTimerCount()).toBe(0);
    root = createRoot(container);
  });

  it('assigns distinct chart and legend colors to every account in providerUsageContract.json', () => {
    const snapshot = cloneFixture();
    const used = new Set<string>();
    const allocated = snapshot.accounts.map((account, index) =>
      accountChartColor(account, index, used)
    );
    expect(new Set(allocated).size).toBe(snapshot.accounts.length);

    renderPage(makeUsageState({ snapshot }));
    const tokensTab = [...container.querySelectorAll('[role="tab"]')].find((el) =>
      el.textContent?.includes('Tokens & Cost')
    ) as HTMLButtonElement;
    act(() => tokensTab.click());

    const legendColors = snapshot.accounts.map((account) => {
      const dot = container.querySelector<HTMLElement>(
        `[data-legend-account="${account.id}"] span[aria-hidden="true"]`
      );
      return dot?.style.backgroundColor ?? '';
    });
    expect(legendColors.every(Boolean)).toBe(true);
    expect(new Set(legendColors).size).toBe(snapshot.accounts.length);
  });

  it('formats inline percentages using locale-aware Intl.NumberFormat', () => {
    expect(formatWholePercent(62, 'en')).toBe('62%');
    expect(formatWholePercent(62, 'tr')).toBe('%62');
    expect(formatWholePercent(62, 'fr')).toBe('62\u00a0%');
  });
});
