import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
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
import { addRoomToSpace, matrixFetch, setDirectAccountData } from '../helpers/matrix';
import {
  DESKTOP,
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
  type Account,
} from '../helpers/designChoices';
import { roomMoreOptions } from '../helpers/roomMenu';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  CHROMIUM_WITH_SCROLLBARS,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// A room's menu offers the same entries, in the same order, with the same labels, wherever it
// opens: the More Options button of its sidebar row, a right-click on the row (a long press's
// contextmenu on Android), and the room header's More Options. The header's menu may add only
// what depends on being in the open room (view switch, filters, members and the like on phones),
// in a section before the shared entries. An entry the person cannot use here stays in its place,
// disabled, and says why. Four rooms: one the tester created (admin), an encrypted one where the
// tester may not invite or add sub-rooms, a direct message (no New Sub-room) and a room in a
// space; 28 rooms in all. Desktop (1440 by 900) and phone (390 by 844, touch), light and dark,
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit. Set
// DESIGN_CHOICES_SHOTS to save the screenshots.
const ENGINES = ['chromium', ...(WEBKIT_EXECUTABLE ? ['webkit'] : [])] as const;
type Engine = (typeof ENGINES)[number];
/** A message menu's row (MenuEntry: folds' MenuItem, size 300), which a room menu's rows match. */
const MENU_ROW = 32;
const NO_INVITE = "You don't have permission to invite";
const NO_SEARCH = 'Not available in encrypted rooms';

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

type Item = { name: string; role: string; disabled: boolean; reason: string };

type Case = {
  key: string;
  roomId: string;
  /** The sidebar list that shows the room's row. */
  list: string;
  /** The room's own page. */
  room: string;
  canInvite: boolean;
  /** Why New Sub-room is disabled, '' when it is not; a direct message's menu has none. */
  newSubRoom?: string;
  encrypted: boolean;
};

const item = (name: string, reason = ''): Item => ({
  name,
  role: 'menuitem',
  disabled: reason !== '',
  reason,
});

/** The entries every room menu shares, in their order. */
const sharedItems = ({ canInvite, newSubRoom, encrypted }: Case): Item[] => [
  item('Mark as Read'),
  item('Notifications'),
  item('Invite', canInvite ? '' : NO_INVITE),
  ...(newSubRoom === undefined ? [] : [item('New Sub-room', newSubRoom)]),
  item('Copy Link'),
  item('Room Settings'),
  item('Message Search', encrypted ? NO_SEARCH : ''),
  item('Jump to Time'),
  item('Archive Room'),
  item('Leave Room'),
];

/** What only the open room's header menu may add: what a phone's header leaves out, and calls. */
const IN_ROOM = [
  /^Compact view$/,
  /^Thread filters/,
  /^Scheduled tasks/,
  /^(Canvases|Show Canvas|Hide Canvas)$/,
  /^Pinned Messages$/,
  /^(Show|Hide) Members/,
  /^(Show|Hide) Computer$/,
  /Call/,
];

type Seed = { tester: Account; cases: Case[] };

const createRoomWith = (account: Account, body: Record<string, unknown>) =>
  withRetry(async () => {
    const created = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: account.token,
      body: JSON.stringify({ preset: 'private_chat', ...body }),
    });
    return created.room_id;
  });

const seed = async (label: string): Promise<Seed> => {
  const id = `${label}_${RUN}_${randomUUID().slice(0, 6)}`;
  const tester = await register(`rmu_${id}`, 'Robin Tester');
  const helper = await register(`rmu_helper_${id}`, 'Sam Rivera');
  await createOtherRooms(tester);

  const admin = await withRetry(() =>
    createRoom(HOMESERVER, tester.token, { name: 'Planning Desk', invite: [helper.userId] })
  );
  // The helper's room: inviting needs power level 50, which the tester lacks, and it is encrypted.
  const member = await createRoomWith(helper, {
    name: 'Vendor Updates',
    invite: [tester.userId],
    power_level_content_override: { invite: 50 },
    initial_state: [
      {
        type: 'm.room.encryption',
        state_key: '',
        content: { algorithm: 'm.megolm.v1.aes-sha2' },
      },
    ],
  });
  await join(tester, member);
  const direct = await createRoomWith(helper, { is_direct: true, invite: [tester.userId] });
  await join(tester, direct);
  await withRetry(() =>
    setDirectAccountData(HOMESERVER, tester.token, tester.userId, helper.userId, direct)
  );
  const space = await withRetry(() =>
    createRoom(HOMESERVER, tester.token, { name: 'Field Team', space: true })
  );
  const spaceRoom = await withRetry(() =>
    createRoom(HOMESERVER, tester.token, { name: 'Site Visits' })
  );
  await withRetry(() => addRoomToSpace(HOMESERVER, tester.token, space, spaceRoom));

  // The newest activity puts the rooms under test at the top of their lists.
  await say(tester, admin, 'Agenda for Thursday: budget review, hiring plan, then open questions.');
  await say(helper, member, 'The supplier confirmed the new delivery window for next month.');
  await say(helper, direct, 'Can you look at the draft contract before the call tomorrow?');
  await say(tester, spaceRoom, 'Site visit notes from Tuesday are in the shared folder.');

  const enc = encodeURIComponent;
  return {
    tester,
    cases: [
      {
        key: 'admin',
        roomId: admin,
        list: '/home/',
        room: `/home/${enc(admin)}/`,
        canInvite: true,
        newSubRoom: '',
        encrypted: false,
      },
      {
        key: 'member-encrypted',
        roomId: member,
        list: '/home/',
        room: `/home/${enc(member)}/`,
        canInvite: false,
        newSubRoom: "You can't change the rooms listed under Vendor Updates",
        encrypted: true,
      },
      {
        key: 'direct',
        roomId: direct,
        list: '/direct/',
        room: `/direct/${enc(direct)}/`,
        canInvite: true,
        encrypted: false,
      },
      {
        key: 'space',
        roomId: spaceRoom,
        list: `/${enc(space)}/`,
        room: `/${enc(space)}/${enc(spaceRoom)}/`,
        canInvite: true,
        newSubRoom: '',
        encrypted: false,
      },
    ],
  };
};

/** The room's menu while it is open: the menu that ends with Leave Room. */
const roomMenu = (page: Page) => page.getByRole('menu').filter({ hasText: 'Leave Room' });

/** The rows of the open room menu, as a reader meets them: name, role, state and reason. */
const readMenu = (menu: Locator): Promise<Item[]> =>
  menu.evaluate((element) => {
    const rows = Array.from(
      element.querySelectorAll<HTMLElement>(
        '[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"]'
      )
    ).filter((row) => row.closest('[role="menu"]') === element);
    const visibleText = (node: Element) => {
      const copy = node.cloneNode(true) as Element;
      copy.querySelectorAll('[aria-hidden="true"], svg').forEach((hidden) => hidden.remove());
      return (copy.textContent ?? '').replace(/\s+/g, ' ').trim();
    };
    return rows.map((row) => ({
      name: row.getAttribute('aria-label') ?? visibleText(row),
      role: row.getAttribute('role') ?? '',
      disabled: row.matches(':disabled, [aria-disabled="true"]'),
      reason: (row.getAttribute('aria-describedby') ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .map((describedBy) => document.getElementById(describedBy)?.textContent?.trim() ?? '')
        .join(' '),
    }));
  });

/**
 * The rows of the open room menu not as tall as a message menu's, by name and height. A row that
 * says why it is disabled may take a second line.
 */
const oddRows = (menu: Locator) =>
  menu.evaluate((element, rowHeight) => {
    const rows = Array.from(
      element.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')
    ).filter((row) => row.closest('[role="menu"]') === element);
    return rows
      .filter((row) => {
        const { height } = row.getBoundingClientRect();
        return row.hasAttribute('aria-describedby')
          ? height < rowHeight - 0.5
          : Math.abs(height - rowHeight) > 0.5;
      })
      .map((row) => [row.textContent?.trim() ?? '', row.getBoundingClientRect().height] as const);
  }, MENU_ROW);

/**
 * The rows of the open room menu whose text is taller than the row, by name and both heights: a
 * row that says why it is disabled grows with its reason rather than painting over its neighbours.
 */
const overflowingRows = (menu: Locator) =>
  menu.evaluate((element) =>
    Array.from(
      element.querySelectorAll<HTMLElement>('[role="menuitem"], [role="menuitemcheckbox"]')
    )
      .filter((row) => row.closest('[role="menu"]') === element)
      .filter((row) => row.scrollHeight > row.clientHeight + 0.5)
      .map((row) => [row.textContent?.trim() ?? '', row.clientHeight, row.scrollHeight] as const)
  );

const sidebarLink = (page: Page, roomId: string) =>
  page.locator(`a[href*="${encodeURIComponent(roomId)}"]`).first();

/** The sidebar row of the link: the closest element that also holds its More Options button. */
const sidebarRow = (link: Locator) =>
  link.locator('xpath=ancestor::*[.//button[@aria-label="More Options"]][1]');

type Entry = 'row-button' | 'row-context' | 'header';

/** Opens the room's menu from one entry point; the page shows the list or the room as needed. */
const openFrom = async (page: Page, room: Case, entry: Entry, phone: boolean) => {
  if (entry === 'header') {
    await expect(roomMoreOptions(page)).toBeVisible({ timeout: 30_000 });
    if (phone) await roomMoreOptions(page).tap();
    else await roomMoreOptions(page).click();
  } else {
    const link = sidebarLink(page, room.roomId);
    await expect(link).toBeVisible({ timeout: 30_000 });
    if (entry === 'row-context') {
      if (phone) {
        // A long press on Android fires contextmenu at the finger; WebKit and Playwright's touch
        // emulation do not, so the test fires it, where a finger would rest on the name.
        await link.evaluate((element) => {
          const { left, top, height } = element.getBoundingClientRect();
          element.dispatchEvent(
            new MouseEvent('contextmenu', {
              bubbles: true,
              cancelable: true,
              button: 2,
              clientX: left + 60,
              clientY: top + height / 2,
            })
          );
        });
      } else {
        await link.click({ button: 'right' });
      }
    } else {
      // The row shows its button while hovered or holding focus. A phone has no hover, and a tap
      // moves focus out of the row in WebKit, so there a keyboard (or switch control) presses it.
      if (phone) await link.focus();
      else await link.hover();
      const button = sidebarRow(link).getByRole('button', { name: 'More Options', exact: true });
      await expect(button).toBeVisible();
      if (phone) {
        await button.focus();
        await page.keyboard.press('Enter');
      } else {
        await button.click();
      }
    }
  }
  await expect(roomMenu(page)).toBeVisible();
};

/**
 * Escape closes the menu. When it does not, the problem is noted and a press outside closes it,
 * so the remaining menus are still read.
 */
const closeMenu = async (page: Page, problems: string[], where: string) => {
  await page.keyboard.press('Escape');
  try {
    await expect(roomMenu(page)).toHaveCount(0, { timeout: 3_000 });
  } catch {
    problems.push(`${where}: Escape left the menu open`);
    await page.evaluate(() =>
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    );
    await expect(roomMenu(page)).toHaveCount(0);
  }
};

type Seen = Record<Entry, Item[]>;
type Read = { seen: Seen; problems: string[] };

/** Opens the three menus of one room, saving a screenshot of each, and reads their rows. */
const readAllMenus = async (
  page: Page,
  room: Case,
  phone: boolean,
  tag: string,
  testInfo: TestInfo
): Promise<Read> => {
  const seen = {} as Seen;
  const problems: string[] = [];
  const read = async (entry: Entry) => {
    await openFrom(page, room, entry, phone);
    await shot(page, testInfo, `${tag}-${room.key}-${entry}`);
    seen[entry] = await readMenu(roomMenu(page));
    for (const [name, height, content] of await overflowingRows(roomMenu(page))) {
      problems.push(`${entry} "${name}" is ${height} px tall, its text ${content} px`);
    }
    if (phone) {
      for (const [name, height] of await oddRows(roomMenu(page))) {
        problems.push(`${entry} "${name}" is ${Math.round(height)} px tall`);
      }
    }
    await closeMenu(page, problems, entry);
  };
  // A phone shows the list and the room on separate pages; a desktop shows both.
  if (phone) {
    await page.goto(room.list);
    await read('row-button');
    await read('row-context');
    await page.goto(room.room);
  } else {
    await page.goto(room.room);
    await read('row-button');
    await read('row-context');
  }
  await expect(page.getByRole('banner').filter({ has: page.locator('h1') })).toBeVisible({
    timeout: 30_000,
  });
  await read('header');
  return { seen, problems };
};

const checkSame = (room: Case, { seen, problems }: Read, tag: string) => {
  const expected = sharedItems(room);
  const where = `${tag} ${room.key}`;
  expect(seen['row-context'], `${where}: right-click menu = row button menu`).toEqual(
    seen['row-button']
  );
  expect(seen['row-button'], `${where}: row menu entries`).toEqual(expected);
  const { header } = seen;
  const extra = header.slice(0, Math.max(0, header.length - expected.length));
  expect(header.slice(extra.length), `${where}: header menu ends with the shared entries`).toEqual(
    expected
  );
  const unknown = extra.filter(({ name }) => !IN_ROOM.some((pattern) => pattern.test(name)));
  expect(unknown, `${where}: header-only entries depend on the open room`).toEqual([]);
  expect(
    problems,
    `${where}: rows shorter than their text, rows not ${MENU_ROW} px tall on a touch screen, menus Escape left open`
  ).toEqual([]);
};

/** A keyboard reaches the disabled Invite, hears why, and cannot start it. */
const checkKeyboard = async (page: Page, room: Case) => {
  await page.goto(room.room);
  const link = sidebarLink(page, room.roomId);
  // Focus in the row shows its button; Tab reaches it, except in WebKit on macOS, where Tab
  // passes over buttons unless the system's keyboard navigation is on.
  await link.focus();
  const button = sidebarRow(link).getByRole('button', { name: 'More Options', exact: true });
  await expect(button).toBeVisible();
  await page.keyboard.press('Tab');
  if (!(await button.evaluate((element) => element === document.activeElement))) {
    await button.focus();
  }
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(roomMenu(page)).toBeVisible();
  const invite = roomMenu(page).getByRole('menuitem', { name: 'Invite', exact: true });
  for (let step = 0; step < 4; step += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await invite.evaluate((row) => row === document.activeElement)) break;
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('ArrowDown');
  }
  await expect(invite).toBeFocused();
  await expect(invite).toHaveAttribute('aria-disabled', 'true');
  await expect(invite).toHaveAccessibleDescription(NO_INVITE);
  await page.keyboard.press('Enter');
  await expect(roomMenu(page)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(roomMenu(page)).toHaveCount(0);
  await expect(button).toBeFocused();
};

/** Entries that the header offered before work from the sidebar row too. */
const checkSidebarActions = async (page: Page, room: Case) => {
  await page.goto(room.list);
  await openFrom(page, room, 'row-button', false);
  await roomMenu(page).getByRole('menuitem', { name: 'Jump to Time', exact: true }).click();
  const jump = page.getByRole('dialog', { name: 'Jump to Time' });
  await expect(jump).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(jump).toHaveCount(0);
  await openFrom(page, room, 'row-context', false);
  await roomMenu(page).getByRole('menuitem', { name: 'Message Search', exact: true }).click();
  await expect(page).toHaveURL(/\/home\/search\/.*rooms=/);
};

const newPage = async (engine: Engine, browser: Browser, options: BrowserContextOptions) => {
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
  for (const layout of ['desktop', 'phone'] as const) {
    test(`a room's menu is the same from its row, a right-click and its header: ${engine} ${layout}`, async ({
      browser,
    }, testInfo) => {
      test.skip(!(await disposableHomeserverIsUp()), 'Test homeserver is not running.');
      test.setTimeout(420_000);
      const phone = layout === 'phone';
      const data = await seed(`${engine.slice(0, 2)}${layout.slice(0, 2)}`);
      const { page, close } = await newPage(engine, browser, phone ? PHONE : DESKTOP);
      try {
        await loginWithPassword(page, {
          homeserver: HOMESERVER,
          username: data.tester.username,
          password: PASSWORD,
        });
        if (phone) {
          await expect
            .poll(() =>
              page.evaluate(() => matchMedia('(hover: none) and (pointer: coarse)').matches)
            )
            .toBe(true);
        }
        const results: [Case, Read, string][] = [];
        for (const scheme of SCHEMES) {
          // eslint-disable-next-line no-await-in-loop
          await setLook(page, scheme);
          for (const room of data.cases) {
            const tag = `${layout}-${engine}-${scheme}`;
            // eslint-disable-next-line no-await-in-loop
            results.push([room, await readAllMenus(page, room, phone, tag, testInfo), tag]);
          }
        }
        // Every menu's rows, for the record (test-results/<test>/menus.json).
        writeFileSync(
          testInfo.outputPath('menus.json'),
          JSON.stringify(
            results.map(([room, read, tag]) => ({ tag, room: room.key, ...read })),
            null,
            2
          )
        );
        for (const [room, read, tag] of results) checkSame(room, read, tag);
        if (!phone) {
          const member = data.cases.find((room) => room.key === 'member-encrypted');
          const admin = data.cases.find((room) => room.key === 'admin');
          if (member) await checkKeyboard(page, member);
          if (admin) await checkSidebarActions(page, admin);
        }
      } finally {
        await close();
      }
    });
  }
}
