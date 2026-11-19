import { appUrl } from '../../lib/basePath';

declare const __MINDROOM_CANVAS_LIBRARIES__: string;

/**
 * The libraries Chat serves to canvas pages from its own origin (scripts/canvas-libraries.mjs), by
 * the name a revision's `libraries` gives them, and the files each adds to the page's head in order.
 */
const LIBRARIES = {
  chartjs: { scripts: ['chart.umd.min.js'] },
  d3: { scripts: ['d3.min.js'] },
  mermaid: { scripts: ['mermaid.min.js'] },
  katex: { styles: ['katex.min.css'], scripts: ['katex.min.js', 'auto-render.min.js'] },
} satisfies Record<string, { styles?: string[]; scripts: string[] }>;

export type CanvasLibraryName = keyof typeof LIBRARIES;

export const CANVAS_LIBRARY_NAMES = Object.keys(LIBRARIES) as CanvasLibraryName[];

const known = (name: string): name is CanvasLibraryName => Object.hasOwn(LIBRARIES, name);

/**
 * The absolute address of the libraries' directory, with its trailing slash. A canvas runs in an
 * opaque origin, where `'self'` matches nothing, so its policy names this address; in the native
 * apps it has the app's own scheme. Unit tests run without the build's constant.
 */
export const canvasLibraryDirectory = (): string =>
  new URL(
    `${appUrl(
      typeof __MINDROOM_CANVAS_LIBRARIES__ === 'string'
        ? __MINDROOM_CANVAS_LIBRARIES__
        : 'assets/canvas-libs'
    )}/`,
    window.location.href
  ).href;

export type CanvasLibraries = {
  /**
   * The exact addresses of the scripts and style sheets the page loads, which alone its policy
   * allows: a directory would also let in any address a server resolves into or out of it.
   */
  scripts: string[];
  styles: string[];
  /** The tags for the page's head. */
  tags: string;
  /** Names this Chat does not serve, which the page reports as an error. */
  unknown: string[];
};

/** The head tags and policy source for the libraries a revision names. */
export const canvasLibraries = (
  names: readonly string[] | undefined,
  directory: () => string = canvasLibraryDirectory
): CanvasLibraries => {
  const wanted = [...new Set(names)];
  const served = wanted.filter(known);
  const unknown = wanted.filter((name) => !known(name));
  if (served.length === 0) return { scripts: [], styles: [], tags: '', unknown };
  const base = directory();
  const files = served.map((name): { styles?: string[]; scripts: string[] } => LIBRARIES[name]);
  const styles = files.flatMap((file) => (file.styles ?? []).map((name) => `${base}${name}`));
  const scripts = files.flatMap((file) => file.scripts.map((name) => `${base}${name}`));
  const tags = [
    ...styles.map((url) => `<link rel="stylesheet" href="${url}">`),
    ...scripts.map((url) => `<script src="${url}"></script>`),
  ].join('');
  return { scripts, styles, tags, unknown };
};
