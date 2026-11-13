import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// In the Threads view, a room message shows the chip that opens its thread only once the thread
// has a reply: a root with replies has one, a plain message has none and offers Reply in Thread on
// its toolbar instead, and its chip appears as soon as a first reply arrives, without a reload.
// Set THREAD_CHIP_SHOTS=<directory> to also save the room in light and dark themes.

const PASSWORD = 'thread-chip-replies-password';
const SHOTS = process.env.THREAD_CHIP_SHOTS;

const ROOT = 'Where do we keep the release notes?';
const REPLIES = ['In the docs folder, next to the changelog.', 'And the draft is in the wiki.'];
const PLAIN = 'The build is green again.';
const FIRST_REPLY = 'Thanks, deploying now.';

type Account = { username: string; userId: string; accessToken: string };

const register = async (prefix: string, displayname: string): Promise<Account> => {
  const username = `${prefix}_${Date.now().toString(36)}`;
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
    body: JSON.stringify({ displayname }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token };
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

const chipOf = (row: Locator) => row.locator('button[data-thread-root-id]');

/** Uses a theme from the settings and reloads, so the room shows in it. */
const applyTheme = async (page: Page, themeId: string) => {
  await page.evaluate((id) => {
    const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
    localStorage.setItem(
      'settings',
      JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
    );
  }, themeId);
  await page.reload();
};

test('only messages with thread replies show a thread chip, and a first reply adds one', async ({
  page,
}) => {
  // Sign-in, a room load and two theme reloads on a loaded machine.
  test.setTimeout(360_000);
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );

  const viewer = await register('chip_viewer', 'Olive Viewer');
  const peer = await register('chip_peer', 'Pat Peer');
  const roomId = await createPrivateRoom(HOMESERVER, viewer.accessToken, {
    name: 'Release Room',
    topic: 'Thread chips',
    invite: [peer.userId],
  });
  await joinRoom(HOMESERVER, peer.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, viewer.accessToken, roomId, {
    msgtype: 'm.text',
    body: ROOT,
  });
  for (const body of REPLIES) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, peer.accessToken, roomId, replyTo(rootId, body));
  }
  const plainId = await sendRoomMessage(HOMESERVER, viewer.accessToken, roomId, {
    msgtype: 'm.text',
    body: PLAIN,
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: viewer.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: viewer.userId,
    viewMode: 'threaded',
    filterState: createDefaultThreadFilterState(),
  });
  const roomPath = `/home/${encodeURIComponent(roomId)}/`;
  await page.goto(roomPath);

  const rows = page.locator('[data-message-item]');
  const rootRow = rows.filter({ hasText: ROOT });
  const plainRow = rows.filter({ hasText: PLAIN });
  /** The root has its chip with both replies, and the plain message has none. */
  const expectChips = async () => {
    await expect(chipOf(rootRow)).toHaveCount(1, { timeout: 60_000 });
    await expect(chipOf(rootRow)).toContainText('2 replies');
    await expect(chipOf(rootRow)).toHaveAttribute('data-thread-root-id', rootId);
    await expect(plainRow).toHaveCount(1);
    // The thread index has settled: the replies of the root stay inside its thread.
    await expect(rows.filter({ hasText: REPLIES[0]! })).toHaveCount(0);
    await expect(chipOf(plainRow)).toHaveCount(0);
  };
  await expectChips();
  // A whole thread index refresh later, the plain message still has none.
  await page.waitForTimeout(2_000);
  await expect(chipOf(plainRow)).toHaveCount(0);
  await expect(page.locator('button[data-thread-root-id]')).toHaveCount(1);

  if (SHOTS) {
    for (const [themeId, label] of [
      ['light-theme', 'light'],
      ['dark-theme', 'dark'],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      await applyTheme(page, themeId);
      // eslint-disable-next-line no-await-in-loop
      await expectChips();
      // eslint-disable-next-line no-await-in-loop
      await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.move(0, 0);
      // eslint-disable-next-line no-await-in-loop
      await page.screenshot({ path: `${SHOTS}/V7-thread-chip-only-threads-${label}.png` });
    }
  }

  // Without a chip, the toolbar of the plain message starts its thread.
  await plainRow.hover();
  const replyInThread = plainRow.getByRole('button', { name: 'Reply in Thread', exact: true });
  await expect(replyInThread).toBeVisible();
  await replyInThread.click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('threadId'), { timeout: 30_000 })
    .toBe(plainId);
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
  await page.goBack();
  await expect
    .poll(() => new URL(page.url()).searchParams.get('threadId'), { timeout: 30_000 })
    .toBeNull();
  await expect(plainRow).toHaveCount(1, { timeout: 30_000 });
  await expect(chipOf(plainRow)).toHaveCount(0);

  // A first reply arrives while the room shows, and the plain message gets its chip.
  await sendRoomMessage(HOMESERVER, peer.accessToken, roomId, replyTo(plainId, FIRST_REPLY));
  await expect(chipOf(plainRow)).toHaveCount(1, { timeout: 30_000 });
  await expect(chipOf(plainRow)).toContainText('1 reply');
  await expect(chipOf(plainRow)).toHaveAttribute('data-thread-root-id', plainId);
  await expect(rows.filter({ hasText: FIRST_REPLY })).toHaveCount(0);
  await expect(chipOf(rootRow)).toContainText('2 replies');
});
