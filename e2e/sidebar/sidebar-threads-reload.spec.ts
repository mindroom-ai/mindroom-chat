import { expect, test, type Page } from '@playwright/test';
import { activeAccountButtonNamePattern } from '../helpers/auth';
import { buildLoginPath } from '../env';
import { createPrivateRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { openThreadsCategory } from '../helpers/threadsCategory';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The sidebar's Threads section lists a room's threads after sign-in and after a reload without
// the room being opened, even when newer room messages pushed every thread event out of the sync
// window. The client then knows those threads only from the room's thread list, which it fetches
// for every joined room once the first sync has caught up.

const PASSWORD = 'sidebar-threads-password';
/** More room messages than one /sync brings per room (STARTUP_SYNC_TIMELINE_LIMIT is 20). */
const NEWER_ROOM_MESSAGES = 25;

const register = async (username: string): Promise<string> => {
  const body = await matrixFetch<{ access_token: string }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  return body.access_token;
};

const inThread = (rootId: string, body: string) => ({
  msgtype: 'm.text',
  body,
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

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

test('the sidebar lists quiet threads after sign-in and a reload without opening their room', async ({
  page,
}) => {
  test.setTimeout(360_000);
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );

  const username = `sidebar_threads_${Date.now().toString(36)}`;
  const token = await register(username);
  const roomId = await createPrivateRoom(HOMESERVER, token, {
    name: 'Quiet Threads',
    topic: 'Threads older than the sync window',
  });
  const send = (content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, token, roomId, content, 'sidebar-threads');
  const titles = ['Vendor contract renewal', 'Office move checklist'];
  for (const title of titles) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await send({ msgtype: 'm.text', body: title });
    // eslint-disable-next-line no-await-in-loop
    await send(inThread(rootId, `First reply to ${title}`));
  }
  for (let index = 0; index < NEWER_ROOM_MESSAGES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await send({ msgtype: 'm.notice', body: `Room activity ${index}` });
  }

  const threadsSection = page.getByTestId('thread-nav-category');
  const expectListed = async () => {
    for (const title of titles) {
      // eslint-disable-next-line no-await-in-loop
      await expect(threadsSection.getByText(title, { exact: true })).toBeVisible({
        timeout: 90_000,
      });
    }
  };

  await signIn(page, username);
  await page.goto('/home/');
  await openThreadsCategory(page);
  await expectListed();

  await page.reload();
  await expect(page.getByRole('button', { name: activeAccountButtonNamePattern })).toBeVisible({
    timeout: 120_000,
  });
  await expectListed();
  // The room itself was never opened.
  expect(new URL(page.url()).pathname).toBe('/home/');
});
