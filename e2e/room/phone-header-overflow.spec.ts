import { randomUUID } from 'node:crypto';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { sendStateEvent } from '../helpers/matrix';
import {
  AI_RUN,
  PASSWORD,
  PHONE,
  RUN,
  SCHEMES,
  createOtherRooms,
  join,
  register,
  say,
  setLook,
  shot,
  withRetry,
} from '../helpers/designChoices';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  CHROMIUM_WITH_SCROLLBARS,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// A phone's room header keeps the back button, the room's name and the room menu, so a long name
// keeps its room (L8-F025, design decision #10); the menu offers first what the header leaves out:
// the Compact view switch and the filter bar toggle (menu checkboxes), scheduled tasks, pinned
// messages and members, each a row as tall as a message menu's, and the menu stays inside the
// window. Both header buttons keep a 44 px hit area. A desktop header keeps all its buttons. An
// agent room with a long name and a pinned message among 25 rooms, on a phone (390 by 844, touch)
// and a desktop (1280 by 800), light and dark, in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// DESIGN_CHOICES_SHOTS=<directory> to save screenshots.
const ENGINES = ['chromium', ...(WEBKIT_EXECUTABLE ? ['webkit'] : [])] as const;
const ROOM_NAME = 'Customer Escalations and Renewals';
const PINNED = 'Escalation playbook: page the on-call lead first, then the account owner.';
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const MOVED = ['Compact view', 'Thread filters', 'Scheduled tasks (0)', 'Pinned Messages'];
const TARGET = 44;
/** A message menu's row (MenuEntry: folds' MenuItem, size 300), which a room menu's rows match. */
const MENU_ROW = 32;

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

type Seed = { username: string; roomId: string };

const seed = async (label: string): Promise<Seed> => {
  const id = `${label}_${RUN}_${randomUUID().slice(0, 6)}`;
  const tester = await register(`pho_${id}`, 'Robin Tester');
  const helper = await register(`mindroom_helper_${id}`, 'Helper');
  await createOtherRooms(tester);
  const roomId = await withRetry(() =>
    createRoom(HOMESERVER, tester.token, { name: ROOM_NAME, invite: [helper.userId] })
  );
  await join(helper, roomId);
  const pinned = await say(tester, roomId, PINNED);
  await withRetry(() =>
    sendStateEvent(HOMESERVER, tester.token, roomId, 'm.room.pinned_events', '', {
      pinned: [pinned],
    })
  );
  const root = await say(tester, roomId, 'Renewal at risk: the customer asks for a discount.');
  await say(
    helper,
    roomId,
    'I drafted a reply that offers the annual plan instead of a discount; it is ready for review.',
    root,
    AI_RUN
  );
  return { username: tester.username, roomId };
};

const header = (page: Page) => page.getByRole('banner').filter({ has: page.locator('h1') });

const openRoom = async (page: Page, data: Seed) => {
  await page.goto(`/home/${encodeURIComponent(data.roomId)}`);
  await expect(header(page).locator('h1')).toHaveText(ROOM_NAME, { timeout: 30_000 });
  await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 30_000 });
};

/** Whether a tap anywhere in the 44 px square around the control's center lands on it. */
/**
 * The points of the 44 px square around the control's center that a tap would not land on it
 * (empty when the whole square is the control's), each with what it hits instead.
 */
const missedPoints = (control: Locator) =>
  control.evaluate((element, size) => {
    const { left, top, width, height } = element.getBoundingClientRect();
    const x = left + width / 2;
    const y = top + height / 2;
    const reach = size / 2 - 1;
    const points: [string, number, number][] = [
      ['start', x - reach, y],
      ['end', x + reach, y],
      ['top', x, y - reach],
      ['bottom', x, y + reach],
    ];
    return points.flatMap(([at, px, py]) => {
      const hit = document.elementFromPoint(px, py);
      if (hit && element.contains(hit)) return [];
      const what = hit
        ? `${hit.tagName}.${hit.className} "${(hit.textContent ?? '').slice(0, 30)}"`
        : 'nothing';
      return [`${at} (${Math.round(px)}, ${Math.round(py)}): ${what}`];
    });
  }, TARGET);

const roomMenu = (page: Page) => page.getByRole('menu').filter({ hasText: 'Leave Room' });

const openMenu = async (page: Page) => {
  await header(page).getByRole('button', { name: 'More Options', exact: true }).tap();
  await expect(roomMenu(page)).toBeVisible();
};

const entry = (page: Page, name: string) =>
  roomMenu(page)
    .getByRole('menuitem', { name, exact: true })
    .or(roomMenu(page).getByRole('menuitemcheckbox', { name, exact: true }));

const checkPhone = async (page: Page, data: Seed, engine: string, testInfo: TestInfo) => {
  // The touch hit areas apply once the page reports a finger, which some Chromium builds take a
  // moment to do.
  await expect
    .poll(() => page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches), {
      message: `${engine}: the phone reports a finger`,
    })
    .toBe(true);
  for (const scheme of SCHEMES) {
    // eslint-disable-next-line no-await-in-loop
    await setLook(page, scheme);
    // eslint-disable-next-line no-await-in-loop
    await openRoom(page, data);
    // The header holds Back, the name and More Options, nothing else.
    // eslint-disable-next-line no-await-in-loop
    const names = await header(page)
      .getByRole('button')
      .evaluateAll((buttons) =>
        buttons
          .filter((button) => button.getBoundingClientRect().width > 0)
          .map((button) => button.getAttribute('aria-label') ?? button.textContent ?? '')
      );
    expect(names, `${engine} ${scheme} header buttons`).toEqual(['Back', 'More Options']);
    // The name gets the header's room: more than the old 130 px ("Customer Esc...").
    // eslint-disable-next-line no-await-in-loop
    const nameWidth = await header(page)
      .locator('h1')
      .evaluate((h1) => h1.getBoundingClientRect().width);
    expect(nameWidth, 'room name width').toBeGreaterThan(230);
    for (const name of ['Back', 'More Options']) {
      // eslint-disable-next-line no-await-in-loop
      expect(
        await missedPoints(header(page).getByRole('button', { name, exact: true })),
        `${name} 44 px target`
      ).toEqual([]);
    }
    // eslint-disable-next-line no-await-in-loop
    await shot(page, testInfo, `phone-header-${engine}-${scheme}`);

    // eslint-disable-next-line no-await-in-loop
    await openMenu(page);
    for (const name of [...MOVED, 'Show Members']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(entry(page, name), name).toBeVisible();
      // eslint-disable-next-line no-await-in-loop
      const height = await entry(page, name).evaluate((row) => row.getBoundingClientRect().height);
      expect(height, `${name} row height`).toBeCloseTo(MENU_ROW, 0);
    }
    // eslint-disable-next-line no-await-in-loop
    await expect(entry(page, 'Compact view')).toHaveAttribute('aria-checked', 'true');
    // eslint-disable-next-line no-await-in-loop
    const menuBox = await roomMenu(page).boundingBox();
    expect(
      (menuBox?.y ?? 0) + (menuBox?.height ?? 0),
      'menu inside the window'
    ).toBeLessThanOrEqual(844);
    // eslint-disable-next-line no-await-in-loop
    await shot(page, testInfo, `phone-header-${engine}-${scheme}-menu`);
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Escape');
    // eslint-disable-next-line no-await-in-loop
    await expect(roomMenu(page)).toHaveCount(0);
  }

  // Each entry does what its header button did.
  await openMenu(page);
  await entry(page, 'Pinned Messages').tap();
  await expect(page.getByText(PINNED).last()).toBeVisible();
  await page.keyboard.press('Escape');

  await openMenu(page);
  await entry(page, 'Scheduled tasks (0)').tap();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await openMenu(page);
  await entry(page, 'Compact view').tap();
  await expect(page.locator('[data-compact-room-view="true"]')).toHaveCount(0);
  await openMenu(page);
  await expect(entry(page, 'Compact view')).toHaveAttribute('aria-checked', 'false');
  await entry(page, 'Show Members').tap();
  // On a phone the members panel opens as a dialog over the room.
  await expect(page.getByRole('dialog', { name: 'Members' })).toBeVisible();
};

const checkDesktop = async (page: Page, data: Seed) => {
  await openRoom(page, data);
  for (const name of [...MOVED, 'More Options']) {
    // eslint-disable-next-line no-await-in-loop
    await expect(header(page).getByRole('button', { name, exact: true }), name).toBeVisible();
  }
  // The phone left the members panel open, which a desktop shows beside the room.
  await expect(header(page).getByRole('button', { name: /^(Show|Hide) Members$/ })).toBeVisible();
};

const newPage = async (
  engine: (typeof ENGINES)[number],
  browser: Browser,
  options: BrowserContextOptions
) => {
  const owner = engine === 'webkit' ? await launchWebKit() : browser;
  const context = await owner.newContext(options);
  const page = await context.newPage();
  return {
    page,
    close: async () => {
      await context.close();
      if (owner !== browser) await owner.close();
    },
  };
};

for (const engine of ENGINES) {
  test(`a phone's room header keeps the name and moves the rest into the room menu: ${engine}`, async ({
    browser,
  }, testInfo) => {
    test.skip(!(await disposableHomeserverIsUp()), 'Test homeserver is not running.');
    test.setTimeout(240_000);
    const data = await seed(engine);
    const phone = await newPage(engine, browser, PHONE);
    try {
      await loginWithPassword(phone.page, {
        homeserver: HOMESERVER,
        username: data.username,
        password: PASSWORD,
      });
      await checkPhone(phone.page, data, engine, testInfo);
    } finally {
      await phone.close();
    }
    const desktop = await newPage(engine, browser, DESKTOP);
    try {
      await loginWithPassword(desktop.page, {
        homeserver: HOMESERVER,
        username: data.username,
        password: PASSWORD,
      });
      await checkDesktop(desktop.page, data);
    } finally {
      await desktop.close();
    }
  });
}
