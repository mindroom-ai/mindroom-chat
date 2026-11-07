import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { createRoom } from '../helpers/createRoom';
import { serveBuild } from '../helpers/staticBuildServer';

// A client plugin's public/ directory ships with the build (scripts/client-plugins.mjs). A
// production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, has the plugin's public/mark.svg at
// /public/plugins/example/mark.svg, and the plugin's banner under the room header shows the mark
// from there, against the disposable homeserver. Set PLUGIN_SHOTS=<directory> to save a screenshot.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const MARK = '/public/plugins/example/mark.svg';
const PASSWORD = 'public-files-password';
const RUN = Date.now().toString(36);
const ROOM_NAME = 'Public files room';

test.use({ viewport: { width: 1280, height: 800 } });

let build: string | undefined;
let seeded: { person: DisposableUser; roomId: string } | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-public-files-build-'));
  const result = spawnSync('npx', ['vite', 'build', '--outDir', build, '--emptyOutDir'], {
    env: { ...process.env, MINDROOM_CLIENT_PLUGINS: PLUGIN },
    encoding: 'utf8',
    timeout: 9 * 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `the build with the plugin failed:\n${(result.stderr || result.stdout).slice(-3000)}`
    );
  }
  const person = await registerDisposableUser(`public_files_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, person.accessToken, { name: ROOM_NAME });
  seeded = { person, roomId };
});

test.afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test("ships the plugin's public files under /public/plugins/<id>/, where its banner shows them", async ({
  browser,
}) => {
  expect(readdirSync(join(build!, 'public/plugins'), { recursive: true }).sort()).toEqual([
    'example',
    'example/mark.svg',
  ]);
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    const response = await page.request.get(MARK);
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toBe('image/svg+xml');
    expect(await response.text()).toBe(readFileSync(join(PLUGIN, 'public/mark.svg'), 'utf8'));

    await loginWithPassword(page, { homeserver: HOMESERVER, ...seeded!.person });
    await page.goto(`/home/${encodeURIComponent(seeded!.roomId)}`);
    const banner = page.locator('[data-example-plugin-banner]');
    await expect(banner).toHaveText(`Example banner in ${ROOM_NAME}`, { timeout: 60_000 });
    const mark = banner.locator('img');
    await expect(mark).toHaveAttribute('src', MARK);
    // Loaded and drawn: an image the server did not answer with the file has no natural width.
    await expect
      .poll(() => mark.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth))
      .toBe(16);
    const directory = process.env.PLUGIN_SHOTS;
    if (directory) await page.screenshot({ path: `${directory}/public-files.png` });
  } finally {
    await context.close();
    await server.close();
  }
});
