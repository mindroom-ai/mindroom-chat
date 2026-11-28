// @vitest-environment jsdom
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { domToReact, htmlToDOM } from 'html-react-parser';
import { renderToStaticMarkup } from 'react-dom/server';
import { splitFinishedWorkDom } from './finishedWorkSplit';
import { cloneDomNodes, parseRenderedHtml } from './replyDom';

// The app's build parses with html-react-parser's browser htmlToDOM (the DOMParser), which Node's
// resolution of the package never picks, so this file loads it by path.
vi.mock('html-react-parser', async (importOriginal) => {
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const require = createRequire(import.meta.url);
  const clientModule = require(
    path.join(
      path.dirname(require.resolve('html-dom-parser/package.json')),
      'lib/client/html-to-dom.js'
    )
  ) as { default: typeof import('html-react-parser').htmlToDOM };
  const clientHtmlToDOM = clientModule.default;
  return {
    ...(await importOriginal<typeof import('html-react-parser')>()),
    htmlToDOM: clientHtmlToDOM,
  };
});

// Text before the call, without which a reply does not fold.
const note = '<p>Checking.</p>';
const marker = '<p>🔧 <code>shell</code> [1]</p>';

describe('splitFinishedWorkDom in the browser', () => {
  it('parses with the DOMParser, which drops the newline right after <pre>', () => {
    const [pre] = htmlToDOM('<pre>\n\nhello</pre>');
    expect(pre && 'children' in pre && pre.children[0]).toMatchObject({ data: '\nhello' });
  });

  it('keeps the leading newline of a code block in the answer without re-serializing HTML', () => {
    const dom = parseRenderedHtml(`${note}${marker}<pre>\n\nhello</pre>`, {});
    const answer = splitFinishedWorkDom(dom, {}).split?.answer;

    expect(answer).toBeDefined();
    expect(answer?.[0] && 'children' in answer[0] && answer[0].children[0]).toMatchObject({
      data: '\nhello',
    });
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      React.createElement(React.Fragment, null, domToReact(cloneDomNodes(answer ?? [])))
    );
    expect(host.querySelector('pre')?.textContent).toBe('\nhello');
  });

  it('starts the answer at the prose after the last call in its paragraph', () => {
    const dom = parseRenderedHtml(`${note}<p>🔧 <code>shell</code> [1]<br>\nThe answer.</p>`, {});
    const split = splitFinishedWorkDom(dom, {}).split;

    expect(split).toBeDefined();
    expect(
      renderToStaticMarkup(
        React.createElement(React.Fragment, null, domToReact(cloneDomNodes(split!.work)))
      )
    ).toBe(`${note}<p>🔧 <code>shell</code> [1]</p>`);
    expect(
      renderToStaticMarkup(
        React.createElement(React.Fragment, null, domToReact(cloneDomNodes(split!.answer)))
      )
    ).toBe('<p>The answer.</p>');
  });
});
