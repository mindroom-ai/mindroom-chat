import { expect, test, type Page } from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, getStateEvent, joinRoom, matrixFetch } from '../helpers/matrix';
import { roomMoreOptions } from '../helpers/roomMenu';

// A room admin picks how the room's agents answer on the room settings' MindRoom page: the choice
// lands as the room's `reply_mode` setting at once, Default clears it, and a plain member sees the
// admin's choice without being able to change it.
const PASSWORD = 'room-reply-mode-spec-password';
const SETTING = 'io.mindroom.room_settings';

type Account = { username: string; userId: string; accessToken: string };

const register = async (prefix: string): Promise<Account> => {
  const username = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    getHomeserver(),
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  return { username, userId: body.user_id, accessToken: body.access_token };
};

/** Opens the room's settings on their MindRoom page and returns the reply mode menu button. */
const openReplyMode = async (page: Page, account: Account, roomId: string) => {
  await loginWithPassword(page, {
    homeserver: getHomeserver(),
    username: account.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(roomMoreOptions(page)).toBeVisible({ timeout: 60_000 });
  await roomMoreOptions(page).click();
  await page.getByRole('menuitem', { name: 'Room Settings', exact: true }).click();
  await page.getByRole('button', { name: 'MindRoom', exact: true }).click();
  return page.getByRole('dialog').locator('button[aria-description="Agents answer"]');
};

test('a room admin sets how agents answer, and a member sees it read-only', async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  const homeserver = getHomeserver();
  const admin = await register('replymodeadmin');
  const member = await register('replymodemember');
  const roomId = await createPrivateRoom(homeserver, admin.accessToken, {
    name: `Reply mode ${Date.now().toString(36)}`,
    invite: [member.userId],
  });
  await joinRoom(homeserver, member.accessToken, roomId);
  const setting = () => getStateEvent(homeserver, admin.accessToken, roomId, SETTING, 'reply_mode');

  const menu = await openReplyMode(page, admin, roomId);
  await expect(menu).toHaveText('Default');
  await menu.click();
  await page.getByRole('menuitemradio', { name: 'Only when mentioned', exact: true }).click();
  await expect(menu).toHaveText('Only when mentioned');
  await expect.poll(setting).toEqual({ value: 'mentions' });

  const memberContext = await browser.newContext();
  try {
    const memberPage = await memberContext.newPage();
    const memberMenu = await openReplyMode(memberPage, member, roomId);
    await expect(memberMenu).toHaveText('Only when mentioned');
    await expect(memberMenu).toBeDisabled();
    // Each setting on the page says it is read-only: the reply mode and the thread title rules.
    await expect(
      memberPage.getByText("Only people allowed to change this room's settings can edit this.")
    ).toHaveCount(2);
  } finally {
    await memberContext.close();
  }

  await menu.click();
  await page.getByRole('menuitemradio', { name: 'Default', exact: true }).click();
  await expect(menu).toHaveText('Default');
  await expect.poll(setting).toEqual({});
});
