import { beforeAll, describe, expect, it } from 'vitest';
import parity from './__fixtures__/live-markdown-parity-v1.json';
import { loadLiveMarkdown, renderLiveMarkdown } from './liveMarkdown';
import { cpuNow } from '../../../test/utils/cpuNow';

describe('live reply Markdown', () => {
  beforeAll(async () => {
    await loadLiveMarkdown();
  });

  it.each(parity.cases.map((testCase) => [testCase.name, testCase] as const))(
    'renders like the runtime: %s',
    (_name, { md, html }) => {
      expect(renderLiveMarkdown(md)).toBe(html);
    }
  );

  it.each([
    ['a processing instruction', '<?php echo 1; ?>', '<p>&lt;?php echo 1; ?&gt;</p>\n'],
    ['a declaration', '<!DOCTYPE html>', '<p>&lt;!DOCTYPE html&gt;</p>\n'],
    [
      'an indented disallowed tag',
      '  <iframe src="x">',
      '<p>&lt;iframe src=&quot;x&quot;&gt;</p>\n',
    ],
  ])('escapes %s that opens a line', (_name, md, html) => {
    expect(renderLiveMarkdown(md)).toBe(html);
  });

  // Not in the parity fixture: the runtime's sanitizer also escapes the comment and the `<` in the value.
  it.each([
    [
      'a comment',
      'Before <!-- <title --> **after**',
      '<p>Before <!-- <title --> <strong>after</strong></p>\n',
    ],
    [
      'a quoted attribute value',
      'See <img src="mxc://example.org/image" alt="<title excerpt"> then **bold**',
      '<p>See <img src="mxc://example.org/image" alt="<title excerpt"> then <strong>bold</strong></p>\n',
    ],
    [
      "a quoted value of an attribute markdown-it's grammar rejects",
      `<p><img 1=2 src="mxc://example.org/image" alt="<title name='&amp;'>"></p>`,
      `<p><img 1=2 src="mxc://example.org/image" alt="<title name='&amp;'>"></p>`,
    ],
  ])('leaves a <title inside %s as it is', (_name, md, html) => {
    expect(renderLiveMarkdown(md)).toBe(html);
  });

  it('keeps HTML openers inside fenced code as code', () => {
    expect(renderLiveMarkdown('```\n<!-- note -->\n<script>\n```')).toBe(
      '<pre><code>&lt;!-- note --&gt;\n&lt;script&gt;\n</code></pre>\n'
    );
  });

  it('separates a complete block HTML line from the Markdown after it', () => {
    expect(renderLiveMarkdown('<div>box</div>\n**after**')).toBe(
      '<div>box</div>\n<p><strong>after</strong></p>\n'
    );
    expect(renderLiveMarkdown('<hr>\n```\ncode\n```')).toBe(
      '<hr>\n<pre><code>code\n</code></pre>\n'
    );
  });

  it('keeps math openers left unclosed in a quote apart from the math block after it', () => {
    expect(renderLiveMarkdown('> $$a\n\n$$b\nc$$')).toBe(
      '<blockquote>\n<p>$$a</p>\n</blockquote>\n<div>$$\nb\nc\n$$</div>\n'
    );
  });

  it('stays fast on a long whitespace run and on many unclosed math openers', () => {
    const start = cpuNow();
    expect(renderLiveMarkdown(`${' '.repeat(64_000)}x\ny`)).toBe(
      `<pre><code>${' '.repeat(63_996)}x\n</code></pre>\n<p>y</p>\n`
    );
    expect(renderLiveMarkdown('$$a\n\n'.repeat(20_000))).toBe('<p>$$a</p>\n'.repeat(20_000));
    expect(cpuNow() - start).toBeLessThan(1000);
  });

  it('reads dollars next to digits and spaces as text, like currency', () => {
    expect(renderLiveMarkdown('Costs 5$ or $ 6 and $7')).toBe('<p>Costs 5$ or $ 6 and $7</p>\n');
    expect(renderLiveMarkdown('$a*b*c$ but *d*')).toBe('<p>$a*b*c$ but <em>d</em></p>\n');
  });

  it('renders Markdown footnotes matching the backend wire format including repeated refs', () => {
    expect(renderLiveMarkdown('Note[^1] and again[^1].\n\n[^1]: Detail.')).toBe(
      [
        '<p>Note<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup> and again<sup class="footnote-ref"><a href="#fn1" id="fnref1:1">[1:1]</a></sup>.</p>',
        '<hr class="footnotes-sep">',
        '<section class="footnotes">',
        '<ol class="footnotes-list">',
        '<li id="fn1" class="footnote-item"><p>Detail. <a href="#fnref1" class="footnote-backref">↩︎</a> <a href="#fnref1:1" class="footnote-backref">↩︎</a></p>',
        '</li>',
        '</ol>',
        '</section>',
        '',
      ].join('\n')
    );
  });

  it('keeps inline footnote syntax ^[a-z] and undefined streaming [^1] refs as literal text', () => {
    expect(renderLiveMarkdown('Regex ^[a-z]+ matches letters.')).toBe(
      '<p>Regex ^[a-z]+ matches letters.</p>\n'
    );
    expect(renderLiveMarkdown('Claim[^1] before definition arrives.')).toBe(
      '<p>Claim[^1] before definition arrives.</p>\n'
    );
  });

  it('numbers named footnotes by first reference and allows section blocks', () => {
    const html = renderLiveMarkdown('First[^alpha], second[^beta].\n\n[^beta]: B.\n[^alpha]: A.');
    expect(html).toContain('<a href="#fn1" id="fnref1">[1]</a>');
    expect(html).toContain('<a href="#fn2" id="fnref2">[2]</a>');
    expect(html).toContain('<li id="fn1" class="footnote-item"><p>A.');
    expect(html).toContain('<li id="fn2" class="footnote-item"><p>B.');
    expect(renderLiveMarkdown('<section>box</section>\n**after**')).toBe(
      '<section>box</section>\n<p><strong>after</strong></p>\n'
    );
  });

  it('falls back to literal text on duplicate footnote definitions without losing URL-only sources', () => {
    const duplicateProse = renderLiveMarkdown(
      'First[^1].\n\n[^1]: First source.\n\nSecond[^1].\n\n[^1]: Second source.'
    );
    expect(duplicateProse).not.toContain('class="footnote-ref"');
    expect(duplicateProse).toContain('[^1]: First source.');
    expect(duplicateProse).toContain('[^1]: Second source.');

    const duplicateUrls = renderLiveMarkdown(
      [
        'Alpha[^1].',
        '',
        '[^1]: https://example.com',
        '',
        'Beta[^1] and [docs].',
        '',
        '[^1]: https://example.org',
        '',
        '[docs]: https://docs.example.com',
      ].join('\n')
    );
    expect(duplicateUrls).not.toContain('class="footnote-ref"');
    expect(duplicateUrls).toContain('<p>[^1]: https://example.com</p>');
    expect(duplicateUrls).toContain('<p>[^1]: https://example.org</p>');
    expect(duplicateUrls).toContain('<a href="https://docs.example.com">docs</a>');
  });

  it('does not false-flag a paragraph-interrupting or code-fenced single footnote definition', () => {
    const interrupting = renderLiveMarkdown('Note[^1]\n[^1]: Detail.');
    expect(interrupting).toContain(
      '<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>'
    );
    expect(interrupting).toContain(
      '<li id="fn1" class="footnote-item"><p>Detail. <a href="#fnref1" class="footnote-backref">↩︎</a></p>'
    );

    const withCodeBlock = renderLiveMarkdown(
      'Note[^1].\n\n```\n[^1]: Not a definition.\n```\n\n[^1]: Real detail.'
    );
    expect(withCodeBlock).toContain(
      '<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>'
    );
    expect(withCodeBlock).toContain('<li id="fn1" class="footnote-item"><p>Real detail.');
    expect(withCodeBlock).toContain('<code>[^1]: Not a definition.\n</code>');
  });
});
