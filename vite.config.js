// @ts-check
import react from '@vitejs/plugin-react';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { e2eClientConfig } from './scripts/e2e-client-config.mjs';

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
    // English ships in the bundle, with its overlay in src/app/locales/additions/en.json.
    { src: 'src/app/locales/*.json', dest: 'public/locales' },
  ],
};

// The service worker precaches the SPA shell. Some files must stay network-fresh
// so a deployment can change them without rebuilding the bundle.
const precacheGlobIgnores = ['runtime-config.js', 'version.json'];

export default defineConfig({
  plugins: [
    // Only active when Playwright starts the dev server (see playwright.config.ts).
    e2eClientConfig(process.env.MINDROOM_E2E_PROVISIONING_URL),










        injectionPoint: 'self.__WB_MANIFEST',
        // The Rust crypto wasm module is several MiB and belongs in the precache.
        maximumFileSizeToCacheInBytes: 12 * 1024 * 1024,
        globPatterns: ['**/*.{js,css,html,wasm,woff2,svg,png,ico}'],
        globIgnores: precacheGlobIgnores,
      },
      devOptions: { enabled: false },
    }),
  ],
  server: {
    // 127.0.0.1 rather than localhost: Node can resolve localhost to ::1 only,
    // which leaves http://127.0.0.1:4200 (used by the end-to-end tests) unreachable.
    host: '127.0.0.1',
    port: 4200,
    strictPort: true,
  },
  optimizeDeps: {
    // The Rust crypto bindings locate their .wasm with `new URL(..., import.meta.url)`.
    // Pre-bundling moves the JS and breaks that lookup, so serve the package as it is.
    // `vite build` emits the .wasm as a hashed asset.
    exclude: ['@matrix-org/matrix-sdk-crypto-wasm'],
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
  },
});
