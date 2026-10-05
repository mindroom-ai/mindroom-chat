import { describe, expect, it } from 'vitest';
import {
  buildCanvasDocument,
  buildCanvasPage,
  CANVAS_CSP,
  CANVAS_ERROR_MESSAGE,
  CANVAS_ESCAPE_MESSAGE,
  CANVAS_LIBRARY_SOURCE,
  CANVAS_STATE_MESSAGE,
  CANVAS_PERMISSIONS,
  CANVAS_SANDBOX,
  CANVAS_WRAPPER_SANDBOX,
  canvasFrameWindow,
  canvasPolicy,
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

  it('loads scripts, styles, and fonts from the library source only when libraries are on', () => {
    expect(CANVAS_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; " +
        "font-src data:; media-src data: blob:; connect-src 'none'; form-action 'none'; frame-src 'none'; " +
        "worker-src 'none'; base-uri 'none'"
    );
    expect(CANVAS_LIBRARY_SOURCE).toBe('https://cdn.jsdelivr.net/npm/');
    const policy = canvasPolicy(true);
    const directive = (name: string) =>
      policy.split('; ').find((candidate) => candidate.startsWith(`${name} `));
    expect(directive('script-src')).toBe(`script-src 'unsafe-inline' ${CANVAS_LIBRARY_SOURCE}`);
    expect(directive('style-src')).toBe(`style-src 'unsafe-inline' ${CANVAS_LIBRARY_SOURCE}`);
    expect(directive('font-src')).toBe(`font-src data: ${CANVAS_LIBRARY_SOURCE}`);
    // Network requests, images, frames, and every other directive stay as strict as before.
    const others = (value: string) =>
      value.split('; ').filter((candidate) => !/^(script|style|font)-src /.test(candidate));
    expect(others(policy)).toEqual(others(CANVAS_CSP));
    expect(buildCanvasPage('<p>hi</p>', 'light', FALLBACK_CANVAS_THEMES.light, true)).toContain(
      `content="${policy}"`
    );
  });

  it('gives the page its saved state before its scripts run, and a way to save it', () => {
    expect(buildCanvasPage('', 'light')).toContain('state: undefined');
    const doc = buildCanvasPage(
      '<script>render(mindroom.state)</script>',
      'light',
      FALLBACK_CANVAS_THEMES.light,
      false,
      '{"note":"</script><b>"}'
    );
    // The state cannot close the bridge script it is written into.
    expect(doc).toContain('state: {"note":"\\u003c/script>\\u003cb>"}');
    expect(doc.split('</script>')).toHaveLength(3);
    expect(doc.indexOf('state: {')).toBeLessThan(doc.indexOf('render(mindroom.state)'));
    expect(doc).toContain(`type: '${CANVAS_STATE_MESSAGE}'`);
  });

  it('tells the page the color scheme it is shown in', () => {
    expect(buildCanvasPage('', 'dark')).toContain('colorScheme: "dark"');
    expect(buildCanvasPage('', 'light')).toContain('colorScheme: "light"');
  });

  it('reports errors, failed loads, and blocked loads before agent scripts run', () => {
    const doc = buildCanvasPage('<script>boom()</script>', 'light');
    const agentScript = doc.indexOf('boom()');
    for (const listener of [
      "addEventListener('error'",
      "addEventListener('unhandledrejection'",
      "addEventListener('securitypolicyviolation'",
    ]) {
      expect(doc.indexOf(listener)).toBeGreaterThan(0);
      expect(doc.indexOf(listener)).toBeLessThan(agentScript);
    }
    expect(doc).toContain(`type: '${CANVAS_ERROR_MESSAGE}'`);
  });

  it('numbers error lines from the start of the agent markup', () => {
    for (const scheme of ['light', 'dark'] as const) {
      const doc = buildCanvasPage('<script>boom()</script>', scheme);
      const offset = doc.slice(0, doc.indexOf('<script>boom()')).split('\n').length - 1;
      expect(offset).toBeGreaterThan(0);
      expect(doc).toContain(`(event.lineno - ${offset})`);
    }
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

  it('allows the library source in the wrapper too, because the canvas frame inherits its policy', () => {
    const doc = buildCanvasDocument('<p>hi</p>', 'dark', FALLBACK_CANVAS_THEMES.dark, '', true);
    expect(doc.indexOf(`content="${canvasPolicy(true)}"`)).toBeGreaterThan(0);
    expect(embeddedPage(doc)).toBe(
      buildCanvasPage('<p>hi</p>', 'dark', FALLBACK_CANVAS_THEMES.dark, true)
    );
    expect(buildCanvasDocument('<p>hi</p>', 'dark')).not.toContain(CANVAS_LIBRARY_SOURCE);
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
