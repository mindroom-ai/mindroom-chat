import React from 'react';
import parse, { Element, HTMLReactParserOptions, domToReact } from 'html-react-parser';
import { Text as DOMText } from 'domhandler';
import { MatrixClient } from 'matrix-js-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { act, create, ReactTestRenderer, ReactTestRendererJSON } from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CodeBlock,
  LINKIFY_OPTS,
  getReactCustomHtmlParser,
  renderTextWithLatex,
} from './react-custom-html-parser';
import { withMindroomToolTraceMarkerParserOptions } from '../mindroom/messages/MindroomHtmlBlocks';

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<boolean>>(),
}));

vi.mock('../utils/dom', async () => {
  const actual = await vi.importActual<typeof import('../utils/dom')>('../utils/dom');
  return {
    ...actual,
    copyToClipboard: clipboardMocks.copyToClipboard,
  };
});

vi.mock('folds', async () => {
  const ReactModule = await import('react');
  const ReactLib = ReactModule.default;
  const passthrough =
    (tag: string) =>
    ({ children, ...props }: Record<string, unknown>) =>
      ReactLib.createElement(tag, props, children);

  return {
    Box: passthrough('div'),
    Chip: passthrough('span'),
    Spinner: passthrough('span'),
    Header: passthrough('div'),
    Icon: ({ children, ...props }: Record<string, unknown>) =>
      ReactLib.createElement('span', props, children),
    IconButton: passthrough('button'),
    Scroll: passthrough('div'),
    Text: ({ as = 'div', children, truncate, ...props }: Record<string, unknown>) =>
      ReactLib.createElement(
        typeof as === 'string' ? as : 'div',
        {
          ...props,
          'data-truncate': truncate ? 'true' : undefined,
        },
        children
      ),
    config: {
      space: {
        S400: '16px',
      },
    },
    Icons: new Proxy(
      {},
      {
        get: (_, prop) => String(prop),
      }
    ),
    toRem: (value: number) => `${value / 16}rem`,
  };
});

vi.mock('../styles/CustomHtml.css', () => ({
  Paragraph: 'Paragraph',
  MarginSpaced: 'MarginSpaced',
  CodeBlock: 'CodeBlock',
  CodeBlockHeader: 'CodeBlockHeader',
  CodeBlockInternal: 'CodeBlockInternal',
  CodeBlockBottomShadow: 'CodeBlockBottomShadow',
  Code: 'Code',
  Mention: () => 'Mention',
}));

vi.mock('../mindroom/html/MatrixMath.css', () => ({
  MathInline: 'MathInline',
  MathBlock: 'MathBlock',
}));

vi.mock('../mindroom/messages/MindroomHtmlBlocks.css', () => ({
  Block: 'MindroomBlock',
  BlockBody: 'MindroomBlockBody',
  BlockHeader: 'MindroomBlockHeader',
  BlockHeaderMeta: 'MindroomBlockHeaderMeta',
  BlockInlineResult: 'MindroomBlockInlineResult',
  BlockResult: 'MindroomBlockResult',
  ToolGroupItem: 'MindroomToolGroupItem',
  ToolGroupList: 'MindroomToolGroupList',
}));

const createBaseOpts = (): HTMLReactParserOptions => {
  const opts: HTMLReactParserOptions = {
    replace: (domNode) => {
      if (domNode instanceof Element && domNode.name === 'p') {
        return React.createElement('p', null, domToReact(domNode.children, opts));
      }

      return undefined;
    },
  };

  return opts;
};

const renderWithToolTrace = (html: string, content: Record<string, unknown>) => {
  const opts = withMindroomToolTraceMarkerParserOptions(createBaseOpts(), content);
  const parsed = parse(html, opts);
  return renderToStaticMarkup(React.createElement(React.Fragment, null, parsed));
};

const renderTreeWithToolTrace = (
  html: string,
  content: Record<string, unknown>
): ReactTestRenderer => {
  const opts = withMindroomToolTraceMarkerParserOptions(createBaseOpts(), content);
  const parsed = parse(html, opts);
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(React.Fragment, null, parsed));
  });

  if (!renderer) {
    throw new Error('Failed to create tool trace renderer');
  }

  return renderer;
};

const collectTextContent = (
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null
): string => {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map((child) => collectTextContent(child)).join('');

  const self = typeof node.children === 'object' ? collectTextContent(node.children) : '';
  return self;
};

describe('CodeBlock clipboard feedback', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    clipboardMocks.copyToClipboard.mockReset();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { setTimeout: globalThis.setTimeout.bind(globalThis) },
    });
  });

  afterEach(() => {
    if (originalWindow === undefined) {
      Reflect.deleteProperty(globalThis, 'window');
    } else {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  const renderCodeBlock = () =>
    create(
      React.createElement(CodeBlock, { opts: {} }, [
        new DOMText('copy me'),
      ] as unknown as React.ReactNode)
    );

  const getCopyControl = (renderer: ReactTestRenderer) =>
    renderer.root.findAllByType('span').find((node) => typeof node.props.onClick === 'function')!;

  it('shows Copied only after confirmed clipboard success', async () => {
    clipboardMocks.copyToClipboard.mockResolvedValue(true);
    const renderer = renderCodeBlock();

    await act(async () => {
      await getCopyControl(renderer).props.onClick();
    });

    expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith('copy me');
    expect(collectTextContent(renderer.toJSON())).toContain('Copied');
    renderer.unmount();
  });

  it('keeps Copy visible when every clipboard path fails', async () => {
    clipboardMocks.copyToClipboard.mockResolvedValue(false);
    const renderer = renderCodeBlock();

    await act(async () => {
      await getCopyControl(renderer).props.onClick();
    });

    expect(collectTextContent(renderer.toJSON())).toContain('Copy');
    expect(collectTextContent(renderer.toJSON())).not.toContain('Copied');
    renderer.unmount();
  });
});

const renderCustomHtmlTree = (html: string, mx = {} as MatrixClient): ReactTestRenderer => {
  const opts = getReactCustomHtmlParser(mx, undefined, {
    linkifyOpts: LINKIFY_OPTS,
  });
  const parsed = parse(html, opts);
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(React.createElement(React.Fragment, null, parsed));
  });

  if (!renderer) {
    throw new Error('Failed to create HTML renderer');
  }

  return renderer;
};

const renderCustomHtmlMarkup = (html: string, mx = {} as MatrixClient): string => {
  const opts = getReactCustomHtmlParser(mx, undefined, {
    linkifyOpts: LINKIFY_OPTS,
  });
  const parsed = parse(html, opts);
  return renderToStaticMarkup(React.createElement(React.Fragment, null, parsed));
};

const renderLatexTextMarkup = (text: string): string =>
  renderToStaticMarkup(
    React.createElement(
      React.Fragment,
      null,
      renderTextWithLatex(text, {
        linkify: true,
        linkifyOpts: LINKIFY_OPTS,
        keyPrefix: 'test',
      })
    )
  );

const collectStructuralTableWhitespace = (
  node: ReactTestRendererJSON | ReactTestRendererJSON[] | string | null,
  tags = new Set(['table', 'thead', 'tbody', 'tfoot', 'tr', 'colgroup'])
): string[] => {
  if (!node || typeof node === 'string') return [];
  if (Array.isArray(node)) {
    return node.flatMap((child) => collectStructuralTableWhitespace(child, tags));
  }

  const current =
    tags.has(node.type) && node.children
      ? node.children.flatMap((child) =>
          typeof child === 'string' && child.trim().length === 0 ? [node.type] : []
        )
      : [];

  const nested = node.children ? collectStructuralTableWhitespace(node.children, tags) : [];
  return current.concat(nested);
};

describe('withMindroomToolTraceMarkerParserOptions', () => {
  it('renders tool blocks for marker-only content and enriches them with trace metadata', () => {
    const html = '<p>🔧 <code>search_web</code> [1]</p>';

    const previewMarkup = renderWithToolTrace(html, {
      body: 'preview',
      formatted_body: html,
    });
    expect(previewMarkup).toContain('1 tool call');
    expect(previewMarkup).not.toContain('🔧');

    const hydratedMarkup = renderWithToolTrace(html, {
      body: 'full response',
      formatted_body: html,
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'search_web', result_preview: 'Done' }],
      },
    });
    expect(hydratedMarkup).toContain('1 tool call');
  });

  it('expands marker-only tool refs with the marker tool name', () => {
    const markerHtml = '<p>🔧 <code>run_shell_command</code> [1]</p>';
    const renderer = renderTreeWithToolTrace(markerHtml, { formatted_body: markerHtml });

    expect(collectTextContent(renderer.toJSON())).toContain('1 tool call');

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    const expanded = collectTextContent(renderer.toJSON());
    expect(expanded).toContain('Tool #1: run_shell_command');
    expect(expanded).toContain('✓');
    expect(expanded).not.toContain('🔧');
  });

  it('groups consecutive markers into one tool-calls block', () => {
    const renderer = renderTreeWithToolTrace(
      [
        '<p>🔧 <code>tool1</code> [1]</p>',
        '<p>🔧 <code>tool2</code> [2]</p>',
        '<p>🔧 <code>tool3</code> [3]<br/>Done</p>',
      ].join(''),
      {
        'io.mindroom.tool_trace': {
          version: 2,
          events: [
            { type: 'tool_call_completed', tool_name: 'first_tool', result_preview: 'FIRST' },
            { type: 'tool_call_started', tool_name: 'second_tool' },
            { type: 'tool_call_completed', tool_name: 'third_tool', result_preview: 'THIRD' },
          ],
        },
      }
    );

    const collapsed = collectTextContent(renderer.toJSON());
    expect(collapsed).toContain('3 tool calls');
    expect(renderer.root.findAllByType('button')).toHaveLength(1);

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    const expanded = collectTextContent(renderer.toJSON());
    expect(expanded).toContain('Tool #1: first_tool');
    expect(expanded).toContain('FIRST');
    expect(expanded).toContain('Tool #2: second_tool ⏳');
    expect(expanded).toContain('Tool #3: third_tool');
    expect(expanded).toContain('THIRD');
    expect(expanded).toContain('Done');
  });

  it('does not merge marker-prefix paragraphs when each has trailing text', () => {
    const markup = renderWithToolTrace(
      [
        '<p>🔧 <code>run_shell_command</code> [1]<br/>Now let me find one</p>',
        '<p>🔧 <code>run_shell_command</code> [2]<br/>Now let me find two</p>',
      ].join(''),
      {
        'io.mindroom.tool_trace': {
          version: 2,
          events: [
            {
              type: 'tool_call_completed',
              tool_name: 'run_shell_command',
              result_preview: 'FIRST',
            },
            { type: 'tool_call_started', tool_name: 'run_shell_command' },
          ],
        },
      }
    );

    expect(markup).not.toContain('2 tool calls');
    expect(markup.match(/1 tool call/g)).toHaveLength(2);
    expect(markup).toContain('Now let me find one');
    expect(markup).toContain('Now let me find two');
    expect(markup).not.toContain('🔧');
  });

  it('preserves trailing content after a marker prefix, including br and text', () => {
    const markup = renderWithToolTrace('<p>🔧 <code>tool3</code> [3]<br/>Done</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'tool1' },
          { type: 'tool_call_completed', tool_name: 'tool2' },
          { type: 'tool_call_completed', tool_name: 'tool3', result_preview: 'third result' },
        ],
      },
    });

    expect(markup).toContain('<p>Done</p>');
    expect(markup).toContain('Done');
  });

  it('consumes pending hourglass as part of the marker and does not render it as trailing text', () => {
    const markup = renderWithToolTrace('<p>🔧 <code>tool3</code> [3] ⏳<br/>Waiting</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'tool1' },
          { type: 'tool_call_completed', tool_name: 'tool2' },
          { type: 'tool_call_started', tool_name: 'tool3' },
        ],
      },
    });

    expect(markup).toContain('1 tool call');
    expect(markup).toContain('<p>Waiting</p>');
    expect(markup).not.toContain('⏳');
  });

  it('drops boundary br on the immediate paragraph after grouped tool markers', () => {
    const markup = renderWithToolTrace(
      [
        '<p>🔧 <code>matrix_message</code> [1]</p>',
        '<p><br/>No magic - just dropping old turns when the window fills up.</p>',
      ].join(''),
      {
        'io.mindroom.tool_trace': {
          version: 2,
          events: [{ type: 'tool_call_completed', tool_name: 'matrix_message' }],
        },
      }
    );

    expect(markup).toContain('1 tool call');
    expect(markup).toContain('<p>No magic - just dropping old turns when the window fills up.</p>');
    expect(markup).not.toContain('<p><br/>No magic');
  });

  it('does not leak a raw hourglass for a standalone pending marker paragraph', () => {
    const markup = renderWithToolTrace('<p>🔧 <code>tool3</code> [3] ⏳</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'tool1' },
          { type: 'tool_call_completed', tool_name: 'tool2' },
          { type: 'tool_call_started', tool_name: 'tool3' },
        ],
      },
    });

    expect(markup).toContain('1 tool call');
    expect(markup).not.toContain('⏳');
  });

  it('renders single tool call using group path with Tool #1 label', () => {
    const renderer = renderTreeWithToolTrace('<p>🔧 <code>search_web</code> [1]</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'search_web', result_preview: 'Found it' },
        ],
      },
    });

    const collapsed = collectTextContent(renderer.toJSON());
    expect(collapsed).toContain('1 tool call');

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    const expanded = collectTextContent(renderer.toJSON());
    expect(expanded).toContain('Tool #1: search_web');
    expect(expanded).toContain('Found it');
  });

  it('shows pending badge in collapsed header for single pending tool', () => {
    const renderer = renderTreeWithToolTrace('<p>🔧 <code>search_web</code> [1]</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_started', tool_name: 'search_web' }],
      },
    });

    const header = renderer.root.findByType('button');
    const headerSpans = header.findAllByType('span');
    const spinnerSpan = headerSpans.find(
      (s) => s.props.size === '100' && s.props.variant === 'Secondary'
    );
    expect(spinnerSpan).toBeDefined();

    const completedRenderer = renderTreeWithToolTrace('<p>🔧 <code>search_web</code> [1]</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'search_web', result_preview: 'Done' }],
      },
    });

    const completedHeader = completedRenderer.root.findByType('button');
    const completedSpans = completedHeader.findAllByType('span');
    const completedSpinnerSpan = completedSpans.find(
      (s) => s.props.size === '100' && s.props.variant === 'Secondary'
    );
    expect(completedSpinnerSpan).toBeUndefined();

    const checkIcon = completedSpans.find((s) => s.props.src === 'Check' && s.props.size === '50');
    expect(checkIcon).toBeDefined();
  });

  it('shows single-line inline result inside expanded body for copyability', () => {
    const renderer = renderTreeWithToolTrace('<p>🔧 <code>tool3</code> [3]</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_completed', tool_name: 'tool1' },
          { type: 'tool_call_completed', tool_name: 'tool2' },
          { type: 'tool_call_completed', tool_name: 'tool3', result_preview: 'Single-line output' },
        ],
      },
    });

    expect(() => renderer.root.findByType('pre')).toThrow();

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    const resultBody = renderer.root.findByType('pre');
    expect(resultBody.children.join('')).toContain('Single-line output');
  });
});

describe('getReactCustomHtmlParser', () => {
  it('renders Matrix user links as mentions only outside inline and fenced code', () => {
    const userId = '@alice:example.org';
    const matrixTo = `https://matrix.to/#/${userId}`;
    const mx = {
      getRoom: vi.fn(() => undefined),
      getUserId: vi.fn(() => '@viewer:example.org'),
    } as unknown as MatrixClient;

    const plainMarkup = renderCustomHtmlMarkup(
      `<p><a href="${matrixTo}">Alice (${userId})</a></p>`,
      mx
    );
    expect(plainMarkup).toContain(`href="${matrixTo}"`);
    expect(plainMarkup).toContain(`data-mention-id="${userId}"`);

    for (const codeTree of [
      renderCustomHtmlTree(`<p><code><a href="${matrixTo}">Alice (${userId})</a></code></p>`, mx),
      renderCustomHtmlTree(
        `<pre><code><a href="${matrixTo}">Alice (${userId})</a></code></pre>`,
        mx
      ),
    ]) {
      expect(collectTextContent(codeTree.toJSON())).toContain(userId);
      expect(collectTextContent(codeTree.toJSON())).not.toContain('Alice');
      expect(codeTree.root.findAllByType('a')).toHaveLength(0);
      codeTree.unmount();
    }
  });

  it('copies the literal Matrix user ID from fenced code', async () => {
    const userId = '@alice:example.org';
    const matrixTo = `https://matrix.to/#/${userId}`;
    clipboardMocks.copyToClipboard.mockReset();
    clipboardMocks.copyToClipboard.mockResolvedValue(false);

    const codeTree = renderCustomHtmlTree(
      `<pre><code><a href="${matrixTo}">Alice (${userId})</a></code></pre>`
    );
    const copyControl = codeTree.root
      .findAllByType('span')
      .find((node) => typeof node.props.onClick === 'function');

    await act(async () => {
      await copyControl?.props.onClick();
    });

    expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith(userId);
    codeTree.unmount();
  });

  it('drops whitespace-only text nodes in table structure while preserving cell content', () => {
    const renderer = renderCustomHtmlTree(`
      <table>
        <thead>
          <tr>
            <th>Heading</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>https://example.com</td>
          </tr>
        </tbody>
      </table>
    `);

    expect(collectStructuralTableWhitespace(renderer.toJSON())).toEqual([]);
    expect(
      renderer.root.findAllByType('a').some((node) => node.props.href === 'https://example.com')
    ).toBe(true);
  });

  it('renders incoming Matrix math html with KaTeX wrappers', () => {
    const markup = renderCustomHtmlMarkup(
      '<p><span data-mx-maths="x^2">x^2</span></p><div data-mx-maths="\\frac{a}{b}">\\frac{a}{b}</div>'
    );

    expect(markup).toContain('MathInline');
    expect(markup).toContain('MathBlock');
    expect(markup).toContain('katex');
  });

  it('preserves escaped delimiters inside backtick spans in raw text', () => {
    const markup = renderLatexTextMarkup('`\\$x\\$`');

    expect(markup).toContain('`\\$x\\$`');
    expect(markup).not.toContain('MathInline');
  });

  it('does not render currency-like inline delimiters as math in raw text', () => {
    const markup = renderLatexTextMarkup('Inline $E = mc^2$ and $5+$10$ plus \\$escaped\\$');

    expect(markup).toContain('katex');
    expect(markup).toContain('$5+$10$');
    expect(markup).toContain('$escaped$');
    expect(markup.match(/MathInline/g)).toHaveLength(1);
  });

  it('does not render formatted currency amounts as math in raw text', () => {
    const markup = renderLatexTextMarkup(
      '$1234$ and $1,000.00$ and $1.000,00$ and $5 USD$ and $19.99/mo$'
    );

    expect(markup).toContain('$1234$');
    expect(markup).toContain('$1,000.00$');
    expect(markup).toContain('$1.000,00$');
    expect(markup).toContain('$5 USD$');
    expect(markup).toContain('$19.99/mo$');
    expect(markup).not.toContain('MathInline');
  });

  it('does not render currency ranges as math in raw text', () => {
    const markup = renderLatexTextMarkup('$5-10$ and $5–10$ and $5-$10$');

    expect(markup).toContain('$5-10$');
    expect(markup).toContain('$5–10$');
    expect(markup).toContain('$5-$10$');
    expect(markup).not.toContain('MathInline');
  });

  it('renders numeric-leading expressions as math in raw text', () => {
    const markup = renderLatexTextMarkup('$2sin(x)$');

    expect(markup).toContain('MathInline');
    expect(markup).toContain('katex');
  });

  it('does not split URLs that contain dollar delimiters', () => {
    const markup = renderLatexTextMarkup('https://example.com/$x$/y');

    expect(markup).toContain('href="https://example.com/$x$/y"');
    expect(markup).not.toContain('MathInline');
  });

  it('renders raw display latex blocks from text nodes', () => {
    const markup = renderLatexTextMarkup('$$\\frac{a}{b}$$');

    expect(markup).toContain('MathBlock');
    expect(markup).toContain('katex-display');
  });
});
