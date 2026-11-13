import React from 'react';
import parse, { Element, HTMLReactParserOptions, domToReact } from 'html-react-parser';
import { Text as DOMText } from 'domhandler';
import { MatrixClient } from 'matrix-js-sdk';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorBoundary } from 'react-error-boundary';
import {
  act,
  create,
  ReactTestInstance,
  ReactTestRenderer,
  ReactTestRendererJSON,
} from 'react-test-renderer';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CodeBlock,
  LINKIFY_OPTS,
  factoryRenderLinkifyWithMention,
  getReactCustomHtmlParser,
  renderTextWithLatex,
} from './react-custom-html-parser';
import { markerParserOptions } from '../../../test/utils/markerParserOptions';
import { ToolCallMessageContext } from '../agent-run/toolCallStatus';
import { ToolCallsFold } from '../agent-run/ToolCallsFold';
import { withReasoning } from '../agent-run/Reasoning';
import backendToolMarkerBodies from '../__fixtures__/backendToolMarkerBodies.json';
import { getRenderedToolRefs } from '../agent-run/toolRefDom';
import {
  getMessageCopyTexts,
  scanToolMarkerLines,
} from '../messageCopyText';
import { formatMessageTextBodyAsHtml } from './blocks';
import { LinkFaviconContext } from '../../rich-text/MessageLink';
import { sanitizeCustomHtml } from '../../rich-text/sanitize';
import { createStore, Provider } from 'jotai';
import { getSettings, settingsAtom } from '../../preferences/settings';
import { clearToolCallOverrides } from '../toolCallVisibility';
import { showToolCalls } from '../../../test/utils/showToolCalls';

// These tests show how tool calls render, so they show them.
beforeEach(showToolCalls);

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<boolean>>(),
}));

const approvals = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock('../../matrix/session/useSessionStore', async (original) => ({
  ...(await original<typeof import('../../matrix/session/useSessionStore')>()),
  useActiveSession: () => ({ sessionId: 'reader-session' }),
}));
vi.mock('../../approvals/ThreadApprovalProvider', () => ({
  useThreadApprovals: () => approvals.current,
}));

vi.mock('../../lib/dom', async () => {
  const actual = await vi.importActual<typeof import('../../lib/dom')>('../../lib/dom');
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
    Tooltip: passthrough('span'),
    TooltipProvider: ({ children }: { children: (triggerRef: () => void) => React.ReactNode }) =>
      children(() => undefined),
  };
});

// The folds stand-in above has no colors, which these styles read; their class names will do.
vi.mock('../agent-run/ToolCallsFold.css', () =>
  Object.fromEntries(['Fold', 'Cog', 'CogIcon'].map((name) => [name, name]))
);
vi.mock('../agent-run/Reasoning.css', () =>
  Object.fromEntries(
    ['Reasoning', 'Line', 'Toggle', 'CogRow', 'CollapseEnd', 'Label', 'Chevron', 'Body'].map(
      (name) => [name, name]
    )
  )
);

vi.mock('../../rich-text/CustomHtml.css', () => ({
  BlockQuote: 'BlockQuote',
  Heading: 'Heading',
  List: 'List',
  Paragraph: 'Paragraph',
  MarginSpaced: 'MarginSpaced',
  CodeBlock: 'CodeBlock',
  MessageCodeBlock: 'MessageCodeBlock',
  CodeBlockHeader: 'CodeBlockHeader',
  CodeBlockLabel: 'CodeBlockLabel',
  CodeBlockLabelText: 'CodeBlockLabelText',
  CodeBlockLanguageIcon: 'CodeBlockLanguageIcon',
  CodeBlockActions: 'CodeBlockActions',
  CodeBlockAction: 'CodeBlockAction',
  CodeBlockActionIcon: 'CodeBlockActionIcon',
  CodeBlockScroll: 'CodeBlockScroll',
  CodeBlockInternal: 'CodeBlockInternal',
  CodeBlockBottomShadow: 'CodeBlockBottomShadow',
  Code: 'Code',
  Mention: () => 'Mention',
  Spoiler: () => 'Spoiler',
  EmoticonBase: 'EmoticonBase',
  Emoticon: () => 'Emoticon',
  highlightText: 'highlightText',
}));

vi.mock('../../rich-text/matrixMath.css', () => ({
  MathInline: 'MathInline',
  MathBlock: 'MathBlock',
}));

vi.mock('../../rich-text/ScrollableTable.css', () => ({
  Container: 'TableContainer',
  ScrollArea: 'TableScrollArea',
  Table: 'Table',
  Hint: 'TableHint',
}));

vi.mock('./HtmlBlocks.css', () => ({
  Block: 'MindroomBlock',
  BlockBody: 'MindroomBlockBody',
  BlockChevron: 'MindroomBlockChevron',
  BlockHeader: 'MindroomBlockHeader',
  BlockHeaderMeta: 'MindroomBlockHeaderMeta',
}));

vi.mock('../../approvals/ApprovalArgumentFields.css', () => ({
  Arguments: 'Arguments',
  Fields: 'Fields',
  Key: 'Key',
  Value: 'Value',
  Clamped: 'Clamped',
  Scalar: 'Scalar',
  Code: 'Code',
  Toggle: 'Toggle',
  Count: 'Count',
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
  const opts = markerParserOptions(createBaseOpts(), content);
  const parsed = parse(html, opts);
  return renderToStaticMarkup(React.createElement(React.Fragment, null, parsed));
};

const renderTreeWithToolTrace = (
  html: string,
  content: Record<string, unknown>
): ReactTestRenderer => {
  const opts = markerParserOptions(createBaseOpts(), content);
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

// The group title names its state ("Ran 2 tool calls", "Running 1 tool call", or "Used 2 tools"
// while trace details load); grouping tests only care about the count.
const toolCountLabel = (count: number, flags = '') => {
  const s = count === 1 ? '' : 's';
  return new RegExp(
    `(?:Ran|Running|Denied) ${count} tool call${s}|Used ${count} tool${s}|\\b${count} tool call${s} (?:waiting|expired)`,
    flags
  );
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
    renderer.root.find(
      (node) => node.type === 'button' && String(node.props['aria-label']).startsWith('Cop')
    );

  it('shows Copied only after confirmed clipboard success', async () => {
    clipboardMocks.copyToClipboard.mockResolvedValue(true);
    const renderer = renderCodeBlock();

    await act(async () => {
      await getCopyControl(renderer).props.onClick();
    });

    expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith('copy me');
    expect(getCopyControl(renderer).props['aria-label']).toBe('Copied');
    renderer.unmount();
  });

  it('shows the direction controls in code as code points and copies the code as it is', async () => {
    clipboardMocks.copyToClipboard.mockResolvedValue(true);
    const code = 'echo hi \u202e; ls #\u202c';
    const renderer = renderCustomHtmlTree(`<pre><code>${code}</code></pre>`);
    const formatted = renderCustomHtmlTree(`<pre><b>${code}</b></pre>`);
    const shown = (tree: ReactTestRenderer) => JSON.stringify(tree.toJSON());
    expect(shown(renderer)).toContain('echo hi <U+202E>; ls #<U+202C>');
    expect(shown(formatted)).toContain('<U+202E>');
    expect(shown(renderer) + shown(formatted)).not.toMatch(/[\u202A-\u202E]/);

    await act(async () => {
      await getCopyControl(renderer).props.onClick();
    });
    await act(async () => {
      await getCopyControl(formatted).props.onClick();
    });

    expect(clipboardMocks.copyToClipboard).toHaveBeenNthCalledWith(1, code);
    expect(clipboardMocks.copyToClipboard).toHaveBeenNthCalledWith(2, code);
    renderer.unmount();
    formatted.unmount();
  });

  it('keeps Copy visible when every clipboard path fails', async () => {
    clipboardMocks.copyToClipboard.mockResolvedValue(false);
    const renderer = renderCodeBlock();

    await act(async () => {
      await getCopyControl(renderer).props.onClick();
    });

    expect(getCopyControl(renderer).props['aria-label']).toBe('Copy code');
    renderer.unmount();
  });
});

describe('CodeBlock header', () => {
  const renderFence = (html: string) => renderCustomHtmlMarkup(html);

  it('shows a known language as its icon, named for assistive technology', () => {
    const markup = renderFence('<pre><code class="language-sh">ls</code></pre>');

    expect(markup).toContain('role="img" aria-label="Language: sh"');
    expect(markup).toContain('data-code-icon="bash"');
  });

  it('labels filenames with the icon of their language', () => {
    const markup = renderFence(
      '<pre><code class="language-tsx" data-label="Greeting.tsx">x</code></pre>'
    );

    expect(markup).toContain('data-code-icon="react"');
    expect(markup).toContain('>Greeting.tsx</span>');
  });

  it('falls back to the language name, or text, without an icon', () => {
    expect(renderFence('<pre><code class="language-elixir">x</code></pre>')).toContain(
      '>elixir</span>'
    );
    expect(renderFence('<pre><code>x</code></pre>')).toContain('>text</span>');
  });

  it('collapses a long wrapped line like a long block', () => {
    const renderer = renderCustomHtmlTree(`<pre><code>${'x'.repeat(2000)}</code></pre>`);
    const expand = () =>
      renderer.root.findAll(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Expand'
      );

    expect(expand()).toHaveLength(1);
    act(() => {
      renderer.root
        .find((node) => node.type === 'button' && node.props['aria-label'] === 'Wrap lines')
        .props.onClick();
    });
    expect(expand()).toHaveLength(0);
    renderer.unmount();
  });

  it('wraps lines by default and toggles wrapping from the toolbar', () => {
    const renderer = renderCustomHtmlTree('<pre><code>x</code></pre>');
    const pre = () => renderer.root.findByType('pre');
    const wrapButton = () =>
      renderer.root.find(
        (node) => node.type === 'button' && node.props['aria-label'] === 'Wrap lines'
      );

    expect(pre().props['data-wrap']).toBe(true);
    expect(wrapButton().props['aria-pressed']).toBe(true);

    act(() => {
      wrapButton().props.onClick();
    });

    expect(pre().props['data-wrap']).toBe(false);
    expect(wrapButton().props['aria-pressed']).toBe(false);
    renderer.unmount();
  });
});

describe('fenced code syntax highlighting', () => {
  it('hands fenced code to the Prism highlighter', () => {
    const renderer = renderCustomHtmlTree(
      '<pre><code class="language-js">const a = 1;</code></pre>'
    );

    expect(renderer.root.findAllByType(ErrorBoundary)).toHaveLength(1);
    expect(collectTextContent(renderer.toJSON())).toContain('const a = 1;');
    renderer.unmount();
  });

  const renderSearch = (html: string) => {
    const opts = getReactCustomHtmlParser({} as MatrixClient, undefined, {
      linkifyOpts: LINKIFY_OPTS,
      highlightRegex: /const/gi,
    });
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(React.Fragment, null, parse(html, opts)));
    });
    return renderer!;
  };

  it('shows search matches instead of syntax colors in a matching block', () => {
    const renderer = renderSearch('<pre><code class="language-js">const a = 1;</code></pre>');

    expect(renderer.root.findAllByType(ErrorBoundary)).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: 'highlightText' })).toHaveLength(1);
    renderer.unmount();
  });

  it('keeps syntax colors in blocks without a search match', () => {
    const renderer = renderSearch('<pre><code class="language-js">let a = 1;</code></pre>');

    expect(renderer.root.findAllByType(ErrorBoundary)).toHaveLength(1);
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

describe('inline website favicons', () => {
  const renderLinks = (html: string, enabled = true) => {
    const linkifyOpts = {
      ...LINKIFY_OPTS,
      render: factoryRenderLinkifyWithMention(() => undefined, enabled),
    };
    const opts = getReactCustomHtmlParser({} as MatrixClient, undefined, {
      linkifyOpts,
      showLinkFavicons: enabled,
    });
    // RenderBody allows icons where the deployment does.
    return renderToStaticMarkup(
      React.createElement(LinkFaviconContext.Provider, { value: true }, parse(html, opts))
    );
  };

  it('uses the same cached site icon for plain and formatted links without exposing paths', () => {
    const markup = renderLinks(
      '<p>https://github.com/example/one?secret=value <a href="https://github.com/example/two#part" title="Read docs"><strong>Docs</strong></a></p>'
    );
    expect(markup.match(/src="https:\/\/icons.duckduckgo.com\/ip3\/github.com.ico"/g)).toHaveLength(
      2
    );
    // The title names the real address, whatever the message's HTML says.
    expect(markup).toContain('title="https://github.com/example/two#part"');
    expect(markup).toContain('<strong>Docs</strong>');
    expect(markup).toContain('href="https://github.com/example/two#part"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
    expect(markup).toContain('alt=""');
  });

  it('does not load favicons when previews are disabled', () => {
    expect(
      renderLinks('<p>https://github.com <a href="https://example.com">Example</a></p>', false)
    ).not.toContain('<img');
  });

  it.each([
    '<span data-mx-spoiler><a href="https://secret.example.com">Secret site</a></span>',
    '<span data-mx-spoiler>https://secret.example.com</span>',
    '<span data-mx-spoiler><strong>https://secret.example.com</strong></span>',
    '<span data-mx-spoiler data-mx-maths="{">https://secret.example.com</span>',
    '<a href="https://secret.example.com"><span data-mx-spoiler>Secret site</span></a>',
    '<a href="https://secret.example.com"><strong><span data-mx-spoiler>Secret site</span></strong></a>',
  ])('does not mount an icon for a link involving spoiler text: %s', (html) => {
    const markup = renderLinks(html);
    expect(markup).toContain('https://secret.example.com');
    expect(markup).not.toContain('<img');
    expect(markup).not.toContain('icons.duckduckgo.com');
  });

  it('preserves custom math rendering inside a spoiler', () => {
    const markup = renderLinks('<span data-mx-spoiler data-mx-maths="x^2">fallback</span>');
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain('class="MathInline"');
    expect(markup).toContain('katex');
  });

  it('keeps code and Matrix mentions free of website icons', () => {
    expect(
      renderLinks('<code>https://github.com</code><pre>https://example.com</pre>')
    ).not.toContain('<img');
    const mention = factoryRenderLinkifyWithMention(
      () => React.createElement('a', { 'data-mention-id': '@alice:example.com' }, 'Alice'),
      true
    ) as (ir: unknown) => React.ReactElement;
    const markup = renderToStaticMarkup(
      mention({
        tagName: 'a',
        attributes: { href: 'https://matrix.to/#/@alice:example.com' },
        content: 'Alice',
      })
    );
    expect(markup).toContain('data-mention-id');
    expect(markup).not.toContain('<img');
  });
});

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

// Text of the expanded tool row for the marker's index ([1], [2], ...).
type TextNode = { children: (TextNode | string)[] } | string;
const nodeText = (node: TextNode): string =>
  typeof node === 'string' ? node : node.children.map(nodeText).join('');
const toolRowText = (renderer: ReturnType<typeof renderTreeWithToolTrace>, index: number) =>
  nodeText(
    renderer.root.find(
      (node) => typeof node.type === 'string' && node.props['data-tool-index'] === index
    )
  );

describe('tool call status from approval cards', () => {
  afterEach(() => {
    approvals.current = undefined;
  });

  const renderInMessage = (eventId: string) => {
    const html =
      '<p>🔧 <code>send_email</code> [1]</p><p>🔧 <code>run_shell_command</code> [2]</p>';
    const opts = markerParserOptions(createBaseOpts(), {
      formatted_body: html,
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          { type: 'tool_call_started', tool_name: 'send_email' },
          { type: 'tool_call_completed', tool_name: 'run_shell_command' },
        ],
      },
    });
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        React.createElement(
          ToolCallMessageContext.Provider,
          { value: { eventId } },
          parse(html, opts)
        )
      );
    });
    return renderer as ReactTestRenderer;
  };

  it('says the group waits for approval, from the cards MindRoom posted for this reply', () => {
    const card = (toolName: string, status: string) => ({
      eventId: `$${toolName}`,
      sender: '@mindroom_router:example.org',
      wireStatus: status,
      approval: {
        toolName,
        status,
        responseEventId: '$reply',
        expiresAt: '2999-01-01T00:00:00Z',
      },
    });
    approvals.current = {
      records: [card('send_email', 'pending'), card('run_shell_command', 'denied')],
      now: Date.now(),
    };
    expect(collectTextContent(renderInMessage('$reply').toJSON())).toContain(
      '1 tool call waiting for approval'
    );
  });

  // A job's card names no reply: it names the job and replies to the thread's latest event.
  const renderShellCall = (result?: string) => {
    const html = '<p>🔧 <code>run_shell_command</code> [1]</p>';
    const opts = markerParserOptions(createBaseOpts(), {
      formatted_body: html,
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_completed',
            tool_name: 'run_shell_command',
            ...(result ? { result_preview: result } : {}),
          },
        ],
      },
    });
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(
        React.createElement(
          ToolCallMessageContext.Provider,
          { value: { eventId: '$reply' } },
          parse(html, opts)
        )
      );
    });
    return collectTextContent((renderer as ReactTestRenderer).toJSON());
  };
  const jobCard = (status: string, link: { replyToEventId?: string; jobId?: string }) => ({
    eventId: '$card',
    sender: '@mindroom_router:example.org',
    wireStatus: status,
    approval: {
      toolName: 'run_shell_command',
      status,
      responseEventId: null,
      replyToEventId: link.replyToEventId ?? null,
      jobId: link.jobId ?? null,
      expiresAt: '2999-01-01T00:00:00Z',
    },
  });

  it("gives a job's call the state of the card that replies to this message", () => {
    approvals.current = { records: [jobCard('denied', { replyToEventId: '$reply' })], now: 0 };
    expect(renderShellCall('not now')).toContain('Denied 1 tool call');
    approvals.current = { records: [jobCard('pending', { replyToEventId: '$reply' })], now: 0 };
    expect(renderShellCall()).toContain('1 tool call waiting for approval');
    approvals.current = { records: [jobCard('denied', { replyToEventId: '$other' })], now: 0 };
    expect(renderShellCall('not now')).toContain('Ran 1 tool call');
  });

  it("gives a detached call the state of the job's card its handle names", () => {
    const handle = '{"job_id": "j1", "tool": "run_shell_command", "status": "awaiting_approval"}';
    approvals.current = { records: [jobCard('expired', { jobId: 'j1' })], now: 0 };
    expect(renderShellCall(handle)).toContain('1 tool call expired');
    approvals.current = { records: [jobCard('approved', { jobId: 'j1' })], now: 0 };
    expect(renderShellCall(handle)).toContain('Ran 1 tool call');
    approvals.current = { records: [], now: 0 };
    expect(renderShellCall(handle)).toContain('1 tool call waiting for approval');
  });

  it('reads the trace alone outside a thread with approvals', () => {
    expect(collectTextContent(renderInMessage('$reply').toJSON())).toContain(
      'Running 2 tool calls'
    );
  });
});

describe('useToolTraceMarkerParserOptions', () => {
  it.each(['', '\n  '])(
    'preserves custom rendering after tool groups separated by %j',
    (separator) => {
      const html = [
        '<p>🔧 <code>first_tool</code> [1]</p>',
        '<p>🔧 <code>second_tool</code> [2]</p>',
        '<table><thead><tr><th>Project</th><th>Status</th></tr></thead><tbody><tr><td>Sample</td><td>Ready</td></tr></tbody></table>',
      ].join(separator);
      const baseOpts = getReactCustomHtmlParser({} as MatrixClient, undefined, {
        linkifyOpts: LINKIFY_OPTS,
      });
      const opts = markerParserOptions(baseOpts, { formatted_body: html });
      const markup = renderToStaticMarkup(
        React.createElement(React.Fragment, null, parse(html, opts))
      );

      expect(markup).toContain('class="TableContainer"');
      expect(markup).toContain('class="TableScrollArea"');
      expect(markup).toContain('<table class="Table">');
      expect(markup).toContain('<td>Sample</td>');
      expect(markup.match(toolCountLabel(2, 'g'))).toHaveLength(1);
      expect(markup).not.toContain('🔧');
    }
  );

  it('preserves shared paragraph styling immediately after a tool group', () => {
    const html = [
      '<p>🔧 <code>first_tool</code> [1]</p>',
      '<p>🔧 <code>second_tool</code> [2]</p>',
      '<p>Results are ready.</p>',
    ].join('');
    const baseOpts = getReactCustomHtmlParser({} as MatrixClient, undefined, {
      linkifyOpts: LINKIFY_OPTS,
    });
    const opts = markerParserOptions(baseOpts, { formatted_body: html });
    const markup = renderToStaticMarkup(
      React.createElement(React.Fragment, null, parse(html, opts))
    );

    expect(markup).toContain('class="Paragraph MarginSpaced"');
    expect(markup).toContain('Results are ready.');
    expect(markup).not.toContain('🔧');
  });

  it('leaves the tool calls out while they are hidden, and shows them again without a new parse', () => {
    const html = [
      '<p>Looking it up.</p>',
      '<p>🔧 <code>first_tool</code> [1]</p>',
      '<p>🔧 <code>second_tool</code> [2]</p>',
      '<p>Results are ready.</p>',
    ].join('');
    const store = createStore();
    store.set(settingsAtom, { ...getSettings(), showToolCalls: false });
    const parsed = parse(html, markerParserOptions(createBaseOpts(), { formatted_body: html }));
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(Provider, { store }, parsed));
    });
    const text = () => collectTextContent(renderer?.toJSON() ?? null);

    expect(text()).toContain('Looking it up.');
    expect(text()).toContain('Results are ready.');
    expect(text()).not.toContain('first_tool');
    expect(text()).not.toContain('🔧');

    act(() => {
      store.set(settingsAtom, { ...store.get(settingsAtom), showToolCalls: true });
    });
    expect(text()).toMatch(toolCountLabel(2));
    act(() => renderer?.unmount());
  });

  describe('while the tool calls are hidden', () => {
    const ROOM = '!room:example.org';
    const storageKey = 'toolCallsShown:reader-session';
    const stored = new Map<string, string>();

    beforeEach(() => {
      vi.stubGlobal('localStorage', {
        getItem: (key: string) => stored.get(key) ?? null,
        setItem: (key: string, value: string) => stored.set(key, value),
        removeItem: (key: string) => stored.delete(key),
        key: (index: number) => [...stored.keys()][index] ?? null,
        get length() {
          return stored.size;
        },
      });
    });
    afterEach(() => {
      clearToolCallOverrides('reader-session');
      stored.clear();
      vi.unstubAllGlobals();
    });

    const toolsHtml = (pending: boolean) =>
      `<p>🔧 <code>web_search</code> [1]${pending ? ' ⏳' : ''}</p><p>Answer.</p>`;
    // Two runs of tool calls with text between them; the last call still runs or is done.
    const twoRunsHtml = (pending: boolean) =>
      [
        '<p>Looking it up.</p>',
        '<p>🔧 <code>web_search</code> [1]</p>',
        '<p>Between.</p>',
        '<p>🔧 <code>run_shell_command</code> [2]</p>',
        `<p>🔧 <code>share_app</code> [3]${pending ? ' ⏳' : ''}</p>`,
        '<p>Answer.</p>',
      ].join('');
    // The reply as a message draws it: the fold around the reasoning and the parsed body.
    const renderReply = (
      html: string,
      {
        shownByDefault,
        threadId,
        reasoning,
      }: { shownByDefault: boolean; threadId?: string; reasoning?: string }
    ) => {
      const store = createStore();
      store.set(settingsAtom, { ...getSettings(), showToolCalls: shownByDefault });
      const element = (markup: string) => {
        const content = {
          body: markup,
          formatted_body: markup,
          'io.mindroom.stream_status': 'completed',
          ...(reasoning
            ? { 'io.mindroom.reasoning': { text: reasoning, duration_ms: 12_000 } }
            : {}),
        };
        const options = markerParserOptions(createBaseOpts(), content);
        return React.createElement(
          Provider,
          { store },
          React.createElement(
            ToolCallMessageContext.Provider,
            { value: { eventId: '$reply', roomId: ROOM, threadId } },
            React.createElement(
              ToolCallsFold,
              null,
              withReasoning(content, parse(markup, options), options)
            )
          )
        );
      };
      let renderer: ReactTestRenderer | undefined;
      act(() => {
        renderer = create(element(html));
      });
      const cogs = () =>
        renderer!.root.findAll(
          (node) =>
            typeof node.type === 'string' && node.props['data-tool-calls-fold'] !== undefined
        );
      const cog = () => {
        const [found] = cogs();
        if (!found) throw new Error('No cog on the reply');
        return found;
      };
      return {
        text: () => collectTextContent(renderer?.toJSON() ?? null),
        cogs,
        cogButton: () => cog().findByType('button'),
        cog,
        // The lines that open a run's calls, as they show when tool calls show.
        runLines: () =>
          renderer!.root.findAll(
            (node) =>
              typeof node.type === 'string' &&
              node.props['data-message-disclosure'] !== undefined &&
              node.props['data-tool-calls-fold'] === undefined
          ),
        update: (markup: string) => act(() => renderer?.update(element(markup))),
        unmount: () => act(() => renderer?.unmount()),
      };
    };

    it("shows a thread's tool calls where the thread menu showed them", () => {
      stored.set(storageKey, JSON.stringify({ [ROOM]: { threads: { $root: true } } }));
      const shown = renderReply(toolsHtml(false), { shownByDefault: false, threadId: '$root' });
      expect(shown.text()).toContain('web_search');
      expect(shown.cogs()).toHaveLength(0);
      shown.unmount();
      const other = renderReply(toolsHtml(false), { shownByDefault: false, threadId: '$other' });
      expect(other.text()).not.toContain('web_search');
      expect(other.cogs()).toHaveLength(1);
      other.unmount();
    });

    it("hides a room's tool calls where the room menu hid them", () => {
      stored.set(storageKey, JSON.stringify({ [ROOM]: { room: false } }));
      const reply = renderReply(toolsHtml(false), { shownByDefault: true, threadId: '$root' });
      expect(reply.text()).not.toContain('web_search');
      expect(reply.text()).toContain('Answer.');
      reply.unmount();
    });

    it('counts all the tool calls of the reply on one cog at its top, which turns while one runs', () => {
      const reply = renderReply(twoRunsHtml(true), { shownByDefault: false });
      expect(reply.text()).toBe('3Looking it up.Between.Answer.');
      expect(reply.cogs()).toHaveLength(1);
      expect(reply.cog().props['data-state']).toBe('running');
      expect(reply.cogButton().props.title).toBe('Running 3 tool calls');

      reply.update(twoRunsHtml(false));
      expect(reply.text()).toBe('3Looking it up.Between.Answer.');
      expect(reply.cog().props['data-state']).toBe('done');
      expect(reply.cogButton().props.title).toBe('Used 3 tools');
      reply.unmount();
    });

    it("puts the cog on the line of the reply's reasoning, after its toggle", () => {
      const reply = renderReply(twoRunsHtml(false), {
        shownByDefault: false,
        reasoning: 'Weighed two sources',
      });
      expect(reply.text()).toBe('Thought for 12 s3Looking it up.Between.Answer.');
      const line = reply.cog().parent;
      if (!line) throw new Error('No line around the cog');
      expect(line.findAll((node) => node.type === 'button').map((b) => b.props.title)).toEqual([
        undefined,
        'Used 3 tools',
      ]);
      reply.unmount();
    });

    it('takes a run off the cog when an edit of the reply drops it', () => {
      const reply = renderReply(twoRunsHtml(false), { shownByDefault: false });
      expect(reply.cogButton().props.title).toBe('Used 3 tools');
      reply.update(toolsHtml(false));
      expect(reply.text()).toBe('1Answer.');
      expect(reply.cogButton().props.title).toBe('Used 1 tool');
      reply.unmount();
    });

    describe('with the approval cards MindRoom posted for the reply', () => {
      afterEach(() => {
        approvals.current = undefined;
      });
      const cards = (...records: [toolName: string, status: string][]) => {
        approvals.current = {
          records: records.map(([toolName, status]) => ({
            eventId: `$${toolName}`,
            sender: '@mindroom_router:example.org',
            wireStatus: status,
            approval: {
              toolName,
              status,
              responseEventId: '$reply',
              expiresAt: '2999-01-01T00:00:00Z',
            },
          })),
          now: Date.now(),
        };
      };
      const emailAndSearch =
        '<p>🔧 <code>send_email</code> [1]</p><p>🔧 <code>web_search</code> [2]</p><p>Answer.</p>';

      it('tints the cog while a call waits for approval', () => {
        cards(['send_email', 'pending']);
        const reply = renderReply(emailAndSearch, { shownByDefault: false });
        expect(reply.cog().props['data-state']).toBe('waiting');
        expect(reply.cogButton().props.title).toBe('1 tool call waiting for approval');
        reply.unmount();
      });

      it('says what the calls did when one was denied, and counts both', () => {
        cards(['send_email', 'denied']);
        const reply = renderReply(emailAndSearch, { shownByDefault: false });
        expect(reply.cog().props['data-state']).toBe('done');
        expect(reply.cogButton().props.title).toBe('Used 1 tool');
        expect(reply.text()).toBe('2Answer.');
        reply.unmount();
      });
    });

    it('shows no cog on a reply without tool calls', () => {
      const reply = renderReply('<p>Answer.</p>', { shownByDefault: false });
      expect(reply.cogs()).toHaveLength(0);
      reply.unmount();
    });

    it('shows every run where it ran, as folded lines, until the cog hides them again', () => {
      const reply = renderReply(twoRunsHtml(false), { shownByDefault: false });
      expect(reply.cogButton().props['aria-expanded']).toBe(false);
      expect(reply.runLines()).toHaveLength(0);

      act(() => reply.cogButton().props.onClick());
      expect(reply.cogButton().props['aria-expanded']).toBe(true);
      const text = reply.text();
      const first = text.search(toolCountLabel(1));
      const second = text.search(toolCountLabel(2));
      expect(text.indexOf('Looking it up.')).toBeLessThan(first);
      expect(first).toBeLessThan(text.indexOf('Between.'));
      expect(text.indexOf('Between.')).toBeLessThan(second);
      expect(second).toBeLessThan(text.indexOf('Answer.'));
      const lines = reply.runLines();
      expect(lines).toHaveLength(2);
      lines.forEach((line) => expect(line.findByType('button').props['aria-expanded']).toBe(false));

      act(() => reply.cogButton().props.onClick());
      expect(reply.runLines()).toHaveLength(0);
      expect(reply.text()).not.toContain('web_search');
      reply.unmount();
    });
  });

  it('renders tool blocks for marker-only content and enriches them with trace metadata', () => {
    const html = '<p>🔧 <code>search_web</code> [1]</p>';

    const previewMarkup = renderWithToolTrace(html, {
      body: 'preview',
      formatted_body: html,
    });
    expect(previewMarkup).toMatch(toolCountLabel(1));
    expect(previewMarkup).not.toContain('🔧');

    const hydratedMarkup = renderWithToolTrace(html, {
      body: 'full response',
      formatted_body: html,
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_completed', tool_name: 'search_web', result_preview: 'Done' }],
      },
    });
    expect(hydratedMarkup).toMatch(toolCountLabel(1));
  });

  it('summarizes tool calls and lists each with its arguments and result', () => {
    const html = '<p>🔧 <code>web_search</code> [1]</p><p>🔧 <code>read_file</code> [2]</p>';
    const renderer = renderTreeWithToolTrace(html, {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_completed',
            tool_name: 'web_search',
            args_preview: 'query=MindRoom release notes, max_results=5',
            result_preview: '5 results',
          },
          {
            type: 'tool_call_started',
            tool_name: 'read_file',
            args_preview: 'reading the changelog',
          },
        ],
      },
    });

    const collapsed = collectTextContent(renderer.toJSON());
    expect(collapsed).toMatch(toolCountLabel(2));
    expect(collapsed).toContain('web_search, read_file');

    act(() => {
      renderer.root.findByType('button').props.onClick();
    });

    const rows = renderer.root.findAll(
      (node) => typeof node.type === 'string' && node.props['data-tool-index'] !== undefined
    );
    expect(rows.map((row) => row.props['data-tool-index'])).toEqual([1, 2]);
    const textOf = (row: typeof rows[number]) =>
      row
        .findAll(() => true)
        .flatMap((node) => node.children.filter((child) => typeof child === 'string'))
        .join(' ');
    expect(rows[0].findAllByType('dt').map((node) => node.children.join(''))).toEqual([
      'query',
      'max_results',
    ]);
    expect(textOf(rows[0])).toContain('MindRoom release notes');
    expect(textOf(rows[0])).toContain('5 results');
    expect(rows[1].findAll((node) => node.props.variant === 'Secondary')).not.toHaveLength(0);
    expect(rows[1].findByType('pre').children.join('')).toBe('reading the changelog');
  });

  it('shows the last lines of a running call output under the collapsed tool calls', () => {
    const html = '<p>🔧 <code>run_shell_command</code> [1]</p>';
    const output = Array.from({ length: 10 }, (_, i) => `step ${i + 1}`).join('\n');
    const renderer = renderTreeWithToolTrace(html, {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [{ type: 'tool_call_started', tool_name: 'run_shell_command', progress: output }],
      },
    });

    const text = collectTextContent(renderer.toJSON());
    expect(text).toMatch(toolCountLabel(1));
    expect(text).toContain('step 5');
    expect(text).toContain('step 10');
    expect(text).not.toContain('step 4');
  });

  it('keeps the indentation of a running call output first line', () => {
    const html = '<p>🔧 <code>run_shell_command</code> [1]</p>';
    const renderer = renderTreeWithToolTrace(html, {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_started',
            tool_name: 'run_shell_command',
            progress: '  root:\n    child: 1\n',
          },
        ],
      },
    });

    const [output] = renderer.root.findAll((node) => node.props.className === 'activity-output');
    expect(output.children.join('')).toBe('  root:\n    child: 1');
  });

  it('drops leading blank lines of a running call output', () => {
    const html = '<p>🔧 <code>run_subagent</code> [1]</p>';
    const renderer = renderTreeWithToolTrace(html, {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_started',
            tool_name: 'run_subagent',
            progress: '\r\n\nCalling write_report\n  writing',
          },
        ],
      },
    });

    const [output] = renderer.root.findAll((node) => node.props.className === 'activity-output');
    expect(output.children.join('')).toBe('Calling write_report\n  writing');
  });

  it('names the call whose output shows only while several calls run', () => {
    const html =
      '<p>🔧 <code>run_shell_command</code> [1]</p><p>🔧 <code>run_shell_command</code> [2]</p>';
    const started = (args: string, progress?: string) => ({
      type: 'tool_call_started',
      tool_name: 'run_shell_command',
      args_preview: args,
      progress,
    });
    const labels = (events: object[]) =>
      renderTreeWithToolTrace(html, { 'io.mindroom.tool_trace': { version: 2, events } })
        .root.findAll((node) => node.props.className === 'activity-output-label')
        .map((node) => node.children.join(''));

    expect(labels([started('pytest'), started('npm run build', 'compiling')])).toEqual([
      'run_shell_command(npm run build)',
    ]);
    expect(
      labels([
        { type: 'tool_call_completed', tool_name: 'run_shell_command', result_preview: 'ok' },
        started('npm run build', 'compiling'),
      ])
    ).toEqual([]);
  });

  it('drops a call output once the call completed', () => {
    const html = '<p>🔧 <code>run_shell_command</code> [1]</p>';
    const renderer = renderTreeWithToolTrace(html, {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_completed',
            tool_name: 'run_shell_command',
            result_preview: 'built',
            progress: 'step 1',
          },
        ],
      },
    });

    expect(collectTextContent(renderer.toJSON())).not.toContain('step 1');
  });

  it('expands marker-only tool refs with the marker tool name', () => {
    const markerHtml = '<p>🔧 <code>run_shell_command</code> [1]</p>';
    const renderer = renderTreeWithToolTrace(markerHtml, { formatted_body: markerHtml });

    expect(collectTextContent(renderer.toJSON())).toMatch(toolCountLabel(1));

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    const expanded = collectTextContent(renderer.toJSON());
    expect(toolRowText(renderer, 1)).toContain('run_shell_command');
    expect(renderer.root.findAll((node) => node.props.src === 'Check')).not.toHaveLength(0);
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
    expect(collapsed).toMatch(toolCountLabel(3));
    expect(renderer.root.findAllByType('button')).toHaveLength(1);

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    const expanded = collectTextContent(renderer.toJSON());
    expect(toolRowText(renderer, 1)).toContain('first_tool');
    expect(expanded).toContain('FIRST');
    expect(toolRowText(renderer, 2)).toContain('second_tool');
    expect(toolRowText(renderer, 3)).toContain('third_tool');
    expect(
      renderer.root.findAll(
        (node) => typeof node.type === 'string' && node.props['data-tool-index'] !== undefined
      )
    ).toHaveLength(3);
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

    expect(markup).not.toMatch(toolCountLabel(2));
    expect(markup.match(toolCountLabel(1, 'g'))).toHaveLength(2);
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

  it('renders and copies a paragraph of many markers without recursing per marker', () => {
    const count = 3_000;
    const markers = Array.from({ length: count }, (_, index) => `🔧 <code>t</code> [${index + 1}]`);
    const html = `<p>${markers.join('<br>')}<br>Done</p>`;
    const opts = markerParserOptions(createBaseOpts(), {
      formatted_body: html,
    });

    // Each marker used to parse the rest of its paragraph one level deeper,
    // which overflowed the stack for a long paragraph.
    const parsed = parse(html, opts) as React.ReactElement;
    const shown = React.Children.toArray(parsed.props.children);
    const toolBlocks = shown.filter(
      (node) =>
        React.isValidElement<{ parsedTools?: unknown }>(node) &&
        Array.isArray(node.props.parsedTools)
    );
    expect(toolBlocks).toHaveLength(count);
    expect(renderToStaticMarkup(shown[shown.length - 1] as React.ReactElement)).toBe('<p>Done</p>');
    expect(getRenderedToolRefs(html).toolBlocks).toHaveLength(count);
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

    expect(markup).toMatch(toolCountLabel(1));
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

    expect(markup).toMatch(toolCountLabel(1));
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

    expect(markup).toMatch(toolCountLabel(1));
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
    expect(collapsed).toMatch(toolCountLabel(1));

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    const expanded = collectTextContent(renderer.toJSON());
    expect(toolRowText(renderer, 1)).toContain('search_web');
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
      (s) => s.props.size === '50' && s.props.variant === 'Secondary'
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
      (s) => s.props.size === '50' && s.props.variant === 'Secondary'
    );
    expect(completedSpinnerSpan).toBeUndefined();

    // A finished group shows a check, as each finished row does.
    const checkIcon = completedSpans.find((s) => s.props.src === 'Check');
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

    expect(collectTextContent(renderer.toJSON())).not.toContain('Single-line output');

    const toggle = renderer.root.findByType('button');
    act(() => {
      toggle.props.onClick();
    });

    // The result shows on one line and opens to its full text when selected.
    const result = renderer.root.find(
      (node) => node.type === 'button' && node.props['aria-expanded'] === false
    );
    expect(result.children.join('')).toContain('Single-line output');
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

    const plainMarkup = renderCustomHtmlMarkup(`<p><a href="${matrixTo}">${userId}</a></p>`, mx);
    expect(plainMarkup).toContain(`href="${matrixTo}"`);
    expect(plainMarkup).toContain(`data-mention-id="${userId}"`);

    for (const codeTree of [
      renderCustomHtmlTree(`<p><code><a href="${matrixTo}">${userId}</a></code></p>`, mx),
      renderCustomHtmlTree(`<pre><code><a href="${matrixTo}">${userId}</a></code></pre>`, mx),
    ]) {
      expect(collectTextContent(codeTree.toJSON())).toContain(userId);
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
      `<pre><code><a href="${matrixTo}">${userId}</a></code></pre>`
    );
    const copyControl = codeTree.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Copy code'
    );

    await act(async () => {
      await copyControl.props.onClick();
    });

    expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith(userId);
    codeTree.unmount();
  });

  it('preserves intentional Matrix-link labels inside code and Copy', async () => {
    const matrixTo = 'https://matrix.to/#/@alice:example.org';
    const customLabel = 'lookup_user()';
    clipboardMocks.copyToClipboard.mockReset();
    clipboardMocks.copyToClipboard.mockResolvedValue(false);

    const codeTree = renderCustomHtmlTree(
      `<pre><code><a href="${matrixTo}">${customLabel}</a></code></pre>`
    );
    const copyControl = codeTree.root.find(
      (node) => node.type === 'button' && node.props['aria-label'] === 'Copy code'
    );

    expect(collectTextContent(codeTree.toJSON())).toContain(customLabel);
    expect(codeTree.root.findAllByType('a')).toHaveLength(0);

    await act(async () => {
      await copyControl.props.onClick();
    });

    expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith(customLabel);
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

  it('scales emoji in text but not inside URLs', () => {
    const markup = renderLatexTextMarkup('✅ https://example.org/✅ ✅');

    expect(markup.match(/Emoticon"/g)).toHaveLength(2);
    expect(markup).toContain('https://example.org/✅');
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

// Copy may strip marker lines only when the app renders exactly those markers as
// tool blocks and shows nothing of them elsewhere; check against the real renderer.
describe('copy stripping matches the app renderer', () => {
  // The renderer shows these markers but detection conservatively skips them:
  // names holding another index, and (in sender HTML only, since the plain-body
  // fallback escapes HTML) markers nested in wrappers the base parser leaves alone.
  const knownDetectionGaps = new Set(['tool name containing another index']);
  const knownFormattedBodyGaps = new Set([
    'tool call inside a raw div',
    'tool call inside a details block',
  ]);

  // Everything the app shows as text outside tool blocks, including HTML it
  // injects directly, such as KaTeX output.
  const textOutsideToolBlocks = (node: ReactTestInstance | string): string => {
    if (typeof node === 'string') return node;
    if (Array.isArray(node.props?.parsedTools)) return '';
    const injected = node.props?.dangerouslySetInnerHTML?.__html;
    return (
      (typeof injected === 'string' ? injected.replace(/<[^>]*>/g, '') : '') +
      node.children.map(textOutsideToolBlocks).join('')
    );
  };

  const expectCopyMatchesRender = async (
    name: string,
    body: string,
    formattedBody: string | undefined,
    renderedHtml: string
  ) => {
    const html = sanitizeCustomHtml(renderedHtml);
    const baseOpts = getReactCustomHtmlParser({} as MatrixClient, undefined, {
      linkifyOpts: LINKIFY_OPTS,
    });
    const opts = markerParserOptions(baseOpts, {
      body,
      formatted_body: renderedHtml,
    });
    let renderer!: ReactTestRenderer;
    await act(async () => {
      renderer = create(React.createElement(React.Fragment, null, parse(html, opts)));
    });
    const renderedToolIndexes = renderer.root
      .findAll((node) => Array.isArray(node.props?.parsedTools))
      .flatMap((node) =>
        (node.props.parsedTools as Array<{ index: number }>).map((tool) => tool.index)
      );
    const shownText = textOutsideToolBlocks(renderer.root);
    renderer.unmount();

    // Repeated indexes render once as a block and again as text, so compare sets.
    const plainBodyFallback = formattedBody === undefined;
    const detected = new Set(
      getRenderedToolRefs(html).toolBlocks.map(({ index }) => index)
    );
    const rendered = new Set(renderedToolIndexes);
    detected.forEach((index) => expect(rendered.has(index)).toBe(true));
    if (knownDetectionGaps.has(name) || (!plainBodyFallback && knownFormattedBodyGaps.has(name))) {
      expect(detected.size).toBeLessThan(rendered.size);
    } else {
      expect(detected.size).toBe(rendered.size);
    }

    const scan = scanToolMarkerLines(body, formattedBody, plainBodyFallback);
    if (!scan) return;
    // Stripped lines are exactly the tool blocks, and nothing of them is shown
    // as text: no 🔧, and no ⏳ beyond what the copy keeps.
    const stripped = scan.toolRefs.filter(Boolean).map((toolRef) => toolRef?.index);
    expect(stripped.sort()).toEqual([...renderedToolIndexes].sort());
    expect(shownText).not.toContain('🔧');
    const { text } = getMessageCopyTexts({ body, formattedBody, plainBodyFallback }, scan);
    expect(shownText.split('⏳').length).toBe(text.split('⏳').length);
  };

  it.each(Object.entries(backendToolMarkerBodies))(
    'backend formatted_body: %s',
    async (name, { body, formatted_body: formattedBody }) => {
      await expectCopyMatchesRender(name, body, formattedBody, formattedBody);
    }
  );

  it.each(Object.entries(backendToolMarkerBodies))(
    'plain-body fallback: %s',
    async (name, { body }) => {
      const fallbackHtml = formatMessageTextBodyAsHtml(body);
      if (fallbackHtml) await expectCopyMatchesRender(name, body, undefined, fallbackHtml);
    }
  );

  // Hand-written events whose shown text comes from attributes; no MindRoom
  // sender produces them, but copy must still keep the attribute-shown line.
  it.each([
    [
      'KaTeX block rendered from an attribute',
      '$$\n🔧 `x` [1]\n$$\n\n&#x1F527; `x` [1]',
      '<div data-mx-maths="🔧 `x` [1]"></div><p>🔧 <code>x</code> [1]</p>',
    ],
    [
      'inline KaTeX rendered from an attribute',
      'Formula:\n🔧 `x` [1]\n\n&#x1F527; `x` [1]',
      '<p>Formula: <span data-mx-maths="🔧 `x` [1]"></span></p><p>🔧 <code>x</code> [1]</p>',
    ],
    [
      'code-block label rendered from an attribute',
      '🔧 `x` [1]\n\n&#x1F527; `x` [1]',
      '<pre><code data-label="🔧 `x` [1]">code</code></pre><p>🔧 <code>x</code> [1]</p>',
    ],
  ])('crafted formatted_body: %s', async (name, body, formattedBody) => {
    expect(scanToolMarkerLines(body, formattedBody, false)).toBeUndefined();
    await expectCopyMatchesRender(name, body, formattedBody, formattedBody);
  });
});

describe('direction controls in tool calls and code', () => {
  const CONTROL = /[\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/;

  it('lists a tool call with the controls of its arguments and output as code points', () => {
    const renderer = renderTreeWithToolTrace('<p>🔧 <code>run_shell_command</code> [1]</p>', {
      'io.mindroom.tool_trace': {
        version: 2,
        events: [
          {
            type: 'tool_call_completed',
            tool_name: 'run_shell_command',
            args_preview: 'args=echo hi \u202e; echo pwned #\u202c done',
            result_preview: 'hi \u202ex',
          },
        ],
      },
    });
    act(() => {
      renderer.root.findByType('button').props.onClick();
    });

    const text = collectTextContent(renderer.toJSON());
    expect(text).toContain('echo hi <U+202E>; echo pwned #<U+202C> done');
    expect(text).toContain('hi <U+202E>x');
    expect(text).not.toMatch(CONTROL);
    renderer.unmount();
  });

  it('shows inline code and code blocks with their controls as code points', () => {
    const markup = renderCustomHtmlMarkup(
      '<p><code>rm \u202ex</code></p><pre><code>echo \u202e; ls #\u202c</code></pre>'
    );
    expect(markup).toContain('rm &lt;U+202E&gt;x');
    expect(markup).toContain('&lt;U+202C&gt;');
    expect(markup).not.toMatch(CONTROL);
  });

  it('shows message text with every control as a code point', () => {
    const text =
      'invoice\u202etxt.exe\u202c, \u2066a\u2069 \u2067b\u2069 \u2068c\u2069 \u202ad\u202b\u202d \u200e\u200f\u061c';
    const shown =
      'invoice<U+202E>txt.exe<U+202C>, <U+2066>a<U+2069> <U+2067>b<U+2069> <U+2068>c<U+2069> ' +
      '<U+202A>d<U+202B><U+202D> <U+200E><U+200F><U+061C>';
    const plain = renderLatexTextMarkup(text);
    expect(plain).toContain(shown.replace(/</g, '&lt;').replace(/>/g, '&gt;'));
    expect(plain).not.toMatch(CONTROL);
    // Math and links keep working beside the code points.
    expect(renderLatexTextMarkup('see https://example.org \u202e$x^2$')).toContain(
      'href="https://example.org"'
    );

    const formatted = renderCustomHtmlMarkup(`<p>Rename <b>${text}</b> first</p>`);
    expect(formatted).toContain(
      `<b>${shown.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</b>`
    );
    expect(formatted).not.toMatch(CONTROL);
  });
});
