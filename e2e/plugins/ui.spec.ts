import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { SCHEMES, setLook } from '../helpers/designChoices';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom } from '../helpers/matrix';
import { isPhoneLayout, roomHeader, roomMoreOptions } from '../helpers/roomMenu';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. The plugin's side panel
// draws its rows, its menu, the menu's pop-out and tooltip, and a dialog with the app's own
// components from `@mindroom/client-sdk/ui`: each has the classes of the app's counterpart (the
// sidebar's rows, the room menu's entries, the Leave Room dialog and its header), and the menu and
// the tooltip line up with the end of their button, its right edge in English and its left edge
// in Arabic. Screenshots of each, beside the app's counterparts, in the light and the dark scheme.
// Its card, which draws its own frame, says the app's theme kind and screen size as they change,
// without a reload, and shows a PDF it holds as a blob in the browser's viewer, through the app's
// frame page.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const RUN = Date.now().toString(36);
const LAYOUTS = {
  wide: { width: 1440, height: 900 },
  phone: { width: 390, height: 844 },
};

let build: string | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-ui-build-'));
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

const panel = (page: Page) => page.getByRole('region', { name: 'Example panel', exact: true });
const menuButton = (page: Page) =>
  panel(page).getByRole('button', { name: 'Example menu', exact: true });
const exampleMenu = (page: Page) =>
  page.getByRole('menu').filter({ hasText: 'Show example dialog' });
const exampleDialog = (page: Page) => page.getByRole('dialog', { name: 'Example dialog' });
const exampleRow = (page: Page, name: string) =>
  panel(page).getByRole('button', { name, exact: true });

/** The classes the app's component gave the element, from the props it was drawn with. */
const classes = (locator: Locator) => locator.evaluate((element) => element.className);

/** The classes of a row (`NavItem`) whose action is `action` (`NavButton`), and of its content. */
const rowClasses = async (action: Locator) => [
  await classes(action.locator('xpath=..')),
  await classes(action),
  await classes(action.locator(':scope > *').first()),
];

/** The classes of a dialog and of its header. */
const dialogClasses = async (dialog: Locator) => [
  await classes(dialog),
  await classes(dialog.locator('header')),
];

/** Opens the example panel: its toggle in the room header's row, or on a phone its menu entry. */
const openExamplePanel = async (page: Page) => {
  if (!isPhoneLayout(page)) {
    await roomHeader(page).getByRole('button', { name: 'Example panel', exact: true }).click();
  } else {
    await roomMoreOptions(page).click();
    await page.getByRole('menuitemcheckbox', { name: 'Example panel', exact: true }).click();
  }
  await expect(panel(page)).toBeVisible();
};

/**
 * Expects `floating` lined up with the end of `anchor` in reading order: their right edges in a
 * left-to-right page, their left edges in a right-to-left one.
 */
const expectAtEnd = async (anchor: Locator, floating: Locator, direction: 'ltr' | 'rtl') => {
  const button = await anchor.boundingBox();
  const box = await floating.boundingBox();
  if (!button || !box) throw new Error('the button or what it opened is not laid out');
  if (direction === 'ltr')
    expect(Math.abs(box.x + box.width - (button.x + button.width))).toBeLessThan(2);
  else expect(Math.abs(box.x - button.x)).toBeLessThan(2);
};

for (const [layout, viewport] of Object.entries(LAYOUTS)) {
  test(`the example plugin's rows, menu and dialog are the app's own, on a ${layout} screen, in English and in Arabic`, async ({
    browser,
  }, testInfo) => {
    test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
    test.setTimeout(10 * 60_000);
    const person = await registerDisposableUser(`plugin_ui_${layout}_${RUN}`, 'plugin-ui-pass');
    const roomId = await createPrivateRoom(HOMESERVER, person.accessToken, {
      name: 'Orchard',
      topic: 'Where the example plugin draws with the app',
    });
    const server = await serveBuild(build!);
    const context = await browser.newContext({ baseURL: server.origin, viewport });
    const page = await context.newPage();
    /** Screenshots of the page in the light and the dark scheme, as `<layout>-<name>-<scheme>`. */
    const shots = async (name: string) => {
      for (const scheme of SCHEMES) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.screenshot({ path: testInfo.outputPath(`${layout}-${name}-${scheme}.png`) });
      }
      await page.emulateMedia({ colorScheme: 'light' });
    };
    try {
      await loginWithPassword(page, { homeserver: HOMESERVER, ...person });
      await page.goto(`/home/${encodeURIComponent(roomId)}/`);
      await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });

      // The app's own: its room menu, the Leave Room dialog and, beside a room, the sidebar's rows.
      await roomMoreOptions(page).click();
      const appEntryClasses = await classes(
        page.getByRole('menuitem', { name: 'Jump to Time', exact: true })
      );
      await shots('app-menu');
      await page.getByRole('menuitem', { name: 'Leave Room', exact: true }).click();
      const leave = page.getByRole('alertdialog');
      const appDialogClasses = await dialogClasses(leave);
      await shots('app-dialog');
      await page.keyboard.press('Escape');
      await expect(leave).toHaveCount(0);
      // On a phone the sidebar is not beside the room.
      const appRowClasses =
        layout === 'wide'
          ? await rowClasses(page.locator('[data-home-room-action]').first())
          : undefined;

      await openExamplePanel(page);
      for (const direction of ['ltr', 'rtl'] as const) {
        await test.step(direction === 'ltr' ? 'English' : 'Arabic', async () => {
          await setLook(page, 'light', direction);
          // The panel stays open across the reload into the other language.
          await expect(panel(page)).toBeVisible({ timeout: 60_000 });

          const row = exampleRow(page, 'Second example row');
          await row.click();
          await expect(row).toHaveAttribute('aria-current', 'true');
          if (appRowClasses) {
            expect(await rowClasses(exampleRow(page, 'First example row'))).toEqual(appRowClasses);
          }

          await menuButton(page).hover();
          const tooltip = page.getByRole('tooltip').filter({ hasText: 'Example menu' });
          await expect(tooltip).toBeVisible();
          await expectAtEnd(menuButton(page), tooltip, direction);
          await shots(`${direction}-tooltip`);

          await menuButton(page).click();
          await expect(exampleMenu(page)).toBeVisible();
          await expectAtEnd(menuButton(page), exampleMenu(page), direction);
          await expect(exampleMenu(page).getByRole('menuitem')).toHaveText([
            'Show example dialog',
            'Clear example selection',
          ]);
          expect(
            await classes(exampleMenu(page).getByRole('menuitem', { name: 'Show example dialog' }))
          ).toBe(appEntryClasses);
          await shots(`${direction}-menu`);
          // Escape closes it, as the room menu's.
          await page.keyboard.press('Escape');
          await expect(exampleMenu(page)).toHaveCount(0);

          await menuButton(page).click();
          await exampleMenu(page)
            .getByRole('menuitem', { name: 'Clear example selection' })
            .click();
          await expect(row).not.toHaveAttribute('aria-current', 'true');
          await menuButton(page).click();
          await exampleMenu(page).getByRole('menuitem', { name: 'Show example dialog' }).click();
          await expect(exampleDialog(page)).toContainText('Example dialog of Orchard');
          expect(await dialogClasses(exampleDialog(page))).toEqual(appDialogClasses);
          await shots(`${direction}-dialog`);
          await page.getByRole('button', { name: 'Close example dialog' }).click();
          await expect(exampleDialog(page)).toHaveCount(0);
        });
      }
    } finally {
      await context.close();
      await server.close();
    }
  });
}

/** The share of white pixels in a screenshot of `area`, where a PDF's white page shows. */
const whiteShare = async (page: Page, area: Locator) =>
  page.evaluate(async (base64) => {
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
    const context = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
    context.drawImage(bitmap, 0, 0);
    const { data } = context.getImageData(0, 0, bitmap.width, bitmap.height);
    let white = 0;
    for (let index = 0; index < data.length; index += 4) {
      if (Math.min(data[index] ?? 0, data[index + 1] ?? 0, data[index + 2] ?? 0) > 245) white += 1;
    }
    return white / (bitmap.width * bitmap.height);
  }, (await area.screenshot()).toString('base64'));

test("the example plugin's own-frame card follows the app's theme kind and screen size, and shows its PDF in the browser's viewer", async ({
  browser,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(10 * 60_000);
  const person = await registerDisposableUser(`plugin_ui_surface_${RUN}`, 'plugin-ui-pass');
  const roomId = await createPrivateRoom(HOMESERVER, person.accessToken, {
    name: 'Orchard',
    topic: 'Where the example plugin draws its own surface',
  });
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin, viewport: LAYOUTS.phone });
  const page = await context.newPage();
  const card = page.getByRole('region', { name: 'Example card', exact: true });
  const says = (text: string) => expect(card.getByText(text, { exact: true })).toBeVisible();
  try {
    await page.emulateMedia({ colorScheme: 'light' });
    await loginWithPassword(page, { homeserver: HOMESERVER, ...person });
    await page.goto(`/home/${encodeURIComponent(roomId)}/`);
    await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
    await roomMoreOptions(page).click();
    await page.getByRole('menuitemcheckbox', { name: 'Example card', exact: true }).click();
    await expect(card).toBeVisible();
    // A mark on the window, which a reload would lose.
    await page.evaluate(() => Object.assign(window, { exampleSurfaceMark: true }));

    await says('Screen: Mobile');
    await says('Theme: light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme-kind', 'dark');
    await says('Theme: dark');
    await page.screenshot({ path: testInfo.outputPath('surface-phone-dark.png') });
    await page.emulateMedia({ colorScheme: 'light' });
    await says('Theme: light');

    await page.setViewportSize(LAYOUTS.wide);
    await says('Screen: Desktop');
    expect(await page.evaluate(() => 'exampleSurfaceMark' in window)).toBe(true);

    await card.getByRole('button', { name: 'Show example PDF', exact: true }).click();
    const frameElement = card.locator('iframe[title="Example PDF"]');
    await expect(frameElement).toBeVisible();
    // The browser's viewer runs in a frame of its own inside the app's frame page.
    const framePage = await (await frameElement.elementHandle())?.contentFrame();
    if (!framePage) throw new Error('the frame has no page');
    expect(new URL(framePage.url()).pathname).toBe('/pdf-frame.html');
    await expect(framePage.locator('embed[type="application/pdf"]')).toBeAttached();
    await expect
      .poll(() => page.frames().some((frame) => frame.url().startsWith('chrome-extension://')))
      .toBe(true);
    // The viewer draws the page, white on its dark backdrop.
    await expect
      .poll(() => whiteShare(page, frameElement), { timeout: 20_000 })
      .toBeGreaterThan(0.2);
    await page.screenshot({ path: testInfo.outputPath('surface-wide-pdf.png') });
  } finally {
    await context.close();
    await server.close();
  }
});
