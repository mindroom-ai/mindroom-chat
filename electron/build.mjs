// @ts-check
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const outdir = path.join(root, 'build/electron');

/** @type {import('esbuild').BuildOptions} */
const base = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  sourcemap: true,
};

/** @type {Array<[string, string]>} */
const targets = [
  ['electron/main/index.ts', 'main.cjs'],
  ['electron/preload.ts', 'preload.cjs'],
];

await Promise.all(
  targets.map(([entry, out]) =>
    esbuild.build({
      ...base,
      entryPoints: [path.join(root, entry)],
      outfile: path.join(outdir, out),
    })
  )
);
