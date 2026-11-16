import { canvasThemeCss, FALLBACK_CANVAS_THEMES, type CanvasTheme } from './canvasTheme';

export const CANVAS_SUBMIT_MESSAGE = 'mindroom.canvas.submit';
export const CANVAS_ESCAPE_MESSAGE = 'mindroom.canvas.escaped';
export const CANVAS_ERROR_MESSAGE = 'mindroom.canvas.error';
export const CANVAS_STATE_MESSAGE = 'mindroom.canvas.state';
export const CANVAS_SIZE_MESSAGE = 'mindroom.canvas.size';

/** Only the opaque page inside this host may resize its frame. */
export const readCanvasSize = (
  event: MessageEvent,
  frame: Window | null | undefined
): number | undefined => {
  if (!frame || event.source !== frame || event.origin !== 'null') return undefined;
  const data: unknown = event.data;
  if (
    !data ||
    typeof data !== 'object' ||
    !('type' in data) ||
    data.type !== CANVAS_SIZE_MESSAGE ||
    !('version' in data) ||
    data.version !== 1 ||
    !('height' in data) ||
    typeof data.height !== 'number' ||
    !Number.isFinite(data.height) ||
    data.height <= 0
  )
    return undefined;
  return data.height;
};

export const clampInlineCanvasHeight = (height: number): number =>
  Math.min(20000, Math.max(80, Math.ceil(height)));

/** The JSON a page may save as its state, in characters. */
export const CANVAS_STATE_MAX_LENGTH = 256 * 1024;

/**
 * What a canvas keeps on this device, as JSON text: the state its pages save with
 * `mindroom.saveState`, and the values of its form controls, which Chat keeps itself.
 */
export type CanvasSaved = { json?: string; inputs?: string };

/** A control value longer than this, in characters of JSON, is not kept; pages can save it with `saveState`. */
export const CANVAS_INPUT_MAX_LENGTH = CANVAS_STATE_MAX_LENGTH / 8;

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

/** Any npm package at a version; the only source a deployment can let canvases load libraries from. */
export const CANVAS_LIBRARY_SOURCE = 'https://cdn.jsdelivr.net/npm/';

/**
 * Agent HTML may run inline code but cannot connect anywhere or load external images. With
 * libraries on, it may also load scripts, styles, and fonts from the library source; the CDN then
 * sees which files a viewer loads, and a page can put data in those addresses, so deployments opt in.
 * With remote assets on, it may load scripts, styles, fonts, images, and media from any https:
 * address, for previews that use a site's real assets; the same exposure, to any host, so that is
 * a separate opt-in. Connections, frames, workers, and form submissions stay blocked either way.
 */
export const canvasPolicy = (libraries: boolean, remote = false): string => {
  const https = remote ? ' https:' : '';
  const source = `${libraries ? ` ${CANVAS_LIBRARY_SOURCE}` : ''}${https}`;
  return [
    "default-src 'none'",
    `script-src 'unsafe-inline'${source}`,
    `style-src 'unsafe-inline'${source}`,
    `img-src data: blob:${https}`,
    `font-src data:${source}`,
    `media-src data: blob:${https}`,
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "base-uri 'none'",
  ].join('; ');
};

export const CANVAS_CSP = canvasPolicy(false);

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

// A JSON string is a valid script literal once "<" cannot close the script element.
const scriptLiteral = (value: string): string => JSON.stringify(value).replace(/</g, '\\u003c');

// Parsing the saved JSON, rather than writing it out as code, restores exactly the value saved
// (an object literal treats a "__proto__" key differently).
const stateLiteral = (state: string | undefined): string =>
  state === undefined ? 'undefined' : `JSON.parse(${scriptLiteral(state)})`;

// Controls with an id or name keep their values, shared by every version of the canvas and matched
// by that key; a radio group keeps its checked value under its name. Once a page's scripts and
// DOMContentLoaded handlers have run, the bridge sets the kept values, fires input and change so the
// page redraws, and from then on keeps each value that changes, merged into those kept before.
// Only changed values are kept, so a control the user never touched cannot replace a value kept
// in another version, and nothing is kept before the restore, so a page's own startup events cannot.
// A control that appears later gets its kept value when the bridge first sees it.
const inputsScript = (inputs: string | undefined): string => `
  const inputs = Object.assign(Object.create(null), ${stateLiteral(inputs)});
  const unsaved = ['password', 'file', 'hidden', 'submit', 'button', 'reset', 'image'];
  // A field that was a password once is never kept, even after the page reveals it.
  const secret = new WeakSet();
  const revealed = (records) => records.forEach((record) => {
    if ((record.oldValue || '').toLowerCase() === 'password') secret.add(record.target);
  });
  const types = new MutationObserver(revealed);
  types.observe(document, { subtree: true, attributeFilter: ['type'], attributeOldValue: true });
  const declines = (control) => unsaved.includes(control.type) || secret.has(control)
    || (control.getAttribute('autocomplete') || (control.form && control.form.getAttribute('autocomplete')) || '')
      .toLowerCase().split(/\\s+/).some((token) => token === 'off' || token.endsWith('password'));
  const controls = () => {
    // Records still queued, so a field revealed in this same task counts too.
    revealed(types.takeRecords());
    const groups = new Set();
    return [...document.querySelectorAll('input, select, textarea')].flatMap((control) => {
      if (declines(control)) return [];
      if (control.type === 'radio') {
        if (!control.name || groups.has(control.name)) return [];
        groups.add(control.name);
        return group(control).some(declines) ? [] : [{ key: control.name, control }];
      }
      const key = control.id ? '#' + control.id : control.name && (control.type === 'checkbox' ? control.name + '=' + control.value : control.name);
      return key ? [{ key, control }] : [];
    });
  };
  const group = (radio) => [...document.getElementsByName(radio.name)].filter((item) => item.type === 'radio');
  const valueOf = ({ control }) => control.type === 'radio' ? (group(control).find((item) => item.checked) || {}).value
    : control.type === 'checkbox' ? control.checked
    : control.type === 'select-multiple' ? [...control.selectedOptions].map((option) => option.value)
    : control.value;
  // The native setter, so a framework that tracks the value (React) sees the change.
  const assign = (control, property, value) =>
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(control), property).set.call(control, value);
  let seen;
  let restoring = false;
  const restore = (keys) => {
    restoring = true;
    let live = new Map(controls().map((entry) => [entry.key, entry]));
    keys.forEach((key) => {
      const value = inputs[key];
      if (value === undefined) return;
      let entry = live.get(key);
      // A page may replace its controls when one changes (a list rebuilt from its own state).
      if (entry && !entry.control.isConnected) {
        live = new Map(controls().map((item) => [item.key, item]));
        entry = live.get(key);
      }
      if (!entry || JSON.stringify(value) === JSON.stringify(valueOf(entry))) return;
      const { control } = entry;
      // One control at a time, set and then told, since a page may redraw the others when one changes.
      if (control.type === 'radio' || control.type === 'checkbox') {
        const target = control.type === 'radio' ? group(control).find((item) => item.value === value) : control;
        // A click is what frameworks (React) listen to for these, and a dispatched one also reaches a disabled control.
        if (target && (control.type === 'radio' || typeof value === 'boolean')) {
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
        return;
      }
      if (control.type === 'select-multiple') {
        [...control.options].forEach((option) => { option.selected = [].concat(value).includes(option.value); });
      } else if (control.type === 'select-one' && ![...control.options].some((option) => option.value === value)) {
        return;
      } else assign(control, 'value', String(value));
      control.dispatchEvent(new Event('input', { bubbles: true }));
      control.dispatchEvent(new Event('change', { bubbles: true }));
    });
    const restored = new Set(keys);
    controls().forEach((entry) => { if (restored.has(entry.key)) seen[entry.key] = JSON.stringify(valueOf(entry)); });
    restoring = false;
    // Controls the restore itself made the page draw (a field a kept checkbox reveals) get their values next.
    later(new Event('restored'));
  };
  const saveInputs = (events) => {
    if (!seen) return;
    // A control the page drew later, such as the next step of a form, gets its kept value first,
    // unless the user just changed it (events a page fires itself are not trusted).
    const targets = events.filter((event) => event.isTrusted).map((event) => event.target);
    const changedNow = ({ key, control }) =>
      targets.some((target) => target === control || (control.type === 'radio' && target.type === 'radio' && target.name === key));
    const late = controls().filter((entry) => !(entry.key in seen) && !changedNow(entry));
    if (late.length) restore(late.map((entry) => entry.key));
    let changed = false;
    controls().forEach((entry) => {
      // A control the restore just made the page draw is restored by the next batch, not kept as it is.
      if (!(entry.key in seen) && !changedNow(entry)) return;
      const text = JSON.stringify(valueOf(entry));
      if (seen[entry.key] === text) return;
      seen[entry.key] = text;
      changed = true;
      // A long text is left to saveState, so it cannot crowd out every other value.
      if (text === undefined || text.length > ${CANVAS_INPUT_MAX_LENGTH}) delete inputs[entry.key];
      else inputs[entry.key] = JSON.parse(text);
    });
    if (!changed) return;
    let json = JSON.stringify(inputs);
    // Past what Chat keeps, the longest values go first, so the others are still kept.
    while (json.length > ${CANVAS_STATE_MAX_LENGTH}) {
      const longest = Object.keys(inputs).reduce((a, b) => (JSON.stringify(inputs[a]).length >= JSON.stringify(inputs[b]).length ? a : b));
      delete inputs[longest];
      json = JSON.stringify(inputs);
    }
    parent.parent.postMessage({ type: '${CANVAS_STATE_MESSAGE}', version: 1, inputs: json, user: userActive() }, '*');
  };
  // Changes are kept a task later, once the page has handled them, so a restore cannot undo them;
  // buttons such as Reset change values without input events, so clicks count too.
  let queued;
  const later = (event) => {
    if (restoring) return;
    if (!queued) {
      queued = [];
      setTimeout(() => {
        const events = queued;
        queued = undefined;
        saveInputs(events);
      });
    }
    queued.push(event);
  };
  ['input', 'change', 'click'].forEach((type) => document.addEventListener(type, later, true));
  document.addEventListener('DOMContentLoaded', () => setTimeout(() => {
    seen = Object.create(null);
    restore(controls().map((entry) => entry.key));
  }));`;

/** Only inline pages report their height: their host fits the frame to it. */
const sizeScript = `
  let lastHeight;
  let sizeQueued = false;
  // The body's own extent: it follows the content down and up, and the frame's height never enters it,
  // so a page cannot grow by being given room. Inline pages make the body the containing block, so
  // absolutely positioned content counts too; raw pages keep the browser's defaults, so for them
  // content positioned against the viewport does not count.
  const reportSize = () => {
    sizeQueued = false;
    const body = document.body;
    if (!body) return;
    const box = body.getBoundingClientRect();
    const height = Math.ceil(Math.max(
      box.top + scrollY + Math.max(body.scrollHeight, box.height)
        + (parseFloat(getComputedStyle(body).marginBottom) || 0),
      document.documentElement.getBoundingClientRect().height
    ));
    if (height === lastHeight) return;
    lastHeight = height;
    parent.parent.postMessage({ type: '${CANVAS_SIZE_MESSAGE}', version: 1, height }, '*');
  };
  // Content outside the body's flow can change without resizing the body.
  const queueSize = () => {
    if (sizeQueued) return;
    sizeQueued = true;
    requestAnimationFrame(reportSize);
  };
  document.addEventListener('DOMContentLoaded', () => {
    new ResizeObserver(queueSize).observe(document.body);
    new MutationObserver(queueSize).observe(document.body, {
      subtree: true, childList: true, attributes: true, characterData: true,
    });
    reportSize();
  });
  // A transition, an animation or an image can change positioned content after the change that started it.
  ['transitionend', 'animationend', 'load'].forEach((type) => document.addEventListener(type, queueSize, true));
  addEventListener('load', reportSize);
`;

// Runs before any agent script. Forms are captured here because the sandbox
// cannot submit them anywhere; everything else calls window.mindroom.submit,
// which only offers a snapshot to the host. The host decides whether to send it.
// Errors, failed loads, and loads the policy blocks are reported so the user can pass them on.
// Removing WebRTC constructors is defense in depth: CSP cannot block STUN traffic.
const bridgeScript = (
  colorScheme: CanvasColorScheme,
  lineOffset: number,
  saved: CanvasSaved,
  inline: boolean
): string => `(() => {
  // Whether the user has clicked or typed in this page, which no script can fake; undefined where unknown.
  const userActive = () => navigator.userActivation ? navigator.userActivation.hasBeenActive : undefined;
  ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCIceCandidate'].forEach((name) => {
    try { delete window[name]; } catch (error) {}
    try { Object.defineProperty(window, name, { value: undefined, configurable: false }); } catch (error) {}
  });
${inline ? sizeScript : ''}  const post = (data, options) => {
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
  const report = (message) => {
    parent.parent.postMessage({ type: '${CANVAS_ERROR_MESSAGE}', version: 1, message: String(message) }, '*');
  };
  const blocked = new Set();
  addEventListener('error', (event) => {
    const target = event.target;
    // An SVG image's href is an object holding the address in baseVal.
    const href = target && typeof target.href === 'object' && target.href ? target.href.baseVal : target && target.href;
    const url = target && target !== window && (target.src || href);
    if (url) {
      // A load the policy blocked fails too; it is reported once, as blocked.
      setTimeout(() => {
        if (!blocked.has(url)) report('Could not load ' + url);
      });
      return;
    }
    // Lines count from the start of the agent's markup, after Chat's own.
    const inPage = !event.filename || event.filename === location.href;
    const where = !event.lineno ? '' : inPage
      ? ' (line ' + (event.lineno - ${lineOffset}) + ')'
      : ' (' + event.filename + ' line ' + event.lineno + ')';
    report((event.message || 'Script error') + where);
  }, true);
  addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    report('Unhandled rejection: ' + (reason && reason.message ? reason.message : String(reason)));
  });
  document.addEventListener('securitypolicyviolation', (event) => {
    blocked.add(event.blockedURI);
    report('Blocked ' + (event.blockedURI || 'inline code') + ' (' + event.effectiveDirective + ')');
  });
  const saveState = (value) => {
    const json = JSON.stringify(value);
    if (json === undefined) throw new TypeError('mindroom.saveState needs a JSON value.');
    if (json.length > ${CANVAS_STATE_MAX_LENGTH}) {
      throw new RangeError('mindroom.saveState holds at most ${CANVAS_STATE_MAX_LENGTH} characters of JSON.');
    }
    parent.parent.postMessage({ type: '${CANVAS_STATE_MESSAGE}', version: 1, json, user: userActive() }, '*');
  };
  Object.defineProperty(window, 'mindroom', {
    value: Object.freeze({
      submit: (data, options) => post(data, options),
      colorScheme: ${JSON.stringify(colorScheme)},
      state: ${stateLiteral(saved.json)},
      saveState,
    }),
  });${inputsScript(saved.inputs)}
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

/**
 * How a page is shown: in the thread, fitted to its height (`inline`); exactly as written, with no
 * theme variables, base style, or color scheme from Chat (`raw`); and with remote assets (`remote`).
 */
export type CanvasDisplay = { inline?: boolean; raw?: boolean; remote?: boolean };

const pageStyle = (theme: CanvasTheme, inline: boolean): string =>
  `<style>${canvasThemeCss(theme)}${
    inline
      ? BASE_STYLE.replace(
          'padding:16px;background:var(--mr-bg)',
          'padding:8px;background:transparent;position:relative'
        )
      : BASE_STYLE
  }</style>`;

/** Wrap agent HTML in a document whose policy and bridge are fixed before the agent's markup. */
export const buildCanvasPage = (
  html: string,
  colorScheme: CanvasColorScheme,
  theme: CanvasTheme = FALLBACK_CANVAS_THEMES[colorScheme],
  libraries = false,
  saved: CanvasSaved = {},
  { inline = false, raw = false, remote = false }: CanvasDisplay = {}
): string => {
  const head = (lineOffset: number) =>
    [
      '<!doctype html><html><head><meta charset="utf-8">',
      `<meta http-equiv="Content-Security-Policy" content="${canvasPolicy(libraries, remote)}">`,
      raw ? '' : `<meta name="color-scheme" content="${colorScheme}">`,
      '<meta name="viewport" content="width=device-width, initial-scale=1">',
      raw ? '' : pageStyle(theme, inline),
      `<script>${bridgeScript(colorScheme, lineOffset, saved, inline)}</script>`,
      '</head><body>',
    ].join('');
  // The agent's markup starts on the line after this many line breaks; the number adds none.
  const lineOffset = head(0).split('\n').length - 1;
  return `${head(lineOffset)}${html}</body></html>`;
};

/**
 * The document of the panel's frame: it creates the canvas frame itself, so the load listener is in
 * place before the canvas loads. The canvas's document is inline, so a second load means it navigated.
 * The canvas frame inherits this policy on top of its own, so it allows the same library source.
 */
export const buildCanvasDocument = (
  html: string,
  colorScheme: CanvasColorScheme,
  theme: CanvasTheme = FALLBACK_CANVAS_THEMES[colorScheme],
  title = '',
  libraries = false,
  saved: CanvasSaved = {},
  display: CanvasDisplay = {}
): string =>
  [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${canvasPolicy(
      libraries,
      display.remote
    )}">`,
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
    `frame.srcdoc = ${scriptLiteral(
      buildCanvasPage(html, colorScheme, theme, libraries, saved, display)
    )};`,
    'document.body.append(frame);',
    '})();</script></body></html>',
  ].join('');

/** The canvas frame inside the panel's wrapper frame, whose messages the panel accepts. */
export const canvasFrameWindow = (panelFrame: HTMLIFrameElement | null): Window | undefined => {
  const wrapper = panelFrame?.contentWindow;
  // The wrapper is cross-origin, where reading a frame it does not hold yet throws.
  return wrapper && wrapper.frames.length > 0 ? wrapper.frames[0] : undefined;
};

/** Hash a document so a changed canvas remounts its frame and drops stale script state. */
export const canvasDocumentKey = (doc: string): string => {
  let hash = 5381;
  for (let index = 0; index < doc.length; index += 1) {
    hash = (hash * 33) ^ doc.charCodeAt(index);
  }
  return `${doc.length}:${hash >>> 0}`;
};
