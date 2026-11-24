// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { color } from 'folds';
import parse from 'html-react-parser';
import type { MatrixClient } from 'matrix-js-sdk';
import type { MermaidConfig } from 'mermaid';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAppTheme } from '../../theme/appliedTheme';
import { LightTheme, MidnightTheme } from '../../theme/useTheme';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from './react-custom-html-parser';
import {
  hasExternalResourceReference,
  readMermaidTheme,
  renderMermaidDiagram,
  sanitizeMermaidSvg,
} from './lazyMermaid';

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
  applyAppTheme(LightTheme);
});

afterEach(() => {
  cleanup();
  document.documentElement.className = '';
  delete document.documentElement.dataset.themeKind;
  document.body.className = '';
  document.body.style.cssText = '';
});

describe('MermaidBlock', () => {
  it('lazy-renders valid mermaid blocks with strict security config and keyboard-scrollable region', async () => {
    mermaidMocks.render.mockResolvedValue({ svg: sampleSvg('Flow A to B') });

    const tsView = renderMessageHtml('<pre><code class="language-ts">const x = 1;</code></pre>');
    expect(mermaidMocks.initialize).not.toHaveBeenCalled();
    expect(mermaidMocks.render).not.toHaveBeenCalled();
    tsView.unmount();

    renderMessageHtml('<pre><code class="language-mermaid">graph TD\n  A --&gt; B</code></pre>');

    const region = await screen.findByRole('region', { name: 'Mermaid diagram' });
    expect(region.getAttribute('tabindex')).toBe('0');

    expect(mermaidMocks.initialize).toHaveBeenCalledWith(
      expect.objectContaining({
        startOnLoad: false,
        securityLevel: 'strict',
        htmlLabels: false,
        suppressErrorRendering: true,
        theme: 'base',
        darkMode: false,
        secure: expect.arrayContaining([
          'securityLevel',
          'suppressErrorRendering',
          'htmlLabels',
          'themeCSS',
          'fontFamily',
          'altFontFamily',
        ]),
      })
    );
    expect(mermaidMocks.render).toHaveBeenCalledWith(
      expect.stringMatching(/^mindroom-mermaid-\d+$/),
      'graph TD\n  A --> B'
    );
    expect(screen.getByText('mermaid')).toBeTruthy();
    expect(region.innerHTML).toContain('Flow A to B');
  });

  it('toggles between Diagram and Source views while keeping Copy working in both', async () => {
    const source = 'sequenceDiagram\n  Alice->>Bob: Hi';
    mermaidMocks.render.mockResolvedValue({ svg: sampleSvg('Alice to Bob') });
    clipboardMocks.copyToClipboard.mockResolvedValue(true);

    renderMessageHtml(
      '<pre><code class="language-mermaid">sequenceDiagram\n  Alice-&gt;&gt;Bob: Hi</code></pre>'
    );

    await screen.findByRole('region', { name: 'Mermaid diagram' });
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
    await screen.findByRole('region', { name: 'Mermaid diagram' });
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

    await screen.findByText('Showing source');
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
    await screen.findByRole('region', { name: 'Mermaid diagram' });
  });

  it('re-renders with updated darkMode and computed palette themeVariables on applyAppTheme', async () => {
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

    act(() => {
      if (primaryVar) document.body.style.setProperty(primaryVar, '#7aa2f7');
      applyAppTheme(MidnightTheme);
    });

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

  it('rejects external render-time image and CSS fetches before calling mermaid.render', async () => {
    const blockedSources = [
      'flowchart LR\n  A@{ img: "https://evil.example/track.png", label: "x" } --> B',
      'flowchart LR\n  A@{ shape: image, label: "x" } --> B',
      'sequenceDiagram\n  participant Alice\n  properties Alice: {"icon": "https://evil.example/a.png"}\n  Alice->>Bob: hi',
      'sequenceDiagram\n  participant Alice\n  details Alice: {"properties": {"icon": "https://evil.example/a.png"}}\n  Alice->>Bob: hi',
      'stateDiagram-v2\n  classDef e fill:url(https://evil.example/st.png)\n  s1:::e --> s2',
      'classDiagram\n  class A\n  style A fill:#fff; background-image:url(https://evil.example/cd.png)',
      'flowchart LR\n  A["<img src=https://evil.example/x.png>"] --> B',
    ];
    for (const src of blockedSources) {
      expect(hasExternalResourceReference(src), src).toBe(true);
    }

    const allowedSources = [
      'flowchart LR\n  A@{ shape: diam, label: "Check" } --> B',
      'flowchart LR\n  A[Start] --> B\n  style A fill:url(#myGrad)',
      'flowchart LR\n  A[Click me] --> B\n  click A "https://example.com"',
      'sequenceDiagram\n  participant Alice\n  properties Alice: {"icon": "@embedded"}\n  Alice->>Bob: hi',
    ];
    for (const src of allowedSources) {
      expect(hasExternalResourceReference(src), src).toBe(false);
    }

    renderMessageHtml(
      '<pre><code class="language-mermaid">flowchart LR\n  A@{ img: "https://evil.example/track.png", label: "x" } --&gt; B</code></pre>'
    );

    await screen.findByText('Showing source');
    expect(mermaidMocks.render).not.toHaveBeenCalled();
  });

  it('repairs missing xmlns:xlink and unwraps diagram links into inert groups', async () => {
    // Mermaid emits `<a xlink:href="...">` without `xmlns:xlink` on `<svg>`.
    const mermaidLinkSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">' +
      '<a xlink:href="https://example.com/docs" target="_blank" class="clickable">' +
      '<rect width="80" height="30"/><text>Docs node</text></a></svg>';

    const cleaned = sanitizeMermaidSvg(mermaidLinkSvg);
    expect(cleaned).not.toBeNull();
    expect(cleaned).toContain('Docs node');
    expect(cleaned).not.toMatch(/<a\b|\bhref=|\bxlink:href=/i);

    mermaidMocks.render.mockResolvedValue({ svg: mermaidLinkSvg });
    renderMessageHtml(
      '<pre><code class="language-mermaid">flowchart LR\n  A --&gt; B</code></pre>'
    );

    const diagram = await screen.findByRole('region', { name: 'Mermaid diagram' });
    expect(diagram.textContent).toContain('Docs node');
    expect(diagram.querySelector('a')).toBeNull();
    expect(diagram.querySelector('[href], [xlink\\:href]')).toBeNull();
  });

  it('falls back to Source when Mermaid emits non-empty foreignObject and strips empty ones', async () => {
    const emptyFoSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">' +
      '<foreignObject width="0" height="0">   </foreignObject><text>OK</text></svg>';
    const cleanedEmpty = sanitizeMermaidSvg(emptyFoSvg);
    expect(cleanedEmpty).not.toBeNull();
    expect(cleanedEmpty).toContain('OK');
    expect(cleanedEmpty).not.toContain('foreignObject');

    const katexFoSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 40">' +
      '<foreignObject width="60" height="20"><span xmlns="http://www.w3.org/1999/xhtml">x=2</span></foreignObject></svg>';
    expect(sanitizeMermaidSvg(katexFoSvg)).toBeNull();

    mermaidMocks.render.mockResolvedValue({ svg: katexFoSvg });
    renderMessageHtml(
      '<pre><code class="language-mermaid">sequenceDiagram\n  Alice-&gt;&gt;Bob: $$x=2$$</code></pre>'
    );

    await screen.findByText('Showing source');
    expect(screen.queryByRole('region', { name: 'Mermaid diagram' })).toBeNull();
  });

  it('strips scripts, event handlers, external use refs, and unsafe CSS while preserving internal SVG refs', async () => {
    const hostileSvg = [
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" onload="alert(1)">',
      '<style>@import url("https://evil.example/x.css"); .node{fill:url(#grad);background:url(https://evil.example/leak.png);}</style>',
      '<script>alert("xss")</script>',
      '<g onclick="steal()">',
      '<a href="javascript:alert(3)"><text>Label kept</text></a>',
      '<use href="#valid-marker"/>',
      '<use xlink:href="https://evil.example/sprite.svg#icon"/>',
      '<path style="marker-end:url(#arrow);fill:url(https://evil.example/p.png)" d="M0 0 L10 10"/>',
      '</g>',
      '</svg>',
    ].join('');

    const cleaned = sanitizeMermaidSvg(hostileSvg);
    expect(cleaned).not.toBeNull();
    expect(cleaned).not.toMatch(/<script|onload|onclick|javascript:|@import|evil\.example|<a\b/);
    expect(cleaned).toContain('Label kept');
    expect(cleaned).toContain('url(#grad)');
    expect(cleaned).toContain('url(#arrow)');
    expect(cleaned).toContain('#valid-marker');

    mermaidMocks.render.mockResolvedValue({ svg: hostileSvg });
    renderMessageHtml('<pre><code class="language-mermaid">graph TD\n  A --&gt; B</code></pre>');

    const diagram = await screen.findByRole('region', { name: 'Mermaid diagram' });
    expect(diagram.querySelector('script, a, [onload], [onclick], [onerror]')).toBeNull();
    expect(diagram.textContent).toContain('Label kept');
  });
});
