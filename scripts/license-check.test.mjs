// Run with `node --test scripts/license-check.test.mjs` (the `license-check` recipe does).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'license-check.mjs');
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

// Builds a node_modules directory from { 'dir/relative/to/node_modules': package.json object }.
function makeTree(packages) {
  const root = mkdtempSync(path.join(tmpdir(), 'license-check-'));
  roots.push(root);
  const nodeModules = path.join(root, 'node_modules');
  for (const [dir, manifest] of Object.entries(packages)) {
    mkdirSync(path.join(nodeModules, dir), { recursive: true });
    writeFileSync(path.join(nodeModules, dir, 'package.json'), JSON.stringify(manifest));
  }
  return nodeModules;
}

function run(nodeModules, env = {}) {
  const result = spawnSync('node', [script, nodeModules], {
    encoding: 'utf8',
    env: { ...process.env, MINDROOM_CLIENT_PLUGINS: '', ...env },
  });
  return { status: result.status, output: result.stdout + result.stderr };
}

test('rejects GPL, LGPL, and unlicensed packages but accepts MIT and a dual license with an allowed side', () => {
  const nodeModules = makeTree({
    'pkg-mit': { name: 'pkg-mit', version: '1.0.0', license: 'MIT' },
    'pkg-gpl': { name: 'pkg-gpl', version: '2.0.0', license: 'GPL-3.0-only' },
    'pkg-dual': { name: 'pkg-dual', version: '3.0.0', license: '(MIT OR GPL-3.0)' },
    'pkg-lgpl': { name: 'pkg-lgpl', version: '4.0.0', license: 'LGPL-2.1' },
    'pkg-none': { name: 'pkg-none', version: '5.0.0' },
  });
  const { status, output } = run(nodeModules);
  assert.equal(status, 1);
  assert.match(output, /pkg-gpl@2\.0\.0 GPL-3\.0-only/);
  assert.match(output, /pkg-lgpl@4\.0\.0 LGPL-2\.1/);
  assert.match(output, /pkg-none@5\.0\.0 \(no license\)/);
  assert.doesNotMatch(output, /pkg-mit@/);
  assert.doesNotMatch(output, /pkg-dual@/);
});

test('exits 0 and prints nothing per package when every license is allowed', () => {
  const nodeModules = makeTree({
    a: { name: 'a', version: '1.0.0', license: 'Apache-2.0' },
    b: { name: 'b', version: '1.0.0', license: 'BSD-3-Clause' },
    c: { name: 'c', version: '1.0.0', license: '(MIT AND Zlib)' },
    d: { name: 'd', version: '1.0.0', license: '(BSD-2-Clause OR MIT OR Apache-2.0)' },
    e: { name: 'e', version: '1.0.0', license: 'Apache-2.0 WITH LLVM-exception' },
  });
  const { status, output } = run(nodeModules);
  assert.equal(status, 0, output);
  assert.doesNotMatch(output, /[a-e]@1\.0\.0/);
});

test('an AND expression needs both sides allowed', () => {
  const nodeModules = makeTree({
    both: { name: 'both', version: '1.0.0', license: '(MIT AND GPL-2.0-only)' },
  });
  const { status, output } = run(nodeModules);
  assert.equal(status, 1);
  assert.match(output, /both@1\.0\.0/);
});

test('reads the legacy license object and the licenses array (an array means any one of them)', () => {
  const nodeModules = makeTree({
    'legacy-object': { name: 'legacy-object', version: '1.0.0', license: { type: 'ISC' } },
    'legacy-array': {
      name: 'legacy-array',
      version: '1.0.0',
      licenses: [{ type: 'MIT', url: 'x' }],
    },
    'legacy-dual': {
      name: 'legacy-dual',
      version: '1.0.0',
      licenses: [{ type: 'MIT' }, { type: 'GPL-2.0' }],
    },
    'legacy-bad': { name: 'legacy-bad', version: '1.0.0', licenses: [{ type: 'AGPL-3.0' }] },
    'legacy-all-bad': {
      name: 'legacy-all-bad',
      version: '1.0.0',
      licenses: [{ type: 'GPL-2.0' }, { type: 'LGPL-3.0' }],
    },
  });
  const { status, output } = run(nodeModules);
  assert.equal(status, 1);
  assert.match(output, /legacy-bad@1\.0\.0 AGPL-3\.0/);
  assert.match(output, /legacy-all-bad@1\.0\.0/);
  assert.doesNotMatch(output, /legacy-object@/);
  assert.doesNotMatch(output, /legacy-array@/);
  assert.doesNotMatch(output, /legacy-dual@/);
});

test('walks scoped packages and nested node_modules', () => {
  const nodeModules = makeTree({
    '@scope/ok': { name: '@scope/ok', version: '1.0.0', license: 'MIT' },
    '@scope/bad': { name: '@scope/bad', version: '1.0.0', license: 'GPL-3.0-or-later' },
    'host/node_modules/inner-bad': { name: 'inner-bad', version: '9.9.9', license: 'SSPL-1.0' },
    'host/node_modules/@inner/scoped-bad': { name: '@inner/scoped-bad', version: '8.8.8' },
    host: { name: 'host', version: '1.0.0', license: 'MIT' },
  });
  const { status, output } = run(nodeModules);
  assert.equal(status, 1);
  assert.match(output, /@scope\/bad@1\.0\.0 GPL-3\.0-or-later/);
  assert.match(output, /inner-bad@9\.9\.9 SSPL-1\.0/);
  assert.match(output, /@inner\/scoped-bad@8\.8\.8/);
  assert.doesNotMatch(output, /@scope\/ok@/);
  assert.doesNotMatch(output, /host@1\.0\.0/);
});

test('named exceptions pass without a license field, any other unlicensed package still fails', () => {
  const nodeModules = makeTree({
    'require-like': { name: 'require-like', version: '0.1.2' },
    'caniuse-lite': { name: 'caniuse-lite', version: '1.0.30001', license: 'CC-BY-4.0' },
    'not-excepted': { name: 'not-excepted', version: '1.0.0', license: 'CC-BY-4.0' },
  });
  const { status, output } = run(nodeModules);
  assert.equal(status, 1);
  assert.match(output, /not-excepted@1\.0\.0 CC-BY-4\.0/);
  assert.doesNotMatch(output, /require-like@/);
  assert.doesNotMatch(output, /caniuse-lite@/);
});

test('exits 2 when the directory does not exist', () => {
  const { status, output } = run(path.join(tmpdir(), 'license-check-no-such-dir'));
  assert.equal(status, 2);
  assert.match(output, /not a directory/);
});

test('checks the packages each client plugin in MINDROOM_CLIENT_PLUGINS installed', () => {
  const nodeModules = makeTree({ app: { name: 'app', version: '1.0.0', license: 'MIT' } });
  const plugin = path.dirname(
    makeTree({
      'plugin-ok': { name: 'plugin-ok', version: '1.0.0', license: 'MIT' },
      'plugin-gpl': { name: 'plugin-gpl', version: '2.0.0', license: 'GPL-3.0-only' },
    })
  );
  // A second plugin that installed nothing.
  const bare = path.dirname(makeTree({}));
  for (const [dir, id] of [
    [plugin, 'some-plugin'],
    [bare, 'bare-plugin'],
  ]) {
    writeFileSync(
      path.join(dir, 'package.json'),
      JSON.stringify({
        name: id,
        version: '1.0.0',
        mindroomClientPlugin: { id, apiVersion: 1, entry: './index.js' },
      })
    );
    writeFileSync(path.join(dir, 'index.js'), 'export default {};\n');
  }
  assert.equal(run(nodeModules).status, 0);
  const { status, output } = run(nodeModules, { MINDROOM_CLIENT_PLUGINS: `${plugin},${bare}` });
  assert.equal(status, 1);
  assert.match(output, /^plugin-gpl@2\.0\.0 GPL-3\.0-only \(client plugin some-plugin\)$/m);
  assert.doesNotMatch(output, /plugin-ok@/);
  assert.match(output, /1 of 3 packages/);
});
