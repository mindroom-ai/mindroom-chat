import { mkdirSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// A real right click on a message's text opens the message's menu where the pointer is, in
// Chromium and in WebKit, on a 1280 by 800 desktop. Safari (and Chromium on macOS) selects the
// word under the pointer just before the contextmenu event; that selection is the click's, not
// the reader's, so the message menu still opens and the word does not stay selected under it.
// Text the reader selected before the right click, and links, keep the browser's own menu.
// Runs against the disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh;
// the WebKit case runs when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit.
// Set RIGHT_CLICK_SHOTS=<directory> to save the open menu.
const PASSWORD = 'message-right-click-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.RIGHT_CLICK_SHOTS;
const DESKTOP = { width: 1280, height: 800 };

const TOPICS = [
  'The load test passed at 2,100 requests per second, well above the target we set last week.',
  'Security review signs off on Thursday once the token rotation lands in staging.',
  'The API page needs one more pass before the docs ship; two examples still use the old field.',
  'Design wants the empty state to show the keyboard shortcut instead of the long explanation.',
  'Support asked whether the export keeps attachments; it does, as links that expire in a week.',
];
const FIRST = 'The warehouse crew moves the pallets to dock four before the inspection on Friday.';
const SECOND = 'Accounting closes the quarter on Monday, so please file the travel receipts today.';
const THIRD = 'Marketing finished the brochure draft and wants comments on the cover photograph.';
const LINK = 'https://example.org/handbook';
const LINKED = `The onboarding handbook moved to ${LINK} last night.`;

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const register = async (name: string) => {
  const username = `mrc_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

/** 25 other rooms, and a room where a colleague wrote 24 messages, then the four under test. */
const seed = async (engine: string) => {
  const reader = await register(`reader_${engine}`);
  const colleague = await register(`colleague_${engine}`);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, colleague.accessToken, {
    name: 'Operations',
    invite: [reader.userId],
  });
  await joinRoom(HOMESERVER, reader.accessToken, roomId);
  const send = (body: string, extra: Record<string, unknown> = {}) =>
    sendRoomMessage(HOMESERVER, colleague.accessToken, roomId, {
      msgtype: 'm.text',
      body,
      ...extra,
    });
  for (let index = 0; index < 24; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(`${index + 1}. ${TOPICS[index % TOPICS.length]}`);
  }
  const first = await send(FIRST);
  const second = await send(SECOND);
  const linked = await send(LINKED, {
    format: 'org.matrix.custom.html',
    formatted_body: `The onboarding handbook moved to <a href="${LINK}">${LINK}</a> last night.`,
  });
  const third = await send(THIRD);
  return { reader, roomId, ids: { first, second, linked, third } };
};

/** The viewport point at the middle of `word` in `row`'s text. */
const wordPoint = (row: Locator, word: string): Promise<{ x: number; y: number }> =>
  row.evaluate((element, wanted) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(wanted) ?? -1;
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + wanted.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    throw new Error(`"${wanted}" is not in the message`);
  }, word);

type MenuEvent = { prevented: boolean; selected: string };

/** Records each contextmenu event once the app has handled it: kept by the page, and selection. */
const watchContextMenus = (page: Page) =>
  page.evaluate(() => {
    const store = window as unknown as { menuEvents: MenuEvent[] };
    store.menuEvents = [];
    window.addEventListener('contextmenu', (event) => {
      store.menuEvents.push({
        prevented: event.defaultPrevented,
        selected: document.getSelection()?.toString() ?? '',
      });
    });
  });

const lastContextMenu = async (page: Page): Promise<MenuEvent | undefined> =>
  page.evaluate(() => (window as unknown as { menuEvents: MenuEvent[] }).menuEvents.at(-1));

const selectedText = (page: Page): Promise<string> =>
  page.evaluate(() => document.getSelection()?.toString() ?? '');

const rightClicksOpenTheMessageMenu = async (page: Page, engine: string) => {
  const { reader, roomId, ids } = await seed(engine);
  await page.setViewportSize(DESKTOP);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('classic')),
    roomId
  );
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const row = (id: string) => page.locator(`[data-message-id="${id}"]`);
  await expect(row(ids.third)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(1_000);
  await watchContextMenus(page);
  const messageMenu = page.getByRole('menuitem', { name: 'Copy Link' });

  const rightClick = async (id: string, word: string) => {
    const point = await wordPoint(row(id), word);
    await page.mouse.move(point.x, point.y);
    await page.mouse.click(point.x, point.y, { button: 'right' });
  };

  // A right click on a word of a message's text opens the message's menu, and leaves no word
  // selected under it.
  for (const [id, word] of [
    [ids.first, 'pallets'],
    [ids.second, 'receipts'],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop
    await rightClick(id, word);
    // eslint-disable-next-line no-await-in-loop
    await expect(
      messageMenu,
      `${engine}: right click on "${word}" opens the message menu`
    ).toBeVisible();
    // eslint-disable-next-line no-await-in-loop
    expect(
      await lastContextMenu(page),
      `${engine}: the page keeps the right click on "${word}"`
    ).toEqual({ prevented: true, selected: '' });
    // eslint-disable-next-line no-await-in-loop
    expect(await selectedText(page), `${engine}: no word stays selected`).toBe('');
    if (SHOTS && word === 'pallets') {
      mkdirSync(SHOTS, { recursive: true });
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({ path: `${SHOTS}/right-click-${engine}.png` });
    }
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Escape');
    // eslint-disable-next-line no-await-in-loop
    await expect(messageMenu).toBeHidden();
  }

  // Text the reader selected (a double click selects a word) keeps the browser's menu, to copy it.
  const brochure = await wordPoint(row(ids.third), 'brochure');
  await page.mouse.dblclick(brochure.x, brochure.y);
  const selected = (await selectedText(page)).trim();
  expect(selected, `${engine}: the double click selected the word`).toBe('brochure');
  await page.mouse.click(brochure.x, brochure.y, { button: 'right' });
  await page.waitForTimeout(500);
  expect((await lastContextMenu(page))?.prevented, `${engine}: the browser keeps its menu`).toBe(
    false
  );
  await expect(messageMenu).toHaveCount(0);
  expect((await selectedText(page)).trim(), `${engine}: the selection stays`).toBe('brochure');
  await page.evaluate(() => document.getSelection()?.removeAllRanges());

  // A link keeps the browser's menu, to open or copy it.
  const link = row(ids.linked).getByRole('link', { name: LINK });
  await expect(link).toBeVisible();
  const linkBox = await link.boundingBox();
  if (!linkBox) throw new Error('the link has no box');
  await page.mouse.click(linkBox.x + linkBox.width / 2, linkBox.y + linkBox.height / 2, {
    button: 'right',
  });
  await page.waitForTimeout(500);
  expect((await lastContextMenu(page))?.prevented, `${engine}: a link keeps its menu`).toBe(false);
  await expect(messageMenu).toHaveCount(0);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'a right click on message text opens the message menu, desktop';

test(`${TITLE} (Chromium)`, async ({ page }) => {
  test.setTimeout(180_000);
  await rightClicksOpenTheMessageMenu(page, 'chromium');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: DESKTOP, baseURL });
    const page = await context.newPage();
    try {
      await rightClicksOpenTheMessageMenu(page, 'webkit');
    } catch (error) {
      await page
        .screenshot({ path: test.info().outputPath('webkit-failure.png') })
        .catch(() => undefined);
      throw error;
    }
  } finally {
    await browser.close();
  }
});
