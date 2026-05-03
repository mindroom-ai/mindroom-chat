import { describe, expect, it } from 'vitest';
import {
  formatMindroomAiRunNumber,
  formatMindroomAiRunTimeToFirstToken,
  getMindroomAiRunContextBarSegments,
  getMindroomAiRunContextCacheLabel,
  getMindroomAiRunContextLabel,
  getMindroomAiRunUsageCacheLabel,
  getMindroomAiRunModelLabel,
  getMindroomAiRunUsageLabel,
} from './aiRunDisplay';

describe('getMindroomAiRunModelLabel', () => {
  it('combines config, provider, and model id when present', () => {
    expect(
      getMindroomAiRunModelLabel({
        modelConfig: 'default',
        modelProvider: 'openai',
        modelId: 'gpt-4.1-mini',
      })
    ).toBe('default (openai / gpt-4.1-mini)');
  });

  it('falls back cleanly when only partial model information exists', () => {
    expect(getMindroomAiRunModelLabel({ modelConfig: 'default' })).toBe('default');
    expect(
      getMindroomAiRunModelLabel({
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet',
      })
    ).toBe('anthropic / claude-sonnet');
  });
});

describe('getMindroomAiRunUsageLabel', () => {
  it('formats token counts in a compact summary', () => {
    expect(
      getMindroomAiRunUsageLabel({
        inputTokens: 1024,
        outputTokens: 256,
        totalTokens: 1280,
      })
    ).toBe('in 1,024 • out 256 • total 1,280');
  });

  it('returns undefined when no usage values are present', () => {
    expect(getMindroomAiRunUsageLabel({})).toBeUndefined();
  });
});

describe('getMindroomAiRunUsageCacheLabel', () => {
  it('formats cumulative run cache counters separately from token totals', () => {
    expect(
      getMindroomAiRunUsageCacheLabel({
        cacheReadTokens: 20000,
        cacheWriteTokens: 500,
      })
    ).toBe('read 20,000 • write 500');
  });

  it('returns undefined when no cumulative cache counters are present', () => {
    expect(getMindroomAiRunUsageCacheLabel({})).toBeUndefined();
  });
});

describe('getMindroomAiRunContextLabel', () => {
  it('formats context usage with a percentage', () => {
    expect(
      getMindroomAiRunContextLabel({
        contextInputTokens: 500,
        contextWindowTokens: 2000,
      })
    ).toBe('500 / 2,000 (25.0%)');
  });

  it('returns undefined for incomplete or invalid context values', () => {
    expect(getMindroomAiRunContextLabel({ contextInputTokens: 10 })).toBeUndefined();
    expect(
      getMindroomAiRunContextLabel({
        contextInputTokens: 10,
        contextWindowTokens: 0,
      })
    ).toBeUndefined();
  });
});

describe('getMindroomAiRunContextCacheLabel', () => {
  it('formats latest-request cache and non-cache-read context counters', () => {
    expect(
      getMindroomAiRunContextCacheLabel({
        contextCacheReadInputTokens: 9000,
        contextCacheWriteInputTokens: 10,
        contextUncachedInputTokens: 130,
      })
    ).toBe('read 9,000 • write 10 • not read 130');
  });

  it('returns undefined when no latest-request cache counters are present', () => {
    expect(getMindroomAiRunContextCacheLabel({})).toBeUndefined();
  });
});

describe('getMindroomAiRunContextBarSegments', () => {
  it('maps latest-request cache, new input, and reserve to context-window bar segments', () => {
    expect(
      getMindroomAiRunContextBarSegments({
        contextInputTokens: 65,
        contextWindowTokens: 100,
        contextCacheReadInputTokens: 20,
        contextCacheWriteInputTokens: 5,
        contextUncachedInputTokens: 45,
      })
    ).toEqual([
      {
        key: 'cacheRead',
        label: 'Cache read',
        tokens: 20,
        percentage: 20,
        title: 'Cache read: 20 tokens (20.0% of window)',
      },
      {
        key: 'newInput',
        label: 'New input',
        tokens: 45,
        percentage: 45,
        title: 'New input: 45 tokens (45.0% of window); cache write: 5 tokens',
      },
      {
        key: 'reserve',
        label: 'Reserve',
        tokens: 35,
        percentage: 35,
        title: 'Reserve: 35 tokens (35.0% of window)',
      },
    ]);
  });

  it('returns undefined when required context-window values are missing or inconsistent', () => {
    expect(getMindroomAiRunContextBarSegments({ contextInputTokens: 65 })).toBeUndefined();
    expect(
      getMindroomAiRunContextBarSegments({
        contextInputTokens: 120,
        contextWindowTokens: 100,
        contextCacheReadInputTokens: 20,
        contextUncachedInputTokens: 100,
      })
    ).toBeUndefined();
  });
});

describe('formatMindroomAiRunTimeToFirstToken', () => {
  it('formats positive values in milliseconds', () => {
    expect(formatMindroomAiRunTimeToFirstToken(0.42)).toBe('420 ms');
  });

  it('returns undefined for invalid ttft values', () => {
    expect(formatMindroomAiRunTimeToFirstToken(undefined)).toBeUndefined();
    expect(formatMindroomAiRunTimeToFirstToken(-1)).toBeUndefined();
  });
});

describe('formatMindroomAiRunNumber', () => {
  it('formats numbers with grouping separators', () => {
    expect(formatMindroomAiRunNumber(12345)).toBe('12,345');
  });
});
