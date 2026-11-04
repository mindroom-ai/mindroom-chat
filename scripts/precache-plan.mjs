// @ts-check
// What the service worker precaches (src/sw.ts): the app shell and the files a signed-in start
// needs before it can show a room, so the first visit no longer downloads every build file.
//
// The startup set is the entry chunk and the chunks that hold the listed startup modules, each with
// every chunk it imports statically, their style sheets, the fonts those style sheets use and the
// crypto module's wasm. Chunks the app only reaches through a dynamic import (calls, the emoji
// data, KaTeX, the remote computer, locale overlays), images and sounds stay out: the worker keeps
// each the first time a page loads it (src/swRuntimeAssets.ts).
//
// `vite build` hands the plugin the bundle, then the PWA plugin's `closeBundle` builds the worker
// and runs the manifest transform, which drops every precache entry outside the set. A startup
// module missing from the bundle, or a startup file the precache globs never matched, fails the
// build: either would leave an offline start without a file it loads.

/** Build files other than code a startup chunk brings: fonts from its style sheets, the wasm. */
const STARTUP_ASSET = /\.(?:woff2|wasm)$/;

/**
 * @typedef {import('vite').Rollup.OutputBundle} OutputBundle
 * @typedef {import('vite').Rollup.OutputChunk} OutputChunk
 * @typedef {{ url: string, revision: string | null, size: number, integrity?: string }} PrecacheEntry
 */

/** @param {string} id */
const slashed = (id) => id.split('\\').join('/');

/**
 * The output files a signed-in start loads: the entry chunks and the chunks holding
 * `startupModules` (paths that module IDs end with), with their static imports, style sheets,
 * fonts and wasm.
 * @param {OutputBundle} bundle
 * @param {readonly string[]} startupModules
 * @returns {Set<string>}
 */
export const startupFiles = (bundle, startupModules) => {
  /** @type {OutputChunk[]} */
  const chunks = [];
  Object.values(bundle).forEach((output) => {
    if (output.type === 'chunk') chunks.push(output);
  });
  const roots = chunks.filter((chunk) => chunk.isEntry);
  startupModules.forEach((modulePath) => {
    const holder = chunks.find((chunk) =>
      chunk.moduleIds.some((moduleId) => slashed(moduleId).endsWith(modulePath))
    );
    if (!holder) throw new Error(`precache plan: no chunk holds the startup module ${modulePath}`);
    roots.push(holder);
  });

  /** @type {Set<string>} */
  const files = new Set();
  /** @param {OutputChunk} chunk */
  const add = (chunk) => {
    if (files.has(chunk.fileName)) return;
    files.add(chunk.fileName);
    chunk.viteMetadata?.importedCss.forEach((sheet) => files.add(sheet));
    chunk.viteMetadata?.importedAssets.forEach((asset) => {
      if (STARTUP_ASSET.test(asset)) files.add(asset);
    });
    chunk.imports.forEach((fileName) => {
      const imported = bundle[fileName];
      if (imported?.type === 'chunk') add(imported);
    });
  };
  roots.forEach(add);
  return files;
};

/**
 * The plugin that reads the bundle and the manifest transform that keeps only the startup files
 * and `shellFiles` (paths in the output directory, such as `index.html`).
 * @param {{ startupModules: readonly string[], shellFiles: readonly string[] }} options
 */
export const startupPrecache = ({ startupModules, shellFiles }) => {
  /** @type {Set<string> | undefined} */
  let planned;

  /** @type {import('vite').Plugin} */
  const plugin = {
    name: 'mindroom-startup-precache',
    apply: 'build',
    generateBundle(_options, bundle) {
      planned = new Set([...shellFiles, ...startupFiles(bundle, startupModules)]);
    },
  };

  /**
   * @param {PrecacheEntry[]} entries
   * @returns {{ manifest: PrecacheEntry[], warnings: string[] }}
   */
  const manifestTransform = (entries) => {
    const wanted = planned;
    if (!wanted) throw new Error('precache plan: the build never reported its bundle');
    const manifest = entries.filter((entry) => wanted.has(entry.url));
    const listed = new Set(manifest.map((entry) => entry.url));
    const missing = [...wanted].filter((file) => !listed.has(file));
    if (missing.length > 0) {
      throw new Error(
        `precache plan: startup files outside the precache globs: ${missing.join(', ')}`
      );
    }
    return { manifest, warnings: [] };
  };

  return { plugin, manifestTransform };
};
