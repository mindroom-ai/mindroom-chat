import { expect, test, type Page } from '@playwright/test';
import { deactivateActiveAccount } from '../helpers/accounts';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { matrixFetch } from '../helpers/matrix';

// The avatars kept for offline starts (Cache Storage `mindroom-avatars-v1`) go with the account
// on every way out, also those that skip Logout: the homeserver ending the device, and
// deactivating the account. Runs against the disposable homeserver.
const AVATAR_CACHE = 'mindroom-avatars-v1';
const PASSWORD = 'sign-out-avatars-password';
const RUN = Date.now().toString(36);
// A 48 px solid square.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAQklEQVR4nO3OQQ0AIAwAsQlDBLKRhQuOR5MK6Jy9vjL5QEhISKgeCAkJCdUDISEhoXogJCQkVA+EhISE6oGQkNBjF21V9KbVaAsfAAAAAElFTkSuQmCC',
  'base64'
);

test.use({ viewport: { width: 1280, height: 800 } });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** A disposable account with a picture, signed in here until the account avatar is kept. */
const signInWithKeptAvatar = async (page: Page, name: string): Promise<DisposableUser> => {
  const user = await registerDisposableUser(`soa_${name}_${RUN}`, PASSWORD);
  const uploaded = await fetch(`${HOMESERVER}/_matrix/media/v3/upload?filename=avatar.png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${user.accessToken}`, 'Content-Type': 'image/png' },
    body: PNG,
  });
  expect(uploaded.ok).toBe(true);
  const { content_uri: avatarUrl } = (await uploaded.json()) as { content_uri: string };
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(user.userId)}/avatar_url`, {
    method: 'PUT',
    accessToken: user.accessToken,
    body: JSON.stringify({ avatar_url: avatarUrl }),
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await expect.poll(() => keptAvatars(page), { timeout: 30_000 }).toBeGreaterThan(0);
  return user;
};

/** How many avatars the page's origin keeps; -1 once the cache is gone. */
const keptAvatars = (page: Page): Promise<number> =>
  page.evaluate(async (name) => {
    if (!(await caches.has(name))) return -1;
    return (await (await caches.open(name)).keys()).length;
  }, AVATAR_CACHE);

/** The access token of the device this page signed in. */
const pageAccessToken = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const store = JSON.parse(localStorage.getItem('mindroom_multi_account_store') ?? '{}') as {
      activeSessionId?: string;
      sessions?: { sessionId: string; accessToken: string }[];
    };
    const active = store.sessions?.find((item) => item.sessionId === store.activeSessionId);
    if (!active) throw new Error('no active session');
    return active.accessToken;
  });

test('the homeserver ending the device deletes the kept avatars', async ({ page }) => {
  await signInWithKeptAvatar(page, 'server');

  // Outside the app: the next request the app makes is refused, and it removes the account.
  await matrixFetch(HOMESERVER, '/logout', {
    method: 'POST',
    accessToken: await pageAccessToken(page),
    body: '{}',
  });

  await expect(page.locator('input[name="usernameInput"]')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => keptAvatars(page)).toBe(-1);
});

test('deactivating the account deletes the kept avatars', async ({ page }) => {
  await signInWithKeptAvatar(page, 'deactivate');

  await deactivateActiveAccount(page, PASSWORD);

  await expect(page.locator('input[name="usernameInput"]')).toBeVisible({ timeout: 60_000 });
  await expect.poll(() => keptAvatars(page)).toBe(-1);
});
