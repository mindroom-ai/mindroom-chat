import fs from 'node:fs';
import path from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { buildLoginPath } from '../env';
import { createPrivateRoom, joinRoom, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Every menu reachable from the main views is a WAI-ARIA menu: `getByRole('menu')` finds it while
// it is open, its rows are menu items, the first row takes focus as it opens from the keyboard
// (ArrowDown goes into a menu opened with a pointer), ArrowDown and ArrowUp move between the rows
// (wrapping at the ends), Home and End jump to the first and last, Escape closes it and gives
// focus back to the button it opened from, and axe-core finds nothing critical or serious in it. Desktop and phone, Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit, WebKit, against the disposable homeserver of `just hs-up` or of a
// slot of scripts/e2e-slot.sh.
const PASSWORD = 'menu-semantics-spec-password';
const RUN = Date.now().toString(36);
const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const AXE_PATH = path.join(process.cwd(), 'node_modules/axe-core/axe.min.js');
const STARTUP_MS = 120_000;

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const register = (name: string) => registerDisposableUser(`menus_${name}_${RUN}`, PASSWORD);

const NOTE = 'The crane schedule for berth four is posted.';

/** A room with a note from another account, which the reader opens. */
const seed = async (name: string) => {
  const reader = await register(`${name}_reader`);
  const writer = await register(`${name}_writer`);
  const roomName = `Berth desk ${name} ${RUN}`;
  const roomId = await createPrivateRoom(HOMESERVER, reader.accessToken, {
    name: roomName,
    topic: 'Crane and berth planning',
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
    msgtype: 'm.text',
    body: NOTE,
  });
  return { reader, roomId, roomName };
};

const signIn = async (page: Page, username: string, roomId: string) => {
  await page.goto(buildLoginPath(HOMESERVER));
  await page.locator('input[name="usernameInput"]').fill(username, { timeout: STARTUP_MS });
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/(home|inbox|direct)\//, { timeout: STARTUP_MS });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(page.getByText(NOTE)).toBeVisible({ timeout: STARTUP_MS });
};

/** Which row of the open menu has focus: its index, or -1. */
const focusedRow = (menu: Locator) =>
  menu.evaluate((element) => {
    const rows = Array.from(
      element.querySelectorAll(
        '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
      )
    ).filter((row) => row.closest('[role="menu"]') === element);
    return rows.findIndex((row) => row.contains(document.activeElement));
  });

const rowCount = (menu: Locator) =>
  menu.evaluate(
    (element) =>
      Array.from(
        element.querySelectorAll(
          '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
        )
      ).filter(
        (row) => row.closest('[role="menu"]') === element && row.getClientRects().length > 0
      ).length
  );

/** Critical and serious axe-core findings inside the open menu. */
const axeFindings = async (page: Page, menu: Locator): Promise<string[]> => {
  await page.addScriptTag({ path: AXE_PATH });
  const handle = await menu.elementHandle();
  return page.evaluate(async (element) => {
    type AxeResult = {
      violations: { id: string; impact: string | null; nodes: { html: string }[] }[];
    };
    const { axe } = window as unknown as {
      axe: { run: (context: Element) => Promise<AxeResult> };
    };
    const result = await axe.run(element!);
    return result.violations
      .filter((violation) => violation.impact === 'critical' || violation.impact === 'serious')
      .flatMap((violation) =>
        violation.nodes.map((node) => `${violation.id}: ${node.html.slice(0, 200)}`)
      );
  }, handle);
};

/**
 * Walks the menu that `open` opens: roles, focus on the first row, the arrow keys, Home, End,
 * axe-core, and Escape. With a `trigger`, the menu opens from the keyboard and Escape gives focus
 * back to it; without one, it opens with a pointer.
 */
const walkMenu = async (
  page: Page,
  label: string,
  open: () => Promise<void>,
  trigger?: Locator
) => {
  await open();
  const menu = page.getByRole('menu');
  await expect(menu, `${label}: one open menu`).toHaveCount(1);
  await expect(menu).toBeVisible();
  const rows = await rowCount(menu);
  expect(rows, `${label}: menu items`).toBeGreaterThan(0);
  if (trigger) {
    // Opened from the keyboard, the first row takes focus.
    await expect.poll(() => focusedRow(menu), { message: `${label}: first row` }).toBe(0);
  } else {
    // Opened with a pointer, focus stays put and ArrowDown goes into the menu.
    expect(await focusedRow(menu), `${label}: focus stays put`).toBe(-1);
    await page.keyboard.press('ArrowDown');
    await expect.poll(() => focusedRow(menu), { message: `${label}: into the menu` }).toBe(0);
  }

  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focusedRow(menu), { message: `${label}: ArrowDown` }).toBe(1 % rows);
  await page.keyboard.press('End');
  await expect.poll(() => focusedRow(menu), { message: `${label}: End` }).toBe(rows - 1);
  await page.keyboard.press('ArrowDown');
  await expect.poll(() => focusedRow(menu), { message: `${label}: wraps down` }).toBe(0);
  await page.keyboard.press('ArrowUp');
  await expect.poll(() => focusedRow(menu), { message: `${label}: wraps up` }).toBe(rows - 1);
  await page.keyboard.press('Home');
  await expect.poll(() => focusedRow(menu), { message: `${label}: Home` }).toBe(0);

  if (fs.existsSync(AXE_PATH)) expect(await axeFindings(page, menu), label).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(menu, `${label}: Escape closes`).toHaveCount(0);
  if (trigger) await expect(trigger, `${label}: focus back`).toBeFocused();
};

/** Focuses `button` and presses Enter, as a keyboard reader opens a menu. */
const pressOpen = (page: Page, button: Locator) => async () => {
  await button.focus();
  await page.keyboard.press('Enter');
};

const desktopMenus = async (page: Page, name: string) => {
  const { reader, roomId, roomName } = await seed(`d${name}`);
  await signIn(page, reader.username, roomId);

  const homeOptions = page.getByRole('button', { name: 'Home Options', exact: true });
  await walkMenu(page, 'Home Options', pressOpen(page, homeOptions), homeOptions);

  const headerOptions = page
    .getByRole('main')
    .getByRole('button', { name: 'More Options', exact: true })
    .first();
  await walkMenu(page, 'room header', pressOpen(page, headerOptions), headerOptions);
  await walkMenu(page, 'room header (pointer)', () => headerOptions.click());

  const roomLink = page.getByRole('navigation', { name: 'Home' }).getByRole('link', {
    name: roomName,
  });
  await roomLink.hover();
  const rowOptions = page
    .getByRole('navigation', { name: 'Home' })
    .locator('button[aria-label="More Options"]:visible')
    .first();
  await walkMenu(page, 'sidebar room', pressOpen(page, rowOptions), rowOptions);

  const message = page.locator('[data-message-id]', { hasText: NOTE });
  await message.hover();
  const messageOptions = message.getByRole('button', { name: 'More Options', exact: true });
  await walkMenu(page, 'message options', pressOpen(page, messageOptions), messageOptions);

  await walkMenu(page, 'message context menu', () => message.click({ button: 'right' }));

  const account = page.getByRole('button', { name: /^Open account menu for / });
  await walkMenu(page, 'account', pressOpen(page, account), account);
};

const phoneMenus = async (page: Page, name: string) => {
  const { reader, roomId } = await seed(`p${name}`);
  await signIn(page, reader.username, roomId);

  const headerOptions = page
    .getByRole('main')
    .getByRole('button', { name: 'More Options', exact: true })
    .first();
  await walkMenu(page, 'room header (phone)', () => headerOptions.tap());

  // A tap on the message's text shows its options; its middle can be the sender's name, whose
  // touch target opens their profile.
  const message = page.locator('[data-message-id]', { hasText: NOTE });
  await message.getByText(NOTE).tap();
  const messageOptions = message.getByRole('button', { name: 'More Options', exact: true });
  await walkMenu(page, 'message options (phone)', () => messageOptions.tap());
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const CHECKS: Array<[string, typeof DESKTOP, (page: Page, name: string) => Promise<void>]> = [
  ['the menus of the main views are keyboard menus', DESKTOP, desktopMenus],
  ['the menus of a room are menus on a phone', PHONE, phoneMenus],
];

for (const [title, viewport, check] of CHECKS) {
  const touch = viewport === PHONE;
  test(`${title} (Chromium)`, async ({ browser }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ viewport, hasTouch: touch, isMobile: touch });
    try {
      await check(await context.newPage(), 'c');
    } finally {
      await context.close();
    }
  });

  test(`${title} (WebKit)`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(240_000);
    // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
    let own: Browser | undefined;
    try {
      own = await launchWebKit();
      const context = await own.newContext({ viewport, hasTouch: touch, baseURL });
      await check(await context.newPage(), 'w');
    } finally {
      await own?.close();
    }
  });
}
