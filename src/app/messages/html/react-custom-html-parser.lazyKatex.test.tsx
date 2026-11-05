import parse from 'html-react-parser';
import type { MatrixClient } from 'matrix-js-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';

// A loaded machine can take seconds to load a lazy module's code.
const LOAD_WAIT = { timeout: 60_000, interval: 20 };
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 });

vi.mock('../../rich-text/CustomHtml.css', () => ({
  Mention: () => 'Mention',
  Spoiler: () => 'Spoiler',
  Emoticon: () => 'Emoticon',
}));
vi.mock('../../rich-text/matrixMath.css', () => ({
  MathInline: 'MathInline',
  MathBlock: 'MathBlock',
}));
vi.mock('../../rich-text/ScrollableTable.css', () => ({}));
vi.mock('./HtmlBlocks.css', () => ({}));
vi.mock('../../approvals/ApprovalArgumentFields.css', () => ({}));

type Parser = typeof import('./react-custom-html-parser');
type Katex = typeof import('../../rich-text/lazyKatex');
let parser: Parser;
let katex: Katex;

// The test setup loads KaTeX for every file; fresh modules start without it, as the app does.
beforeAll(async () => {
  vi.resetModules();
  parser = await import('./react-custom-html-parser');
  katex = await import('../../rich-text/lazyKatex');
});

let renderer: ReactTestRenderer | undefined;

afterEach(() => {
  act(() => renderer?.unmount());
  renderer = undefined;
});

it('typesets math of a message rendered before KaTeX loaded once KaTeX arrives', async () => {
  const { LINKIFY_OPTS, getReactCustomHtmlParser } = parser;
  const { isKatexLoaded } = katex;
  const options = getReactCustomHtmlParser({} as MatrixClient, undefined, {
    linkifyOpts: LINKIFY_OPTS,
  });

  act(() => {
    renderer = create(
      <>{parse('Area $\\pi r^2$ and <span data-mx-maths="x^2">x^2</span>, for $5 USD.', options)}</>
    );
  });
  const before = JSON.stringify(renderer!.toJSON());
  expect(isKatexLoaded()).toBe(false);
  expect(before).toContain('$\\\\pi r^2$');
  expect(before).toContain('x^2');
  expect(before).not.toContain('katex');

  await act(async () => {
    await vi.waitFor(() => expect(isKatexLoaded()).toBe(true), LOAD_WAIT);
  });
  const after = JSON.stringify(renderer!.toJSON());
  // Both the dollar math of the text and the Matrix math element are typeset now.
  expect(after.match(/class=\\"katex\\"/g)).toHaveLength(2);
  expect(after).toContain('for $5 USD.');
});

it('typesets in the first render once KaTeX has loaded', async () => {
  const { LINKIFY_OPTS, getReactCustomHtmlParser } = parser;
  await katex.loadKatex();
  const options = getReactCustomHtmlParser({} as MatrixClient, undefined, {
    linkifyOpts: LINKIFY_OPTS,
  });

  const html = renderToStaticMarkup(<>{parse('Area $x^2$', options)}</>);

  expect(html).toContain('class="katex"');
});
