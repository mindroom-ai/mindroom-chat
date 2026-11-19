import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// With canvases off in this app, a canvas notice says so beside its title and offers to ask for a
// text version: a draft in the thread's composer that only the user sends, never over their own.
test.use({ video: 'off' });

const TITLE = 'Weekly planning board';
const REQUEST = `Please send “${TITLE}” here as text instead. Interactive panels are off in my app.`;
const COMPOSER = '[data-editable-name="RoomInput"]';

const shot = async (page: Page, name: string) => {
  const dir = process.env.CANVAS_OFF_SHOTS;
  if (!dir) return;
  await page.mouse.move(0, 0);
  await expect(page.getByText('Catching up...')).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: `${dir}/${name}.png` });
};

test('a canvas while canvases are off asks for a text version in the draft, never over one', async ({
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
  const inThread = { 'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId } };
  await sendRoomMessage(HOMESERVER, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Here is the board for this week: three tasks, two owners.',
    ...inThread,
  });
  await sendRoomMessage(HOMESERVER, agent.access_token, fixture.roomId, {
    msgtype: 'm.notice',
    body: `Interactive panel: ${TITLE}.`,
    ...inThread,
    'io.mindroom.ui_action': {
      version: 1,
      action: 'show_canvas',
      requester_id: viewer.user_id,
      agent_user_id: agent.user_id,
      room_id: fixture.roomId,
      thread_id: fixture.rootId,
      canvas: { title: TITLE, html: `<h1>${TITLE}</h1>` },
    },
  });

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
  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );

  const ask = page.getByRole('button', { name: 'Ask for a text version', exact: true });
  await expect(ask).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('[data-canvas-notice-title]')).toContainText(
    `${TITLE}· Canvas shared · panels are off in this app`
  );
  await expect(page.getByRole('button', { name: 'Open canvas', exact: true })).toHaveCount(0);
  await shot(page, 'after-light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await shot(page, 'after-dark');
  await page.emulateMedia({ colorScheme: 'light' });

  // The request goes into the thread's composer; nothing reaches the room until Send.
  await ask.click();
  const composer = page.locator(COMPOSER).filter({ hasText: REQUEST });
  await expect(composer).toHaveCount(1);
  await expect(
    page.getByRole('status').filter({ hasText: 'Request added to the composer' })
  ).toBeVisible();
  await shot(page, 'after-filled');
  const messages = await matrixFetch<{ chunk: { content: { body?: string } }[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(fixture.roomId)}/messages?dir=b&limit=50`,
    { accessToken: viewer.access_token }
  );
  expect(messages.chunk.some((event) => event.content.body === REQUEST)).toBe(false);

  // A draft the user has written stays; the request is offered to copy instead.
  await composer.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type('My own note');
  await ask.click();
  await expect(page.getByRole('status').filter({ hasText: 'Your draft was kept' })).toBeVisible();
  await expect(page.locator(COMPOSER).filter({ hasText: 'My own note' })).toHaveCount(1);
  await expect(page.locator(COMPOSER).filter({ hasText: REQUEST })).toHaveCount(0);
  await page.getByRole('button', { name: 'Copy request', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Request copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(REQUEST);
  await shot(page, 'after-kept');
});
