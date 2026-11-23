// @vitest-environment jsdom

import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import contractFixture from './__fixtures__/providerUsageContract.json';
import { ScreenSize, ScreenSizeProvider } from '../lib/hooks/useScreenSize';
import type { ProviderUsageSnapshot } from './providerUsageProtocol';
import { singleAccountForModels } from './QuotaBar';
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
});
