import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  loginToMatrix,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The thread filter bar's Preset list and Thread statistics open under their buttons and stay
// inside the bar, whichever end of the bar the button sits at: on a phone, where the bar wraps
// onto three rows, and on a desktop, in English and in Arabic, in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const PASSWORD = 'thread-filter-popovers-spec-password';
const RUN = Date.now().toString(36);

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});
test.describe.configure({ timeout: 180_000 });

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `tfp_${name}_${RUN}`;
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

const seed = async (engine: string) => {
  const reader = await registerAndLogin(`reader_${engine}`);
  const agent = await registerAgentAccount(HOMESERVER, `triage_${engine}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Support triage',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  for (const body of ['Refund request from the Berlin office', 'Login loop on the iPad app']) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Looking into it now.',
      'io.mindroom.stream_status': 'completed',
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }
  return { reader, roomId };
};

/** How far a panel reaches past the filter bar's sides, in pixels; 0 when it fits. */
const overhang = async (bar: Locator, panel: Locator) => {
  await expect(panel).toBeVisible();
  const outer = (await bar.boundingBox())!;
  const inner = (await panel.boundingBox())!;
  return {
    start: Math.max(0, Math.round(outer.x - inner.x)),
    end: Math.max(0, Math.round(inner.x + inner.width - (outer.x + outer.width))),
  };
};

const check = async (browser: Browser, engine: string, phone: boolean, baseURL?: string) => {
  const world = await seed(`${engine}_${phone ? 'p' : 'd'}`);
  const context = await browser.newContext({
    ...(phone
      ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
      : { viewport: { width: 1280, height: 800 } }),
    baseURL,
  });
  await context.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  const page: Page = await context.newPage();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.reader.username,
    password: PASSWORD,
  });
  for (const language of ['en', 'ar']) {
    // eslint-disable-next-line no-await-in-loop
    await page.evaluate((code) => localStorage.setItem('i18nextLng', code), language);
    // eslint-disable-next-line no-await-in-loop
    await page.goto(`/home/${encodeURIComponent(world.roomId)}`);
    const bar = page.getByRole('toolbar').filter({ has: page.locator('[data-thread-count]') });
    // eslint-disable-next-line no-await-in-loop
    await expect(bar).toBeVisible({ timeout: 30_000 });
    const advanced = bar.locator('[data-thread-filter-mode-switch]');
    // eslint-disable-next-line no-await-in-loop
    if ((await advanced.getAttribute('aria-pressed')) !== 'true') await advanced.click();
    for (const [trigger, panel] of [
      ['[data-preset-button]', '[data-preset-dropdown]'],
      ['[data-info-button]', '[data-info-popover]'],
    ] as const) {
      // eslint-disable-next-line no-await-in-loop
      await bar.locator(trigger).click();
      // eslint-disable-next-line no-await-in-loop
      expect(await overhang(bar, page.locator(panel)), `${panel} in ${language}`).toEqual({
        start: 0,
        end: 0,
      });
      // eslint-disable-next-line no-await-in-loop
      await bar.locator(trigger).click();
      // eslint-disable-next-line no-await-in-loop
      await expect(page.locator(panel)).toHaveCount(0);
    }
  }
  await context.close();
};

for (const phone of [true, false]) {
  const device = phone ? 'phone' : 'desktop';
  test(`filter bar panels stay inside the bar, Chromium ${device}`, async ({
    browser,
    baseURL,
  }) => {
    test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    await check(browser, 'chromium', phone, baseURL);
  });

  test(`filter bar panels stay inside the bar, WebKit ${device}`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
    test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    const browser = await launchWebKit();
    try {
      await check(browser, 'webkit', phone, baseURL);
    } finally {
      await browser.close();
    }
  });
}
