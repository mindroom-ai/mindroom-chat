import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// "@Min" and Tab in a room of MindRoom agents mentions Mind, whose display name matches, rather
// than the agent listed first: every agent's user ID starts with `mindroom_`, so its user name
// matches "min" too. The message goes out as "@Mind ..." with Mind in `m.mentions`. Runs in
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against
// the disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const PASSWORD = 'mention-ranking-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.MENTION_RANKING_SHOTS;
const FILLER_ROOMS = 24;

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const setDisplayName = (session: MatrixSession, displayName: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });

const registerPerson = async (localpart: string, displayName: string) => {
  const username = `${localpart}_${RUN}`;
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
  await setDisplayName(session, displayName);
  return { ...session, username };
};

const registerAgent = async (name: string, displayName: string) => {
  const session = await registerAgentAccount(HOMESERVER, name);
  await setDisplayName(session, displayName);
  return session;
};

type RoomMessage = {
  type: string;
  sender: string;
  content: {
    body?: string;
    formatted_body?: string;
    'm.mentions'?: { user_ids?: string[] };
  };
};

/** A launch room: the router and four agents, Mind joining last, so it is listed last. */
const launchRoom = async (tag: string) => {
  const reader = await registerPerson(`mar_reader_${tag}`, 'Robin Reader');
  const agents = {
    scout: await registerAgent('scout', 'Scout'),
    router: await registerAgent('router', 'RouterAgent'),
    quill: await registerAgent('quill', 'Quill'),
    forge: await registerAgent('forge', 'Forge'),
    mind: await registerAgent('mind', 'Mind'),
  };
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Launch day ${tag} ${RUN}`,
    invite: Object.values(agents).map((agent) => agent.userId),
  });
  for (const agent of Object.values(agents)) {
    await joinRoom(HOMESERVER, agent.accessToken, roomId);
  }
  await Promise.all(
    Array.from({ length: FILLER_ROOMS }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1} ${RUN}` })
    )
  );
  await sendRoomMessage(HOMESERVER, agents.mind.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'The launch checklist is up to date: pricing page, release notes and the status page are ready for review.',
  });
  await sendRoomMessage(HOMESERVER, agents.router.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Welcome to the launch room. Mention an agent by name to ask it directly, or ask the room and I will pick the agent that fits.',
  });
  return { reader, agents, roomId };
};

const ownLatestMessage = async (session: MatrixSession, roomId: string) => {
  const page = await matrixFetch<{ chunk: RoomMessage[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=10`,
    { accessToken: session.accessToken }
  );
  return page.chunk.find(
    (event) => event.type === 'm.room.message' && event.sender === session.userId
  );
};

const mentionMind = async (page: Page, tag: string, pick: 'tab' | 'tap') => {
  const { reader, agents, roomId } = await launchRoom(tag);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });
  // The room has loaded its members once the router's message shows (the room list previews it
  // too).
  await expect(page.getByText('Welcome to the launch room.').first()).toBeVisible({
    timeout: 30_000,
  });
  await composer.click();
  await page.keyboard.type('@Min');

  // The picker's rows: a name, then the user ID.
  const rows = page.getByRole('option', { name: /^(Scout|Mind|RouterAgent|Quill|Forge)\s*@/ });
  await expect(rows.first()).toBeVisible({ timeout: 20_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/picker-${tag}.png` });
  // Tab (or a tap on the top row) right away, as a person who sees the picker open does.
  if (pick === 'tab') await page.keyboard.press('Tab');
  else await rows.first().tap();

  const pill = composer.locator('[data-editor-inline="mention"]');
  await expect(pill).toHaveText('@Mind');
  await page.keyboard.type('check the launch numbers');
  // A phone's Enter starts a new line; the send button works everywhere.
  await page.getByRole('button', { name: 'Send message' }).click();

  await expect
    .poll(async () => (await ownLatestMessage(reader, roomId))?.content, { timeout: 20_000 })
    .toEqual({
      msgtype: 'm.text',
      body: '@Mind check the launch numbers',
      format: 'org.matrix.custom.html',
      formatted_body: `<a href="https://matrix.to/#/${agents.mind.userId}">@Mind</a> check the launch numbers`,
      'm.mentions': { user_ids: [agents.mind.userId] },
    });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/sent-${tag}.png` });
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = '"@Min" mentions Mind, not the agent listed first, and sends "@Mind"';

const inContext = async (
  browser: Browser,
  options: Parameters<Browser['newContext']>[0],
  run: (page: Page) => Promise<void>
) => {
  const context = await browser.newContext(options);
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
};

test(`${TITLE} with Tab (Chromium, desktop)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(browser, { viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
    mentionMind(page, 'cd', 'tab')
  );
});

test(`${TITLE} with a tap on the top row (Chromium, phone)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(
    browser,
    { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, baseURL },
    (page) => mentionMind(page, 'cp', 'tap')
  );
});

test(`${TITLE} with Tab (WebKit, desktop)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    await inContext(browser, { viewport: { width: 1440, height: 900 }, baseURL }, (page) =>
      mentionMind(page, 'wd', 'tab')
    );
  } finally {
    await browser.close();
  }
});
