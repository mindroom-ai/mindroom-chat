// @ts-check
/**
 * The libraries Chat itself serves to canvas pages (src/app/messages/canvas/canvasLibraries.ts names
 * them): the classic builds of the pinned npm dependencies, which a page's frame loads without CORS
 * though its origin is opaque. KaTeX's style sheet takes its fonts inline as data: URLs, which the
 * canvas policy allows, since a font from another origin needs CORS. A hash of the files names their
 * directory, so it may be cached for good like the rest of assets/.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const MODULES = new URL('../node_modules/', import.meta.url);

/** Each `src:` list keeps only its woff2 face, inline; every browser that runs Chat reads woff2. */
export const inlineFonts = (/** @type {string} */ css, /** @type {string} */ directory) =>
  css.replace(/src:([^;}]*)/g, (_, /** @type {string} */ sources) => {
    const woff2 = /url\(["']?([^)"']+\.woff2)["']?\)/.exec(sources)?.[1];
    if (!woff2) throw new Error(`No woff2 font in ${sources}`);
    const font = readFileSync(path.join(directory, woff2)).toString('base64');
    return `src:url(data:font/woff2;base64,${font}) format("woff2")`;
  });

const KATEX = new URL('katex/dist/', MODULES);

/** The files, by the name a canvas page's head refers to them. */
export const CANVAS_LIBRARY_FILES = [
  {
    name: 'chart.umd.min.js',
    source: readFileSync(new URL('chart.js/dist/chart.umd.min.js', MODULES)),
  },
  { name: 'd3.min.js', source: readFileSync(new URL('d3/dist/d3.min.js', MODULES)) },
  { name: 'mermaid.min.js', source: readFileSync(new URL('mermaid/dist/mermaid.min.js', MODULES)) },
  { name: 'katex.min.js', source: readFileSync(new URL('katex.min.js', KATEX)) },
  {
    name: 'auto-render.min.js',
    source: readFileSync(new URL('contrib/auto-render.min.js', KATEX)),
  },
  {
    name: 'katex.min.css',
    source: Buffer.from(
      inlineFonts(readFileSync(new URL('katex.min.css', KATEX), 'utf8'), KATEX.pathname)
    ),
  },
];

const hash = createHash('sha256');
CANVAS_LIBRARY_FILES.forEach(({ source }) => hash.update(source));
export const CANVAS_LIBRARY_DIR = `assets/canvas-libs-${hash.digest('hex').slice(0, 12)}`;

const TYPES = { js: 'text/javascript', css: 'text/css' };

/**
 * Emits the files into the bundle, so they are in the build inventory and the native apps' copy,
 * and the dev server answers them.
 * @returns {import('vite').Plugin}
 */
export const canvasLibraryFiles = () => ({
  name: 'canvas-library-files',
  generateBundle() {
    CANVAS_LIBRARY_FILES.forEach(({ name, source }) =>
      this.emitFile({ type: 'asset', fileName: `${CANVAS_LIBRARY_DIR}/${name}`, source })
    );
  },
  configureServer(server) {
    server.middlewares.use(`/${CANVAS_LIBRARY_DIR}`, (request, response, next) => {
      const file = CANVAS_LIBRARY_FILES.find(
        ({ name }) => request.url?.split('?')[0] === `/${name}`
      );
      if (!file) return next();
      response.setHeader(
        'Content-Type',
        TYPES[/** @type {'js' | 'css'} */ (file.name.split('.').pop())]
      );
      return response.end(file.source);
    });
  },
});
