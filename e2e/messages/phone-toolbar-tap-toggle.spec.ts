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
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// On a phone (390 by 844, touch), a tap on a message toggles its toolbar: the first tap shows it,
// a second tap on the same message's text hides it, and a third shows it again. Before, the row
// kept the focus the first tap gave it, so the toolbar stayed over the message's text. In
// Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit.
const PASSWORD = 'phone-toolbar-tap-toggle-spec-password';
const RUN = Date.now().toString(36);
const REPLY = 'The nightly export finished and wrote twelve files.';

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

/** A thread with a reply from another account, the reply the reader taps. */
const seed = async (engine: string) => {
  const reader = await registerDisposableUser(`pttt_reader_${engine}_${RUN}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `pttt_agent_${engine}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Nightly export',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Did the nightly export run?',
  });
  const replyId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: REPLY,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  return { reader, roomId, rootId, replyId };
};

/** A finger tap at the middle of `target`. */
const tap = async (page: Page, target: Locator) => {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error('nothing to tap');
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  const context = await browser.newContext({ ...PHONE, baseURL });
  try {
    const page = await context.newPage();
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: world.reader.username,
      password: PASSWORD,
    });
    await page.goto(
      `/home/${encodeURIComponent(world.roomId)}?threadId=${encodeURIComponent(world.rootId)}`
    );
    const row = page.locator(`[data-message-id="${world.replyId}"]`).first();
    const text = row.getByText(REPLY, { exact: true });
    await expect(text).toBeVisible({ timeout: 30_000 });
    const toolbar = row.getByRole('button', { name: 'Reply', exact: true });
    await expect(toolbar).toHaveCount(0);

    await tap(page, text);
    await expect(toolbar, 'the toolbar after the first tap').toBeVisible();

    await tap(page, text);
    await expect(toolbar, 'the toolbar after the second tap').toHaveCount(0);

    await tap(page, text);
    await expect(toolbar, 'the toolbar after the third tap').toBeVisible();
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a tap on a message toggles its toolbar on a phone (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(180_000);
  await run(browser, baseURL, 'chromium');
});

test('a tap on a message toggles its toolbar on a phone (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(180_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
