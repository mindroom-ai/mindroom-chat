import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A member who renames themselves to an agent's display name must not pass for the agent: their
// messages show their user ID after the name, and so do the agent's while the two names clash. A
// member without a display name shows as their user ID's localpart; someone who takes that
// localpart as their name shows their user ID after it. A name nobody else has stays as it is. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit, in WebKit, on a desktop and a phone, against the disposable
// homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const PASSWORD = 'sender-name-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.SENDER_NAME_SHOTS;
const FILLER_ROOMS = 25;

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

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

const clearDisplayName = (session: MatrixSession) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
    method: 'DELETE',
    accessToken: session.accessToken,
  });

const roomMemberName = async (session: MatrixSession, roomId: string, userId: string) => {
  const member = await matrixFetch<{ displayname?: string }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/state/m.room.member/${encodeURIComponent(userId)}`,
    { accessToken: session.accessToken }
  );
  return member.displayname;
};

/**
 * A release room with 25 other rooms around it: the reader asks, the agent "Helper" answers, then
 * the writer renames themselves to "Helper" and answers too.
 */
const releaseRoom = async (tag: string) => {
  const reader = await registerPerson(`sender_reader_${tag}`, 'Robin Reader');
  const writer = await registerPerson(`sender_writer_${tag}`, 'Sam Writer');
  const agent = await registerAgentAccount(HOMESERVER, 'helper');
  await setDisplayName(agent, 'Helper');
  await Promise.all(
    Array.from({ length: FILLER_ROOMS }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, { name: `Project room ${index + 1} ${RUN}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Release planning ${tag} ${RUN}`,
    invite: [agent.userId, writer.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  // A member without a display name, and one who takes their localpart as a name.
  const quiet = await registerPerson(`sender_quiet_${tag}`, 'Quiet');
  const echo = await registerPerson(`sender_echo_${tag}`, 'Echo');
  for (const member of [quiet, echo]) {
    await matrixFetch(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/invite`, {
      method: 'POST',
      accessToken: reader.accessToken,
      body: JSON.stringify({ user_id: member.userId }),
    });
    await joinRoom(HOMESERVER, member.accessToken, roomId);
  }
  await clearDisplayName(quiet);
  await expect
    .poll(() => roomMemberName(reader, roomId, quiet.userId), { timeout: 20_000 })
    .toBeUndefined();
  await setDisplayName(echo, quiet.username);
  await expect
    .poll(() => roomMemberName(reader, roomId, echo.userId), { timeout: 20_000 })
    .toBe(quiet.username);

  const question = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Can someone check the release notes before Friday? The migration section changed this week and I want a second pair of eyes on it.',
  });
  const answer = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'I read the release notes. The migration section is correct, but the rollback steps still mention the old configuration flag.',
  });
  await setDisplayName(writer, 'Helper');
  await expect
    .poll(() => roomMemberName(reader, roomId, writer.userId), { timeout: 20_000 })
    .toBe('Helper');
  const quietNote = await sendRoomMessage(HOMESERVER, quiet.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'I can take the screenshots for the release notes tomorrow morning.',
  });
  const echoNote = await sendRoomMessage(HOMESERVER, echo.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Never mind the screenshots, they are already in the shared folder.',
  });
  const copy = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'The rollback steps are fixed now, so the release notes are ready to publish. Go ahead whenever you like.',
  });
  return {
    reader,
    writer,
    agent,
    quiet,
    echo,
    roomId,
    question,
    answer,
    quietNote,
    echoNote,
    copy,
  };
};

/** The bold sender name in the header of message `eventId`. */
const senderName = (page: Page, eventId: string, userId: string) =>
  page.locator(`[data-message-id="${eventId}"] button[data-user-id="${userId}"] b`);

const checkSenderNames = async (page: Page, tag: string) => {
  const {
    reader,
    writer,
    agent,
    quiet,
    echo,
    roomId,
    question,
    answer,
    quietNote,
    echoNote,
    copy,
  } = await releaseRoom(tag);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'threaded',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);

  const copyName = senderName(page, copy, writer.userId);
  const answerName = senderName(page, answer, agent.userId);
  const questionName = senderName(page, question, reader.userId);
  await expect(copyName).toBeVisible({ timeout: 60_000 });
  await expect(answerName).toBeVisible();
  await expect(questionName).toBeVisible();
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `${SHOTS}/timeline-${tag}-${scheme}.png` });
    }
    await page.emulateMedia({ colorScheme: 'light' });
  }

  // The copy and the agent both show their user ID; the reader's unique name stays as it is.
  await expect(copyName).toContainText('Helper');
  await expect(copyName).toContainText(writer.userId);
  await expect(answerName).toContainText('Helper');
  await expect(answerName).toContainText(agent.userId);
  await expect(questionName).toHaveText('Robin Reader');
  // The member without a name shows as their localpart; the one who took it shows their ID.
  const quietName = senderName(page, quietNote, quiet.userId);
  const echoName = senderName(page, echoNote, echo.userId);
  await expect(quietName).toHaveText(quiet.username);
  await expect(echoName).toContainText(quiet.username);
  await expect(echoName).toContainText(echo.userId);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const inContext = async (
  browser: Browser,
  options: BrowserContextOptions,
  run: (page: Page) => Promise<void>
) => {
  const context = await browser.newContext(options);
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
};

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

const TITLE = "a member who takes an agent's name shows their user ID";

test(`${TITLE} (Chromium, desktop)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(browser, { ...DESKTOP, baseURL }, (page) => checkSenderNames(page, 'cd'));
});

test(`${TITLE} (Chromium, phone)`, async ({ browser, baseURL }) => {
  test.setTimeout(180_000);
  await inContext(browser, { ...PHONE, baseURL }, (page) => checkSenderNames(page, 'cp'));
});

for (const [form, options, tag] of [
  ['desktop', { viewport: { width: 1440, height: 900 } }, 'wd'],
  ['phone', PHONE, 'wp'],
] as const) {
  test(`${TITLE} (WebKit, ${form})`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(180_000);
    const browser = await launchWebKit();
    try {
      await inContext(browser, { ...options, baseURL }, (page) => checkSenderNames(page, tag));
    } finally {
      await browser.close();
    }
  });
}
