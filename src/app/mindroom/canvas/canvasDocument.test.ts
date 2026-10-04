import { describe, expect, it } from 'vitest';
import {
  buildCanvasDocument,
  buildCanvasPage,
  CANVAS_CSP,
  CANVAS_ESCAPE_MESSAGE,
  CANVAS_PERMISSIONS,
  CANVAS_SANDBOX,
  CANVAS_WRAPPER_SANDBOX,
  canvasFrameWindow,
} from './canvasDocument';
import { FALLBACK_CANVAS_THEMES } from './canvasTheme';

describe('buildCanvasPage', () => {
  it('puts the CSP before any agent markup so agent content cannot loosen it', () => {
    const doc = buildCanvasPage(
      '<meta http-equiv="Content-Security-Policy" content="default-src *"><p>hi</p>',
      'dark'
    );
    const cspIndex = doc.indexOf(`content="${CANVAS_CSP}"`);
    expect(cspIndex).toBeGreaterThan(0);
    expect(cspIndex).toBeLessThan(doc.indexOf('default-src *'));
    expect(doc.indexOf('<head>')).toBeLessThan(cspIndex);
    expect(doc.indexOf('</head>')).toBeLessThan(doc.indexOf('<p>hi</p>'));
  });

  it('defines the bridge before agent scripts run', () => {
    const doc = buildCanvasPage('<script>mindroom.submit({a: 1})</script>', 'light');
    expect(doc.indexOf('mindroom.canvas.submit')).toBeLessThan(
      doc.indexOf('mindroom.submit({a: 1})')
    );
  });

  it('blocks network, navigation targets, and nested frames', () => {
    expect(CANVAS_CSP).toContain("default-src 'none'");
    expect(CANVAS_CSP).toContain("connect-src 'none'");
    expect(CANVAS_CSP).toContain("form-action 'none'");
    expect(CANVAS_CSP).toContain("frame-src 'none'");
    expect(CANVAS_CSP).toContain("base-uri 'none'");
    expect(CANVAS_CSP).not.toMatch(/https?:/);
  });

  it('never grants same-origin, popups, or top navigation', () => {
    expect(CANVAS_SANDBOX.split(' ').sort()).toEqual(['allow-forms', 'allow-scripts']);
    expect(CANVAS_WRAPPER_SANDBOX).toBe(CANVAS_SANDBOX);
  });

  it('sends answers past the wrapper to Chat', () => {
    expect(buildCanvasPage('', 'light')).toContain('parent.parent.postMessage');
  });

  it('follows the app color scheme', () => {
    expect(buildCanvasPage('', 'dark')).toContain('<meta name="color-scheme" content="dark">');
    expect(buildCanvasPage('', 'light')).toContain('<meta name="color-scheme" content="light">');
  });

  it('removes WebRTC constructors before agent scripts and denies powerful features', () => {
    const doc = buildCanvasPage('<script>agent()</script>', 'light');
    expect(doc.indexOf('RTCPeerConnection')).toBeLessThan(doc.indexOf('agent()'));
    expect(CANVAS_PERMISSIONS).toContain("camera 'none'");
    expect(CANVAS_PERMISSIONS).toContain("microphone 'none'");
    expect(CANVAS_PERMISSIONS).toContain("clipboard-read 'none'");
  });

  it('exposes the Chat theme as CSS variables before agent styles', () => {
    const doc = buildCanvasPage('<style>body{background:red}</style>', 'dark', {
      ...FALLBACK_CANVAS_THEMES.dark,
      accent: '#123456',
    });
    expect(doc.indexOf('--mr-accent:#123456')).toBeGreaterThan(0);
    expect(doc.indexOf('--mr-accent:#123456')).toBeLessThan(doc.indexOf('body{background:red}'));
    expect(doc).toContain('background:var(--mr-bg)');
  });
});

/** The canvas page the wrapper carries as a script string. */
const embeddedPage = (wrapper: string): string => {
  const literal = /frame\.srcdoc = ("(?:[^"\\]|\\.)*");/.exec(wrapper);
  return literal ? (JSON.parse(literal[1]) as string) : '';
};

describe('buildCanvasDocument', () => {
  it('fixes a policy that stops the canvas frame navigating before the wrapper script runs', () => {
    const doc = buildCanvasDocument('<p>hi</p>', 'dark');
    const cspIndex = doc.indexOf(`content="${CANVAS_CSP}"`);
    expect(CANVAS_CSP).toContain("frame-src 'none'");
    expect(cspIndex).toBeGreaterThan(0);
    expect(cspIndex).toBeLessThan(doc.indexOf('<script>'));
  });

  it('creates the sandboxed canvas frame with the page, the permissions, and the title', () => {
    const doc = buildCanvasDocument('<p>hi</p>', 'dark', FALLBACK_CANVAS_THEMES.dark, 'Plans "Q3"');
    expect(doc).toContain(`frame.setAttribute('sandbox', '${CANVAS_SANDBOX}')`);
    expect(doc).toContain(JSON.stringify(CANVAS_PERMISSIONS));
    expect(doc).toContain('frame.title = "Plans \\"Q3\\""');
    expect(embeddedPage(doc)).toBe(
      buildCanvasPage('<p>hi</p>', 'dark', FALLBACK_CANVAS_THEMES.dark)
    );
  });

  it('keeps agent markup from closing the wrapper script', () => {
    const html = '</script><script>parent.postMessage("x", "*")</script><!--';
    const doc = buildCanvasDocument(html, 'light');
    expect(doc.split('</script>')).toHaveLength(2);
    expect(embeddedPage(doc)).toContain(html);
  });

  it('reports a second load of the canvas frame as an escape', () => {
    const doc = buildCanvasDocument('', 'light');
    expect(doc).toContain("frame.addEventListener('load'");
    expect(doc).toContain(
      `if (loads > 1) parent.postMessage({ type: '${CANVAS_ESCAPE_MESSAGE}' }, '*')`
    );
    expect(doc.indexOf("addEventListener('load'")).toBeLessThan(
      doc.indexOf('document.body.append(frame)')
    );
  });
});

describe('canvasFrameWindow', () => {
  it('reads the canvas frame inside the wrapper', () => {
    const inner = {} as Window;
    const panelFrame = { contentWindow: { frames: [inner] } } as unknown as HTMLIFrameElement;
    expect(canvasFrameWindow(panelFrame)).toBe(inner);
    expect(canvasFrameWindow(null)).toBeUndefined();
  });
});
