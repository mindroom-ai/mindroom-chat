import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

// Requires Docker and nginx:alpine. No application build or external login fixture needed.
test('native recovery assets, probe and runtime URL serialization', async () => {
  const probe = '/authentication-recovery-probe?quoted="yes"&slash=\\value';
  const container = execFileSync(
    'docker',
    [
      'run',
      '--rm',
      '-d',
      '-p',
      '127.0.0.1::80',
      '-v',
      `${resolve('docker-nginx.conf')}:/etc/nginx/conf.d/default.conf:ro`,
      '-v',
      `${resolve(
        'public/authentication-recovery.js'
      )}:/usr/share/nginx/html/authentication-recovery.js:ro`,
      '-v',
      `${resolve('index.html')}:/usr/share/nginx/html/index.html:ro`,
      '-v',
      `${resolve(
        'docker-entrypoint.d/99-runtime-config.sh'
      )}:/docker-entrypoint.d/99-runtime-config.sh:ro`,
      '-e',
      `APP_AUTHENTICATION_RECOVERY_PROBE_URL=${probe}`,
      '-e',
      'APP_AUTHENTICATION_RECOVERY_NAVIGATION_URL=/?reconnect=1#thread',
      'nginx:alpine',
    ],
    { encoding: 'utf8' }
  ).trim();
  try {
    const binding = execFileSync('docker', ['port', container, '80/tcp'], {
      encoding: 'utf8',
    }).trim();
    const origin = `http://${binding}`;
    for (let attempt = 0; ; attempt += 1) {
      try {
        await fetch(origin);
        break;
      } catch (error) {
        if (attempt === 30) throw error;
        await new Promise((done) => setTimeout(done, 100));
      }
    }
    for (const prefix of ['', '/chat']) {
      const response = await fetch(`${origin}${prefix}/authentication-recovery-probe`);
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const bootstrap = await fetch(`${origin}${prefix}/authentication-recovery.js`);
      assert.equal(bootstrap.status, 200);
      assert.match(bootstrap.headers.get('content-type'), /javascript/);
      assert.equal(bootstrap.headers.get('cache-control'), 'no-store');
      assert.match(await bootstrap.text(), /__AUTHENTICATION_RECOVERY__/);
      const runtime = await fetch(`${origin}${prefix}/runtime-config.js`);
      assert.equal(runtime.headers.get('cache-control'), 'no-store');
      const runtimeSource = await runtime.text();
      const publicRuntime = readFileSync('public/runtime-config.js', 'utf8');
      assert.equal(
        runtimeSource.slice(runtimeSource.indexOf('\n(function () {')),
        publicRuntime.slice(publicRuntime.indexOf('\n(function () {')),
        'generated and public runtime scripts must use the same recovery loader'
      );
      const scripts = [];
      const window = {};
      runInNewContext(runtimeSource, {
        window,
        URL,
        Promise,
        document: {
          currentScript: { src: `${origin}${prefix}/runtime-config.js` },
          createElement: () => ({}),
          head: { appendChild: (script) => scripts.push(script) },
        },
      });
      assert.equal(window.__AUTHENTICATION_RECOVERY_CONFIG__.probeUrl, probe);
      assert.equal(window.__AUTHENTICATION_RECOVERY_CONFIG__.navigationUrl, '/?reconnect=1#thread');
      assert.equal(scripts[0].src, `${origin}${prefix}/authentication-recovery.js`);
      const nested = await fetch(`${origin}${prefix}/authentication-recovery-probe/child`);
      assert.notEqual(nested.status, 204);
    }
  } finally {
    execFileSync('docker', ['stop', container], { stdio: 'ignore' });
  }
});
