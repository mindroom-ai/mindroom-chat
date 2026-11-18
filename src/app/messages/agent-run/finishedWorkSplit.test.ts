import { describe, expect, it } from 'vitest';
import { isLongAgentReply, splitFinishedWork } from './finishedWorkSplit';
import backendBodies from '../__fixtures__/backendToolMarkerBodies.json';
import { getRenderedToolRefs } from './toolRefDom';
import { sanitizeCustomHtml } from '../../rich-text/sanitize';

const marker = (name: string, n: number) => `<p>🔧 <code>${name}</code> [${n}]</p>`;

describe('splitFinishedWork', () => {
  it('returns undefined without a tool marker', () => {
    expect(splitFinishedWork('<p>hi</p>')).toBeUndefined();
  });

  it('returns undefined when the reply ends in a tool marker', () => {
    expect(splitFinishedWork(`<p>a</p>${marker('shell', 1)}`)).toBeUndefined();
  });

  it('returns undefined when only whitespace follows', () => {
    expect(splitFinishedWork(`${marker('shell', 1)}\n  `)).toBeUndefined();
  });

  it('returns undefined when only an empty paragraph follows', () => {
    expect(splitFinishedWork(`${marker('shell', 1)}<p> </p>`)).toBeUndefined();
  });

  it('returns undefined when only the pending mark follows', () => {
    expect(splitFinishedWork(`${marker('shell', 1)}<p>⏳</p>`)).toBeUndefined();
  });

  it('returns undefined when only content the renderer drops follows', () => {
    expect(splitFinishedWork(`${marker('shell', 1)}<script>x</script>`)).toBeUndefined();
  });

  it('splits before an answer that is only an image', () => {
    const image = '<p><img src="mxc://example.org/a" alt="Answer"></p>';
    expect(splitFinishedWork(`${marker('shell', 1)}${image}`)?.tail).toBe(image);
  });

  it('drops comments, which are not text', () => {
    expect(splitFinishedWork(`${marker('shell', 1)}<!-- note -->`)).toBeUndefined();
    expect(splitFinishedWork(`<p>a</p><!-- b -->${marker('shell', 1)}<!-- c --><p>x</p>`)).toEqual({
      head: `<p>a</p>${marker('shell', 1)}`,
      tail: '<p>x</p>',
    });
  });

  it('splits after the last marker', () => {
    expect(
      splitFinishedWork(`<p>a</p>${marker('shell', 1)}<p>b</p>${marker('grep', 2)}<p>done</p>`)
    ).toEqual({
      head: `<p>a</p>${marker('shell', 1)}<p>b</p>${marker('grep', 2)}`,
      tail: '<p>done</p>',
    });
  });

  it('splits after a last marker the renderer shows inside a div or details', () => {
    for (const wrapper of ['div', 'details']) {
      const nested = `<${wrapper}>${marker('grep', 2)}</${wrapper}>`;
      expect(splitFinishedWork(`${marker('shell', 1)}<p>b</p>${nested}<p>done</p>`)).toEqual({
        head: `${marker('shell', 1)}<p>b</p>${nested}`,
        tail: '<p>done</p>',
      });
    }
  });

  it('ignores marker-like text inside a code block', () => {
    expect(
      splitFinishedWork('<pre><code>🔧 <code>shell</code> [1]</code></pre><p>x</p>')
    ).toBeUndefined();
    expect(splitFinishedWork('<pre><code>🔧 `shell` [1]</code></pre><p>x</p>')).toBeUndefined();
  });

  it('ignores a marker inside a paragraph', () => {
    expect(splitFinishedWork('<p>text<br>🔧 <code>search</code> [1]<br>more</p>')).toBeUndefined();
  });

  it('treats a pending marker as a marker', () => {
    expect(
      splitFinishedWork(`${marker('shell', 1).replace('</p>', ' ⏳</p>')}<p>x</p>`)?.tail
    ).toBe('<p>x</p>');
  });

  it('keeps entities, attributes and void elements', () => {
    expect(
      splitFinishedWork(
        `<p>a &amp; &lt;b&gt;</p>${marker(
          'shell',
          1
        )}<p><a href="https://x.test/?a=1&amp;b=&quot;2&quot;">l</a><br>c</p>`
      )
    ).toEqual({
      head: `<p>a &amp; &lt;b&gt;</p>${marker('shell', 1)}`,
      tail: '<p><a href="https://x.test/?a=1&amp;b=&quot;2&quot;">l</a><br>c</p>',
    });
  });

  it('splits the backend HTML of a reply with grouped calls after the last one', () => {
    const { formatted_body: html } = backendBodies['grouped and pending tool calls'];
    expect(splitFinishedWork(html)).toEqual({
      head: '<p>Let me check.</p>\n<p>🔧 <code>search_web</code> [1]</p>\n<p>🔧 <code>read_file</code> [2] ⏳</p>',
      tail: '\n<p>It is sunny.</p>\n',
    });
  });

  it('does not split the backend HTML of a reply that ends in a tool call', () => {
    expect(
      splitFinishedWork(backendBodies['leading and trailing tool calls'].formatted_body)
    ).toBeUndefined();
  });

  // Reasoning segments and compaction seams render after a rendered tool marker, or at the top,
  // so each one folds with the work only while every rendered marker falls in the head.
  it.each(Object.entries(backendBodies))(
    'keeps every rendered tool marker of the backend HTML in the work: %s',
    (_name, { formatted_body: html }) => {
      const split = splitFinishedWork(html);
      if (!split) return;
      // As `Reasoning` reads the markers it places seams and thinking after.
      const placed = (part: string) =>
        getRenderedToolRefs(sanitizeCustomHtml(part), true).toolBlocks.map(({ index }) => index);
      expect(placed(split.head)).toEqual(placed(html));
      expect(placed(split.tail)).toEqual([]);
    }
  );
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
