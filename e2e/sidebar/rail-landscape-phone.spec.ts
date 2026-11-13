import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { createPrivateSpace, matrixFetch, setAccountData } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// P2-macos-safari-F003: an iPhone in landscape (874 by about 330 px in Safari) showed Home and half
// of Direct Messages in the rail and none of its spaces: the foot group (Inbox, the account, the
// panel toggle) kept its place at the rail's foot and left the part above it about 130 px. In a
// rail that short, the whole rail now scrolls as one column, so the first space shows at rest and
// every space and the account button can be scrolled to and tapped. A tablet in landscape keeps
// the foot group in place. Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, WebKit. Set RAIL_LANDSCAPE_SHOTS=<directory> to save the rails.
const PASSWORD = 'rail-landscape-phone-spec-password';
const SHOTS = process.env.RAIL_LANDSCAPE_SHOTS;

const DEVICES: Record<string, BrowserContextOptions> = {
  // iPhone 17 Pro in landscape: 874 by 402 points, less Safari's tab bar and toolbar.
  'phone-landscape': { viewport: { width: 874, height: 330 }, hasTouch: true, isMobile: true },
  'tablet-landscape': { viewport: { width: 1180, height: 820 }, hasTouch: true, isMobile: true },
};

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** A new account with 25 rooms and two spaces, as the lane's tester had. */
const seed = async (prefix: string) => {
  const username = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const { user_id: userId, access_token: accessToken } = await matrixFetch<{
    user_id: string;
    access_token: string;
  }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, accessToken, {
        name: `Project room ${String(index + 1).padStart(2, '0')}`,
      })
    )
  );
  const spaces: [string, string] = [
    await createPrivateSpace(HOMESERVER, accessToken, { name: 'Projects', topic: '' }),
    await createPrivateSpace(HOMESERVER, accessToken, { name: 'Operations', topic: '' }),
  ];
  await setAccountData(HOMESERVER, accessToken, userId, 'io.mindroom.spaces', { sidebar: spaces });
  return { username, spaces };
};

const rail = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });

/** Whether all of `target` shows inside every box that clips it. */
const shownWhole = (target: Locator) =>
  target.evaluate((element) => {
    const box = element.getBoundingClientRect();
    let view = { top: 0, bottom: window.innerHeight };
    for (let node = element.parentElement; node; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (style.overflowY !== 'visible' || style.overflowX !== 'visible') {
        const clip = node.getBoundingClientRect();
        view = { top: Math.max(view.top, clip.top), bottom: Math.min(view.bottom, clip.bottom) };
      }
    }
    return box.height > 0 && box.top >= view.top - 0.5 && box.bottom <= view.bottom + 0.5;
  });

const check = async (
  browser: Browser,
  baseURL: string | undefined,
  engine: string,
  device: string
) => {
  const account = await seed(`rlp_${engine}`);
  const context = await browser.newContext({ ...DEVICES[device], baseURL });
  const page = await context.newPage();
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: account.username,
      password: PASSWORD,
    });
    const spaceButton = (spaceId: string) => rail(page).locator(`button[data-id="${spaceId}"]`);
    const account_ = rail(page).getByRole('button', { name: /Open account menu for / });
    await expect(spaceButton(account.spaces[1])).toBeAttached({ timeout: 60_000 });
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(resolve));
        })
    );
    const atRest = {
      firstSpace: await shownWhole(spaceButton(account.spaces[0])),
      home: await shownWhole(rail(page).getByRole('button', { name: 'Home', exact: true })),
      account: await shownWhole(account_),
    };
    console.log(`${engine} ${device} at rest: ${JSON.stringify(atRest)}`);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `rail-${engine}-${device}.png`) });
    }
    expect(atRest.home, `${engine} ${device}: Home shows at rest`).toBe(true);
    expect(atRest.firstSpace, `${engine} ${device}: the first space shows at rest`).toBe(true);
    if (device === 'tablet-landscape') {
      expect(atRest.account, `${engine} ${device}: the account stays at the foot`).toBe(true);
    }
    // Every space, and the account button, can be scrolled to and then tapped.
    for (const target of [spaceButton(account.spaces[1]), account_]) {
      // eslint-disable-next-line no-await-in-loop
      await target.evaluate((element) => element.scrollIntoView({ block: 'nearest' }));
      // eslint-disable-next-line no-await-in-loop
      expect(await shownWhole(target), `${engine} ${device}: scrolled into view`).toBe(true);
    }
    await spaceButton(account.spaces[1]).tap();
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(account.spaces[1])), {
      timeout: 30_000,
    });
  } finally {
    await context.close();
  }
};

for (const device of Object.keys(DEVICES)) {
  test(`the rail reaches every space on a ${device} (Chromium)`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    await check(browser, baseURL, 'chromium', device);
  });

  test(`the rail reaches every space on a ${device} (WebKit)`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(240_000);
    const browser = await launchWebKit();
    try {
      await check(browser, baseURL, 'webkit', device);
    } finally {
      await browser.close();
    }
  });
}
