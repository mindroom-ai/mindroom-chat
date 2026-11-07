import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { logoutActiveAccount } from '../helpers/accounts';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. The plugin's storage notes
// each greeting an account saw, and a greeting seen in an earlier page load shows "Seen before".
// When Alice signs out, the app deletes her plugin storage, which the plugin's component in neither
// of her tabs writes back as it unmounts, and asks the plugin to forget her: Bob, signing in next
// in the same browser, finds nothing of hers, and neither does Alice when she signs in again. Set
// PLUGIN_SHOTS=<directory> to save screenshots.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'plugin-storage-password';
const RUN = Date.now().toString(36);
const GREETING = 'Hello from the example plugin';

test.use({ viewport: { width: 1280, height: 800 } });

let build: string | undefined;
let alice: DisposableUser;
let bob: DisposableUser;
let threadPath = '';
let replyId = '';

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-storage-build-'));
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

  alice = await registerDisposableUser(`plugin_alice_${RUN}`, PASSWORD);
  bob = await registerDisposableUser(`plugin_bob_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'greeter');
  const roomId = await createRoom(HOMESERVER, alice.accessToken, {
    name: 'Plugin storage room',
    invite: [agent.userId, bob.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await joinRoom(HOMESERVER, bob.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, alice.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Greet me, please.',
  });
  replyId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Plain body of the agent reply',
    'com.example.greeting': { text: GREETING },
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  });
  threadPath = `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`;
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

/** Opens the thread and, once the plugin renders the agent's reply, returns its "Seen before". */
const openSeenMark = async (page: Page) => {
  await page.goto(threadPath);
  const reply = page.locator(`[data-message-id="${replyId}"]`);
  await expect(reply.locator('[data-example-plugin]')).toHaveText(`Example plugin: ${GREETING}`, {
    timeout: 60_000,
  });
  return reply.locator('[data-example-plugin-seen]');
};

/** The localStorage keys of the plugin values kept for `userId`. */
const pluginKeysOf = (page: Page, userId: string) =>
  page.evaluate(
    (prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
    `mindroom.plugin:${encodeURIComponent(userId)}/`
  );

test("signing out deletes the account's plugin storage and the plugin forgets the account", async ({
  browser,
}) => {
  test.setTimeout(4 * 60_000);
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...alice });
    await expect(await openSeenMark(page)).toHaveCount(0);
    await expect.poll(() => pluginKeysOf(page, alice.userId)).toHaveLength(1);

    // The plugin keeps what it stored for Alice across page loads.
    await expect(await openSeenMark(page)).toHaveText('Seen before');
    await shot(page, 'alice-seen-before');
    // A second tab shows it too; its plugin component saves again as the logout unmounts it.
    const other = await context.newPage();
    await expect(await openSeenMark(other)).toHaveText('Seen before');

    // The last logout deletes the account's local data, then reloads the app.
    const reloaded = page.waitForEvent('load');
    await logoutActiveAccount(page);
    await reloaded;
    await expect(other).toHaveURL(/\/login\//, { timeout: 60_000 });
    await other.close();
    expect(await pluginKeysOf(page, alice.userId)).toEqual([]);
    expect(await page.evaluate(() => sessionStorage.getItem('example-plugin.forgot'))).toBe(
      alice.userId
    );
    // A value another tab wrote for her past its check as she signed out goes when the app starts.
    await page.evaluate(
      (key) => localStorage.setItem(key, 'Raced'),
      `mindroom.plugin:${encodeURIComponent(alice.userId)}/example/raced`
    );
    await page.reload();
    expect(await pluginKeysOf(page, alice.userId)).toEqual([]);

    await loginWithPassword(page, { homeserver: HOMESERVER, ...bob });
    await expect(await openSeenMark(page)).toHaveCount(0);
    await shot(page, 'bob-after-alice');

    // Alice, back in the same browser, starts over too.
    await chooseFromAccountMenu(page, 'Add Account');
    await loginWithPassword(page, { homeserver: HOMESERVER, ...alice, addAccount: true });
    await expect(await openSeenMark(page)).toHaveCount(0);
    await shot(page, 'alice-again');
  } finally {
    await context.close();
    await server.close();
  }
});
