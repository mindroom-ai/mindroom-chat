// @ts-check
// What the service worker precaches (src/sw/sw.ts): the app shell and the files a signed-in start
// needs before it can show a room, so the first visit no longer downloads every build file.
//
// The startup set is the entry chunk and the chunks that hold the listed startup modules, each with
// every chunk it imports statically, their style sheets, the fonts those style sheets use, the
// images they import (the sidebar logo) and the crypto module's wasm. Chunks the app only reaches
// through a dynamic import (calls, the emoji data, KaTeX, the remote computer, locale overlays),
// sounds, and the images listed as on demand (large ones a start rarely shows) stay out: the worker
// keeps each the first time a page loads it (src/sw/swRuntimeAssets.ts).
//
// The worker also gets the build's inventory (`self.__MINDROOM_BUILD_INVENTORY`): every file under
// assets/, so a new worker keeps the files the previous build kept at runtime that it still has,
// and the overlay chunk of each language, so it can fetch the overlay for the languages the pages
// used before it takes over (src/sw/swLanguageFiles.ts).
//
// `vite build` hands the plugin the bundle, then the PWA plugin's `closeBundle` builds the worker
// (with `workerPlugin`, which writes the inventory in) and runs the manifest transform, which drops
// every precache entry outside the set. A startup module missing from the bundle, a startup file
// the precache globs never matched, or a worker without the inventory's marker fails the build:
// each would leave an offline start without a file it loads.

import path from 'node:path';

/** Build files other than code a startup chunk brings: fonts from its style sheets, the wasm, images. */
const STARTUP_ASSET = /\.(?:woff2|wasm|png|svg|webp|avif|jpe?g|gif|ico)$/;

/** Where the worker source reads the inventory; `workerPlugin` replaces it with the JSON. */
const INVENTORY_MARKER = 'self.__MINDROOM_BUILD_INVENTORY';

/**
 * @typedef {import('vite').Rollup.OutputBundle} OutputBundle
 * @typedef {import('vite').Rollup.OutputChunk} OutputChunk
 * @typedef {{ url: string, revision: string | null, size: number, integrity?: string }} PrecacheEntry
 * @typedef {{ files: string[], localeOverlays: Record<string, string> }} BuildInventory
 */

/** @param {string} id */
const slashed = (id) => id.split('\\').join('/');

/**
 * The build files emitted for `sources`, paths that the source file name of an asset ends with.
 * Each must match a file of the bundle, so a renamed source cannot slip back into the precache.
 * @param {OutputBundle} bundle
 * @param {readonly string[]} sources
 * @returns {Set<string>}
 */
const emittedFrom = (bundle, sources) => {
  /** @type {Set<string>} */
  const emitted = new Set();
  sources.forEach((source) => {
    const before = emitted.size;
    Object.values(bundle).forEach((output) => {
      if (output.type !== 'asset') return;
      if (output.originalFileNames.some((name) => slashed(name).endsWith(source))) {
        emitted.add(output.fileName);
      }
    });
    if (emitted.size === before) {
      throw new Error(`precache plan: no build file comes from the on-demand asset ${source}`);
    }
  });
  return emitted;
};

/**
 * The output files a signed-in start loads: the entry chunks and the chunks holding
 * `startupModules` (paths that module IDs end with), with their static imports, style sheets,
 * fonts, wasm and images, except the images made from `onDemandAssets` (source paths).
 * @param {OutputBundle} bundle
 * @param {readonly string[]} startupModules
 * @param {readonly string[]} [onDemandAssets]
 * @returns {Set<string>}
 */
export const startupFiles = (bundle, startupModules, onDemandAssets = []) => {
  const onDemand = emittedFrom(bundle, onDemandAssets);
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
      if (STARTUP_ASSET.test(asset) && !onDemand.has(asset)) files.add(asset);
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
 * The build files under `assetsDir`, and the chunk of each locale overlay that loads on its own: a
 * chunk made for a module whose path `localeOverlay` matches, its first group being the language
 * code (English's overlay is part of the entry chunk).
 * @param {OutputBundle} bundle
 * @param {string} assetsDir
 * @param {RegExp} localeOverlay
 * @returns {BuildInventory}
 */
export const buildInventory = (bundle, assetsDir, localeOverlay) => {
  const prefix = `${assetsDir.replace(/\/+$/, '')}/`;
  /** @type {Record<string, string>} */
  const localeOverlays = {};
  Object.values(bundle).forEach((output) => {
    if (output.type !== 'chunk' || !output.facadeModuleId) return;
    const language = localeOverlay.exec(slashed(output.facadeModuleId))?.[1];
    if (language) localeOverlays[language] = output.fileName;
  });
  const files = Object.keys(bundle)
    .filter((fileName) => fileName.startsWith(prefix))
    .sort();
  return { files, localeOverlays };
};

/**
 * The plugin that reads the bundle, the manifest transform that keeps only the startup files and
 * `shellFiles` (paths in the output directory, such as `index.html`), and the plugin for the
 * worker's own build that writes the build inventory into it.
 * @param {{ startupModules: readonly string[], onDemandAssets?: readonly string[], shellFiles: readonly string[], localeOverlay: RegExp }} options
 */
export const startupPrecache = ({ startupModules, onDemandAssets, shellFiles, localeOverlay }) => {
  /** @type {Set<string> | undefined} */
  let planned;
  /** @type {BuildInventory | undefined} */
  let inventory;
  let assetsDir = 'assets';
  // vite-plugin-pwa builds the worker once the build has ended, also after it failed. A build that
  // failed while it rendered its output must end with its own error, so the worker's build, which
  // never ships, then passes without the plan, when the build had emptied its output directory.
  // Otherwise (a failure in the build phase, buildEnd hooks included, or an output directory that
  // keeps an earlier build) the worker's build fails as ever, writing no worker over an earlier one.
  let emptiesOutDir = false;
  let passWithoutPlan = false;

  /** @type {import('vite').Plugin} */
  const plugin = {
    name: 'mindroom-startup-precache',
    apply: 'build',
    configResolved(config) {
      assetsDir = config.build.assetsDir;
      // As Vite decides it: unless set, it empties an output directory inside the root only.
      const outDir = path.resolve(config.root, config.build.outDir);
      emptiesOutDir = config.build.emptyOutDir ?? outDir.startsWith(`${config.root}${path.sep}`);
    },
    renderStart() {
      passWithoutPlan = emptiesOutDir;
    },
    generateBundle(_options, bundle) {
      planned = new Set([...shellFiles, ...startupFiles(bundle, startupModules, onDemandAssets)]);
      inventory = buildInventory(bundle, assetsDir, localeOverlay);
    },
  };

  /** @type {import('vite').Plugin} */
  const workerPlugin = {
    name: 'mindroom-worker-build-inventory',
    apply: 'build',
    renderChunk(code) {
      if (!inventory) {
        if (passWithoutPlan) return null;
        throw new Error('precache plan: the build never reported its bundle');
      }
      const parts = code.split(INVENTORY_MARKER);
      if (parts.length !== 2) {
        throw new Error(
          `precache plan: the worker reads ${INVENTORY_MARKER} ${parts.length - 1} times, not once`
        );
      }
      return { code: parts.join(JSON.stringify(inventory)), map: null };
    },
  };

  /**
   * @param {PrecacheEntry[]} entries
   * @returns {{ manifest: PrecacheEntry[], warnings: string[] }}
   */
  const manifestTransform = (entries) => {
    const wanted = planned;
    if (!wanted) {
      if (passWithoutPlan) return { manifest: [], warnings: [] };
      throw new Error('precache plan: the build never reported its bundle');
    }
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

  return { plugin, manifestTransform, workerPlugin };
};
