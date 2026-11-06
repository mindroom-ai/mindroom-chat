import { expect, test, webkit, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { loginToMatrix, matrixFetch, sendRoomMessage } from '../helpers/matrix';

// The rows for a new room name or topic quote what it changed to, a long topic stays on one line
// cut with an ellipsis (the whole text in the row's tooltip), a removal says so, and the quoted
// text and the sender's name keep their own direction. Runs at desktop and phone sizes in
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against
// the disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'state-values-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const SHOTS = process.env.STATE_VALUES_SHOTS;
const DESKTOP = { viewport: { width: 1280, height: 800 }, hasTouch: false };
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true };
type Screen = typeof DESKTOP;

const SENDER = 'Robin';
const NAME = 'Design studio';
const TOPIC = 'Weekly planning and notes';
const LONG_TOPIC =
  'Weekly planning and notes for the design studio: every Monday we review the open ' +
  'briefs, agree on who takes which client request, and collect the sketches, mood boards ' +
  'and supplier quotes that came in over the weekend. Decisions go in the pinned summary, ' +
  'questions for the print shop go in their own thread, and anything urgent goes to the ' +
  'studio lead before noon so the afternoon stays free for focused work.';
const RTL_NAME = 'استوديو التصميم';
const MARKUP_NAME = 'Notes <3 & <i>more</i>';

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

const register = async (name: string) => {
  const username = `rsv_${name}_${RUN}`;
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
    body: JSON.stringify({ displayname: SENDER }),
  });
  return { ...session, username };
};

/** Sets a state event and answers its event ID. */
const setState = async (
  accessToken: string,
  roomId: string,
  type: string,
  content: Record<string, unknown>
): Promise<string> => {
  const sent = await matrixFetch<{ event_id: string }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(type)}/`,
    { method: 'PUT', accessToken, body: JSON.stringify(content) }
  );
  return sent.event_id;
};

/** A name or topic row's line, which carries the whole new value as its tooltip. */
const lineOf = (row: Locator) => row.locator('[title]');

const checkRows = async (page: Page, screen: Screen, name: string) => {
  const reader = await register(name);
  // A sidebar with as many rooms as a working account has.
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project ${index + 1} ${name} ${RUN}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Studio ${name} ${RUN}`,
  });
  const ids = {
    name: await setState(reader.accessToken, roomId, 'm.room.name', { name: NAME }),
    topic: await setState(reader.accessToken, roomId, 'm.room.topic', { topic: TOPIC }),
    longTopic: await setState(reader.accessToken, roomId, 'm.room.topic', { topic: LONG_TOPIC }),
    rtlName: await setState(reader.accessToken, roomId, 'm.room.name', { name: RTL_NAME }),
    markupName: await setState(reader.accessToken, roomId, 'm.room.name', { name: MARKUP_NAME }),
    noName: await setState(reader.accessToken, roomId, 'm.room.name', {}),
    noTopic: await setState(reader.accessToken, roomId, 'm.room.topic', { topic: '' }),
  };
  const newest = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'The new brief is in the shared folder.',
  });
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
  await expect(page.locator(`[data-message-id="${newest}"]`)).toBeVisible({ timeout: 60_000 });
  const row = (key: keyof typeof ids) => page.locator(`[data-message-id="${ids[key]}"]`);

  await expect(row('name')).toHaveText(`${SENDER} changed the room name to “${NAME}”`);
  await expect(row('topic')).toHaveText(`${SENDER} changed the topic to “${TOPIC}”`);
  await expect(row('markupName')).toHaveText(`${SENDER} changed the room name to “${MARKUP_NAME}”`);
  await expect(row('noName')).toHaveText(`${SENDER} removed the room name`);
  await expect(row('noTopic')).toHaveText(`${SENDER} removed the topic`);

  // The long topic: one line as tall as the short one, cut with an ellipsis inside the row, and
  // the whole topic in the tooltip.
  await row('longTopic').scrollIntoViewIfNeeded();
  const long = lineOf(row('longTopic'));
  await expect(long).toHaveAttribute('title', LONG_TOPIC);
  const shortBox = await lineOf(row('topic')).boundingBox();
  const longBox = await long.boundingBox();
  expect(longBox && shortBox && Math.abs(longBox.height - shortBox.height)).toBeLessThan(1);
  const cut = await long.evaluate((element) => ({
    overflow: element.scrollWidth > element.clientWidth,
    ellipsis: getComputedStyle(element).textOverflow,
    right: element.getBoundingClientRect().right,
  }));
  expect(cut.overflow, 'long topic is cut').toBe(true);
  expect(cut.ellipsis).toBe('ellipsis');
  expect(cut.right).toBeLessThanOrEqual(screen.viewport.width);

  // The quoted name and the sender keep their own direction inside the sentence.
  const isolation = (locator: Locator) =>
    locator.evaluate((element) => getComputedStyle(element).unicodeBidi);
  await expect(row('rtlName').locator('bdi')).toHaveText(RTL_NAME);
  expect(await isolation(row('rtlName').locator('bdi'))).toBe('isolate');
  expect(await isolation(row('rtlName').locator('b'))).toBe('isolate');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/state-values-${name}.png` });

  // In Arabic the sentence is Arabic and the quoted Latin name stays isolated.
  await page.evaluate(() => localStorage.setItem('i18nextLng', 'ar'));
  await page.reload();
  await expect(page.locator(`[data-message-id="${newest}"]`)).toBeVisible({ timeout: 60_000 });
  // The Arabic sentence also wraps the value in isolate marks (U+2068, U+2069).
  await expect(row('name').locator('bdi')).toHaveText(`\u2068${NAME}\u2069`);
  await expect(row('name')).not.toContainText('changed the room name');
  expect(await isolation(row('name').locator('bdi'))).toBe('isolate');
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/state-values-${name}-ar.png` });
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'room name and topic rows quote the new value';

for (const [label, screen] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test(`${TITLE} (Chromium, ${label})`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    const context = await browser.newContext({ ...screen, baseURL });
    try {
      await checkRows(await context.newPage(), screen, `c${label[0]}`);
    } finally {
      await context.close();
    }
  });

  test(`${TITLE} (WebKit, ${label})`, async ({ baseURL }) => {
    test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(240_000);
    // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
    const browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
    try {
      const context = await browser.newContext({ ...screen, baseURL });
      await checkRows(await context.newPage(), screen, `w${label[0]}`);
    } finally {
      await browser.close();
    }
  });
}
