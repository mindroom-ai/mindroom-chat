import { describe, expect, it } from 'vitest';
import {
  formatMindroomAiRunNumber,
  formatMindroomAiRunTimeToFirstToken,
  getMindroomAiRunContextLabel,
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
