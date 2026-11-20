import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// With canvases off in this app, a canvas notice says so under its title and offers to ask for a
// text version: a draft in its own thread's (or the room's) composer that only the user sends,
// never over work there.
test.use({ video: 'off' });
test.describe.configure({ timeout: 180_000 });

const TITLE = 'Weekly planning board';
const ROOM_TITLE = 'Release checklist';
const request = (title: string) =>
  `Please send “${title}” here as text instead. Interactive panels are off in my app.`;
const REQUEST = request(TITLE);
const ROOM_REQUEST = request(ROOM_TITLE);
const COMPOSER = '[data-editable-name="RoomInput"]';

const shot = async (page: Page, name: string) => {
  const dir = process.env.CANVAS_OFF_SHOTS;
  if (!dir) return;
  await page.mouse.move(0, 0);
  await expect(page.getByText('Catching up...')).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: `${dir}/${name}.png` });
};

test('a canvas while canvases are off asks for a text version in its thread, never over work', async ({
  page,
  context,
}) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = async (username: string, name: string) => {
    const account = await matrixFetch<{ access_token: string; user_id: string }>(
      HOMESERVER,
      '/register',
      {
        method: 'POST',
        body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
      }
    );
    await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(account.user_id)}/displayname`, {
      method: 'PUT',
      accessToken: account.access_token,
      body: JSON.stringify({ displayname: name }),
    });
    return account;
  };
  const username = `alice_${suffix}`;
  const viewer = await register(username, 'Alice');
  const agent = await register(`mindroom_helper_${suffix}`, 'Helper');
  const fixture = await createThreadFixture(HOMESERVER, viewer.access_token, {
    name: 'Project Alpha',
    topic: 'Planning for the next release',
    rootBody: 'Weekly planning: can you put the tasks on a board?',
    replyBody: 'Thanks!',
    invite: [agent.user_id],
  });
  await joinRoom(HOMESERVER, agent.access_token, fixture.roomId);
  const otherRootId = await sendRoomMessage(HOMESERVER, viewer.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Release notes for version two',
  });
  const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId } };
  await sendRoomMessage(HOMESERVER, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Here is the board for this week: three tasks, two owners.',
    ...inThread,
  });
  // A canvas in the thread, and one in the room itself (no thread).
  const showCanvas = (title: string, threadId: string | null) =>
    sendRoomMessage(HOMESERVER, agent.access_token, fixture.roomId, {
      msgtype: 'm.notice',
      body: `Interactive panel: ${title}.`,
      ...(threadId ? inThread : {}),
      'io.mindroom.ui_action': {
        version: 1,
        action: 'show_canvas',
        requester_id: viewer.user_id,
        agent_user_id: agent.user_id,
        room_id: fixture.roomId,
        thread_id: threadId,
        canvas: { title, html: `<h1>${title}</h1>` },
      },
    });
  const threadCanvasId = await showCanvas(TITLE, fixture.rootId);
  const roomCanvasId = await showCanvas(ROOM_TITLE, null);

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [HOMESERVER],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
        auth: { allowRegistration: false, disablePasswordLogin: false },
        mindroom: { ...config.mindroom, canvas: { enabled: false } },
      },
    });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password });

  // The room opens in its Full view, with drafts of its own and of another thread.
  const draftKey = (threadId?: string) =>
    `roomInputDraft:${JSON.stringify(
      threadId ? [viewer.user_id, fixture.roomId, threadId] : [viewer.user_id, fixture.roomId]
    )}`;
  const paragraph = (text: string) => JSON.stringify([{ type: 'paragraph', children: [{ text }] }]);
  const seeded = {
    [`roomViewMode:${fixture.roomId}`]: JSON.stringify('classic'),
    [draftKey()]: paragraph('Room note'),
    [draftKey(otherRootId)]: paragraph('Other thread note'),
  };
  await page.evaluate((items) => {
    Object.entries(items).forEach(([key, value]) => localStorage.setItem(key, value));
  }, seeded);
  await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
  await expect(page.locator(COMPOSER).filter({ hasText: 'Room note' })).toBeVisible({
    timeout: 60_000,
  });

  // The room's view, as the account keeps it.
  const viewMode = () =>
    page.evaluate((roomId) => {
      const key = Object.keys(localStorage).find(
        (k) => k.startsWith('roomViewMode:') && k.endsWith(`:${roomId}`)
      );
      return key && localStorage.getItem(key);
    }, fixture.roomId);
  await expect.poll(viewMode).toBe(JSON.stringify('classic'));

  const card = (eventId: string) => page.locator(`[data-message-id="${eventId}"]`).first();
  const button = (eventId: string, name: string) =>
    card(eventId).getByRole('button', { name, exact: true });
  const ask = button(threadCanvasId, 'Ask for a text version');
  const copy = button(threadCanvasId, 'Copy request');
  const status = (text: string) =>
    card(threadCanvasId).getByRole('status').filter({ hasText: text });
  const roomComposer = page.locator(COMPOSER).first();
  await expect(ask).toBeVisible({ timeout: 60_000 });
  await expect(card(threadCanvasId).locator('[data-canvas-notice-title]')).toHaveText(TITLE);
  await expect(
    card(threadCanvasId).getByText('Canvas shared · panels are off in this app')
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open canvas', exact: true })).toHaveCount(0);
  // The room's canvas goes to the room's composer, which holds a note: it offers to copy.
  await expect(button(roomCanvasId, 'Copy request')).toBeVisible();
  await shot(page, 'after-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'after-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // A file staged in the room's composer is the room's work, not the thread's.
  const attach = async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Attach files' }).first().click();
    await (
      await chooser
    ).setFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('Placeholder notes'),
    });
  };
  await roomComposer.click();
  await page.keyboard.press('End');
  for (const _ of 'Room note') await page.keyboard.press('Backspace');
  await expect(roomComposer).not.toContainText('Room');
  await attach();
  await expect(page.getByText('notes.txt')).toBeVisible();
  await expect(button(roomCanvasId, 'Copy request')).toBeVisible();
  await expect(ask).toBeVisible();
  await page.getByRole('button', { name: 'Remove All' }).click();

  // With the room's composer empty, the room's canvas puts its request there, in the Full view.
  await button(roomCanvasId, 'Ask for a text version').click();
  await expect(page.locator(COMPOSER).filter({ hasText: ROOM_REQUEST })).toHaveCount(1);
  await expect(page).not.toHaveURL(/threadId=/);
  await expect(button(roomCanvasId, 'Copy request')).toBeVisible();
  expect(await viewMode()).toBe(JSON.stringify('classic'));

  // The thread's canvas opens its thread (the room's threads come back, kept for the room) with
  // the request in that thread's draft; the room's draft and the other thread's stay.
  await ask.click();
  await expect(page).toHaveURL(new RegExp(`threadId=${encodeURIComponent(fixture.rootId)}`));
  await expect(page.locator(COMPOSER).filter({ hasText: REQUEST })).toHaveCount(1);
  await expect(status('Request added to the composer')).toBeVisible();
  await expect(copy).toBeVisible();
  await shot(page, 'after-filled');
  await expect.poll(viewMode).toBe(JSON.stringify('threaded'));
  expect(
    await page.evaluate(
      (keys) => keys.map((key) => localStorage.getItem(key)),
      [draftKey(), draftKey(otherRootId)]
    )
  ).toEqual([paragraph(ROOM_REQUEST), paragraph('Other thread note')]);
  const messages = () =>
    matrixFetch<{ chunk: { content: Record<string, unknown> }[] }>(
      HOMESERVER,
      `/rooms/${encodeURIComponent(fixture.roomId)}/messages?dir=b&limit=50`,
      { accessToken: viewer.access_token }
    ).then(({ chunk }) => chunk.filter((event) => event.content.body === REQUEST));
  expect(await messages()).toHaveLength(0);

  // The user sends it, into the thread; the empty composer can take a request again.
  await page.locator(COMPOSER).filter({ hasText: REQUEST }).click();
  await page.keyboard.press('Enter');
  await expect
    .poll(async () => (await messages()).map((event) => event.content['m.relates_to']))
    .toEqual([expect.objectContaining({ rel_type: 'm.thread', event_id: fixture.rootId })]);
  await expect(ask).toBeVisible();
  await expect(status('Puts a request in the composer')).toBeVisible();

  // A file staged in the thread's composer is the thread's work: it stays, and the request is
  // offered to copy.
  const chooser = page.waitForEvent('filechooser');
  await page
    .locator('[data-testid="thread-column"]')
    .getByRole('button', { name: 'Attach files' })
    .click();
  await (
    await chooser
  ).setFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Placeholder notes'),
  });
  await expect(copy).toBeVisible();
  await expect(status('Your draft was kept')).toBeVisible();
  await copy.click();
  await expect(status('Request copied')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(REQUEST);
  await expect(page.locator(COMPOSER).filter({ hasText: REQUEST })).toHaveCount(0);
  await shot(page, 'after-kept');

  // Back leads to the room, in the threaded view Ask chose, with its own draft.
  await page.goBack();
  await expect(page).not.toHaveURL(/threadId=/);
  await expect(page.locator(COMPOSER).filter({ hasText: ROOM_REQUEST })).toBeVisible();
});
