import { color } from 'folds';
import { isDesktopApp } from '../../lib/nativeShell';
import { CANVAS_FRAME_READY, CANVAS_FRAME_SRC } from '../canvas/canvasFrame';
import { canvasLibraryDirectory } from '../canvas/canvasLibraries';

// Mermaid renders inside one shared hidden sandboxed `srcdoc` iframe using the pinned
// `mermaid.min.js` already served by `scripts/canvas-libraries.mjs`. Browser-enforced CSP inside
// the opaque-origin frame physically blocks every external network request during `mermaid.render`,
// isolates Mermaid from the chat DOM, and avoids bundling a second copy of Mermaid in Vite.

const SVG_NS = 'http://www.w3.org/2000/svg';
const FALLBACK_FONT = 'Inter Variable, system-ui, -apple-system, sans-serif';
const SANDBOX_BOOT_TIMEOUT_MS = 15_000;
const SANDBOX_RENDER_TIMEOUT_MS = 10_000;

const MERMAID_BOOT_MESSAGE = 'mindroom.mermaid.boot';
const MERMAID_INIT_MESSAGE = 'mindroom.mermaid.init';
const MERMAID_READY_MESSAGE = 'mindroom.mermaid.ready';

const FALLBACK_PALETTE = {
  light: {
    surface: '#FFFFFF',
    surfaceVariant: '#F4F4F8',
    onSurface: '#1F1E26',
    line: '#DFDFE4',
    primaryContainer: '#EFEEFF',
    primaryOnContainer: '#462C93',
    primaryMain: '#694CCD',
    warningContainer: '#FDEDDC',
    warningOnContainer: '#783B00',
    warningLine: '#F3CFA9',
  },
  dark: {
    surface: '#2B2B2E',
    surfaceVariant: '#363639',
    onSurface: '#ECECEF',
    line: '#464649',
    primaryContainer: '#29214D',
    primaryOnContainer: '#D8CEFB',
    primaryMain: '#9B85F0',
    warningContainer: '#4A3116',
    warningOnContainer: '#F7DFC3',
    warningLine: '#6B4B28',
  },
} as const;

export const SECURE_CONFIG_KEYS =
  'secure securityLevel startOnLoad maxTextSize suppressErrorRendering maxEdges htmlLabels flowchart class theme themeVariables themeCSS fontFamily altFontFamily'.split(
    ' '
  );

const FORBIDDEN_SVG_TAGS = new Set(
  'script iframe frame frameset object embed applet base link meta form input button textarea select audio video source track noscript template portal handler animate set animatemotion animatetransform animatecolor'.split(
    ' '
  )
);
const FORBIDDEN_ATTRS = new Set(
  'src srcdoc action formaction poster data ping dynsrc lowsrc'.split(' ')
);
const SVG_URL_ATTRS = new Set(
  'fill stroke filter clip-path mask mask-image marker marker-start marker-mid marker-end cursor background background-image'.split(
    ' '
  )
);

// eslint-disable-next-line no-control-regex -- strip ASCII control characters before inspecting URLs
const ASCII_CONTROLS = /[\u0000-\u001f\u007f\s]+/g;
const CSS_COMMENTS = /\/\*[\s\S]*?\*\//g;
const CSS_AT_IMPORT = /@import\b[^;]*(?:;|$)/gi;
const CSS_AT_FONT_FACE = /@font-face\s*\{[^}]*\}/gi;
const CSS_URL_CALL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
const CSS_IMAGE_SET = /(?:-webkit-)?image-set\s*\([^)]*\)/gi;
const CSS_SRC_CALL = /\bsrc\s*\([^)]*\)/gi;
const CSS_UNSAFE =
  /(?:expression\s*\([^)]*\)|javascript\s*:[^;"]*|vbscript\s*:[^;"]*|-moz-binding\s*:[^;]*|behavior\s*:[^;]*)/gi;
const SAFE_INTERNAL_FRAGMENT = /^#[A-Za-z0-9_.:-]+$/;
const CSS_ESCAPED_SUSPECT =
  /(?:url\s*\(|image-set\s*\(|\bsrc\s*\(|@import\b|@font-face\b|javascript\s*:|vbscript\s*:|expression\s*\(|-moz-binding\s*:|behavior\s*:)/i;

export type MermaidThemeConfig = {
  darkMode: boolean;
  fontFamily: string;
  themeVariables: Record<string, string | boolean>;
};

type SandboxResponse = { id: number; svg?: string; error?: string };

type MermaidSandbox = {
  render: (source: string, theme: MermaidThemeConfig) => Promise<string>;
};

let sandboxPromise: Promise<MermaidSandbox> | undefined;
let activeCleanup: (() => void) | undefined;
let renderQueue: Promise<unknown> = Promise.resolve();
let requestCounter = 0;

const escapeAttr = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Strict CSP for the hidden Mermaid frame: only the app's pinned `mermaid.min.js` may load. */
export const buildMermaidPolicy = (scriptUrl: string): string =>
  [
    "default-src 'none'",
    `script-src 'unsafe-inline' ${scriptUrl}`,
    "style-src 'unsafe-inline'",
    'img-src data:',
    'font-src data:',
    "connect-src 'none'",
    "form-action 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
  ].join('; ');

/** Builds the `srcdoc` HTML for the hidden sandboxed Mermaid renderer frame. */
export const buildMermaidSandboxDocument = (scriptUrl: string): string => {
  const safeUrl = escapeAttr(scriptUrl);
  const secureJson = JSON.stringify(SECURE_CONFIG_KEYS);
  const runner = `(() => {
    ['RTCPeerConnection', 'webkitRTCPeerConnection', 'RTCDataChannel', 'RTCIceCandidate'].forEach((k) => {
      try { Object.defineProperty(window, k, { value: undefined, configurable: false }); } catch {}
    });
    const SECURE = ${secureJson};
    let port = null;
    let counter = 0;
    window.addEventListener('message', (event) => {
      if (event.source !== window.parent || !event.data || event.data.type !== '${MERMAID_INIT_MESSAGE}') return;
      if (port || !event.ports || !event.ports[0]) return;
      port = event.ports[0];
      port.onmessage = async (msg) => {
        const payload = msg.data;
        if (!payload || typeof payload.id !== 'number' || typeof payload.source !== 'string' || !payload.theme) return;
        const svgId = 'mindroom-mermaid-' + (++counter);
        try {
          if (!window.mermaid) throw new Error('Mermaid library did not load');
          window.mermaid.initialize({
            startOnLoad: false,
            securityLevel: 'strict',
            htmlLabels: false,
            flowchart: { htmlLabels: false },
            class: { htmlLabels: false },
            suppressErrorRendering: true,
            secure: SECURE,
            theme: 'base',
            darkMode: Boolean(payload.theme.darkMode),
            fontFamily: payload.theme.fontFamily,
            themeVariables: payload.theme.themeVariables,
          });
          const result = await window.mermaid.render(svgId, payload.source);
          port.postMessage({ id: payload.id, svg: result && typeof result.svg === 'string' ? result.svg : '' });
        } catch (error) {
          port.postMessage({ id: payload.id, error: error instanceof Error ? error.message : String(error) });
        } finally {
          document.getElementById(svgId)?.remove();
          document.getElementById('d' + svgId)?.remove();
        }
      };
      port.start();
      port.postMessage({ type: '${MERMAID_READY_MESSAGE}' });
    });
    window.parent.postMessage({ type: '${MERMAID_BOOT_MESSAGE}', loaded: Boolean(window.mermaid) }, '*');
  })();`;

  return [
    '<!doctype html><html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="${escapeAttr(buildMermaidPolicy(scriptUrl))}">`,
    `<script src="${safeUrl}"></script>`,
    '</head><body>',
    `<script>${runner}</script>`,
    '</body></html>',
  ].join('');
};

const disposeSandbox = (): void => {
  const teardown = activeCleanup;
  activeCleanup = undefined;
  sandboxPromise = undefined;
  teardown?.();
};

/** Tears down the shared hidden sandbox frame (used in tests and timeout recovery). */
export const resetMermaidSandbox = (): void => {
  disposeSandbox();
};

const createMermaidSandbox = (): Promise<MermaidSandbox> => {
  if (
    typeof document === 'undefined' ||
    !document.body ||
    typeof window === 'undefined' ||
    typeof MessageChannel === 'undefined'
  ) {
    return Promise.reject(new Error('Mermaid sandbox requires a browser DOM'));
  }

  const scriptUrl = `${canvasLibraryDirectory()}mermaid.min.js`;
  const doc = buildMermaidSandboxDocument(scriptUrl);
  const desktop = isDesktopApp();

  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('referrerpolicy', 'no-referrer');
  frame.setAttribute('aria-hidden', 'true');
  frame.tabIndex = -1;
  // Non-zero off-screen dimensions let SVG getBBox() measure cleanly without affecting layout.
  frame.style.cssText =
    'position:fixed;inset-inline-start:-99999px;inset-block-start:0;inline-size:1024px;block-size:1024px;border:0;visibility:hidden;pointer-events:none;';

  return new Promise<MermaidSandbox>((resolve, reject) => {
    let channel: MessageChannel | undefined;
    let settled = false;
    let disposed = false;
    let writtenDesktopDoc = false;
    const pending = new Map<
      number,
      {
        resolve: (svg: string) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
      }
    >();

    const cleanup = () => {
      if (disposed) return;
      disposed = true;
      if (activeCleanup === cleanup) activeCleanup = undefined;
      clearTimeout(bootTimer);
      window.removeEventListener('message', onWindowMessage);
      if (channel) {
        channel.port1.onmessage = null;
        channel.port1.close();
      }
      pending.forEach((entry) => {
        clearTimeout(entry.timer);
        entry.reject(new Error('Mermaid sandbox disposed'));
      });
      pending.clear();
      frame.remove();
      if (!settled) {
        settled = true;
        reject(new Error('Mermaid sandbox disposed'));
      }
    };
    activeCleanup = cleanup;

    const failBoot = (message: string) => {
      if (settled) return;
      settled = true;
      sandboxPromise = undefined;
      cleanup();
      reject(new Error(message));
    };

    const bootTimer = setTimeout(
      () => failBoot('Timed out starting Mermaid sandbox'),
      SANDBOX_BOOT_TIMEOUT_MS
    );

    const onWindowMessage = (event: MessageEvent) => {
      const win = frame.contentWindow;
      if (!win || event.source !== win || event.origin !== 'null') return;

      if (desktop && event.data === CANVAS_FRAME_READY && !writtenDesktopDoc) {
        writtenDesktopDoc = true;
        win.postMessage(doc, '*');
        return;
      }

      const data: unknown = event.data;
      if (
        !data ||
        typeof data !== 'object' ||
        !('type' in data) ||
        data.type !== MERMAID_BOOT_MESSAGE
      ) {
        return;
      }

      window.removeEventListener('message', onWindowMessage);
      if ('loaded' in data && data.loaded === false) {
        failBoot('Mermaid library did not load in sandbox');
        return;
      }

      channel = new MessageChannel();
      const port = channel.port1;
      port.onmessage = (portEvent: MessageEvent) => {
        const msg: unknown = portEvent.data;
        if (!msg || typeof msg !== 'object') return;
        if (!settled && 'type' in msg && msg.type === MERMAID_READY_MESSAGE) {
          settled = true;
          clearTimeout(bootTimer);
          resolve({
            render: (source, theme) =>
              new Promise<string>((res, rej) => {
                const id = ++requestCounter;
                const timer = setTimeout(() => {
                  pending.delete(id);
                  disposeSandbox();
                  rej(new Error('Mermaid render timed out'));
                }, SANDBOX_RENDER_TIMEOUT_MS);
                pending.set(id, { resolve: res, reject: rej, timer });
                port.postMessage({ id, source, theme });
              }),
          });
          return;
        }

        const reply = msg as SandboxResponse;
        if (typeof reply.id !== 'number') return;
        const waiter = pending.get(reply.id);
        if (!waiter) return;
        pending.delete(reply.id);
        clearTimeout(waiter.timer);
        if (typeof reply.error === 'string') waiter.reject(new Error(reply.error));
        else waiter.resolve(reply.svg ?? '');
      };
      port.start();
      win.postMessage({ type: MERMAID_INIT_MESSAGE }, '*', [channel.port2]);
    };

    window.addEventListener('message', onWindowMessage);
    if (desktop) frame.src = CANVAS_FRAME_SRC;
    else frame.srcdoc = doc;
    document.body.appendChild(frame);
  });
};

const getSandbox = (): Promise<MermaidSandbox> => {
  sandboxPromise ??= createMermaidSandbox();
  return sandboxPromise;
};

const enqueue = <T>(task: () => Promise<T>): Promise<T> => {
  const next = renderQueue.then(task, task);
  renderQueue = next.then(
    () => undefined,
    () => undefined
  );
  return next;
};

const detectDarkMode = (): boolean => {
  if (typeof document === 'undefined') return false;
  const kind = document.documentElement?.dataset?.themeKind;
  if (kind === 'dark') return true;
  if (kind === 'light') return false;
  return Boolean(document.body?.classList?.contains('prism-dark'));
};

const readCssVar = (styles: CSSStyleDeclaration[], reference: string | undefined): string => {
  const name = reference ? /^var\((--[\w-]+)/.exec(reference)?.[1] : undefined;
  if (!name) return '';
  for (const style of styles) {
    const value = style.getPropertyValue(name).trim();
    if (value && !value.startsWith('var(')) return value;
  }
  return '';
};

/** Reads active folds palette variables so Mermaid matches all 23 light and dark themes. */
export const readMermaidTheme = (element?: Element | null): MermaidThemeConfig => {
  const darkMode = detectDarkMode();
  const fb = darkMode ? FALLBACK_PALETTE.dark : FALLBACK_PALETTE.light;
  const styles: CSSStyleDeclaration[] = [];

  if (typeof getComputedStyle === 'function' && typeof document !== 'undefined') {
    for (const candidate of new Set([element, document.body, document.documentElement])) {
      if (candidate) styles.push(getComputedStyle(candidate));
    }
  }

  // Optional chaining keeps tests with partial `folds` mocks working without crashing.
  const c = color as Partial<typeof color> | undefined;
  const pick = (ref: string | undefined, fallback: string) => readCssVar(styles, ref) || fallback;

  const surface = pick(c?.Surface?.Container, fb.surface);
  const surfaceVariant = pick(c?.SurfaceVariant?.Container, fb.surfaceVariant);
  const onSurface = pick(c?.Surface?.OnContainer, fb.onSurface);
  const line = pick(c?.SurfaceVariant?.ContainerLine, fb.line);
  const primaryContainer = pick(c?.Primary?.Container, fb.primaryContainer);
  const primaryOnContainer = pick(c?.Primary?.OnContainer, fb.primaryOnContainer);
  const primaryMain = pick(c?.Primary?.Main, fb.primaryMain);
  const fontFamily = styles.find((s) => s.fontFamily)?.fontFamily || FALLBACK_FONT;

  return {
    darkMode,
    fontFamily,
    themeVariables: {
      darkMode,
      background: surfaceVariant,
      mainBkg: primaryContainer,
      primaryColor: primaryContainer,
      primaryTextColor: primaryOnContainer,
      primaryBorderColor: primaryMain,
      secondaryColor: surface,
      secondaryTextColor: onSurface,
      secondaryBorderColor: line,
      tertiaryColor: surfaceVariant,
      tertiaryTextColor: onSurface,
      tertiaryBorderColor: line,
      lineColor: onSurface,
      textColor: onSurface,
      nodeBkg: primaryContainer,
      nodeBorder: primaryMain,
      nodeTextColor: primaryOnContainer,
      clusterBkg: surface,
      clusterBorder: line,
      edgeLabelBackground: surfaceVariant,
      noteBkgColor: pick(c?.Warning?.Container, fb.warningContainer),
      noteTextColor: pick(c?.Warning?.OnContainer, fb.warningOnContainer),
      noteBorderColor: pick(c?.Warning?.ContainerLine, fb.warningLine),
      fontFamily,
      fontSize: '14px',
    },
  };
};

const decodeCssEscapes = (cssText: string): string =>
  cssText.replace(
    /\\([0-9a-fA-F]{1,6})[\t\n\f\r ]?|\\([^\n\r\f])/g,
    (_, hex?: string, ch?: string) => {
      if (hex) {
        const cp = Number.parseInt(hex, 16);
        return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : '';
      }
      return ch ?? '';
    }
  );

const sanitizeCssText = (cssText: string): string => {
  const cleaned = cssText
    .replace(CSS_COMMENTS, '')
    .replace(CSS_AT_IMPORT, '')
    .replace(CSS_AT_FONT_FACE, '')
    .replace(CSS_URL_CALL, (match, q1?: string, q2?: string, bare?: string) => {
      const raw = (q1 ?? q2 ?? bare ?? '').replace(ASCII_CONTROLS, '');
      return SAFE_INTERNAL_FRAGMENT.test(raw) ? match : 'none';
    })
    .replace(CSS_IMAGE_SET, 'none')
    .replace(CSS_SRC_CALL, 'none')
    .replace(CSS_UNSAFE, '');

  // Reject CSS that still hides `url(`, `@import`, `image-set(`, etc. behind backslash escapes.
  const withoutSafeFragments = cleaned.replace(CSS_URL_CALL, '');
  if (CSS_ESCAPED_SUSPECT.test(decodeCssEscapes(withoutSafeFragments))) return '';
  return cleaned;
};

const isInternalFragment = (rawValue: string): boolean =>
  rawValue.replace(ASCII_CONTROLS, '').startsWith('#');

const sanitizeElementAttributes = (el: Element): void => {
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name.toLowerCase();
    const local = attr.localName.toLowerCase();
    if (name.startsWith('on') || FORBIDDEN_ATTRS.has(name) || FORBIDDEN_ATTRS.has(local)) {
      el.removeAttributeNode(attr);
    } else if (local === 'href') {
      if (!isInternalFragment(attr.value)) el.removeAttributeNode(attr);
    } else if (name === 'style' || SVG_URL_ATTRS.has(name)) {
      const cleaned = sanitizeCssText(attr.value).trim();
      if (cleaned) el.setAttribute(attr.name, cleaned);
      else el.removeAttributeNode(attr);
    }
  }
};

/** Replaces an SVG `<a>` element with an inert `<g>`, preserving child shapes and text. */
const unwrapAnchorToGroup = (doc: Document, anchor: Element): Element => {
  const group = doc.createElementNS(SVG_NS, 'g');
  for (const attr of Array.from(anchor.attributes)) {
    const name = attr.name.toLowerCase();
    const local = attr.localName.toLowerCase();
    if (local === 'href' || name === 'target' || name === 'rel' || name === 'download') continue;
    group.setAttribute(attr.name, attr.value);
  }
  sanitizeElementAttributes(group);
  while (anchor.firstChild) group.appendChild(anchor.firstChild);
  anchor.replaceWith(group);
  return group;
};

/**
 * Defense-in-depth SVG sanitizer: repairs missing `xmlns:xlink`, rejects non-empty
 * `<foreignObject>` (so the caller falls back to Source instead of showing missing labels),
 * turns `<a>` links into inert `<g>` wrappers, and strips active tags, handlers, non-fragment
 * URLs, and external CSS loads.
 */
export const sanitizeMermaidSvg = (svg: string): string | null => {
  if (!svg.trim() || typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return null;
  }

  let xmlSource = svg.replace(/&nbsp;/g, '&#160;');
  // Mermaid emits `xlink:href` without declaring `xmlns:xlink` on `<svg>`, which breaks strict XML.
  if (/\bxlink:/.test(xmlSource) && !/\bxmlns:xlink\s*=/.test(xmlSource)) {
    xmlSource = xmlSource.replace(/<svg\b/, '<svg xmlns:xlink="http://www.w3.org/1999/xlink"');
  }

  const parsed = new DOMParser().parseFromString(xmlSource, 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) {
    return null;
  }

  for (const el of [root, ...Array.from(root.getElementsByTagName('*'))]) {
    if (el !== root && !root.contains(el)) continue;
    const tag = el.localName.toLowerCase();

    if (tag === 'foreignobject') {
      if (el.children.length > 0 || (el.textContent?.trim() ?? '') !== '') return null;
      el.remove();
      continue;
    }
    if (FORBIDDEN_SVG_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    if (tag === 'a') {
      unwrapAnchorToGroup(parsed, el);
      continue;
    }
    if (tag === 'style' && el.textContent) el.textContent = sanitizeCssText(el.textContent);
    sanitizeElementAttributes(el);
  }

  return new XMLSerializer().serializeToString(root);
};

/** Serializes sandboxed Mermaid renders so concurrent blocks and theme changes never race. */
export const renderMermaidDiagram = (
  source: string,
  theme: MermaidThemeConfig,
  signal?: { cancelled: boolean }
): Promise<string | null> =>
  enqueue(async () => {
    if (signal?.cancelled) return null;
    const sandbox = await getSandbox();
    if (signal?.cancelled) return null;
    const svg = await sandbox.render(source, theme);
    if (signal?.cancelled) return null;
    const sanitized = sanitizeMermaidSvg(svg);
    if (!sanitized) throw new Error('Mermaid produced invalid SVG output');
    return sanitized;
  });
