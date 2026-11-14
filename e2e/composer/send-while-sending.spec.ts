import { expect, test, type Page, type Route } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Enter sends a message while the one before it is still going out: the composer takes it at
// once and it arrives after the first, as in any chat app. The first send is held back on its
// way to the homeserver, as on a slow network. Runs in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the disposable
// homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const PASSWORD = 'send-while-sending-spec-password';
const RUN = Date.now().toString(36);
const VIEWPORT = { width: 1280, height: 800 };
const FIRST = 'First quick note: the pilot boat is on its way.';
const SECOND = 'Second quick note: and the tug follows it.';

test.use({
  viewport: VIEWPORT,
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

const bothArriveInOrder = async (page: Page, name: string) => {
  const reader = await registerDisposableUser(`sws_${name}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: `Pilot desk ${name} ${RUN}`,
  });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('classic')),
    roomId
  );
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });

  // The first message takes three seconds to reach the homeserver.
  const sent: string[] = [];
  let held = false;
  await page.route('**/send/m.room.message/**', async (route: Route) => {
    const body = (route.request().postDataJSON() ?? {}) as { body?: string };
    sent.push(body.body ?? '');
    if (!held) {
      held = true;
      await new Promise((resolve) => {
        setTimeout(resolve, 3_000);
      });
    }
    await route.continue();
  });

  await composer.click();
  await page.keyboard.type(FIRST);
  await page.keyboard.press('Enter');
  await page.keyboard.type(SECOND);
  await page.keyboard.press('Enter');
  // The composer took the second message as well.
  await expect(composer).not.toContainText('Second quick note', { timeout: 2_000 });

  const rows = page.locator('[data-message-id^="$"]');
  await expect(rows.filter({ hasText: FIRST })).toBeVisible({ timeout: 30_000 });
  await expect(rows.filter({ hasText: SECOND })).toBeVisible({ timeout: 30_000 });
  const order = await rows.evaluateAll((elements) =>
    elements
      .map((element) => element.textContent ?? '')
      .filter((text) => text.includes('quick note'))
      .map((text) => (text.includes('First') ? 'first' : 'second'))
  );
  expect(order).toEqual(['first', 'second']);
  expect(sent.filter((body) => body.includes('quick note'))).toEqual([FIRST, SECOND]);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'a message sent while the one before it is still going out follows it in order';

test(`${TITLE} (Chromium)`, async ({ page }) => {
  test.setTimeout(180_000);
  await bothArriveInOrder(page, 'c');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    // Without the service worker, the page's route sees the send in WebKit too.
    const context = await browser.newContext({
      viewport: VIEWPORT,
      baseURL,
      serviceWorkers: 'block',
    });
    await bothArriveInOrder(await context.newPage(), 'w');
  } finally {
    await browser.close();
  }
});
