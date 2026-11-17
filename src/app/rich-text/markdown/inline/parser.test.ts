import { describe, expect, it } from 'vitest';
import {
  findInlineMDSpans,
  MAX_INLINE_MD_NESTING,
  parseInlineMD,
  parseInlineMDWithRules,
} from './parser';
import { INLINE_MD_RULES } from './rules';
import { escapeMarkdownInlineSequences, unescapeMarkdownInlineSequences } from '../utils';
import { cpuNow } from '../../../../test/utils/cpuNow';

describe('inline Markdown containing code', () => {
  it('handles long control-character input without repeated delimiter searches', () => {
    const prefix = '\u0000'.repeat(262144);
    const start = cpuNow();
    expect(parseInlineMD(`${prefix}**a \`x\` b**`)).toBe(
      `${prefix}<strong data-md="**">a <code data-md="\`">x</code> b</strong>`
    );
    expect(cpuNow() - start).toBeLessThan(2000);
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

describe('inline Markdown next to URLs', () => {
  it.each([
    ['https://example.org/a_b_c_d', 'https://example.org/a_b_c_d'],
    [
      'see https://example.org/**a** and **b**',
      'see https://example.org/**a** and <strong data-md="**">b</strong>',
    ],
    ['ftp://host/~~x~~ ~~y~~', 'ftp://host/~~x~~ <s data-md="~~">y</s>'],
    ['*a* mailto://b*c* *d*', '<i data-md="*">a</i> mailto://b*c* <i data-md="*">d</i>'],
    ['https://example.org/\\*x\\*', 'https://example.org/\\*x\\*'],
  ])('keeps markers inside URLs literal in %s', (markdown, html) => {
    expect(parseInlineMD(markdown)).toBe(html);
  });

  it('escapes markers outside URLs only', () => {
    expect(escapeMarkdownInlineSequences('https://example.org/a_b and a_b')).toBe(
      'https://example.org/a_b and a\\_b'
    );
    expect(unescapeMarkdownInlineSequences('https://example.org/a\\_b and a\\_b')).toBe(
      'https://example.org/a\\_b and a_b'
    );
  });
});

describe('findInlineMDSpans', () => {
  it.each([
    ['a **b** c', [{ kind: 'bold', start: 2, end: 7, open: 2, close: 2 }]],
    ['*b*', [{ kind: 'italic', start: 0, end: 3, open: 1, close: 1 }]],
    ['_b_', [{ kind: 'italic', start: 0, end: 3, open: 1, close: 1 }]],
    ['~~b~~', [{ kind: 'strikethrough', start: 0, end: 5, open: 2, close: 2 }]],
    ['||b||', [{ kind: 'spoiler', start: 0, end: 5, open: 2, close: 2 }]],
    ['``b``', [{ kind: 'code', start: 0, end: 5, open: 2, close: 2 }]],
    ['[b](https://x.example)', [{ kind: 'link', start: 0, end: 22, open: 1, close: 20 }]],
    ['\\*b', [{ kind: 'escape', start: 0, end: 2, open: 1, close: 0 }]],
  ])('reports %s', (markdown, spans) => {
    expect(findInlineMDSpans(markdown)).toEqual(spans);
  });

  it('reports nested spans at their offsets in the whole text, outer first', () => {
    expect(findInlineMDSpans('a **bold _it_** b')).toEqual([
      { kind: 'bold', start: 2, end: 15, open: 2, close: 2 },
      { kind: 'italic', start: 9, end: 13, open: 1, close: 1 },
    ]);
    expect(findInlineMDSpans('[a **b**](https://x.example)')).toEqual([
      { kind: 'link', start: 0, end: 28, open: 1, close: 20 },
      { kind: 'bold', start: 3, end: 8, open: 2, close: 2 },
    ]);
  });

  it('reports spans after code at their offsets in the text, not the masked text', () => {
    expect(findInlineMDSpans('``a`` **b `c` d** _e_')).toEqual([
      { kind: 'code', start: 0, end: 5, open: 2, close: 2 },
      { kind: 'bold', start: 6, end: 17, open: 2, close: 2 },
      { kind: 'code', start: 10, end: 13, open: 1, close: 1 },
      { kind: 'italic', start: 18, end: 21, open: 1, close: 1 },
    ]);
  });

  it('reports no Markdown inside URLs, code, math or a link destination', () => {
    expect(findInlineMDSpans('https://a.example/_c_ `**d**` $e `f` g$')).toEqual([
      { kind: 'code', start: 22, end: 29, open: 1, close: 1 },
    ]);
    expect(findInlineMDSpans('[x](https://a.example/`y`)')).toEqual([
      { kind: 'link', start: 0, end: 26, open: 1, close: 24 },
    ]);
  });

  it('reports nothing nested deeper than the parse renders', () => {
    expect(findInlineMDSpans('_'.repeat(2 * MAX_INLINE_MD_NESTING + 16))).toHaveLength(
      MAX_INLINE_MD_NESTING
    );
  });

  it('leaves the HTML as it was', () => {
    const markdown = 'a **b `c`** [d _e_](https://x.example) \\* ~~f~~';
    const html = parseInlineMD(markdown);
    expect(parseInlineMDWithRules(markdown, INLINE_MD_RULES, () => undefined)).toBe(html);
  });

  // Every span reported with a tag is one `data-md` tag of the HTML, in the same order with the
  // same syntax, so what the composer styles is what the message sends.
  const TAG_KIND: Record<string, string> = {
    strong: 'bold',
    i: 'italic',
    s: 'strikethrough',
    span: 'spoiler',
    a: 'link',
    code: 'code',
  };
  it.each([
    'a **bold _it_** b',
    '**a `**` b**',
    '*a **b** c*',
    '***a***',
    'a**b**c and a*b*c',
    '__init__ and snake_case_name and _snake_case_',
    '[a `x`](https://example.org) and [**a**](javascript:x)',
    '[x](https://example.org/`y`) `z`',
    '$a `b` c$ `d` $5 and $1,000.00$',
    'see https://example.org/**a** and **b**',
    '&lt;_a_&gt; &quot;_b_&quot; &amp; ~~c~~',
    '\\*a\\* \\**b** \\`c` ||d||',
    '`a` and ``b ` c`` and ```',
    '𝒜_b_ _a_😀 😀_a_ e\u0301_a_ _日本_',
    '_'.repeat(70),
    '**a** '.repeat(50),
  ])('matches the sent HTML for %s', (markdown) => {
    const html = parseInlineMD(markdown);
    const tags = [...html.matchAll(/<(strong|i|s|span|a|code) data-md(?:="([^"]*)")?/g)];
    const spans = findInlineMDSpans(markdown).filter((span) => span.kind !== 'escape');
    expect(spans.map((span) => span.kind)).toEqual(tags.map((tag) => TAG_KIND[tag[1] ?? '']));
    spans.forEach((span, index) => {
      const syntax = tags[index]?.[2];
      if (syntax !== undefined)
        expect(markdown.slice(span.start, span.start + span.open)).toBe(syntax);
    });
  });

  it.each([
    ['bold pairs', `${'**'.repeat(8_000)}a${'**'.repeat(8_000)}`],
    ['underscores', '_'.repeat(16_000)],
    ['code spans', '`a` '.repeat(16_000)],
    ['spans between code', '`a` **b** '.repeat(8_000)],
  ])('reports 16k delimiters of %s in under a second', (_name, text) => {
    const start = cpuNow();
    expect(findInlineMDSpans(text).length).toBeGreaterThan(0);
    expect(cpuNow() - start).toBeLessThan(1000);
  });
});
