import { describe, expect, it } from 'vitest';
import {
  analyzeTreeStructure,
  exceedsTreeNodeLimit,
  formatJsonStringInner,
  formatTimestampHint,
  makeStringSnippet,
  splitHighlightSegments,
} from './jsonSourceTree';

describe('jsonSourceTree helpers', () => {
  it('JSON-escapes quotes, backslashes, newlines, and control characters while revealing bidi controls', () => {
    expect(formatJsonStringInner('line 1\n"quoted" \\ end')).toBe('line 1\\n\\"quoted\\" \\\\ end');
    expect(formatJsonStringInner('tab\there\r\u0007')).toBe('tab\\there\\r\\u0007');
    expect(formatJsonStringInner('alert \u202Espoof\u202C')).toBe('alert <U+202E>spoof<U+202C>');
  });

  it('normalizes whitespace and JSON-escapes quotes/backslashes in folded long string snippets', () => {
    const longText = `alpha\n"beta" \\ gamma ${'x'.repeat(140)}`;
    const snippet = makeStringSnippet(longText);
    expect(snippet.startsWith('"alpha \\"beta\\" \\\\ gamma ')).toBe(true);
    expect(snippet.endsWith('…"')).toBe(true);
  });

  it('formats in-range timestamps and returns undefined for out-of-range timestamps without throwing', () => {
    expect(formatTimestampHint(1731500000000, 'en')).toBeTruthy();
    expect(formatTimestampHint(9e15, 'en')).toBeUndefined();
    expect(formatTimestampHint(-1, 'en')).toBeUndefined();
    expect(formatTimestampHint(Number.NaN, 'en')).toBeUndefined();
  });

  it('preserves original string indices in splitHighlightSegments across Unicode case-folding length changes', () => {
    expect(splitHighlightSegments('İx', 'x')).toEqual([
      { text: 'İ', match: false },
      { text: 'x', match: true },
    ]);
    expect(splitHighlightSegments('İX', 'x')).toEqual([
      { text: 'İ', match: false },
      { text: 'X', match: true },
    ]);
    expect(splitHighlightSegments('foo[bar]baz', '[bar]')).toEqual([
      { text: 'foo', match: false },
      { text: '[bar]', match: true },
      { text: 'baz', match: false },
    ]);
  });

  it('short-circuits exceedsTreeNodeLimit and collects nodeCount and folds in analyzeTreeStructure', () => {
    const sample = {
      content: {
        'm.mentions': { user_ids: ['@alex:example.org'] },
        readings: [1, 2, 3, 4, 5, 6],
      },
      unsigned: { age: 10 },
    };
    expect(exceedsTreeNodeLimit(sample, 5)).toBe(true);
    expect(exceedsTreeNodeLimit(sample, 50)).toBe(false);

    const meta = analyzeTreeStructure(sample);
    expect(meta.nodeCount).toBe(14);
    expect(meta.defaultCollapsed.has('/unsigned')).toBe(true);
    expect(meta.defaultCollapsed.has('/content/m.mentions')).toBe(true);
    expect(meta.defaultCollapsed.has('/content/readings')).toBe(true);
    expect(meta.allCollapsibleAtDepthGte1).toContain('/content');
    expect(meta.allCollapsibleAtDepthGte1).toContain('/unsigned');
  });
});
