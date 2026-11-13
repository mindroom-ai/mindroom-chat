import { mkdirSync } from 'node:fs';
import { expect, test, type Browser, type BrowserContextOptions } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// After a reload the app draws from its store and says "Catching up..." until the first syncs
// come back. Its pill floats over the top of the app: the rail, the room list and the room stay
// where they are while it shows and when it goes (a band once pushed them 24 px down and back up
// after every load). Here the first two /sync responses are held for 3 s, and the room list's top is read
// on every animation frame. Set CATCHING_UP_SHOTS=<directory> to save the view with the pill.
const PASSWORD = 'catching-up-overlay-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS = process.env.CATCHING_UP_SHOTS;
const HOLD_MS = 3_000;

/** An account with 26 rooms, each with a message, as a real account's list has. */
const seed = async (name: string) => {
  const username = `cuo_${name}_${RUN}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await Promise.all(
    Array.from({ length: 26 }, async (_, index) => {
      const roomId = await createPrivateRoom(HOMESERVER, body.access_token, {
        name: `Planning room ${index + 1}`,
        topic: 'Weekly planning',
      });
      await sendRoomMessage(HOMESERVER, body.access_token, roomId, {
        msgtype: 'm.text',
        body: `Notes for week ${index + 1}: the agenda is in the shared folder.`,
      });
    })
  );
  return username;
};

type Frame = { band: boolean; top: number | null };

const check = async (
  browser: Browser,
  options: BrowserContextOptions,
  baseURL: string | undefined,
  name: string
) => {
  const username = await seed(name);
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
    await expect(
      page.getByTestId('resizable-page-nav').getByText('Planning room 1', { exact: true })
    ).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });

    // Hold the first two syncs after the reload, and record every frame from the first paint.
    let held = 0;
    await page.route(/\/_matrix\/client\/v3\/sync/, async (route) => {
      if (held < 2) {
        held += 1;
        await new Promise((resolve) => {
          setTimeout(resolve, HOLD_MS);
        });
      }
      await route.continue();
    });
    await page.addInitScript(() => {
      const frames: { band: boolean; top: number | null }[] = [];
      (window as unknown as { catchUpFrames: typeof frames }).catchUpFrames = frames;
      const read = () => {
        const nav = document.querySelector('[data-testid="resizable-page-nav"]');
        frames.push({
          band: !!document.querySelector('[data-testid="client-sync-status"]'),
          top: nav ? Math.round(nav.getBoundingClientRect().top * 10) / 10 : null,
        });
        requestAnimationFrame(read);
      };
      requestAnimationFrame(read);
    });
    await page.reload();
    const band = page.getByTestId('client-sync-status');
    await expect(band).toBeVisible({ timeout: 30_000 });
    await expect(band).toHaveText('Catching up...');
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
    await expect(band).toHaveCount(0, { timeout: 60_000 });
    await page.waitForTimeout(1_000);

    const frames = await page.evaluate(
      () => (window as unknown as { catchUpFrames: Frame[] }).catchUpFrames
    );
    const listed = frames.filter((frame): frame is { band: boolean; top: number } =>
      Number.isFinite(frame.top)
    );
    // The list was there while the pill showed and after it went.
    expect(listed.some((frame) => frame.band)).toBe(true);
    expect(listed.some((frame) => !frame.band)).toBe(true);
    const tops = [...new Set(listed.map((frame) => frame.top))];
    expect(tops, 'the room list top on every frame').toHaveLength(1);
  } finally {
    await context.close();
  }
};

const DESKTOP: BrowserContextOptions = {
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
};
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  colorScheme: 'dark',
};

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeAll(() => {
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
});

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(180_000);
});

for (const [form, options] of [
  ['desktop', DESKTOP],
  ['phone', PHONE],
] as const) {
  test(`"Catching up..." lies over the app without moving it (Chromium, ${form})`, async ({
    browser,
    baseURL,
  }) => {
    await check(browser, options, baseURL, `chromium-${form}`);
  });

  test(`"Catching up..." lies over the app without moving it (WebKit, ${form})`, async ({
    baseURL,
  }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
    const browser = await launchWebKit();
    try {
      await check(browser, options, baseURL, `webkit-${form}`);
    } finally {
      await browser.close();
    }
  });
}
