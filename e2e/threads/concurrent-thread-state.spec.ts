import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { loginToMatrix, matrixFetch, sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { holdFirstWrites } from '../helpers/holdWrites';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Two people work on the same room at the same moment, each in their own browser, against a
// real homeserver.
//
// - Both tag one thread in the same instant: each sees both tags within a sync, not only their
//   own until a pending tag expires.
// - Both pin a different thread in the same instant: both pins stay. A pin list is one state
//   event that each client writes whole, so the later write was made from a list without the
//   earlier pin; the client must restore it.
// - A moderator whose power meets the room's pin level (the state default, or a level the room
//   sets for pins) gets the pin actions, in the thread header, Thread options and a message's
//   More Options, and loses them live when the room raises the level.
//
// The writes are held until both browsers have sent theirs, so both read the room before either
// write lands, every run. Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, WebKit; a desktop at 1440 by 900 and one at 1280 by 800. Each account has 25 rooms.
// Set CONCURRENT_STATE_SHOTS=<directory> to save screenshots there as well.
const PASSWORD = 'concurrent-state-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.CONCURRENT_STATE_SHOTS;

const DESK: BrowserContextOptions = { viewport: { width: 1440, height: 900 } };
const LAPTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const ROOM_NAME = 'Release planning';
const THREADS = [
  {
    root:
      'Draft of the release notes for the spring update. Please check the section about the new ' +
      'export options, I am not sure the wording about scheduled exports is clear enough.',
    replies: [
      'The scheduled exports paragraph reads fine to me, maybe add one example.',
      'Added an example with a weekly export, can you have another look?',
    ],
  },
  {
    root:
      'Who can cover the support rotation in the week of the launch? I am travelling from ' +
      'Tuesday to Thursday and will only be online in the evenings.',
    replies: ['I can take Tuesday and Wednesday.', 'Thursday works for me.'],
  },
];

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

type Account = MatrixSession & { username: string };

const register = async (username: string, displayname: string): Promise<Account> => {
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
  const session = await loginToMatrix(HOMESERVER, username, PASSWORD);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname }),
  });
  return { ...session, username };
};

type PowerLevels = { users?: Record<string, number>; events?: Record<string, number> };

const powersPath = (roomId: string) =>
  `/rooms/${encodeURIComponent(roomId)}/state/m.room.power_levels/`;

/** Gives the people their power and, when given, sets the room's pin level. */
const setPowers = async (
  owner: Account,
  roomId: string,
  users: Record<string, number>,
  pinLevel?: number
) => {
  const powers = await matrixFetch<PowerLevels>(HOMESERVER, powersPath(roomId), {
    accessToken: owner.accessToken,
  });
  const events = { ...powers.events };
  if (pinLevel !== undefined) events['m.room.pinned_events'] = pinLevel;
  await matrixFetch(HOMESERVER, powersPath(roomId), {
    method: 'PUT',
    accessToken: owner.accessToken,
    body: JSON.stringify({ ...powers, users: { ...powers.users, ...users }, events }),
  });
};

const serverPins = async (owner: Account, roomId: string): Promise<string[]> => {
  try {
    const content = await matrixFetch<{ pinned: string[] }>(
      HOMESERVER,
      `/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events/`,
      { accessToken: owner.accessToken }
    );
    return [...content.pinned].sort();
  } catch {
    return [];
  }
};

/** Two people in a room with two threads, each with 24 other rooms. */
const seed = async (name: string, guestPower: number) => {
  const owner = await register(`cs_${name}_${RUN}`, 'Morgan Reviewer');
  const guest = await register(`cs_${name}_guest_${RUN}`, 'Robin Planner');
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      Promise.all([
        createRoom(HOMESERVER, owner.accessToken, { name: `Project room ${index + 1}` }),
        createRoom(HOMESERVER, guest.accessToken, { name: `Team room ${index + 1}` }),
      ])
    )
  );
  const roomId = await createRoom(HOMESERVER, owner.accessToken, {
    name: ROOM_NAME,
    invite: [guest.userId],
  });
  await matrixFetch(HOMESERVER, `/join/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    accessToken: guest.accessToken,
    body: '{}',
  });
  await setPowers(owner, roomId, { [guest.userId]: guestPower });
  const roots: string[] = [];
  for (const thread of THREADS) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, owner.accessToken, roomId, {
      msgtype: 'm.text',
      body: thread.root,
    });
    roots.push(rootId);
    for (const [index, body] of thread.replies.entries()) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(HOMESERVER, (index % 2 ? owner : guest).accessToken, roomId, {
        msgtype: 'm.text',
        body,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
    }
  }
  const [first, second] = roots;
  if (!first || !second) throw new Error('Both threads must exist');
  return { owner, guest, roomId, roots: [first, second] as const };
};

const banner = (page: Page) => page.locator('[data-thread-context-banner]');

const openThread = async (page: Page, account: Account, roomId: string, rootId: string) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: account.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  await expect(banner(page)).toBeVisible({ timeout: 60_000 });
  await expect(banner(page).getByRole('button', { name: 'Thread options' })).toBeEnabled({
    timeout: 30_000,
  });
};

const shoot = async (page: Page, testInfo: TestInfo, name: string) => {
  const body = await page.screenshot();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/concurrent-state-${name}.png` });
  await testInfo.attach(name, { body, contentType: 'image/png' });
};

type Open = (options: BrowserContextOptions) => Promise<Page>;

const field = (page: Page) => page.getByRole('textbox', { name: 'Filter or create tag' });

/** Thread options, Edit tags, Add tag: the way a person adds the first tag to a thread. */
const openTagField = async (page: Page) => {
  await banner(page).getByRole('button', { name: 'Thread options' }).click();
  await page
    .getByRole('menu', { name: 'Thread options' })
    .getByRole('menuitem', { name: 'Edit tags', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: 'Edit tags', exact: true });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Add tag', exact: true }).click();
  await expect(field(page)).toBeVisible();
  return dialog;
};

const tagTogether = async (open: Open, engine: string, testInfo: TestInfo) => {
  const { owner, guest, roomId, roots } = await seed(`tag_${engine}`, 50);
  const desk = await open(DESK);
  const laptop = await open(LAPTOP);
  await openThread(desk, owner, roomId, roots[0]);
  await openThread(laptop, guest, roomId, roots[0]);
  const writes = await holdFirstWrites([desk, laptop], '/state/com.mindroom.thread.tags/');
  const dialogs = new Map<Page, Locator>();
  for (const [page, tag] of [
    [desk, 'x-desk'],
    [laptop, 'y-laptop'],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop
    dialogs.set(page, await openTagField(page));
    // eslint-disable-next-line no-await-in-loop
    await field(page).fill(tag);
  }
  await Promise.all([desk, laptop].map((page) => field(page).press('Enter')));
  await writes.release();
  const name = (page: Page) => (page === desk ? 'desk' : 'laptop');
  for (const page of [desk, laptop]) {
    for (const tag of ['x-desk', 'y-laptop']) {
      // Within a sync, not once a pending tag expires.
      // eslint-disable-next-line no-await-in-loop
      await expect(
        dialogs.get(page)!.getByRole('button', { name: `Remove ${tag} tag`, exact: true }),
        `${tag} in Edit tags on the ${name(page)}`
      ).toBeVisible({ timeout: 5_000 });
    }
    // eslint-disable-next-line no-await-in-loop
    await dialogs.get(page)!.getByRole('button', { name: 'Done', exact: true }).click();
    for (const tag of ['x-desk', 'y-laptop']) {
      // eslint-disable-next-line no-await-in-loop
      await expect(
        banner(page).getByRole('button', { name: `Remove ${tag} tag`, exact: true }),
        `${tag} in the thread header on the ${name(page)}`
      ).toBeVisible();
    }
    // eslint-disable-next-line no-await-in-loop
    await shoot(page, testInfo, `tags-${engine}-${name(page)}`);
  }

  // The field of Edit tags takes the focus, so the keyboard can type a tag at once.
  await openTagField(desk);
  await expect(field(desk)).toBeFocused();
};

const pinTogether = async (open: Open, engine: string, testInfo: TestInfo) => {
  const { owner, guest, roomId, roots } = await seed(`pin_${engine}`, 100);
  const desk = await open(DESK);
  const laptop = await open(LAPTOP);
  await openThread(desk, owner, roomId, roots[0]);
  await openThread(laptop, guest, roomId, roots[1]);
  const pin = (page: Page) => banner(page).getByRole('button', { name: 'Pin thread', exact: true });
  const unpin = (page: Page) =>
    banner(page).getByRole('button', { name: 'Unpin thread', exact: true });
  await expect(pin(desk)).toBeVisible();
  await expect(pin(laptop)).toBeVisible();
  const writes = await holdFirstWrites([desk, laptop], '/state/m.room.pinned_events/');
  await Promise.all([pin(desk).click(), pin(laptop).click()]);
  await writes.release();
  const both = [...roots].sort();
  await expect.poll(() => serverPins(owner, roomId), { timeout: 15_000 }).toEqual(both);
  await expect(unpin(desk)).toBeVisible();
  await expect(unpin(laptop)).toBeVisible();
  // Both people see both pins in the room's pin list.
  for (const page of [desk, laptop]) {
    // eslint-disable-next-line no-await-in-loop
    await page.getByRole('button', { name: 'Pinned Messages', exact: true }).click();
    const menu = page.getByRole('dialog', { name: 'Pinned Messages', exact: true });
    for (const rootId of roots) {
      // eslint-disable-next-line no-await-in-loop
      await expect(menu.locator(`[data-pinned-event-id="${rootId}"]`)).toBeVisible();
    }
    // eslint-disable-next-line no-await-in-loop
    await shoot(page, testInfo, `pins-${engine}-${page === desk ? 'desk' : 'laptop'}`);
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Escape');
  }
  // And the pins stay.
  await desk.waitForTimeout(2_000);
  expect(await serverPins(owner, roomId)).toEqual(both);
};

const moderatorPins = async (open: Open, engine: string, testInfo: TestInfo) => {
  const { owner, guest, roomId, roots } = await seed(`mod_${engine}`, 50);
  const page = await open(DESK);
  await openThread(page, guest, roomId, roots[0]);
  const header = banner(page);
  const pin = header.getByRole('button', { name: 'Pin thread', exact: true });
  const threadOptions = async () => {
    await header.getByRole('button', { name: 'Thread options' }).click();
    const menu = page.getByRole('menu', { name: 'Thread options' });
    await expect(menu).toBeVisible();
    const hasPin = (await menu.getByRole('menuitem', { name: 'Pin thread' }).count()) > 0;
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    return hasPin;
  };
  const messageMenu = async () => {
    const message = page.locator(`[data-message-id="${roots[0]}"]`).first();
    await message.hover();
    await message.getByRole('button', { name: 'More Options', exact: true }).click();
    const item = page.getByRole('menuitem', { name: 'Pin Message', exact: true });
    await expect(page.getByRole('menuitem', { name: 'Copy Link', exact: true })).toBeVisible();
    const hasPin = (await item.count()) > 0;
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
    return hasPin;
  };

  // A moderator (50) in a room whose state default is 50 and that sets no level for pins.
  await expect(pin).toBeVisible({ timeout: 20_000 });
  expect(await threadOptions(), 'Pin thread in Thread options').toBe(true);
  expect(await messageMenu(), 'Pin Message in More Options').toBe(true);
  await shoot(page, testInfo, `moderator-${engine}-may-pin`);

  // The room raises pins above the moderator: the actions leave without a reload.
  await setPowers(owner, roomId, {}, 60);
  await expect(pin).toHaveCount(0);
  expect(await threadOptions(), 'no Pin thread at 60').toBe(false);
  expect(await messageMenu(), 'no Pin Message at 60').toBe(false);

  // A custom level of 40, with the person at 40: the actions come back, and pinning works.
  await setPowers(owner, roomId, { [guest.userId]: 40 }, 40);
  await expect(pin).toBeVisible();
  await pin.click();
  await expect(header.getByRole('button', { name: 'Unpin thread', exact: true })).toBeVisible();
  await expect.poll(() => serverPins(owner, roomId)).toEqual([roots[0]]);
  await shoot(page, testInfo, `moderator-${engine}-pinned-at-40`);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const CHECKS: [string, (open: Open, engine: string, info: TestInfo) => Promise<void>][] = [
  ['two people tag one thread at the same moment and both see both tags', tagTogether],
  ['two people pin different threads at the same moment and both pins stay', pinTogether],
  ['a moderator at the room’s pin level gets the pin actions, and loses them live', moderatorPins],
];

const opener = (browser: Browser, baseURL: string | undefined, extra?: BrowserContextOptions) => {
  const contexts: BrowserContext[] = [];
  const open: Open = async (options) => {
    const context = await browser.newContext({ ...options, ...extra, baseURL });
    contexts.push(context);
    return context.newPage();
  };
  return { open, close: () => Promise.all(contexts.map((context) => context.close())) };
};

for (const [title, check] of CHECKS) {
  test(`${title} (Chromium)`, async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(240_000);
    const { open, close } = opener(browser, baseURL);
    try {
      await check(open, 'chromium', testInfo);
    } finally {
      await close();
    }
  });

  test(`${title} (WebKit)`, async ({ baseURL }, testInfo) => {
    test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(240_000);
    // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
    const browser = await launchWebKit();
    try {
      // Playwright's WebKit cannot route what the app's service worker fetches, and the writes
      // must pass the route that holds them.
      await check(opener(browser, baseURL, { serviceWorkers: 'block' }).open, 'webkit', testInfo);
    } finally {
      await browser.close();
    }
  });
}
