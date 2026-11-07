// @ts-check
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { thirdPartyNotices } from './third-party-notices.mjs';

const root = mkdtempSync(join(tmpdir(), 'third-party-notices-'));
after(() => rmSync(root, { recursive: true, force: true }));
const lockFile = join(root, 'package-lock.json');

/**
 * Installs a package under `path` with a manifest and the given root files.
 * @param {string} path
 * @param {object} manifest
 * @param {Record<string, string>} [files]
 */
const install = (path, manifest, files = {}) => {
  mkdirSync(join(root, path), { recursive: true });
  writeFileSync(join(root, path, 'package.json'), JSON.stringify(manifest));
  Object.entries(files).forEach(([name, text]) => writeFileSync(join(root, path, name), text));
};

const MIT = 'MIT License\r\n\r\nCopyright (c) Alice\r\n\r\n';
install(
  'node_modules/zeta',
  { license: 'MIT', repository: 'git+https://github.com/a/zeta.git' },
  {
    LICENSE: MIT,
  }
);
install(
  'node_modules/alpha',
  { license: 'Apache-2.0', repository: 'git@github.com:a/alpha' },
  {
    'LICENSE.md': 'Apache text',
    NOTICE: 'Alpha notice',
    'README.md': 'not a notice',
  }
);
// The same version again, nested: listed once.
install('node_modules/alpha/node_modules/zeta', { license: 'MIT' }, { LICENSE: MIT });
install('node_modules/bare', { license: 'ISC', author: { name: 'Bob' }, repository: 'a/bare' });
install('node_modules/tooling', { license: 'MIT' }, { LICENSE: 'Dev only' });
install('node_modules/@types/thing', { license: 'MIT' }, { LICENSE: 'Types only' });
writeFileSync(
  lockFile,
  JSON.stringify({
    lockfileVersion: 3,
    packages: {
      '': { name: 'app' },
      'node_modules/zeta': { version: '1.0.0', license: 'MIT' },
      'node_modules/alpha': { version: '2.0.0', license: 'Apache-2.0' },
      'node_modules/alpha/node_modules/zeta': { version: '1.0.0', license: 'MIT' },
      'node_modules/bare': { version: '0.1.0', license: 'ISC' },
      'node_modules/tooling': { version: '3.0.0', dev: true, license: 'MIT' },
      'node_modules/@types/thing': { version: '1.0.0', devOptional: true, license: 'MIT' },
    },
  })
);

test('lists production packages once, sorted, with their license and notice files', () => {
  const notices = thirdPartyNotices(root, []);
  const names = [...notices.matchAll(/^={80}\n(.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(names, ['alpha 2.0.0', 'bare 0.1.0', 'zeta 1.0.0']);
  assert.match(
    notices,
    /alpha 2\.0\.0\nLicense: Apache-2\.0\nSource: https:\/\/github\.com\/a\/alpha\n/
  );
  assert.match(notices, /File LICENSE\.md:\n\nApache text\n\nFile NOTICE:\n\nAlpha notice/);
  assert.match(
    notices,
    /Source: https:\/\/github\.com\/a\/zeta\n\nFile LICENSE:\n\nMIT License\n\nCopyright \(c\) Alice\n/
  );
  assert.ok(!notices.includes('not a notice') && !notices.includes('\r'));
  assert.ok(!notices.includes('Dev only') && !notices.includes('Types only'));
});

test('says when a package ships no license file, and names a text it already printed', () => {
  install('node_modules/zulu', { license: 'MIT' }, { 'LICENSE.txt': MIT });
  const lock = JSON.parse(readFileSync(lockFile, 'utf8'));
  lock.packages['node_modules/zulu'] = { version: '1.0.0', license: 'MIT' };
  writeFileSync(lockFile, JSON.stringify(lock));

  const notices = thirdPartyNotices(root, []);
  assert.match(
    notices,
    /bare 0\.1\.0\nLicense: ISC\nSource: https:\/\/github\.com\/a\/bare\n\nThe package ships no license file; .* by Bob\./
  );
  assert.match(
    notices,
    /zulu 1\.0\.0\nLicense: MIT\n\nFile LICENSE\.txt: the same text as zeta 1\.0\.0's LICENSE above\./
  );
  assert.equal(thirdPartyNotices(root, []), notices);
});

test("adds the installed production packages of each client plugin's package-lock.json", () => {
  const plugin = join(root, 'plugin');
  install('plugin/node_modules/own-dep', { license: 'MIT' }, { LICENSE: 'Own dep license' });
  install('plugin/node_modules/own-tool', { license: 'MIT' }, { LICENSE: 'Plugin dev only' });
  // The app's zeta 1.0.0 again: listed once.
  install('plugin/node_modules/zeta', { license: 'MIT' }, { LICENSE: MIT });
  // A package the app shares, installed as a peer dependency: the bundle takes the app's.
  install('plugin/node_modules/react', { license: 'MIT' }, { LICENSE: 'Plugin copy of react' });
  writeFileSync(
    join(plugin, 'package-lock.json'),
    JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'some-plugin' },
        'node_modules/own-dep': { version: '0.2.0', license: 'MIT' },
        'node_modules/own-tool': { version: '1.0.0', dev: true, license: 'MIT' },
        'node_modules/zeta': { version: '1.0.0', license: 'MIT' },
        'node_modules/react': { version: '18.3.1', peer: true, license: 'MIT' },
        // A peer dependency left out of the install (npm ci --omit=peer).
        'node_modules/left-out': { version: '1.0.0', peer: true, license: 'MIT' },
      },
    })
  );

  const notices = thirdPartyNotices(root, [plugin]);
  const names = [...notices.matchAll(/^={80}\n(.+)$/gm)].map((match) => match[1]);
  assert.deepEqual(names, [
    'alpha 2.0.0',
    'bare 0.1.0',
    'own-dep 0.2.0',
    'zeta 1.0.0',
    'zulu 1.0.0',
  ]);
  assert.match(notices, /own-dep 0\.2\.0\nLicense: MIT\n\nFile LICENSE:\n\nOwn dep license\n/);
  assert.ok(!notices.includes('Plugin dev only') && !notices.includes('Plugin copy of react'));
});

test('fails for a client plugin that installed packages without a package-lock.json', () => {
  install('unlocked-plugin/node_modules/own-dep', { license: 'MIT' });
  const plugin = join(root, 'unlocked-plugin');
  assert.throws(
    () => thirdPartyNotices(root, [plugin]),
    new RegExp(
      `^Error: MINDROOM_CLIENT_PLUGINS: ${plugin}: has node_modules but no package-lock\\.json`
    )
  );
  // A plugin that installed nothing needs none, even with a tool's cache in node_modules.
  mkdirSync(join(root, 'bare-plugin/node_modules/.cache'), { recursive: true });
  assert.doesNotThrow(() => thirdPartyNotices(root, [join(root, 'bare-plugin')]));
});

test('fails for a lockfile without its packages, naming it', () => {
  const plugin = join(root, 'old-lock-plugin');
  mkdirSync(plugin);
  writeFileSync(join(plugin, 'package-lock.json'), JSON.stringify({ lockfileVersion: 1 }));
  assert.throws(
    () => thirdPartyNotices(root, [plugin]),
    new RegExp(`^Error: ${join(plugin, 'package-lock\\.json')} lists no "packages"`)
  );
});
