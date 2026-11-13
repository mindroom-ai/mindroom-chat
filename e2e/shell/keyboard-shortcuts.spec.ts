import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword, openAccountMenu } from '../helpers/auth';
import { joinRoom, sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// The first batch of keyboard shortcuts against the disposable homeserver of `just hs-up` (or a
// slot of scripts/e2e-slot.sh): each chord does its action, a composer with text keeps its own
// keys, a focused room row moves with Mod+Shift and the arrows, tooltips name the keys, and
// holding Mod alone shows the hints. Mod is ⌘ on a Mac host, where the page says macOS
// (playwright.config.ts) and Playwright's ControlOrMeta presses ⌘, and Ctrl elsewhere. Set
// SHORTCUT_SHOTS=<dir> to also save the L23 screenshots.
const PASSWORD = 'keyboard-shortcuts-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.SHORTCUT_SHOTS;
const ROOM_COUNT = 26;
const UNREAD = [5, 17];
const THREAD_ROOM = 3;
const MAC = process.platform === 'darwin';
const MOD = MAC ? 'Meta' : 'Control';

type Account = MatrixSession & { username: string };

const registerAndLogin = (name: string): Promise<Account> =>
  registerDisposableUser(`l23_${name}_${RUN}`, PASSWORD);

const roomName = (index: number) => `Room ${String(index).padStart(2, '0')}`;

/** The room the route opens. */
const openRoom = (page: Page): string =>
  decodeURIComponent(new URL(page.url()).pathname.split('/')[2] ?? '');

const goToRoom = async (page: Page, roomId: string, threadId?: string) => {
  const search = threadId ? `?threadId=${encodeURIComponent(threadId)}` : '';
  await page.goto(`/home/${encodeURIComponent(roomId)}/${search}`);
  await expect(composer(page)).toBeVisible({ timeout: 30_000 });
};

const composer = (page: Page) => page.locator('[data-room-footer]').getByRole('textbox');
/** The composer's text, without its placeholder and the fillers of empty lines. */
const composerText = (page: Page) =>
  composer(page).evaluate((element) => {
    const copy = element.cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll('[data-slate-placeholder]')
      .forEach((placeholder) => placeholder.remove());
    return (copy.textContent ?? '').replace(/[\u200B\uFEFF]/g, '');
  });
const homeRow = (page: Page, roomId: string) =>
  page.getByRole('navigation', { name: 'Home', exact: true }).locator(`[data-room-id="${roomId}"]`);
const homeOrder = (page: Page) =>
  page
    .getByRole('navigation', { name: 'Home', exact: true })
    .locator('[data-room-id]')
    .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-room-id')));
const membersButton = (page: Page) => page.getByRole('button', { name: /^(Show|Hide) Members$/ });
const banner = (page: Page) => page.locator('[data-thread-context-banner]');
const hints = (page: Page) => page.locator('[data-shortcut-hint]');

/** Moves the focus off every field and control, as after a click on the page's background. */
const blur = (page: Page) =>
  page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
  });

/** Nothing happened after a key: give the app a moment to act on it first. */
const settle = (page: Page) => page.waitForTimeout(400);

// Headless Chromium hides scrollbars; desktop browsers with classic scrollbars show them. The
// other launch options repeat playwright.config.ts.
test.use({
  launchOptions: {
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

test('the first batch of keyboard shortcuts', async ({ page, context }) => {
  test.setTimeout(300_000);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const me = await registerAndLogin('me');
  const peer = await registerAndLogin('peer');

  const rooms: string[] = [];
  for (let index = 1; index <= ROOM_COUNT; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const roomId = await createRoom(HOMESERVER, me.accessToken, {
      name: roomName(index),
      preset: UNREAD.includes(index) ? 'public_chat' : undefined,
    });
    rooms.push(roomId);
  }
  const room = (index: number) => rooms[index - 1]!;
  // Two rooms where someone else wrote last: they show as unread.
  for (const index of UNREAD) {
    // eslint-disable-next-line no-await-in-loop
    await joinRoom(HOMESERVER, peer.accessToken, room(index));
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, peer.accessToken, room(index), {
      msgtype: 'm.text',
      body: `Unread news in ${roomName(index)}`,
    });
  }
  const rootId = await sendRoomMessage(HOMESERVER, me.accessToken, room(THREAD_ROOM), {
    msgtype: 'm.text',
    body: 'A thread to resolve',
  });
  await sendRoomMessage(HOMESERVER, me.accessToken, room(THREAD_ROOM), {
    msgtype: 'm.text',
    body: 'Its first reply',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: me.username,
    password: PASSWORD,
  });
  await expect(homeRow(page, room(1))).toBeVisible({ timeout: 30_000 });

  await test.step('Alt with the arrows opens the room above or below', async () => {
    await goToRoom(page, room(10));
    await blur(page);
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => openRoom(page)).toBe(room(11));
    await blur(page);
    await page.keyboard.press('Alt+ArrowUp');
    await expect.poll(() => openRoom(page)).toBe(room(10));
  });

  await test.step('in an empty composer, Alt and the down arrow opens the next room', async () => {
    await composer(page).click();
    await expect(composer(page)).toBeFocused();
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => openRoom(page)).toBe(room(11));
  });

  await test.step('Alt, Shift and the arrows open the nearest unread room', async () => {
    await expect(
      page.locator('[data-highlight="true"]').filter({
        has: page.getByRole('link', { name: roomName(UNREAD[0]!) }),
      })
    ).toHaveCount(1, { timeout: 30_000 });
    await blur(page);
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await expect.poll(() => openRoom(page)).toBe(room(17));
    await blur(page);
    await page.keyboard.press('Alt+Shift+ArrowUp');
    await expect.poll(() => openRoom(page)).toBe(room(5));
  });

  await test.step('a composer with text keeps its own keys', async () => {
    await goToRoom(page, room(10));
    await composer(page).click();
    await page.keyboard.type('hello world');
    await expect.poll(() => composerText(page)).toBe('hello world');

    // Alt and the arrows move by paragraph in text, so the room stays.
    await page.keyboard.press('Alt+ArrowUp');
    await settle(page);
    expect(openRoom(page)).toBe(room(10));

    // Select all, copy and paste work as everywhere else.
    await page.keyboard.press('ControlOrMeta+a');
    await expect
      .poll(() => page.evaluate(() => window.getSelection()?.toString()))
      .toBe('hello world');
    await page.keyboard.press('ControlOrMeta+c');
    await page.keyboard.press('End');
    await page.keyboard.press('ControlOrMeta+v');
    await expect.poll(() => composerText(page)).toBe('hello worldhello world');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(openRoom(page)).toBe(room(10));

    // A chord without a text meaning still works from the composer, and the text stays.
    await page.keyboard.press('ControlOrMeta+,');
    const settings = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Settings' }) });
    await expect(settings).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);
    await expect.poll(() => composerText(page)).toBe('hello worldhello world');
  });

  await test.step('Mod, Shift and Enter resolves the open thread, never from a composer with text', async () => {
    await goToRoom(page, room(THREAD_ROOM), rootId);
    await expect(banner(page)).toBeVisible({ timeout: 30_000 });
    const resolve = banner(page).getByRole('button', { name: 'Resolve', exact: true });
    const resolved = banner(page).getByRole('button', { name: 'Resolved', exact: true });
    await expect(resolve).toBeVisible({ timeout: 30_000 });

    await composer(page).click();
    await page.keyboard.type('draft');
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await settle(page);
    await expect(resolve).toBeVisible();
    await expect.poll(() => composerText(page)).toContain('draft');
    // Under load Chromium can deliver Backspace before the select-all's selectionchange event, so
    // the editor deletes at its old caret (as in thread-arrow-up-edit.spec.ts); clear until empty.
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+a');
      await page.keyboard.press('Backspace');
      expect(await composerText(page)).toBe('');
    }).toPass({ timeout: 10_000 });

    // From the empty composer it resolves, and again reopens.
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await expect(resolved).toBeVisible();
    // Like the button, the shortcut waits for the save: it acts again once the button does.
    await expect(resolved).toBeEnabled();
    await page.keyboard.press('ControlOrMeta+Shift+Enter');
    await expect(resolve).toBeVisible();
  });

  await test.step('a focused room row moves with Mod, Shift and the arrows; Alt opens the next room', async () => {
    await goToRoom(page, room(1));
    await homeRow(page, room(2)).getByRole('link').focus();
    await page.keyboard.press('ControlOrMeta+Shift+ArrowDown');
    await expect
      .poll(async () => (await homeOrder(page)).slice(0, 3))
      .toEqual([room(1), room(3), room(2)]);
    await expect(homeRow(page, room(2)).getByRole('link')).toBeFocused();
    // Alt and the down arrow on the same row opens the room after the open one instead.
    await page.keyboard.press('Alt+ArrowDown');
    await expect.poll(() => openRoom(page)).toBe(room(3));
    expect((await homeOrder(page)).slice(0, 3)).toEqual([room(1), room(3), room(2)]);
  });

  await test.step('Escape outside a field goes back to the composer', async () => {
    await homeRow(page, room(4)).getByRole('link').focus();
    await page.keyboard.press('Escape');
    await expect(composer(page)).toBeFocused();
  });

  await test.step('Mod and comma opens Settings; Mod and slash shows and hides the shortcuts', async () => {
    await blur(page);
    await page.keyboard.press('ControlOrMeta+,');
    const settings = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Settings' }) });
    await expect(settings).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(settings).toHaveCount(0);

    // The account menu's Settings shows the keys beside its name, not in it.
    await openAccountMenu(page);
    const settingsItem = page.getByRole('menuitem', { name: 'Settings', exact: true });
    await expect(settingsItem).toHaveText('Settings');
    await expect(settingsItem).toHaveAttribute('aria-keyshortcuts', `${MOD}+,`);
    expect(
      await settingsItem
        .locator('[data-keys]')
        .evaluate((hint) => getComputedStyle(hint, '::after').content)
    ).toBe(MAC ? '"⌘,"' : '"Ctrl+,"');
    await page.keyboard.press('Escape');
    await expect(settingsItem).toHaveCount(0);

    await page.keyboard.press('ControlOrMeta+/');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help).toBeVisible();
    await expect(help.locator('[data-shortcut-row="members"]')).toContainText(MAC ? '⌘' : 'Ctrl');
    await page.keyboard.press('ControlOrMeta+/');
    await expect(help).toHaveCount(0);
  });

  await test.step('Mod, Shift and F opens the palette on Messages', async () => {
    await blur(page);
    await page.keyboard.press('ControlOrMeta+Shift+F');
    const palette = page.getByRole('dialog', { name: 'Command palette', exact: true });
    await expect(palette).toBeVisible();
    await expect(palette.getByRole('tab', { selected: true })).toHaveText('Messages');
    await page.keyboard.press('Escape');
    await expect(palette).toHaveCount(0);
  });

  await test.step('Mod and backslash hides and shows the room list', async () => {
    const nav = page.getByRole('navigation', { name: 'Home', exact: true });
    await blur(page);
    await page.keyboard.press('ControlOrMeta+\\');
    await expect(nav).toHaveCount(0);
    await page.keyboard.press('ControlOrMeta+\\');
    await expect(nav).toBeVisible();
  });

  await test.step('Mod, Shift and M shows and hides the members', async () => {
    await blur(page);
    const before = await membersButton(page).getAttribute('aria-label');
    await page.keyboard.press('ControlOrMeta+Shift+M');
    await expect(membersButton(page)).not.toHaveAttribute('aria-label', before ?? '');
    await page.keyboard.press('ControlOrMeta+Shift+M');
    await expect(membersButton(page)).toHaveAttribute('aria-label', before ?? '');
  });

  await test.step("the members button's tooltip names its keys", async () => {
    await expect(membersButton(page)).toHaveAttribute('aria-keyshortcuts', `${MOD}+Shift+M`);
    await membersButton(page).hover();
    const tooltip = page.getByRole('tooltip').filter({ hasText: 'Members' });
    await expect(tooltip).toContainText(MAC ? '⌘⇧M' : 'Ctrl+Shift+M');
    if (SHOTS) {
      const button = (await membersButton(page).boundingBox())!;
      const tip = (await tooltip.boundingBox())!;
      const left = Math.min(button.x, tip.x) - 16;
      const top = Math.max(0, button.y - 16);
      await page.screenshot({
        path: `${SHOTS}/L23-shortcuts-tooltip.png`,
        clip: {
          x: left,
          y: top,
          width: Math.max(button.x + button.width, tip.x + tip.width) + 16 - left,
          height: tip.y + tip.height + 16 - top,
        },
      });
    }
    await page.mouse.move(640, 760);
    await expect(tooltip).toHaveCount(0);
  });

  await test.step('holding Mod alone for a second shows the hints', async () => {
    await blur(page);
    await page.keyboard.down(MOD);
    await page.waitForTimeout(1_200);
    await expect(page.locator('[data-shortcut-hint="members"]')).toBeVisible();
    await expect(page.locator('[data-shortcut-hint-chip]')).toContainText(MAC ? '⌘/' : 'Ctrl+/');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/L23-shortcuts-hints.png` });
    await page.keyboard.up(MOD);
    await expect(hints(page)).toHaveCount(0);
  });

  await test.step('Mod and C within the second never shows them', async () => {
    await blur(page);
    await page.keyboard.down(MOD);
    await page.waitForTimeout(300);
    await page.keyboard.press('KeyC');
    await page.waitForTimeout(1_200);
    await expect(hints(page)).toHaveCount(0);
    await page.keyboard.up(MOD);
    await expect(hints(page)).toHaveCount(0);
  });

  await test.step('the switch in the shortcuts dialog turns the hints off', async () => {
    await blur(page);
    await page.keyboard.press('ControlOrMeta+/');
    const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(help).toBeVisible();
    if (SHOTS) await help.screenshot({ path: `${SHOTS}/L23-shortcuts-help.png` });
    const toggle = help.getByRole('switch', { name: /Show shortcut hints/ });
    await expect(toggle).toHaveAttribute('aria-checked', 'true');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-checked', 'false');
    await page.keyboard.press('Escape');
    await expect(help).toHaveCount(0);

    await blur(page);
    await page.keyboard.down(MOD);
    await page.waitForTimeout(1_500);
    await expect(hints(page)).toHaveCount(0);
    await page.keyboard.up(MOD);
  });
});
