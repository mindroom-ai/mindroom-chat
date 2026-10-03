import { canvasThemeCss, FALLBACK_CANVAS_THEMES, type CanvasTheme } from './canvasTheme';

export const CANVAS_SUBMIT_MESSAGE = 'mindroom.canvas.submit';
export const CANVAS_ESCAPE_MESSAGE = 'mindroom.canvas.escaped';

/** The canvas frame gets an opaque origin: no Chat storage, cookies, DOM, popups, or top navigation. */
export const CANVAS_SANDBOX = 'allow-scripts allow-forms';

/**
 * The panel's frame holds only a wrapper document around the canvas frame. The embedder's
 * `frame-src` decides where a frame may navigate, and Chat's own policy must allow its origin
 * (for calls) and reCAPTCHA; the wrapper's `frame-src 'none'` instead stops every navigation
 * of the canvas frame before a request leaves. The wrapper runs only its own script. A nested
 * frame keeps every restriction of its parent, so the wrapper allows forms for the canvas's forms.
 */
export const CANVAS_WRAPPER_SANDBOX = 'allow-scripts allow-forms';

/** Agent HTML may run inline code but cannot load or send anything over the network. */
export const CANVAS_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  'media-src data: blob:',
  "connect-src 'none'",
  "form-action 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
].join('; ');

export type CanvasColorScheme = 'light' | 'dark';

/** Explicit denials for powerful features; this does not cover WebRTC, which has no policy. */
export const CANVAS_PERMISSIONS = [
  'camera',
  'microphone',
  'geolocation',
  'display-capture',
  'clipboard-read',
  'clipboard-write',
  'payment',
  'usb',
  'serial',
  'hid',
  'bluetooth',
  'fullscreen',
]
  .map((feature) => `${feature} 'none'`)
  .join('; ');

// Runs before any agent script. Forms are captured here because the sandbox
// cannot submit them anywhere; everything else calls window.mindroom.submit,
// which only offers a snapshot to the host. The host decides whether to send it.
// Removing WebRTC constructors is defense in depth: CSP cannot block STUN traffic.
const BRIDGE_SCRIPT = `(() => {
  ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCIceCandidate'].forEach((name) => {
    try { delete window[name]; } catch (error) {}
    try { Object.defineProperty(window, name, { value: undefined, configurable: false }); } catch (error) {}
  });
  const post = (data, options) => {
    const label = options && typeof options.label === 'string' ? options.label : undefined;
    parent.parent.postMessage({ type: '${CANVAS_SUBMIT_MESSAGE}', version: 1, data, label }, '*');
  };
  const formValues = (form, submitter) => {
    let entries;
    try {
      entries = new FormData(form, submitter || undefined);
    } catch (error) {
      entries = new FormData(form);
    }
    const values = {};
    entries.forEach((value, key) => {
      const text = typeof value === 'string' ? value : value.name;
      values[key] = key in values ? [].concat(values[key], text) : text;
    });
    return values;
  };
  Object.defineProperty(window, 'mindroom', {
    value: Object.freeze({ submit: (data, options) => post(data, options) }),
  });
  document.addEventListener(
    'submit',
    (event) => {
      event.preventDefault();
      const form = event.target;
      if (!(form instanceof HTMLFormElement)) return;
      const submitter = event.submitter;
      const label = form.dataset.mindroomLabel || (submitter && submitter.textContent ? submitter.textContent.trim() : '');
      post(formValues(form, submitter), { label: label || undefined });
    },
    true
  );
})();`;

// Agent styles come later in the document and override these defaults.
const BASE_STYLE =
  'body{margin:0;padding:16px;background:var(--mr-bg);color:var(--mr-text);font:14px/1.5 var(--mr-font)}';

/** Wrap agent HTML in a document whose policy and bridge are fixed before the agent's markup. */
export const buildCanvasPage = (
  html: string,
  colorScheme: CanvasColorScheme,
  theme: CanvasTheme = FALLBACK_CANVAS_THEMES[colorScheme]
): string =>
  [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CANVAS_CSP}">`,
    `<meta name="color-scheme" content="${colorScheme}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>${canvasThemeCss(theme)}${BASE_STYLE}</style>`,
    `<script>${BRIDGE_SCRIPT}</script>`,
    '</head><body>',
    html,
    '</body></html>',
  ].join('');

// A JSON string is a valid script literal once "<" cannot close the script element.
const scriptLiteral = (value: string): string => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * The document of the panel's frame: it creates the canvas frame itself, so the load listener is in
 * place before the canvas loads. The canvas's document is inline, so a second load means it navigated.
 */
export const buildCanvasDocument = (
  html: string,
  colorScheme: CanvasColorScheme,
  theme: CanvasTheme = FALLBACK_CANVAS_THEMES[colorScheme],
  title = ''
): string =>
  [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CANVAS_CSP}">`,
    `<meta name="color-scheme" content="${colorScheme}">`,
    '<style>html,body{margin:0;height:100%;overflow:hidden}',
    'iframe{display:block;border:0;width:100%;height:100%}</style>',
    '</head><body><script>(() => {',
    "const frame = document.createElement('iframe');",
    `frame.setAttribute('sandbox', '${CANVAS_SANDBOX}');`,
    `frame.setAttribute('allow', ${scriptLiteral(CANVAS_PERMISSIONS)});`,
    "frame.setAttribute('referrerpolicy', 'no-referrer');",
    `frame.title = ${scriptLiteral(title)};`,
    'let loads = 0;',
    "frame.addEventListener('load', () => {",
    '  loads += 1;',
    `  if (loads > 1) parent.postMessage({ type: '${CANVAS_ESCAPE_MESSAGE}' }, '*');`,
    '});',
    `frame.srcdoc = ${scriptLiteral(buildCanvasPage(html, colorScheme, theme))};`,
    'document.body.append(frame);',
    '})();</script></body></html>',
  ].join('');

/** The canvas frame inside the panel's wrapper frame, whose messages the panel accepts. */
export const canvasFrameWindow = (panelFrame: HTMLIFrameElement | null): Window | undefined =>
  panelFrame?.contentWindow?.frames[0] ?? undefined;
