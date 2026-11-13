import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, loginToMatrix, sendReaction, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Clicking a reaction pill adds or removes the viewer's reaction, and the pill stays where it
// was: the pills keep the order in which their emoji were first used, whatever their counts,
// so a second click lands on the same emoji. Runs in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, against the homeserver of
// `just hs-up` or of an e2e slot.
const PASSWORD = 'reaction-order-spec-password';
const RUN = Date.now().toString(36);
const VIEWPORT = { width: 1280, height: 800 };
const KEYS = ['😀', '🎉', '👍', '🚀'] as const;

// AGENT_UI_SHOTS=<directory> also saves screenshots of the result.
const shot = async (page: Page, name: string) => {
  if (process.env.AGENT_UI_SHOTS)
    await page.screenshot({ path: `${process.env.AGENT_UI_SHOTS}/${name}.png` });
};

test.use({
  viewport: VIEWPORT,
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const register = async (name: string) => {
  const username = `rord_${name}_${RUN}`;
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

const pillsKeepTheirPlaces = async (page: Page, name: string) => {
  const viewer = await register(`${name}v`);
  const writer = await register(`${name}w`);
  const roomId = await createRoom(HOMESERVER, writer.accessToken, {
    name: `Reaction order ${name} ${RUN}`,
    invite: [viewer.userId],
  });
  await joinRoom(HOMESERVER, viewer.accessToken, roomId);
  const messageId = await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'The pilot boat leaves at nine; react with what you think.',
  });
  // Each emoji once, in this order; the viewer has reacted with none of them.
  for (const key of KEYS) {
    // eslint-disable-next-line no-await-in-loop
    await sendReaction(HOMESERVER, writer.accessToken, roomId, messageId, key);
  }

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: viewer.username,
    password: PASSWORD,
  });
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('classic')),
    roomId
  );
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const message = page.locator(`[data-message-id="${messageId}"]`);
  const pill = (key: string) =>
    message.getByRole('button', { name: new RegExp(`^${key}\\s*\\d+$`) });
  await expect(pill(KEYS[3])).toBeVisible({ timeout: 60_000 });
  const keysInOrder = () =>
    message
      .getByRole('button', { name: new RegExp(`^(${KEYS.join('|')})\\s*\\d+$`) })
      .evaluateAll(
        (buttons, keys) =>
          buttons.map((button) => keys.find((key) => button.textContent?.trim().startsWith(key))),
        KEYS
      );
  expect(await keysInOrder()).toEqual(KEYS);

  // The viewer adds a reaction to the third pill: its count rises, and it stays third.
  const third = await pill(KEYS[2]).boundingBox();
  await pill(KEYS[2]).click();
  await expect(pill(KEYS[2])).toHaveAccessibleName(new RegExp(`^${KEYS[2]}\\s*2$`), {
    timeout: 15_000,
  });
  expect(await keysInOrder()).toEqual(KEYS);
  const moved = await pill(KEYS[2]).boundingBox();
  expect({ x: moved?.x, y: moved?.y }).toEqual({ x: third?.x, y: third?.y });
  await shot(page, `reaction-order-${name}`);

  // A second click at the same place takes the reaction back from the same emoji.
  await page.mouse.click(third!.x + third!.width / 2, third!.y + third!.height / 2);
  await expect(pill(KEYS[2])).toHaveAccessibleName(new RegExp(`^${KEYS[2]}\\s*1$`), {
    timeout: 15_000,
  });
  expect(await keysInOrder()).toEqual(KEYS);

  // The last pill too.
  await pill(KEYS[3]).click();
  await expect(pill(KEYS[3])).toHaveAccessibleName(new RegExp(`^${KEYS[3]}\\s*2$`), {
    timeout: 15_000,
  });
  expect(await keysInOrder()).toEqual(KEYS);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'a reaction pill keeps its place when the viewer clicks it';

test(`${TITLE} (Chromium)`, async ({ page }) => {
  test.setTimeout(180_000);
  await pillsKeepTheirPlaces(page, 'c');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, baseURL });
    await pillsKeepTheirPlaces(await context.newPage(), 'w');
  } finally {
    await browser.close();
  }
});
