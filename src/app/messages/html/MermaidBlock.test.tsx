// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { color } from 'folds';
import parse from 'html-react-parser';
import type { MatrixClient } from 'matrix-js-sdk';
import type { MermaidConfig } from 'mermaid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from './react-custom-html-parser';
import { readMermaidTheme, renderMermaidDiagram, sanitizeMermaidSvg } from './lazyMermaid';

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<boolean>>(),
}));

const mermaidMocks = vi.hoisted(() => ({
  initialize: vi.fn<(config: MermaidConfig) => void>(),
  render: vi.fn<(id: string, text: string) => Promise<{ svg: string }>>(),
}));

vi.mock('mermaid', () => ({
  default: { initialize: mermaidMocks.initialize, render: mermaidMocks.render },
}));
vi.mock('../../lib/dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/dom')>()),
  copyToClipboard: clipboardMocks.copyToClipboard,
}));
vi.mock('../content/ImageOverlay', () => ({ ImageOverlay: () => null }));
vi.mock('../../rich-text/CustomHtml.css', () => ({
  ...Object.fromEntries(
    [
      'BlockQuote',
      'Heading',
      'List',
      'Paragraph',
      'MarginSpaced',
      'CodeBlock',
      'CodeBlockHeader',
      'CodeBlockLabel',
      'CodeBlockLabelText',
      'CodeBlockLanguageIcon',
      'CodeBlockActions',
      'CodeBlockAction',
      'CodeBlockActionIcon',
      'CodeBlockScroll',
      'CodeBlockInternal',
      'CodeBlockBottomShadow',
      'Code',
      'EmoticonBase',
      'highlightText',
    ].map((name) => [name, name])
  ),
  Mention: () => 'Mention',
  Spoiler: () => 'Spoiler',
  Emoticon: () => 'Emoticon',
}));
vi.mock('./MermaidBlock.css', () =>
  Object.fromEntries(
    ['MermaidViewport', 'MermaidSvg', 'MermaidToggle', 'MermaidStatus'].map((n) => [n, n])
  )
);
vi.mock('../../rich-text/matrixMath.css', () => ({
  MathInline: 'MathInline',
  MathBlock: 'MathBlock',
}));
vi.mock('../../rich-text/ScrollableTable.css', () => ({}));
vi.mock('./HtmlBlocks.css', () => ({}));
vi.mock('../../approvals/ApprovalArgumentFields.css', () => ({}));

const sampleSvg = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><g><text>${label}</text></g></svg>`;

const renderMessageHtml = (html: string, highlightRegex?: RegExp) => {
  const options = getReactCustomHtmlParser({} as MatrixClient, undefined, {
    linkifyOpts: LINKIFY_OPTS,
    highlightRegex,
  });
  return render(<div>{parse(html, options)}</div>);
};

beforeEach(() => {
  mermaidMocks.initialize.mockReset();
  mermaidMocks.render.mockReset();
  clipboardMocks.copyToClipboard.mockReset();
  document.documentElement.className = 'light-theme';
  document.documentElement.dataset.themeKind = 'light';
  document.body.className = 'prism-light';
});

afterEach(() => {
  cleanup();
  document.documentElement.className = '';
  delete document.documentElement.dataset.themeKind;
  document.body.className = '';
  document.body.style.cssText = '';
});

describe('MermaidBlock', () => {
  it('lazy-renders valid mermaid blocks with strict security config and skips non-mermaid code', async () => {
    mermaidMocks.render.mockResolvedValue({ svg: sampleSvg('Flow A to B') });

    const tsView = renderMessageHtml('<pre><code class="language-ts">const x = 1;</code></pre>');
    expect(mermaidMocks.initialize).not.toHaveBeenCalled();
    expect(mermaidMocks.render).not.toHaveBeenCalled();
    tsView.unmount();

    renderMessageHtml('<pre><code class="language-mermaid">graph TD\n  A --&gt; B</code></pre>');

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Mermaid diagram' })).toBeTruthy();
    });

    expect(mermaidMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        suppressErrorRendering: true,
        theme: 'base',
        darkMode: false,
      })
    );
    expect(mermaidMocks.render).toHaveBeenCalledWith(
      expect.stringMatching(/^mindroom-mermaid-\d+$/),
      'graph TD\n  A --> B'
    );
    expect(screen.getByText('mermaid')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Mermaid diagram' }).innerHTML).toContain(
      'Flow A to B'
    );
  });

  it('toggles between Diagram and Source views while keeping Copy working in both', async () => {
    const source = 'sequenceDiagram\n  Alice->>Bob: Hi';
    mermaidMocks.render.mockResolvedValue({ svg: sampleSvg('Alice to Bob') });
    clipboardMocks.copyToClipboard.mockResolvedValue(true);

    renderMessageHtml(
      '<pre><code class="language-mermaid">sequenceDiagram\n  Alice-&gt;&gt;Bob: Hi</code></pre>'
    );

    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Mermaid diagram' })).toBeTruthy();
    });
    expect(screen.queryByRole('button', { name: 'Wrap lines' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Show source' }));
    expect(screen.queryByRole('region', { name: 'Mermaid diagram' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Wrap lines' })).toBeTruthy();
    expect(screen.getByText(/Alice->>Bob: Hi/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => {
      expect(clipboardMocks.copyToClipboard).toHaveBeenCalledWith(source);
    });

    fireEvent.click(screen.getByRole('button', { name: 'Show diagram' }));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Mermaid diagram' })).toBeTruthy();
    });
  });

  it('falls back cleanly to Source on invalid syntax without leaking error SVGs into document.body', async () => {
    mermaidMocks.render.mockImplementation(async (id) => {
      const stray = document.createElement('div');
      stray.id = `d${id}`;
      stray.innerHTML = '<svg class="error-icon"><text>Syntax error</text></svg>';
      document.body.appendChild(stray);
      throw new Error('Parse error on line 1');
    });

    const { container } = renderMessageHtml(
      '<pre><code class="language-mermaid">graph TD\n  A --&gt;</code></pre>'
    );

    await waitFor(() => {
      expect(screen.getByText('Showing source')).toBeTruthy();
    });

    expect(screen.queryByRole('region', { name: 'Mermaid diagram' })).toBeNull();
    expect(container.querySelector('code')?.textContent).toContain('graph TD');
    expect(document.body.querySelector('svg.error-icon')).toBeNull();
    expect(document.querySelector('[id^="dmindroom-mermaid-"]')).toBeNull();
  });

  it('retains the last valid SVG during streaming syntax errors and updates on the next valid chunk', async () => {
    mermaidMocks.render.mockImplementation(async (_id, text) => {
      if (text.endsWith('-->')) throw new Error('Incomplete edge');
      return { svg: sampleSvg(text.includes('C') ? 'A B C' : 'A B') };
    });

    const makeTree = (src: string) => {
      const options = getReactCustomHtmlParser({} as MatrixClient, undefined, {
        linkifyOpts: LINKIFY_OPTS,
      });
      return <div>{parse(`<pre><code class="language-mermaid">${src}</code></pre>`, options)}</div>;
    };

    const view = render(makeTree('graph TD\n  A --&gt; B'));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Mermaid diagram' }).innerHTML).toContain('A B');
    });

    view.rerender(makeTree('graph TD\n  A --&gt; B\n  B --&gt;'));
    await waitFor(() => {
      expect(mermaidMocks.render).toHaveBeenCalledTimes(2);
    });
    expect(screen.getByRole('region', { name: 'Mermaid diagram' }).innerHTML).toContain('A B');
    expect(screen.queryByText('Showing source')).toBeNull();

    view.rerender(makeTree('graph TD\n  A --&gt; B\n  B --&gt; C'));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Mermaid diagram' }).innerHTML).toContain('A B C');
    });
  });

  it('shows Source view automatically when searchMatch is true and returns to Diagram when search clears', async () => {
    mermaidMocks.render.mockResolvedValue({ svg: sampleSvg('Payment flow') });

    const makeTree = (regex?: RegExp) => {
      const options = getReactCustomHtmlParser({} as MatrixClient, undefined, {
        linkifyOpts: LINKIFY_OPTS,
        highlightRegex: regex,
      });
      return (
        <div>
          {parse(
            '<pre><code class="language-mermaid">graph LR\n  Pay --&gt; Done</code></pre>',
            options
          )}
        </div>
      );
    };

    const view = render(makeTree(/Pay/gi));
    expect(screen.queryByRole('region', { name: 'Mermaid diagram' })).toBeNull();
    expect(view.container.querySelector('.highlightText')?.textContent).toBe('Pay');
    expect(mermaidMocks.render).not.toHaveBeenCalled();

    view.rerender(makeTree(undefined));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Mermaid diagram' })).toBeTruthy();
    });
  });

  it('re-renders with updated darkMode and computed palette themeVariables on theme switch', async () => {
    mermaidMocks.render.mockImplementation(async () => ({
      svg: sampleSvg(document.documentElement.dataset.themeKind ?? 'unknown'),
    }));

    const primaryVar = /^var\((--[\w-]+)/.exec(color.Primary.Main)?.[1];
    renderMessageHtml('<pre><code class="language-mermaid">graph LR\n  X --&gt; Y</code></pre>');

    await waitFor(() => {
      expect(mermaidMocks.initialize).toHaveBeenCalledTimes(1);
    });
    expect(mermaidMocks.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ theme: 'base', darkMode: false })
    );

    if (primaryVar) document.body.style.setProperty(primaryVar, '#7aa2f7');
    document.documentElement.className = 'tokyoNight-theme';
    document.documentElement.dataset.themeKind = 'dark';
    document.body.className = 'prism-dark';

    await waitFor(() => {
      expect(mermaidMocks.initialize).toHaveBeenCalledTimes(2);
    });
    expect(mermaidMocks.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({
        theme: 'base',
        darkMode: true,
        themeVariables: expect.objectContaining({
          darkMode: true,
          ...(primaryVar ? { primaryBorderColor: '#7aa2f7' } : {}),
        }),
      })
    );
    expect(screen.getByRole('region', { name: 'Mermaid diagram' }).innerHTML).toContain('dark');
  });

  it('serializes concurrent renderMermaidDiagram calls and recovers after a rejection', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;

    mermaidMocks.initialize.mockImplementation((cfg) => {
      order.push(`init:${cfg.darkMode ? 'dark' : 'light'}`);
    });
    mermaidMocks.render.mockImplementation(async (_id, text) => {
      order.push(`start:${text}`);
      if (text === 'first') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push('end:first');
        throw new Error('first failed');
      }
      order.push(`end:${text}`);
      return { svg: sampleSvg(text) };
    });

    const lightTheme = readMermaidTheme();
    document.documentElement.dataset.themeKind = 'dark';
    const darkTheme = readMermaidTheme();

    const p1 = renderMermaidDiagram('first', lightTheme);
    const p2 = renderMermaidDiagram('second', darkTheme);

    await waitFor(() => {
      expect(order).toEqual(['init:light', 'start:first']);
    });

    releaseFirst();
    await expect(p1).rejects.toThrow('first failed');
    expect(await p2).toContain('second');
    expect(order).toEqual([
      'init:light',
      'start:first',
      'end:first',
      'init:dark',
      'start:second',
      'end:second',
    ]);
  });

  it('strips scripts, foreignObject, event handlers, javascript URLs, and unsafe CSS from SVG output', async () => {
    const hostileSvg = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">',
      '<style>@import url("https://evil.example/x.css"); .node{fill:url(#grad);background:url(https://evil.example/leak.png);}</style>',
      '<script>alert("xss")</script>',
      '<foreignObject width="100" height="50"><div xmlns="http://www.w3.org/1999/xhtml"><img src="x" onerror="alert(2)"/></div></foreignObject>',
      '<g onclick="steal()">',
      '<a href="javascript:alert(3)"><text>Bad link</text></a>',
      '<a href="https://example.com/docs"><text>Good link</text></a>',
      '<use href="#valid-marker"/>',
      '<use xlink:href="https://evil.example/sprite.svg#icon"/>',
      '<path style="marker-end:url(#arrow);fill:url(https://evil.example/p.png)" d="M0 0 L10 10"/>',
      '</g>',
      '</svg>',
    ].join('');

    const cleaned = sanitizeMermaidSvg(hostileSvg);
    expect(cleaned).not.toBeNull();
    expect(cleaned).not.toMatch(
      /<script|foreignObject|onload|onclick|javascript:|@import|evil\.example/
    );
    expect(cleaned).toContain('url(#grad)');
    expect(cleaned).toContain('url(#arrow)');
    expect(cleaned).toContain('#valid-marker');

    mermaidMocks.render.mockResolvedValue({ svg: hostileSvg });
    renderMessageHtml('<pre><code class="language-mermaid">graph TD\n  A --&gt; B</code></pre>');

    const diagram = await screen.findByRole('region', { name: 'Mermaid diagram' });
    expect(
      diagram.querySelector('script, foreignObject, [onload], [onclick], [onerror]')
    ).toBeNull();
    expect(diagram.querySelector('a[href^="javascript:"]')).toBeNull();
    const safeLink = diagram.querySelector('a[href="https://example.com/docs"]');
    expect(safeLink?.getAttribute('rel')).toBe('noreferrer noopener');
    expect(safeLink?.getAttribute('target')).toBe('_blank');
  });
});
