// @ts-check
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { clientPlugins, readClientPlugins } from './scripts/client-plugins.mjs';
import { e2eClientConfig } from './scripts/e2e-client-config.mjs';
import {
  pluginCopies,
  pluginDirectories,
  pluginDirectoryServer,
  pluginPageInputs,
} from './scripts/e2e-plugin-pages.mjs';
import { frameHeaders } from './scripts/frame-headers.mjs';
import { onePackageCopyPerVersion } from './scripts/package-copies.mjs';
import { startupPrecache } from './scripts/precache-plan.mjs';
import { thirdPartyNoticesPlugin } from './scripts/third-party-notices.mjs';
import { mindroomBuildAssets } from './scripts/vite-build-assets.mjs';

// Call transcription's speech detector (src/app/calls/transcription/speechCapture.ts):
// @ricky0123/vad-web loads its AudioWorklet and its default model, Silero VAD, and onnxruntime-web
// its WebAssembly, each by a fixed name from one directory. A hash of the files names that
// directory, so it may be cached for good like the rest of assets/. The runtime's module goes as
// .js: nginx, among other static hosts, has no JavaScript type for .mjs.
const SPEECH_MODEL_FILES = [
  ['@ricky0123/vad-web/dist/vad.worklet.bundle.min.js', 'text/javascript'],
  ['@ricky0123/vad-web/dist/silero_vad_legacy.onnx', 'application/octet-stream'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.wasm', 'application/wasm'],
  ['onnxruntime-web/dist/ort-wasm-simd-threaded.mjs', 'text/javascript'],
].map(([file, type]) => ({
  source: readFileSync(new URL(`node_modules/${file}`, import.meta.url)),
  name: path.basename(file).replace(/\.mjs$/, '.js'),
  type,
}));
const speechModelHash = createHash('sha256');
SPEECH_MODEL_FILES.forEach(({ source }) => speechModelHash.update(source));
const SPEECH_MODEL_DIR = `assets/speech-model-${speechModelHash.digest('hex').slice(0, 12)}`;

/**
 * Emits the speech model's files into the bundle, so they are in the build inventory the service
 * worker keeps its copies by, and the dev server answers them.
 * @returns {import('vite').Plugin}
 */
const speechModelFiles = () => ({
  name: 'speech-model-files',
  generateBundle() {
    SPEECH_MODEL_FILES.forEach(({ source, name }) =>
      this.emitFile({ type: 'asset', fileName: `${SPEECH_MODEL_DIR}/${name}`, source })
    );
  },
  configureServer(server) {
    server.middlewares.use(`/${SPEECH_MODEL_DIR}`, (request, response, next) => {
      const file = SPEECH_MODEL_FILES.find(({ name }) => request.url === `/${name}`);
      if (!file) return next();
      response.setHeader('Content-Type', file.type);
      return response.end(file.source);
    });
  },
});

/**
 * Files copied verbatim into the build output (and served by the dev server).
 * Lane P tests import this object to assert what ships, so keep it a plain
 * `{ targets }` value rather than a plugin instance.
 */
export const copyFiles = {
  targets: [
    // The MindRoom defaults are served as the runtime client config.
    { src: 'config.mindroom.json', dest: '', rename: 'config.json' },
    // Non-English catalogs load on demand from `public/locales/<code>.json` (src/app/i18n/i18n.ts).
    // English ships in the bundle, with its overlay in src/app/i18n/locales/additions/en.json; the other
    // languages' overlays in that directory load as chunks (src/app/i18n/localeAdditions.ts).
    { src: 'src/app/i18n/locales/*.json', dest: 'public/locales' },
    // License texts and notices for the bundled code (NOTICE: noVNC source, fonts, native templates,
    // ported code); thirdPartyNoticesPlugin adds the npm dependencies' THIRD_PARTY_NOTICES.txt.
    // Under public/, so the service worker never answers them with the app shell.
    { src: ['LICENSE', 'NOTICE', 'licenses/*'], dest: 'public/licenses' },
  ],
};

// The service worker precaches the SPA shell. Some files must stay network-fresh
// so a deployment can change them without rebuilding the bundle, and the
// authentication recovery script also serves shells cached by older workers.
// The speech model's files load only when a call is transcribed, and are kept then.
const precacheGlobIgnores = [
  'runtime-config.js',
  'authentication-recovery.js',
  'version.json',
  `${SPEECH_MODEL_DIR}/**`,
];

// The Lane C string overlays (src/app/i18n/localeAdditions.ts): one JSON file per language, in the
// folder of the English one (named by a file, which the move codemod rewrites).
const LOCALE_ADDITIONS = `${path.posix.dirname('src/app/i18n/locales/additions/en.json')}/`;

// The precache holds what a signed-in start needs before it shows a room: the entry chunk and the
// chunks of these modules with their static imports, style sheets, fonts, images and the crypto
// wasm, plus the shell pages (scripts/precache-plan.mjs). Every room header shows the call buttons, and the
// thread actions menu opens from the first room's cards and banner (lazily, in Lane P code that
// has no fallback for a missing chunk), so both come with the start. Everything else under assets/
// is kept by the worker on first use (src/sw/swRuntimeAssets.ts).
const startup = startupPrecache({
  startupModules: [
    'src/app/shell/clientPages.tsx',
    'src/app/room/Room.tsx',
    'src/app/calls/HeaderCallButtons.tsx',
    'src/app/threads/ThreadActionsMenu.tsx',
    'matrix-js-sdk/lib/rust-crypto/index.js',
  ],
  // The thinking marks (1.37 MB raw) show only while an agent thinks, so the worker keeps them the
  // first time a page shows one instead of every first visit downloading them.
  onDemandAssets: [
    'src/app/messages/agent-run/thinking-mark-base.svg',
    'src/app/messages/agent-run/thinking-mark-core.svg',
  ],
  // The PDF viewer's frame page (public/pdf-frame.html) has no hash in its name, so the worker
  // could not keep it at runtime without serving an old copy after an update.
  shellFiles: ['index.html', 'pdf-frame.html'],
  // The Lane C string overlays (src/app/i18n/localeAdditions.ts), one chunk per language: the worker
  // fetches the ones for the languages the pages used when a new build installs.
  localeOverlay: new RegExp(`/${LOCALE_ADDITIONS}([A-Za-z-]+)\\.json$`),
});

// src/sw/sw.ts with the precache list injected, emitted as sw.js. src/index.tsx registers it as a
// classic script and public/manifest.json is the web manifest, so the plugin adds neither.
const SW_ENTRY = 'src/sw/sw.ts';
const serviceWorkerPlugin = VitePWA({
  strategies: 'injectManifest',
  injectManifest: {
    rollupFormat: 'iife',
    injectionPoint: 'self.__WB_MANIFEST',
    // The Rust crypto wasm module is several MiB and belongs in the precache.
    maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
    globPatterns: ['**/*.{js,css,html,wasm,woff2,png,svg,webp,avif,jpg,jpeg,gif,ico}'],
    globIgnores: precacheGlobIgnores,
    manifestTransforms: [startup.manifestTransform],
    // Writes the build inventory into the worker (scripts/precache-plan.mjs), and fails on two
    // copies of one package version there too.
    buildPlugins: { vite: [startup.workerPlugin, onePackageCopyPerVersion()] },
  },
  srcDir: path.dirname(SW_ENTRY),
  filename: path.basename(SW_ENTRY),
  devOptions: { enabled: false },
  injectRegister: false,
  manifest: false,
});

// The client plugins MINDROOM_CLIENT_PLUGINS lists: the packages each installed in its own directory
// are its own, which the one-copy check leaves out (the packages the app shares come from the app).
const clientPluginDirs = readClientPlugins(process.env.MINDROOM_CLIENT_PLUGINS).map(
  ({ dir }) => dir
);

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
// only the spec fixture pages (e2e/fixtures/*.html, and the plugin directories' copies in e2e-plugins/), so the
// app bundle and the service worker's precache list stay exactly as they ship.
const fixturePagesOnly = process.env.E2E_FIXTURE_PAGES === '1';
const fixturePagesDir = fileURLToPath(new URL('./e2e/fixtures/', import.meta.url));
const fixturePageInputs = () =>
  Object.fromEntries(
    readdirSync(fixturePagesDir)
      .filter((name) => name.endsWith('.html'))
      .map((name) => [`fixture-${name.slice(0, -'.html'.length)}`, `${fixturePagesDir}${name}`])
  );
// The plugin directories of the e2e stack (E2E_PLUGIN_DIRS), which the dev server serves
// (scripts/e2e-plugin-pages.mjs).
const repository = fileURLToPath(new URL('.', import.meta.url));
const pluginDirs = pluginDirectories(process.env.E2E_PLUGIN_DIRS, repository);

export default defineConfig({
  define: { __MINDROOM_SPEECH_MODEL__: JSON.stringify(SPEECH_MODEL_DIR) },
  ...(slotPort ? { cacheDir: `node_modules/.vite-slot-${slotPort}` } : {}),
  plugins: [
    // Only active when Playwright starts the dev server (see playwright.config.ts).
    e2eClientConfig(process.env.MINDROOM_E2E_PROVISIONING_URL),
    // runtime-config.js, authentication-recovery.js, version.json and the build version constants.
    mindroomBuildAssets(),
    // The client plugins MINDROOM_CLIENT_PLUGINS lists (docs/architecture.md "Client plugins").
    clientPlugins(),
    // `vite preview` says who may frame the app (frame-ancestors works only as a header).
    frameHeaders(),
    ...sourcePlugins,
    // The build fails when the app's chunks hold two copies of one package version
    // (scripts/package-copies.mjs). `?worker` bundles take only `worker.plugins`; the app's one,
    // livekit-client's encryption worker, is a single prebuilt module.
    // The plugin directories' copies of `e2e-slot.sh --preview` keep their own packages too.
    onePackageCopyPerVersion([...clientPluginDirs, ...pluginCopies(repository)]),
    ...(pluginDirs.length ? [pluginDirectoryServer(pluginDirs)] : []),
    ...(fixturePagesOnly
      ? []
      : [
          viteStaticCopy(copyFiles),
          thirdPartyNoticesPlugin(),
          // Before startup.plugin, which reads the bundle's inventory.
          speechModelFiles(),
          startup.plugin,
          serviceWorkerPlugin,
        ]),
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
      ? {
          emptyOutDir: false,
          copyPublicDir: false,
          rollupOptions: {
            input: {
              ...fixturePageInputs(),
              ...pluginPageInputs(repository),
            },
          },
        }
      : {}),
  },
});
