import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { createPrivateRoom, joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// The page a room link opens when the person is not in the room. A room left on another device
// just as the app starts keeps its name there. The person has 25 other rooms; desktop (1280 by
// 800, classic scrollbars) and phone (390 by 844, touch), light and dark, Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit. Set JOIN_PAGE_SHOTS=<directory>
// for screenshots.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'join-page-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.JOIN_PAGE_SHOTS;
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const TOPIC = 'Measurements from the north face, and who walks which section next week';
const LEFT_AT_START = 'Quarry survey';

test.use({
  launchOptions: {
    // Classic scrollbars, as desktop browsers show them. The other options repeat
    // playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

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

const register = async (name: string) => {
  const username = `jp_${name}_${RUN}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  return { username, userId: body.user_id, accessToken: body.access_token };
};

type Account = Awaited<ReturnType<typeof register>>;

const post = (account: Account, path: string, body: Record<string, unknown> = {}) =>
  matrixFetch<unknown>(HOMESERVER, path, {
    method: 'POST',
    accessToken: account.accessToken,
    body: JSON.stringify(body),
  });

const roomPath = (roomId: string, action: string) =>
  `/rooms/${encodeURIComponent(roomId)}/${action}`;

/** An owner, and a viewer with 25 rooms of their own. */
const seedAccounts = async (label: string) => {
  const owner = await register(`owner_${label}`);
  const viewer = await register(`viewer_${label}`);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, viewer.accessToken, { name: `Team room ${index + 1}` })
    )
  );
  return { owner, viewer };
};

/** A room only invited people may join, which `member` is in, with a message from the owner. */
const inviteOnlyRoom = async (owner: Account, member: Account, name: string) => {
  const roomId = await createPrivateRoom(HOMESERVER, owner.accessToken, {
    name,
    topic: TOPIC,
    invite: [member.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  await sendRoomMessage(HOMESERVER, owner.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'The north face readings are in the shared sheet; the east face is next.',
  });
  return roomId;
};

const signIn = async (browser: Browser, viewer: Account, options: BrowserContextOptions) => {
  // The service worker would take requests out of the page's routes (WebKit).
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`page error: ${error.message}`));
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: viewer.username,
    password: PASSWORD,
  });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  return { page, problems };
};

/** Saves the page in light and dark, with `name` in the file names. */
const shots = async (page: Page, name: string) => {
  if (!SHOTS) return;
  for (const scheme of ['light', 'dark'] as const) {
    // eslint-disable-next-line no-await-in-loop
    await page.emulateMedia({ colorScheme: scheme });
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(300);
    // eslint-disable-next-line no-await-in-loop
    await page.screenshot({ path: `${SHOTS}/${name}-${scheme}.png` });
  }
  await page.emulateMedia({ colorScheme: null });
};

/** Moves within the app without reloading it, as its own links do. */
const openPath = (page: Page, to: string) =>
  page.evaluate((target) => {
    window.history.pushState({}, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, to);

/**
 * A room left on another device just as the app starts: the start's check of the joined rooms
 * no longer lists it, and its leave reaches this device by sync a moment later. The page the room's
 * link opens still names it, from the state the device kept, and offers to forget it.
 */
const checkLeftAtStart = async (
  browser: Browser,
  label: string,
  options: BrowserContextOptions
) => {
  const { owner, viewer } = await seedAccounts(label);
  const roomId = await inviteOnlyRoom(owner, viewer, LEFT_AT_START);
  const { page, problems } = await signIn(browser, viewer, options);
  await expect(page.getByText(LEFT_AT_START).first()).toBeVisible();

  let release = () => undefined as void;
  let held: Promise<void> | undefined;
  await page.route(
    (url) => url.pathname.endsWith('/v3/joined_rooms'),
    async (route) => {
      if (!held) {
        held = new Promise((resolve) => {
          release = resolve;
        });
        await post(viewer, roomPath(roomId, 'leave'));
      }
      await route.fulfill({ response: await route.fetch() });
      // The answer arrives before the leave does through sync.
      setTimeout(() => release(), 1_000);
    }
  );
  await page.route(
    (url) => url.pathname.endsWith('/v3/sync'),
    async (route) => {
      try {
        // A long poll may take its full 30 seconds.
        const response = await route.fetch({ timeout: 0 });
        if (held) await held;
        await route.fulfill({ response });
      } catch {
        // The page closed while the long poll waited.
        await route.abort().catch(() => undefined);
      }
    }
  );
  await page.goto('/home/');
  await expect.poll(() => held !== undefined, { timeout: 30_000 }).toBe(true);
  // Long enough for the leave and the batches after it to arrive.
  await page.waitForTimeout(4_000);
  await openPath(page, `/home/${encodeURIComponent(roomId)}/`);
  const main = page.locator('main');
  await expect(main.getByRole('button', { name: 'Forget Room' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(main.getByText(LEFT_AT_START, { exact: true }).first()).toBeVisible();
  await expect(main.getByText('Empty room')).toHaveCount(0);
  await shots(page, `${label}-left-at-start`);
  expect(problems).toEqual([]);
  await page.context().close();
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
  test.setTimeout(240_000);
});

test('a room left elsewhere as the app starts keeps its name on its page (Chromium)', async ({
  browser,
}) => {
  await checkLeftAtStart(browser, 'chromium-desktop', DESKTOP);
});

test('a room left elsewhere as the app starts keeps its name on its page (WebKit phone)', async () => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    await checkLeftAtStart(browser, 'webkit-phone', PHONE);
  } finally {
    await browser.close();
  }
});
