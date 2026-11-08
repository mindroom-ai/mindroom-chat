import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
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

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. The example's slot under the
// room header names the thread the room shows (`useShownThread`): nothing in the room's timeline,
// the thread's root once the thread opens from the room's thread list, the same root when a link
// to a reply in the thread opens it, and nothing again each time the thread's Back leads to the
// room's timeline; on a wide screen and on a phone. Set PLUGIN_SHOTS=<directory> to save screenshots.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'plugin-shown-thread-password';
const RUN = Date.now().toString(36);
const ROOM = `Shown thread ${RUN}`;
const QUESTION = 'Which thread is this?';
const ANSWER = 'The one this reply is in';

let build: string | undefined;
let alice: DisposableUser;
let roomId = '';
let root = '';
let reply = '';

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-shown-thread-build-'));
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

  alice = await registerDisposableUser(`shown_alice_${RUN}`, PASSWORD);
  roomId = await createRoom(HOMESERVER, alice.accessToken, { name: ROOM });
  root = await sendRoomMessage(HOMESERVER, alice.accessToken, roomId, {
    msgtype: 'm.text',
    body: QUESTION,
  });
  reply = await sendRoomMessage(HOMESERVER, alice.accessToken, roomId, {
    msgtype: 'm.text',
    body: ANSWER,
    'm.relates_to': { rel_type: 'm.thread', event_id: root },
  });
});

test.afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const shot = async (page: Page, name: string) => {
  const directory = process.env.PLUGIN_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};

const slot = (page: Page) => page.locator('[data-example-plugin-banner]');
const named = (page: Page) => page.locator('[data-example-plugin-thread]');
const threadBanner = (page: Page) => page.locator('[data-thread-context-banner]');

/** Leaves the thread by its Back, for the room's timeline, where the slot names no thread. */
const exitThread = async (page: Page) => {
  await threadBanner(page).getByRole('button').first().click();
  await expect(threadBanner(page)).toHaveCount(0);
  await expect(slot(page)).toBeVisible();
  await expect(named(page)).toHaveCount(0);
};

for (const { size, viewport } of [
  { size: 'wide', viewport: { width: 1280, height: 800 } },
  { size: 'phone', viewport: { width: 390, height: 844 } },
]) {
  test(`the example's header slot names the thread the room shows (${size})`, async ({
    browser,
  }) => {
    test.setTimeout(5 * 60_000);
    const server = await serveBuild(build!);
    const context = await browser.newContext({ baseURL: server.origin, viewport });
    const page = await context.newPage();
    try {
      await loginWithPassword(page, { homeserver: HOMESERVER, ...alice });
      const roomPath = `/home/${encodeURIComponent(roomId)}`;
      await page.goto(roomPath);
      await expect(slot(page)).toContainText(`Example banner in ${ROOM}`, { timeout: 60_000 });
      await expect(page.getByText(QUESTION).first()).toBeVisible({ timeout: 60_000 });
      await expect(named(page)).toHaveCount(0);
      await shot(page, `${size}-timeline`);

      // Opened from the room's thread list, the thread's root.
      await page.locator(`[data-thread-root-id="${root}"]`).first().click();
      await expect(threadBanner(page)).toBeVisible({ timeout: 30_000 });
      await expect(named(page)).toHaveText(`Thread: ${root}`, { timeout: 30_000 });
      await shot(page, `${size}-thread`);

      // Back in the room's timeline, none.
      await exitThread(page);

      // A link to a reply in the thread, opened as the page, names the thread's root.
      await page.goto(`${roomPath}?threadId=${encodeURIComponent(reply)}`);
      await expect(threadBanner(page)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByText(ANSWER).first()).toBeVisible({ timeout: 30_000 });
      await expect(named(page)).toHaveText(`Thread: ${root}`, { timeout: 30_000 });
      await shot(page, `${size}-reply-link`);

      await exitThread(page);
      await shot(page, `${size}-back`);
    } finally {
      await context.close();
      await server.close();
    }
  });
}
