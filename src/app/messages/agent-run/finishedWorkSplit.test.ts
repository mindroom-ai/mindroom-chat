import { describe, expect, it } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { isLongAgentReply, splitFinishedWork } from './finishedWorkSplit';
import backendBodies from '../__fixtures__/backendToolMarkerBodies.json';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from '../html/react-custom-html-parser';

const mx = {
  getHomeserverUrl: () => 'https://example.org',
  mxcUrlToHttp: () => 'https://example.org/a',
} as unknown as MatrixClient;
// The app's base parser, which decides where the renderer draws calls (lists draw none).
const baseOpts = getReactCustomHtmlParser(mx, undefined, {
  linkifyOpts: LINKIFY_OPTS,
});
const split = (html: string) => splitFinishedWork(html, baseOpts);

const marker = (name: string, n: number) => `<p>🔧 <code>${name}</code> [${n}]</p>`;

describe('splitFinishedWork', () => {
  it('returns undefined without a tool marker', () => {
    expect(split('<p>hi</p>')).toBeUndefined();
  });

  it('returns undefined when the reply ends in a tool marker', () => {
    expect(split(`<p>a</p>${marker('shell', 1)}`)).toBeUndefined();
  });

  it('returns undefined when only whitespace follows', () => {
    expect(split(`${marker('shell', 1)}\n  `)).toBeUndefined();
  });

  it('returns undefined when only an empty paragraph follows', () => {
    expect(split(`${marker('shell', 1)}<p> </p>`)).toBeUndefined();
  });

  it('returns undefined when only the pending mark follows', () => {
    expect(split(`${marker('shell', 1)}<p>⏳</p>`)).toBeUndefined();
  });

  it('returns undefined when only content the renderer drops follows', () => {
    expect(split(`${marker('shell', 1)}<script>x</script>`)).toBeUndefined();
  });

  it('splits before an answer that is only an image', () => {
    const image = '<p><img src="mxc://example.org/a" alt="Answer"></p>';
    expect(split(`${marker('shell', 1)}${image}`)?.tail).toBe(image);
  });

  it('drops comments, which are not text', () => {
    expect(split(`${marker('shell', 1)}<!-- note -->`)).toBeUndefined();
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
    const work = `<div>🔧 <code>shell</code> [1]${marker('grep', 2)}</div>`;
    expect(split(`${work}<p>done</p>`)).toEqual({ head: work, tail: '<p>done</p>' });
  });

  it('keeps in the work a marker that would draw as a call in the answer alone', () => {
    // The whole body shows call 2 as text: its name holds the index of a call drawn before it.
    const work = `${marker('x', 1)}<p>🔧 <code>a [1] b</code> [2]</p>`;
    expect(split(`${work}<p>Answer</p>`)).toEqual({ head: work, tail: '<p>Answer</p>' });
  });

  it('ignores marker-like text inside a code block', () => {
    expect(split('<pre><code>🔧 <code>shell</code> [1]</code></pre><p>x</p>')).toBeUndefined();
    expect(split('<pre><code>🔧 `shell` [1]</code></pre><p>x</p>')).toBeUndefined();
  });

  it('ignores a marker inside a paragraph', () => {
    expect(split('<p>text<br>🔧 <code>search</code> [1]<br>more</p>')).toBeUndefined();
  });

  it('treats a pending marker as a marker', () => {
    expect(split(`${marker('shell', 1).replace('</p>', ' ⏳</p>')}<p>x</p>`)?.tail).toBe(
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
});

describe('isLongAgentReply', () => {
  const textMarker = (name: string, n: number, pending = false) =>
    `🔧 \`${name}\` [${n}]${pending ? ' ⏳' : ''}`;

  it('is long from 6000 characters on', () => {
    expect(isLongAgentReply('a'.repeat(5999))).toBe(false);
    expect(isLongAgentReply('a'.repeat(6000))).toBe(true);
  });

  it('counts each tool marker line as 80 characters, as it renders as a full row', () => {
    const line = textMarker('shell', 1);
    expect(line.length).toBeLessThan(80);
    // 5999 - 80 - 1 (the newline) = 5918 characters of text and one marker: 5999 in all.
    expect(isLongAgentReply(`${'a'.repeat(5918)}\n${line}`)).toBe(false);
    expect(isLongAgentReply(`${'a'.repeat(5919)}\n${line}`)).toBe(true);
    // 75 markers and their 74 newlines: 75 * 80 + 74 = 6074.
    const markers = Array.from({ length: 75 }, (_, i) => textMarker('read_file', i + 1));
    expect(markers.join('\n').length).toBeLessThan(6000);
    expect(isLongAgentReply(markers.join('\n'))).toBe(true);
  });

  it('weights a marker line with a long tool name as 80 characters too', () => {
    const line = textMarker('x'.repeat(200), 1);
    expect(isLongAgentReply(`${'a'.repeat(5000)}\n${line}`)).toBe(false);
  });

  it('counts a pending marker, with its hourglass, as a marker', () => {
    const line = textMarker('shell', 1, true);
    expect(isLongAgentReply(`${'a'.repeat(5918)}\n${line}`)).toBe(false);
    expect(isLongAgentReply(`${'a'.repeat(5919)}\n${line}`)).toBe(true);
  });

  it('counts a marker inside a line of text as text', () => {
    const line = `see ${textMarker('shell', 1)} here`;
    expect(isLongAgentReply(`${'a'.repeat(5999 - line.length - 1)}\n${line}`)).toBe(false);
  });
});
