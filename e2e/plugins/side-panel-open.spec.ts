import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { logoutActiveAccount, switchToStoredUsername } from '../helpers/accounts';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import { roomMoreOptions } from '../helpers/roomMenu';
import { showRoom } from '../helpers/sidePanels';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. Each greeting card of the
// plugin opens the plugin's side panel from the plugin's code with the greeting as its request,
// which the panel shows; a second card's request replaces the first. The panel remembers it is
// open: a reload and a switch to another room and back keep it open in its room, with its request,
// and only there. Another account in the same browser never sees it, and signing out deletes it.
// Set PLUGIN_SHOTS=<directory> to save screenshots.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'plugin-panel-password';
const RUN = Date.now().toString(36);
const ROOM = `Panel requests ${RUN}`;
const ELSEWHERE = `Elsewhere ${RUN}`;

test.use({ viewport: { width: 1600, height: 1000 } });

let build: string | undefined;
let alice: DisposableUser;
let bob: DisposableUser;
let threadPath = '';
const greetings: { id: string; text: string }[] = [];

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-panel-open-build-'));
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

  alice = await registerDisposableUser(`panel_alice_${RUN}`, PASSWORD);
  bob = await registerDisposableUser(`panel_bob_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'greeter');
  const roomId = await createRoom(HOMESERVER, alice.accessToken, {
    name: ROOM,
    invite: [agent.userId, bob.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await joinRoom(HOMESERVER, bob.accessToken, roomId);
  await createRoom(HOMESERVER, alice.accessToken, { name: ELSEWHERE });
  const rootId = await sendRoomMessage(HOMESERVER, alice.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Greet me twice, please.',
  });
  for (const text of ['Good morning', 'Good evening']) {
    // eslint-disable-next-line no-await-in-loop
    const id = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: text,
      'com.example.greeting': { text },
      'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
    });
    greetings.push({ id, text });
  }
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

const panel = (page: Page) => page.getByRole('region', { name: 'Example panel', exact: true });

/** The greeting card of the agent's reply `index`, once the plugin renders it. */
const card = async (page: Page, index: number) => {
  const greeting = greetings[index]!;
  const reply = page.locator(`[data-message-id="${greeting.id}"]`);
  await expect(reply.locator('[data-example-plugin]')).toHaveText(
    `Example plugin: ${greeting.text}`,
    { timeout: 60_000 }
  );
  return reply;
};

/** The localStorage keys of the side panels `userId` keeps open, beside the plugins' values. */
const panelKeysOf = (page: Page, userId: string) =>
  page.evaluate(
    (prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
    `mindroom.plugin:${encodeURIComponent(userId)}/:side-panel/`
  );

test("a card opens the plugin's panel with its request, which stays open in its room", async ({
  browser,
}) => {
  test.setTimeout(5 * 60_000);
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...alice });
    await page.goto(threadPath);
    const first = await card(page, 0);
    await first.getByRole('button', { name: 'Show in panel' }).click();
    await expect(panel(page)).toContainText('Greeting: Good morning');
    await expect(first.getByRole('button', { name: 'Close panel' })).toBeVisible();
    await shot(page, 'first-request');

    // A second card's request replaces the first in the open panel.
    await (await card(page, 1)).getByRole('button', { name: 'Show in panel' }).click();
    await expect(panel(page)).toContainText('Greeting: Good evening');
    await expect(panel(page)).not.toContainText('Good morning');
    await shot(page, 'second-request');

    // A reload keeps it open, with its request.
    await page.reload();
    await expect(panel(page)).toContainText('Greeting: Good evening', { timeout: 60_000 });
    await shot(page, 'after-reload');

    // Another room shows without it. Opened there from the room menu, with no request, it takes
    // the page's place, yet back in the first room the first panel opens again, request and all.
    await showRoom(page, ELSEWHERE);
    await expect(panel(page)).toHaveCount(0);
    await roomMoreOptions(page).click();
    await page.getByRole('menuitemcheckbox', { name: 'Example panel', exact: true }).click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page)).not.toContainText('Greeting:');
    await showRoom(page, ROOM);
    await expect(panel(page)).toContainText('Greeting: Good evening');
    await shot(page, 'back-in-its-room');
    // Closed there, it stays closed after a reload.
    await showRoom(page, ELSEWHERE);
    await page.getByRole('button', { name: 'Close Example panel', exact: true }).click();
    await page.reload();
    await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
    await expect(panel(page)).toHaveCount(0);

    // Another account in this browser never sees it; back on the first, it is still open.
    await chooseFromAccountMenu(page, 'Add Account');
    await loginWithPassword(page, { homeserver: HOMESERVER, ...bob, addAccount: true });
    await page.goto(threadPath);
    await card(page, 1);
    await expect(panel(page)).toHaveCount(0);
    await shot(page, 'other-account');
    await switchToStoredUsername(page, alice.username);
    await showRoom(page, ROOM);
    await expect(panel(page)).toContainText('Greeting: Good evening');

    // Signing out deletes it with the account's plugin storage.
    expect(await panelKeysOf(page, alice.userId)).toHaveLength(1);
    const reloaded = page.waitForEvent('load');
    await logoutActiveAccount(page);
    await reloaded;
    expect(await panelKeysOf(page, alice.userId)).toEqual([]);
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
});
