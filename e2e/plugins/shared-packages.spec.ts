import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { createRoom } from '../helpers/createRoom';
import { sendRoomMessage } from '../helpers/matrix';
import { serveBuild } from '../helpers/staticBuildServer';

// Client plugins share the app's React, Matrix SDK and state libraries (SHARED_PACKAGES in
// scripts/client-plugins.mjs). A production build with a plugin in a directory outside the app,
// which installed a stand-in matrix-js-sdk for its tests and one dependency of its own: its renderer
// uses React hooks, TanStack Query's client, matrix-js-sdk and the app's Matrix client, and renders
// a person's thread reply; the notices the build ships list its own dependency, and the bundle
// report its size. A build with a plugin that lists jotai under dependencies fails, naming the
// plugin and jotai. Set PLUGIN_SHOTS=<directory> to save screenshots and the bundle report.
const PASSWORD = 'shared-packages-password';
const RUN = Date.now().toString(36);
const SHARED_TEXT = 'Rendered with the shared packages';
const OWN_DEP_LICENSE = 'The license text of the plugin-own-dep package.';

test.use({ viewport: { width: 1280, height: 800 } });
test.describe.configure({ mode: 'serial' });

const madeDirs: string[] = [];
test.afterAll(() => madeDirs.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

const tempDir = (prefix: string): string => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  madeDirs.push(dir);
  return dir;
};

/**
 * A plugin directory with this id, entry code, files besides (relative path to contents) and
 * package.json fields.
 */
const plugin = (
  id: string,
  entry: string,
  files: Record<string, string> = {},
  manifest: Record<string, unknown> = {}
): string => {
  const dir = tempDir(`mindroom-plugin-${id}-`);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: `${id}-plugin`,
      version: '1.0.0',
      mindroomClientPlugin: { id, apiVersion: 1, entry: './index.js' },
      ...manifest,
    })
  );
  writeFileSync(join(dir, 'index.js'), entry);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
};

/** Runs the production build, with source maps, with the plugin in `dir` into `outDir`. */
const buildWith = (dir: string, outDir: string) =>
  spawnSync('npx', ['vite', 'build', '--outDir', outDir, '--emptyOutDir', '--sourcemap'], {
    env: { ...process.env, MINDROOM_CLIENT_PLUGINS: dir },
    encoding: 'utf8',
    timeout: 9 * 60_000,
  });

// React hooks, TanStack Query's client and matrix-js-sdk from the app, and the app's Matrix client
// through its own hook (src/app/matrix/hooks/useMatrixClient.ts), by its path in this checkout.
const sharedEntry = `import { createElement, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { MatrixClient } from 'matrix-js-sdk';
import { useMatrixClient } from ${JSON.stringify(
  resolve('src/app/matrix/hooks/useMatrixClient.ts')
)};
import { label } from 'plugin-own-dep';

function Shared({ event }) {
  const mx = useMatrixClient();
  const queryClient = useQueryClient();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return createElement(
    'div',
    { 'data-shared-plugin': '' },
    [
      event.content['com.example.shared'],
      'viewer ' + mx.getUserId(),
      mx instanceof MatrixClient ? 'one Matrix SDK' : 'two Matrix SDKs',
      queryClient.getQueryCache() ? 'the app query client' : 'no query client',
      mounted ? 'effect ran' : 'effect pending',
      label,
    ].join(' | ')
  );
}

export default {
  messageRenderers: [
    {
      trust: 'server',
      match: (event) => typeof event.content['com.example.shared'] === 'string',
      Component: Shared,
    },
  ],
};
`;

let build: string | undefined;
let sharedPlugin: string | undefined;
let seeded: { person: DisposableUser; roomId: string; rootId: string; replyId: string } | undefined;

test.beforeAll(async () => {
  test.setTimeout(10 * 60_000);
  sharedPlugin = plugin('shared', sharedEntry, {
    'node_modules/plugin-own-dep/package.json': JSON.stringify({
      name: 'plugin-own-dep',
      version: '1.0.0',
      license: 'MIT',
      main: 'index.js',
    }),
    'node_modules/plugin-own-dep/index.js': "export const label = 'own dependency';\n",
    'node_modules/plugin-own-dep/LICENSE': OWN_DEP_LICENSE,
    // Installed for the plugin's tests; the build gives the plugin the app's.
    'node_modules/matrix-js-sdk/package.json': JSON.stringify({
      name: 'matrix-js-sdk',
      version: '0.0.1',
      main: 'index.js',
    }),
    'node_modules/matrix-js-sdk/index.js': 'export class MatrixClient {}\n',
    'package-lock.json': JSON.stringify({
      lockfileVersion: 3,
      packages: {
        '': { name: 'shared-plugin', dependencies: { 'plugin-own-dep': '1.0.0' } },
        'node_modules/plugin-own-dep': { version: '1.0.0', license: 'MIT' },
        'node_modules/matrix-js-sdk': { version: '0.0.1', dev: true },
      },
    }),
  });
  build = tempDir('mindroom-shared-packages-build-');
  const result = buildWith(sharedPlugin, build);
  if (result.status !== 0) {
    throw new Error(
      `the build with the plugin failed:\n${(result.stderr || result.stdout).slice(-3000)}`
    );
  }
  if (!(await disposableHomeserverIsUp())) return;
  const person = await registerDisposableUser(`shared_packages_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, person.accessToken, { name: 'Shared packages room' });
  const rootId = await sendRoomMessage(HOMESERVER, person.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'A thread for the plugin.',
  });
  const replyId = await sendRoomMessage(HOMESERVER, person.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Plain body of the reply',
    'com.example.shared': SHARED_TEXT,
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  });
  seeded = { person, roomId, rootId, replyId };
});

test("the notices the build ships list the plugin's own dependency", () => {
  const notices = readFileSync(join(build!, 'public/licenses/THIRD_PARTY_NOTICES.txt'), 'utf8');
  expect(notices).toContain(
    `plugin-own-dep 1.0.0\nLicense: MIT\n\nFile LICENSE:\n\n${OWN_DEP_LICENSE}`
  );
});

test("the bundle report gives the plugin's minified and gzip size", () => {
  const out = join(build!, 'bundle-report.json');
  const result = spawnSync(
    process.execPath,
    ['scripts/perf/bundle-report.mjs', build!, '--json', out],
    { env: { ...process.env, MINDROOM_CLIENT_PLUGINS: sharedPlugin! }, encoding: 'utf8' }
  );
  expect(result.status, result.stderr).toBe(0);
  const directory = process.env.PLUGIN_SHOTS;
  if (directory) {
    mkdirSync(directory, { recursive: true });
    writeFileSync(`${directory}/bundle-report.txt`, result.stdout);
  }
  const { summary } = JSON.parse(readFileSync(out, 'utf8')) as {
    summary: { clientPlugins: Record<string, { raw: number; gzip: number }> };
  };
  expect(summary.clientPlugins.shared?.raw).toBeGreaterThan(0);
  expect(summary.clientPlugins.shared?.gzip).toBeGreaterThan(0);
  expect(result.stdout).toMatch(/\nClient plugins .*\n.*\nshared\s+\d+\.\d KiB\s+\d+\.\d KiB\n/);
});

test("a plugin's renderer uses React hooks, the app's Matrix client and its query client", async ({
  browser,
}) => {
  test.skip(!seeded, `No homeserver at ${HOMESERVER}`);
  const { person, roomId, rootId, replyId } = seeded!;
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...person });
    await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
    await expect(page.locator(`[data-message-id="${replyId}"] [data-shared-plugin]`)).toHaveText(
      [
        SHARED_TEXT,
        `viewer ${person.userId}`,
        'one Matrix SDK',
        'the app query client',
        'effect ran',
        'own dependency',
      ].join(' | '),
      { timeout: 60_000 }
    );
    const directory = process.env.PLUGIN_SHOTS;
    if (directory) await page.screenshot({ path: `${directory}/shared-packages.png` });
  } finally {
    await context.close();
    await server.close();
  }
});

test('a plugin that lists a shared package under dependencies fails the build, naming both', () => {
  const ownCopy = plugin(
    'own-jotai',
    "import { atom } from 'jotai';\nexport default { atom };\n",
    {},
    { dependencies: { jotai: '^2.0.0' } }
  );
  cpSync(resolve('node_modules/jotai'), join(ownCopy, 'node_modules/jotai'), { recursive: true });
  const result = buildWith(ownCopy, tempDir('mindroom-own-copy-build-'));
  expect(result.status).not.toBe(0);
  expect(`${result.stdout}\n${result.stderr}`).toContain(
    `MINDROOM_CLIENT_PLUGINS: ${ownCopy}: plugin "own-jotai" lists jotai under dependencies, but every plugin gets the app's jotai: list it under peerDependencies instead`
  );
});
