import { describe, expect, it } from 'vitest';
import contractFixture from './__fixtures__/providerUsageContract.json';
import {
  hasLowQuotaInSnapshot,
  parseProviderUsageResponse,
  type ProviderUsageSnapshot,
  USAGE_REQUEST,
  USAGE_RESPONSE,
} from './providerUsageProtocol';

const clone = (value: unknown = contractFixture): ProviderUsageSnapshot =>
  JSON.parse(JSON.stringify(value)) as ProviderUsageSnapshot;

describe('providerUsageProtocol', () => {
  it('exports locked wire event constants', () => {
    expect(USAGE_REQUEST).toBe('io.mindroom.usage.request');
    expect(USAGE_RESPONSE).toBe('io.mindroom.usage.response');
  });

  it('parses the locked contract fixture verbatim', () => {
    const parsed = parseProviderUsageResponse(contractFixture);
    expect(parsed).toEqual(contractFixture);
    expect(parsed?.accounts).toHaveLength(4);
    expect(parsed?.accounts[3]?.windows).toEqual([]);
    expect(hasLowQuotaInSnapshot(parsed!)).toBe(true);
  });

  it('detects when no window is below the 15% low-quota threshold', () => {
    const payload = clone(contractFixture);
    for (const account of payload.accounts) {
      for (const window of account.windows) {
        window.remaining_percent = 15;
        window.used_percent = 85;
      }
    }
    const parsed = parseProviderUsageResponse(payload);
    expect(parsed).toBeDefined();
    expect(hasLowQuotaInSnapshot(parsed!)).toBe(false);
  });

  it('rejects unsupported versions, malformed timestamps, and non-objects', () => {
    expect(parseProviderUsageResponse(null)).toBeUndefined();
    expect(parseProviderUsageResponse([])).toBeUndefined();

    const wrongVersion = clone(contractFixture);
    (wrongVersion as Record<string, unknown>).version = 2;
    expect(parseProviderUsageResponse(wrongVersion)).toBeUndefined();

    const badCheckedAt = clone(contractFixture);
    badCheckedAt.checked_at = 'not-a-date';
    expect(parseProviderUsageResponse(badCheckedAt)).toBeUndefined();

    const badDay = clone(contractFixture);
    badDay.daily_7d[0]!.day = '11/17/2026';
    expect(parseProviderUsageResponse(badDay)).toBeUndefined();
  });

  it('rejects out-of-range percentages, non-finite numbers, and negative totals', () => {
    const over = clone(contractFixture);
    over.accounts[0]!.windows[0]!.remaining_percent = 101;
    expect(parseProviderUsageResponse(over)).toBeUndefined();

    const negative = clone(contractFixture);
    negative.accounts[0]!.windows[0]!.used_percent = -0.1;
    expect(parseProviderUsageResponse(negative)).toBeUndefined();

    const nonFinite = clone(contractFixture);
    nonFinite.accounts[0]!.windows[0]!.remaining_percent = Number.NaN;
    expect(parseProviderUsageResponse(nonFinite)).toBeUndefined();

    const zeroDuration = clone(contractFixture);
    zeroDuration.accounts[0]!.windows[0]!.window_duration_mins = 0;
    expect(parseProviderUsageResponse(zeroDuration)).toBeUndefined();

    const negTokens = clone(contractFixture);
    negTokens.accounts[0]!.tokens_7d = -5;
    expect(parseProviderUsageResponse(negTokens)).toBeUndefined();

    const negCost = clone(contractFixture);
    negCost.accounts[2]!.cost_usd_7d = -1;
    expect(parseProviderUsageResponse(negCost)).toBeUndefined();
  });

  it('rejects oversized payloads (> 65536 bytes), duplicate ids, and unsafe keys', () => {
    const oversized = clone(contractFixture);
    oversized.accounts[0]!.model_keys = Array.from(
      { length: 100 },
      (_, i) => `m-${i}-${'x'.repeat(700)}`
    );
    expect(parseProviderUsageResponse(oversized)).toBeUndefined();

    const dupAccount = clone(contractFixture);
    dupAccount.accounts.push({ ...dupAccount.accounts[0]! });
    expect(parseProviderUsageResponse(dupAccount)).toBeUndefined();

    const unsafeDaily = clone(contractFixture);
    unsafeDaily.daily_7d[0]!.by_account['constructor'] = 10;
    expect(parseProviderUsageResponse(unsafeDaily)).toBeUndefined();
  });
});
