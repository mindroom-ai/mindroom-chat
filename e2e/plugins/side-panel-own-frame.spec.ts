import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { disposableHomeserverIsUp } from '../helpers/disposableAccounts';
import { roomHeader, roomMoreOptions } from '../helpers/roomMenu';
import { openPanelRoom, panelLocator } from '../helpers/sidePanels';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. Its side panel "Example
// card" draws its own frame (`frame: 'own'`): the room draws no title, Close, splitter or frame
// strip around the card, which is 320 px wide beside the conversation. The card's Fill fills the
// room in the conversation's place, and its Hide leaves only the card's tab at the room's edge,
// beside the conversation at the width it has with no panel. On a phone the card covers the
// conversation until Hide, and then the conversation shows beside the tab. Screenshots of each,
// in the light and the dark scheme, go to the test's output as `own-frame-<layout>-<scheme>.png`.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const PHONE = { width: 390, height: 844 };

test.use({ viewport: { width: 1600, height: 1000 }, video: 'off' });

let build: string | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-own-frame-build-'));
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

const card = (page: Page) => page.getByRole('region', { name: 'Example card', exact: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const menuEntry = (page: Page) =>
  page.getByRole('menuitemcheckbox', { name: 'Example card', exact: true });
const widthOf = async (locator: Locator): Promise<number> =>
  (await locator.boundingBox())?.width ?? 0;

const shots = async (page: Page, testInfo: TestInfo, layout: string) => {
  for (const scheme of ['light', 'dark'] as const) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: scheme });
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: testInfo.outputPath(`own-frame-${layout}-${scheme}.png`) });
  }
  await page.emulateMedia({ colorScheme: 'light' });
};

/** Chooses the card's toggle in the room menu, which is checked while the card shows. */
const toggleCard = async (page: Page, checked: boolean) => {
  await roomMoreOptions(page).click();
  await expect(menuEntry(page)).toHaveAttribute('aria-checked', String(checked));
  await menuEntry(page).click();
};

/** The room draws nothing of its own around the card. */
const expectNoRoomFrame = async (page: Page) => {
  await expect(panelLocator(page, 'plugin')).toHaveCount(0);
  await expect(button(page, 'Close Example card')).toHaveCount(0);
  await expect(button(page, 'Fill the room with Example card')).toHaveCount(0);
  await expect(button(page, 'Fold Example card to the edge')).toHaveCount(0);
  await expect(page.getByRole('separator', { name: 'Resize Example card' })).toHaveCount(0);
};

/** Serves the build, opens the panel room in a page of its own, runs `check`, and cleans up. */
const withPanelRoom = async (browser: Browser, check: (page: Page) => Promise<void>) => {
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  const page = await context.newPage();
  try {
    await openPanelRoom(context, page);
    await check(page);
  } finally {
    // The page's live sync may still be in a route.
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
};

test("the example plugin's own-frame card fills the room and hides to its tab", async ({
  browser,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  await withPanelRoom(browser, async (page) => {
    const conversation = roomHeader(page);
    // A new account shows the members beside the conversation; the card takes their place.
    await toggleCard(page, false);
    await expect(card(page)).toBeVisible();
    await expectNoRoomFrame(page);
    const besideWidth = await widthOf(card(page));
    expect(besideWidth).toBeGreaterThan(320);
    expect(besideWidth).toBeLessThan(380);
    const conversationBeside = await widthOf(conversation);
    await shots(page, testInfo, 'wide-beside');

    await button(page, 'Fill example card').click();
    await expect(conversation).toHaveCount(0);
    expect(await widthOf(card(page))).toBeGreaterThan(besideWidth + conversationBeside - 40);
    await expectNoRoomFrame(page);
    await shots(page, testInfo, 'wide-filled');
    await button(page, 'Shrink example card').click();
    await expect(conversation).toBeVisible();
    await expect.poll(() => widthOf(card(page))).toBe(besideWidth);

    await button(page, 'Hide example card').click();
    const tab = button(page, 'Show example card');
    await expect(tab).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    await expectNoRoomFrame(page);
    const tabWidth = await widthOf(tab);
    const conversationFolded = await widthOf(conversation);
    await shots(page, testInfo, 'wide-folded');

    // With no panel at all (its toggle unfolds it first, then closes it), the conversation is as
    // wide as beside the folded card's tab and its margins.
    await toggleCard(page, false);
    await expect(card(page)).toBeVisible();
    await toggleCard(page, true);
    await expect(card(page)).toHaveCount(0);
    await expect(tab).toHaveCount(0);
    const conversationAlone = await widthOf(conversation);
    expect(conversationFolded).toBeGreaterThanOrEqual(conversationAlone - tabWidth - 20);
  });
});

test("on a phone the example plugin's own-frame card covers the conversation until hidden", async ({
  browser,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  await withPanelRoom(browser, async (page) => {
    await page.setViewportSize(PHONE);
    await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
    const conversationAlone = await widthOf(roomHeader(page));
    await toggleCard(page, false);
    await expect(card(page)).toBeVisible();
    await expectNoRoomFrame(page);
    // Over the conversation, header and all, as wide as the screen but for the card's margins.
    await expect(roomMoreOptions(page)).toBeHidden();
    expect(await widthOf(card(page))).toBeGreaterThan(PHONE.width - 30);
    await shots(page, testInfo, 'phone-beside');

    await button(page, 'Hide example card').click();
    const tab = button(page, 'Show example card');
    await expect(tab).toBeVisible();
    await expect(roomMoreOptions(page)).toBeVisible();
    expect(await widthOf(roomHeader(page))).toBeGreaterThanOrEqual(
      conversationAlone - (await widthOf(tab)) - 20
    );
    await shots(page, testInfo, 'phone-folded');

    await tab.click();
    await expect(card(page)).toBeVisible();
    await expect(roomMoreOptions(page)).toBeHidden();
  });
});
