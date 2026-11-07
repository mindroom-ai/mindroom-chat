import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { waitForLoggedInShell } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { buildLoginPath } from '../env';
import { createRoom } from '../helpers/createRoom';
import { sendRoomMessage } from '../helpers/matrix';
import { roomHeader } from '../helpers/roomMenu';
import { serveBuild } from '../helpers/staticBuildServer';

// The client SDK's `room` subpath (src/client-sdk/room.ts) in a production build with the example
// client plugin (src/app/plugins/__fixtures__/example-plugin), served as a deployment serves it,
// against the disposable homeserver, with the browser router and with the hash router. The plugin's
// page at /p/example/rooms/<room>/<thread> links to the room and to its thread at the paths the app
// opens them at, and both links open them; its buttons open the room, and the thread, whose Back
// button returns to the page; and its reload button reloads the page. Set PLUGIN_SHOTS=<directory>
// to save screenshots.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PASSWORD = 'room-navigation-password';
const RUN = Date.now().toString(36);
const ROOM_NAME = 'Room navigation room';
const REPLY = 'A reply in the thread';

test.use({ viewport: { width: 1280, height: 800 } });

type Seed = { person: DisposableUser; roomId: string; rootId: string; replyId: string };

let build: string | undefined;
let shippedConfig: Record<string, unknown> = {};
let seeded: Seed | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-room-navigation-build-'));
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
  shippedConfig = JSON.parse(readFileSync(join(build, 'config.json'), 'utf8'));
  const person = await registerDisposableUser(`room_navigation_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, person.accessToken, { name: ROOM_NAME });
  const rootId = await sendRoomMessage(HOMESERVER, person.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'The thread root',
  });
  const replyId = await sendRoomMessage(HOMESERVER, person.accessToken, roomId, {
    msgtype: 'm.text',
    body: REPLY,
    'm.relates_to': { rel_type: 'm.thread', event_id: rootId },
  });
  seeded = { person, roomId, rootId, replyId };
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

for (const [router, hashRouter] of [
  ['browser router', false],
  ['hash router', true],
] as const) {
  test(`the plugin's page opens a room and its thread, and links to them, with the ${router}`, async ({
    browser,
  }) => {
    const { person, roomId, rootId, replyId } = seeded!;
    writeFileSync(
      join(build!, 'config.json'),
      JSON.stringify({ ...shippedConfig, hashRouter: { enabled: hashRouter } })
    );
    const server = await serveBuild(build!);
    const context = await browser.newContext({ baseURL: server.origin });
    const page = await context.newPage();
    // An app path as this router puts it in an href, and opening one.
    const href = (path: string) => (hashRouter ? `#${path}` : path);
    const open = (path: string) => page.goto(hashRouter ? `/#${path}` : path);
    const roomPath = `/home/${encodeURIComponent(roomId)}`;
    const threadPath = `${roomPath}?threadId=${encodeURIComponent(rootId)}`;
    const routerPath = () => {
      const url = new URL(page.url());
      return hashRouter ? url.hash.slice(1) : `${url.pathname}${url.search}`;
    };
    const examplePage = page.locator('[data-example-room-page]');
    const roomOpen = () =>
      expect(roomHeader(page).getByRole('heading', { name: ROOM_NAME })).toBeVisible({
        timeout: 30_000,
      });
    const threadOpen = () =>
      expect(page.locator(`[data-message-id="${replyId}"]`)).toContainText(REPLY, {
        timeout: 30_000,
      });
    const backToPage = async () => {
      await page.goBack();
      await expect(examplePage).toBeVisible({ timeout: 30_000 });
    };
    try {
      await open(buildLoginPath(HOMESERVER));
      await page.locator('input[name="usernameInput"]').fill(person.username);
      await page.locator('input[name="passwordInput"]').fill(person.password);
      await page.getByRole('button', { name: 'Login' }).click();
      await waitForLoggedInShell(page);

      await open(`/p/example/rooms/${encodeURIComponent(roomId)}/${encodeURIComponent(rootId)}`);
      await expect(examplePage).toBeVisible({ timeout: 30_000 });
      await shot(page, `room-navigation-${hashRouter ? 'hash' : 'browser'}`);
      const roomLink = page.getByRole('link', { name: 'Link to the room' });
      const threadLink = page.getByRole('link', { name: 'Link to the thread' });
      await expect(roomLink).toHaveAttribute('href', href(roomPath));
      await expect(threadLink).toHaveAttribute('href', href(threadPath));

      await page.getByRole('button', { name: 'Open the room' }).click();
      await roomOpen();
      expect(routerPath()).toBe(roomPath);
      await backToPage();

      await page.getByRole('button', { name: 'Open the thread' }).click();
      await threadOpen();
      expect(routerPath()).toBe(threadPath);
      await page
        .locator('[data-thread-context-banner]')
        .getByRole('button', { name: 'Back', exact: true })
        .click();
      await expect(examplePage).toBeVisible({ timeout: 30_000 });

      await roomLink.click();
      await roomOpen();
      expect(routerPath()).toBe(roomPath);
      await backToPage();

      await threadLink.click();
      await threadOpen();
      expect(routerPath()).toBe(threadPath);
      await backToPage();

      await page.evaluate(() => {
        (window as { beforeReload?: boolean }).beforeReload = true;
      });
      await page.getByRole('button', { name: 'Reload into the new version' }).click();
      await expect
        .poll(() => page.evaluate(() => (window as { beforeReload?: boolean }).beforeReload))
        .toBeUndefined();
      await expect(examplePage).toBeVisible({ timeout: 30_000 });
    } finally {
      await context.close();
      await server.close();
    }
  });
}
