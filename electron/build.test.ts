import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inlineScriptHashes, verifyScriptHashes } from './build.mjs';

const sha256 = (text: string): string =>
  `'sha256-${crypto.createHash('sha256').update(text, 'utf8').digest('base64')}'`;

describe('electron/build script hashing', () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('hashes inline scripts with data-src and preserves comment-like strings inside script bodies', () => {
    const bodyA = 'console.log(1);';
    const bodyB = 'const marker = "<!-- not a comment -->";';
    const html = [
      '<!doctype html><html><head>',
      '<!-- <script>ignored()</script> -->',
      '<script src="/assets/app.js"></script>',
      `<script data-src="/not-external.js">${bodyA}</script>`,
      `<script type="text/javascript">${bodyB}</script>`,
      '</head><body></body></html>',
    ].join('\n');

    expect(inlineScriptHashes(html, 'index.html')).toEqual([sha256(bodyA), sha256(bodyB)]);
  });

  it('fails on inline event handler attributes in built HTML', () => {
    expect(() =>
      inlineScriptHashes('<!doctype html><img src="x" onerror="alert(1)">', 'index.html')
    ).toThrow(/inline event handler|onerror/i);
    expect(() =>
      inlineScriptHashes('<!doctype html><body ONLOAD="init()"></body>', 'index.html')
    ).toThrow(/inline event handler|onload/i);
    expect(() =>
      inlineScriptHashes('<!doctype html><script onclick="x()">1</script>', 'index.html')
    ).toThrow(/inline event handler|onclick/i);
  });

  it('fails on unclosed script tags', () => {
    expect(() => inlineScriptHashes('<script>const x = 1;', 'index.html')).toThrow(/unclosed/i);
  });

  it('verifies script-hashes.json independently and rejects missing or extra hashes', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mindroom-hashes-'));
    tempDirs.push(dir);
    const body = 'window.__ok = 1;';
    fs.writeFileSync(path.join(dir, 'index.html'), `<script>${body}</script>`, 'utf8');
    fs.writeFileSync(path.join(dir, 'canvas-frame.html'), '<script>loader()</script>', 'utf8');
    const manifestPath = path.join(dir, 'script-hashes.json');

    fs.writeFileSync(manifestPath, JSON.stringify({ 'index.html': [sha256(body)] }), 'utf8');
    expect(() => verifyScriptHashes(dir, manifestPath)).not.toThrow();

    fs.writeFileSync(manifestPath, JSON.stringify({ 'index.html': [] }), 'utf8');
    expect(() => verifyScriptHashes(dir, manifestPath)).toThrow();

    fs.writeFileSync(
      manifestPath,
      JSON.stringify({ 'index.html': [sha256(body), sha256('extra')] }),
      'utf8'
    );
    expect(() => verifyScriptHashes(dir, manifestPath)).toThrow();
  });
});
