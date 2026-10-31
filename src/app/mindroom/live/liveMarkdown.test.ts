import { beforeAll, describe, expect, it } from 'vitest';
import parity from './__fixtures__/live-markdown-parity-v1.json';
import { loadLiveMarkdown, renderLiveMarkdown } from './liveMarkdown';

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

  it('reads dollars next to digits and spaces as text, like currency', () => {
    expect(renderLiveMarkdown('Costs 5$ or $ 6 and $7')).toBe('<p>Costs 5$ or $ 6 and $7</p>\n');
    expect(renderLiveMarkdown('$a*b*c$ but *d*')).toBe('<p>$a*b*c$ but <em>d</em></p>\n');
  });
});
