import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, matrixFetch, sendRoomMessage } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// The room mounts a window of 200 rows; opening a message puts the window's first row 200 rows
// above it. When the window starts right after an event the timeline draws no row for (here an
// event of an unknown type, kept in the list by the developer setting showHiddenEvents) and that
// event is already unread, the window's first row is still the first unread row with output, so
// the "New messages" line goes above it. Set E2E_SCREENSHOT_DIR to save the window's top.

const PASSWORD = 'unread-line-window-start-password';
const RUN = Date.now().toString(36);
const SCREENSHOT = process.env.E2E_SCREENSHOT_DIR;
const ENTRIES = 230;
const WINDOW = 200;

test.use({ viewport: { width: 1280, height: 900 } });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** The window's first row (`data-room-row-index` 0) once mounted: its message and its separators. */
const windowTop = (page: Page) =>
  page.evaluate(() => {
    const tile = document.querySelector('[data-room-row-index="0"]');
    if (!tile) return undefined;
    return {
      message: tile.querySelector('[data-message-id]')?.getAttribute('data-message-id') ?? null,
      separators: Array.from(tile.querySelectorAll('[role="separator"]')).map(
        (node) => node.textContent ?? ''
      ),
    };
  });

test('the first row of a window that starts after an unread event without a row gets the unread line', async ({
  page,
}) => {
  test.setTimeout(300_000);
  const reader = await registerDisposableUser(`ulws_r_${RUN}`, PASSWORD);
  const writer = await registerDisposableUser(`ulws_w_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Window Start',
    invite: [writer.userId],
  });
  await joinRoom(HOMESERVER, writer.accessToken, roomId);
  const send = (accessToken: string, content: Record<string, unknown>, type?: string) =>
    type
      ? matrixFetch<{ event_id: string }>(
          HOMESERVER,
          `/rooms/${encodeURIComponent(roomId)}/send/${type}/ulws-${Date.now()}-${Math.random()}`,
          { method: 'PUT', accessToken, body: JSON.stringify(content) }
        ).then(({ event_id: id }) => id)
      : sendRoomMessage(HOMESERVER, accessToken, roomId, content, 'ulws');

  let lastRead = '';
  for (let index = 0; index < 3; index += 1) {
    lastRead = await send(reader.accessToken, { msgtype: 'm.text', body: `Read ${index}` });
  }
  await matrixFetch(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/read_markers`, {
    method: 'POST',
    accessToken: reader.accessToken,
    body: JSON.stringify({ 'm.fully_read': lastRead, 'm.read': lastRead }),
  });
  await send(writer.accessToken, { body: 'A poll' }, 'org.example.poll');
  const entries: string[] = [];
  for (let index = 0; index < ENTRIES; index += 1) {
    entries.push(await send(writer.accessToken, { msgtype: 'm.text', body: `Entry ${index}` }));
  }

  await page.addInitScript(() => {
    const stored = JSON.parse(localStorage.getItem('settings') ?? '{}') as Record<string, unknown>;
    localStorage.setItem('settings', JSON.stringify({ ...stored, showHiddenEvents: true }));
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  // The Classic view, oldest row first: the Compact and Threads views put the newest first and
  // draw no line.
  await page.evaluate((room) => {
    const store = JSON.parse(localStorage.getItem('mindroom_multi_account_store') ?? '{}') as {
      activeSessionId?: string;
    };
    localStorage.setItem(
      `roomViewMode:${store.activeSessionId}:${room}`,
      JSON.stringify('classic')
    );
  }, roomId);

  // Open the message 200 rows below the first one after the poll: the window starts there.
  await page.goto(`/home/${encodeURIComponent(roomId)}/${encodeURIComponent(entries[WINDOW]!)}/`);
  await expect(page.locator(`[data-message-id="${entries[WINDOW]}"]`).first()).toBeVisible({
    timeout: 60_000,
  });
  // Scroll up a step at a time until the window's first row mounts.
  let top = await windowTop(page);
  for (let step = 0; step < 200 && !top; step += 1) {
    await page.evaluate(() => {
      let element = document.querySelector<HTMLElement>('[data-room-row-index]')?.parentElement;
      while (element && !/auto|scroll/.test(getComputedStyle(element).overflowY)) {
        element = element.parentElement;
      }
      element?.scrollBy(0, -400);
    });
    await page.waitForTimeout(50);
    top = await windowTop(page);
  }
  if (SCREENSHOT) await page.screenshot({ path: `${SCREENSHOT}/unread-line-window-start.png` });
  expect(top?.message, 'the window starts right after the poll').toBe(entries[0]);
  expect(top?.separators.join(' ')).toMatch(/new ?messages/i);
});
