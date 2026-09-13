import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { wasm } from '@rollup/plugin-wasm';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import { vanillaExtractPlugin } from '@vanilla-extract/vite-plugin';
import { NodeGlobalsPolyfillPlugin } from '@esbuild-plugins/node-globals-polyfill';
import inject from '@rollup/plugin-inject';
import topLevelAwait from 'vite-plugin-top-level-await';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import buildConfig from './build.config';
import { resolveBuildVersion } from './scripts/build-version.mjs';
import { injectElementCallTransparentBackground } from './scripts/element-call-background.mjs';

const getBuildVersion = () => {
  let localCommit;
  try {
    localCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: path.resolve(),
      encoding: 'utf8',
    }).trim();
  } catch {
    // Manual uploads may not include a Git checkout; DEPLOY_ID remains usable.
  }

  return resolveBuildVersion(process.env, localCommit) ?? 'unknown';
};

const buildVersion = getBuildVersion();

function appVersionManifest() {
  return {
    name: 'mindroom-app-version-manifest',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version: buildVersion })}\n`,
      });
    },
  };
}

export const copyFiles = {
  targets: [
    {
      src: 'node_modules/@element-hq/element-call-embedded/dist/index.html',
      dest: 'public/element-call',
      transform: injectElementCallTransparentBackground,
    },
    {
      src: [
        'node_modules/@element-hq/element-call-embedded/dist/*',
        '!node_modules/@element-hq/element-call-embedded/dist/index.html',
      ],
      dest: 'public/element-call',
    },
    {
      src: 'public/runtime-config.js',
      dest: '',
    },
    {
      src: 'node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
      dest: '',
      rename: 'pdf.worker.min.js',
    },
    {
      src: 'netlify.toml',
      dest: '',
    },
    {
      src: 'config.mindroom.json',
      dest: '',
      rename: 'config.json',
    },
    {
      src: 'public/manifest.json',
      dest: '',
    },
    {
      src: 'public/res/android',
      dest: 'public/',
    },
    {
      // Locale files live in src/app/locales (the single source of truth,
      // bundle-importable); this copy keeps them fetchable at runtime under
      // public/locales/{{lng}}.json for i18next-http-backend.
      src: 'src/app/locales',
      dest: 'public/',
    },
  ],
};

function serverMatrixSdkCryptoWasm(wasmFilePath) {
  return {
    name: 'vite-plugin-serve-matrix-sdk-crypto-wasm',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestPath = req.url?.split('?')[0];
        if (requestPath === wasmFilePath) {
          const resolvedPath = path.join(
            path.resolve(),
            '/node_modules/@matrix-org/matrix-sdk-crypto-wasm/pkg/matrix_sdk_crypto_wasm_bg.wasm'
          );

          if (fs.existsSync(resolvedPath)) {
            res.setHeader('Content-Type', 'application/wasm');
            res.setHeader('Cache-Control', 'no-cache');

            const fileStream = fs.createReadStream(resolvedPath);
            fileStream.pipe(res);
          } else {
            res.writeHead(404);
            res.end('File not found');
          }
        } else {
          next();
        }
      });
    },
  };
}

function serverRuntimeConfig(runtimeConfigPath) {
  return {
    name: 'vite-plugin-serve-runtime-config',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url === runtimeConfigPath) {
          const resolvedPath = path.join(path.resolve(), 'public/runtime-config.js');

          if (fs.existsSync(resolvedPath)) {
            res.setHeader('Content-Type', 'application/javascript');
            res.setHeader('Cache-Control', 'no-cache');

            const fileStream = fs.createReadStream(resolvedPath);
            fileStream.pipe(res);
          } else {
            res.writeHead(404);
            res.end('File not found');
          }
        } else {
          next();
        }
      });
    },
  };
}

const staleServiceWorkerCleanupScript = `
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if ('caches' in self) {
      const cacheNames = await self.caches.keys();
      await Promise.all(cacheNames.map((cacheName) => self.caches.delete(cacheName)));
    }

    await self.registration.unregister();

    const clients = await self.clients.matchAll({
      type: 'window',
      includeUncontrolled: true,
    });
    await Promise.all(clients.map((client) => client.navigate(client.url)));
  })());
});
`;

function serverStaleServiceWorkerCleanup(serviceWorkerPath) {
  return {
    name: 'vite-plugin-serve-stale-service-worker-cleanup',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const requestPath = req.url?.split('?')[0];
        if (requestPath === serviceWorkerPath) {
          res.setHeader('Content-Type', 'application/javascript');
          res.setHeader('Cache-Control', 'no-store');
          res.end(staleServiceWorkerCleanupScript);
        } else {
          next();
        }
      });
    },
  };
}

const appBasePath =
  buildConfig.base === '/' || buildConfig.base === './' || buildConfig.base === '.'
    ? ''
    : buildConfig.base.replace(/\/+$/g, '');
const matrixCryptoWasmPath =
  appBasePath && appBasePath !== '.'
    ? `${appBasePath}/node_modules/.vite/deps/pkg/matrix_sdk_crypto_wasm_bg.wasm`
    : '/node_modules/.vite/deps/pkg/matrix_sdk_crypto_wasm_bg.wasm';
const defaultAllowedHosts = [
  'chat.lab.mindroom.chat',
  'chat.mindroom.chat',
  'cinny-dev.lab.nijho.lt',
  'localhost',
  '127.0.0.1',
];
const allowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? defaultAllowedHosts.join(','))
  .split(',')
  .map((host) => host.trim())
  .filter(Boolean);

export default defineConfig({
  appType: 'spa',
  publicDir: false,
  base: buildConfig.base,
  server: {
    port: 8080,
    host: true,
    allowedHosts,
    fs: {
      // Allow serving files from one level up to the project root
      allow: ['..'],
    },
  },
  plugins: [
    appVersionManifest(),
    serverRuntimeConfig('/runtime-config.js'),
    serverStaleServiceWorkerCleanup(`${appBasePath}/sw.js`),
    serverMatrixSdkCryptoWasm(matrixCryptoWasmPath),
    topLevelAwait({
      // The export name of top-level await promise for each chunk module
      promiseExportName: '__tla',
      // The function to generate import names of top-level await promise in each chunk module
      promiseImportName: (i) => `__tla_${i}`,
    }),
    viteStaticCopy(copyFiles),
    vanillaExtractPlugin(),
    wasm(),
    react(),
    VitePWA({
      srcDir: 'src',
      filename: 'sw.ts',
      strategies: 'injectManifest',
      injectRegister: false,
      manifest: false,
      injectManifest: {
        injectionPoint: 'self.__WB_MANIFEST',
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globIgnores: ['public/element-call/**', 'runtime-config.js', 'version.json'],
      },
      devOptions: {
        enabled: true,
        type: 'module',
      },
    }),
  ],
  define: {
    __MINDROOM_BUILD_VERSION__: JSON.stringify(buildVersion),
  },
  optimizeDeps: {
    esbuildOptions: {
      define: {
        global: 'globalThis',
      },
      plugins: [
        // Enable esbuild polyfill plugins
        NodeGlobalsPolyfillPlugin({
          process: false,
          buffer: true,
        }),
      ],
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    copyPublicDir: false,
    rollupOptions: {
      plugins: [inject({ Buffer: ['buffer', 'Buffer'] })],
    },
  },
});
