import { describe, expect, it } from 'vitest';
import { formatWorkDuration, splitFinishedWork } from './finishedWorkSplit';
import backendBodies from '../__fixtures__/backendToolMarkerBodies.json';

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

  it('splits after the last marker', () => {
    expect(
      splitFinishedWork(`<p>a</p>${marker('shell', 1)}<p>b</p>${marker('grep', 2)}<p>done</p>`)
    ).toEqual({
      head: `<p>a</p>${marker('shell', 1)}<p>b</p>${marker('grep', 2)}`,
      tail: '<p>done</p>',
    });
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

  it('returns the same result for the same HTML', () => {
    const html = `${marker('shell', 1)}<p>x</p>`;
    expect(splitFinishedWork(html)).toBe(splitFinishedWork(html));
  });
});

describe('formatWorkDuration', () => {
  it.each([
    [45_000, '45s'],
    [133_000, '2m 13s'],
    [3_840_000, '1h 4m'],
    [400, '0s'],
  ])('formats %d ms as %s', (ms, label) => {
    expect(formatWorkDuration(ms)).toBe(label);
  });
});
