import { devices, expect, test, type Page, type Route } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Jump to Time from an open thread stays in the thread: the room's beginning, which comes before
// the thread began, shows the thread's first message, and a time after its newest reply shows
// that reply, with the thread still open. The thread is longer than the client loads at once, so
// earlier replies need server pagination. Runs against the disposable homeserver of `just hs-up`
// (or a slot of scripts/e2e-slot.sh), on a desktop and on a phone.

// WebKit does not route service-worker fetches, so fault injection must bypass the worker.
test.use({
  serviceWorkers: 'block',
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});
test.describe.configure({ timeout: 360_000 });

const PASSWORD = 'jump-to-time-thread-password';
const RUN = Date.now().toString(36);
const ROOT = 'Crane schedule for the north quay this week';
const REPLIES = 120;

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
  scheme: 'light' | 'dark',
  username: string,
  outputPath: (name: string) => string
) => {
  const token = await register(username);
  const { roomId, rootId } = await seedThread(token);
  for (let index = 0; index < 25; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await createPrivateRoom(HOMESERVER, token, {
      name: `Planning room ${index + 1}`,
      topic: 'Daily logistics planning',
    });
  }
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  await expect(page.locator('html')).toHaveClass(new RegExp(`${scheme}-theme`));
  const threadUrl = new RegExp(`threadId=${encodeURIComponent(rootId).replace(/\$/g, '\\$')}`);
  const newest = page.getByText(`Shift ${REPLIES - 1}:`, { exact: false });
  await expect(newest).toBeVisible({ timeout: 60_000 });
  // Only the explicit time search uses 100-reply pages. Leave SDK loading and navigation live.
  // A silent relation search must not block answers the open thread already knows.
  const lookups: string[] = [];
  const stalled: Route[] = [];
  await page.route(
    (url) =>
      url.pathname.includes('/_matrix/client/') &&
      url.pathname.includes('/relations/') &&
      url.pathname.endsWith('/m.thread') &&
      url.searchParams.get('limit') === '100',
    (route) => {
      lookups.push(new URL(route.request().url()).pathname);
      stalled.push(route);
      // Keep the explicit time lookup silent until this test's cleanup.
    }
  );
  const rootRow = page.locator(`[data-message-id="${rootId}"]`);

  const press = (locator: ReturnType<Page['locator']>) => (phone ? locator.tap() : locator.click());
  const openDialog = async () => {
    await press(page.getByRole('button', { name: 'More Options' }).first());
    await press(page.getByRole('menuitem', { name: 'Jump to Time' }));
    const dialog = page.getByRole('dialog', { name: 'Jump to Time' });
    await expect(dialog).toBeVisible();
    return dialog;
  };

  try {
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
    expect(lookups, 'boundary jumps never query relations').toEqual([]);
  } finally {
    // Release only this test's stalled searches before WebKit closes its context.
    await Promise.all(stalled.map((route) => route.abort().catch(() => undefined)));
  }
};

for (const scheme of ['light', 'dark'] as const) {
  for (const phone of [false, true]) {
    const size = phone ? 'phone' : 'desktop';
    test.describe(`${scheme} ${size}`, () => {
      test.use({
        viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
        deviceScaleFactor: phone ? 3 : 1,
        hasTouch: phone,
        isMobile: phone,
        colorScheme: scheme,
        ...(phone ? { userAgent: devices['Pixel 7'].userAgent } : {}),
      });
      test('Jump to Time in a thread stays in the thread (Chromium)', async ({
        page,
      }, testInfo) => {
        test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
        test.skip(
          new Date().getHours() === 23 && new Date().getMinutes() >= 55,
          'Too close to 23:59'
        );
        await runJumps(
          page,
          phone,
          scheme,
          `jump_thread_chromium_${size}_${scheme}_${RUN}`,
          (name) => testInfo.outputPath(name)
        );
      });
      test('Jump to Time in a thread stays in the thread (WebKit)', async ({
        baseURL,
      }, testInfo) => {
        test.skip(!WEBKIT_EXECUTABLE, 'WebKit runner required');
        test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
        test.skip(
          new Date().getHours() === 23 && new Date().getMinutes() >= 55,
          'Too close to 23:59'
        );
        await onWebKitPage(
          {
            baseURL,
            serviceWorkers: 'block',
            viewport: phone ? { width: 390, height: 844 } : { width: 1280, height: 800 },
            deviceScaleFactor: phone ? 3 : 1,
            hasTouch: phone,
            isMobile: phone,
            colorScheme: scheme,
          },
          async (page) => {
            await runJumps(
              page,
              phone,
              scheme,
              `jump_thread_webkit_${size}_${scheme}_${RUN}`,
              (name) => testInfo.outputPath(name)
            );
          }
        );
      });
    });
  }
}
