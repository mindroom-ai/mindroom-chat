// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { color } from 'folds';
import parse from 'html-react-parser';
import type { MatrixClient } from 'matrix-js-sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyAppTheme } from '../../theme/appliedTheme';
import { LightTheme, MidnightTheme } from '../../theme/useTheme';
import { getReactCustomHtmlParser, LINKIFY_OPTS } from './react-custom-html-parser';
import {
  buildMermaidPolicy,
  buildMermaidSandboxDocument,
  readMermaidTheme,
  renderMermaidDiagram,
  resetMermaidSandbox,
  sanitizeMermaidSvg,
  SECURE_CONFIG_KEYS,
  type MermaidThemeConfig,
} from './lazyMermaid';

const clipboardMocks = vi.hoisted(() => ({
  copyToClipboard: vi.fn<(text: string) => Promise<boolean>>(),
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

type RenderHandler = (source: string, theme: MermaidThemeConfig) => Promise<string> | string;

const sampleSvg = (label: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><g><text>${label}</text></g></svg>`;

/**
 * Drives the real `lazyMermaid.ts` `MessageChannel` handshake for any sandboxed Mermaid iframe
 * appended in jsdom (which does not execute external scripts inside `srcdoc`).
 */
const installSandboxDriver = (renderMock: RenderHandler) => {
  const frames: HTMLIFrameElement[] = [];
  const originalAppendChild = document.body.appendChild.bind(document.body);
  const spy = vi
    .spyOn(document.body, 'appendChild')
    .mockImplementation(<T extends Node>(node: T) => {
      const result = originalAppendChild(node);
      if (node instanceof HTMLIFrameElement && node.getAttribute('sandbox') === 'allow-scripts') {
        frames.push(node);
        const win = node.contentWindow!;
        Object.defineProperty(win, 'postMessage', {
          configurable: true,
          value: (data: unknown, _targetOrigin?: string, transfer?: Transferable[]) => {
            if (
              data &&
              typeof data === 'object' &&
              'type' in data &&
              data.type === 'mindroom.mermaid.init' &&
              transfer?.[0]
            ) {
              const port = transfer[0] as MessagePort;
              port.onmessage = async (event: MessageEvent) => {
                const req = event.data as { id: number; source: string; theme: MermaidThemeConfig };
                try {
                  const svg = await renderMock(req.source, req.theme);
                  port.postMessage({ id: req.id, svg });
                } catch (error) {
                  port.postMessage({
                    id: req.id,
                    error: error instanceof Error ? error.message : String(error),
                  });
                }
              };
              port.start();
              port.postMessage({ type: 'mindroom.mermaid.ready' });
            }
          },
        });
        queueMicrotask(() => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { type: 'mindroom.mermaid.boot', loaded: true },
              origin: 'null',
              source: win,
            })
          );
        });
      }
      return result;
    });
  return { frames, restore: () => spy.mockRestore() };
};

const renderMessageHtml = (html: string, highlightRegex?: RegExp) => {
  const options = getReactCustomHtmlParser({} as MatrixClient, undefined, {
    linkifyOpts: LINKIFY_OPTS,
    highlightRegex,
  });
  return render(<div>{parse(html, options)}</div>);
};

let sandboxRenderMock: ReturnType<typeof vi.fn<RenderHandler>>;
let sandboxDriver: ReturnType<typeof installSandboxDriver>;

beforeEach(() => {
  resetMermaidSandbox();
  clipboardMocks.copyToClipboard.mockReset();
  sandboxRenderMock = vi.fn<RenderHandler>();
  sandboxDriver = installSandboxDriver((source, theme) => sandboxRenderMock(source, theme));
  applyAppTheme(LightTheme);
});

afterEach(() => {
  cleanup();
  resetMermaidSandbox();
  sandboxDriver.restore();
  document.documentElement.className = '';
  delete document.documentElement.dataset.themeKind;
  document.body.className = '';
  document.body.style.cssText = '';
});

describe('Mermaid sandbox policy and document', () => {
  it('enforces a strict CSP that allows only the pinned mermaid.min.js and blocks external loads', () => {
    const url = 'https://chat.example/assets/canvas-libs-abc123/mermaid.min.js';
    const policy = buildMermaidPolicy(url);
    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain(`script-src 'unsafe-inline' ${url}`);
    expect(policy).toContain("style-src 'unsafe-inline'");
    expect(policy).toContain('img-src data:');
    expect(policy).toContain('font-src data:');
    expect(policy).toContain("connect-src 'none'");
    expect(policy).toContain("form-action 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("worker-src 'none'");
    expect(policy).toContain("media-src 'none'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");

    const doc = buildMermaidSandboxDocument(url);
    expect(doc).toContain(`<script src="${url}"></script>`);
    expect(doc).toContain("securityLevel: 'strict'");
    expect(doc).toContain('htmlLabels: false');
    expect(doc).toContain('flowchart: { htmlLabels: false }');
    expect(doc).toContain('class: { htmlLabels: false }');
    expect(doc).toContain('suppressErrorRendering: true');
    expect(SECURE_CONFIG_KEYS).toEqual(
      expect.arrayContaining([
        'securityLevel',
        'suppressErrorRendering',
        'htmlLabels',
        'flowchart',
        'class',
        'themeCSS',
        'fontFamily',
        'altFontFamily',
      ])
    );
  });
});

describe('MermaidBlock', () => {
  it('lazily creates one hidden sandboxed iframe and ignores non-mermaid blocks', async () => {
    sandboxRenderMock.mockResolvedValue(sampleSvg('Flow A to B'));

    const tsView = renderMessageHtml('<pre><code class="language-ts">const x = 1;</code></pre>');
    expect(sandboxDriver.frames).toHaveLength(0);
    expect(sandboxRenderMock).not.toHaveBeenCalled();
    tsView.unmount();

    renderMessageHtml('<pre><code class="language-mermaid">graph TD\n  A --&gt; B</code></pre>');

    const region = await screen.findByRole('region', { name: 'Mermaid diagram' });
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.innerHTML).toContain('Flow A to B');
    expect(screen.getByText('mermaid')).toBeTruthy();

    expect(sandboxDriver.frames).toHaveLength(1);
    const frame = sandboxDriver.frames[0]!;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('aria-hidden')).toBe('true');
    expect(frame.tabIndex).toBe(-1);
    expect(frame.srcdoc).toContain('assets/canvas-libs/mermaid.min.js');
    expect(sandboxRenderMock).toHaveBeenCalledWith(
      'graph TD\n  A --> B',
      expect.objectContaining({ darkMode: false })
    );
  });

  it('toggles between Diagram and Source views while keeping Copy working in both', async () => {
    const source = 'sequenceDiagram\n  Alice->>Bob: Hi';
    sandboxRenderMock.mockResolvedValue(sampleSvg('Alice to Bob'));
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

  it('falls back to Source immediately when initial render or a later edit fails (no stale SVG)', async () => {
    sandboxRenderMock.mockImplementation(async (text) => {
      if (text.endsWith('-->')) throw new Error('Parse error');
      return sampleSvg(text.includes('C') ? 'A B C' : 'A B');
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

    // Editing to invalid syntax clears the stale SVG immediately and shows Source.
    view.rerender(makeTree('graph TD\n  A --&gt; B\n  B --&gt;'));
    await screen.findByText('Showing source');
    expect(screen.queryByRole('region', { name: 'Mermaid diagram' })).toBeNull();
    expect(view.container.querySelector('code')?.textContent).toContain('B -->');

    // Fixing the edit renders the updated diagram.
    view.rerender(makeTree('graph TD\n  A --&gt; B\n  B --&gt; C'));
    await waitFor(() => {
      expect(screen.getByRole('region', { name: 'Mermaid diagram' }).innerHTML).toContain('A B C');
    });
  });

  it('shows Source view automatically when searchMatch is true and returns to Diagram when search clears', async () => {
    sandboxRenderMock.mockResolvedValue(sampleSvg('Payment flow'));

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
    expect(sandboxRenderMock).not.toHaveBeenCalled();

    view.rerender(makeTree(undefined));
    await screen.findByRole('region', { name: 'Mermaid diagram' });
  });

  it('re-renders with updated darkMode and computed palette themeVariables on applyAppTheme', async () => {
    sandboxRenderMock.mockImplementation((_src, theme) =>
      sampleSvg(theme.darkMode ? 'dark' : 'light')
    );

    const primaryVar = /^var\((--[\w-]+)/.exec(color.Primary.Main)?.[1];
    renderMessageHtml('<pre><code class="language-mermaid">graph LR\n  X --&gt; Y</code></pre>');

    await waitFor(() => {
      expect(sandboxRenderMock).toHaveBeenCalledTimes(1);
    });
    expect(sandboxRenderMock).toHaveBeenLastCalledWith(
      'graph LR\n  X --> Y',
      expect.objectContaining({ darkMode: false })
    );

    act(() => {
      if (primaryVar) document.body.style.setProperty(primaryVar, '#7aa2f7');
      applyAppTheme(MidnightTheme);
    });

    await waitFor(() => {
      expect(sandboxRenderMock).toHaveBeenCalledTimes(2);
    });
    expect(sandboxRenderMock).toHaveBeenLastCalledWith(
      'graph LR\n  X --> Y',
      expect.objectContaining({
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

    sandboxRenderMock.mockImplementation(async (text, theme) => {
      order.push(`start:${text}:${theme.darkMode ? 'dark' : 'light'}`);
      if (text === 'first') {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        order.push('end:first');
        throw new Error('first failed');
      }
      order.push(`end:${text}`);
      return sampleSvg(text);
    });

    const lightTheme = readMermaidTheme();
    document.documentElement.dataset.themeKind = 'dark';
    const darkTheme = readMermaidTheme();

    const p1 = renderMermaidDiagram('first', lightTheme);
    const p2 = renderMermaidDiagram('second', darkTheme);

    await waitFor(() => {
      expect(order).toEqual(['start:first:light']);
    });

    releaseFirst();
    await expect(p1).rejects.toThrow('first failed');
    expect(await p2).toContain('second');
    expect(order).toEqual(['start:first:light', 'end:first', 'start:second:dark', 'end:second']);
  });

  it('repairs missing xmlns:xlink and unwraps diagram links into inert groups', async () => {
    const mermaidLinkSvg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40">' +
      '<a xlink:href="https://example.com/docs" target="_blank" class="clickable">' +
      '<rect width="80" height="30"/><text>Docs node</text></a></svg>';

    const cleaned = sanitizeMermaidSvg(mermaidLinkSvg);
    expect(cleaned).not.toBeNull();
    expect(cleaned).toContain('Docs node');
    expect(cleaned).not.toMatch(/<a\b|\bhref=|\bxlink:href=/i);

    sandboxRenderMock.mockResolvedValue(mermaidLinkSvg);
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

    sandboxRenderMock.mockResolvedValue(katexFoSvg);
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
      '<rect fill="url(https://evil.example/attr.png)" stroke="url(#stroke-grad)" width="10" height="10"/>',
      '<rect style="background:url(\\68ttps://evil.example/esc.png);fill:u\\72l(https://evil.example/esc2.png)" width="5" height="5"/>',
      `<rect style="background-image:image-set('https://evil.example/set.png' 1x)" width="5" height="5"/>`,
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
    expect(cleaned).toContain('url(#stroke-grad)');
    expect(cleaned).toContain('#valid-marker');

    sandboxRenderMock.mockResolvedValue(hostileSvg);
    renderMessageHtml('<pre><code class="language-mermaid">graph TD\n  A --&gt; B</code></pre>');

    const diagram = await screen.findByRole('region', { name: 'Mermaid diagram' });
    expect(diagram.querySelector('script, a, [onload], [onclick], [onerror]')).toBeNull();
    expect(diagram.textContent).toContain('Label kept');
  });
});
