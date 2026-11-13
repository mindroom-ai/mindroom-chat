import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { buildLoginPath } from '../env';
import { activeAccountButton } from '../helpers/auth';
import { matrixFetch } from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Every dialog the main views open, opened the way most people do (a click, or a tap on a phone):
// it takes focus (its first control, or the dialog itself with its name read), Tab stays inside
// it, and closing it gives focus back to the control that opened it, or to the menu button when
// that control was an entry of a menu that has gone. Desktop and phone, in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const PASSWORD = 'dialog-focus-spec-password';
const ROOM = 'Project Team';
const TOPIC = 'Weekly goals and the open questions for the next review';
const DESKTOP = { viewport: { width: 1280, height: 800 } };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
type Screen = 'desktop' | 'phone';
// Focus moves within a frame or two; a dialog that misses it fails fast, and the run goes on.
const POLL = 3_000;

type Account = { username: string; userId: string; accessToken: string };

const register = async (prefix: string, displayName: string): Promise<Account> => {
  const run = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  const username = `${prefix}_${run}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname: displayName }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token };
};

const IMAGE = 'release-chart.png';

/** A plain PNG of one colour, for an image message. */
const solidPng = (width: number, height: number): Buffer => {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x5a)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array<Buffer>(height).fill(row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const sendImage = async (sender: Account, roomId: string) => {
  const png = solidPng(320, 200);
  const response = await fetch(`${HOMESERVER}/_matrix/media/v3/upload?filename=${IMAGE}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${sender.accessToken}`, 'Content-Type': 'image/png' },
    body: png,
  });
  const { content_uri: url } = (await response.json()) as { content_uri: string };
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/dfocus-image`,
    {
      method: 'PUT',
      accessToken: sender.accessToken,
      body: JSON.stringify({
        msgtype: 'm.image',
        body: IMAGE,
        url,
        info: { mimetype: 'image/png', size: png.length, w: 320, h: 200 },
      }),
    }
  );
};

const createRoom = async (owner: Account, name: string, topic?: string) =>
  (
    await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: owner.accessToken,
      body: JSON.stringify({ preset: 'public_chat', name, topic }),
    })
  ).room_id;

/** A viewer in 26 rooms, one of them shared with a second person and holding a few messages. */
const seed = async () => {
  const viewer = await register('dfocus_viewer', 'Jordan Viewer');
  const member = await register('dfocus_member', 'Sam Taylor');
  const roomId = await createRoom(viewer, ROOM, TOPIC);
  await matrixFetch(HOMESERVER, `/join/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    accessToken: member.accessToken,
    body: '{}',
  });
  const lines = [
    'Morning! I pushed the draft of the quarterly plan; comments welcome before Thursday.',
    'Thanks, I will read it after the standup and leave notes on the budget section.',
  ];
  const eventIds: string[] = [];
  for (const [index, body] of lines.entries()) {
    const { event_id: eventId } = await matrixFetch<{ event_id: string }>(
      HOMESERVER,
      `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/dfocus-${index}`,
      {
        method: 'PUT',
        accessToken: index % 2 ? member.accessToken : viewer.accessToken,
        body: JSON.stringify({ msgtype: 'm.text', body }),
      }
    );
    eventIds.push(eventId);
  }
  await sendImage(member, roomId);
  // A pinned message, so the header shows its Pinned Messages button.
  await matrixFetch(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events`, {
    method: 'PUT',
    accessToken: viewer.accessToken,
    body: JSON.stringify({ pinned: eventIds.slice(0, 1) }),
  });
  const others = Array.from({ length: 25 }, (_, index) => `Working group ${index + 1}`);
  await Promise.all(others.map((name) => createRoom(viewer, name)));
  return { viewer, roomId };
};

const signIn = async (page: Page, viewer: Account) => {
  await page.goto(buildLoginPath(HOMESERVER));
  await page.locator('input[name="usernameInput"]').fill(viewer.username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.locator('button[type=submit]').click();
  await page.waitForURL(/\/(home|inbox|direct)\//, { timeout: 60_000 });
};

/** A click on a desktop, a tap on a phone. */
const press = async (locator: Locator, screen: Screen) => {
  if (screen === 'phone') await locator.tap();
  else await locator.click();
};

type Case = {
  name: string;
  /** Where the case starts: the room, or the home list. */
  from: 'room' | 'home';
  screens: Screen[];
  /** Opens the dialog; returns the control focus belongs on after it closes. */
  open: (page: Page, screen: Screen) => Promise<Locator>;
};

// The header's; a message's own More Options shows only while it is hovered.
const moreOptions = (page: Page) =>
  page.getByRole('button', { name: 'More Options', exact: true }).first();

// An entry of the room menu; focus goes back to the menu's button. On a phone that menu also
// holds what the header leaves out.
const fromRoomMenu =
  (entry: string) =>
  async (page: Page, screen: Screen): Promise<Locator> => {
    await press(moreOptions(page), screen);
    await press(page.getByRole('menuitem', { name: entry, exact: true }), screen);
    return moreOptions(page);
  };

const byButton =
  (name: string | RegExp) =>
  async (page: Page, screen: Screen): Promise<Locator> => {
    const opener = page.getByRole('button', { name, exact: typeof name === 'string' }).first();
    await press(opener, screen);
    return opener;
  };

const OWN_MESSAGE = 'Morning! I pushed the draft of the quarterly plan';

const CASES: Case[] = [
  { name: 'Invite', from: 'room', screens: ['desktop', 'phone'], open: fromRoomMenu('Invite') },
  {
    name: 'Leave Room',
    from: 'room',
    screens: ['desktop', 'phone'],
    open: fromRoomMenu('Leave Room'),
  },
  {
    name: 'Jump to Time',
    from: 'room',
    screens: ['desktop', 'phone'],
    open: fromRoomMenu('Jump to Time'),
  },
  {
    name: 'Room Settings',
    from: 'room',
    screens: ['desktop', 'phone'],
    open: fromRoomMenu('Room Settings'),
  },
  { name: 'room topic', from: 'room', screens: ['desktop'], open: byButton(TOPIC) },
  {
    name: 'Pinned Messages',
    from: 'room',
    screens: ['desktop'],
    open: byButton('Pinned Messages'),
  },
  {
    name: 'Pinned Messages from the room menu',
    from: 'room',
    screens: ['phone'],
    open: fromRoomMenu('Pinned Messages'),
  },
  { name: 'members', from: 'room', screens: ['phone'], open: fromRoomMenu('Show Members') },
  {
    name: 'member profile',
    from: 'room',
    screens: ['desktop'],
    open: async (page, screen) => {
      // The members list's entry; the timeline names the same person first.
      const opener = page.locator('button[data-user-id]').filter({ hasText: 'Sam Taylor' }).last();
      await press(opener, screen);
      return opener;
    },
  },
  {
    name: 'Delete message',
    from: 'room',
    screens: ['desktop'],
    open: async (page, screen) => {
      await page.getByText(OWN_MESSAGE).hover();
      const options = page.getByRole('button', { name: 'More Options', exact: true }).last();
      await press(options, screen);
      await press(page.getByRole('menuitem', { name: 'Delete', exact: true }), screen);
      return options;
    },
  },
  {
    name: 'image viewer',
    from: 'room',
    screens: ['desktop', 'phone'],
    open: async (page, screen) => {
      const opener = page.getByRole('img', { name: IMAGE, exact: true });
      await press(opener, screen);
      return opener;
    },
  },
  {
    // The Find anything field, in Home's list or a phone's top bar: the rail's Search button is
    // off until the account turns it on.
    name: 'command palette',
    from: 'home',
    screens: ['desktop', 'phone'],
    open: async (page, screen) => {
      const opener = page.getByRole('button', { name: 'Find anything', exact: true });
      await press(opener, screen);
      return opener;
    },
  },
  {
    name: 'Join a Room',
    from: 'home',
    screens: ['desktop', 'phone'],
    open: async (page, screen) => {
      const opener = page.locator('[data-home-room-action="join"]');
      await press(opener, screen);
      return opener;
    },
  },
  {
    name: 'Settings',
    from: 'home',
    screens: ['desktop', 'phone'],
    open: async (page, screen) => {
      const account = activeAccountButton(page);
      await press(account, screen);
      await press(page.getByRole('menuitem', { name: 'Settings', exact: true }), screen);
      return account;
    },
  },
];

/** The dialog on top, its layer, and where focus is. */
const focusState = (page: Page) =>
  page.evaluate(() => {
    const dialogs = Array.from(
      document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')
    ).filter((element) => element.getClientRects().length > 0);
    const dialog = dialogs.at(-1);
    const active = document.activeElement;
    const describe = (element: Element | null) =>
      element
        ? `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}[${(
            element.getAttribute('aria-label') ??
            element.textContent ??
            ''
          )
            .trim()
            .slice(0, 40)}]`
        : 'none';
    let layer: Element | null | undefined = dialog;
    while (
      layer?.parentElement &&
      layer.parentElement !== document.body &&
      layer.parentElement.id !== 'portalContainer'
    ) {
      layer = layer.parentElement;
    }
    return {
      open: !!dialog,
      role: dialog?.getAttribute('role'),
      named: !!(dialog?.getAttribute('aria-label') || dialog?.getAttribute('aria-labelledby')),
      described: !!dialog?.getAttribute('aria-describedby'),
      inside: !!dialog && !!layer && layer.contains(active),
      active: describe(active),
    };
  });

const walk = async (page: Page, testCase: Case, screen: Screen, engine: string, roomId: string) => {
  const start = testCase.from === 'room' ? `/home/${encodeURIComponent(roomId)}/` : '/home/';
  await page.goto(start);
  if (testCase.from === 'room') {
    await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 30_000 });
  } else {
    await expect(page.locator('[data-home-room-action="join"]')).toBeVisible({ timeout: 30_000 });
  }
  const label = `${testCase.name} (${screen}, ${engine})`;
  const opener = await testCase.open(page, screen);

  await expect
    .poll(async () => (await focusState(page)).open, { message: `${label}: opens`, timeout: POLL })
    .toBe(true);
  // It takes focus as it opens, and has a name for a screen reader to announce.
  await expect
    .poll(async () => (await focusState(page)).inside, {
      message: `${label}: focus on open, not on ${(await focusState(page)).active}`,
      timeout: POLL,
    })
    .toBe(true);
  const opened = await focusState(page);
  expect(opened.named, `${label}: dialog has a name`).toBe(true);
  if (opened.role === 'alertdialog') expect(opened.described, `${label}: question`).toBe(true);

  // Tab and Shift+Tab stay inside. WebKit on a Mac tabs to every control with Option+Tab, and
  // with plain Tab (Safari's default setting) skips the buttons.
  const tab = engine === 'webkit' ? 'Alt+Tab' : 'Tab';
  const keys = [tab, tab, tab, tab, 'Tab', 'Tab', `Shift+${tab}`, 'Shift+Tab'];
  for (const key of keys) {
    await page.keyboard.press(key);
    const state = await focusState(page);
    expect(state.inside, `${label}: after ${key} focus is on ${state.active}`).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect
    .poll(async () => (await focusState(page)).open, { message: `${label}: closes`, timeout: POLL })
    .toBe(false);
  await expect
    .poll(() => opener.evaluate((element) => element === document.activeElement), {
      message: `${label}: focus back on its opener, not on ${(await focusState(page)).active}`,
      timeout: POLL,
    })
    .toBe(true);
};

test.beforeAll(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const runAll = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const { viewer, roomId } = await seed();
  const failures: string[] = [];
  for (const screen of ['desktop', 'phone'] as const) {
    const context = await browser.newContext({
      ...(screen === 'phone' ? PHONE : DESKTOP),
      baseURL,
    });
    try {
      const page = await context.newPage();
      await signIn(page, viewer);
      page.setDefaultTimeout(10_000);
      for (const testCase of CASES.filter((item) => item.screens.includes(screen))) {
        try {
          await walk(page, testCase, screen, engine, roomId);
        } catch (error) {
          const reason = String(error).split('\n').slice(0, 2).join(' ');
          failures.push(`${testCase.name} (${screen}, ${engine}): ${reason}`);
          await page
            .screenshot({
              path: test.info().outputPath(`${engine}-${screen}-${testCase.name}.png`),
            })
            .catch(() => undefined);
        }
      }
    } finally {
      await context.close();
    }
  }
  expect(failures, failures.join('\n')).toEqual([]);
};

test('every dialog takes focus, keeps Tab inside and gives focus back (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(600_000);
  await runAll(browser, baseURL, 'chromium');
});

test('every dialog takes focus, keeps Tab inside and gives focus back (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(600_000);
  const browser = await launchWebKit();
  try {
    await runAll(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
