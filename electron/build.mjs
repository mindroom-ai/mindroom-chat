// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));

await esbuild.build({
  entryPoints: {
    main: path.join(root, 'electron/main/index.ts'),
    preload: path.join(root, 'electron/preload.ts'),
  },
  outdir: path.join(root, 'build/electron'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
});
