import { devices, expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';

// Jump to Time from an open thread stays in the thread: the room's beginning, which comes before
// the thread began, shows the thread's first message, and a time after its newest reply shows
// that reply, with the thread still open. The thread is longer than the client loads at once, so
// its start has to come from the server. Runs against the disposable homeserver of `just hs-up`
// (or a slot of scripts/e2e-slot.sh), on a desktop and on a phone.

test.use({
  launchOptions: {
    // Scrollbars shown, as on Linux and Windows. The other options repeat playwright.config.ts.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: ['--disable-features=IsolateSandboxedIframes'],
    ignoreDefaultArgs: ['--hide-scrollbars'],
  },
});
test.describe.configure({ timeout: 360_000 });

const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'jump-to-time-thread-password';
const RUN = Date.now().toString(36);
const ROOT = 'Crane schedule for the north quay this week';
const REPLIES = 120;

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

const register = async (username: string): Promise<string> => {
  const body = await matrixFetch<{ access_token: string }>(HOMESERVER, '/register', {
    method: 'POST',
    body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
  });
  return body.access_token;
};

/** A room with one long thread; returns the room and the thread's root. */
const seedThread = async (token: string) => {
  const roomId = await createPrivateRoom(HOMESERVER, token, {
    name: 'Harbour operations',
    topic: 'Crane and berth planning',
  });
  await sendRoomMessage(HOMESERVER, token, roomId, {
    msgtype: 'm.text',
    body: 'Welcome to harbour operations.',
  });
  const rootId = await sendRoomMessage(HOMESERVER, token, roomId, {
    msgtype: 'm.text',
    body: ROOT,
  });
  for (let index = 0; index < REPLIES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, token, roomId, {
      msgtype: 'm.text',
      body: `Shift ${index}: crane ${1 + (index % 4)} moves ${20 + index} containers before noon.`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }
  return { roomId, rootId };
};

const runJumps = async (
  page: Page,
  phone: boolean,
  username: string,
  outputPath: (name: string) => string
) => {
  const token = await register(username);
  const { roomId, rootId } = await seedThread(token);
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  const threadUrl = new RegExp(`threadId=${encodeURIComponent(rootId).replace(/\$/g, '\\$')}`);
  const newest = page.getByText(`Shift ${REPLIES - 1}:`, { exact: false });
  await expect(newest).toBeVisible({ timeout: 60_000 });
  const rootRow = page.locator(`[data-message-id="${rootId}"]`);

  const press = (locator: ReturnType<Page['locator']>) => (phone ? locator.tap() : locator.click());
  const openDialog = async () => {
    await press(page.getByRole('button', { name: 'More Options' }).first());
    await press(page.getByRole('button', { name: 'Jump to Time' }));
    const dialog = page.getByRole('dialog', { name: 'Jump to Time' });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  // The room's beginning comes before the thread: the thread's first message.
  let dialog = await openDialog();
  await press(dialog.getByRole('button', { name: 'Beginning' }));
  await press(dialog.getByRole('button', { name: 'Open Timeline' }));
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(threadUrl);
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible();
  await expect(rootRow).toBeInViewport({ timeout: 60_000 });
  await expect(newest).not.toBeInViewport();
  await page.screenshot({ path: outputPath('jump-thread-beginning.png') });

  // A time after the newest reply: that reply, still in the thread.
  dialog = await openDialog();
  await press(dialog.getByRole('button', { name: 'Today' }));
  // 23:59 today, on a 24-hour clock or as 11 PM.
  const period = dialog.getByRole('combobox', { name: 'Period' });
  const twelveHour = (await period.count()) > 0;
  await dialog.getByRole('combobox', { name: 'Hour' }).selectOption(twelveHour ? '11' : '23');
  if (twelveHour) await period.selectOption('1');
  await dialog.getByRole('combobox', { name: 'Minutes' }).selectOption('59');
  await press(dialog.getByRole('button', { name: 'Open Timeline' }));
  await expect(dialog).toBeHidden();
  await expect(page).toHaveURL(threadUrl);
  await expect(newest).toBeInViewport({ timeout: 60_000 });
  await expect(rootRow).not.toBeInViewport();
  await page.screenshot({ path: outputPath('jump-thread-newest.png') });
};

test('Jump to Time in a thread stays in the thread', async ({ page }, testInfo) => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
  test.skip(new Date().getHours() === 23 && new Date().getMinutes() >= 55, 'Too close to 23:59');
  await page.setViewportSize({ width: 1280, height: 800 });
  await runJumps(page, false, `jump_thread_${RUN}`, (name) => testInfo.outputPath(name));
});

test.describe('on a phone', () => {
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
    userAgent: devices['Pixel 7'].userAgent,
  });

  test('Jump to Time in a thread stays in the thread', async ({ page }, testInfo) => {
    test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
    test.skip(new Date().getHours() === 23 && new Date().getMinutes() >= 55, 'Too close to 23:59');
    await runJumps(page, true, `jump_thread_phone_${RUN}`, (name) => testInfo.outputPath(name));
  });
});
