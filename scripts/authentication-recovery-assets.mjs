// @ts-check
// Builds the two classic scripts that load before the app bundle (index.html includes
// /runtime-config.js): `runtime-config.js`, the deployment settings bootstrap, and
// `authentication-recovery.js`, the standalone authentication recovery it loads. Both are
// bundled from src/ as self-contained IIFEs so deployments can serve or prepend to them.
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

/** @type {import('esbuild').BuildOptions} */
const common = {
  bundle: true,
  write: false,
  format: 'iife',
  platform: 'browser',
  target: 'es2019',
  legalComments: 'none',
  logLevel: 'silent',
};

/**
 * One classic script from src/ as a self-contained IIFE, returned as text; `options` add to or
 * override the shared settings.
 * @param {import('esbuild').BuildOptions} options
 */
export const bundleClassicScript = async (options) => {
  const result = await build({ ...common, ...options });
  const [output] = result.outputFiles ?? [];
  if (!output) throw new Error('esbuild produced no output');
  return output.text;
};

/** @returns {Promise<Record<'runtime-config.js' | 'authentication-recovery.js', string>>} */
export const buildAuthenticationRecoveryAssets = async () => {
  const [runtimeConfig, authenticationRecovery] = await Promise.all([
    bundleClassicScript({ entryPoints: [path.join(root, 'src/runtimeConfig.ts')] }),
    bundleClassicScript({
      stdin: {
        contents:
          "import { installAuthenticationRecovery } from './src/authenticationRecovery';\n" +
          'installAuthenticationRecovery(window);\n',
        resolveDir: root,
        sourcefile: 'authentication-recovery-entry.ts',
        loader: 'ts',
      },
    }),
  ]);
  return {
    'runtime-config.js': runtimeConfig,
    'authentication-recovery.js': authenticationRecovery,
  };
};

// `node scripts/authentication-recovery-assets.mjs <directory>` writes both files there.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const outDir = path.resolve(process.argv[2] ?? path.join(root, 'dist'));
  await mkdir(outDir, { recursive: true });
  const assets = await buildAuthenticationRecoveryAssets();
  await Promise.all(
    Object.entries(assets).map(([name, text]) => writeFile(path.join(outDir, name), text))
  );
}
