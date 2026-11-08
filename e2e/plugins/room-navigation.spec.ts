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

// The client SDK's `room` subpath (src/client-sdk/room.ts), and `reloadForNewVersion` of its `core`
// subpath, in a production build with the example client plugin
// (src/app/plugins/__fixtures__/example-plugin), served as a deployment serves it, against the
// disposable homeserver, with the browser router and with the hash router. The plugin's page at
// /p/example/rooms/<room>/<thread> links to the room and to its thread at the paths the app opens
// them at, and both links open them; its buttons open the room, and the thread, whose Back button
// returns to the page, the room at the thread's root, marked, and the room in place of the page, so
// that Back skips the page; and its reload button reloads the page. Set PLUGIN_SHOTS=<directory> to
// save screenshots.
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

/** Records whether the row of `eventId` is ever drawn highlighted, from now on. */
const watchHighlight = (page: Page, eventId: string) =>
  page.evaluate((id) => {
    const state = window as Window & { roomNavigationMarks?: Record<string, boolean> };
    const marks = state.roomNavigationMarks ?? {};
    state.roomNavigationMarks = marks;
    marks[id] = false;
    const started = performance.now();
    const tick = () => {
      const row = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
      const fill = row ? getComputedStyle(row).backgroundColor : 'transparent';
      if (fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent') {
        marks[id] = true;
        return;
      }
      if (performance.now() - started < 60_000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, eventId);

const highlighted = (page: Page, eventId: string) =>
  page.evaluate(
    (id) =>
      (window as Window & { roomNavigationMarks?: Record<string, boolean> }).roomNavigationMarks?.[
        id
      ] ?? false,
    eventId
  );

const shot = async (page: Page, name: string) => {
  const directory = process.env.PLUGIN_SHOTS;
  if (directory) await page.screenshot({ path: `${directory}/${name}.png` });
};

for (const [router, hashRouter] of [
  ['browser', false],
  ['hash', true],
] as const) {
  test(`the plugin's page opens a room and its thread, and links to them, with the ${router} router`, async ({
    browser,
  }) => {
    // Several page loads: the sign-in, the links and Back with the browser router, and the reload.
    test.setTimeout(3 * 60_000);
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
      // The page before the plugin's, where Back leads once the room took the plugin's page's place.
      const before = routerPath();

      await open(`/p/example/rooms/${encodeURIComponent(roomId)}/${encodeURIComponent(rootId)}`);
      await expect(examplePage).toBeVisible({ timeout: 30_000 });
      await shot(page, `room-navigation-${router}`);
      const roomLink = page.getByRole('link', { name: 'Link to the room' });
      const threadLink = page.getByRole('link', { name: 'Link to the thread' });
      await expect(roomLink).toHaveAttribute('href', href(roomPath));
      await expect(threadLink).toHaveAttribute('href', href(threadPath));

      await page.getByRole('button', { name: 'Open the room', exact: true }).click();
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

      await watchHighlight(page, rootId);
      await page.getByRole('button', { name: 'Open the room at the thread root' }).click();
      await roomOpen();
      expect(routerPath()).toBe(`${roomPath}/${encodeURIComponent(rootId)}`);
      await expect.poll(() => highlighted(page, rootId), { timeout: 10_000 }).toBe(true);
      await shot(page, `room-navigation-${router}-at-root`);
      await backToPage();

      await page.evaluate(() => {
        (window as { beforeReload?: boolean }).beforeReload = true;
      });
      const reloaded = page.waitForEvent('load');
      await page.getByRole('button', { name: 'Reload into the new version' }).click();
      await reloaded;
      await expect(examplePage).toBeVisible({ timeout: 30_000 });
      expect(
        await page.evaluate(() => (window as { beforeReload?: boolean }).beforeReload)
      ).toBeUndefined();

      await page.getByRole('button', { name: 'Open the room in place of this page' }).click();
      await roomOpen();
      expect(routerPath()).toBe(roomPath);
      await page.goBack();
      await expect.poll(routerPath, { timeout: 30_000 }).toBe(before);
      await expect(examplePage).toBeHidden();
    } finally {
      await context.close();
      await server.close();
    }
  });
}
