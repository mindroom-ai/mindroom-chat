// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/react';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { ClientConfigProvider } from '../../config/useClientConfig';
import { MessageLinkHostContext } from '../../rich-text/messageLinkCards';
import { parseHtml } from '../../rich-text/parseHtml';
import { sanitizeCustomHtml } from '../../rich-text/sanitize';
import { RenderBody } from '../content/RenderBody';
import { loadLiveMarkdown, renderLiveMarkdown } from '../live/liveMarkdown';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from './react-custom-html-parser';

vi.mock('../../rich-text/CustomHtml.css', () => ({
  Paragraph: 'Paragraph',
  List: 'List',
  MarginSpaced: 'MarginSpaced',
  Emoticon: () => 'Emoticon',
  FootnoteRef: 'FootnoteRef',
  FootnoteRefLink: 'FootnoteRefLink',
  FootnotesSep: 'FootnotesSep',
  Footnotes: 'Footnotes',
  FootnotesList: 'FootnotesList',
  FootnoteItem: 'FootnoteItem',
  FootnoteBackref: 'FootnoteBackref',
}));
vi.mock('../../rich-text/matrixMath.css', () => ({ MathInline: 'MathInline' }));
vi.mock('../../rich-text/ScrollableTable.css', () => ({}));
vi.mock('./HtmlBlocks.css', () => ({}));
vi.mock('../../approvals/ApprovalArgumentFields.css', () => ({}));

const mx = {
  getRoom: () => null,
  getRooms: () => [],
  getUserId: () => '@reader:example.org',
} as unknown as MatrixClient;

const makeParserOptions = () =>
  getReactCustomHtmlParser(mx, undefined, {
    linkifyOpts: LINKIFY_OPTS,
    showLinkFavicons: true,
  });

describe('Markdown footnotes rendering and navigation', () => {
  beforeAll(async () => {
    await loadLiveMarkdown();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.history.replaceState(null, '', window.location.pathname);
  });

  it('scopes footnote IDs per RenderBody message and navigates within the clicked message', () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });

    const msg1Html = renderLiveMarkdown(
      'First[^1].\n\n[^1]: Detail one with [docs](https://mindroom.chat).'
    )!;
    const msg2Html = renderLiveMarkdown('Second[^1] and again[^1].\n\n[^1]: Detail two.')!;
    // Share one parser options object across messages, as the room timeline does.
    const parserOptions = makeParserOptions();

    const { container } = render(
      <MessageLinkHostContext.Provider value="timeline">
        <ClientConfigProvider value={{ messageRendering: { linkFavicons: true } }}>
          <div data-testid="msg-1">
            <RenderBody
              body="First[^1]."
              customBody={msg1Html}
              htmlReactParserOptions={parserOptions}
              linkifyOpts={LINKIFY_OPTS}
            />
          </div>
          <div data-testid="msg-2">
            <RenderBody
              body="Second[^1] and again[^1]."
              customBody={msg2Html}
              htmlReactParserOptions={parserOptions}
              linkifyOpts={LINKIFY_OPTS}
            />
          </div>
        </ClientConfigProvider>
      </MessageLinkHostContext.Provider>
    );

    const msg1 = container.querySelector('[data-testid="msg-1"]')!;
    const msg2 = container.querySelector('[data-testid="msg-2"]')!;

    const msg1Item = msg1.querySelector<HTMLLIElement>('li.footnote-item')!;
    const msg2Item = msg2.querySelector<HTMLLIElement>('li.footnote-item')!;
    const msg1Ref = msg1.querySelector<HTMLAnchorElement>('sup.footnote-ref a')!;
    const msg2Refs = [...msg2.querySelectorAll<HTMLAnchorElement>('sup.footnote-ref a')];
    const msg2Backrefs = [...msg2.querySelectorAll<HTMLAnchorElement>('a.footnote-backref')];

    expect(msg1Item.id).toMatch(/-fn1$/);
    expect(msg2Item.id).toMatch(/-fn1$/);
    expect(msg1Item.id).not.toBe(msg2Item.id);
    expect(msg1Ref.id).not.toBe(msg2Refs[0]!.id);
    expect(msg2Refs[0]!.id).toMatch(/-fnref1$/);
    expect(msg2Refs[1]!.id).toMatch(/-fnref1:1$/);
    expect(msg1Item.tabIndex).toBe(-1);
    expect(msg2Item.tabIndex).toBe(-1);

    // Every DOM id across both messages is unique.
    const allIds = [...container.querySelectorAll('[id]')].map((el) => el.id);
    expect(new Set(allIds).size).toBe(allIds.length);

    // Footnote links never use CheckedMessageLink, favicons, target="_blank", or rel.
    const allFootnoteLinks = [
      ...container.querySelectorAll<HTMLAnchorElement>('sup.footnote-ref a, a.footnote-backref'),
    ];
    expect(allFootnoteLinks).toHaveLength(6);
    for (const link of allFootnoteLinks) {
      expect(link.hasAttribute('data-message-link')).toBe(false);
      expect(link.getAttribute('target')).toBeNull();
      expect(link.getAttribute('rel')).toBeNull();
      expect(link.querySelector('img')).toBeNull();
    }
    expect(msg1Ref.getAttribute('title')).toBeNull();

    // An external link inside a footnote body still renders via CheckedMessageLink.
    const docsLink = msg1Item.querySelector<HTMLAnchorElement>('a[href="https://mindroom.chat"]')!;
    expect(docsLink.getAttribute('data-message-link')).toBe('timeline');
    expect(docsLink.getAttribute('target')).toBe('_blank');
    expect(docsLink.getAttribute('rel')).toBe('noreferrer noopener');

    // Backref glyph keeps U+21A9 U+FE0E intact without Emoticon scaling and has accessible labels.
    expect(msg2Backrefs).toHaveLength(2);
    expect(msg2Backrefs[0]!.textContent).toBe('↩︎');
    expect(msg2Backrefs[0]!.querySelector('.Emoticon')).toBeNull();
    expect(msg2Backrefs[0]!.getAttribute('aria-label')).toBe('Back to reference');
    expect(msg2Backrefs[0]!.getAttribute('title')).toBe('Back to reference');

    // Clicking message 2's [1] ref scrolls and focuses message 2's footnote item, not message 1's.
    expect(fireEvent.click(msg2Refs[0]!)).toBe(false);
    expect(window.location.hash).toBe('');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(msg2Item);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'nearest' });
    expect(document.activeElement).toBe(msg2Item);
    expect(msg2Item.hasAttribute('data-footnote-highlight')).toBe(true);
    expect(msg1Item.hasAttribute('data-footnote-highlight')).toBe(false);

    vi.advanceTimersByTime(1500);
    expect(msg2Item.hasAttribute('data-footnote-highlight')).toBe(false);

    // Clicking message 2's second backref jumps back to message 2's [1:1] reference.
    scrollIntoView.mockClear();
    expect(fireEvent.click(msg2Backrefs[1]!)).toBe(false);
    expect(window.location.hash).toBe('');
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(msg2Refs[1]);
    expect(document.activeElement).toBe(msg2Refs[1]);
  });

  it('uses instant scrolling under prefers-reduced-motion', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      writable: true,
      value: vi.fn((query: string) => ({ matches: query === '(prefers-reduced-motion: reduce)' })),
    });

    const html = renderLiveMarkdown('Note[^1].\n\n[^1]: Detail.')!;
    const { container } = render(
      <ClientConfigProvider value={{}}>
        <RenderBody
          body="Note[^1]."
          customBody={html}
          htmlReactParserOptions={makeParserOptions()}
          linkifyOpts={LINKIFY_OPTS}
        />
      </ClientConfigProvider>
    );

    fireEvent.click(container.querySelector('sup.footnote-ref a')!);
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'auto', block: 'nearest' });
  });

  it('falls back safely when rendered outside RenderBody and keeps external links checked', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      writable: true,
      value: scrollIntoView,
    });

    const html = sanitizeCustomHtml(
      [
        renderLiveMarkdown('Note[^1].\n\n[^1]: Detail.')!,
        '<p><a href="https://example.com" id="fnref1">External</a></p>',
      ].join('')
    );
    const { container } = render(
      <MessageLinkHostContext.Provider value="timeline">
        {parseHtml(html, makeParserOptions())}
      </MessageLinkHostContext.Provider>
    );

    const refLink = container.querySelector<HTMLAnchorElement>('sup.footnote-ref a')!;
    const item = container.querySelector<HTMLLIElement>('li.footnote-item')!;
    expect(refLink.id).toBe('fnref1');
    expect(item.id).toBe('fn1');

    fireEvent.click(refLink);
    expect(document.activeElement).toBe(item);

    const externalLink = [...container.querySelectorAll<HTMLAnchorElement>('a')].find(
      (link) => link.textContent === 'External'
    )!;
    expect(externalLink.getAttribute('data-message-link')).toBe('timeline');
    expect(externalLink.getAttribute('title')).toBe('https://example.com');
    expect(externalLink.getAttribute('target')).toBe('_blank');
    expect(externalLink.getAttribute('rel')).toBe('noreferrer noopener');
    expect(externalLink.id).toBe('');
  });
});
