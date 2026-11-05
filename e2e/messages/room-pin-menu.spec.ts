import {
  expect,
  test,
  type BrowserContextOptions,
  type Locator,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  loginToMatrix,
  matrixFetch,
  redactEvent,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit } from '../helpers/webkit';

// The room header's Pinned Messages button opens the pin menu, a dialog named Pinned Messages (the
// button announces a dialog): the room's pinned messages, the newest pin first, each rendered as a
// message under a row with its sender's avatar and name and the time it was sent, with a Close
// button; Escape and Close dismiss it. The menu stays inside the window and does not scroll
// sideways, on a desktop (1280 by 800) and a phone (390 by 844, touch), in light and dark, left
// to right and right to left, in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names
// Playwright's WebKit, in WebKit. The account has 25 rooms; the pinned one holds messages of
// realistic length, one long enough to wrap over several lines, from two people.
//
// Activating an entry (a click or tap on it, or Enter on its row) closes the menu and opens the
// message in the timeline, highlighted, also when the message is far older than what the client
// has loaded. Unpin is reached with the keyboard. Pictures, files, a deleted message and the
// pins of an encrypted room show in the menu as well.
// Set ROOM_PIN_MENU_SHOTS=<directory> to save each open menu.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'room-pin-menu-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.ROOM_PIN_MENU_SHOTS;

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const ROOM_NAME = 'Harbor operations';
const OWNER_NAME = 'Harbor Coordinator';
const GUEST_NAME = 'Quay Planner';
const UNPINNED = 'Morning all, the crane inspection moved to Thursday at nine.';
const MESSAGES: { body: string; pinned: boolean; guest?: boolean }[] = [
  { body: UNPINNED, pinned: false },
  {
    body:
      'Reminder: berth four is closed for dredging until the end of the month, so the two container ' +
      'ships due on Tuesday go to berth six instead. The pilots have the new schedule, and the ' +
      'tug crews got it this morning. If anything in the plan clashes with your shifts, reply in ' +
      'this room before Friday so we can sort it out with the night team as well.',
    pinned: true,
  },
  { body: 'Who has the keys to the east gate this week?', pinned: false },
  {
    body: 'Safety briefing slides are in the shared folder under "Quarter three".',
    pinned: true,
    guest: true,
  },
  { body: 'The fuel delivery is confirmed for Wednesday afternoon.', pinned: true },
];
/** The pinned messages as the menu lists them: the newest pin first. */
const PINNED_NEWEST_FIRST = MESSAGES.filter((message) => message.pinned).reverse();

/** A 16 by 16 PNG, the guest's avatar and the pinned picture. */
const PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAABuklEQVR42g3LEaKFQAAAwH+cd4AO0AGCcDEIwsWBIFwMgnAx' +
    'CMLFIAg7QIf5jc/fz125a3fjDu7eHd2jO7kXd3bv7uK+3I/7df/9nJWzdjbO4Oyd0Tk6k3NxZufuLM7L+Thf5xdKpdRKowSl' +
    'V6IyKklZlKzsSlEu5VFe5QtH5agdjSM4ekd0jI7kWBzZsTuK43I8jtfxha2y1bbGFmy9LdpGW7IttmzbbcV22R7ba/tCruRa' +
    'buQg93KURznJi5zlXS7yJT/yK39hray1tbEGa2+N1tGarIs1W3drsV7Wx/pavzBX5trcmIO5N0fzaE7mxZzNu7mYL/Njfs1f' +
    'SJVUS40UpF6K0iglaZGytEtFuqRHeqUvTJWpNjWmYOpN0TSakmkxZdNuKqbL9Jhe0xdU1DQEeiIjiYXMTuHi4eULsRJrsRGD' +
    '2ItRHMUkLmIWd7GIl/iIr/iFoTLUhsYQDL0hGkZDMiyGbNgNxXAZHsNr+EJX6Wpdowu6Xhd1oy7pFl3W7bqiu3SP7tV9IVRC' +
    'LTRCEHohCqOQhEXIwi4U4RIe4RW+0FbaWttog7bXRu2oTdpFm7W7tmgv7aN9tf/avoYQsiFFKQAAAABJRU5ErkJggg==',
  'base64'
);

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const uploadMedia = async (
  session: MatrixSession,
  filename: string,
  contentType: string,
  body: Buffer
): Promise<string> => {
  const response = await fetch(
    `${HOMESERVER}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${session.accessToken}`, 'Content-Type': contentType },
      body,
    }
  );
  expect(response.ok, `uploading ${filename}`).toBe(true);
  return ((await response.json()) as { content_uri: string }).content_uri;
};

/** A new account with a display name and, when given, a picture. */
const register = async (
  username: string,
  displayname: string,
  avatar?: Buffer
): Promise<MatrixSession> => {
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
  const profile = `/profile/${encodeURIComponent(session.userId)}`;
  await matrixFetch(HOMESERVER, `${profile}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname }),
  });
  if (avatar) {
    const avatarUrl = await uploadMedia(session, 'avatar.png', 'image/png', avatar);
    await matrixFetch(HOMESERVER, `${profile}/avatar_url`, {
      method: 'PUT',
      accessToken: session.accessToken,
      body: JSON.stringify({ avatar_url: avatarUrl }),
    });
  }
  return session;
};

/** The account's 24 other rooms, then the room the spec pins messages in. */
const createRooms = async (owner: MatrixSession, invite: string[] = []): Promise<string> => {
  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      createRoom(HOMESERVER, owner.accessToken, { name: `Project room ${index + 1}` })
    )
  );
  return createRoom(HOMESERVER, owner.accessToken, { name: ROOM_NAME, invite });
};

const joinAs = (session: MatrixSession, roomId: string) =>
  matrixFetch(HOMESERVER, `/join/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    accessToken: session.accessToken,
    body: '{}',
  });

const pinEvents = (owner: MatrixSession, roomId: string, pinned: string[]) =>
  sendStateEvent(HOMESERVER, owner.accessToken, roomId, 'm.room.pinned_events', '', { pinned });

const serverPins = async (owner: MatrixSession, roomId: string): Promise<string[]> =>
  (
    await matrixFetch<{ pinned: string[] }>(
      HOMESERVER,
      `/rooms/${encodeURIComponent(roomId)}/state/m.room.pinned_events/`,
      { accessToken: owner.accessToken }
    )
  ).pinned;

const sentAt = async (owner: MatrixSession, roomId: string, eventId: string): Promise<number> =>
  (
    await matrixFetch<{ origin_server_ts: number }>(
      HOMESERVER,
      `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(eventId)}`,
      { accessToken: owner.accessToken }
    )
  ).origin_server_ts;

type Pin = { eventId: string; body: string; sender: string; ts: number };

/** Two people, 25 rooms, and one room whose messages are partly pinned, by both of them. */
const seed = async (name: string) => {
  const username = `rpm_${name}_${RUN}`;
  const owner = await register(username, OWNER_NAME);
  const guest = await register(`rpm_${name}_guest_${RUN}`, GUEST_NAME, PICTURE);
  const roomId = await createRooms(owner, [guest.userId]);
  await joinAs(guest, roomId);
  const pins: Pin[] = [];
  for (const { body, pinned, guest: byGuest } of MESSAGES) {
    const sender = byGuest ? guest : owner;
    // eslint-disable-next-line no-await-in-loop
    const eventId = await sendRoomMessage(HOMESERVER, sender.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    if (pinned) {
      // eslint-disable-next-line no-await-in-loop
      const ts = await sentAt(owner, roomId, eventId);
      pins.push({ eventId, body, sender: byGuest ? GUEST_NAME : OWNER_NAME, ts });
    }
  }
  // Pinned in the order the messages were sent, so the last one is the newest pin.
  await pinEvents(
    owner,
    roomId,
    pins.map((pin) => pin.eventId)
  );
  return { username, roomId, pins: pins.reverse() };
};

type MenuBox = { left: number; right: number; top: number; bottom: number; sideways: boolean };

/** The pin menu, found the way assistive technology finds it: the dialog its button announces. */
const pinMenu = (page: Page) => page.getByRole('dialog', { name: 'Pinned Messages', exact: true });

/** An entry's row button, named after what it does and who sent the message. */
const jumpButton = (menu: Locator, sender: string) =>
  menu.getByRole('button', { name: `Jump to message from ${sender}`, exact: true });

const measureMenu = (page: Page) =>
  pinMenu(page).evaluate((menu): MenuBox => {
    const box = menu.getBoundingClientRect();
    const sideways = [menu, ...menu.querySelectorAll('*')].some(
      (element) =>
        getComputedStyle(element).overflowX !== 'visible' &&
        element.scrollWidth > element.clientWidth + 1
    );
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, sideways };
  });

type SenderRow = {
  avatar: { left: number; right: number; top: number; bottom: number; picture: boolean } | null;
  name: { left: number; right: number; top: number; bottom: number; text: string } | null;
  time: {
    left: number;
    right: number;
    top: number;
    bottom: number;
    dateTime: string;
    text: string;
  } | null;
  menu: { left: number; right: number };
};

/** Where the avatar, name and time of one entry's row sit, and what they say. */
const measureSenderRow = (row: Locator, sender: string) =>
  row.evaluate((button, name): SenderRow => {
    const menu = button.closest('[role="dialog"]')!.getBoundingClientRect();
    const rect = (element: Element) => {
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
    };
    const avatar = button.querySelector('img, [data-avatar-fallback-id]');
    const nameElement = [...button.querySelectorAll('*')].find(
      (element) => element.children.length === 0 && element.textContent === name
    );
    const time = button.querySelector('time');
    return {
      avatar: avatar ? { ...rect(avatar), picture: avatar.tagName === 'IMG' } : null,
      name: nameElement ? { ...rect(nameElement), text: nameElement.textContent ?? '' } : null,
      time: time
        ? { ...rect(time), dateTime: time.dateTime, text: (time.textContent ?? '').trim() }
        : null,
      menu: { left: menu.left, right: menu.right },
    };
  }, sender);

/** Each entry's row: the sender's avatar and name, then the time, in reading order. */
const checkSenderRows = async (menu: Locator, pins: Pin[], rtl: boolean, where: string) => {
  for (const pin of pins) {
    const entry = menu.locator(`[data-pinned-event-id="${pin.eventId}"]`);
    // eslint-disable-next-line no-await-in-loop
    await expect(entry, `entry of ${pin.body.slice(0, 20)} (${where})`).toBeVisible();
    const row = jumpButton(entry, pin.sender);
    // eslint-disable-next-line no-await-in-loop
    await expect(row).toBeVisible();
    // eslint-disable-next-line no-await-in-loop
    const measured = await measureSenderRow(row, pin.sender);
    const label = `${pin.sender} (${where})`;
    expect(measured.avatar, `avatar of ${label}`).not.toBeNull();
    expect(measured.name, `name of ${label}`).not.toBeNull();
    expect(measured.time, `time of ${label}`).not.toBeNull();
    const { avatar, name, time, menu: box } = measured;
    // eslint-disable-next-line no-continue
    if (!avatar || !name || !time) continue;
    expect
      .soft(avatar.picture, `the guest's picture shows (${label})`)
      .toBe(pin.sender === GUEST_NAME);
    expect(new Date(time.dateTime).getTime(), `the time is the send time (${label})`).toBe(pin.ts);
    expect(time.text.length, `the time reads as text (${label})`).toBeGreaterThan(0);
    // One line, inside the menu, in reading order.
    const middle = (part: { top: number; bottom: number }) => (part.top + part.bottom) / 2;
    expect
      .soft(Math.abs(middle(name) - middle(time)), `name and time share a line (${label})`)
      .toBeLessThan(6);
    expect
      .soft(Math.abs(middle(avatar) - middle(name)), `avatar beside the name (${label})`)
      .toBeLessThan(6);
    for (const part of [avatar, name, time]) {
      expect
        .soft(part.left, `row starts inside the menu (${label})`)
        .toBeGreaterThanOrEqual(box.left);
      expect.soft(part.right, `row ends inside the menu (${label})`).toBeLessThanOrEqual(box.right);
    }
    if (rtl) {
      expect
        .soft(avatar.left, `avatar first, right to left (${label})`)
        .toBeGreaterThan(name.right - 1);
      expect.soft(name.left, `time last, right to left (${label})`).toBeGreaterThan(time.right - 1);
    } else {
      expect.soft(avatar.right, `avatar first (${label})`).toBeLessThan(name.left + 1);
      expect.soft(name.right, `time last (${label})`).toBeLessThan(time.left + 1);
    }
  }
};

const shoot = async (page: Page, testInfo: TestInfo, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/room-pin-menu-${name}.png` });
  await testInfo.attach(name, { body: await page.screenshot(), contentType: 'image/png' });
};

const checkPinMenu = async (page: Page, engine: string, form: string, testInfo: TestInfo) => {
  const { username, roomId, pins } = await seed(`${engine}_${form}`);
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const pinButton = page.getByRole('button', { name: 'Pinned Messages', exact: true });
  await expect(pinButton).toBeVisible({ timeout: 60_000 });

  for (const [scheme, rtl] of [
    ['light', false],
    ['dark', false],
    ['dark', true],
  ] as const) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: scheme });
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate(
      (dir) => document.documentElement.setAttribute('dir', dir),
      rtl ? 'rtl' : 'ltr'
    );
    // eslint-disable-next-line no-await-in-loop
    await pinButton.click();
    const menu = pinMenu(page);
    // eslint-disable-next-line no-await-in-loop
    await expect(menu.getByText('Pinned Messages', { exact: true })).toBeVisible();
    const bodies = PINNED_NEWEST_FIRST.map((message) => message.body);
    for (const body of bodies) {
      // eslint-disable-next-line no-await-in-loop
      await expect(menu.getByText(body, { exact: true })).toBeVisible();
    }
    // eslint-disable-next-line no-await-in-loop
    const order = await menu.evaluate(
      (element, texts) => texts.map((body) => (element.textContent ?? '').indexOf(body)),
      bodies
    );
    expect(order, 'newest pin first').toEqual([...order].sort((a, b) => a - b));
    expect(order.every((position) => position >= 0)).toBe(true);
    await expect(menu.getByText(UNPINNED, { exact: true })).toHaveCount(0);
    await expect(pinButton).toHaveAttribute('aria-expanded', 'true');
    const where = `${engine}, ${form}, ${scheme}${rtl ? ', rtl' : ''}`;
    // eslint-disable-next-line no-await-in-loop
    await checkSenderRows(menu, pins, rtl, where);

    // eslint-disable-next-line no-await-in-loop
    const box = await measureMenu(page);
    // eslint-disable-next-line no-await-in-loop
    const view = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    expect.soft(box.left, `menu starts inside the window (${where})`).toBeGreaterThanOrEqual(0);
    expect
      .soft(box.right, `menu ends inside the window (${where})`)
      .toBeLessThanOrEqual(view.width);
    expect
      .soft(box.bottom, `menu bottom inside the window (${where})`)
      .toBeLessThanOrEqual(view.height);
    expect.soft(box.sideways, `nothing in the menu scrolls sideways (${where})`).toBe(false);
    // eslint-disable-next-line no-await-in-loop
    await shoot(page, testInfo, `${engine}-${form}-${scheme}${rtl ? '-rtl' : ''}`);

    if (scheme === 'light') {
      // eslint-disable-next-line no-await-in-loop
      await page.keyboard.press('Escape');
    } else {
      // eslint-disable-next-line no-await-in-loop
      await menu.getByRole('button', { name: 'Close', exact: true }).click();
    }
    // eslint-disable-next-line no-await-in-loop
    await expect(menu).toHaveCount(0);
    // eslint-disable-next-line no-await-in-loop
    await expect(pinButton).toHaveAttribute('aria-expanded', 'false');
  }
};

/** Messages of realistic length that push the oldest pins out of the loaded timeline. */
const FILLERS = [
  'Pilot boarding moved to the outer anchorage while the swell is up.',
  'Can someone confirm the reefer plugs on the north quay are back in service? The night shift ' +
    'reported two of them tripping again around three.',
  'Weather update: gusts up to 30 knots after lunch, crane work stops above 25.',
  'Thanks, noted.',
  'The bunker barge is alongside the tanker at berth two, expect the fire watch until six.',
];
const FILLER_COUNT = 90;
const FAR_PIN = 'Gate passes for contractors now come from the security office, not reception.';
const RECENT_PIN = 'Tomorrow the morning meeting starts at half past seven, in the tower.';
const DELETED = 'This message is pinned and then deleted.';
const FILE_NAME = 'berth-plan.txt';
const PICTURE_NAME = 'quay-map.png';

/** One person, 25 rooms, and a room with pins far back in its history, media and a deletion. */
const seedHistory = async (name: string) => {
  const username = `rpj_${name}_${RUN}`;
  const owner = await register(username, OWNER_NAME);
  const roomId = await createRooms(owner);
  const send = (content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, owner.accessToken, roomId, content);
  const far = await send({ msgtype: 'm.text', body: FAR_PIN });
  const pictureUrl = await uploadMedia(owner, PICTURE_NAME, 'image/png', PICTURE);
  const picture = await send({
    msgtype: 'm.image',
    body: PICTURE_NAME,
    url: pictureUrl,
    info: { mimetype: 'image/png', w: 16, h: 16, size: PICTURE.length },
  });
  const fileBody = Buffer.from('Berth plan for next week\n');
  const fileUrl = await uploadMedia(owner, FILE_NAME, 'text/plain', fileBody);
  const file = await send({
    msgtype: 'm.file',
    body: FILE_NAME,
    url: fileUrl,
    info: { mimetype: 'text/plain', size: fileBody.length },
  });
  const deleted = await send({ msgtype: 'm.text', body: DELETED });
  for (let index = 0; index < FILLER_COUNT; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send({ msgtype: 'm.text', body: `${FILLERS[index % FILLERS.length]} (${index + 1})` });
  }
  const recent = await send({ msgtype: 'm.text', body: RECENT_PIN });
  await pinEvents(owner, roomId, [far, picture, file, deleted, recent]);
  await redactEvent(HOMESERVER, owner.accessToken, roomId, deleted);
  return { username, owner, roomId, far, picture, file, deleted, recent };
};

/** Records whether the row of `eventId` is ever drawn highlighted, from now on. */
const watchHighlight = (page: Page, eventId: string) =>
  page.evaluate((id) => {
    const state = window as Window & { pinHighlights?: Record<string, boolean> };
    const seen = state.pinHighlights ?? {};
    state.pinHighlights = seen;
    seen[id] = false;
    const started = performance.now();
    const tick = () => {
      const row = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
      const fill = row ? getComputedStyle(row).backgroundColor : 'rgba(0, 0, 0, 0)';
      if (fill !== 'rgba(0, 0, 0, 0)' && fill !== 'transparent') {
        seen[id] = true;
        return;
      }
      if (performance.now() - started < 60_000) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, eventId);

const highlighted = (page: Page, eventId: string) =>
  page.evaluate(
    (id) =>
      (window as Window & { pinHighlights?: Record<string, boolean> }).pinHighlights?.[id] ?? false,
    eventId
  );

/** The timeline's row of a message (the menu renders no such rows). */
const timelineRow = (page: Page, eventId: string) => page.locator(`[data-message-id="${eventId}"]`);

/** Tabs forward until `target` has focus; fails after 40 presses. */
const tabTo = async (page: Page, target: Locator) => {
  for (let presses = 0; presses < 40; presses += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (await target.evaluate((element) => element === document.activeElement)) return;
    // eslint-disable-next-line no-await-in-loop
    await page.keyboard.press('Tab');
  }
  throw new Error('Tab never reached the target');
};

const checkJump = async (
  page: Page,
  engine: string,
  form: 'desktop' | 'phone',
  testInfo: TestInfo
) => {
  const seeded = await seedHistory(`${engine}_${form}`);
  const { roomId } = seeded;
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const pinButton = page.getByRole('button', { name: 'Pinned Messages', exact: true });
  await expect(pinButton).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(RECENT_PIN, { exact: true })).toBeVisible({ timeout: 60_000 });
  // The oldest pin is far older than the loaded timeline.
  await expect(timelineRow(page, seeded.far)).toHaveCount(0);

  await pinButton.click();
  const menu = pinMenu(page);
  await expect(menu).toBeVisible();
  const entry = (eventId: string) => menu.locator(`[data-pinned-event-id="${eventId}"]`);
  // Every kind of pin shows its sender's row and its content.
  for (const eventId of [seeded.far, seeded.picture, seeded.file, seeded.deleted, seeded.recent]) {
    // eslint-disable-next-line no-await-in-loop
    await expect(jumpButton(entry(eventId), OWNER_NAME)).toBeVisible({ timeout: 30_000 });
  }
  await expect(entry(seeded.far).getByText(FAR_PIN, { exact: true })).toBeVisible();
  await expect(entry(seeded.picture).locator(`img[alt="${PICTURE_NAME}"]`)).toBeVisible({
    timeout: 30_000,
  });
  await expect(entry(seeded.file).getByText(FILE_NAME, { exact: true }).first()).toBeVisible();
  await expect(
    entry(seeded.deleted).getByText('This message has been deleted', { exact: true })
  ).toBeVisible();
  await expect(entry(seeded.deleted).getByText(DELETED)).toHaveCount(0);
  await shoot(page, testInfo, `jump-${engine}-${form}-menu`);

  // A click (a tap on the phone) on the oldest pin's message opens it in the timeline.
  await entry(seeded.far).scrollIntoViewIfNeeded();
  await watchHighlight(page, seeded.far);
  const farText = entry(seeded.far).getByText(FAR_PIN, { exact: true });
  if (form === 'phone') await farText.tap();
  else await farText.click();
  await expect(menu).toHaveCount(0);
  await expect(pinButton).toHaveAttribute('aria-expanded', 'false');
  await expect(timelineRow(page, seeded.far)).toBeInViewport({ timeout: 60_000 });
  await expect.poll(() => highlighted(page, seeded.far), { timeout: 10_000 }).toBe(true);
  await shoot(page, testInfo, `jump-${engine}-${form}-far`);

  // Enter on a row opens that message: the newest pin, back at the end of the timeline.
  await pinButton.click();
  await expect(menu).toBeVisible();
  const recentRow = jumpButton(entry(seeded.recent), OWNER_NAME);
  await tabTo(page, recentRow);
  await watchHighlight(page, seeded.recent);
  await page.keyboard.press('Enter');
  await expect(menu).toHaveCount(0);
  await expect(timelineRow(page, seeded.recent)).toBeInViewport({ timeout: 60_000 });
  await expect.poll(() => highlighted(page, seeded.recent), { timeout: 10_000 }).toBe(true);

  // Unpin is reached with the keyboard; focus stays in the menu.
  await pinButton.click();
  await expect(menu).toBeVisible();
  const unpin = entry(seeded.picture).getByRole('button', { name: 'Unpin Message', exact: true });
  await tabTo(page, unpin);
  await page.keyboard.press('Enter');
  await expect(entry(seeded.picture)).toHaveCount(0);
  await expect
    .poll(() => menu.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  await expect
    .poll(() => serverPins(seeded.owner, roomId), { timeout: 30_000 })
    .toEqual([seeded.far, seeded.file, seeded.deleted, seeded.recent]);
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
};

/** Opens an encrypted room, sends a message from the browser and pins it from its menu. */
const checkEncrypted = async (page: Page, engine: string, form: string, testInfo: TestInfo) => {
  const username = `rpe_${engine}_${form}_${RUN}`;
  const owner = await register(username, OWNER_NAME);
  await createRooms(owner);
  const roomId = (
    await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: owner.accessToken,
      body: JSON.stringify({
        name: 'Encrypted harbor notes',
        preset: 'private_chat',
        initial_state: [
          {
            type: 'm.room.encryption',
            state_key: '',
            content: { algorithm: 'm.megolm.v1.aes-sha2' },
          },
        ],
      }),
    })
  ).room_id;
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });
  const secret = 'The spare radio batteries are in the locker behind the tower stairs.';
  const send = async (body: string) => {
    await composer.click();
    await page.keyboard.type(body);
    await page.keyboard.press('Enter');
  };
  await send(secret);
  const row = page.locator('[data-message-id^="$"]').filter({ hasText: secret });
  await expect(row).toBeVisible({ timeout: 60_000 });
  const eventId = (await row.getAttribute('data-message-id')) ?? '';
  for (let index = 0; index < 4; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(`${FILLERS[index]} (${index + 1})`);
  }
  await row.click({ button: 'right' });
  await page.getByText('Pin Message', { exact: true }).click();
  const pinButton = page.getByRole('button', { name: 'Pinned Messages', exact: true });
  await expect(pinButton).toBeVisible({ timeout: 30_000 });

  await pinButton.click();
  const menu = pinMenu(page);
  const entry = menu.locator(`[data-pinned-event-id="${eventId}"]`);
  await expect(entry.getByText(secret, { exact: true })).toBeVisible({ timeout: 30_000 });
  await checkSenderRows(
    menu,
    [{ eventId, body: secret, sender: OWNER_NAME, ts: await sentAt(owner, roomId, eventId) }],
    false,
    `${engine}, ${form}, encrypted`
  );
  await shoot(page, testInfo, `encrypted-${engine}-${form}`);
  await watchHighlight(page, eventId);
  await jumpButton(entry, OWNER_NAME).click();
  await expect(menu).toHaveCount(0);
  await expect(timelineRow(page, eventId)).toBeInViewport({ timeout: 60_000 });
  await expect.poll(() => highlighted(page, eventId), { timeout: 10_000 }).toBe(true);
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

type Check = (
  page: Page,
  engine: string,
  form: 'desktop' | 'phone',
  info: TestInfo
) => Promise<void>;
const CHECKS: [string, Check][] = [
  ['the pin menu lists the pinned messages under their sender and time, and closes', checkPinMenu],
  ['an entry opens its message in the timeline, Unpin works from the keyboard', checkJump],
  ['an encrypted room’s pins show their sender and time and open their message', checkEncrypted],
];

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test.describe(form, () => {
    test.use(options);

    for (const [title, check] of CHECKS) {
      test(`${title} (Chromium, ${form})`, async ({ page }, testInfo) => {
        test.setTimeout(300_000);
        await check(page, 'chromium', form, testInfo);
      });

      test(`${title} (WebKit, ${form})`, async ({ baseURL }, testInfo) => {
        test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
        test.setTimeout(300_000);
        // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
        const browser = await launchWebKit();
        try {
          const context = await browser.newContext({ ...options, baseURL });
          await check(await context.newPage(), 'webkit', form, testInfo);
        } finally {
          await browser.close();
        }
      });
    }
  });
}
