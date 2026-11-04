// @ts-check
// Vite plugin for the files the app loads outside its module graph:
// - `runtime-config.js` and `authentication-recovery.js` (index.html includes /runtime-config.js,
//   which loads the other), built by scripts/authentication-recovery-assets.mjs;
// - `version.json`, the published build version src/appVersion.ts polls for updates;
// - the `__MINDROOM_BUILD_VERSION__` and `__MINDROOM_RELEASE_VERSION__` constants
//   src/appVersion.ts reads, from scripts/build-version.mjs.
// `vite build` writes the three files into the output. The dev server answers the two scripts,
// plus `/sw.js` bundled from src/sw.ts with an empty precache, so the service worker registers
// as it does in a build.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildAuthenticationRecoveryAssets,
  bundleClassicScript,
} from './authentication-recovery-assets.mjs';
import { readBuildVersion, readReleaseVersion } from './build-version.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

/** The development service worker: src/sw.ts as a classic script with nothing to precache. */
const buildDevelopmentServiceWorker = () =>
  bundleClassicScript({
    entryPoints: [path.join(root, 'src/sw.ts')],
    target: 'es2022',
    define: {
      'self.__WB_MANIFEST': '[]',
      // No build inventory: the development worker keeps what it serves in its own cache.
      'self.__MINDROOM_BUILD_INVENTORY': 'undefined',
      'process.env.NODE_ENV': '"production"',
    },
  });

/**
 * @param {Record<string, string | undefined>} [env]
 * @returns {import('vite').Plugin}
 */
export const mindroomBuildAssets = (env = process.env) => {
  const buildVersion = readBuildVersion(env, root);
  const releaseVersion = readReleaseVersion(env, root);

  return {
    name: 'mindroom-build-assets',
    config: () => ({
      define: {
        // Without a version (no Git, no provider variables) src/appVersion.ts reports
        // `development-build`.
        ...(buildVersion ? { __MINDROOM_BUILD_VERSION__: JSON.stringify(buildVersion) } : {}),
        __MINDROOM_RELEASE_VERSION__: JSON.stringify(releaseVersion),
      },
    }),
    async generateBundle() {
      const assets = await buildAuthenticationRecoveryAssets();
      Object.entries(assets).forEach(([fileName, source]) => {
        this.emitFile({ type: 'asset', fileName, source });
      });
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: `${JSON.stringify({ version: buildVersion ?? null, release: releaseVersion })}\n`,
      });
    },
    configureServer(server) {
      /** @type {Record<string, () => Promise<string>>} */
      const scripts = {
        '/runtime-config.js': async () =>
          (await buildAuthenticationRecoveryAssets())['runtime-config.js'],
        '/authentication-recovery.js': async () =>
          (await buildAuthenticationRecoveryAssets())['authentication-recovery.js'],
        '/sw.js': buildDevelopmentServiceWorker,
      };
      server.middlewares.use((req, res, next) => {
        const [pathname = ''] = (req.url ?? '').split('?');
        const script = Object.hasOwn(scripts, pathname) ? scripts[pathname] : undefined;
        if (!script) {
          next();
          return;
        }
        // Built per request so edits to src/ apply on the next load.
        script().then(
          (source) => {
            res.setHeader('Content-Type', 'text/javascript');
            res.setHeader('Cache-Control', 'no-store');
            res.end(source);
          },
          (error) => next(error)
        );
      });
    },
  };
};
