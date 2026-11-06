import { expect, test, webkit, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { loginToMatrix } from '../helpers/matrix';

// A message the homeserver refuses stays in the room as Not sent; the Compact view opens its
// thread right away, under the message's local ID. That thread has no approvals to load: the
// client must not ask the server for relations of the local ID, and must not say "Some approval
// history could not be loaded." under it. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE
// names Playwright's WebKit, in WebKit, against the homeserver of `just hs-up` or of an e2e slot.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'approval-history-unsent-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const VIEWPORT = { width: 1280, height: 800 };
const TEXT = 'Harbor note: the crane inspection moves to Thursday morning.';

test.use({
  viewport: VIEWPORT,
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
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
  const username = `ahu_${name}_${RUN}`;
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      username,
      password: PASSWORD,
      auth: { type: 'm.login.dummy' },
      inhibit_login: true,
    }),
  });
  expect(response.ok, `registering ${username}`).toBe(true);
  return { ...(await loginToMatrix(HOMESERVER, username, PASSWORD)), username };
};

const unsentThreadHasNoApprovalError = async (page: Page, name: string) => {
  const person = await register(name);
  const roomId = await createRoom(HOMESERVER, person.accessToken, {
    name: `Crane desk ${name} ${RUN}`,
  });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: person.username,
    password: PASSWORD,
  });
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('compact')),
    roomId
  );
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });

  const localRelations: string[] = [];
  page.on('request', (request) => {
    const url = decodeURIComponent(request.url());
    if (url.includes('/relations/~')) localRelations.push(url);
  });
  await page.route('**/send/m.room.message/**', (route) =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ errcode: 'M_FORBIDDEN', error: 'You may not send here.' }),
    })
  );
  await composer.click();
  await page.keyboard.type(TEXT);
  await page.keyboard.press('Enter');

  // The Compact view opens the new message's thread under its local ID.
  await expect(page).toHaveURL(/threadId=~/, { timeout: 30_000 });
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(TEXT).first()).toBeVisible();
  // The approval history request would have failed within a second or two.
  await page.waitForTimeout(5_000);
  await expect(page.getByText(/approval history/i)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry history' })).toHaveCount(0);
  expect(localRelations).toEqual([]);
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'the thread of a message the server refused shows no approval history error';

test(`${TITLE} (Chromium)`, async ({ page }) => {
  test.setTimeout(180_000);
  await unsentThreadHasNoApprovalError(page, 'c');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
  try {
    // Without the service worker, the page's route sees the send in WebKit too.
    const context = await browser.newContext({
      viewport: VIEWPORT,
      baseURL,
      serviceWorkers: 'block',
    });
    await unsentThreadHasNoApprovalError(await context.newPage(), 'w');
  } finally {
    await browser.close();
  }
});
