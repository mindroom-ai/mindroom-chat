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

const HASH_RE = /^'sha256-[A-Za-z0-9+/=]+'$/;

/** @param {string} html @param {number} start @param {string} rel */
const parseOpenTag = (html, start, rel) => {
  let i = start;
  const attrs = new Set();
  while (i < html.length && html[i] !== '>') {
    while (i < html.length && /[\s/]/.test(html[i] ?? '')) i += 1;
    if (i >= html.length || html[i] === '>') break;
    const s = i;
    while (i < html.length && !/[\s=/>]/.test(html[i] ?? '')) i += 1;
    const name = html.slice(s, i).toLowerCase();
    if (/^on[a-z]+$/.test(name)) throw new Error(`Inline event handler "${name}" in ${rel}`);
    if (name) attrs.add(name);
    while (i < html.length && /\s/.test(html[i] ?? '')) i += 1;
    if (html[i] !== '=') continue;
    i += 1;
    while (i < html.length && /\s/.test(html[i] ?? '')) i += 1;
    const q = html[i];
    if (q === '"' || q === "'") {
      i = html.indexOf(q, i + 1);
      if (i < 0) throw new Error(`Unclosed attribute quote in ${rel}`);
      i += 1;
    } else while (i < html.length && !/[\s>]/.test(html[i] ?? '')) i += 1;
  }
  if (i >= html.length) throw new Error(`Unclosed tag in ${rel}`);
  return { attrs, end: i + 1 };
};

/** @param {string} html @param {string} rel @returns {string[]} */
export const inlineScriptHashes = (html, rel) => {
  /** @type {string[]} */
  const hashes = [];
  for (let i = 0; i < html.length; ) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) {
      const end = html.indexOf('-->', lt + 4);
      i = end < 0 ? html.length : end + 3;
      continue;
    }
    const m = /^<([a-z][a-z0-9:-]*)(?=[\s/>])/i.exec(html.slice(lt));
    if (!m) {
      i = lt + 1;
      continue;
    }
    const { attrs, end } = parseOpenTag(html, lt + m[0].length, rel);
    if ((m[1] ?? '').toLowerCase() !== 'script') {
      i = end;
      continue;
    }
    const close = /<\/script\s*>/i.exec(html.slice(end));
    if (!close) throw new Error(`Unclosed <script> tag in ${rel}`);
    if (!attrs.has('src')) {
      const body = html.slice(end, end + close.index).replace(/\r\n?/g, '\n');
      hashes.push(`'sha256-${crypto.createHash('sha256').update(body, 'utf8').digest('base64')}'`);
    }
    i = end + close.index + close[0].length;
  }
  return hashes;
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

/** @param {string} dir @param {string} manifestPath */
export const verifyScriptHashes = (dir, manifestPath) => {
  /** @type {Record<string, unknown>} */
  const written = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  for (const rel of collectHtmlFiles(dir).filter((f) => f !== 'canvas-frame.html')) {
    const expected = inlineScriptHashes(fs.readFileSync(path.join(dir, rel), 'utf8'), rel);
    const listed = written[rel];
    if (
      !Array.isArray(listed) ||
      listed.length !== expected.length ||
      expected.some((hash, idx) => !HASH_RE.test(String(listed[idx])) || listed[idx] !== hash)
    )
      throw new Error(`Script hash mismatch in script-hashes.json for ${rel}`);
  }
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
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
  const manifest = Object.fromEntries(
    htmlFiles.map((rel) => [
      rel,
      inlineScriptHashes(fs.readFileSync(path.join(distDir, rel), 'utf8'), rel),
    ])
  );
  const manifestPath = path.join(distDir, 'script-hashes.json');
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  verifyScriptHashes(distDir, manifestPath);
}
