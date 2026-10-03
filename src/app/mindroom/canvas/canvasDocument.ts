export const CANVAS_SUBMIT_MESSAGE = 'mindroom.canvas.submit';

/** The iframe gets an opaque origin: no Chat storage, cookies, DOM, popups, or top navigation. */
export const CANVAS_SANDBOX = 'allow-scripts allow-forms';

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
    parent.postMessage({ type: '${CANVAS_SUBMIT_MESSAGE}', version: 1, data, label }, '*');
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

const BASE_STYLE =
  'body{margin:0;padding:16px;font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}';

/** Wrap agent HTML in a document whose policy and bridge are fixed before the agent's markup. */
export const buildCanvasDocument = (html: string, colorScheme: CanvasColorScheme): string =>
  [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${CANVAS_CSP}">`,
    `<meta name="color-scheme" content="${colorScheme}">`,
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<style>${BASE_STYLE}</style>`,
    `<script>${BRIDGE_SCRIPT}</script>`,
    '</head><body>',
    html,
    '</body></html>',
  ].join('');
