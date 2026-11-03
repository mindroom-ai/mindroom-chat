import { describe, expect, it } from 'vitest';
import { makeHighlightRegex } from './highlightRegex';

describe('makeHighlightRegex', () => {
  it('ignores empty highlight tokens', () => {
    const regex = makeHighlightRegex(['mindroom', '', '024', '   ']);

    expect(regex).toBeInstanceOf(RegExp);
    expect(regex?.source).toBe('mindroom|024');
  });

  it('returns undefined when every highlight token is empty', () => {
    expect(makeHighlightRegex(['', '   '])).toBeUndefined();
  });
});
