import { describe, expect, it } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { isText, type ChildNode } from 'domhandler';
import { sanitizeCustomHtml, sanitizeText } from '../../rich-text/sanitize';
import { splitFinishedWorkDom } from './finishedWorkSplit';
import { parseRenderedHtml } from './replyDom';
import { isDomElementNode } from './toolRefDom';
import backendBodies from '../__fixtures__/backendToolMarkerBodies.json';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from '../html/react-custom-html-parser';

const VOID_TAGS = new Set(['br', 'hr', 'img', 'input', 'wbr']);
const serializeDom = (nodes: readonly ChildNode[]): string =>
  nodes
    .map((node) => {
      if (isText(node)) return sanitizeText(node.data);
      if (!isDomElementNode(node)) return '';
      const attrs = Object.entries(node.attribs)
        .map(([name, value]) => ` ${name}="${sanitizeText(value)}"`)
        .join('');
      return VOID_TAGS.has(node.name)
        ? `<${node.name}${attrs}>`
        : `<${node.name}${attrs}>${serializeDom(node.children)}</${node.name}>`;
    })
    .join('');

const mx = {
  getHomeserverUrl: () => 'https://example.org',
  mxcUrlToHttp: () => 'https://example.org/a',
} as unknown as MatrixClient;
// The app's base parser, which decides where the renderer draws calls (lists draw none).
const baseOpts = getReactCustomHtmlParser(mx, undefined, {
  linkifyOpts: LINKIFY_OPTS,
});
const split = (html: string) => {
  const dom = parseRenderedHtml(sanitizeCustomHtml(html, {}), baseOpts);
  const result = splitFinishedWorkDom(dom, baseOpts).split;
  return result
    ? { head: serializeDom(result.work), tail: serializeDom(result.answer) }
    : undefined;
};

const marker = (name: string, n: number) => `<p>🔧 <code>${name}</code> [${n}]</p>`;
// Text before the calls, without which a reply does not fold.
const note = '<p>Checking.</p>';

describe('splitFinishedWorkDom', () => {
  it('returns undefined without a tool marker', () => {
    expect(split('<p>hi</p>')).toBeUndefined();
  });

  it('returns toolCallIndexes alongside the split result', () => {
    const dom = parseRenderedHtml(
      sanitizeCustomHtml(`${note}${marker('shell', 1)}${marker('grep', 2)}<p>Done.</p>`, {}),
      baseOpts
    );
    const result = splitFinishedWorkDom(dom, baseOpts);
    expect(result.toolCallIndexes).toEqual([1, 2]);
    expect(result.split).toBeDefined();
  });

  it('returns undefined when the reply ends in a tool marker', () => {
    expect(split(`<p>a</p>${marker('shell', 1)}`)).toBeUndefined();
  });

  it('returns undefined when only whitespace follows', () => {
    expect(split(`${note}${marker('shell', 1)}\n  `)).toBeUndefined();
  });

  it('returns undefined when only an empty paragraph follows', () => {
    expect(split(`${note}${marker('shell', 1)}<p> </p>`)).toBeUndefined();
  });

  it('returns undefined when only the pending mark follows', () => {
    expect(split(`${note}${marker('shell', 1)}<p>⏳</p>`)).toBeUndefined();
  });

  it('returns undefined when only content the renderer drops follows', () => {
    expect(split(`${note}${marker('shell', 1)}<script>x</script>`)).toBeUndefined();
  });

  it('splits before an answer that is only an image', () => {
    const image = '<p><img src="mxc://example.org/a" alt="Answer"></p>';
    expect(split(`${note}${marker('shell', 1)}${image}`)?.tail).toBe(image);
  });

  it('drops comments, which are not text', () => {
    expect(split(`${note}${marker('shell', 1)}<!-- note -->`)).toBeUndefined();
    expect(split(`<p>a</p><!-- b -->${marker('shell', 1)}<!-- c --><p>x</p>`)).toEqual({
      head: `<p>a</p>${marker('shell', 1)}`,
      tail: '<p>x</p>',
    });
  });

  it('splits after the last marker', () => {
    expect(split(`<p>a</p>${marker('shell', 1)}<p>b</p>${marker('grep', 2)}<p>done</p>`)).toEqual({
      head: `<p>a</p>${marker('shell', 1)}<p>b</p>${marker('grep', 2)}`,
      tail: '<p>done</p>',
    });
  });

  it('splits after a last marker the renderer shows inside a div or details', () => {
    for (const wrapper of ['div', 'details']) {
      const nested = `<${wrapper}>${marker('grep', 2)}</${wrapper}>`;
      expect(split(`${marker('shell', 1)}<p>b</p>${nested}<p>done</p>`)).toEqual({
        head: `${marker('shell', 1)}<p>b</p>${nested}`,
        tail: '<p>done</p>',
      });
    }
  });

  it('splits after a div holding a direct call, then a call in a paragraph', () => {
    const work = `${note}<div>🔧 <code>shell</code> [1]${marker('grep', 2)}</div>`;
    expect(split(`${work}<p>done</p>`)).toEqual({ head: work, tail: '<p>done</p>' });
  });

  it('keeps in the work a marker that would draw as a call in the answer alone', () => {
    // The whole body shows call 2 as text: its name holds the index of a call drawn before it.
    const work = `${note}${marker('x', 1)}<p>🔧 <code>a [1] b</code> [2]</p>`;
    expect(split(`${work}<p>Answer</p>`)).toEqual({ head: work, tail: '<p>Answer</p>' });
  });

  it('folds the work as the DOM says, not as finding its last call left it', () => {
    // Chromium writes a paragraph that starts with line breaks this way; drawing its call takes
    // one of them, so the work must be cut from the unmodified DOM.
    const work = `${note}${marker('shell', 1)}<p><br><br>🔧 <code>grep</code> [2]</p>${marker(
      'read',
      3
    )}`;
    expect(split(`${work}<p>done</p>`)).toEqual({ head: work, tail: '<p>done</p>' });
  });

  it('ignores marker-like text inside a code block', () => {
    expect(split('<pre><code>🔧 <code>shell</code> [1]</code></pre><p>x</p>')).toBeUndefined();
    expect(split('<pre><code>🔧 `shell` [1]</code></pre><p>x</p>')).toBeUndefined();
  });

  it('ignores a marker inside a paragraph', () => {
    expect(split('<p>text<br>🔧 <code>search</code> [1]<br>more</p>')).toBeUndefined();
  });

  it('treats a pending marker as a marker', () => {
    expect(split(`${note}${marker('shell', 1).replace('</p>', ' ⏳</p>')}<p>x</p>`)?.tail).toBe(
      '<p>x</p>'
    );
  });

  it('keeps entities, attributes and void elements', () => {
    expect(
      split(
        `<p>a &amp; &lt;b&gt;</p>${marker(
          'shell',
          1
        )}<p><a href="https://x.test/?a=1&amp;b=&quot;2&quot;">l</a><br>c</p>`
      )
    ).toEqual({
      head: `<p>a &amp; &lt;b&gt;</p>${marker('shell', 1)}`,
      // Sanitized as the body renders it, which opens links in a new tab.
      tail: '<p><a href="https://x.test/?a=1&amp;b=&quot;2&quot;" target="_blank" rel="noreferrer noopener">l</a><br>c</p>',
    });
  });

  it('starts the answer at the prose that follows the last call in its paragraph', () => {
    const calls = '<p>🔧 <code>a</code> [1]<br>\n🔧 <code>b</code> [2]';
    expect(split(`<p>x</p>${calls}<br>Answer <em>here</em>.</p><p>More.</p>`)).toEqual({
      head: `<p>x</p>${calls}</p>`,
      tail: '<p>Answer <em>here</em>.</p><p>More.</p>',
    });
  });

  it('splits after a wrapper whose text before its calls is work', () => {
    const work = `<details><summary>Checks</summary>${marker('b', 2)}</details>`;
    expect(split(`${marker('a', 1)}${work}<p>Answer.</p>`)).toEqual({
      head: `${marker('a', 1)}${work}`,
      tail: '<p>Answer.</p>',
    });
  });

  it('does not split where the answer starts in a node that does not cut cleanly', () => {
    expect(
      split(`${note}<div>🔧 <code>shell</code> [1]<p>Answer</p></div><p>More.</p>`)
    ).toBeUndefined();
  });

  it('splits the backend HTML of a reply with grouped calls after the last one', () => {
    const { formatted_body: html } = backendBodies['grouped and pending tool calls'];
    expect(split(html)).toEqual({
      head: '<p>Let me check.</p>\n<p>🔧 <code>search_web</code> [1]</p>\n<p>🔧 <code>read_file</code> [2] ⏳</p>',
      tail: '\n<p>It is sunny.</p>\n',
    });
  });

  it('does not split the backend HTML of a reply that ends in a tool call', () => {
    expect(split(backendBodies['leading and trailing tool calls'].formatted_body)).toBeUndefined();
  });

  it('splits a reply of one tool call and a one-line answer', () => {
    expect(split(`${note}${marker('shell', 1)}<p>Done.</p>`)).toEqual({
      head: `${note}${marker('shell', 1)}`,
      tail: '<p>Done.</p>',
    });
  });

  it('keeps a table in the answer whole', () => {
    // As the backend's Markdown renderer writes it, a newline between each pair of tags.
    const table =
      '<table>\n<thead>\n<tr>\n<th>a</th>\n</tr>\n</thead>\n<tbody>\n<tr>\n<td>1</td>\n</tr>\n</tbody>\n</table>';
    expect(split(`<p>Line.</p>\n${marker('shell', 1)}\n${table}`)).toEqual({
      head: `<p>Line.</p>\n${marker('shell', 1)}`,
      tail: `\n${table}`,
    });
  });

  it('does not split a reply of only calls before its answer', () => {
    expect(split(`${marker('shell', 1)}${marker('grep', 2)}<p>Done.</p>`)).toBeUndefined();
  });

  it('splits a reply with text before its calls', () => {
    expect(split(`${note}${marker('shell', 1)}${marker('grep', 2)}<p>Done.</p>`)).toEqual({
      head: `${note}${marker('shell', 1)}${marker('grep', 2)}`,
      tail: '<p>Done.</p>',
    });
  });

  it('splits a reply whose only text before the answer is between two calls', () => {
    const work = `${marker('shell', 1)}<p>Now the logs.</p>${marker('grep', 2)}`;
    expect(split(`${work}<p>Done.</p>`)).toEqual({ head: work, tail: '<p>Done.</p>' });
  });

  it('does not split when the work shows nothing but its calls', () => {
    for (const filler of ['<p><br></p>', '<p>⏳</p>', '<p> </p>', '<p></p>', '<p>\u200B</p>']) {
      expect(split(`${filler}${marker('shell', 1)}<p>Done.</p>`)).toBeUndefined();
    }
  });

  it('does not split when a wrapper before the answer holds only calls', () => {
    expect(
      split(`<div>🔧 <code>shell</code> [1]${marker('grep', 2)}</div><p>Done.</p>`)
    ).toBeUndefined();
  });

  it('does not split when the work repeats a drawn call', () => {
    for (const work of [
      `${marker('a', 1)}${marker('b', 1)}`,
      `${marker('a', 1)}${marker('b', 2)}${marker('c', 2)}`,
      `${marker('a', 1)}<p></p>${marker('c', 1)}`,
    ]) {
      expect(split(`${work}<p>Done.</p>`)).toBeUndefined();
    }
  });

  it('counts a marker the reply shows as text before its calls as work', () => {
    const { formatted_body: html } = backendBodies['tool call inside a block quote'];
    expect(split(html)).toEqual({
      head: '<blockquote>\n<p>🔧 <code>x</code> [1]</p>\n</blockquote>\n<p>🔧 <code>y</code> [2]</p>',
      tail: '\n<p>Answer</p>\n',
    });
    const list = '<ul><li>🔧 <code>shell</code> [1]</li></ul>';
    expect(split(`${list}${marker('grep', 2)}<p>Done.</p>`)).toEqual({
      head: `${list}${marker('grep', 2)}`,
      tail: '<p>Done.</p>',
    });
  });

  it('counts an image before the calls as work', () => {
    const image = '<p><img src="mxc://example.org/a" alt="Chart"></p>';
    expect(split(`${image}${marker('shell', 1)}<p>Done.</p>`)).toEqual({
      head: `${image}${marker('shell', 1)}`,
      tail: '<p>Done.</p>',
    });
  });

  it('does not split when a footnote link crosses between work and answer', () => {
    const footnoteDef =
      '<hr class="footnotes-sep"><section class="footnotes"><ol class="footnotes-list">' +
      '<li id="fn1" class="footnote-item"><p>Detail. ' +
      '<a href="#fnref1" class="footnote-backref">↩︎</a></p></li></ol></section>';
    const crossBoundary =
      `<p>Checking<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>.</p>` +
      `${marker('web_search', 1)}<p>Done.</p>${footnoteDef}`;
    expect(split(crossBoundary)).toBeUndefined();

    const selfContainedAnswer =
      `<p>Checking.</p>${marker('web_search', 1)}` +
      `<p>Done<sup class="footnote-ref"><a href="#fn1" id="fnref1">[1]</a></sup>.</p>${footnoteDef}`;
    const result = split(selfContainedAnswer);
    expect(result).toBeDefined();
    expect(result?.head).toBe(`<p>Checking.</p>${marker('web_search', 1)}`);
    expect(result?.tail).toContain('id="fnref1"');
    expect(result?.tail).toContain('id="fn1"');
  });
});
