import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Typing "@Min" and Tab picks Mind by display name, not another agent by the shared ID prefix.
// The owner, MindRoom, is not offered even though its name also matches. The message goes out
// as "@Mind ..." with Mind in `m.mentions`. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit, in WebKit, against the disposable homeserver of `just hs-up` or of
// a slot of scripts/e2e-slot.sh.
const PASSWORD = 'mention-ranking-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.MENTION_RANKING_SHOTS;
const FILLER_ROOMS = 24;

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const setDisplayName = (session: MatrixSession, displayName: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'PUT',
    accessToken: session.accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });

const registerPerson = async (localpart: string, displayName: string) => {
  const username = `${localpart}_${RUN}`;
  const session = await registerDisposableUser(username, PASSWORD);
  await setDisplayName(session, displayName);
  return session;
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

/** A launch room: the owner and four agents, Mind joining last, so it is listed last. */
const launchRoom = async (tag: string) => {
  const reader = await registerPerson(`mar_reader_${tag}`, 'Robin Reader');
  const accounts = {
    scout: await registerAgent('scout', 'Scout'),
    owner: await registerAgent('router', 'MindRoom'),
    quill: await registerAgent('quill', 'Quill'),
    forge: await registerAgent('forge', 'Forge'),
    mind: await registerAgent('mind', 'Mind'),
  };
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Launch day ${tag} ${RUN}`,
    invite: Object.values(accounts).map((account) => account.userId),
  });
  for (const account of Object.values(accounts)) {
    await joinRoom(HOMESERVER, account.accessToken, roomId);
  }
  await Promise.all(
    Array.from({ length: FILLER_ROOMS }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1} ${RUN}` })
    )
  );
  await sendRoomMessage(HOMESERVER, accounts.mind.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'The launch checklist is up to date: pricing page, release notes and the status page are ready for review.',
  });
  // A historical post makes the owner known even before all members load.
  await sendRoomMessage(HOMESERVER, accounts.owner.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'The launch room is ready.',
  });
  return { reader, accounts, roomId };
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
  const { reader, accounts, roomId } = await launchRoom(tag);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('The launch room is ready.').first()).toBeVisible({
    timeout: 30_000,
  });
  await composer.click();
  await page.keyboard.type('@Min');

  // Mind is offered, but MindRoom is not, even though "Min" starts both names.
  const rows = page.getByRole('option', { name: /^(Scout|Mind|MindRoom|Quill|Forge)\s*@/ });
  await expect(rows).toHaveCount(1, { timeout: 20_000 });
  await expect(rows.first()).toHaveAccessibleName(/^Mind\s*@/);
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
      formatted_body: `<a href="https://matrix.to/#/${accounts.mind.userId}">@Mind</a> check the launch numbers`,
      'm.mentions': { user_ids: [accounts.mind.userId] },
      // The send button's default mid-turn choice (#519) rides along with every message.
      'io.mindroom.mid_turn': 'auto',
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
