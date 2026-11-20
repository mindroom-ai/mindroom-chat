import { createInstance, type TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import en from '../i18n/englishResources';
import { runTotals, usageTexts } from './runUsage';

let t: TFunction;

beforeAll(async () => {
  const language = createInstance();
  await language.init({ lng: 'en', resources: { en: { translation: en } } });
  t = language.t;
});

describe('runTotals', () => {
  it('sums what the runs used, leaving out what none sent', () => {
    expect(runTotals([undefined, undefined])).toEqual({});
    expect(
      runTotals([
        { inputTokens: 1_000, outputTokens: 200, toolCalls: 7, costUsd: 0.5 },
        { inputTokens: 0, outputTokens: 0, toolCalls: 2 },
        { inputTokens: 250, outputTokens: 50, toolCalls: 1, costUsd: 0.25 },
      ])
    ).toEqual({ calls: 10, tokens: 1_500, inputTokens: 1_250, outputTokens: 250, costUsd: 0.75 });
  });

  it('leaves the cost out while a run that used tokens sent none, so it never undercounts', () => {
    expect(
      runTotals([
        { inputTokens: 1_000, outputTokens: 200, toolCalls: 7, costUsd: 0.5 },
        { inputTokens: 300, outputTokens: 0, toolCalls: 2 },
      ])
    ).toEqual({ calls: 9, tokens: 1_500, inputTokens: 1_300, outputTokens: 200 });
  });

  it('leaves the cost out while a run sent nothing of what it used', () => {
    expect(
      runTotals([{ inputTokens: 1_000, outputTokens: 200, toolCalls: 7, costUsd: 0.5 }, undefined])
    ).toEqual({ calls: 7, tokens: 1_200, inputTokens: 1_000, outputTokens: 200 });
  });
});

describe('usageTexts', () => {
  it('says each count bare and in words, leaving out none and a cost before any token', () => {
    expect(usageTexts({ calls: 34, tokens: 1_424_000, costUsd: 1.3 }, t, 'en')).toEqual({
      calls: { compact: '34', labelled: '34 calls' },
      tokens: { compact: '1.4M', labelled: '1.4M tokens' },
      cost: { compact: '$1.30', labelled: '$1.30' },
    });
    expect(usageTexts({ calls: 0, tokens: 0, costUsd: 0 }, t, 'en')).toEqual({});
    expect(usageTexts({}, t, 'en')).toEqual({});
  });
});
