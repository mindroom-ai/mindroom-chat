import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// A name or message in another direction than the interface keeps one order and its own side, on
// a real homeserver. The Arabic name "المستخدم E" reads right to left, so its Latin E shows at
// its left wherever it appears: the sender line (as in the members panel), the typing strip and
// the approval review's "Requested by". A short plain message sits at its own start, as a long
// or formatted one does: Arabic and Hebrew at the right in the English interface, English at the
// left in the Arabic interface. Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, WebKit; English and Arabic. MIXED_DIRECTION_SHOTS names a directory for screenshots.
const PASSWORD = 'mixed-direction-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.MIXED_DIRECTION_SHOTS;
const ARABIC_NAME = 'المستخدم E';
const HEBREW_NAME = 'משתמש F';
const ARABIC = 'مرحبا بالجميع، الاجتماع في الساعة 11:00';
const HEBREW = 'שלום, אני בודק את ה-build';
const ENGLISH = 'Sounds good, see you there.';

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});
test.describe.configure({ timeout: 180_000 });

const registerAndLogin = async (
  name: string,
  displayName?: string
): Promise<MatrixSession & { username: string }> => {
  const username = `mdn_${name}_${RUN}`;
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
  const session = await loginToMatrix(HOMESERVER, username, PASSWORD);
  if (displayName) {
    await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(session.userId)}/displayname`, {
      method: 'PUT',
      accessToken: session.accessToken,
      body: JSON.stringify({ displayname: displayName }),
    });
  }
  return { ...session, username };
};

/** A thread the Arabic-named member starts, with replies in Hebrew and English and an approval. */
const seed = async (run: string) => {
  const reader = await registerAndLogin(`reader_${run}`);
  const arabic = await registerAndLogin(`ar_${run}`, ARABIC_NAME);
  const hebrew = await registerAndLogin(`he_${run}`, HEBREW_NAME);
  const agent = await registerAgentAccount(HOMESERVER, `deploy_${run}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Mixed direction room',
    invite: [arabic.userId, hebrew.userId, agent.userId],
  });
  await Promise.all(
    [arabic, hebrew, agent].map(({ accessToken }) => joinRoom(HOMESERVER, accessToken, roomId))
  );
  const rootId = await sendRoomMessage(HOMESERVER, arabic.accessToken, roomId, {
    msgtype: 'm.text',
    body: ARABIC,
  });
  const relation = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  };
  const hebrewId = await sendRoomMessage(HOMESERVER, hebrew.accessToken, roomId, {
    msgtype: 'm.text',
    body: HEBREW,
    'm.relates_to': relation,
  });
  const englishId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: ENGLISH,
    'm.relates_to': relation,
  });
  const now = Date.now();
  const approvalId = `approval-${RUN}-${run}`;
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/send/io.mindroom.tool_approval/${approvalId}`,
    {
      method: 'PUT',
      accessToken: agent.accessToken,
      body: JSON.stringify({
        msgtype: 'io.mindroom.tool_approval',
        body: 'Approval required: run_shell_command',
        approval_id: approvalId,
        tool_name: 'run_shell_command',
        agent_name: `deploy_${run}`,
        status: 'pending',
        approvable: true,
        approver_user_id: reader.userId,
        requester_id: arabic.userId,
        approval_scope: {
          id: 'shell',
          entity_name: `deploy_${run}`,
          invoking_agent: `deploy_${run}`,
          operation: { tool_name: 'run_shell_command' },
        },
        arguments: { command: 'ls releases' },
        requested_at: new Date(now - 60_000).toISOString(),
        expires_at: new Date(now + 3_600_000).toISOString(),
        thread_id: rootId,
        'm.relates_to': relation,
      }),
    }
  );
  return { reader, arabic, roomId, rootId, hebrewId, englishId };
};

/**
 * Whether the Arabic name's Latin E shows at the left of its Arabic word, as the name reads on
 * its own, in the first text inside `scope` that holds it.
 */
const latinLetterOnLeft = (scope: Locator): Promise<boolean> =>
  scope.evaluate((element, name) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node;
      const start = text.textContent?.indexOf(name) ?? -1;
      if (start === -1) continue;
      const range = document.createRange();
      const left = (offset: number) => {
        range.setStart(text, offset);
        range.setEnd(text, offset + 1);
        return range.getBoundingClientRect().left;
      };
      return left(start + name.length - 1) < left(start);
    }
    throw new Error(`No text holds ${name}`);
  }, ARABIC_NAME);

/** How far a message's text sits from each side of its column. */
const bodyGaps = (page: Page, eventId: string, text: string) =>
  page
    .locator(`[data-message-id="${eventId}"]`)
    .getByText(text, { exact: true })
    .evaluate((body) => {
      const column = body.closest('[data-message-fold]');
      if (!column) throw new Error('The text is outside a message column');
      const own = body.getBoundingClientRect();
      const box = column.getBoundingClientRect();
      return { left: own.left - box.left, right: box.right - own.right };
    });

/** A short text sits at its own start: the right for right-to-left text, else the left. */
const expectAtOwnStart = async (
  page: Page,
  eventId: string,
  text: string,
  rightToLeft: boolean
) => {
  const gaps = await bodyGaps(page, eventId, text);
  const [start, end] = rightToLeft ? [gaps.right, gaps.left] : [gaps.left, gaps.right];
  expect(start, `${text} touches its own start`).toBeLessThan(2);
  expect(end, `${text} is short, so its other side is free`).toBeGreaterThan(40);
};

const check = async (browser: Browser, engine: string, language: 'en' | 'ar', baseURL?: string) => {
  const world = await seed(`${engine}_${language}`);
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, baseURL });
  await context.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  const page = await context.newPage();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: world.reader.username,
    password: PASSWORD,
  });
  await page.evaluate((code) => localStorage.setItem('i18nextLng', code), language);
  await page.goto(
    `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(world.rootId)}`
  );
  await expect(page.locator('html')).toHaveAttribute('dir', language === 'ar' ? 'rtl' : 'ltr');
  const root = page.locator(`[data-message-id="${world.rootId}"]`);
  await expect(root).toContainText(ARABIC, { timeout: 60_000 });
  await expect(page.locator(`[data-message-id="${world.englishId}"]`)).toContainText(ENGLISH);

  // The sender line.
  expect(await latinLetterOnLeft(root.getByText(ARABIC_NAME, { exact: true })), 'sender').toBe(
    true
  );
  // Each plain message at its own start.
  await expectAtOwnStart(page, world.rootId, ARABIC, true);
  await expectAtOwnStart(page, world.hebrewId, HEBREW, true);
  await expectAtOwnStart(page, world.englishId, ENGLISH, false);

  // The typing strip.
  await matrixFetch(
    HOMESERVER,
    `/rooms/${encodeURIComponent(world.roomId)}/typing/${encodeURIComponent(world.arabic.userId)}`,
    {
      method: 'PUT',
      accessToken: world.arabic.accessToken,
      body: JSON.stringify({ typing: true, timeout: 60_000 }),
    }
  );
  const strip = page.getByRole('status').filter({ hasText: ARABIC_NAME });
  await expect(strip).toBeVisible({ timeout: 30_000 });
  expect(await latinLetterOnLeft(strip), 'typing strip').toBe(true);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: join(SHOTS, `thread-${engine}-${language}.png`) });
  }

  // The approval review's "Requested by".
  await page
    .getByRole('button', { name: language === 'ar' ? /^مراجعة/ : /^Review 1/ })
    .click({ timeout: 30_000 });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(ARABIC_NAME);
  expect(await latinLetterOnLeft(dialog), 'requested by').toBe(true);
  if (SHOTS) await page.screenshot({ path: join(SHOTS, `review-${engine}-${language}.png`) });
  await context.close();
};

for (const language of ['en', 'ar'] as const) {
  test(`mixed-direction names and messages keep one order and their own side, Chromium ${language}`, async ({
    browser,
    baseURL,
  }) => {
    test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    await check(browser, 'chromium', language, baseURL);
  });

  test(`mixed-direction names and messages keep one order and their own side, WebKit ${language}`, async ({
    baseURL,
  }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE not set');
    test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    const browser = await launchWebKit();
    try {
      await check(browser, 'webkit', language, baseURL);
    } finally {
      await browser.close();
    }
  });
}
