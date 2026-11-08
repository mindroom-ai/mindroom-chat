import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom } from '../helpers/matrix';
import { roomHeader, roomMoreOptions } from '../helpers/roomMenu';
import { serveBuild } from '../helpers/staticBuildServer';
import { touch } from '../helpers/touch';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. Every room's menu lists the
// plugin's entry, "Example room info", in a group of its own after Jump to Time and before Archive
// and Leave: the open room header's menu, and a sidebar row's (its More Options button, a
// right-click, a phone's long press), also for a room that is not open. Choosing it closes the
// menu and shows the plugin's dialog, which names the menu's room. Once the app's language is
// German the entry is "Beispiel-Rauminfo". Its critical entry, "Example removal"
// ("Beispiel-Entfernung"), comes right after Leave, in Leave's group and color, and says in an
// alert which room it ran in.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const RUN = Date.now().toString(36);
const WIDE = { width: 1440, height: 900 };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

test.use({ viewport: WIDE, video: 'off' });

let build: string | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-room-action-build-'));
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

const roomMenu = (page: Page) =>
  page.getByRole('menu').filter({ hasText: /Leave Room|Raum verlassen/ });

/** The names of the open room menu's entries, top to bottom. */
const menuEntries = (page: Page) =>
  roomMenu(page).evaluate((menu) =>
    Array.from(menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]'))
      .filter((row) => row.closest('[role="menu"]') === menu)
      .map((row) => row.textContent?.trim() ?? '')
  );

/** Expects the entry in the menu, between the first group's end and Archive. */
const expectEntry = async (page: Page, entry: string, before: string, after: string) => {
  await expect(roomMenu(page)).toBeVisible();
  const entries = await menuEntries(page);
  expect(entries).toContain(entry);
  expect(entries.indexOf(entry)).toBe(entries.indexOf(before) + 1);
  expect(entries.indexOf(after)).toBe(entries.indexOf(entry) + 1);
};

/** The open room menu's entry named `name`. */
const menuItem = (page: Page, name: string) =>
  roomMenu(page).getByRole('menuitem', { name, exact: true });

/** Expects the critical entry right after Leave, in Leave's group and color, not the ordinary's. */
const expectCriticalEntry = async (page: Page, entry: string, leave: string, ordinary: string) => {
  await expect(roomMenu(page)).toBeVisible();
  expect((await menuEntries(page)).slice(-2)).toEqual([leave, entry]);
  const previous = await menuItem(page, entry).evaluate((critical) =>
    critical.previousElementSibling?.textContent?.trim()
  );
  expect(previous).toBe(leave);
  const color = (name: string) =>
    menuItem(page, name).evaluate((element) => getComputedStyle(element).color);
  const critical = await color(entry);
  expect(critical).toBe(await color(leave));
  expect(critical).not.toBe(await color(ordinary));
};

/** Takes `shot` of the page in the light and the dark scheme, as `<name>-<scheme>`. */
const shotBothSchemes = async (
  page: Page,
  shot: (name: string) => Promise<unknown>,
  name: string
) => {
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await shot(`${name}-${scheme}`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
};

/** Chooses the entry: the menu closes and the plugin's dialog names `roomName`. */
const chooseEntry = async (page: Page, entry: string, roomName: string) => {
  await menuItem(page, entry).click();
  await expect(roomMenu(page)).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Example dialog' })).toContainText(
    `Example dialog of ${roomName}`
  );
};

const closeDialog = async (page: Page) => {
  await page.getByRole('button', { name: 'Close example dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Example dialog' })).toHaveCount(0);
};

const sidebarLink = (page: Page, roomId: string) =>
  page.locator(`a[href*="${encodeURIComponent(roomId)}"]`).first();

/** The sidebar row of the link: the closest element that also holds its More Options button. */
const rowOptions = (link: Locator) =>
  link
    .locator('xpath=ancestor::*[.//button[@aria-label="More Options"]][1]')
    .getByRole('button', { name: 'More Options', exact: true });

const seed = async (label: string) => {
  const person = await registerDisposableUser(`plugin_room_${label}_${RUN}`, 'plugin-room-pass');
  const orchard = await createPrivateRoom(HOMESERVER, person.accessToken, {
    name: 'Orchard',
    topic: 'Where the example plugin names the room',
  });
  const garden = await createPrivateRoom(HOMESERVER, person.accessToken, {
    name: 'Garden',
    topic: 'Another room for the example plugin',
  });
  return { person, orchard, garden };
};

test("every room menu lists the example plugin's entries, which act on the menu's room, in the app's language", async ({
  browser,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(10 * 60_000);
  const { person, orchard, garden } = await seed('wide');
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  const shot = (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...person });
    await page.goto(`/home/${encodeURIComponent(orchard)}/`);
    await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });

    // The open room's header menu.
    await roomMoreOptions(page).click();
    await expectEntry(page, 'Example room info', 'Jump to Time', 'Archive Room');
    await expectCriticalEntry(page, 'Example removal', 'Leave Room', 'Example room info');
    await shotBothSchemes(page, shot, 'header-menu');
    await chooseEntry(page, 'Example room info', 'Orchard');
    await shot('header-dialog');
    await closeDialog(page);

    // Another room's row, by its More Options button: the dialog names that room, and the open
    // room stays open.
    const gardenLink = sidebarLink(page, garden);
    await gardenLink.hover();
    await rowOptions(gardenLink).click();
    await expectEntry(page, 'Example room info', 'Jump to Time', 'Archive Room');
    await expectCriticalEntry(page, 'Example removal', 'Leave Room', 'Example room info');
    await shotBothSchemes(page, shot, 'row-menu');
    await chooseEntry(page, 'Example room info', 'Garden');
    await expect(roomHeader(page).locator('h1')).toHaveText('Orchard');
    await shot('row-dialog');
    await closeDialog(page);

    // The same row by a right-click.
    await gardenLink.click({ button: 'right' });
    await expectEntry(page, 'Example room info', 'Jump to Time', 'Archive Room');
    await chooseEntry(page, 'Example room info', 'Garden');
    await closeDialog(page);

    // The critical entry runs on the row's room too.
    await gardenLink.click({ button: 'right' });
    const alert = page.waitForEvent('dialog').then(async (dialog) => {
      const message = dialog.message();
      await dialog.dismiss();
      return message;
    });
    await menuItem(page, 'Example removal').click();
    expect(await alert).toBe(`Example removal in ${garden}`);
    await expect(roomMenu(page)).toHaveCount(0);

    await page.evaluate(() => localStorage.setItem('i18nextLng', 'de'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('lang', 'de');
    await roomHeader(page).getByRole('button', { name: 'Weitere Optionen', exact: true }).click();
    await expectEntry(page, 'Beispiel-Rauminfo', 'Zu Zeitpunkt springen', 'Raum archivieren');
    await expectCriticalEntry(page, 'Beispiel-Entfernung', 'Raum verlassen', 'Beispiel-Rauminfo');
    await shot('header-menu-german');
    await chooseEntry(page, 'Beispiel-Rauminfo', 'Orchard');
    await closeDialog(page);
    await gardenLink.click({ button: 'right' });
    await expectEntry(page, 'Beispiel-Rauminfo', 'Zu Zeitpunkt springen', 'Raum archivieren');
    await shot('row-menu-german');
    await chooseEntry(page, 'Beispiel-Rauminfo', 'Garden');
    await closeDialog(page);
  } finally {
    // The page's live sync may still be in a route.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
});

test("a phone's long press on a room row lists the example plugin's entries for that room", async ({
  browser,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(10 * 60_000);
  const { person, garden } = await seed('phone');
  const server = await serveBuild(build!);
  const context = await browser.newContext({ ...PHONE, baseURL: server.origin });
  const page = await context.newPage();
  const shot = (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...person });
    await page.goto('/home/');
    const gardenLink = page
      .getByRole('navigation', { name: 'Home', exact: true })
      .locator(`a[href*="${encodeURIComponent(garden)}"]`)
      .first();
    await expect(gardenLink).toBeVisible({ timeout: 60_000 });
    // Longer than the 500 ms long press.
    await touch(gardenLink, [{ type: 'start' }, { type: 'wait', ms: 700 }, { type: 'end' }]);
    await expectEntry(page, 'Example room info', 'Jump to Time', 'Archive Room');
    await expectCriticalEntry(page, 'Example removal', 'Leave Room', 'Example room info');
    await shotBothSchemes(page, shot, 'phone-row-menu');
    await chooseEntry(page, 'Example room info', 'Garden');
    await shot('phone-row-dialog');
    await closeDialog(page);
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
});
