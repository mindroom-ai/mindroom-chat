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

const stripOptionalFields = (snapshot: ProviderUsageSnapshot): ProviderUsageSnapshot => {
  const minimal = clone(snapshot);
  delete minimal.token_mix_7d;
  delete minimal.cache_savings_usd_7d;
  delete minimal.top_models_7d;
  delete minimal.top_agents_7d;
  for (const account of minimal.accounts) delete account.token_mix_7d;
  for (const day of minimal.daily_7d) {
    delete day.cost_by_account;
    delete day.unattributed_cost_usd;
  }
  return minimal;
};

describe('providerUsageProtocol', () => {
  it('exports locked wire event constants', () => {
    expect(USAGE_REQUEST).toBe('io.mindroom.usage.request');
    expect(USAGE_RESPONSE).toBe('io.mindroom.usage.response');
  });

  it('parses the locked contract fixture with additive v1 fields verbatim', () => {
    const parsed = parseProviderUsageResponse(contractFixture);
    expect(parsed).toEqual(contractFixture);
    expect(parsed?.accounts).toHaveLength(4);
    expect(parsed?.accounts[3]?.windows).toEqual([]);
    expect(parsed?.token_mix_7d?.cache_read_tokens).toBe(22050000);
    expect(parsed?.cache_savings_usd_7d).toBe(14.6);
    expect(parsed?.top_models_7d).toHaveLength(4);
    expect(parsed?.top_agents_7d).toHaveLength(3);
    expect(parsed?.daily_7d[0]?.cost_by_account?.['openrouter:1']).toBe(9.5);
    expect(hasLowQuotaInSnapshot(parsed!)).toBe(true);
  });

  it('remains backwards compatible with minimal v1 snapshots and nullable optional fields', () => {
    const minimal = stripOptionalFields(clone());
    const parsedMinimal = parseProviderUsageResponse(minimal);
    expect(parsedMinimal).toEqual(minimal);
    expect(parsedMinimal?.token_mix_7d).toBeUndefined();
    expect(parsedMinimal?.top_models_7d).toBeUndefined();
    expect(parsedMinimal?.top_agents_7d).toBeUndefined();

    const withNulls = clone() as Record<string, unknown>;
    withNulls.token_mix_7d = null;
    withNulls.cache_savings_usd_7d = null;
    withNulls.top_models_7d = null;
    withNulls.top_agents_7d = null;
    (withNulls.accounts as Record<string, unknown>[])[0]!.token_mix_7d = null;
    (withNulls.daily_7d as Record<string, unknown>[])[0]!.cost_by_account = null;
    (withNulls.daily_7d as Record<string, unknown>[])[0]!.unattributed_cost_usd = null;

    const parsedNulls = parseProviderUsageResponse(withNulls);
    expect(parsedNulls).toBeDefined();
    expect(parsedNulls?.token_mix_7d).toBeUndefined();
    expect(parsedNulls?.cache_savings_usd_7d).toBeNull();
    expect(parsedNulls?.top_models_7d).toBeUndefined();
    expect(parsedNulls?.top_agents_7d).toBeUndefined();
    expect(parsedNulls?.accounts[0]?.token_mix_7d).toBeUndefined();
    expect(parsedNulls?.daily_7d[0]?.cost_by_account).toBeUndefined();
    expect(parsedNulls?.daily_7d[0]?.unattributed_cost_usd).toBeNull();
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

  it('validates additive TokenMix, daily costs, top_models_7d, and top_agents_7d strictly', () => {
    const badMix = clone();
    badMix.token_mix_7d!.cache_read_tokens = -1;
    expect(parseProviderUsageResponse(badMix)).toBeUndefined();

    const badAccountMix = clone();
    badAccountMix.accounts[0]!.token_mix_7d!.output_tokens = Number.POSITIVE_INFINITY;
    expect(parseProviderUsageResponse(badAccountMix)).toBeUndefined();

    const negSavings = clone();
    negSavings.cache_savings_usd_7d = -0.5;
    expect(parseProviderUsageResponse(negSavings)).toBeUndefined();

    const unsafeDailyCost = clone();
    unsafeDailyCost.daily_7d[0]!.cost_by_account!['prototype'] = 1;
    expect(parseProviderUsageResponse(unsafeDailyCost)).toBeUndefined();

    const negDailyUnattrCost = clone();
    negDailyUnattrCost.daily_7d[0]!.unattributed_cost_usd = -2;
    expect(parseProviderUsageResponse(negDailyUnattrCost)).toBeUndefined();

    const tooManyModels = clone();
    tooManyModels.top_models_7d = Array.from({ length: 33 }, (_, i) => ({
      provider: 'openrouter',
      model: `sample-model-${i}`,
      tokens_7d: 100,
      cost_usd_7d: 0.1,
      run_count: 1,
    }));
    expect(parseProviderUsageResponse(tooManyModels)).toBeUndefined();

    const badModelSpark = clone();
    badModelSpark.top_models_7d![0]!.daily_tokens_7d = [100, -5];
    expect(parseProviderUsageResponse(badModelSpark)).toBeUndefined();

    const tooManyAgents = clone();
    tooManyAgents.top_agents_7d = Array.from({ length: 33 }, (_, i) => ({
      entity: `agent_${i}`,
      tokens_7d: 100,
      cost_usd_7d: null,
      run_count: 2,
    }));
    expect(parseProviderUsageResponse(tooManyAgents)).toBeUndefined();

    const badAgentRuns = clone();
    badAgentRuns.top_agents_7d![0]!.run_count = -3;
    expect(parseProviderUsageResponse(badAgentRuns)).toBeUndefined();
  });

  it('parses valid unavailable_reason values and rejects unknown values', () => {
    for (const reason of ['unsupported', 'not_signed_in', 'probe_failed', null] as const) {
      const payload = clone(contractFixture);
      payload.accounts[3]!.unavailable_reason = reason;
      const parsed = parseProviderUsageResponse(payload);
      expect(parsed?.accounts[3]?.unavailable_reason).toBe(reason);
    }

    const invalid = clone(contractFixture);
    (invalid.accounts[3] as Record<string, unknown>).unavailable_reason = 'unknown_reason';
    expect(parseProviderUsageResponse(invalid)).toBeUndefined();
  });
});

describe('providerUsageProtocol edge cases', () => {
  it('validates boundary sizes for top_models_7d (32), top_agents_7d (32), and daily_tokens_7d (31)', () => {
    const validBoundary = clone();
    validBoundary.top_models_7d = Array.from({ length: 32 }, (_, i) => ({
      provider: 'openrouter',
      model: `m-${i}`,
      account_id: i % 2 === 0 ? 'openrouter:1' : null,
      tokens_7d: i * 1000,
      cost_usd_7d: i % 2 === 0 ? i * 0.1 : null,
      run_count: i,
      daily_tokens_7d: Array.from({ length: 31 }, () => 10),
    }));
    validBoundary.top_agents_7d = Array.from({ length: 32 }, (_, i) => ({
      entity: `agent_${i}`,
      tokens_7d: i * 500,
      cost_usd_7d: null,
      run_count: i,
      daily_tokens_7d: [1, 2, 3],
    }));
    const parsed = parseProviderUsageResponse(validBoundary);
    expect(parsed?.top_models_7d).toHaveLength(32);
    expect(parsed?.top_agents_7d).toHaveLength(32);
    expect(parsed?.top_models_7d?.[0]?.daily_tokens_7d).toHaveLength(31);

    const tooLongSpark = clone();
    tooLongSpark.top_agents_7d![0]!.daily_tokens_7d = Array.from({ length: 32 }, () => 1);
    expect(parseProviderUsageResponse(tooLongSpark)).toBeUndefined();
  });

  it('rejects malformed optional fields on models, agents, and daily cost maps', () => {
    const badModelProvider = clone();
    badModelProvider.top_models_7d![0]!.provider = '';
    expect(parseProviderUsageResponse(badModelProvider)).toBeUndefined();

    const badModelAccountId = clone();
    (badModelAccountId.top_models_7d![0] as Record<string, unknown>).account_id = 42;
    expect(parseProviderUsageResponse(badModelAccountId)).toBeUndefined();

    const badAgentMix = clone();
    (badAgentMix.top_agents_7d![0] as Record<string, unknown>).token_mix_7d = 'bad';
    expect(parseProviderUsageResponse(badAgentMix)).toBeUndefined();

    const badDailyCostMap = clone();
    (badDailyCostMap.daily_7d[0] as Record<string, unknown>).cost_by_account = {
      'openrouter:1': -0.01,
    };
    expect(parseProviderUsageResponse(badDailyCostMap)).toBeUndefined();

    const missingMixField = clone();
    delete (missingMixField.token_mix_7d as Record<string, unknown>).input_tokens;
    expect(parseProviderUsageResponse(missingMixField)).toBeUndefined();
  });
});
