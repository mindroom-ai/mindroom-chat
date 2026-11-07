import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { disposableHomeserverIsUp } from '../helpers/disposableAccounts';
import { roomMoreOptions } from '../helpers/roomMenu';
import {
  CORE_PANELS,
  closePanel,
  openPanel,
  openPanelRoom,
  panelLocator,
  type PanelRoom,
} from '../helpers/sidePanels';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. The plugin's side panel,
// "Example panel", opens from the room menu, shows what the plugin draws for the room, and is one
// of the room's side panels: opening it takes the side panel from the computer, a canvas, the call
// or the members, opening any of them takes it back, and neither comes back when the other closes.
// Its Close button and its room menu entry close it.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');

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

const openExamplePanel = async (page: Page, room: PanelRoom) => {
  await roomMoreOptions(page).click();
  await expect(menuEntry(page)).toHaveAttribute('aria-checked', 'false');
  await menuEntry(page).click();
  const panel = page.getByRole('region', { name: 'Example panel', exact: true });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText(`Example panel of ${room.roomId}`);
};

const closeExamplePanel = async (page: Page) => {
  await page.getByRole('button', { name: 'Close Example panel', exact: true }).click();
  await expect(panelLocator(page, 'plugin')).toHaveCount(0);
};

test("the example plugin's side panel opens, yields and closes as the core panels do", async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(10 * 60_000);
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    const room = await openPanelRoom(context, page);

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

    // The room menu marks the panel while it shows, and closes it when chosen again.
    await openExamplePanel(page, room);
    await roomMoreOptions(page).click();
    await expect(menuEntry(page)).toHaveAttribute('aria-checked', 'true');
    await menuEntry(page).click();
    await expect(panelLocator(page, 'plugin')).toHaveCount(0);
  } finally {
    // The page's live sync may still be in a route.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
});
