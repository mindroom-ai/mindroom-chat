import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { disposableHomeserverIsUp } from '../helpers/disposableAccounts';
import { roomHeader, roomMoreOptions } from '../helpers/roomMenu';
import {
  CORE_PANELS,
  checkPanelFrame,
  closePanel,
  openPanel,
  openPanelRoom,
  panelLocator,
  type PanelRoom,
} from '../helpers/sidePanels';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. The plugin's side panel,
// "Example panel", opens from its toggle, a button in the room header's row (placement `auto`),
// shows what the plugin draws for the room, and is one of the room's side panels: opening it takes
// the side panel from the computer, a canvas, the call or the members, opening any of them takes it
// back, and neither comes back when the other closes. Its Close button and its toggle close it.
// The toggle is pressed while the panel shows, but not while it is folded to its tab, when choosing
// it unfolds the panel. On a phone the toggle is an entry of the room menu.
// It counts the room's members, the viewer and an agent, which it reads through the client SDK's
// `matrix` subpath.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PHONE = { width: 390, height: 844 };

test.use({ viewport: { width: 1600, height: 1000 }, video: 'off' });

let build: string | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-panel-build-'));
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
});

test.afterAll(() => {
  if (build) rmSync(build, { recursive: true, force: true });
});

const menuEntry = (page: Page) =>
  page.getByRole('menuitemcheckbox', { name: 'Example panel', exact: true });
const toggle = (page: Page) =>
  roomHeader(page).getByRole('button', { name: 'Example panel', exact: true });

const openExamplePanel = async (page: Page, room: PanelRoom) => {
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await toggle(page).click();
  const panel = page.getByRole('region', { name: 'Example panel', exact: true });
  await expect(panel).toBeVisible();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toContainText(`Example panel of ${room.roomId}`);
  await expect(panel).toContainText('Members: 2, with a MindRoom agent');
};

const closeExamplePanel = async (page: Page) => {
  await page.getByRole('button', { name: 'Close Example panel', exact: true }).click();
  await expect(panelLocator(page, 'plugin')).toHaveCount(0);
};

/** Serves the build, opens the panel room in a page of its own, runs `check`, and cleans up. */
const withPanelRoom = async (
  browser: Browser,
  check: (page: Page, room: PanelRoom) => Promise<void>
) => {
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    await check(page, await openPanelRoom(context, page));
  } finally {
    // The page's live sync may still be in a route.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
};

test("the example plugin's side panel opens, yields and closes as the core panels do", async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(10 * 60_000);
  await withPanelRoom(browser, async (page, room) => {
    for (const core of CORE_PANELS) {
      // eslint-disable-next-line no-await-in-loop
      await test.step(`the plugin's panel and the ${core}`, async () => {
        await openPanel(page, room, core);
        await openExamplePanel(page, room);
        await expect(panelLocator(page, core)).toHaveCount(0);
        await closeExamplePanel(page);
        await expect(panelLocator(page, core)).toHaveCount(0);

        await openExamplePanel(page, room);
        await openPanel(page, room, core);
        await expect(panelLocator(page, 'plugin')).toHaveCount(0);
        await closePanel(page, core);
        await expect(panelLocator(page, 'plugin')).toHaveCount(0);
      });
    }

    // The toggle closes the panel, and the room menu does not offer it on a wide screen.
    await openExamplePanel(page, room);
    await toggle(page).click();
    await expect(panelLocator(page, 'plugin')).toHaveCount(0);
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await roomMoreOptions(page).click();
    await expect(page.getByRole('menuitem', { name: 'Mark as Read' })).toBeVisible();
    await expect(menuEntry(page)).toHaveCount(0);
  });
});

test("the example plugin's side panel fills the room and folds to a tab, per room", async ({
  browser,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  await withPanelRoom(browser, async (page, room) => {
    await openExamplePanel(page, room);
    await checkPanelFrame(page, testInfo, room, {
      panel: panelLocator(page, 'plugin'),
      label: 'Example panel',
    });
    await expect(page.getByText(`Example panel of ${room.roomId}`)).toBeVisible();

    // Folded, its toggle is not pressed, and choosing it unfolds the panel; choosing it then
    // closes it.
    const panel = panelLocator(page, 'plugin');
    const fill = panel.getByRole('button', { name: 'Fill the room with Example panel' });
    await panel.getByRole('button', { name: 'Fold Example panel to the edge' }).click();
    await expect(panel.getByRole('button', { name: 'Unfold Example panel' })).toBeVisible();
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
    await toggle(page).click();
    await expect(fill).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
    await toggle(page).click();
    await expect(panel).toHaveCount(0);
  });
});

test("on a phone the example plugin's side panel toggles from the room menu", async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  await withPanelRoom(browser, async (page, room) => {
    await page.setViewportSize(PHONE);
    await page.goto(`/home/${encodeURIComponent(room.roomId)}`);
    await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
    await expect(toggle(page)).toHaveCount(0);
    await roomMoreOptions(page).click();
    await expect(menuEntry(page)).toHaveAttribute('aria-checked', 'false');
    await menuEntry(page).click();
    // Over the conversation, header and all, until its Close.
    await expect(page.getByText(`Example panel of ${room.roomId}`)).toBeVisible();
    await expect(roomMoreOptions(page)).toBeHidden();
    await closeExamplePanel(page);
    await expect(roomMoreOptions(page)).toBeVisible();
  });
});
