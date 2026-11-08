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
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. An agent's greeting holds
// Markdown, a raw image whose error handler would run script, and Alice's Matrix ID; the plugin's
// side panel shows it through the client SDK's `ui` subpath as the app renders an agent's reply:
// formatted, with the handler gone, and Alice by her name in the room.
// Set PLUGIN_SHOTS=<directory> to save a screenshot.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'plugin-text-password';
const RUN = Date.now().toString(36);
const ALICE = 'Alice Example';

let build: string | undefined;
let alice: DisposableUser;
let agent: MatrixSession;
let roomPath = '';

const setDisplayName = ({ userId, accessToken }: MatrixSession, displayname: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(userId)}/displayname`, {
    method: 'PUT',
    accessToken,
    body: JSON.stringify({ displayname }),
  });

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-text-build-'));
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

  alice = await registerDisposableUser(`text_alice_${RUN}`, PASSWORD);
  agent = await registerAgentAccount(HOMESERVER, 'writer');
  await setDisplayName(alice, ALICE);
  const roomId = await createRoom(HOMESERVER, alice.accessToken, {
    name: `Agent text ${RUN}`,
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const text = [
    `## Plan for ${alice.userId}.`,
    '',
    '- First step',
    '- Second step with `code`',
    '',
    'Read [the docs](https://example.org/docs) ' +
      '<img src="mxc://example.org/missing" onerror="window.exampleScriptRan = true">',
  ].join('\n');
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: text,
    'com.example.greeting': { text },
  });
  roomPath = `/home/${encodeURIComponent(roomId)}`;
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

test("the example panel shows an agent's Markdown as the app renders it, without script, with names", async ({
  browser,
}) => {
  test.setTimeout(5 * 60_000);
  const server = await serveBuild(build!);
  const context = await browser.newContext({
    baseURL: server.origin,
    viewport: { width: 1600, height: 1000 },
  });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...alice });
    await page.goto(roomPath);
    const card = page.locator('[data-message-id]').filter({
      has: page.locator('[data-example-plugin]'),
    });
    await expect(card).toHaveCount(1, { timeout: 60_000 });
    await card.getByRole('button', { name: 'Show in panel' }).click();

    const panel = page.getByRole('region', { name: 'Example panel', exact: true });
    const greeting = panel.locator('[data-example-plugin-greeting]');
    await expect(greeting.getByRole('heading', { level: 2 })).toHaveText(`Plan for ${ALICE}.`, {
      timeout: 30_000,
    });
    await expect(greeting.getByRole('listitem')).toHaveText([
      'First step',
      'Second step with code',
    ]);
    await expect(greeting.locator('li code')).toHaveText('code');
    await expect(greeting.getByRole('link', { name: 'the docs' })).toHaveAttribute(
      'href',
      'https://example.org/docs'
    );
    await expect(greeting).not.toContainText(alice.userId);

    // The image stays without its handler: it failed to load, and no script ran.
    const image = greeting.locator('img');
    await expect(image).toHaveAttribute('src', 'mxc://example.org/missing');
    await expect(image).not.toHaveAttribute('onerror');
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.complete))
      .toBe(true);
    expect(await page.evaluate(() => 'exampleScriptRan' in window)).toBe(false);
    await greeting.scrollIntoViewIfNeeded();
    await shot(page, 'agent-text');
  } finally {
    await context.close();
    await server.close();
  }
});
