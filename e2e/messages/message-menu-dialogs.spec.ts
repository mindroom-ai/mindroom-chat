import { mkdirSync } from 'node:fs';
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
import { touch } from '../helpers/touch';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Choosing an entry of a message's menu that opens a dialog (View Reactions, Read Receipts, View
// Source, Delete, Report Message) closes the menu: it does not stay open behind the dialog, where
// it was drawn at the window's top-left corner, nor come back once the dialog closes. The menu
// opens with real input: a right click and the More Options button on a desktop (1280 by 800), a
// long press and a tap on More Options on a phone (390 by 844, touch). Against the disposable
// homeserver of a slot, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit. Set MENU_DIALOG_SHOTS=<directory> to save each open dialog.
const PASSWORD = 'message-menu-dialogs-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.MENU_DIALOG_SHOTS;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const TOPICS = [
  'The load test passed at 2,100 requests per second, well above the target we set last week.',
  'Security review signs off on Thursday once the token rotation lands in staging.',
  'The API page needs one more pass before the docs ship; two examples still use the old field.',
  'Design wants the empty state to show the keyboard shortcut instead of the long explanation.',
  'Support asked whether the export keeps attachments; it does, as links that expire in a week.',
];
const TARGET = 'The warehouse crew moves the pallets to dock four before the inspection on Friday.';

/** Each menu entry that opens a dialog, and something only that dialog shows. */
const ENTRIES: Array<[string, (page: Page) => Locator]> = [
  ['View Reactions', (page) => page.getByText(/^Reacted with /)],
  ['Read Receipts', (page) => page.getByText('Seen by', { exact: true })],
  ['View Source', (page) => page.getByText('Source Code', { exact: true })],
  ['Delete', (page) => page.getByRole('dialog', { name: 'Delete Message' })],
  ['Report Message', (page) => page.getByRole('dialog', { name: 'Report Message' })],
];

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const register = (name: string) => registerDisposableUser(`mmd_${name}_${RUN}`, PASSWORD);

/**
 * 25 other rooms, and a room the reader created (so they may delete) where a colleague wrote 24
 * messages and then the one under test, which the colleague reacted to (so the reader may report
 * it and view its reactions).
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

/** Where every message menu on the page is, for a failure message. */
const menuBoxes = (page: Page) =>
  page
    .getByRole('menu')
    .evaluateAll((menus) =>
      menus.map((menu) => {
        const { left, top, width, height } = menu.getBoundingClientRect();
        return { left, top, width, height };
      })
    );

const check = async (page: Page, world: World, label: string, phone: boolean) => {
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
  const more = row.getByRole('button', { name: 'More Options', exact: true });
  const menu = page.getByRole('menu');

  const openers: Array<[string, () => Promise<unknown>]> = phone
    ? [
        [
          // Off the text, at the row's empty start: a long press on the text selects it instead.
          'long press',
          () =>
            touch(
              row,
              [{ type: 'start' }, { type: 'wait', ms: 800 }, { type: 'end' }],
              'start'
            ),
        ],
        [
          'More Options',
          async () => {
            await text.tap();
            await more.tap();
          },
        ],
      ]
    : [
        [
          'right click',
          async () => {
            const box = await text.boundingBox();
            if (!box) throw new Error('the message has no box');
            await page.mouse.move(box.x + 40, box.y + box.height / 2);
            await page.mouse.click(box.x + 40, box.y + box.height / 2, { button: 'right' });
          },
        ],
        [
          'More Options',
          async () => {
            await text.hover();
            await more.click();
          },
        ],
      ];

  for (const [opener, open] of openers) {
    for (const [entry, dialogOf] of ENTRIES) {
      const step = `${label}, ${opener}, ${entry}`;
      // eslint-disable-next-line no-await-in-loop
      await open();
      // eslint-disable-next-line no-await-in-loop
      await expect(menu, `${step}: the menu opens`).toHaveCount(1);
      const item = menu.getByRole('menuitem', { name: entry, exact: true });
      // eslint-disable-next-line no-await-in-loop
      await (phone ? item.tap() : item.click());
      const dialog = dialogOf(page);
      // eslint-disable-next-line no-await-in-loop
      await expect(dialog, `${step}: the dialog opens`).toBeVisible();
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(300);
      if (SHOTS && opener === openers[0]?.[0] && entry === 'View Reactions') {
        mkdirSync(SHOTS, { recursive: true });
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({ path: `${SHOTS}/${label}-reactions.png` });
      }
      // eslint-disable-next-line no-await-in-loop
      expect(await menuBoxes(page), `${step}: no menu stays open behind the dialog`).toEqual([]);
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('Escape');
      // eslint-disable-next-line no-await-in-loop
      await expect(dialog, `${step}: Escape closes the dialog`).toBeHidden();
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(300);
      // eslint-disable-next-line no-await-in-loop
      expect(await menuBoxes(page), `${step}: the menu does not come back`).toEqual([]);
    }
  }
  // Nothing was deleted: Escape left the confirmation.
  await expect(text).toBeVisible();
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop
    const context = await browser.newContext({ ...options, baseURL });
    try {
      // eslint-disable-next-line no-await-in-loop
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      // eslint-disable-next-line no-await-in-loop
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      // eslint-disable-next-line no-await-in-loop
      await check(page, world, `${engine}-${viewport}`, viewport === 'phone');
      expect(pageErrors, `uncaught errors in ${engine} ${viewport}`).toEqual([]);
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'a message menu entry that opens a dialog closes the menu';

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
