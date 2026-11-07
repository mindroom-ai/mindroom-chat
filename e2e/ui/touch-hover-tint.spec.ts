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
import {
  joinRoom,
  loginToMatrix,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { setRoomCompact } from '../helpers/roomViewSwitch';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// P2-macos-safari-F010: a touch screen keeps :hover on the element tapped last, so a sidebar room
// row or a Compact thread card that took a tap (or the start of a scroll) kept its hover tint
// after the finger lifted, and read as selected. On a phone and a tablet with touch, in Chromium
// and (when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit) WebKit, a row and a card under
// the pointer keep the fill of their untouched neighbours; a desktop mouse still tints both. A
// card's "..." button that opened and closed its menu with two taps keeps its neighbours' fill too.
// Set HOVER_TINT_SHOTS=<directory> to save the row and the card under the pointer.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'touch-hover-tint-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.HOVER_TINT_SHOTS;

const DEVICES: Record<string, BrowserContextOptions> = {
  phone: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true },
  tablet: { viewport: { width: 820, height: 1180 }, hasTouch: true, isMobile: true },
  desktop: { viewport: { width: 1280, height: 800 } },
};
const QUESTIONS = [
  'Which checks still block the launch on Thursday?',
  'Can someone summarize the load test results?',
  'What changed in the export format this week?',
  'Who owns the security review sign-off?',
];

test.use({
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

const registerAndLogin = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `tht_${name}_${RUN}`;
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

/** 25 rooms, and a room where a helper answered four threads. */
const seed = async (name: string) => {
  const reader = await registerAndLogin(name);
  const helper = await registerAgentAccount(HOMESERVER, `tint_${name}`);
  await Promise.all(
    Array.from({ length: 25 }, (_, index) =>
      createRoom(HOMESERVER, reader.accessToken, {
        name: `Project room ${String(index + 1).padStart(2, '0')}`,
      })
    )
  );
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Launch planning',
    invite: [helper.userId],
  });
  await joinRoom(HOMESERVER, helper.accessToken, roomId);
  for (const question of QUESTIONS) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: question,
    });
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, helper.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Two items remain for "${question}" and both have owners and dates in the tracker.`,
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

const fill = (target: Locator) =>
  target.evaluate((element) => getComputedStyle(element).backgroundColor);

/**
 * Moves the pointer onto `target`, where a finger's last tap leaves :hover, and answers the fills
 * of `target` and of `neighbour` once transitions have ended.
 */
const fillsUnderPointer = async (page: Page, target: Locator, neighbour: Locator) => {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to point at');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(400);
  return { hovered: await fill(target), rest: await fill(neighbour) };
};

const check = async (
  browser: Browser,
  baseURL: string | undefined,
  engine: string,
  device: string
) => {
  const world = await seed(`${engine}_${device}`);
  const context = await browser.newContext({ ...DEVICES[device], baseURL });
  const page = await context.newPage();
  const touch = device !== 'desktop';
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    expect(
      await page.evaluate(() => matchMedia('(hover: hover)').matches),
      `${engine} ${device}: the pointer can hover`
    ).toBe(!touch);
    const row = (name: string) => page.locator('div[data-highlight]').filter({ hasText: name });
    await expect(row('Project room 03')).toBeVisible({ timeout: 60_000 });
    const rows = await fillsUnderPointer(page, row('Project room 03'), row('Project room 04'));
    console.log(`${engine} ${device} row: ${JSON.stringify(rows)}`);
    if (SHOTS) {
      mkdirSync(SHOTS, { recursive: true });
      await page.screenshot({ path: path.join(SHOTS, `hover-row-${engine}-${device}.png`) });
    }
    if (touch) {
      expect(rows.hovered, `${engine} ${device}: a touched row keeps its fill`).toBe(rows.rest);
    } else {
      expect(rows.hovered, `${engine} ${device}: a hovered row is tinted`).not.toBe(rows.rest);
    }

    await page.evaluate((route) => {
      window.history.pushState(null, '', route);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, `/home/${encodeURIComponent(world.roomId)}`);
    await setRoomCompact(page, true);
    const cards = page.locator('button[data-thread-root-id]');
    await expect(cards).toHaveCount(QUESTIONS.length, { timeout: 60_000 });
    const card = await fillsUnderPointer(page, cards.nth(1), cards.nth(2));
    console.log(`${engine} ${device} card: ${JSON.stringify(card)}`);
    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOTS, `hover-card-${engine}-${device}.png`) });
    }
    if (touch) {
      expect(card.hovered, `${engine} ${device}: a touched card keeps its fill`).toBe(card.rest);
    } else {
      expect(card.hovered, `${engine} ${device}: a hovered card is tinted`).not.toBe(card.rest);
    }

    if (touch) {
      // A card's "..." button opened and closed its menu with two taps (p2-safari-touch F010):
      // once the menu is gone, the button keeps the fill of the other cards' buttons.
      const options = page.getByRole('button', { name: 'Thread options', exact: true });
      const tapCenter = async (target: Locator) => {
        const box = await target.boundingBox();
        if (!box) throw new Error('nothing to tap');
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      };
      await options.nth(1).scrollIntoViewIfNeeded();
      await tapCenter(options.nth(1));
      await expect(page.getByRole('menu')).toBeVisible();
      await tapCenter(options.nth(1));
      await expect(page.getByRole('menu')).toHaveCount(0);
      await page.waitForTimeout(400);
      const state = await options.nth(1).evaluate((element) => ({
        hover: element.matches(':hover'),
        focus: element.matches(':focus'),
        focusVisible: element.matches(':focus-visible'),
      }));
      const button = { tapped: await fill(options.nth(1)), rest: await fill(options.nth(2)) };
      console.log(`${engine} ${device} options: ${JSON.stringify({ ...button, ...state })}`);
      if (SHOTS) {
        await page.screenshot({ path: path.join(SHOTS, `tapped-options-${engine}-${device}.png`) });
      }
      expect(button.tapped, `${engine} ${device}: a tapped options button keeps its fill`).toBe(
        button.rest
      );
    }
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

for (const device of ['phone', 'tablet', 'desktop']) {
  test(`hover tints follow the pointer on a ${device} (Chromium)`, async ({ browser, baseURL }) => {
    test.setTimeout(240_000);
    await check(browser, baseURL, 'chromium', device);
  });
}

for (const device of ['phone', 'tablet']) {
  test(`a touch leaves no hover tint on a ${device} (WebKit)`, async ({ baseURL }) => {
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
