import { randomUUID } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { buildLoginPath, getHomeserver } from '../env';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { switchToStoredUsername } from '../helpers/accounts';
import { createPrivateRoom, joinRoom, matrixFetch, type MatrixSession } from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

// An account that stops being the active one stops typing (live-test L9-F011). The first account
// types a draft in a room and leaves it unsent; when a second account is added, the device
// switches to it, or the page is left (a reload, a link, a closed tab: the live test opened the
// login page by its address), the others in the room must stop seeing the first one typing at
// once, not when the server's typing timeout (30 s) ends it. A third account reads the room's
// typing users the way every member does, from its own /sync.

const PASSWORD = 'typing-switch-password';
const DRAFT = 'a draft left behind';
// Well under the 30 s the typing notice would otherwise last.
const STOP_WITHIN_MS = 5_000;

test.use({ video: 'off', viewport: { width: 1280, height: 800 } });

const register = async (homeserver: string, username: string): Promise<MatrixSession> => {
  const body = await matrixFetch<{ access_token: string; user_id: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  return { accessToken: body.access_token, userId: body.user_id };
};

/** The room's typing users as a member's /sync reports them, kept current in the background. */
const watchTyping = (homeserver: string, observer: MatrixSession, roomId: string) => {
  let typing: string[] = [];
  let since: string | undefined;
  let running = true;
  const filter = JSON.stringify({
    presence: { types: [] },
    account_data: { types: [] },
    room: {
      rooms: [roomId],
      timeline: { limit: 0 },
      state: { types: [] },
      account_data: { types: [] },
      ephemeral: { types: ['m.typing'] },
    },
  });
  const loop = async () => {
    while (running) {
      const query = new URLSearchParams({ filter, timeout: since ? '1000' : '0' });
      if (since) query.set('since', since);
      const body = await matrixFetch<{
        next_batch: string;
        rooms?: {
          join?: Record<
            string,
            { ephemeral?: { events?: { type: string; content: { user_ids?: string[] } }[] } }
          >;
        };
      }>(homeserver, `/sync?${query.toString()}`, { accessToken: observer.accessToken });
      since = body.next_batch;
      body.rooms?.join?.[roomId]?.ephemeral?.events?.forEach((event) => {
        if (event.type === 'm.typing') typing = event.content.user_ids ?? [];
      });
    }
  };
  const done = loop();
  return {
    isTyping: (userId: string) => typing.includes(userId),
    stop: async () => {
      running = false;
      await done;
    },
  };
};

const composer = (page: Page) => page.locator('[data-editable-name="RoomInput"]');

/** Opens the room and types the draft without sending it. */
const typeDraft = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await expect(composer(page)).toBeVisible({ timeout: 60_000 });
  await composer(page).click();
  await page.keyboard.type(DRAFT, { delay: 30 });
};

test('an account that stops being active, or leaves the page, stops typing in its rooms', async ({
  page,
}) => {
  test.setTimeout(240_000);
  const homeserver = getHomeserver();
  const run = randomUUID().replaceAll('-', '').slice(0, 10);
  const firstName = `typing_first_${run}`;
  const secondName = `typing_second_${run}`;
  const first = await register(homeserver, firstName);
  const second = await register(homeserver, secondName);
  const observer = await register(homeserver, `typing_observer_${run}`);
  const roomId = await createPrivateRoom(homeserver, observer.accessToken, {
    name: 'Lobby',
    topic: 'Typing notices',
    invite: [first.userId, second.userId],
  });
  await joinRoom(homeserver, first.accessToken, roomId);
  await joinRoom(homeserver, second.accessToken, roomId);
  const watcher = watchTyping(homeserver, observer, roomId);
  try {
    await loginWithPassword(page, { homeserver, username: firstName, password: PASSWORD });

    // Adding an account while a draft is typed: the first account stops typing.
    await typeDraft(page, roomId);
    await expect.poll(() => watcher.isTyping(first.userId), { timeout: 15_000 }).toBe(true);
    await chooseFromAccountMenu(page, 'Add Account');
    await expect(page).toHaveURL(/addAccount=1/);
    await expect
      .poll(() => watcher.isTyping(first.userId), {
        timeout: STOP_WITHIN_MS,
        message: 'the first account still types after Add Account',
      })
      .toBe(false);
    await page.locator('input[name="usernameInput"]').fill(secondName);
    await page.locator('input[name="passwordInput"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByRole('button', { name: /account menu for/ })).toBeVisible({
      timeout: 60_000,
    });
    expect(watcher.isTyping(first.userId), 'first account typing after the second signs in').toBe(
      false
    );

    // Switching to another account while a draft is typed: the same.
    await switchToStoredUsername(page, firstName);
    await typeDraft(page, roomId);
    await expect.poll(() => watcher.isTyping(first.userId), { timeout: 15_000 }).toBe(true);
    await switchToStoredUsername(page, secondName);
    await expect
      .poll(() => watcher.isTyping(first.userId), {
        timeout: STOP_WITHIN_MS,
        message: 'the first account still types after the switch',
      })
      .toBe(false);
    // The second account, now active, never typed.
    expect(watcher.isTyping(second.userId)).toBe(false);

    // Leaving the page while a draft is typed: no code of the page runs afterwards.
    await switchToStoredUsername(page, firstName);
    await typeDraft(page, roomId);
    await expect.poll(() => watcher.isTyping(first.userId), { timeout: 15_000 }).toBe(true);
    await page.goto(buildLoginPath(homeserver, true));
    await expect
      .poll(() => watcher.isTyping(first.userId), {
        timeout: STOP_WITHIN_MS,
        message: 'the first account still types after its page was left',
      })
      .toBe(false);
  } finally {
    await watcher.stop();
  }
});

test('a page left mid-draft stops typing in WebKit too', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
  test.setTimeout(180_000);
  const homeserver = getHomeserver();
  const run = randomUUID().replaceAll('-', '').slice(0, 10);
  const writerName = `typing_webkit_${run}`;
  const writer = await register(homeserver, writerName);
  const observer = await register(homeserver, `typing_webkit_observer_${run}`);
  const roomId = await createPrivateRoom(homeserver, observer.accessToken, {
    name: 'Lobby',
    topic: 'Typing notices in WebKit',
    invite: [writer.userId],
  });
  await joinRoom(homeserver, writer.accessToken, roomId);
  const watcher = watchTyping(homeserver, observer, roomId);
  const browser = await launchWebKit();
  try {
    const page = await (
      await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } })
    ).newPage();
    await loginWithPassword(page, { homeserver, username: writerName, password: PASSWORD });
    await typeDraft(page, roomId);
    await expect.poll(() => watcher.isTyping(writer.userId), { timeout: 15_000 }).toBe(true);
    await page.goto(buildLoginPath(homeserver, true));
    await expect
      .poll(() => watcher.isTyping(writer.userId), {
        timeout: STOP_WITHIN_MS,
        message: 'WebKit: the account still types after its page was left',
      })
      .toBe(false);
  } finally {
    await browser.close();
    await watcher.stop();
  }
});
