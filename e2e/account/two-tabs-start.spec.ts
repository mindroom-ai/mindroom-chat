import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { launchWebKit } from '../helpers/webkit';

// Two tabs of one account, opened one right after the other: both start. A tab that starts while
// the other one is still starting must not land on "Failed to start account". Runs in Chromium
// and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the
// disposable homeserver.
const PASSWORD = 'two-tabs-start-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const ROUNDS = 6;
const SETTLE_MS = 9_000;

test.use({ viewport: { width: 1024, height: 768 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const startFailure = (page: Page) => page.getByText(/Failed to start account/);

const bothTabsStart = async (context: BrowserContext, browserName: string) => {
  const user = await registerDisposableUser(`tts_${browserName}_${RUN}`, PASSWORD);
  const room = await createRoom(HOMESERVER, user.accessToken, {
    name: `Shared desk ${browserName} ${RUN}`,
  });
  const first = await context.newPage();
  await loginWithPassword(first, { homeserver: HOMESERVER, ...user });
  const second = await context.newPage();
  const roomPath = `/home/${encodeURIComponent(room)}`;
  const failures: string[] = [];

  for (let round = 1; round <= ROUNDS; round += 1) {
    // eslint-disable-next-line no-await-in-loop
    await first.goto(roomPath);
    // eslint-disable-next-line no-await-in-loop
    await second.goto(roomPath);
    // eslint-disable-next-line no-await-in-loop
    await second.waitForTimeout(SETTLE_MS);
    for (const [name, page] of [
      ['first', first],
      ['second', second],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      if (await startFailure(page).isVisible()) {
        // eslint-disable-next-line no-await-in-loop
        failures.push(`round ${round}, ${name} tab: ${await startFailure(page).innerText()}`);
      }
    }
  }
  expect(failures).toEqual([]);
  for (const page of [first, second]) {
    // eslint-disable-next-line no-await-in-loop
    await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible();
  }
};

test('two tabs of one account both start (Chromium)', async ({ browser, browserName }) => {
  test.setTimeout(300_000);
  const context = await browser.newContext();
  try {
    await bothTabsStart(context, browserName);
  } finally {
    await context.close();
  }
});

test('two tabs of one account both start (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser: Browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: { width: 1024, height: 768 }, baseURL });
    await bothTabsStart(context, 'webkit');
  } finally {
    await browser.close();
  }
});
