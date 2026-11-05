import { describe, expect, it } from 'vitest';
import { findDisplayLatexBlockMatch, tokenizeTextWithLatex } from './math';
import { cpuNow } from '../test-utils/cpuNow';

describe('display math', () => {
  it('rejects unclosed $$ openers without rescanning the rest of the text', () => {
    expect(tokenizeTextWithLatex('a\n$$x\n`b`\n$$\ny\n$$')).toEqual([
      { type: 'text', content: 'a\n$$x\n' },
      { type: 'verbatim', content: '`b`' },
      { type: 'text', content: '\n' },
      { type: 'math', content: 'y', displayMode: true },
    ]);
    expect(findDisplayLatexBlockMatch('a\n$$x\n`b`\n$$\ny\n$$')).toMatchObject({
      latex: 'y',
      start: 10,
      end: 17,
    });

    // Each opener scanned to the end of the text for its closing `$$`.
    const unclosed = '$$x\n'.repeat(16_000);
    const start = cpuNow();
    expect(tokenizeTextWithLatex(unclosed)).toEqual([{ type: 'text', content: unclosed }]);
    expect(findDisplayLatexBlockMatch(unclosed)).toBeUndefined();
    expect(cpuNow() - start).toBeLessThan(500);
  });
});
