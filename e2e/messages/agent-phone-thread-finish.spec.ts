import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Browser, Page } from '@playwright/test';
import {
  type AgentStack,
  composer,
  expect,
  lobbyEvents,
  messageRow,
  openLobby,
  routeClientConfig,
  signIn,
  streamStatus,
  test,
  uniqueWord,
  waitForThreadEvent,
} from '../helpers/agentStack';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

// On a phone, a person starts a thread from the lobby's composer and watches the agent's reply
// finish there. The thread is short while the reply streams; the finished reply (three tool calls
// and the last one's output) is taller than the screen. Once it settles, the view shows the reply's
// end right above the composer, with no Jump to Latest. Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, WebKit; 390 by 844 with touch.
test.describe.configure({ timeout: 300_000 });

test.use({
  launchOptions: {
    // The other launch options repeat playwright.config.ts; scrollbars are shown, as for readers.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});

const PHONE = { width: 390, height: 844 };

/** The composer's box top and the bottom of the reply's row, read now. */
const replyEnd = (page: Page, eventId: string) =>
  page.evaluate((id) => {
    const row = document.querySelector(`[data-message-id="${CSS.escape(id)}"]`);
    const footer = document.querySelector('[data-room-footer]');
    const editable = footer?.querySelector('[data-editable-name="RoomInput"]');
    let box = editable?.parentElement ?? null;
    while (box) {
      const style = getComputedStyle(box);
      if (style.overflow === 'hidden' && style.borderTopLeftRadius !== '0px') break;
      box = box.parentElement;
    }
    return {
      rowBottom: row?.getBoundingClientRect().bottom ?? NaN,
      composerTop: box?.getBoundingClientRect().top ?? NaN,
    };
  }, eventId);

const watchPhoneThreadFinish = async (page: Page, stack: AgentStack, engine: string) => {
  const word = uniqueWord('phonefinish');
  const text = `phone stream #multi ${word}`;
  await openLobby(page, stack);
  await composer(page).tap();
  await page.keyboard.type(text);
  await page.getByRole('button', { name: 'Send message' }).tap();

  let root: { event_id: string } | undefined;
  await expect
    .poll(
      async () => {
        root = (await lobbyEvents(stack)).find(
          (event) => event.sender === stack.tester.userId && event.content.body === text
        );
        return !!root;
      },
      { timeout: 60_000, message: 'waiting for the thread root' }
    )
    .toBe(true);
  const rootId = (root as { event_id: string }).event_id;
  // Sending from the lobby's cards opens the new thread.
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 60_000 });

  const reply = await waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === stack.agents.helper &&
      event.type === 'm.room.message' &&
      streamStatus(event) === 'completed' &&
      /Finished \W*multi/.test(String(event.content.body)),
    { description: "the helper's finished reply", timeout: 150_000 }
  );
  await expect(messageRow(page, reply.event_id)).toContainText('Finished', { timeout: 30_000 });
  // The finish settles: the typing line goes, the thread's AI title arrives.
  await expect(page.locator('[data-room-footer] [role="status"]')).toHaveCount(0, {
    timeout: 30_000,
  });
  await page.waitForTimeout(3_000);

  const end = await replyEnd(page, reply.event_id);
  console.log(`${engine} phone thread finish: ${JSON.stringify(end)}`);
  expect(end.rowBottom, `${engine}: the reply ends above the composer`).toBeLessThanOrEqual(
    end.composerTop + 1
  );
  expect(
    end.composerTop - end.rowBottom,
    `${engine}: the reply's end is right above the composer`
  ).toBeLessThan(120);
  await expect(page.getByRole('button', { name: 'Jump to Latest' })).toBeHidden();
};

test('a reply that finishes taller than a phone thread ends in view (Chromium)', async ({
  browser,
  stack,
  storageState,
  baseURL,
}) => {
  const context = await browser.newContext({
    viewport: PHONE,
    hasTouch: true,
    isMobile: true,
    storageState: typeof storageState === 'string' ? storageState : undefined,
    baseURL,
  });
  try {
    const page = await context.newPage();
    await routeClientConfig(page, stack);
    await watchPhoneThreadFinish(page, stack, 'chromium');
  } finally {
    await context.close();
  }
});

/** WebKit's own signed-in storage, made by the first WebKit test of the stack and reused after it. */
const webKitState = (stack: AgentStack) => join(stack.dir, 'browser-state', 'tester-webkit.json');

test('a reply that finishes taller than a phone thread ends in view (WebKit)', async ({
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  let browser: Browser | undefined;
  try {
    browser = await launchWebKit();
    const state = webKitState(stack);
    const signedIn = existsSync(state);
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
      hasTouch: true,
      baseURL,
      storageState: signedIn ? state : undefined,
    });
    const page = await context.newPage();
    await routeClientConfig(page, stack);
    if (!signedIn) {
      // Signed in at a desktop's width, where the account button that tells it is done shows.
      await signIn(page, stack);
      mkdirSync(dirname(state), { recursive: true });
      await context.storageState({ path: state, indexedDB: true });
    }
    await page.setViewportSize(PHONE);
    await watchPhoneThreadFinish(page, stack, 'webkit');
  } finally {
    await browser?.close();
  }
});
