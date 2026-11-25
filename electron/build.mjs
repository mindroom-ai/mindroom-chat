// @ts-check
import { execFileSync } from 'node:child_process';
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

if (process.platform === 'darwin' && process.env.MINDROOM_SKIP_TRACKPAD_ADDON_BUILD !== '1') {
  const addonOut = path.join(root, 'build/electron/mindroom-trackpad-swipe.node');
  const inputs = [
    path.join(root, 'electron/native/trackpad_swipe.mm'),
    path.join(root, 'scripts/build-trackpad-swipe-addon.sh'),
    path.join(root, 'node_modules/node-api-headers/include/node_api.h'),
  ];
  const outMtime = fs.existsSync(addonOut) ? fs.statSync(addonOut).mtimeMs : 0;
  const stale = inputs.some((file) => !fs.existsSync(file) || fs.statSync(file).mtimeMs > outMtime);
  if (stale) {
    execFileSync('bash', [path.join(root, 'scripts/build-trackpad-swipe-addon.sh')], {
      cwd: root,
      stdio: 'inherit',
    });
  }
}
