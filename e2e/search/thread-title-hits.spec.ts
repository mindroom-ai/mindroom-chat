import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';
import { joinRoom, matrixFetch } from '../helpers/matrix';
import { pressPaletteShortcut } from '../helpers/paletteShortcut';

// MindRoom posts each new thread title as a notice of its own. A thread titled three times with
// one word in every title, plus messages with the word in the thread and in the room: search lists
// the thread's titles once, as its current title, opening the thread, and keeps every message.
const SHOTS = process.env.PALETTE_THREAD_TITLE_SHOTS;
const PASSWORD = 'placeholder-password-1';
const run = randomUUID().slice(0, 6);
type Account = { username: string; userId: string; accessToken: string };

const register = async (username: string, name: string): Promise<Account> => {
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname: name }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token };
};

const send = async (account: Account, room: string, content: Record<string, unknown>) =>
  (
    await matrixFetch<{ event_id: string }>(
      HOMESERVER,
      `/rooms/${encodeURIComponent(room)}/send/m.room.message/${randomUUID()}`,
      { method: 'PUT', accessToken: account.accessToken, body: JSON.stringify(content) }
    )
  ).event_id;

const inThread = (rootId: string, replyTo: string) => ({
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: replyTo },
  },
});

const sendTitle = async (title: string, count: number) =>
  send(helper, roomId, {
    msgtype: 'm.notice',
    body: title,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: title,
      message_count: count,
      generated_at: new Date().toISOString(),
      model: 'test',
    },
    ...inThread(root, last),
  });

let alice: Account;
let helper: Account;
let roomId: string;
let root: string;
let last: string;

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async () => {
  test.skip(!(await disposableHomeserverIsUp()), 'no homeserver');
  alice = await register(`alice_${run}`, 'Alice');
  const bob = await register(`bob_${run}`, 'Bob');
  helper = await register(`mindroom_helper_${run}`, 'Helper');
  roomId = (
    await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: alice.accessToken,
      body: JSON.stringify({ preset: 'public_chat', name: 'Project Alpha' }),
    })
  ).room_id;
  await joinRoom(HOMESERVER, bob.accessToken, roomId);
  await joinRoom(HOMESERVER, helper.accessToken, roomId);
  const text = (body: string) => ({ msgtype: 'm.text', body });
  await send(bob, roomId, text('Weekly planning: I moved the roadmap doc to the shared drive.'));
  root = await send(alice, roomId, text('@Helper can you sketch the launch plan for the beta?'));
  last = await send(helper, roomId, {
    ...text('Here is a first pass at the roadmap: discovery in May, beta in June, launch in July.'),
    ...inThread(root, root),
  });
  const titles = [
    'Roadmap sketch for the beta',
    'Beta roadmap with June dates',
    'Launch roadmap: beta in June, launch in July',
  ];
  for (const [index, title] of titles.entries()) {
    last = await sendTitle(title, index + 2);
    if (index < 2) {
      last = await send(alice, roomId, {
        ...text(
          index === 0 ? 'Can we move the beta to June?' : 'Looks good, add the launch date too.'
        ),
        ...inThread(root, last),
      });
    }
  }
});

const palette = (page: Page) => page.getByRole('dialog', { name: 'Command palette', exact: true });
const searchPath = `/home/search/?${new URLSearchParams({ term: 'roadmap', global: 'true' })}`;

const login = async (page: Page) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: alice.username,
    password: PASSWORD,
  });
};

test('the search page lists the titles once, as the current one, and it opens the thread', async ({
  page,
}) => {
  await login(page);
  await page.goto(searchPath);
  const hits = page.locator('article');
  await expect(page.getByText('3 results for “roadmap”')).toBeVisible({ timeout: 30_000 });
  await expect(hits).toHaveCount(3);
  await expect(hits.nth(0)).toContainText('Launch roadmap: beta in June, launch in July');
  await expect(hits.nth(1)).toContainText('Here is a first pass at the roadmap');
  await expect(hits.nth(2)).toContainText('I moved the roadmap doc');

  await hits.nth(0).getByRole('button', { name: 'Open' }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('threadId') === root);
  expect(decodeURIComponent(page.url())).not.toContain(last);
});

test('the palette lists the thread once per tab', async ({ page }) => {
  await login(page);
  await pressPaletteShortcut(page);
  await palette(page).getByRole('combobox').fill('roadmap');
  const rows = palette(page).locator('[role="option"][data-kind="message"]');
  const threads = palette(page).locator('[role="option"][data-kind="thread"]');
  // All: the thread's own row, and no title of it among the messages.
  await expect(rows).toHaveCount(2, { timeout: 30_000 });
  await expect(threads).toHaveCount(1);
  await expect(rows.filter({ hasText: 'Beta roadmap' })).toHaveCount(0);

  await palette(page)
    .getByRole('tablist')
    .getByRole('tab', { name: 'Messages', exact: true })
    .click();
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText('Launch roadmap: beta in June, launch in July');
});

test('a title the word has left still lists the thread once, by the title it has now', async ({
  page,
}) => {
  last = await sendTitle('Beta and launch dates', 7);
  await login(page);
  await page.goto(searchPath);
  const hits = page.locator('article');
  await expect(hits).toHaveCount(3, { timeout: 30_000 });
  await expect(hits.nth(0)).toContainText('Beta and launch dates');
  await expect(page.getByText('Roadmap sketch for the beta')).toHaveCount(0);
});

const searchAnswer = (results: unknown[], nextBatch?: string) => ({
  json: {
    search_categories: {
      room_events: { results, count: 4, highlights: ['roadmap'], next_batch: nextBatch },
    },
  },
});
const isSearch = (url: URL) => url.pathname === '/_matrix/client/v3/search';

test('a failed next page waits for Retry, also below a page of titles shown already', async ({
  page,
}) => {
  const hit = (eventId: string, content: Record<string, unknown>) => ({
    rank: 1,
    result: {
      event_id: eventId,
      room_id: roomId,
      sender: helper.userId,
      origin_server_ts: Date.now(),
      type: 'm.room.message',
      content,
    },
  });
  const titleHit = (eventId: string) =>
    hit(eventId, {
      msgtype: 'm.notice',
      body: 'Roadmap sketch for the beta',
      'io.mindroom.thread_summary': { version: 1, summary: 'Roadmap sketch for the beta' },
      ...inThread(root, root),
    });
  // A title, then a page of only more titles of that thread, which shows nothing new, then a
  // page that fails until the server is back.
  const pages: Record<string, { results: unknown[]; next_batch?: string }> = {
    first: { results: [titleHit('$title-1')], next_batch: 'second' },
    second: { results: [titleHit('$title-2'), titleHit('$title-3')], next_batch: 'third' },
    third: { results: [hit('$said', { msgtype: 'm.text', body: 'The roadmap is ready' })] },
  };
  let failing = true;
  let thirdAsked = 0;
  await page.route(isSearch, async (route) => {
    const batch = new URL(route.request().url()).searchParams.get('next_batch') ?? 'first';
    if (batch === 'third') thirdAsked += 1;
    if (batch === 'third' && failing) {
      await route.fulfill({ status: 500, json: { errcode: 'M_UNKNOWN', error: 'down' } });
      return;
    }
    const { results, next_batch } = pages[batch]!;
    await route.fulfill(searchAnswer(results, next_batch));
  });
  await login(page);
  await page.goto(searchPath);
  await expect(page.getByRole('alert')).toHaveText('Search failed. Try again.', {
    timeout: 30_000,
  });
  // The query's own retries are done; nothing asks again on its own.
  const asked = thirdAsked;
  await page.waitForTimeout(3000);
  expect(thirdAsked).toBe(asked);
  await expect(page.locator('article')).toHaveCount(1);
  const retry = page.getByRole('button', { name: 'Retry', exact: true });

  failing = false;
  await retry.click();
  await expect(page.locator('article')).toHaveCount(2);
  await expect(page.getByText('The roadmap is ready')).toBeVisible();
  await expect(retry).toHaveCount(0);
  expect(thirdAsked).toBe(asked + 1);
});

test('a failed refresh of the results shown keeps the error at the top, without Retry', async ({
  page,
}) => {
  let asked = 0;
  await page.route(isSearch, async (route) => {
    asked += 1;
    if (asked > 1) {
      await route.fulfill({ status: 500, json: { errcode: 'M_UNKNOWN', error: 'down' } });
      return;
    }
    const said = {
      rank: 1,
      result: {
        event_id: '$said',
        room_id: roomId,
        sender: alice.userId,
        origin_server_ts: Date.now(),
        type: 'm.room.message',
        content: { msgtype: 'm.text', body: 'The roadmap is ready' },
      },
    };
    await route.fulfill(searchAnswer([said]));
  });
  await login(page);
  await page.goto(searchPath);
  await expect(page.locator('article')).toHaveCount(1, { timeout: 30_000 });
  // Coming back to the tab refreshes the search, which now fails (after the query's retries).
  await page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByRole('alert')).toHaveText('Search failed. Try again.', {
    timeout: 30_000,
  });
  await expect(page.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(page.locator('article')).toHaveCount(1);
});

test('after a failed next page and a refresh that works, a failed refresh shows at the top', async ({
  page,
}) => {
  const said = (eventId: string, body: string) => ({
    rank: 1,
    result: {
      event_id: eventId,
      room_id: roomId,
      sender: alice.userId,
      origin_server_ts: Date.now(),
      type: 'm.room.message',
      content: { msgtype: 'm.text', body },
    },
  });
  let server: 'next-page-down' | 'up' | 'down' = 'next-page-down';
  await page.route(isSearch, async (route) => {
    const batch = new URL(route.request().url()).searchParams.get('next_batch');
    if (server === 'down' || (batch && server === 'next-page-down')) {
      await route.fulfill({ status: 500, json: { errcode: 'M_UNKNOWN', error: 'down' } });
      return;
    }
    // Back up, the server has no second page any more: nothing loads after the refresh.
    const nextBatch = server === 'next-page-down' ? 'second' : undefined;
    await route.fulfill(searchAnswer([said('$said', 'The roadmap is ready')], nextBatch));
  });
  const refresh = () => page.evaluate(() => window.dispatchEvent(new Event('visibilitychange')));
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  const alert = page.getByRole('alert');
  await login(page);
  await page.goto(searchPath);
  await expect(retry).toBeVisible({ timeout: 30_000 });

  server = 'up';
  await refresh();
  await expect(alert).toHaveCount(0, { timeout: 30_000 });
  await expect(retry).toHaveCount(0);

  // A refresh that fails now is the search's error, shown at the top, not that page's.
  server = 'down';
  await refresh();
  await expect(alert).toHaveText('Search failed. Try again.', { timeout: 30_000 });
  await expect(retry).toHaveCount(0);
  await expect(page.locator('article')).toHaveCount(1);
});

test('the palette shows the thread title on edited thread replies and thread roots', async ({
  browser,
  baseURL,
}) => {
  const threadTitle = 'Greenhouse watering plan';
  await send(alice, roomId, {
    msgtype: 'm.text',
    body: 'Standalone note: marigold seeds arrived at the studio.',
  });
  const marigoldRoot = await send(alice, roomId, {
    msgtype: 'm.text',
    body: '@Helper can you draft the marigold greenhouse schedule?',
  });
  const streamingReplyId = await send(helper, roomId, {
    msgtype: 'm.text',
    body: 'Thinking...',
    ...inThread(marigoldRoot, marigoldRoot),
  });
  const editedBody = 'The marigold watering schedule runs every Tuesday and Friday morning.';
  await send(helper, roomId, {
    msgtype: 'm.text',
    body: `* ${editedBody}`,
    'm.new_content': { msgtype: 'm.text', body: editedBody },
    'm.relates_to': { rel_type: 'm.replace', event_id: streamingReplyId },
  });
  await send(helper, roomId, {
    msgtype: 'm.notice',
    body: threadTitle,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: threadTitle,
      message_count: 2,
      generated_at: new Date().toISOString(),
      model: 'test',
    },
    ...inThread(marigoldRoot, streamingReplyId),
  });

  const context = await browser.newContext({
    baseURL,
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();
  try {
    await login(page);
    await pressPaletteShortcut(page);
    await palette(page).getByRole('combobox').fill('marigold');
    const rows = palette(page).locator('[role="option"][data-kind="message"]');
    await expect(rows).toHaveCount(3, { timeout: 30_000 });

    const editedReplyRow = rows.filter({ hasText: 'watering schedule runs every Tuesday' });
    const rootRow = rows.filter({ hasText: 'draft the marigold greenhouse schedule' });
    const standaloneRow = rows.filter({ hasText: 'marigold seeds arrived' });

    try {
      await expect(editedReplyRow).toContainText(`› ${threadTitle}`, { timeout: 10_000 });
      await expect(rootRow).toContainText(`› ${threadTitle}`, { timeout: 10_000 });
    } finally {
      if (SHOTS) {
        mkdirSync(SHOTS, { recursive: true });
        await palette(page).screenshot({ path: join(SHOTS, 'palette-thread-titles.png') });
      }
    }

    await expect(editedReplyRow).toContainText('Project Alpha');
    await expect(rootRow).toContainText('Project Alpha');
    await expect(standaloneRow).toContainText('Project Alpha');
    await expect(standaloneRow).not.toContainText('›');

    await editedReplyRow.click();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get('threadId') === marigoldRoot &&
        decodeURIComponent(url.pathname).includes(streamingReplyId)
    );

    await pressPaletteShortcut(page);
    await palette(page).getByRole('combobox').fill('marigold');
    await expect(rootRow).toContainText(`› ${threadTitle}`, { timeout: 15_000 });
    await rootRow.click();
    await expect(page).toHaveURL(
      (url) =>
        url.searchParams.get('threadId') === marigoldRoot &&
        decodeURIComponent(url.pathname).includes(marigoldRoot)
    );
  } finally {
    await context.close();
  }
});
