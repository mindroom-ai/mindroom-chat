// @vitest-environment jsdom
import React from 'react';
import { Element, htmlToDOM, type HTMLReactParserOptions } from 'html-react-parser';
import { describe, expect, it, vi } from 'vitest';
import { htmlToEditorInput } from '../editor/input';
import { renderMatrixMathHtmlElement } from './matrixMath';
import { parseHtml } from './parseHtml';

// The production bundle resolves html-dom-parser's browser entry (lib/client/html-to-dom.js),
// which Node's module resolution does not pick. Load it directly so this test exercises the real
// browser DOMParser path (including its carriage-return placeholder behavior).
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
  const actual = await importOriginal<typeof import('html-react-parser')>();
  return {
    ...actual,
    htmlToDOM: clientHtmlToDOM,
    default: (html: string, options?: HTMLReactParserOptions) =>
      actual.domToReact(clientHtmlToDOM(html, options?.htmlparser2), options),
  };
});

describe('parseHtml and parseHtmlToDom in the browser', () => {
  it('preserves links with CRLF inside the opening tag and multiline data-mx-maths attributes', () => {
    const crlfLink = '<a\r\n href="https://example.org/">Example</a>';
    const crlfMath = '<div data-mx-maths="a + b\r\nc + d">fallback</div>';

    // Confirm the raw browser parser exhibits the carriage-return placeholder corruption.
    const rawLinkNodes = htmlToDOM(crlfLink);
    expect(rawLinkNodes.some((node) => node instanceof Element && node.name === 'a')).toBe(false);
    const [rawMathNode] = htmlToDOM(crlfMath);
    expect(
      rawMathNode instanceof Element ? rawMathNode.attribs['data-mx-maths'] : undefined
    ).toContain('CARRIAGE_RETURN_PLACEHOLDER');

    // Editor input (parseHtmlToDom) preserves the link tag and URL.
    const editorBlocks = htmlToEditorInput(crlfLink);
    expect(editorBlocks).toEqual([
      {
        type: 'paragraph',
        children: [
          {
            type: 'link',
            href: 'https://example.org/',
            children: [{ text: 'Example' }],
          },
        ],
      },
    ]);

    // React HTML parsing (parseHtml) passes clean normalized LF latex to MatrixMathHtml.
    const options: HTMLReactParserOptions = {
      replace(node) {
        if (node instanceof Element) {
          return renderMatrixMathHtmlElement(node.name, node.attribs, node.children, options);
        }
        return undefined;
      },
    };
    const renderedMath = parseHtml(crlfMath, options) as React.ReactElement<{ latex: string }>;
    expect(renderedMath.props.latex).toBe('a + b\nc + d');
  });
});
