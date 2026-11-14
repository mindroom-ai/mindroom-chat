import { describe, expect, it } from 'vitest';
import {
  formatAiRunNumber,
  formatAiRunPercentage,
  formatCostUsd,
  getAiRunTokenParts,
  formatAiRunTimeToFirstToken,
  getAiRunCompactModelLabel,
  getAiRunContextBarSegments,
  getAiRunContextLabel,
  getAiRunModelLabel,
} from './aiRunDisplay';

describe('getAiRunModelLabel', () => {
  it('combines config, provider, and model id when present', () => {
    expect(
      getAiRunModelLabel({
        modelConfig: 'default',
        modelProvider: 'openai',
        modelId: 'gpt-4.1-mini',
      })
    ).toBe('default (openai / gpt-4.1-mini)');
  });

  it('falls back cleanly when only partial model information exists', () => {
    expect(getAiRunModelLabel({ modelConfig: 'default' })).toBe('default');
    expect(
      getAiRunModelLabel({
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet',
      })
    ).toBe('anthropic / claude-sonnet');
  });
});

describe('getAiRunCompactModelLabel', () => {
  it.each(['custom_alias', 'default', undefined])(
    'prefers the display name over config %s and preserves its casing',
    (modelConfig) => {
      expect(
        getAiRunCompactModelLabel({
          modelDisplayName: 'my Friendly Model',
          modelConfig,
          modelId: 'another-model',
          modelProvider: 'openai',
        })
      ).toBe('my Friendly Model');
    }
  );

  it('prefers a friendly configured model name', () => {
    expect(
      getAiRunCompactModelLabel({
        modelConfig: 'opus',
        modelProvider: 'anthropic',
        modelId: 'claude-opus-4-6',
      })
    ).toBe('Opus');
    expect(getAiRunCompactModelLabel({ modelConfig: 'bedtime_fable' })).toBe(
      'Bedtime Fable'
    );
  });

  it('uses a concise model id when the config name is generic', () => {
    expect(
      getAiRunCompactModelLabel({
        modelConfig: 'default',
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-4-6',
      })
    ).toBe('Sonnet 4.6');
    expect(getAiRunCompactModelLabel({ modelProvider: 'openai', modelId: 'gpt-5.4' })).toBe(
      'GPT-5.4'
    );
  });

  it('drops latest aliases with and without a version number', () => {
    expect(
      getAiRunCompactModelLabel({
        modelProvider: 'anthropic',
        modelId: 'claude-sonnet-latest',
      })
    ).toBe('Sonnet');
    expect(
      getAiRunCompactModelLabel({
        modelProvider: 'anthropic',
        modelId: 'claude-opus-4-latest',
      })
    ).toBe('Opus 4');
  });
});

describe('getAiRunContextLabel', () => {
  it('formats context usage with a percentage', () => {
    expect(
      getAiRunContextLabel({
        contextInputTokens: 500,
        contextWindowTokens: 2000,
      })
    ).toBe('500 of 2,000 · 25.0%');
  });

  it('formats the percentage as the context bar tooltips do', () => {
    expect(
      getAiRunContextLabel(
        { contextInputTokens: 500, contextWindowTokens: 2000 },
        undefined,
        'ru'
      )
    ).toBe(`500 of 2\u00a0000 · ${formatAiRunPercentage(25, 'ru')}`);
  });

  it('returns undefined for incomplete or invalid context values', () => {
    expect(getAiRunContextLabel({ contextInputTokens: 10 })).toBeUndefined();
    expect(
      getAiRunContextLabel({
        contextInputTokens: 10,
        contextWindowTokens: 0,
      })
    ).toBeUndefined();
  });
});

describe('getAiRunContextBarSegments', () => {
  it('maps latest-request cache and new input to context-window bar segments', () => {
    expect(
      getAiRunContextBarSegments({
        contextInputTokens: 65,
        contextWindowTokens: 100,
        contextCacheReadInputTokens: 20,
        contextUncachedInputTokens: 45,
      })
    ).toEqual([
      {
        key: 'cacheRead',
        label: 'From cache',
        tokens: 20,
        percentage: 20,
      },
      {
        key: 'newInput',
        label: 'New input',
        tokens: 45,
        percentage: 45,
      },
    ]);
  });

  it('returns undefined when required context-window values are missing or inconsistent', () => {
    expect(getAiRunContextBarSegments({ contextInputTokens: 65 })).toBeUndefined();
    expect(
      getAiRunContextBarSegments({
        contextInputTokens: 120,
        contextWindowTokens: 100,
        contextCacheReadInputTokens: 20,
        contextUncachedInputTokens: 100,
      })
    ).toBeUndefined();
  });

  it('still renders malformed cache-read metadata by clipping it to the displayed context', () => {
    const segments = getAiRunContextBarSegments({
      contextInputTokens: 153294,
      contextWindowTokens: 200000,
      contextCacheReadInputTokens: 281264,
    });

    expect(segments).toEqual([
      expect.objectContaining({
        key: 'cacheRead',
        label: 'From cache',
        tokens: 153294,
      }),
      expect.objectContaining({
        key: 'newInput',
        label: 'New input',
        tokens: 0,
        percentage: 0,
      }),
    ]);
    expect(segments?.[0]?.percentage).toBeCloseTo(76.647);
  });

  it('renders the context as plain input when cache counters are absent', () => {
    expect(
      getAiRunContextBarSegments({
        contextInputTokens: 65,
        contextWindowTokens: 100,
      })
    ).toEqual([
      {
        key: 'input',
        label: 'Input',
        tokens: 65,
        percentage: 65,
      },
    ]);
  });
});

describe('formatAiRunTimeToFirstToken', () => {
  it('formats positive values in milliseconds', () => {
    expect(formatAiRunTimeToFirstToken(0.42)).toBe('420 ms');
  });

  it('returns undefined for invalid ttft values', () => {
    expect(formatAiRunTimeToFirstToken(undefined)).toBeUndefined();
    expect(formatAiRunTimeToFirstToken(-1)).toBeUndefined();
  });
});

describe('formatAiRunPercentage', () => {
  it('formats a share with one decimal in the percent style of each locale', () => {
    expect(formatAiRunPercentage(82.64, 'en')).toBe('82.6%');
    expect(formatAiRunPercentage(82.64, 'de')).toBe('82,6\u00a0%');
  });
});

describe('formatAiRunNumber', () => {
  it('formats numbers with grouping separators', () => {
    expect(formatAiRunNumber(12345)).toBe('12,345');
  });
});

describe('formatCostUsd', () => {
  it.each([
    [0, '$0.00'],
    [0.00004, '$0.00004'],
    [0.0000123, '$0.000012'],
    [0.0001, '$0.0001'],
    [0.000423, '$0.00042'],
    [0.0031, '$0.0031'],
    [0.0421, '$0.042'],
    [0.0999, '$0.10'],
    [0.5, '$0.50'],
    [1.234, '$1.23'],
    [1234.5, '$1,234.50'],
  ])('formats %s as %s', (usd, expected) => {
    expect(formatCostUsd(usd, 'en')).toBe(expected);
  });
});

describe('getAiRunTokenParts', () => {
  it('splits input into cache reads and new input when the backend reports the split', () => {
    const tokens = getAiRunTokenParts({
      inputTokens: 1674,
      cacheReadTokens: 1408,
      uncachedInputTokens: 266,
      outputTokens: 31,
    });

    expect(tokens?.total).toBe(1705);
    expect(tokens?.parts.map(({ key, label, tokens: count }) => [key, label, count])).toEqual([
      ['cacheRead', 'From cache', 1408],
      ['newInput', 'New input', 266],
      ['output', 'Output', 31],
    ]);
    expect(tokens?.parts[0]!.percentage).toBeCloseTo((1408 / 1705) * 100);
  });

  it('keeps input whole for replies recorded before the split was sent', () => {
    expect(
      getAiRunTokenParts({
        inputTokens: 1674,
        cacheReadTokens: 1408,
        outputTokens: 31,
      })?.parts.map(({ key, tokens }) => [key, tokens])
    ).toEqual([
      ['input', 1674],
      ['output', 31],
    ]);
  });

  it('leaves out kinds the reply did not use', () => {
    expect(
      getAiRunTokenParts({ uncachedInputTokens: 100, outputTokens: 10 })?.parts.map(
        ({ key }) => key
      )
    ).toEqual(['newInput', 'output']);
  });

  it('returns undefined without token counts', () => {
    expect(getAiRunTokenParts({})).toBeUndefined();
  });
});
