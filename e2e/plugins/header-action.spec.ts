import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { disposableHomeserverIsUp } from '../helpers/disposableAccounts';
import { roomHeader, roomMoreOptions } from '../helpers/roomMenu';
import { openPanelRoom } from '../helpers/sidePanels';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. The plugin's header action,
// "Wave", goes in the row where there is room (placement `auto`): a button in a wide room header,
// in the thread open there, and an entry of the room menu on a phone, where the row keeps only Back
// and the menu's button. Either runs it in the open room. Once the app's language is German it is
// "Winken" in both.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const WIDE = { width: 1600, height: 1000 };
const PHONE = { width: 390, height: 844 };

test.use({ viewport: WIDE, video: 'off' });

let build: string | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-action-build-'));
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

/**
 * Chooses `control` and expects the action's alert to say where it ran. The alert is dismissed as
 * it shows: the click returns only once it is.
 */
const wave = async (page: Page, control: Locator, where: string) => {
  const message = new Promise<string>((resolve) => {
    page.once('dialog', (alert) => {
      resolve(alert.message());
      void alert.dismiss();
    });
  });
  await control.click();
  expect(await message).toBe(`Example wave in ${where}`);
};

const headerButton = (page: Page, name: string) =>
  roomHeader(page).getByRole('button', { name, exact: true });

test("the example plugin's header action shows in the row or the room menu by its placement, in the app's language", async ({
  browser,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(10 * 60_000);
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  const shot = (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  try {
    const room = await openPanelRoom(context, page);
    await wave(page, headerButton(page, 'Wave'), `${room.roomId} ${room.rootId}`);
    await shot('wide-english');

    await page.setViewportSize(PHONE);
    await page.goto(`/home/${encodeURIComponent(room.roomId)}`);
    await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
    await expect(headerButton(page, 'Wave')).toHaveCount(0);
    await roomMoreOptions(page).click();
    await shot('phone-english-menu');
    await wave(page, page.getByRole('menuitem', { name: 'Wave', exact: true }), room.roomId);

    await page.evaluate(() => localStorage.setItem('i18nextLng', 'de'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await headerButton(page, 'Weitere Optionen').click();
    await shot('phone-german-menu');
    await wave(page, page.getByRole('menuitem', { name: 'Winken', exact: true }), room.roomId);

    await page.setViewportSize(WIDE);
    await wave(page, headerButton(page, 'Winken'), room.roomId);
    await expect(headerButton(page, 'Wave')).toHaveCount(0);
    await shot('wide-german');
  } finally {
    // The page's live sync may still be in a route.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
});
