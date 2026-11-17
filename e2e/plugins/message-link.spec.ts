import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { createPrivateRoom, sendRoomMessage } from '../helpers/matrix';
import { serveBuild } from '../helpers/staticBuildServer';

// A production build with the example client plugin (src/app/plugins/__fixtures__/example-plugin),
// served as a deployment serves it, against the disposable homeserver. The plugin's message link
// takes https://example.org/items/<id>: a click on such a link in a message shows its card,
// "Example item <id>", in a menu at the link, in place of opening the link. Escape closes the card
// and the focus goes back to the link, Enter on the focused link shows it again, and its button,
// "Show item in panel", opens the plugin's panel and closes the card. A click with Ctrl opens the
// link in a new page as usual, with no card. MESSAGE_LINK_SHOTS=1 saves a screenshot of the open
// card to test-results/message-link/card.png.
// Its second message link, https://example.org/panel-items/<id>, opens the plugin's panel on the
// item instead: a click shows "Example panel item <id>" in the panel and no card, a second click on
// the link the panel shows opens it in a new page, and Enter on another such link shows that item.
// On a phone a tap shows the card.
const PLUGIN = resolve('src/app/plugins/__fixtures__/example-plugin');
const RUN = Date.now().toString(36);
const ITEM = 'https://example.org/items/7';
const PANEL_ITEM = 'https://example.org/panel-items/3';
const OTHER_PANEL_ITEM = 'https://example.org/panel-items/4';

test.use({ viewport: { width: 1440, height: 900 }, video: 'off' });

let build: string | undefined;

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  test.setTimeout(10 * 60_000);
  build = mkdtempSync(join(tmpdir(), 'mindroom-plugin-message-link-build-'));
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

test("a click on an example item link shows the plugin's card, which a modified click does not", async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(10 * 60_000);
  const person = await registerDisposableUser(`plugin_link_${RUN}`, 'plugin-link-pass');
  const room = await createPrivateRoom(HOMESERVER, person.accessToken, {
    name: 'Orchard',
    topic: 'Where the example plugin shows a link card',
  });
  await sendRoomMessage(HOMESERVER, person.accessToken, room, {
    msgtype: 'm.text',
    body: `See ${ITEM}`,
  });
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  // Nothing leaves the machine: the link, where it opens, answers empty.
  await context.route('https://example.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '' })
  );
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...person });
    await page.goto(`/home/${encodeURIComponent(room)}/`);
    const link = page.getByRole('link', { name: ITEM });
    await expect(link).toBeVisible({ timeout: 60_000 });
    const card = page.getByText('Example item 7');

    await link.click();
    await expect(card).toBeVisible();
    await expect(page.getByRole('menu').filter({ hasText: 'Example item 7' })).toBeVisible();
    expect(page.url()).toContain('/home/');
    if (process.env.MESSAGE_LINK_SHOTS === '1') {
      mkdirSync('test-results/message-link', { recursive: true });
      await page.screenshot({ path: 'test-results/message-link/card.png' });
    }

    await page.keyboard.press('Escape');
    await expect(card).toHaveCount(0);
    await expect(link).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(card).toBeVisible();

    await page.getByRole('button', { name: 'Show item in panel' }).click();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Example panel', exact: true })).toBeVisible();

    const opened = context.waitForEvent('page');
    await link.click({ modifiers: ['Control'] });
    const tab = await opened;
    await tab.waitForLoadState();
    expect(tab.url()).toBe(ITEM);
    await expect(card).toHaveCount(0);
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
    await server.close();
  }
});

test('a click on a panel item link opens the side panel, and a second click opens the link', async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(10 * 60_000);
  const person = await registerDisposableUser(`plugin_link_panel_${RUN}`, 'plugin-link-pass');
  const room = await createPrivateRoom(HOMESERVER, person.accessToken, {
    name: 'Greenhouse',
    topic: 'Where the example plugin opens its panel from a link',
  });
  await sendRoomMessage(HOMESERVER, person.accessToken, room, {
    msgtype: 'm.text',
    body: `See ${PANEL_ITEM} and ${OTHER_PANEL_ITEM}`,
  });
  const server = await serveBuild(build!);
  const context = await browser.newContext({ baseURL: server.origin });
  // Nothing leaves the machine: the link, where it opens, answers empty.
  await context.route('https://example.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '' })
  );
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, ...person });
    await page.goto(`/home/${encodeURIComponent(room)}/`);
    const link = page.getByRole('link', { name: PANEL_ITEM, exact: true });
    await expect(link).toBeVisible({ timeout: 60_000 });
    const panel = page.getByRole('region', { name: 'Example panel', exact: true });
    const item = panel.getByTestId('example-panel-item');
    const card = page.locator('[data-example-item-card]');

    await link.click();
    await expect(item).toHaveText('Example panel item 3');
    await expect(card).toHaveCount(0);
    expect(context.pages()).toHaveLength(1);

    const opened = context.waitForEvent('page');
    await link.click();
    const tab = await opened;
    await tab.waitForLoadState();
    expect(tab.url()).toBe(PANEL_ITEM);
    await tab.close();
    await expect(item).toHaveText('Example panel item 3');
    await expect(card).toHaveCount(0);

    await page.getByRole('link', { name: OTHER_PANEL_ITEM, exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(item).toHaveText('Example panel item 4');
    await expect(card).toHaveCount(0);
    expect(context.pages()).toHaveLength(1);
  } finally {
    await context.unrouteAll({ behavior: 'ignoreErrors' });
    await context.close();
  }

  // On a phone the panel would cover the room, so a tap shows the card.
  const phone = await browser.newContext({
    baseURL: server.origin,
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  await phone.route('https://example.org/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: '' })
  );
  const phonePage = await phone.newPage();
  try {
    await loginWithPassword(phonePage, { homeserver: HOMESERVER, ...person });
    await phonePage.goto(`/home/${encodeURIComponent(room)}/`);
    const link = phonePage.getByRole('link', { name: PANEL_ITEM, exact: true });
    await expect(link).toBeVisible({ timeout: 60_000 });
    await link.tap();
    await expect(phonePage.getByText('Example item 3')).toBeVisible();
    await expect(phonePage.getByTestId('example-panel-item')).toHaveCount(0);
    expect(phone.pages()).toHaveLength(1);
  } finally {
    await phone.unrouteAll({ behavior: 'ignoreErrors' });
    await phone.close();
    await server.close();
  }
});
