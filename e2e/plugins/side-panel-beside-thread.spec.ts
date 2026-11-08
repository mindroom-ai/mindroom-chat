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
import {
  joinRoom,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { roomHeader } from '../helpers/roomMenu';
import { setRoomCompact } from '../helpers/roomViewSwitch';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. An agent's greeting that
// begins a thread opens the plugin's panel beside the thread as the thread shows, from the room's
// thread list, from the thread's badge in the Threads view or from a link, with the greeting as its
// request. Closed, the panel stays closed while the thread shows, also as the thread's next message
// arrives; once another thread has shown, the greeting's thread opens it again. It does not open
// while the members show, nor on a phone.
// Set PLUGIN_SHOTS=<directory> to save screenshots.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'plugin-beside-password';
const RUN = Date.now().toString(36);
const ROOM = `Beside threads ${RUN}`;
const GREETING = 'Good morning';

test.use({ viewport: { width: 1600, height: 1000 } });

let build: string | undefined;
let alice: DisposableUser;
let agent: MatrixSession;
let roomId = '';
/** The greeting that begins a thread, and a thread that begins with a plain message. */
let greetingRoot = '';
let plainRoot = '';

/** Sends `body` as `session` into the thread of `root`. */
const reply = (session: { accessToken: string }, root: string, body: string) =>
  sendRoomMessage(HOMESERVER, session.accessToken, roomId, {
    msgtype: 'm.text',
    body,
    'm.relates_to': { rel_type: 'm.thread', event_id: root },
  });

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-beside-thread-build-'));
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

  alice = await registerDisposableUser(`beside_alice_${RUN}`, PASSWORD);
  agent = await registerAgentAccount(HOMESERVER, 'greeter');
  roomId = await createRoom(HOMESERVER, alice.accessToken, { name: ROOM, invite: [agent.userId] });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  plainRoot = await sendRoomMessage(HOMESERVER, alice.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'A plain question',
  });
  await reply(agent, plainRoot, 'A plain answer');
  greetingRoot = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: GREETING,
    'com.example.greeting': { text: GREETING },
  });
  await reply(alice, greetingRoot, 'Good morning to you too');
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
const banner = (page: Page) => page.locator('[data-thread-context-banner]');
const threadPath = (root: string) =>
  `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(root)}`;

/**
 * Opens the thread `root` from the room's thread list: its card in the Compact view, or its badge
 * in the Threads view. Waits for it.
 */
const openFromList = async (page: Page, root: string) => {
  await page.locator(`[data-thread-root-id="${root}"]`).first().click();
  await expect(banner(page)).toBeVisible({ timeout: 30_000 });
};
const exitThread = async (page: Page) => {
  await banner(page).getByRole('button').first().click();
  await expect(banner(page)).toHaveCount(0);
};

/**
 * Waits until the thread shown has rendered its root as the plugin renders a greeting, which has
 * asked for the panel by then, and a moment more for the panel to show if it opens.
 */
const greetingShown = async (page: Page) => {
  await expect(
    page.locator(`[data-message-id="${greetingRoot}"] [data-example-plugin]`).first()
  ).toHaveText(`Example plugin: ${GREETING}`, { timeout: 60_000 });
  await page.waitForTimeout(1_000);
};

const membersButton = (page: Page, name: 'Show Members' | 'Hide Members') =>
  roomHeader(page).getByRole('button', { name, exact: true });
/** Shows (`true`) or hides the members from the room header. */
const setMembers = async (page: Page, shown: boolean) => {
  const show = membersButton(page, 'Show Members');
  const hide = membersButton(page, 'Hide Members');
  await expect(show.or(hide)).toBeVisible({ timeout: 60_000 });
  if ((await hide.isVisible()) !== shown) await (shown ? show : hide).click();
  await expect(shown ? hide : show).toBeVisible();
};

test("a greeting that begins a thread opens the plugin's panel beside the thread", async ({
  browser,
}) => {
  test.setTimeout(5 * 60_000);
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...alice });
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await setMembers(page, false);
    await setRoomCompact(page, true);

    // From the room's thread list.
    await openFromList(page, greetingRoot);
    await expect(panel(page)).toContainText(`Greeting: ${GREETING}`, { timeout: 30_000 });
    await shot(page, 'opened-from-list');

    // Closed, it stays closed while the thread shows, also as the thread's next message arrives.
    await page.getByRole('button', { name: 'Close Example panel', exact: true }).click();
    await expect(panel(page)).toHaveCount(0);
    await reply(agent, greetingRoot, 'Have a good day');
    await expect(page.getByText('Have a good day', { exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await greetingShown(page);
    await expect(panel(page)).toHaveCount(0);
    await expect(banner(page)).toBeVisible();
    await shot(page, 'stays-closed');

    // Another thread shows without it; back in the greeting's thread it opens again.
    await exitThread(page);
    await openFromList(page, plainRoot);
    await page.waitForTimeout(1_000);
    await expect(panel(page)).toHaveCount(0);
    await exitThread(page);
    await openFromList(page, greetingRoot);
    await expect(panel(page)).toContainText(`Greeting: ${GREETING}`, { timeout: 30_000 });
    await shot(page, 'opened-again');

    // From the Threads view, whose timeline shows the greeting, through its thread's badge.
    await page.getByRole('button', { name: 'Close Example panel', exact: true }).click();
    await exitThread(page);
    await setRoomCompact(page, false);
    await greetingShown(page);
    await expect(panel(page)).toHaveCount(0);
    await openFromList(page, greetingRoot);
    await expect(panel(page)).toContainText(`Greeting: ${GREETING}`, { timeout: 30_000 });
    await shot(page, 'opened-from-threads-view');

    // From a link, here on the plugin's own page, which opens the thread.
    await page.getByRole('button', { name: 'Close Example panel', exact: true }).click();
    await page.goto(
      `/p/example/rooms/${encodeURIComponent(roomId)}/${encodeURIComponent(greetingRoot)}`
    );
    await page.getByRole('link', { name: 'Link to the thread' }).click();
    await expect(banner(page)).toBeVisible({ timeout: 60_000 });
    await expect(panel(page)).toContainText(`Greeting: ${GREETING}`, { timeout: 30_000 });
    await shot(page, 'opened-from-link');

    // Not while the members show.
    await page.getByRole('button', { name: 'Close Example panel', exact: true }).click();
    await exitThread(page);
    await setMembers(page, true);
    await openFromList(page, greetingRoot);
    await greetingShown(page);
    await expect(panel(page)).toHaveCount(0);
    await expect(membersButton(page, 'Hide Members')).toBeVisible();
    await shot(page, 'members-shown');

    // Nor on a phone.
    await setMembers(page, false);
    await exitThread(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(threadPath(greetingRoot));
    await expect(banner(page)).toBeVisible({ timeout: 60_000 });
    await greetingShown(page);
    await expect(panel(page)).toHaveCount(0);
    await shot(page, 'phone');
  } finally {
    await context.close();
    await server.close();
  }
});
