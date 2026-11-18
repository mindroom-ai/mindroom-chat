import { describe, expect, it } from 'vitest';
import type { MatrixClient } from 'matrix-js-sdk';
import { foldFinishedWork, splitFinishedWork } from './finishedWorkSplit';
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
const split = (html: string) => splitFinishedWork(html, baseOpts, {});

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

  it('folds the work as the HTML says, not as finding its last call left it', () => {
    // Chromium writes a paragraph that starts with line breaks this way; drawing its call takes
    // one of them, so the work must be cut from the HTML itself.
    const work = `${marker('shell', 1)}<p><br><br>🔧 <code>grep</code> [2]</p>${marker('read', 3)}`;
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

describe('foldFinishedWork', () => {
  const note = (n: number) => `Note ${n} on what the calls found.`;
  /** A reply of runs of calls with a note after each, then an answer of `answer` short lines. */
  const reply = (runs: number[], answer: number, toolCallsShown = true, seamRows = 0) => {
    let call = 0;
    const html: string[] = ['<p>Intro.</p>'];
    const body: string[] = ['Intro.'];
    runs.forEach((size, run) => {
      Array.from({ length: size }).forEach(() => {
        call += 1;
        html.push(marker('shell', call));
        body.push(`🔧 \`shell\` [${call}]`);
      });
      if (run < runs.length - 1) {
        html.push(`<p>${note(run)}</p>`);
        body.push(note(run));
      }
    });
    const lines = Array.from({ length: answer }, (_, n) => `Answer line ${n}.`);
    html.push(...lines.map((line) => `<p>${line}</p>`));
    body.push(...lines);
    return foldFinishedWork(
      body.join('\n\n'),
      html.join('\n'),
      baseOpts,
      {},
      toolCallsShown,
      seamRows
    );
  };

  // Work rows: the intro, a row per run of calls shown, a note between runs, and the cog's own row
  // while the calls are hidden (`seamRows`, as the caller counts it).
  it.each([
    [
      '19 calls in 6 runs with notes and a short answer (12 rows)',
      [4, 3, 3, 3, 3, 3],
      3,
      true,
      true,
    ],
    ['the same with its calls hidden (7 rows)', [4, 3, 3, 3, 3, 3], 3, false, false],
    ['one run of 100 calls and a long answer', [100], 40, true, false],
    ['one run of 100 calls and a long answer, its calls hidden', [100], 40, false, false],
    ['2 calls and one line of answer', [2], 1, true, false],
    ['8 rows of work under an answer over 3 times as long', [1, 1, 1, 1], 25, true, false],
    ['8 rows of work and an answer 3 times as long', [1, 1, 1, 1], 24, true, true],
    ['14 rows of work and a huge answer', [1, 1, 1, 1, 1, 1, 1], 500, true, true],
    [
      '13 rows of work with its calls hidden and a huge answer',
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      500,
      false,
      true,
    ],
  ])('%s', (_name, runs, answer, toolCallsShown, folds) => {
    expect(reply(runs, answer, toolCallsShown, toolCallsShown ? 0 : 1) !== undefined).toBe(folds);
  });

  it('counts the reasoning line and the compaction seams as work', () => {
    expect(reply([1, 1, 1], 2)).toBeUndefined();
    expect(reply([1, 1, 1], 2, true, 2)?.tail).toContain('Answer line 0.');
  });

  it('counts a long line as a row per 100 characters', () => {
    const long = 'a'.repeat(450);
    const html = `<p>${long}</p>${marker('shell', 1)}<p>Done.</p>`;
    const fold = (seamRows: number) =>
      foldFinishedWork(`${long}\n\n🔧 \`shell\` [1]\n\nDone.`, html, baseOpts, {}, true, seamRows);
    // 5 rows of text and 1 of the call.
    expect(fold(1)).toBeUndefined();
    expect(fold(2)).toEqual({ head: `<p>${long}</p>${marker('shell', 1)}`, tail: '<p>Done.</p>' });
  });

  it('skips the split while the whole body has fewer than 8 rows', () => {
    const html = Array.from({ length: 9 }, (_, n) => `<p>${note(n)}</p>${marker('a', n + 1)}`);
    const fold = (body: string) =>
      foldFinishedWork(body, `${html.join('')}<p>Done.</p>`, baseOpts, {}, true, 0);
    expect(fold('short')).toBeUndefined();
    expect(fold('line\n'.repeat(8))?.tail).toBe('<p>Done.</p>');
  });
});
