import { describe, expect, it } from 'vitest';
import { findFirstHighlight, makeHighlightRegex } from './highlightRegex';

const marked = (text: string, highlights: string[]): string[] => {
  const regex = makeHighlightRegex(highlights);
  return regex ? [...text.matchAll(regex)].map((match) => `${match.index}:${match[0]}`) : [];
};

describe('makeHighlightRegex', () => {
  it('ignores empty highlight tokens', () => {
    expect(marked('see mindroom and 024', ['mindroom', '', '024', '   '])).toEqual([
      '4:mindroom',
      '17:024',
    ]);
  });

  it('returns undefined when every highlight token is empty', () => {
    expect(makeHighlightRegex(['', '   '])).toBeUndefined();
  });

  it('marks a highlight only where it stands as a whole word, as the server matches it', () => {
    expect(marked('alpha_beta gamma al be', ['al', 'be'])).toEqual(['17:al', '20:be']);
    expect(marked('gammaal bealpha', ['al', 'be'])).toEqual([]);
  });

  it('treats underscores, hyphens, dots and backticks as word breaks, as the server does', () => {
    expect(marked('alpha_be be-gamma `al`.', ['al', 'be'])).toEqual(['6:be', '9:be', '19:al']);
  });

  it('matches regardless of case', () => {
    expect(marked('Gamma GAMMA gAmMa', ['gamma'])).toEqual(['0:Gamma', '6:GAMMA', '12:gAmMa']);
  });

  it('keeps non-Latin letters inside a word', () => {
    expect(marked('αλφα λφ', ['λφ'])).toEqual(['5:λφ']);
    expect(marked('café caf', ['caf'])).toEqual(['5:caf']);
    expect(marked('ÉTÉ été', ['été'])).toEqual(['0:ÉTÉ', '4:été']);
  });

  it('counts digits as part of a word', () => {
    expect(marked('al2 2al al-2 be', ['al'])).toEqual(['8:al']);
    expect(marked('v24 24 x240', ['24'])).toEqual(['4:24']);
  });

  it('marks the longer highlight where a shorter one only starts it', () => {
    expect(marked('alpha al', ['al', 'alpha'])).toEqual(['0:alpha', '6:al']);
  });

  it('finds the one real word in a long message full of near misses', () => {
    const body = `${'alpha_gamma '.repeat(9_000)}al`;

    expect(marked(body, ['al', 'gam', 'ph'])).toEqual([`${body.length - 2}:al`]);
  });

  it('ends a word at a combining accent, which the server does not count as a letter', () => {
    expect(marked('cafe\u0301', ['cafe'])).toEqual(['0:cafe']);
    expect(marked('cafe\u0301', ['caf'])).toEqual([]);
  });

  it('keeps a letter outside the Basic Multilingual Plane inside a word', () => {
    expect(marked('al\u{1D400} \u{1D400}al al', ['al'])).toEqual(['10:al']);
  });
});

describe('findFirstHighlight', () => {
  it('finds the first whole-word match of any highlight, or -1', () => {
    expect(findFirstHighlight('alpha_beta gamma be al', ['al', 'be'])).toBe(17);
    expect(findFirstHighlight('alpha_beta', ['al', 'be'])).toBe(-1);
    expect(findFirstHighlight('alpha', [])).toBe(-1);
  });
});
