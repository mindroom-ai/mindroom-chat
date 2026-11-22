// @ts-check
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { CANVAS_LIBRARY_DIR } from '../scripts/canvas-libraries.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const distDir = path.join(root, 'dist');

const CANVAS_FRAME_HTML = [
  '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="robots" content="noindex"><title>Canvas</title></head><body><script>',
  "(() => { if (window.parent === window) return; const origin = 'capacitor://localhost';",
  "const onMessage = (e) => { if (e.source !== window.parent || e.origin !== origin || typeof e.data !== 'string') return;",
  "window.removeEventListener('message', onMessage); document.open(); document.write(e.data); document.close(); };",
  "window.addEventListener('message', onMessage);",
  "window.addEventListener('load', () => window.parent.postMessage('canvas-frame-ready', origin), { once: true }); })();",
  '</script></body></html>',
].join('\n');

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
  define: {
    __MINDROOM_CANVAS_LIBRARIES__: JSON.stringify(CANVAS_LIBRARY_DIR),
  },
  sourcemap: true,
});

if (!fs.existsSync(distDir)) {
  throw new Error(`Missing built web bundle at ${distDir}: run \`npm run build:ios\` first`);
}
fs.writeFileSync(path.join(distDir, 'canvas-frame.html'), CANVAS_FRAME_HTML, 'utf8');
