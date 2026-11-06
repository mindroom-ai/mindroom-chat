import { expect, test, type Page } from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  createHiddenOverviewFilterState,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  redactEvent,
  registerAgentAccount,
  seedRoomOverviewState,
  sendMessageEdit,
  sendReaction,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A card's reply count follows a redaction of one of the thread's older replies. The reader's
// session never saw that reply: it came before the reader signed in and lies outside the synced
// window, so the redaction names an event the client does not know. The card kept counting it
// (12 where the server says 11), also after a reload, because the cached count and older copies
// of the root outvoted the server's summary. Edits and reactions are no replies either way.
const PASSWORD = 'thread-redacted-reply-count-password';
const RUN = Date.now().toString(36);
const REPLIES = 12;

type Account = MatrixSession & { username: string };

const register = async (homeserver: string, name: string): Promise<Account> => {
  const username = `trc_${name}_${RUN}`;
  await matrixFetch(homeserver, '/register', {
    method: 'POST',
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  return { ...(await loginToMatrix(homeserver, username, PASSWORD)), username };
};

const cardCount = (page: Page, rootId: string) =>
  page.locator(`[data-thread-root-id="${rootId}"] [data-compact-card-reply-count="true"]`);

const check = async (page: Page, engine: string) => {
  const homeserver = getHomeserver();
  const reader = await register(homeserver, `reader_${engine}`);
  const writer = await register(homeserver, `writer_${engine}`);
  const agent = await registerAgentAccount(homeserver, `planner_${engine}`);
  const roomId = await createRoom(homeserver, writer.accessToken, {
    name: 'Database migration',
    invite: [reader.userId, agent.userId],
  });
  await joinRoom(homeserver, reader.accessToken, roomId);
  await joinRoom(homeserver, agent.accessToken, roomId);
  const send = (account: MatrixSession, content: Record<string, unknown>) =>
    sendRoomMessage(homeserver, account.accessToken, roomId, content);
  const root = await send(writer, {
    msgtype: 'm.text',
    body: 'Database migration plan: move the reporting tables to the new cluster',
  });
  const replies: string[] = [];
  for (let index = 0; index < REPLIES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const reply = await send(index % 3 === 0 ? agent : writer, {
      msgtype: 'm.text',
      body: `Step ${index + 1}: checked the row counts for the tables of batch ${index + 1}.`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: root,
        is_falling_back: true,
        'm.in_reply_to': { event_id: root },
      },
    });
    replies.push(reply);
  }
  // Later room messages push the thread's replies out of the synced window.
  for (let index = 0; index < 30; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send(writer, { msgtype: 'm.text', body: `Status note ${index + 1}: no blockers today.` });
  }

  await loginWithPassword(page, { homeserver, username: reader.username, password: PASSWORD });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: reader.userId,
    viewMode: 'compact',
    filterState: createHiddenOverviewFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(cardCount(page, root)).toHaveText(String(REPLIES), { timeout: 30_000 });

  // Edits and a reaction leave the count; a redacted older reply leaves it too.
  await sendMessageEdit(homeserver, writer.accessToken, roomId, replies[1] ?? '', 'Step 2: done');
  await sendMessageEdit(homeserver, writer.accessToken, roomId, replies[2] ?? '', 'Step 3: done');
  await sendReaction(homeserver, agent.accessToken, roomId, replies[5] ?? '', '👍');
  await redactEvent(homeserver, writer.accessToken, roomId, replies[4] ?? '');
  await page.waitForTimeout(3_000);
  const live = (await cardCount(page, root).textContent())?.trim();
  test.info().annotations.push({ type: 'count after the redaction, live', description: `${live}` });

  // After a reload the server's summary says 11, and so does the card.
  await page.reload();
  await expect(cardCount(page, root)).toHaveText(String(REPLIES - 1), { timeout: 30_000 });
  await page.waitForTimeout(3_000);
  await expect(cardCount(page, root)).toHaveText(String(REPLIES - 1));

  // Opening the thread and coming back agrees.
  await cardCount(page, root).click();
  await expect(page.getByText('Step 12: checked the row counts', { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  await page.goBack();
  await expect(cardCount(page, root)).toHaveText(String(REPLIES - 1), { timeout: 30_000 });
};

test.use({ serviceWorkers: 'block' });

test('a redacted older reply leaves the card count after a reload (Chromium)', async ({ page }) => {
  test.setTimeout(240_000);
  await check(page, 'chromium');
});

test('a redacted older reply leaves the card count after a reload (WebKit, phone)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      serviceWorkers: 'block',
    });
    await check(await context.newPage(), 'webkit');
  } finally {
    await browser.close();
  }
});
