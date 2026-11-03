import { describe, expect, it } from 'vitest';
import { parseInlineMD } from './parser';

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
