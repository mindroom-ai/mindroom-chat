import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import { joinRoom, matrixFetch, sendRoomMessage, type MatrixSession } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import { launchWebKit } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// Each message or invite notifies at most once on a device: a reload raises nothing that came
// before it, more tabs of the same session raise one notification between them, and a muted
// room pulls no attention. Runs against the disposable homeserver of `just hs-up` (or a slot of
// scripts/e2e-slot.sh), in Chromium and, when the runner names it, WebKit.
const PASSWORD = 'notification-dedupe-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const DESKTOP = { viewport: { width: 1280, height: 800 } };

type Engine = 'chromium' | 'webkit';
type Account = MatrixSession & { username: string };
type Shown = { tab: number; title: string; body?: string };

const register = (name: string): Promise<Account> =>
  registerDisposableUser(`nd_${name}_${RUN}`, PASSWORD);

/** A room of the reader's that the writer has joined. */
const sharedRoom = async (reader: Account, writer: Account, name: string): Promise<string> => {
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  return roomId;
};

/**
 * Every tab of the context records the notifications it raises into `shown`, which outlives a
 * reload: the browser's Notification API is replaced by a recorder with permission granted.
 */
const recordNotifications = async (context: BrowserContext, shown: Shown[], tabs: Page[]) => {
  await context.exposeBinding(
    'recordNotification',
    ({ page }, entry: { title: string; body?: string }) => {
      shown.push({ tab: tabs.indexOf(page), ...entry });
    }
  );
  await context.addInitScript(() => {
    const record = (
      window as unknown as {
        recordNotification: (entry: { title: string; body?: string }) => Promise<void>;
      }
    ).recordNotification;
    class RecordingNotification {
      static permission = 'granted';

      static requestPermission = async () => 'granted';

      onclick: (() => void) | null = null;

      constructor(title: string, options: NotificationOptions = {}) {
        record({ title, body: options.body }).catch(() => undefined);
      }

      close() {
        return undefined;
      }
    }
    Object.defineProperty(window, 'Notification', { value: RecordingNotification });
  });
};

const SHOTS = process.env.NOTIF_DEDUPE_SHOTS;

/** With NOTIF_DEDUPE_SHOTS set, a screenshot of the page into that directory. */
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

/** With NOTIF_DEDUPE_SHOTS set, the notifications every tab raised, as JSON. */
const saveLog = async (engine: Engine, name: string, shown: Shown[]) => {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await writeFile(path.join(SHOTS, `${engine}-${name}.json`), JSON.stringify(shown, null, 2));
};

const titles = (shown: Shown[]) => shown.map(({ title }) => title).sort();

/**
 * Sends `text` to the room every tab shows and waits until each tab shows it: by then each has
 * applied every sync before it. A short wait more lets any late notification land.
 */
const syncedThrough = async (tabs: Page[], writer: Account, roomId: string, text: string) => {
  await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, { msgtype: 'm.text', body: text });
  for (const tab of tabs) {
    // eslint-disable-next-line no-await-in-loop
    await expect(tab.getByText(text, { exact: true })).toBeVisible({ timeout: 30_000 });
  }
  await tabs[0]?.waitForTimeout(1_500);
};

const openRoom = async (tab: Page, roomId: string) => {
  await tab.goto(`/home/${encodeURIComponent(roomId)}`);
  await waitForLoggedInShell(tab);
  // A row under the pointer shows its options button in place of its badge or mark.
  await tab.mouse.move(900, 300);
};

const checkOncePerDevice = async (browser: Browser, baseURL: string, engine: Engine) => {
  const reader = await register(`${engine}_once_reader`);
  const writer = await register(`${engine}_once_writer`);
  const designId = await sharedRoom(reader, writer, 'Design Desk');
  const opsId = await sharedRoom(reader, writer, 'Ops Desk');

  const context = await browser.newContext({ ...DESKTOP, baseURL });
  const shown: Shown[] = [];
  const tabs: Page[] = [];
  await recordNotifications(context, shown, tabs);
  const first = await context.newPage();
  tabs.push(first);
  await loginWithPassword(first, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await openRoom(first, designId);
  await syncedThrough(tabs, writer, designId, 'Design review starts at noon');
  expect(shown, `${engine}: the open room's message is on screen`).toEqual([]);

  // An invite and a message in another room, while the tab runs: one notification each.
  await createRoom(HOMESERVER, writer.accessToken, {
    name: 'Invite Desk',
    invite: [reader.userId],
  });
  await sendRoomMessage(HOMESERVER, writer.accessToken, opsId, {
    msgtype: 'm.text',
    body: 'Deploy finished on staging',
  });
  await expect.poll(() => titles(shown), { timeout: 30_000 }).toEqual(['Invitation', 'Ops Desk']);

  // L2-F010, L2-F011: a reload raises nothing for the invite or the message it notified before.
  let seen = shown.length;
  await first.reload();
  await waitForLoggedInShell(first);
  await syncedThrough(tabs, writer, designId, 'Checked in after the reload');
  expect.soft(titles(shown.slice(seen)), `${engine}: raised after the reload`).toEqual([]);

  // L5-F026: two more tabs of the same session; their start raises nothing, and each new invite
  // or message raises one notification between the three tabs.
  seen = shown.length;
  for (let index = 0; index < 2; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const tab = await context.newPage();
    tabs.push(tab);
    // eslint-disable-next-line no-await-in-loop
    await openRoom(tab, designId);
  }
  await syncedThrough(tabs, writer, designId, 'Three tabs are open');
  expect.soft(titles(shown.slice(seen)), `${engine}: raised as two more tabs started`).toEqual([]);

  seen = shown.length;
  await createRoom(HOMESERVER, writer.accessToken, {
    name: 'Invite Desk Two',
    invite: [reader.userId],
  });
  await sendRoomMessage(HOMESERVER, writer.accessToken, opsId, {
    msgtype: 'm.text',
    body: `${reader.userId} the rollback plan is ready`,
    'm.mentions': { user_ids: [reader.userId] },
  });
  await expect.poll(() => shown.length - seen, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await syncedThrough(tabs, writer, designId, 'All three tabs have the news');
  await saveLog(engine, 'once-per-device', shown);
  expect(titles(shown.slice(seen)), `${engine}: raised across three tabs`).toEqual([
    'Invitation',
    'Ops Desk',
  ]);
  await context.close();
};

/** The rail's Home entry shows an unread badge. */
const homeRailBadge = (page: Page) =>
  page
    .getByRole('button', { name: 'Home', exact: true })
    .first()
    .locator('xpath=following-sibling::div');

const checkMutedRoom = async (browser: Browser, baseURL: string, engine: Engine) => {
  const reader = await register(`${engine}_mute_reader`);
  const writer = await register(`${engine}_mute_writer`);
  const designId = await sharedRoom(reader, writer, 'Design Desk');
  const mutedId = await sharedRoom(reader, writer, 'Muted Desk');
  // A mute is an override rule named after the room that does nothing (spec, "Push Rules").
  await matrixFetch(HOMESERVER, `/pushrules/global/override/${encodeURIComponent(mutedId)}`, {
    method: 'PUT',
    accessToken: reader.accessToken,
    body: JSON.stringify({
      actions: [],
      conditions: [{ kind: 'event_match', key: 'room_id', pattern: mutedId }],
    }),
  });

  const context = await browser.newContext({ ...DESKTOP, baseURL });
  const shown: Shown[] = [];
  const page = await context.newPage();
  await recordNotifications(context, shown, [page]);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await openRoom(page, designId);
  const mutedRow = page.getByRole('link', { name: /Muted Desk/ });
  await expect(mutedRow.getByLabel('Muted')).toBeVisible({ timeout: 30_000 });

  // L2-F009: two messages and a mention in the muted room.
  for (const body of ['Lunch order is in', 'Standup moved to ten']) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, writer.accessToken, mutedId, { msgtype: 'm.text', body });
  }
  await sendRoomMessage(HOMESERVER, writer.accessToken, mutedId, {
    msgtype: 'm.text',
    body: `${reader.userId} please take a look`,
    'm.mentions': { user_ids: [reader.userId] },
  });
  await syncedThrough([page], writer, designId, 'Anything else for today?');

  await shot(page, `${engine}-muted-room`);
  expect(shown, `${engine}: a muted room raises no notification`).toEqual([]);
  await expect(
    mutedRow.getByLabel('Muted'),
    `${engine}: the muted row keeps its mark`
  ).toBeVisible();
  await expect(homeRailBadge(page), `${engine}: Home shows no unread badge`).toHaveCount(0);

  // The same messages in a room that is not muted do mark it and Home.
  const openId = await sharedRoom(reader, writer, 'Open Desk');
  await sendRoomMessage(HOMESERVER, writer.accessToken, openId, {
    msgtype: 'm.text',
    body: 'Lunch order is in here too',
  });
  await expect(homeRailBadge(page), `${engine}: Home shows the open room's unread`).toHaveCount(1, {
    timeout: 30_000,
  });
  await shot(page, `${engine}-open-room-unread`);
  await context.close();
};

const inWebKit = async (run: (browser: Browser) => Promise<void>) => {
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await launchWebKit();
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a message or invite notifies once per device, across reloads and tabs (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await checkOncePerDevice(browser, baseURL ?? '', 'chromium');
});

test('a message or invite notifies once per device, across reloads and tabs (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  await inWebKit((browser) => checkOncePerDevice(browser, baseURL ?? '', 'webkit'));
});

test('a muted room shows no unread mark on its row or on Home (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await checkMutedRoom(browser, baseURL ?? '', 'chromium');
});

test('a muted room shows no unread mark on its row or on Home (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  await inWebKit((browser) => checkMutedRoom(browser, baseURL ?? '', 'webkit'));
});
