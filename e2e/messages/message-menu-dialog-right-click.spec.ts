import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, sendReaction, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A right click inside a dialog that a message's menu opened (View Reactions, Read Receipts, View
// Source, Report Message) is the dialog's: the browser's own menu opens, to copy the event ID from
// the source, say. The dialog sits in a portal inside the message row, and React passed the click up
// to the row, which prevented the browser's menu and moved the message menu to the pointer. Real
// right clicks on a desktop (1280 by 800), against the disposable homeserver of a slot, in Chromium
// and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const PASSWORD = 'message-menu-dialog-right-click-spec-password';
const RUN = Date.now().toString(36);

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const TOPICS = [
  'The load test passed at 2,100 requests per second, well above the target we set last week.',
  'Security review signs off on Thursday once the token rotation lands in staging.',
  'The API page needs one more pass before the docs ship; two examples still use the old field.',
  'Design wants the empty state to show the keyboard shortcut instead of the long explanation.',
  'Support asked whether the export keeps attachments; it does, as links that expire in a week.',
];
const TARGET = 'The warehouse crew moves the pallets to dock four before the inspection on Friday.';

/** Each menu entry that opens a dialog, and text inside that dialog to right click. */
const ENTRIES: Array<[string, (page: Page) => Locator]> = [
  ['View Reactions', (page) => page.getByText(/^Reacted with /)],
  ['Read Receipts', (page) => page.getByText('Seen by', { exact: true })],
  ['View Source', (page) => page.getByText(/"event_id": "\$/)],
  [
    'Report Message',
    (page) =>
      page.getByRole('dialog', { name: 'Report Message' }).getByText('Report Message').first(),
  ],
];

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const register = (name: string) => registerDisposableUser(`mdrc_${name}_${RUN}`, PASSWORD);

/**
 * 25 other rooms, and a room where a colleague wrote 24 messages and then the one under test,
 * which the colleague reacted to (so the reader may report it and view its reactions).
 */
const seed = async (engine: string) => {
  const reader = await register(`reader_${engine}`);
  const colleague = await register(`colleague_${engine}`);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Operations',
    invite: [colleague.userId],
  });
  await joinRoom(HOMESERVER, colleague.accessToken, roomId);
  for (let index = 0; index < 24; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, {
      msgtype: 'm.text',
      body: `${index + 1}. ${TOPICS[index % TOPICS.length]}`,
    });
  }
  const target = await sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, {
    msgtype: 'm.text',
    body: TARGET,
  });
  await sendReaction(HOMESERVER, colleague.accessToken, roomId, target, '👍');
  return { reader, roomId, target };
};

type World = Awaited<ReturnType<typeof seed>>;

/** Where every message menu on the page is. */
const menuBoxes = (page: Page) =>
  page.getByRole('menu').evaluateAll((menus) =>
    menus.map((menu) => {
      const { left, top, width, height } = menu.getBoundingClientRect();
      return { left, top, width, height };
    })
  );

/** A real right click on the middle of `target`. */
const rightClick = async (page: Page, target: Locator) => {
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to right click');
  const x = box.x + Math.min(40, box.width / 2);
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.click(x, y, { button: 'right' });
};

/** Whether the page prevented the browser's menu for each contextmenu since the last read. */
const takeContextMenus = (page: Page) =>
  page.evaluate(() => {
    const log = (window as unknown as { contextMenus: boolean[] }).contextMenus;
    return log.splice(0, log.length);
  });

const check = async (page: Page, world: World, label: string) => {
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('classic')),
    world.roomId
  );
  await page.goto(`/home/${encodeURIComponent(world.roomId)}`);
  const row = page.locator(`[data-message-id="${world.target}"]`).first();
  const text = row.getByText(TARGET);
  await expect(text).toBeVisible({ timeout: 60_000 });
  await expect(row.getByRole('button').filter({ hasText: '👍' })).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1_000);
  const menu = page.getByRole('menu');

  for (const [entry, inside] of ENTRIES) {
    const step = `${label}, ${entry}`;
    // The message's own menu opens on a right click on the message.
    // eslint-disable-next-line no-await-in-loop
    await rightClick(page, text);
    // eslint-disable-next-line no-await-in-loop
    await expect(menu, `${step}: the menu opens`).toHaveCount(1);
    // eslint-disable-next-line no-await-in-loop
    expect(await takeContextMenus(page), `${step}: the row takes its right click`).toEqual([true]);
    // eslint-disable-next-line no-await-in-loop
    await menu.getByRole('menuitem', { name: entry, exact: true }).click();
    const target = inside(page);
    // eslint-disable-next-line no-await-in-loop
    await expect(target, `${step}: the dialog opens`).toBeVisible();
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(300);
    // eslint-disable-next-line no-await-in-loop
    const before = await menuBoxes(page);
    // eslint-disable-next-line no-await-in-loop
    await rightClick(page, target);
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(300);
    // eslint-disable-next-line no-await-in-loop
    expect(await takeContextMenus(page), `${step}: the browser's menu opens`).toEqual([false]);
    // eslint-disable-next-line no-await-in-loop
    expect(await menuBoxes(page), `${step}: the message menu stays where it was`).toEqual(before);
    // eslint-disable-next-line no-await-in-loop
    await expect(target, `${step}: the dialog stays open`).toBeVisible();
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Escape');
    // eslint-disable-next-line no-await-in-loop
    await expect(target, `${step}: Escape closes the dialog`).toBeHidden();
    // eslint-disable-next-line no-await-in-loop
    await expect(menu, `${step}: the menu closes with it`).toHaveCount(0);
  }
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  const context = await browser.newContext({ ...DESKTOP, baseURL });
  try {
    // Records, after React has handled each contextmenu, whether its default was prevented.
    await context.addInitScript(() => {
      const contextMenus: boolean[] = [];
      Object.assign(window, { contextMenus });
      window.addEventListener('contextmenu', (event) => contextMenus.push(event.defaultPrevented));
    });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await check(page, world, engine);
    expect(pageErrors, `uncaught errors in ${engine}`).toEqual([]);
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'a right click inside a dialog the message menu opened keeps the browser menu';

test(`${TITLE} (Chromium)`, async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
