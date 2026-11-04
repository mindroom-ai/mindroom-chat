// @ts-check
import { readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { e2eClientConfig } from './scripts/e2e-client-config.mjs';
import { frameHeaders } from './scripts/frame-headers.mjs';
import { startupPrecache } from './scripts/precache-plan.mjs';
import { mindroomBuildAssets } from './scripts/vite-build-assets.mjs';

/**
 * Files copied verbatim into the build output (and served by the dev server).
 * Lane P tests import this object to assert what ships, so keep it a plain
 * `{ targets }` value rather than a plugin instance.
 */
export const copyFiles = {
  targets: [
    // The MindRoom defaults are served as the runtime client config.
    { src: 'config.mindroom.json', dest: '', rename: 'config.json' },
    // Non-English catalogs load on demand from `public/locales/<code>.json` (src/app/i18n.ts).
    // English ships in the bundle, with its overlay in src/app/locales/additions/en.json; the other
    // languages' overlays in that directory load as chunks (src/app/localeAdditions.ts).
    { src: 'src/app/locales/*.json', dest: 'public/locales' },
    // License texts and notices for the bundled code (NOTICE: noVNC source, Inter font license).
    // Under public/, so the service worker never answers them with the app shell.
    { src: ['LICENSE', 'NOTICE', 'licenses/*'], dest: 'public/licenses' },
  ],
};

// The service worker precaches the SPA shell. Some files must stay network-fresh
// so a deployment can change them without rebuilding the bundle, and the
// authentication recovery script also serves shells cached by older workers.
const precacheGlobIgnores = ['runtime-config.js', 'authentication-recovery.js', 'version.json'];

// The precache holds what a signed-in start needs before it shows a room: the entry chunk and the
// chunks of these modules with their static imports, style sheets, fonts and the crypto wasm, plus
// the shell pages (scripts/precache-plan.mjs). Every room header shows the call buttons, and the
// thread actions menu opens from the first room's cards and banner (lazily, in Lane P code that
// has no fallback for a missing chunk), so both come with the start. Everything else under assets/
// is kept by the worker on first use (src/swRuntimeAssets.ts).
const startup = startupPrecache({
  startupModules: [
    'src/app/pages/client/clientPages.tsx',
    'src/app/mindroom/threads/MindroomRoom.tsx',
    'src/app/mindroom/calls/HeaderCallButtons.tsx',
    'src/app/mindroom/threads/ThreadActionsMenu.tsx',
    'matrix-js-sdk/lib/rust-crypto/index.js',
  ],
  // The PDF viewer's frame page (public/pdf-frame.html) has no hash in its name, so the worker
  // could not keep it at runtime without serving an old copy after an update.
  shellFiles: ['index.html', 'pdf-frame.html'],
});

// src/sw.ts with the precache list injected, emitted as sw.js. src/index.tsx registers it as a
// classic script and public/manifest.json is the web manifest, so the plugin adds neither.
const serviceWorkerPlugin = VitePWA({
  strategies: 'injectManifest',
  injectManifest: {
    rollupFormat: 'iife',
    injectionPoint: 'self.__WB_MANIFEST',
    // The Rust crypto wasm module is several MiB and belongs in the precache.
    maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
    globPatterns: ['**/*.{js,css,html,wasm,woff2}'],
    globIgnores: precacheGlobIgnores,
    manifestTransforms: [startup.manifestTransform],
  },
  srcDir: 'src',
  filename: 'sw.ts',
  devOptions: { enabled: false },
  injectRegister: false,
  manifest: false,
});

// The app's own sources: JSX through the React plugin, `.css.ts` files through vanilla-extract.
const sourcePlugins = [react(), vanillaExtractPlugin()];

// A slot dev server (scripts/e2e-slot.sh sets E2E_APP_PORT) pre-bundles into its own directory:
// a server sharing node_modules/.vite rewrites the chunks the others still serve, and pages then
// fail with "Failed to fetch dynamically imported module".
const slotPort = process.env.E2E_APP_PORT;

// `scripts/e2e-slot.sh --snapshot` runs Vite in a copy of one commit whose node_modules is a link to
// the checkout's. The dev server only serves files under its allow list, which then misses the real
// package directory (the crypto wasm among them), so that directory is added.
const modulesLink = fileURLToPath(new URL('./node_modules', import.meta.url));
const modulesTarget = (() => {
  try {
    return realpathSync(modulesLink);
  } catch {
    return modulesLink;
  }
})();
const linkedModules = modulesTarget === modulesLink ? [] : [modulesTarget];

// E2E_FIXTURE_PAGES=1 is the second build `scripts/e2e-slot.sh --preview` runs into the same output:
// only the spec fixture pages (e2e/fixtures/*.html), so the app bundle and the service worker's
// precache list stay exactly as they ship.
const fixturePagesOnly = process.env.E2E_FIXTURE_PAGES === '1';
const fixturePagesDir = fileURLToPath(new URL('./e2e/fixtures/', import.meta.url));
const fixturePageInputs = () =>
  Object.fromEntries(
    readdirSync(fixturePagesDir)
      .filter((name) => name.endsWith('.html'))
      .map((name) => [`fixture-${name.slice(0, -'.html'.length)}`, `${fixturePagesDir}${name}`])
  );

export default defineConfig({
  ...(slotPort ? { cacheDir: `node_modules/.vite-slot-${slotPort}` } : {}),
  plugins: [
    // Only active when Playwright starts the dev server (see playwright.config.ts).
    e2eClientConfig(process.env.MINDROOM_E2E_PROVISIONING_URL),
    // runtime-config.js, authentication-recovery.js, version.json and the build version constants.
    mindroomBuildAssets(),
    // `vite preview` says who may frame the app (frame-ancestors works only as a header).
    frameHeaders(),
    ...sourcePlugins,
    ...(fixturePagesOnly ? [] : [viteStaticCopy(copyFiles), startup.plugin, serviceWorkerPlugin]),
  ],
  server: {
    // 127.0.0.1 rather than localhost: Node can resolve localhost to ::1 only,
    // which leaves http://127.0.0.1:4200 (used by the end-to-end tests) unreachable.
    host: '127.0.0.1',
    port: 4200,
    strictPort: true,
    // E2E_NO_WATCH=1 (set by scripts/e2e-slot.sh) serves the files as they were at start, so edits
    // that other sessions make in the same checkout cannot reload pages in the middle of a spec.
    ...(process.env.E2E_NO_WATCH === '1' ? { watch: null } : {}),
    ...(linkedModules.length
      ? { fs: { allow: [searchForWorkspaceRoot(process.cwd()), ...linkedModules] } }
      : {}),
  },
  optimizeDeps: {
    // The Rust crypto bindings locate their .wasm with `new URL(..., import.meta.url)`.
    // Pre-bundling moves the JS and breaks that lookup, so serve the package as it is.
    // `vite build` emits the .wasm as a hashed asset.
    exclude: ['@matrix-org/matrix-sdk-crypto-wasm'],
    // @novnc/novnc uses top-level await, which the default pre-bundle target rejects.
    esbuildOptions: { target: 'es2022' },
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    ...(fixturePagesOnly
      ? { emptyOutDir: false, copyPublicDir: false, rollupOptions: { input: fixturePageInputs() } }
      : {}),
  },
});
