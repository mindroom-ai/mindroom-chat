import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type Page, type Route } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';
import { loginToMatrix, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Up in an empty composer edits the user's latest message. Right after Enter, while that message
// is still on its way to the homeserver (held back here, as on a slow network), Up must not open
// the editor on the message before it, whose text an edit would overwrite. Once the new message
// is sent, Up edits it. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit, against the disposable homeserver of `just hs-up` or of a slot of
// scripts/e2e-slot.sh. Set ARROW_UP_SHOTS=<directory> to save screenshots.
const PASSWORD = 'arrow-up-sending-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.ARROW_UP_SHOTS;
const FILLER_ROOMS = 25;
const EARLIER = 'Earlier note: the harbor office opens at nine and the ferry leaves at ten.';
const FRESH = 'Fresh note: the pilot boat is on its wya to the outer buoy.';
const HOLD_MS = 6_000;

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const register = async (name: string) => {
  const username = `aus_${name}_${RUN}`;
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

const checkArrowUp = async (page: Page, tag: string) => {
  const writer = await register(tag);
  await Promise.all(
    Array.from({ length: FILLER_ROOMS }, (_, index) =>
      createRoom(HOMESERVER, writer.accessToken, { name: `Project room ${index + 1} ${RUN}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, writer.accessToken, {
    name: `Harbor desk ${tag} ${RUN}`,
  });
  const earlierId = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
    msgtype: 'm.text',
    body: EARLIER,
  });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: writer.username,
    password: PASSWORD,
  });
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('classic')),
    roomId
  );
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(EARLIER, { exact: true })).toBeVisible();

  // The new message takes six seconds to reach the homeserver.
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/send/m.room.message/**', async (route: Route) => {
    await Promise.race([
      released,
      new Promise((resolve) => {
        setTimeout(resolve, HOLD_MS);
      }),
    ]);
    await route.continue();
  });

  await composer.click();
  await composer.pressSequentially(FRESH);
  await composer.press('Enter');
  await expect(page.getByText(FRESH, { exact: true })).toBeVisible();
  await expect(composer.locator('[data-slate-string]')).toHaveCount(0);
  await page.waitForTimeout(1_200);
  await composer.press('ArrowUp');
  // No editor opens on the earlier message while the new one is sending.
  const editBoxes = page.locator('[contenteditable="true"]:not([data-editable-name="RoomInput"])');
  await page.waitForTimeout(1_000);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/arrow-up-sending-${tag}.png` });
  }
  await expect(editBoxes).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  await expect(composer).toBeFocused();

  // Once it is sent, Up edits the new message.
  release();
  const sentRow = page.locator('[data-message-id^="$"]').filter({ hasText: FRESH });
  await expect(sentRow).toHaveCount(1, { timeout: 20_000 });
  await composer.press('ArrowUp');
  const freshEditor = page.locator('[contenteditable="true"]').filter({ hasText: FRESH });
  await expect(freshEditor).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);

  // The earlier message was never edited.
  const earlier = await matrixFetch<{ content: { body?: string } }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(earlierId)}`,
    { accessToken: writer.accessToken }
  );
  expect(earlier.content.body).toBe(EARLIER);
  const relations = await matrixFetch<{ chunk: unknown[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(earlierId)}/m.replace`,
    { accessToken: writer.accessToken, apiVersion: 'v1' }
  );
  expect(relations.chunk).toHaveLength(0);
};

const TITLE = 'Up right after Enter leaves the earlier message alone while the new one sends';

test(`${TITLE} (Chromium, desktop)`, async ({ page }) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await checkArrowUp(page, 'cd');
});

test(`${TITLE} (WebKit, desktop)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(120_000);
  let browser: Browser | undefined;
  try {
    browser = await launchWebKit();
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL });
    await checkArrowUp(await context.newPage(), 'wd');
  } finally {
    await browser?.close();
  }
});
