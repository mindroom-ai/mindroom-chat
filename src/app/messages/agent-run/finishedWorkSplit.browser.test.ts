// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { htmlToDOM } from 'html-react-parser';
import { splitFinishedWork } from './finishedWorkSplit';

// The app's build parses with html-react-parser's browser htmlToDOM (the DOMParser), which Node's
// resolution of the package never picks, so this file loads it by path.
vi.mock('html-react-parser', async (importOriginal) => {
  const { createRequire } = await import('node:module');
  const path = await import('node:path');
  const require = createRequire(import.meta.url);
  const clientHtmlToDOM = require(path.join(
    path.dirname(require.resolve('html-dom-parser')),
    'lib/client/html-to-dom.js'
  )) as typeof import('html-react-parser').htmlToDOM;
  return {
    ...(await importOriginal<typeof import('html-react-parser')>()),
    htmlToDOM: clientHtmlToDOM,
  };
});

const marker = '<p>🔧 <code>shell</code> [1]</p>';

/** The text of the tail's code block as the browser renders the tail. */
const renderedPreText = (html: string) => {
  const host = document.createElement('div');
  host.innerHTML = html;
  return host.querySelector('pre')?.textContent;
};

describe('splitFinishedWork in the browser', () => {
  it('parses with the DOMParser, which drops the newline right after <pre>', () => {
    const [pre] = htmlToDOM('<pre>\n\nhello</pre>');
    expect(pre && 'children' in pre && pre.children[0]).toMatchObject({ data: '\nhello' });
  });

  it('keeps the leading newline of a code block in the answer', () => {
    const tail = splitFinishedWork(`${marker}<pre>\n\nhello</pre>`, {})?.tail;

    expect(tail).toBeDefined();
    expect(renderedPreText(tail ?? '')).toBe('\nhello');
  });
});
