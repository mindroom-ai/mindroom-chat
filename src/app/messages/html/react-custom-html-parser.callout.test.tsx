// @vitest-environment jsdom
import parse from 'html-react-parser';
import MarkdownIt from 'markdown-it';
import type { MatrixClient } from 'matrix-js-sdk';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LINKIFY_OPTS, getReactCustomHtmlParser } from './react-custom-html-parser';
import { toMatrixCustomHTML } from '../../editor/output';
import { BlockType } from '../../editor/types';
import * as customHtmlCss from '../../rich-text/CustomHtml.css';
import { sanitizeCustomHtml } from '../../rich-text/sanitize';

afterEach(cleanup);

const md = new MarkdownIt({ breaks: true });

const mx = {
  getUserId: () => '@viewer:example.org',
  getRoom: () => undefined,
  getHomeserverUrl: () => 'https://matrix.example',
  mxcUrlToHttp: (url: string) => url,
} as unknown as MatrixClient;

const renderMessageHtml = (html: string, highlightRegex?: RegExp) => {
  const sanitized = sanitizeCustomHtml(html);
  const opts = getReactCustomHtmlParser(mx, undefined, {
    linkifyOpts: LINKIFY_OPTS,
    highlightRegex,
  });
  return render(<div>{parse(sanitized, opts)}</div>);
};

describe('GitHub alert callouts in custom HTML parser', () => {
  it.each([
    ['NOTE', 'note', 'Note'],
    ['TIP', 'tip', 'Tip'],
    ['IMPORTANT', 'important', 'Important'],
    ['WARNING', 'warning', 'Warning'],
    ['CAUTION', 'caution', 'Caution'],
  ])('renders markdown %s callout with tone and localized title', (marker, tone, title) => {
    const html = md.render(`> [!${marker}]\n> Useful details.`);
    const { container } = renderMessageHtml(html);

    expect(container.querySelector('blockquote')).toBeNull();
    const callout = container.querySelector(`aside[data-callout-type="${tone}"]`);
    expect(callout?.getAttribute('role')).toBe('note');
    expect(callout?.textContent).toContain(title);
    expect(callout?.textContent).toContain('Useful details.');
  });

  it('renders multi-paragraph callouts with lists, fenced code, and plain nested quotes', () => {
    const markdown = [
      '> [!WARNING]',
      '>',
      '> First paragraph.',
      '>',
      '> - Item one',
      '> - Item two',
      '>',
      '> ```ts',
      '> const x = 1;',
      '> ```',
      '>',
      '> > Regular nested quote',
    ].join('\n');
    const { container } = renderMessageHtml(md.render(markdown));

    const outer = container.querySelector('aside[data-callout-type="warning"]');
    expect(outer).not.toBeNull();
    expect(outer?.querySelectorAll('li')).toHaveLength(2);
    expect(outer?.querySelector('pre code')?.textContent).toContain('const x = 1;');
    expect(outer?.querySelector('blockquote')?.textContent).toContain('Regular nested quote');
  });

  it('keeps nested alerts inside blockquotes and lists as plain blockquotes', () => {
    const nestedInCallout = [
      '> [!WARNING]',
      '>',
      '> > [!TIP]',
      '> > Nested tip stays a quote',
    ].join('\n');
    const { container: nestedContainer } = renderMessageHtml(md.render(nestedInCallout));
    const outer = nestedContainer.querySelector('aside[data-callout-type="warning"]');
    expect(outer).not.toBeNull();
    expect(outer?.querySelector('aside[data-callout-type="tip"]')).toBeNull();
    const nestedBq = outer?.querySelector('blockquote');
    expect(nestedBq?.textContent).toContain('[!TIP]');
    expect(nestedBq?.textContent).toContain('Nested tip stays a quote');

    const nestedInList = ['- > [!TIP]', '  > Alert inside list item'].join('\n');
    const { container: listContainer } = renderMessageHtml(md.render(nestedInList));
    expect(listContainer.querySelector('aside[data-callout-type]')).toBeNull();
    const listBq = listContainer.querySelector('li blockquote');
    expect(listBq?.textContent).toContain('[!TIP]');
    expect(listBq?.textContent).toContain('Alert inside list item');
  });

  it('renders human composer markdown quotes, Slate quote blocks, and direct-text callouts', () => {
    const composerMdHtml = toMatrixCustomHTML(
      [
        { type: BlockType.Paragraph, children: [{ text: '> [!IMPORTANT]' }] },
        { type: BlockType.Paragraph, children: [{ text: '> Sent from **composer**' }] },
      ],
      { allowBlockMarkdown: true, allowInlineMarkdown: true, allowTextFormatting: true }
    );
    const { container: mdContainer } = renderMessageHtml(composerMdHtml);
    const mdCallout = mdContainer.querySelector('aside[data-callout-type="important"]');
    expect(mdCallout?.textContent).toContain('Important');
    expect(mdCallout?.querySelector('strong')?.textContent).toBe('composer');

    const slateBlockHtml = toMatrixCustomHTML(
      [
        {
          type: BlockType.BlockQuote,
          children: [
            { type: BlockType.QuoteLine, children: [{ text: '[!TIP]' }] },
            { type: BlockType.QuoteLine, children: [{ text: 'From Slate block' }] },
          ],
        },
      ],
      { allowBlockMarkdown: false, allowInlineMarkdown: false, allowTextFormatting: true }
    );
    const { container: slateContainer } = renderMessageHtml(slateBlockHtml);
    const slateCallout = slateContainer.querySelector('aside[data-callout-type="tip"]');
    expect(slateCallout?.textContent).toContain('Tip');
    expect(slateCallout?.textContent).toContain('From Slate block');

    const { container: directContainer } = renderMessageHtml(
      '<blockquote>[!CAUTION]\nDirect newline body</blockquote>'
    );
    const directCallout = directContainer.querySelector('aside[data-callout-type="caution"]');
    expect(directCallout?.textContent).toContain('Caution');
    expect(directCallout?.textContent).toContain('Direct newline body');
  });

  it('renders marker-alone callouts cleanly without an empty body wrapper', () => {
    const { container } = renderMessageHtml(md.render('> [!NOTE]'));
    const callout = container.querySelector('aside[data-callout-type="note"]');
    expect(callout?.children).toHaveLength(1);
    expect(callout?.textContent).toBe('Note');
  });

  it.each([
    ['same-line text', '> [!NOTE] hello'],
    ['same-line inline formatting', '> [!NOTE] **hello**'],
    ['unknown type', '> [!FOO]\n> text'],
    ['inline code marker', '> `[!NOTE]`\n> text'],
    ['bold marker', '> **[!NOTE]**\n> text'],
    ['non-leading marker', '> First paragraph\n>\n> [!NOTE]\n> Second paragraph'],
  ])('keeps %s as a plain blockquote', (_label, markdown) => {
    const { container } = renderMessageHtml(md.render(markdown));
    expect(container.querySelector('aside[data-callout-type]')).toBeNull();
    expect(container.querySelector('blockquote')).not.toBeNull();
  });

  it('highlights search matches in the localized callout title', () => {
    const { container } = renderMessageHtml(md.render('> [!WARNING]\n> Disk full.'), /warning/i);
    const callout = container.querySelector('aside[data-callout-type="warning"]');
    const labelledBy = callout?.getAttribute('aria-labelledby');
    const header = labelledBy ? container.querySelector(`[id="${labelledBy}"]`) : null;
    const highlightedTitle = header?.querySelector(`span.${customHtmlCss.highlightText}`);
    expect(highlightedTitle?.textContent).toBe('Warning');
  });

  it('preserves links, mentions, spoilers, math, inline code, tables, RTL controls, and highlights inside callouts', () => {
    const html = [
      '<blockquote>',
      '<p>[!NOTE]<br>',
      'Visit https://example.com and ',
      '<a href="https://matrix.to/#/@alice:example.org">@alice:example.org</a>, ',
      '<span data-mx-spoiler="secret">hidden</span>, ',
      '<span data-mx-maths="x^2">x^2</span> and $y+1$, ',
      '<code>inline_code</code>, ',
      'bidi \u202Etext, and matchword.</p>',
      '<table><thead><tr><th>Col</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>',
      '</blockquote>',
    ].join('');

    const { container } = renderMessageHtml(html, /matchword/i);
    const callout = container.querySelector('aside[data-callout-type="note"]');
    expect(callout).not.toBeNull();
    expect(callout?.querySelector('a[href="https://example.com"]')).not.toBeNull();
    expect(callout?.querySelector('a[data-mention-id="@alice:example.org"]')).not.toBeNull();
    expect(callout?.querySelector('[data-mx-spoiler="secret"]')).not.toBeNull();
    expect(callout?.querySelectorAll('.katex').length).toBeGreaterThanOrEqual(2);
    expect(callout?.querySelector('code')?.textContent).toBe('inline_code');
    expect(callout?.querySelector('table td')?.textContent).toBe('Cell');
    expect(callout?.textContent).toContain('<U+202E>text');

    const highlightedBody = callout?.querySelector(`span.${customHtmlCss.highlightText}`);
    expect(highlightedBody?.textContent).toBe('matchword');
  });
});
