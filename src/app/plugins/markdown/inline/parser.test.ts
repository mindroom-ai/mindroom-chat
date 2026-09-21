import { describe, expect, it } from 'vitest';
import { parseInlineMD } from './parser';

describe('inline Markdown containing code', () => {
  it('handles long control-character input without repeated delimiter searches', () => {
    const prefix = '\u0000'.repeat(262144);
    const start = performance.now();
    expect(parseInlineMD(`${prefix}**a \`x\` b**`)).toBe(
      `${prefix}<strong data-md="**">a <code data-md="\`">x</code> b</strong>`
    );
    expect(performance.now() - start).toBeLessThan(2000);
  });

  it('cannot confuse literal token-shaped text with protected code', () => {
    expect(parseInlineMD('\u00000:0\u00000: **a `x` b**')).toBe(
      '\u00000:0\u00000: <strong data-md="**">a <code data-md="`">x</code> b</strong>'
    );
  });
  it.each([
    ['**a `x` b**', '<strong data-md="**">a <code data-md="`">x</code> b</strong>'],
    ['**a `**` b**', '<strong data-md="**">a <code data-md="`">**</code> b</strong>'],
    ['*a `x` b*', '<i data-md="*">a <code data-md="`">x</code> b</i>'],
    ['~~a `x` b~~', '<s data-md="~~">a <code data-md="`">x</code> b</s>'],
    ['`**not bold**`', '<code data-md="`">**not bold**</code>'],
    ['`a` and `b`', '<code data-md="`">a</code> and <code data-md="`">b</code>'],
    [
      '[a `x`](https://example.org)',
      '<a data-md href="https://example.org">a <code data-md="`">x</code></a>',
    ],
    ['[x](https://example.org/`y`)', '<a data-md href="https://example.org/`y`">x</a>'],
    ['$a `b` c$', '<span data-mx-maths="a `b` c">a `b` c</span>'],
    [
      '\u00000\u0000 **a `x` b**',
      '\u00000\u0000 <strong data-md="**">a <code data-md="`">x</code> b</strong>',
    ],
  ])('renders %s without interpreting code contents as Markdown', (markdown, html) => {
    expect(parseInlineMD(markdown)).toBe(html);
  });
});
