import { describe, expect, it } from 'vitest';
import { MAX_INLINE_MD_NESTING, parseInlineMD } from './parser';

describe('LinkRule', () => {
  it.each([
    ['[x](https://a.example)', '<a data-md href="https://a.example">x</a>'],
    ['[x](HTTP://a.example)', '<a data-md href="HTTP://a.example">x</a>'],
    ['[mail](mailto:alice@example.org)', '<a data-md href="mailto:alice@example.org">mail</a>'],
    ['[x](ftp://files.example/a)', '<a data-md href="ftp://files.example/a">x</a>'],
    ['[x](magnet:?xt=urn:btih:abc)', '<a data-md href="magnet:?xt=urn:btih:abc">x</a>'],
  ])('links %s', (markdown, html) => {
    expect(parseInlineMD(markdown)).toBe(html);
  });

  it.each([
    '[x](javascript:alert(1))',
    '[x](JavaScript:alert(1))',
    '[x](data:text/html,hi)',
    '[x](vbscript:msgbox)',
    '[x](/relative)',
    '[x](//host.example/path)',
    '[x](#anchor)',
  ])('keeps %s as text, as the sanitizer would drop the link', (markdown) => {
    expect(parseInlineMD(markdown)).toBe(markdown);
  });

  it('links an allowed destination after a refused one', () => {
    expect(parseInlineMD('[a](javascript:x) [b](https://b.example)')).toBe(
      '[a](javascript:x) <a data-md href="https://b.example">b</a>'
    );
  });

  it('keeps the formatting of a refused label', () => {
    expect(parseInlineMD('[**a**](javascript:x)')).toBe(
      '[<strong data-md="**">a</strong>](javascript:x)'
    );
  });
});

describe('nested inline Markdown', () => {
  it('keeps text nested deeper than the limit as written', () => {
    // Each pair of underscores around the rest nests one more italic.
    const depth = MAX_INLINE_MD_NESTING;
    expect(parseInlineMD('_'.repeat(2 * depth + 16))).toBe(
      `${'<i data-md="_">'.repeat(depth)}${'_'.repeat(16)}${'</i>'.repeat(depth)}`
    );
  });

  it.each([
    ['underscores', '_'.repeat(16_000)],
    ['stars', '*'.repeat(16_000)],
    ['bold pairs', `${'**'.repeat(8_000)}a${'**'.repeat(8_000)}`],
    ['strikethrough pairs', `${'~~'.repeat(8_000)}a${'~~'.repeat(8_000)}`],
    ['spoiler pairs', `${'||'.repeat(8_000)}a${'||'.repeat(8_000)}`],
  ])('renders 16k delimiters of %s without deep recursion, in under a second', (_name, text) => {
    const start = performance.now();
    expect(() => parseInlineMD(text)).not.toThrow();
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
