// @vitest-environment jsdom
import parseDOM from 'html-dom-parser';
import { isTag, isText, type Element } from 'domhandler';
import { cleanup, render } from '@testing-library/react';
import i18next from 'i18next';
import { afterEach, describe, expect, it } from 'vitest';
import { Callout, extractCallout, type CalloutType } from './Callout';

afterEach(cleanup);

const parseBlockquote = (html: string): Element => {
  const [node] = parseDOM(html);
  if (!node || !isTag(node) || node.name !== 'blockquote') {
    throw new Error(`Expected blockquote root, got: ${html}`);
  }
  return node;
};

describe('extractCallout', () => {
  it.each<[string, CalloutType]>([
    ['[!NOTE]', 'note'],
    ['[!tip]', 'tip'],
    ['[!Important]', 'important'],
    ['[!WARNING]   ', 'warning'],
    ['  [!caution]', 'caution'],
  ])('parses %s case-insensitively with optional surrounding spaces', (marker, expected) => {
    const bq = parseBlockquote(`<blockquote>\n<p>${marker}<br>\nBody text</p>\n</blockquote>`);
    const result = extractCallout(bq.children);
    expect(result?.type).toBe(expected);
    expect(result?.bodyNodes).toHaveLength(1);
    const p = result?.bodyNodes[0];
    expect(p && isTag(p) && p.name).toBe('p');
    expect(p && isTag(p) && p.children[0] && isText(p.children[0]) && p.children[0].data).toBe(
      'Body text'
    );
  });

  it('drops the marker-only paragraph and keeps following blocks', () => {
    const bq = parseBlockquote(
      '<blockquote>\n<p>[!WARNING]</p>\n<p>Body 1</p>\n<p>Body 2</p>\n</blockquote>'
    );
    const result = extractCallout(bq.children);
    expect(result?.type).toBe('warning');
    const tags = (result?.bodyNodes ?? []).filter(isTag).map((node) => node.name);
    expect(tags).toEqual(['p', 'p']);
  });

  it('parses composer direct-child blockquotes and trims blank lines and trailing br', () => {
    const withBlankLine = parseBlockquote(
      '<blockquote data-md=">">[!NOTE]<br/><br/>Line 1<br/>Line 2<br/></blockquote>'
    );
    const parsed = extractCallout(withBlankLine.children);
    expect(parsed?.type).toBe('note');
    expect(
      parsed?.bodyNodes.map((n) => (isText(n) ? n.data : isTag(n) ? `<${n.name}>` : ''))
    ).toEqual(['Line 1', '<br>', 'Line 2']);

    const directNewline = parseBlockquote('<blockquote>[!TIP]\nDirect body</blockquote>');
    const parsedDirect = extractCallout(directNewline.children);
    expect(parsedDirect?.type).toBe('tip');
    expect(parsedDirect?.bodyNodes).toHaveLength(1);
    expect(
      parsedDirect?.bodyNodes[0] &&
        isText(parsedDirect.bodyNodes[0]) &&
        parsedDirect.bodyNodes[0].data
    ).toBe('Direct body');
  });

  it.each([
    '<blockquote><p>[!NOTE]</p></blockquote>',
    '<blockquote>\n<p>[!NOTE]<br>\n</p>\n</blockquote>',
    '<blockquote data-md=">">[!NOTE]<br/></blockquote>',
    '<blockquote>[!NOTE]\n</blockquote>',
  ])('returns empty bodyNodes for marker-alone %s', (html) => {
    const result = extractCallout(parseBlockquote(html).children);
    expect(result).toEqual({ type: 'note', bodyNodes: [] });
  });

  it.each([
    '<blockquote><p>[!NOTE] hello</p></blockquote>',
    '<blockquote><p>[!NOTE] <strong>bold</strong></p></blockquote>',
    '<blockquote><p>[!FOO]<br>text</p></blockquote>',
    '<blockquote><p><code>[!NOTE]</code><br>text</p></blockquote>',
    '<blockquote><p><strong>[!NOTE]</strong><br>text</p></blockquote>',
    '<blockquote><p>First</p><p>[!NOTE]<br>Second</p></blockquote>',
    '<blockquote data-md=">"><br/>[!NOTE]<br/>Body<br/></blockquote>',
  ])('returns undefined for non-callout %s', (html) => {
    expect(extractCallout(parseBlockquote(html).children)).toBeUndefined();
  });

  it('does not mutate input DOM nodes and is idempotent across calls', () => {
    const bq = parseBlockquote('<blockquote><p>[!NOTE]<br>\nKeep <code>x</code></p></blockquote>');
    const originalP = bq.children[0] as Element;
    const originalChildCount = originalP.children.length;
    const originalFirstText = (originalP.children[0] as { data: string }).data;

    const first = extractCallout(bq.children);
    const second = extractCallout(bq.children);

    expect(originalP.children).toHaveLength(originalChildCount);
    expect((originalP.children[0] as { data: string }).data).toBe(originalFirstText);
    expect(first?.type).toBe('note');
    expect(second?.type).toBe('note');
    expect(first?.bodyNodes[0]).not.toBe(originalP);
  });
});

describe('Callout', () => {
  it.each<[CalloutType, string]>([
    ['note', 'Note'],
    ['tip', 'Tip'],
    ['important', 'Important'],
    ['warning', 'Warning'],
    ['caution', 'Caution'],
  ])(
    'renders %s with role="note", aria-labelledby, decorative icon, and localized title',
    (type, title) => {
      const { container } = render(
        <Callout type={type}>
          <p>Body copy</p>
        </Callout>
      );
      const aside = container.querySelector('aside');
      expect(aside?.getAttribute('role')).toBe('note');
      expect(aside?.getAttribute('data-callout-type')).toBe(type);
      const labelledBy = aside?.getAttribute('aria-labelledby');
      expect(labelledBy).toBeTruthy();
      const header = labelledBy ? container.querySelector(`[id="${labelledBy}"]`) : null;
      expect(header?.textContent).toBe(title);
      expect(header?.getAttribute('dir')).toBeNull();
      expect(header?.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
      const body = aside?.children[1];
      expect(body?.getAttribute('dir')).toBe('auto');
      expect(body?.textContent).toBe('Body copy');
    }
  );

  it('sets dir from i18n.dir() on aside and dir="auto" on body inside an LTR wrapper', async () => {
    i18next.addResourceBundle(
      'ar',
      'translation',
      { sharedUi: { callout: { note: 'ملاحظة' } } },
      true,
      true
    );
    await i18next.changeLanguage('ar');
    try {
      const { container } = render(
        <div dir="ltr">
          <Callout type="note">
            <p>مرحبا بالعالم</p>
          </Callout>
        </div>
      );
      const aside = container.querySelector('aside');
      const header = aside?.children[0];
      const body = aside?.children[1];
      expect(aside?.getAttribute('dir')).toBe('rtl');
      expect(header?.getAttribute('dir')).toBeNull();
      expect(header?.textContent).toBe('ملاحظة');
      expect(body?.getAttribute('dir')).toBe('auto');
      expect(body?.textContent).toBe('مرحبا بالعالم');
    } finally {
      cleanup();
      await i18next.changeLanguage('en');
      i18next.removeResourceBundle('ar', 'translation');
    }
  });

  it('omits the body container when rendered without children', () => {
    const { container } = render(<Callout type="note" />);
    const aside = container.querySelector('aside');
    expect(aside?.children).toHaveLength(1);
    expect(aside?.textContent).toBe('Note');
  });
});
