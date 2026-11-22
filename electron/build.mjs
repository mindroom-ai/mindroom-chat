// @ts-check
import crypto from 'node:crypto';
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

/** @param {string} html @param {string} rel */
const inlineScriptHashes = (html, rel) => {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, '');
  const matches = [...stripped.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  if (matches.length !== (stripped.match(/<script\b/gi) ?? []).length) {
    throw new Error(`Unclosed <script> tag in ${rel}`);
  }
  return matches
    .filter(([, attrs = '']) => !/\bsrc\s*=/i.test(attrs))
    .map(([, , body = '']) => {
      const digest = crypto
        .createHash('sha256')
        .update(body.replace(/\r\n?/g, '\n'), 'utf8')
        .digest('base64');
      return `'sha256-${digest}'`;
    });
};

/** @param {string} dir @param {string} prefix @returns {string[]} */
const collectHtmlFiles = (dir, prefix = '') =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => {
      const rel = prefix ? `${prefix}/${e.name}` : e.name;
      if (e.isDirectory()) return collectHtmlFiles(path.join(dir, e.name), rel);
      return e.isFile() && e.name.endsWith('.html') ? [rel] : [];
    })
    .sort();

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

const htmlFiles = collectHtmlFiles(distDir).filter((rel) => rel !== 'canvas-frame.html');
/** @type {Record<string, string[]>} */
const manifest = Object.fromEntries(
  htmlFiles.map((rel) => [
    rel,
    inlineScriptHashes(fs.readFileSync(path.join(distDir, rel), 'utf8'), rel),
  ])
);
const manifestPath = path.join(distDir, 'script-hashes.json');
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

/** @type {Record<string, string[]>} */
const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
for (const rel of htmlFiles) {
  const expected = inlineScriptHashes(fs.readFileSync(path.join(distDir, rel), 'utf8'), rel);
  if (!Array.isArray(written[rel]) || expected.some((hash) => !written[rel]?.includes(hash))) {
    throw new Error(`Inline script hash missing in script-hashes.json for ${rel}`);
  }
}
