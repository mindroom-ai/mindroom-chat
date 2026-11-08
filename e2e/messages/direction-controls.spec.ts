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
import { openMessageMenu } from '../helpers/messageMenu';
import {
  createDefaultThreadFilterState,
  joinRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Bidirectional controls (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C) change the
// order text shows in without showing themselves: `invoice<U+202E>fdp.exe` reads as a PDF. A
// member's plain and formatted messages, a file's name, the text viewer and View Source show each
// control as its code point instead, while Copy All copies the text as it is (Chromium, which
// lets the test read the clipboard). Against the disposable homeserver of a slot, on a phone
// (390 by 844, touch) and a desktop (1280 by 800), in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// DIRECTION_CONTROLS_SHOTS=<directory> to save each view.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'direction-controls-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.DIRECTION_CONTROLS_SHOTS;
const ROOM_NAME = 'Audit Desk';
const FILLER_ROOMS = 24;
const HISTORY = 24;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const CONTROL = /[؜‎‏‪-‮⁦-⁩]/;

const PLAIN = 'Rename the report to invoice‮txt.exe‬ before it goes to the auditors.';
const PLAIN_SHOWN =
  'Rename the report to invoice<U+202E>txt.exe<U+202C> before it goes to the auditors.';
const FORMATTED_TEXT = 'Run step⁧ cleanup⁩ after the deploy‏.';
const FORMATTED_SHOWN = 'Run step<U+2067> cleanup<U+2069> after the deploy<U+200F>.';
const FILE_NAME = 'quarterly-report‮fdp.exe';
const FILE_NAME_SHOWN = 'quarterly-report<U+202E>fdp.exe';
const FILE_TEXT = 'Quarterly notes\nCommand: echo ok ‮; rm -rf data #‬ done\n';
const FILE_TEXT_SHOWN = 'Command: echo ok <U+202E>; rm -rf data #<U+202C> done';

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

type Account = MatrixSession & { username: string };

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `bidi_${name}_${RUN}`;
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

const upload = async (accessToken: string, text: string): Promise<string> => {
  const response = await fetch(`${HOMESERVER}/_matrix/media/v3/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'text/plain' },
    body: Buffer.from(text),
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { content_uri: string }).content_uri;
};

type World = {
  reader: Account;
  roomId: string;
  plainId: string;
  formattedId: string;
  fileId: string;
};

const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(`reader_${engine}`);
  const member = await registerAndLogin(`member_${engine}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [member.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Ledger room ${index}` });
  for (let index = 1; index <= HISTORY; index += 1) {
    const fromMember = index % 2 === 0;
    await sendRoomMessage(HOMESERVER, (fromMember ? member : reader).accessToken, roomId, {
      msgtype: 'm.text',
      body: fromMember
        ? `Entry ${index}: the ledger balances for this week and the receipts are filed.`
        : `Entry ${index}: anything missing from the receipts this week?`,
    });
  }
  const plainId = await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    body: PLAIN,
  });
  const formattedId = await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.text',
    body: FORMATTED_TEXT,
    format: 'org.matrix.custom.html',
    formatted_body: `<p>Run <b>step⁧ cleanup⁩</b> after the deploy‏.</p>`,
  });
  const fileId = await sendRoomMessage(HOMESERVER, member.accessToken, roomId, {
    msgtype: 'm.file',
    body: FILE_NAME,
    url: await upload(member.accessToken, FILE_TEXT),
    info: { mimetype: 'text/plain', size: Buffer.byteLength(FILE_TEXT) },
  });
  return { reader, roomId, plainId, formattedId, fileId };
};

const row = (page: Page, eventId: string): Locator =>
  page.locator(`[data-message-id="${eventId}"]`).first();

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The scope shows `shown` and holds no control character. */
const expectShown = async (scope: Locator, shown: string) => {
  await expect(scope).toContainText(shown, { timeout: 30_000 });
  expect(await scope.textContent()).not.toMatch(CONTROL);
};

/** Copy All in the open viewer puts text on the clipboard that `matches`, controls and all. */
const expectCopyAll = async (page: Page, matches: (text: string) => boolean) => {
  await page.getByText('Copy All', { exact: true }).click();
  await expect
    .poll(async () => matches(await page.evaluate(() => navigator.clipboard.readText())))
    .toBe(true);
};

const check = async (page: Page, world: World, label: string, canRead: boolean) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'threaded',
    filterState: createDefaultThreadFilterState(),
  });
  await page.evaluate((route) => {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(world.roomId)}/`);
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });

  // Message text, plain and formatted, and the file's name.
  await expectShown(row(page, world.plainId), PLAIN_SHOWN);
  await expectShown(row(page, world.formattedId), FORMATTED_SHOWN);
  const file = row(page, world.fileId);
  await expectShown(file, FILE_NAME_SHOWN);
  await file.scrollIntoViewIfNeeded();
  await shot(page, `${label}-room`);

  // The text viewer: its title and the file's text.
  await file.getByRole('button', { name: /^Open / }).click();
  const viewer = page.getByRole('dialog').filter({ has: page.locator('pre') });
  await expect(viewer).toBeVisible({ timeout: 30_000 });
  await expectShown(viewer, FILE_NAME_SHOWN);
  await expectShown(viewer.locator('pre'), FILE_TEXT_SHOWN);
  await shot(page, `${label}-text-viewer`);
  if (canRead) await expectCopyAll(page, (text) => text === FILE_TEXT);
  await page.keyboard.press('Escape');
  await expect(viewer).toBeHidden();

  // View Source of the plain message.
  await openMessageMenu(page, row(page, world.plainId), 'Rename', label.endsWith('phone'));
  await page.getByRole('menuitem', { name: 'View Source' }).click({ timeout: 30_000 });
  const source = page.locator('pre.language-json');
  await expect(source).toBeVisible({ timeout: 30_000 });
  await expectShown(source, `"body": "${PLAIN_SHOWN}"`);
  await shot(page, `${label}-view-source`);
  if (canRead) await expectCopyAll(page, (text) => text.includes(`"body": "${PLAIN}"`));
  await page.keyboard.press('Escape');
  await expect(source).toBeHidden();
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    const context = await browser.newContext({ ...options, baseURL });
    try {
      const canRead = engine === 'chromium';
      if (canRead) await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      await check(page, world, `${engine}-${viewport}`, canRead);
      expect(pageErrors, `uncaught errors in ${engine} ${viewport}`).toEqual([]);
    } finally {
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('direction controls show as code points in messages, files and sources (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('direction controls show as code points in messages, files and sources (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
