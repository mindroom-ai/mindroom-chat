import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { buildLoginPath } from '../env';

// An encrypted message that its sender edited while the reader was away, then answered with a
// reply once the edit was well back in the history. The reader's server bundles the edit with
// the message wherever it serves the message alone (the reply's quote, a jump to it), and the
// edit itself is not in the reader's timeline. The reader must see the edited text in the quote
// and in the message's row, before and after a reload, never a blank quote or "Unsupported
// message". Against the disposable homeserver of `just hs-up`.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'encrypted-edit-away-spec-password';
/** Messages between the edit and the reply: the reader's /sync timeline (20) ends before the edit. */
const LATER_MESSAGES = 21;
const SHOTS = process.env.ENCRYPTED_EDIT_SHOTS;

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

const call = async <T>(path: string, token?: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.ok, `${path} answered ${response.status}`).toBe(true);
  return (await response.json()) as T;
};

const registered = async (username: string) => {
  const { access_token: token } = await call<{ access_token: string }>('/register', undefined, {
    username,
    password: PASSWORD,
    auth: { type: 'm.login.dummy' },
  });
  return token;
};

/**
 * An encrypted room of the reader's with the writer in it, set up over sessions without crypto
 * that sign out again, so the only devices are the browser sessions this spec starts.
 */
const encryptedRoom = async (reader: string, writer: string): Promise<string> => {
  const readerToken = await registered(reader);
  const writerToken = await registered(writer);
  const { user_id: writerId } = await call<{ user_id: string }>('/account/whoami', writerToken);
  const { room_id: roomId } = await call<{ room_id: string }>('/createRoom', readerToken, {
    name: 'Edited While Away',
    preset: 'private_chat',
    invite: [writerId],
    initial_state: [
      { type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
    ],
  });
  await call(`/join/${encodeURIComponent(roomId)}`, writerToken, {});
  await call('/logout', readerToken, {});
  await call('/logout', writerToken, {});
  return roomId;
};

const signedIn = async (context: BrowserContext, username: string): Promise<Page> => {
  const page = await context.newPage();
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 90_000 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return page;
};

/** Opens the room in the Full view, where each message is its own row. */
const openFullRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const viewSwitch = page.locator('[data-room-view-switch]');
  await expect(viewSwitch).toBeVisible({ timeout: 60_000 });
  if ((await viewSwitch.getAttribute('aria-pressed')) === 'true') await viewSwitch.click();
  await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible();
};

const rowWith = (page: Page, text: string) =>
  page.locator('[data-message-id^="$"]').filter({ hasText: text });

const send = async (page: Page, text: string) => {
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await composer.click();
  await page.keyboard.insertText(text);
  await page.keyboard.press('Enter');
  await expect(rowWith(page, text)).toBeVisible({ timeout: 30_000 });
};

const readEditedWhileAway = async (browser: Browser, readerBrowser: Browser, label: string) => {
  const run = `${Date.now().toString(36)}${label}`;
  const reader = `away_a_${run}`;
  const writer = `away_b_${run}`;
  const roomId = await encryptedRoom(reader, writer);
  const original = `Edit target ${run}`;
  const edited = `Edit target ${run} changed while away`;
  const viewport = { width: 1280, height: 800 };
  const baseURL = test.info().project.use.baseURL;
  const readerContext = await readerBrowser.newContext({ viewport, baseURL });
  const writerContext = await browser.newContext({ viewport, baseURL });
  try {
    // Both have the room open once, so each holds the other's device keys.
    const readerPage = await signedIn(readerContext, reader);
    await openFullRoom(readerPage, roomId);
    const writerPage = await signedIn(writerContext, writer);
    await openFullRoom(writerPage, roomId);
    await send(writerPage, `Hello ${run}`);
    await expect(rowWith(readerPage, `Hello ${run}`)).toBeVisible({ timeout: 30_000 });

    // The reader goes away; the browser keeps the session and its stores.
    await readerPage.close();

    await send(writerPage, original);
    const composer = writerPage.locator('[data-editable-name="RoomInput"]');
    await composer.press('ArrowUp');
    const editBox = writerPage.locator('[contenteditable="true"]').filter({ hasText: original });
    await expect(editBox).toBeFocused();
    await editBox.press('ControlOrMeta+a');
    await writerPage.keyboard.insertText(edited);
    await writerPage.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(rowWith(writerPage, edited)).toBeVisible();
    for (let index = 1; index <= LATER_MESSAGES; index += 1) {
      // eslint-disable-next-line no-await-in-loop
      await send(writerPage, `Later ${index} ${run}`);
    }
    const target = rowWith(writerPage, edited);
    await target.scrollIntoViewIfNeeded();
    await target.hover();
    await target.getByRole('button', { name: 'Reply', exact: true }).click();
    const answer = `Answer to the edit ${run}`;
    await send(writerPage, answer);

    // The reader comes back: the reply is new, the edited message is history.
    const back = await readerContext.newPage();
    const readQuoteAndJump = async (step: string) => {
      await openFullRoom(back, roomId);
      const quote = rowWith(back, answer).locator('button[data-event-id]');
      await expect(quote).toContainText(edited, { timeout: 30_000 });
      if (SHOTS) await back.screenshot({ path: `${SHOTS}/F025-${label}-${step}-quote.png` });
      await quote.click();
      const row = rowWith(back, original).first();
      await expect(row).toContainText(edited, { timeout: 30_000 });
      await expect(row).not.toContainText('Unsupported message');
      await expect(row.locator('[data-edit-not-decrypted]')).toHaveCount(0);
      if (SHOTS) await back.screenshot({ path: `${SHOTS}/F025-${label}-${step}-row.png` });
    };
    await readQuoteAndJump('back');

    // A reload rebuilds the timeline from the stores and the server.
    await back.reload();
    await readQuoteAndJump('reloaded');
  } finally {
    await readerContext.close();
    await writerContext.close();
  }
};

test.describe('an encrypted message edited while the reader was away', () => {
  test.beforeEach(async () => {
    test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
    test.setTimeout(360_000);
  });

  test('shows the edited text (Chromium)', async ({ browser }) => {
    await readEditedWhileAway(browser, browser, 'chromium');
  });

  test('shows the edited text (WebKit)', async ({ browser }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    const webkit = await launchWebKit();
    try {
      await readEditedWhileAway(browser, webkit, 'webkit');
    } finally {
      await webkit.close();
    }
  });
});
