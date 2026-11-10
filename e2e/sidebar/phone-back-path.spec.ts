import { expect, test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  matrixFetch,
  setAccountData,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// On a phone a room fills the screen; its header has no back chevron, since the drawer holds the
// list. The browser's own back (Android's back button, iOS's edge swipe in Safari) returns from the
// room to the list it was opened from, and from there to where the person was before that list,
// never into a room they already left. Checked at 390 by 844 with touch, in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'phone-back-path-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

type Seed = { username: string; space: string; rooms: string[] };
const seeds = new Map<string, Promise<Seed>>();

const seed = async (engine: string): Promise<Seed> => {
  const username = `pbp_${engine}_${RUN}`;
  const { user_id: userId, access_token: token } = await matrixFetch<{
    user_id: string;
    access_token: string;
  }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  const space = await createPrivateSpace(HOMESERVER, token, { name: 'Field Notes', topic: '' });
  const rooms: string[] = [];
  for (const name of ['Harbor Plans', 'Garden Club', 'Book Swap']) {
    const roomId = await createPrivateRoom(HOMESERVER, token, { name, topic: '' });
    await addRoomToSpace(HOMESERVER, token, space, roomId);
    rooms.push(roomId);
  }
  await setAccountData(HOMESERVER, token, userId, 'io.mindroom.spaces', { sidebar: [space] });
  return { username, space, rooms };
};

const checkBackPath = async (browser: Browser, engine: string) => {
  if (!seeds.has(engine)) seeds.set(engine, seed(engine));
  const { username, space } = await seeds.get(engine)!;
  const context = await browser.newContext(PHONE);
  const page = await context.newPage();
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await page.goto('/home/');
  await expect(page.getByRole('group', { name: 'Spaces' })).toBeVisible({ timeout: 30_000 });

  const spacePath = new RegExp(`/${encodeURIComponent(space).replace(/[!$]/g, '\\$&')}/?$`);
  await page.getByRole('group', { name: 'Spaces' }).locator(`[data-id="${space}"]`).tap();
  await expect(page).toHaveURL(spacePath);
  const list = page.getByTestId('resizable-page-nav');
  const roomName = (name: string) =>
    page.getByRole('banner').getByRole('heading', { level: 1, name });
  await list.getByRole('link', { name: 'Harbor Plans' }).tap();
  await expect(roomName('Harbor Plans')).toBeVisible();
  await expect(page.getByRole('banner').getByRole('button', { name: 'Back' })).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(spacePath);
  await expect(list.getByRole('link', { name: 'Garden Club' })).toBeVisible();

  // A second room, then the browser's back twice: the list, then Home, never Harbor Plans.
  await list.getByRole('link', { name: 'Garden Club' }).tap();
  await expect(roomName('Garden Club')).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(spacePath);
  await page.goBack();
  await expect(page).toHaveURL(/\/home\/$/);
  await context.close();
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

test("the browser's back leaves a room for its list, and the list for the page before", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  await checkBackPath(browser, 'chromium');
});

test('the same back path in WebKit', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(120_000);
  const browser = await launchWebKit();
  try {
    await checkBackPath(browser, 'webkit');
  } finally {
    await browser.close();
  }
});
