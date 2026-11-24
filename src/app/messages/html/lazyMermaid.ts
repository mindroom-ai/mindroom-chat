import { color } from 'folds';
import type { Mermaid } from 'mermaid';
import { DARK_THEME_NAMES, LIGHT_THEME_NAMES } from '../../preferences/themeNames';

// Mermaid loads on demand with the first fenced `mermaid` code block so the initial bundle pays
// zero bytes for it. All `initialize` + `render` pairs run sequentially through `renderQueue`
// because Mermaid keeps its active theme configuration in module-level state.

const DARK_THEME_CLASSES = new Set(DARK_THEME_NAMES.map((name) => `${name}-theme`));
const LIGHT_THEME_CLASSES = new Set(LIGHT_THEME_NAMES.map((name) => `${name}-theme`));
const FALLBACK_FONT = 'Inter Variable, system-ui, -apple-system, sans-serif';

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

const SECURE_CONFIG_KEYS =
  'secure securityLevel startOnLoad maxTextSize suppressErrorRendering maxEdges htmlLabels theme themeVariables'.split(
    ' '
  );
const FORBIDDEN_SVG_TAGS = new Set(
  'script foreignobject iframe frame frameset object embed applet base link meta form input button textarea select audio video source track noscript template portal handler animate set animatemotion animatetransform animatecolor'.split(
    ' '
  )
);
const FORBIDDEN_ATTRS = new Set(
  'src srcdoc action formaction poster data ping dynsrc lowsrc'.split(' ')
);

// eslint-disable-next-line no-control-regex -- strip ASCII control characters before inspecting URL schemes
const ASCII_CONTROLS = /[\u0000-\u001f\u007f\s]+/g;
const SAFE_EXTERNAL_URL = /^(?:https?|mailto):/i;
const CSS_URL_CALL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
const CSS_AT_IMPORT = /@import\b[^;]*(?:;|$)/gi;
const CSS_UNSAFE =
  /(?:expression\s*\([^)]*\)|javascript\s*:[^;"]*|vbscript\s*:[^;"]*|-moz-binding\s*:[^;]*|behavior\s*:[^;]*)/gi;

export type MermaidThemeConfig = {
  darkMode: boolean;
  fontFamily: string;
  themeVariables: Record<string, string | boolean>;
};

let mermaidPromise: Promise<Mermaid> | undefined;
let renderQueue: Promise<unknown> = Promise.resolve();
let renderCounter = 0;

/** WebKit before iOS 17.4 lacks `Object.groupBy`, which Mermaid's usecase diagrams call. */
const ensureObjectGroupBy = (): void => {
  if (typeof (Object as { groupBy?: unknown }).groupBy === 'function') return;
  Object.defineProperty(Object, 'groupBy', {
    writable: true,
    configurable: true,
    value<T, K extends PropertyKey>(items: Iterable<T>, keyOf: (item: T, index: number) => K) {
      const groups = Object.create(null) as Record<PropertyKey, T[]>;
      let index = 0;
      for (const item of items) {
        const key = keyOf(item, index++);
        (groups[key] ??= []).push(item);
      }
      return groups;
    },
  });
};

/** Loads Mermaid once; a failed load retries on the next render attempt. */
export const loadMermaid = (): Promise<Mermaid> => {
  ensureObjectGroupBy();
  mermaidPromise ??= import('mermaid').then(
    (module) => module.default,
    (error: unknown) => {
      mermaidPromise = undefined;
      throw error;
    }
  );
  return mermaidPromise;
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
  const { documentElement: html, body } = document;
  if (html?.dataset?.themeKind === 'dark') return true;
  if (html?.dataset?.themeKind === 'light') return false;
  if (body?.classList?.contains('prism-dark')) return true;
  if (body?.classList?.contains('prism-light')) return false;
  for (const cls of html?.classList ?? []) {
    if (DARK_THEME_CLASSES.has(cls)) return true;
    if (LIGHT_THEME_CLASSES.has(cls)) return false;
  }
  return Boolean(html?.classList?.contains('dark'));
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
    const unique = new Set([element, document.body, document.documentElement]);
    for (const candidate of unique) {
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

const sanitizeCssText = (cssText: string): string =>
  cssText
    .replace(CSS_AT_IMPORT, '')
    .replace(CSS_URL_CALL, (match, q1?: string, q2?: string, bare?: string) => {
      const raw = (q1 ?? q2 ?? bare ?? '').replace(ASCII_CONTROLS, '');
      return raw.startsWith('#') ? match : 'none';
    })
    .replace(CSS_UNSAFE, '');

const isSafeHref = (tagName: string, rawValue: string): boolean => {
  const normalized = rawValue.replace(ASCII_CONTROLS, '');
  return normalized.startsWith('#') || (tagName === 'a' && SAFE_EXTERNAL_URL.test(normalized));
};

/** Defense-in-depth SVG sanitizer: strips active tags, handlers, unsafe URLs, and external CSS. */
export const sanitizeMermaidSvg = (svg: string): string | null => {
  if (!svg.trim() || typeof DOMParser === 'undefined' || typeof XMLSerializer === 'undefined') {
    return null;
  }

  const parsed = new DOMParser().parseFromString(svg.replace(/&nbsp;/g, '&#160;'), 'image/svg+xml');
  const root = parsed.documentElement;
  if (!root || root.localName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) {
    return null;
  }

  for (const el of [root, ...Array.from(root.getElementsByTagName('*'))]) {
    if (el !== root && !root.contains(el)) continue;
    const tag = el.localName.toLowerCase();
    if (FORBIDDEN_SVG_TAGS.has(tag)) {
      el.remove();
      continue;
    }
    if (tag === 'style' && el.textContent) el.textContent = sanitizeCssText(el.textContent);

    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const local = attr.localName.toLowerCase();
      if (name.startsWith('on') || FORBIDDEN_ATTRS.has(name) || FORBIDDEN_ATTRS.has(local)) {
        el.removeAttributeNode(attr);
      } else if (local === 'href') {
        if (!isSafeHref(tag, attr.value)) el.removeAttributeNode(attr);
        else if (tag === 'a' && !attr.value.trim().startsWith('#')) {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noreferrer noopener');
        }
      } else if (name === 'style') {
        const cleaned = sanitizeCssText(attr.value).trim();
        if (cleaned) el.setAttribute('style', cleaned);
        else el.removeAttributeNode(attr);
      }
    }
  }

  return new XMLSerializer().serializeToString(root);
};

/** Serializes Mermaid `initialize` + `render` so concurrent blocks and theme changes never race. */
export const renderMermaidDiagram = (
  source: string,
  theme: MermaidThemeConfig,
  signal?: { cancelled: boolean }
): Promise<string | null> =>
  enqueue(async () => {
    if (signal?.cancelled) return null;
    const mermaid = await loadMermaid();
    if (signal?.cancelled) return null;

    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      htmlLabels: false,
      suppressErrorRendering: true,
      secure: SECURE_CONFIG_KEYS,
      theme: 'base',
      darkMode: theme.darkMode,
      fontFamily: theme.fontFamily,
      themeVariables: theme.themeVariables,
    });

    const id = `mindroom-mermaid-${++renderCounter}`;
    try {
      const { svg } = await mermaid.render(id, source);
      if (signal?.cancelled) return null;
      const sanitized = sanitizeMermaidSvg(svg);
      if (!sanitized) throw new Error('Mermaid produced invalid SVG output');
      return sanitized;
    } finally {
      if (typeof document !== 'undefined') {
        document.getElementById(id)?.remove();
        document.getElementById(`d${id}`)?.remove();
      }
    }
  });
