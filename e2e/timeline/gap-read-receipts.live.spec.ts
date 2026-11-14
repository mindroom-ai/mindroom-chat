import { expect, test, type Page, type Request } from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, matrixFetch, seedRoomOverviewState, sendRoomMessage } from '../helpers/matrix';

// A reader follows a room at its live end while the connection drops; meanwhile someone else
// writes more messages than a sync carries, so the client gets them as a limited (gappy) sync when
// the connection returns. The reader then reads the room with one receipt, on its newest message,
// not one per message of that sync; after a reload, a room already read sends none. Threads view,
// Chromium and WebKit. Set GAP_RECEIPTS_SHOTS=<directory> to save the room after the gap.
const PASSWORD = 'gap-read-receipts-password';
const SHOTS = process.env.GAP_RECEIPTS_SHOTS;
const GAP_MESSAGES = 40;

type Account = { username: string; userId: string; accessToken: string };

const register = async (prefix: string, displayname: string): Promise<Account> => {
  const homeserver = getHomeserver();
  const username = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(homeserver, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token };
};

type Receipt = { eventId: string; threadId: string | undefined };

/** Collects the read receipts the page posts from now on. */
const recordReceipts = (page: Page): Receipt[] => {
  const receipts: Receipt[] = [];
  page.on('request', (request: Request) => {
    if (request.method() !== 'POST') return;
    const eventId = /\/receipt\/m\.read(?:\.private)?\/([^/?]+)/.exec(request.url())?.[1];
    if (!eventId) return;
    const body = (request.postDataJSON() ?? {}) as { thread_id?: string };
    receipts.push({ eventId: decodeURIComponent(eventId), threadId: body.thread_id });
  });
  return receipts;
};

/** Resolves once a /sync response marks the room's timeline as limited (a gap). */
const waitForLimitedSync = (page: Page, roomId: string) =>
  page.waitForResponse(
    async (response) => {
      if (!response.url().includes('/sync?') || response.status() !== 200) return false;
      const data = (await response.json().catch(() => undefined)) as
        | { rooms?: { join?: Record<string, { timeline?: { limited?: boolean } }> } }
        | undefined;
      return data?.rooms?.join?.[roomId]?.timeline?.limited === true;
    },
    { timeout: 120_000 }
  );

// Without the service worker, the page sees every request it makes, WebKit's too.
test.use({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });

test('a gappy sync is read with one receipt on its newest message @webkit', async ({
  page,
  context,
  browserName,
}) => {
  test.setTimeout(240_000);
  const homeserver = getHomeserver();
  const reader = await register('gap_receipt_reader', 'Dock Reader');
  const writer = await register('gap_receipt_writer', 'Dock Writer');
  const run = Date.now().toString(36);
  const roomId = await createRoom(homeserver, reader.accessToken, {
    name: `Gap receipts ${run}`,
    invite: [writer.userId],
  });
  await joinRoom(homeserver, writer.accessToken, roomId);
  for (let index = 0; index < 5; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(homeserver, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Morning note ${index}: the ferry leaves on time and berth two is free.`,
    });
  }

  await loginWithPassword(page, {
    homeserver,
    username: reader.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({ page, roomId, userId: reader.userId, viewMode: 'threaded' });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.getByText('Morning note 4', { exact: false })).toBeVisible({
    timeout: 30_000,
  });
  // The first read of the room settles before the gap.
  await page.waitForTimeout(3_000);

  await context.setOffline(true);
  let newest = '';
  for (let index = 0; index < GAP_MESSAGES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    newest = await sendRoomMessage(homeserver, writer.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Gap note ${index}: the crane on berth ${index % 4} waits for the next tide.`,
    });
  }
  const limited = waitForLimitedSync(page, roomId);
  const afterGap = recordReceipts(page);
  await context.setOffline(false);
  await limited;
  await expect(page.locator(`[data-message-id="${newest}"]`)).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => afterGap.length, { timeout: 15_000 }).toBeGreaterThan(0);
  // Late receipts of the same sync would come within this time.
  await page.waitForTimeout(3_000);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/gap-read-${browserName}.png` });
  expect(afterGap).toEqual([{ eventId: newest, threadId: 'main' }]);

  // A reload finds the room read: no receipt goes out again.
  const afterReload = recordReceipts(page);
  await page.reload();
  await expect(page.locator(`[data-message-id="${newest}"]`)).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(5_000);
  expect(afterReload).toEqual([]);
});
