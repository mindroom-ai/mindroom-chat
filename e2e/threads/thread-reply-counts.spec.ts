import { expect, test, type Page } from '@playwright/test';
import { activeAccountButtonNamePattern } from '../helpers/auth';
import { buildLoginPath } from '../env';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  matrixFetch,
  redactEvent,
  seedRoomOverviewState,
  sendMessageEdit,
  sendRoomMessage,
} from '../helpers/matrix';
import { defined } from '../../src/test/utils/defined';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Thread reply counts on the Compact cards, in Home and beside the Threads list, from the first
// sign-in through new replies, edits, redactions, reloads and opening the thread.
// Until the client opens or shows a thread, its count comes from the root's server summary and
// the replies sync brought; the SDK used to count the synced replies on top of the summary that
// already counted them (6 for a thread of 3), above all after a reload.

const PASSWORD = 'thread-reply-counts-password';

const register = async (username: string): Promise<string> => {
  const body = await matrixFetch<{ access_token: string }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  return body.access_token;
};

const replyTo = (rootId: string, body: string) => ({
  msgtype: 'm.text',
  body,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

const cardCount = (page: Page, rootId: string) =>
  page.locator(`[data-thread-root-id="${rootId}"] [data-compact-card-reply-count]`).first();

/**
 * The counts each card shows, in order, from the moment it appears for `holdMs`, and with
 * `settled`, on until every card shows its settled count (a minute at most).
 */
const sampleCounts = async (
  page: Page,
  roots: string[],
  holdMs: number,
  settled?: Record<string, number>
): Promise<Map<string, string[]>> => {
  await Promise.all(
    roots.map((rootId) => expect(cardCount(page, rootId)).toBeVisible({ timeout: 120_000 }))
  );
  const shown = new Map<string, string[]>(roots.map((rootId) => [rootId, []]));
  const isSettled = () =>
    !settled || roots.every((rootId) => shown.get(rootId)?.at(-1) === `${settled[rootId]}`);
  const until = Date.now() + holdMs;
  const giveUp = until + 60_000;
  while (Date.now() < until || (!isSettled() && Date.now() < giveUp)) {
    // eslint-disable-next-line no-await-in-loop
    const texts = await Promise.all(
      roots.map((rootId) => cardCount(page, rootId).textContent({ timeout: 5_000 }))
    );
    roots.forEach((rootId, index) => {
      const sequence = shown.get(rootId)!;
      const text = (texts[index] ?? '').trim();
      if (sequence.at(-1) !== text) sequence.push(text);
    });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(150);
  }
  return shown;
};

/**
 * Every card shows its expected count from the moment it appears and keeps showing it, so a
 * count that is wrong at first and corrected later fails too.
 */
const expectCountsHold = async (page: Page, expected: Record<string, number>, holdMs = 3_000) => {
  const shown = await sampleCounts(page, Object.keys(expected), holdMs);
  Object.keys(expected).forEach((rootId) =>
    expect(shown.get(rootId), rootId).toEqual([`${expected[rootId]}`])
  );
};

/**
 * A reloaded page starts from the saved sync, which can be older than what the page showed: each
 * card shows either the server's count from the start, or the saved count until the server's
 * arrives, and never any other count.
 */
const expectSavedThenServerCounts = async (
  page: Page,
  expected: Record<string, { saved: number; server: number }>,
  holdMs = 3_000
) => {
  const server = Object.fromEntries(
    Object.entries(expected).map(([rootId, counts]) => [rootId, counts.server])
  );
  const shown = await sampleCounts(page, Object.keys(expected), holdMs, server);
  Object.entries(expected).forEach(([rootId, counts]) => {
    const allowed = [[`${counts.server}`], [`${counts.saved}`, `${counts.server}`]];
    expect(allowed, `${rootId} showed ${JSON.stringify(shown.get(rootId))}`).toContainEqual(
      shown.get(rootId)
    );
  });
};

/** Signs in through the login page; a loaded machine can take a minute to show the shell. */
const signIn = async (page: Page, username: string) => {
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER, {
    timeout: 60_000,
  });
  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await expect(page.getByRole('button', { name: activeAccountButtonNamePattern })).toBeVisible({
    timeout: 120_000,
  });
};

/** The thread list and reply pages bring server counts; without them only sync forms a count. */
const blockThreadRequests = async (page: Page) => {
  await page.route(/\/rooms\/[^/]+\/(threads(\?|$)|relations\/)/, (route) => route.abort());
};

test('thread reply counts stay right through reloads, replies, edits, redactions and opening', async ({
  page,
}) => {
  // Two reloads and a thread opening on a loaded machine.
  test.setTimeout(480_000);
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );

  const username = `counts_${Date.now().toString(36)}`;
  const token = await register(username);
  const roomId = await createPrivateRoom(HOMESERVER, token, {
    name: 'Reply Counts',
    topic: 'Thread reply counts',
  });
  const send = (content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, token, roomId, content, 'reply-counts');
  const launch = await send({ msgtype: 'm.text', body: 'Launch checklist' });
  const launchReplies: string[] = [];
  for (const body of ['Docs are ready', 'Billing is ready', 'Support is ready']) {
    // eslint-disable-next-line no-await-in-loop
    launchReplies.push(await send(replyTo(launch, body)));
  }
  const retro = await send({ msgtype: 'm.text', body: 'Retro notes' });
  for (const body of ['What went well', 'What to change']) {
    // eslint-disable-next-line no-await-in-loop
    await send(replyTo(retro, body));
  }

  await blockThreadRequests(page);
  await signIn(page, username);
  // A room without agents opens in Threads unless the reader chose a view.
  const whoami = await matrixFetch<{ user_id: string }>(HOMESERVER, '/account/whoami', {
    accessToken: token,
  });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: whoami.user_id,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  const roomPath = `/home/${encodeURIComponent(roomId)}/`;
  await page.goto(roomPath);

  // The first sync brings both roots with the replies their summaries count.
  await expectCountsHold(page, { [launch]: 3, [retro]: 2 });

  // The saved sync replays the same roots and replies after a reload.
  await page.reload();
  await expectCountsHold(page, { [launch]: 3, [retro]: 2 });

  // A new reply counts once.
  const late = await send(replyTo(launch, 'Legal is ready'));
  await expect(cardCount(page, launch)).toHaveText('4', { timeout: 30_000 });
  await expectCountsHold(page, { [launch]: 4, [retro]: 2 }, 1_500);

  // Edits are no replies.
  await sendMessageEdit(HOMESERVER, token, roomId, late, 'Legal is ready, signed');
  await sendMessageEdit(
    HOMESERVER,
    token,
    roomId,
    defined(launchReplies[0], 'the first launch reply'),
    'Docs are ready and live'
  );
  // An unopened thread keeps edits for its first page, so give sync a moment to bring them.
  await page.waitForTimeout(3_000);
  await expectCountsHold(page, { [launch]: 4, [retro]: 2 }, 1_500);

  // A redacted reply leaves the count.
  await redactEvent(HOMESERVER, token, roomId, late);
  await expect(cardCount(page, launch)).toHaveText('3', { timeout: 30_000 });
  await expectCountsHold(page, { [launch]: 3, [retro]: 2 }, 1_500);

  // Reloading keeps all of that; the saved sync holds the reply and its redaction together.
  await page.reload();
  await expectCountsHold(page, { [launch]: 3, [retro]: 2 });

  // Opening the thread loads its replies from the server, which agrees.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.goto(`${roomPath}?threadId=${encodeURIComponent(launch)}`);
  await expect(page.getByText('Docs are ready and live').first()).toBeVisible({ timeout: 60_000 });
  await page.goto(roomPath);
  await expectCountsHold(page, { [launch]: 3, [retro]: 2 });

  // In an opened thread, a redaction of a reply from the first sync and a new reply count too.
  await redactEvent(
    HOMESERVER,
    token,
    roomId,
    defined(launchReplies[1], 'the second launch reply')
  );
  await expect(cardCount(page, launch)).toHaveText('2', { timeout: 30_000 });
  await send(replyTo(launch, 'Sales is ready'));
  await expect(cardCount(page, launch)).toHaveText('3', { timeout: 30_000 });
  await expectCountsHold(page, { [launch]: 3, [retro]: 2 }, 1_500);

  // A reload starts from the saved sync. The client saved it right after the redaction and not
  // after the newest reply (only the first sync of a page and redactions save it), so a card may
  // show the count from between the two until sync and the thread list bring the newest reply. The
  // event cache's copy of the root, saved before the redaction, still counts the redacted reply;
  // the room's root must not take its count.
  await page.reload();
  await expectSavedThenServerCounts(page, {
    [launch]: { saved: 2, server: 3 },
    [retro]: { saved: 2, server: 2 },
  });

  // The room beside the Threads list shows the same counts. Another redaction and reply leave the
  // saved sync behind again, and going there loads the page again.
  await redactEvent(HOMESERVER, token, roomId, defined(launchReplies[0], 'the first launch reply'));
  await expect(cardCount(page, launch)).toHaveText('2', { timeout: 30_000 });
  await send(replyTo(launch, 'Ops is ready'));
  await expect(cardCount(page, launch)).toHaveText('3', { timeout: 30_000 });
  await expectCountsHold(page, { [launch]: 3, [retro]: 2 }, 1_500);
  await page.goto(`/threads/${encodeURIComponent(roomId)}/`);
  await expectSavedThenServerCounts(page, {
    [launch]: { saved: 2, server: 3 },
    [retro]: { saved: 2, server: 2 },
  });
  await expect(page.getByRole('navigation', { name: 'Threads' })).toBeVisible();
});
