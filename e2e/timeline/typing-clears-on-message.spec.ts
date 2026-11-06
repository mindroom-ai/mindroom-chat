import { expect, test, webkit, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, loginToMatrix, matrixFetch, sendRoomMessage } from '../helpers/matrix';

// A person's typing notice ends when their message arrives, even when the homeserver never sends
// a typing list without them (Tuwunel keeps the notice until its timeout and announces no expiry).
// Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit,
// against the homeserver of `just hs-up` or of an e2e slot.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'typing-clears-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
const VIEWPORT = { width: 1280, height: 800 };

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
  const username = `tcm_${name}_${RUN}`;
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

const typingEndsWithTheMessage = async (page: Page, name: string) => {
  const viewer = await register(`${name}v`);
  const writer = await register(`${name}w`);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(writer.userId)}/displayname`, {
    method: 'PUT',
    accessToken: writer.accessToken,
    body: JSON.stringify({ displayname: 'Avery Writer' }),
  });
  const roomId = await createRoom(HOMESERVER, viewer.accessToken, {
    name: `Typing desk ${name} ${RUN}`,
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Morning, the harbor report is coming.',
  });

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: viewer.username,
    password: PASSWORD,
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.getByText('Morning, the harbor report is coming.')).toBeVisible({
    timeout: 60_000,
  });

  const typing = page.getByText('Avery Writer is typing...', { exact: true });
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/typing/${encodeURIComponent(writer.userId)}`,
    {
      method: 'PUT',
      accessToken: writer.accessToken,
      body: JSON.stringify({ typing: true, timeout: 60_000 }),
    }
  );
  await expect(typing).toBeVisible({ timeout: 30_000 });

  const report = 'Harbor report: all berths are free until noon.';
  await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
    msgtype: 'm.text',
    body: report,
  });
  await expect(page.getByText(report)).toBeVisible({ timeout: 30_000 });
  // The notice would last its whole minute without the message clearing it.
  await expect(typing).toHaveCount(0, { timeout: 5_000 });
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const TITLE = 'a typing notice ends when the person’s message arrives';

test(`${TITLE} (Chromium)`, async ({ page }) => {
  test.setTimeout(180_000);
  await typingEndsWithTheMessage(page, 'c');
});

test(`${TITLE} (WebKit)`, async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  // The runner adds the file's launch options, whose Chromium flag WebKit refuses.
  const browser = await webkit.launch({ executablePath: WEBKIT, args: [] });
  try {
    const context = await browser.newContext({ viewport: VIEWPORT, baseURL });
    await typingEndsWithTheMessage(await context.newPage(), 'w');
  } finally {
    await browser.close();
  }
});
