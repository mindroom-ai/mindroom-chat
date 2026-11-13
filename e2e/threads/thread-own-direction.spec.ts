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

// A thread's title, its preview and the banner's summary are text people and agents wrote, so in
// a right-to-left interface an English line keeps its own direction: it is cut at its end, not
// at its start, and a closing question mark stays at its end. A card's title and preview line
// up with their own start, so a wrapped English title's lines all start at the left. The [+all]
// toggle of the room's Threads view reads as written, and so does an approval card's tool
// identifier. Checked on a phone and a desktop, in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const PASSWORD = 'thread-own-direction-spec-password';
const RUN = Date.now().toString(36);
// A directory for a screenshot of the cards, when set.
const SHOTS = process.env.THREAD_DIRECTION_SHOTS;
const TITLE =
  'Why does the nightly export job time out on large workspaces since the storage migration?';
const REPLY =
  'Checking the export worker logs first, then the object listing calls against the new bucket layout and its pagination.';
const SUMMARY =
  'Do nightly exports time out on workspaces over 40k files because of unbatched object listing?';

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
  const username = `tod_${name}_${RUN}`;
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

/** A room with an agent, so it opens as Compact cards, and one thread with a summary. */
const seed = async (engine: string) => {
  const reader = await registerAndLogin(`reader_${engine}`);
  const agent = await registerAgentAccount(HOMESERVER, `export_${engine}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Data platform',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: TITLE,
  });
  const relation = {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  };
  // The card's preview shows the latest reply, so the approval comes first.
  const now = Date.now();
  const approvalId = `approval-${RUN}-${engine}`;
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
        agent_name: 'export',
        status: 'pending',
        approvable: true,
        approver_user_id: reader.userId,
        requester_id: reader.userId,
        approval_scope: {
          id: 'shell',
          entity_name: 'export',
          invoking_agent: 'export',
          operation: { tool_name: 'run_shell_command' },
        },
        arguments: { command: 'ls exports' },
        requested_at: new Date(now - 60_000).toISOString(),
        expires_at: new Date(now + 3_600_000).toISOString(),
        thread_id: rootId,
        'm.relates_to': relation,
      }),
    }
  );
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: REPLY,
    'io.mindroom.stream_status': 'completed',
    'm.relates_to': relation,
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.notice',
    body: SUMMARY,
    'io.mindroom.thread_summary': {
      version: 1,
      summary: SUMMARY,
      message_count: 2,
      generated_at: new Date().toISOString(),
      model: 'test',
    },
    'm.relates_to': relation,
  });
  return { reader, roomId, rootId };
};

type Placement = {
  direction: string;
  firstCharInside: boolean;
  lastCharAtEnd: boolean;
};

/**
 * Where a line's text sits: its direction, whether its first character shows inside the box
 * (a line cut at its start hides it), and whether its last character is its rightmost one.
 */
const placement = (line: Locator): Promise<Placement> =>
  line.evaluate((element) => {
    const text = element.firstChild?.nodeType === Node.TEXT_NODE ? element.firstChild : null;
    if (!text?.textContent) throw new Error('The line has no text of its own');
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    const charRect = (offset: number) => {
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      return range.getClientRects()[0] ?? range.getBoundingClientRect();
    };
    const first = charRect(0);
    const length = text.textContent.length;
    const last = charRect(length - 1);
    const others = Array.from({ length: length - 1 }, (_, index) => charRect(index));
    const lastLine = others.filter((rect) => Math.abs(rect.top - last.top) < 2);
    return {
      direction: getComputedStyle(element).direction,
      firstCharInside: first.left >= box.left - 1 && first.right <= box.right + 1,
      lastCharAtEnd: lastLine.every((rect) => rect.left < last.left),
    };
  });

/** Whether each visible line of a text starts at its box's left edge (inside its padding). */
const linesStartLeft = (line: Locator): Promise<boolean> =>
  line.evaluate((element) => {
    const text = element.firstChild;
    if (text?.nodeType !== Node.TEXT_NODE || !text.textContent) {
      throw new Error('The line has no text of its own');
    }
    const box = element.getBoundingClientRect();
    const left = box.left + parseFloat(getComputedStyle(element).paddingLeft);
    const range = document.createRange();
    const lineStarts = new Map<number, number>();
    for (let offset = 0; offset < text.textContent.length; offset += 1) {
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      const rect = range.getClientRects()[0];
      // Lines a line clamp hides lie below the box.
      if (!rect || rect.width === 0 || rect.top >= box.bottom - 1) continue;
      const top = Math.round(rect.top);
      lineStarts.set(top, Math.min(lineStarts.get(top) ?? Infinity, rect.left));
    }
    return lineStarts.size > 0 && [...lineStarts.values()].every((start) => start - left < 2);
  });

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
  await page.evaluate(() => localStorage.setItem('i18nextLng', 'ar'));
  await page.goto(`/home/${encodeURIComponent(world.roomId)}`);
  await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');

  const card = page.locator(`[data-thread-root-id="${world.rootId}"]`);
  const title = card.getByText(SUMMARY, { exact: true });
  const preview = card.getByText(/Checking the export worker logs/);
  await expect(title).toBeVisible({ timeout: 30_000 });
  await expect(preview).toBeVisible();
  // The summary is longer than a phone's two title lines and the reply than its preview line.
  expect(await placement(title)).toEqual({
    direction: 'ltr',
    firstCharInside: true,
    lastCharAtEnd: true,
  });
  expect((await placement(preview)).direction).toBe('ltr');
  expect((await placement(preview)).firstCharInside).toBe(true);
  expect(await linesStartLeft(title), "the title's lines start at the left").toBe(true);
  expect(await linesStartLeft(preview), 'the preview starts at the left').toBe(true);
  if (SHOTS) {
    mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({
      path: join(SHOTS, `cards-${engine}-${phone ? 'phone' : 'desktop'}.png`),
    });
  }

  // The fold toggle above the room's rows in its Threads view (the cards and a thread have none)
  // is a token, [+all]: its plus stays before the word.
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('threaded')),
    world.roomId
  );
  await page.goto(`/home/${encodeURIComponent(world.roomId)}`);
  const toggle = page.getByRole('button', { name: 'توسيع كل الرسائل الطويلة' }); // Expand all long messages
  await expect(toggle).toBeVisible();
  const order = await toggle.evaluate((element) => {
    const text = element.firstChild!;
    const range = document.createRange();
    const left = (offset: number) => {
      range.setStart(text, offset);
      range.setEnd(text, offset + 1);
      return range.getBoundingClientRect().left;
    };
    return [0, 1, 2, 5].map(left);
  });
  expect(order, 'the characters of [+all] from left to right').toEqual(
    [...order].sort((a, b) => a - b)
  );

  await page.goto(
    `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(world.rootId)}`
  );
  const summary = page.locator('[data-thread-context-summary]');
  await expect(summary).toHaveText(SUMMARY, { timeout: 30_000 });
  expect(await placement(summary)).toMatchObject({ direction: 'ltr', firstCharInside: true });

  // The approval card names the tool by its identifier too, which keeps its start in view.
  await page.getByRole('button', { name: /^مراجعة/ }).click();
  const toolName = page.getByRole('dialog').getByText('run_shell_command', { exact: true });
  await expect(toolName).toBeVisible();
  expect(await placement(toolName)).toMatchObject({ direction: 'ltr', firstCharInside: true });
  await context.close();
};

for (const phone of [true, false]) {
  const device = phone ? 'phone' : 'desktop';
  test(`an English thread reads left to right in Arabic, Chromium ${device}`, async ({
    browser,
    baseURL,
  }) => {
    test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
    await check(browser, 'chromium', phone, baseURL);
  });

  test(`an English thread reads left to right in Arabic, WebKit ${device}`, async ({ baseURL }) => {
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
