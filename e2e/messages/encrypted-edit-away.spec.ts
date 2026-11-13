import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import { buildLoginPath } from '../env';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// An encrypted message that its sender edited while the reader was away, then answered with a
// reply once the edit was well back in the history. The reader's server bundles the edit with
// the message wherever it serves the message alone (the reply's quote, a jump to it), and the
// edit itself is not in the reader's timeline. The reader must see the edited text in the quote
// and in the message's row, before and after a reload, never a blank quote or "Unsupported
// message". An edit whose key the reader never gets leaves the original text shown, with a note
// under it. Against the disposable homeserver of `just hs-up`.
const PASSWORD = 'encrypted-edit-away-spec-password';
/** Messages between the edit and the reply: the reader's /sync timeline (20) ends before the edit. */
const LATER_MESSAGES = 21;
const SHOTS = process.env.ENCRYPTED_EDIT_SHOTS;

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

type Away = {
  roomId: string;
  original: string;
  edited: string;
  answer: string;
  readerContext: BrowserContext;
  /** Signs the writer in without crypto and back out, for a read of the room's events. */
  writerToken: () => Promise<{ token: string; done: () => Promise<unknown> }>;
};

/**
 * The reader and the writer each open the encrypted room once; the reader goes away, and the
 * writer sends a message, edits it, sends LATER_MESSAGES more and then a reply to it.
 */
const writeWhileAway = async (
  writerBrowser: Browser,
  readerBrowser: Browser,
  label: string,
  run: (away: Away) => Promise<void>,
  readerOptions: BrowserContextOptions = {}
) => {
  const id = `${Date.now().toString(36)}${label}`;
  const reader = `away_a_${id}`;
  const writer = `away_b_${id}`;
  const roomId = await encryptedRoom(reader, writer);
  const original = `Edit target ${id}`;
  const edited = `Edit target ${id} changed while away`;
  const answer = `Answer to the edit ${id}`;
  const viewport = { width: 1280, height: 800 };
  const baseURL = test.info().project.use.baseURL;
  const readerContext = await readerBrowser.newContext({ viewport, baseURL, ...readerOptions });
  const writerContext = await writerBrowser.newContext({ viewport, baseURL });
  try {
    // Both have the room open once, so each holds the other's device keys.
    const readerPage = await signedIn(readerContext, reader);
    await openFullRoom(readerPage, roomId);
    const writerPage = await signedIn(writerContext, writer);
    await openFullRoom(writerPage, roomId);
    await send(writerPage, `Hello ${id}`);
    await expect(rowWith(readerPage, `Hello ${id}`)).toBeVisible({ timeout: 30_000 });

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
      await send(writerPage, `Later ${index} ${id}`);
    }
    const target = rowWith(writerPage, edited);
    await target.scrollIntoViewIfNeeded();
    await target.hover();
    await target.getByRole('button', { name: 'Reply', exact: true }).click();
    await send(writerPage, answer);

    const writerToken = async () => {
      const { access_token: token } = await call<{ access_token: string }>('/login', undefined, {
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: writer },
        password: PASSWORD,
      });
      return { token, done: () => call('/logout', token, {}) };
    };
    await run({ roomId, original, edited, answer, readerContext, writerToken });
  } finally {
    // A /sync held open by a route must not fail the test when the context closes.
    await readerContext.unrouteAll({ behavior: 'ignoreErrors' });
    await readerContext.close();
    await writerContext.close();
  }
};

/** The reply's quote of the edited message, in the reader's timeline. */
const quoteIn = (page: Page, answer: string) =>
  rowWith(page, answer).locator('button[data-event-id]');

const readEditedWhileAway = (writerBrowser: Browser, readerBrowser: Browser, label: string) =>
  writeWhileAway(writerBrowser, readerBrowser, label, async (away) => {
    // The reader comes back: the reply is new, the edited message is history.
    const back = await away.readerContext.newPage();
    const readQuoteAndJump = async (step: string) => {
      await openFullRoom(back, away.roomId);
      const quote = quoteIn(back, away.answer);
      await expect(quote).toContainText(away.edited, { timeout: 30_000 });
      if (SHOTS) await back.screenshot({ path: `${SHOTS}/F025-${label}-${step}-quote.png` });
      await quote.click();
      const row = rowWith(back, away.original).first();
      await expect(row).toContainText(away.edited, { timeout: 30_000 });
      await expect(row).not.toContainText('Unsupported message');
      await expect(row.locator('[data-edit-not-decrypted]')).toHaveCount(0);
      if (SHOTS) await back.screenshot({ path: `${SHOTS}/F025-${label}-${step}-row.png` });
    };
    await readQuoteAndJump('back');

    // A reload rebuilds the timeline from the stores and the server.
    await back.reload();
    await readQuoteAndJump('reloaded');
  });

/**
 * Gives the edit, wherever the server sends it to the reader (alone or bundled with its
 * message), a Megolm session nobody has, so the reader can never decrypt it.
 */
const withholdEditKey = async (context: BrowserContext, editId: string) => {
  const rewrite = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(rewrite);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const content = record.content as Record<string, unknown> | undefined;
    if (record.event_id === editId && content && 'session_id' in content) {
      content.session_id = 'withheld-session-of-this-spec';
    }
    Object.values(record).forEach(rewrite);
  };
  await context.route(`${HOMESERVER}/_matrix/client/**`, async (route) => {
    // No timeout of its own: /sync holds its request open for up to 30 s.
    const response = await route.fetch({ timeout: 0 });
    const text = await response.text();
    if (!text.includes(editId)) {
      await route.fulfill({ response, body: text });
      return;
    }
    const json: unknown = JSON.parse(text);
    rewrite(json);
    await route.fulfill({ response, json });
  });
};

const readUndecryptableEdit = (writerBrowser: Browser, readerBrowser: Browser, label: string) =>
  writeWhileAway(
    writerBrowser,
    readerBrowser,
    label,
    async (away) => {
      const { token, done } = await away.writerToken();
      const { chunk } = await call<{
        chunk: Array<{ event_id: string; content: { 'm.relates_to'?: { rel_type?: string } } }>;
      }>(`/rooms/${encodeURIComponent(away.roomId)}/messages?dir=b&limit=60`, token);
      await done();
      const editId = chunk.find(
        (event) => event.content['m.relates_to']?.rel_type === 'm.replace'
      )?.event_id;
      expect(editId).toBeTruthy();
      await withholdEditKey(away.readerContext, editId ?? '');

      const back = await away.readerContext.newPage();
      await openFullRoom(back, away.roomId);
      const quote = quoteIn(back, away.answer);
      await expect(quote).toContainText(away.original, { timeout: 30_000 });
      await expect(quote).not.toContainText(away.edited);
      await quote.click();
      const row = rowWith(back, away.original).first();
      await expect(row.locator('[data-edit-not-decrypted]')).toHaveText(
        "A newer edit couldn't be decrypted",
        { timeout: 30_000 }
      );
      await expect(row).not.toContainText(away.edited);
      await expect(row).not.toContainText('Unsupported message');
      if (SHOTS) await back.screenshot({ path: `${SHOTS}/F025-${label}-note-desktop.png` });
      await back.setViewportSize({ width: 390, height: 844 });
      await row.scrollIntoViewIfNeeded();
      const note = row.locator('[data-edit-not-decrypted]');
      await expect(note).toBeVisible();
      const box = await note.boundingBox();
      expect(box && box.x + box.width).toBeLessThanOrEqual(390);
      if (SHOTS) await back.screenshot({ path: `${SHOTS}/F025-${label}-note-phone.png` });
    },
    // WebKit sends a service worker's requests past routes, and the edit must not get through.
    { serviceWorkers: 'block' }
  );

/**
 * Gives every edit sent from now on a Megolm session nobody has, wherever the server sends it to
 * the reader (alone or bundled with its message), so the reader can never decrypt it. Edits sent
 * before keep their keys, also when a reload brings them again.
 */
const withholdNewEditKeys = async (context: BrowserContext) => {
  const since = Date.now();
  const rewrite = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(rewrite);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const record = value as Record<string, unknown>;
    const content = record.content as Record<string, unknown> | undefined;
    const relation = content?.['m.relates_to'] as { rel_type?: string } | undefined;
    const sentLater =
      typeof record.origin_server_ts === 'number' && record.origin_server_ts >= since;
    if (relation?.rel_type === 'm.replace' && sentLater && content && 'session_id' in content) {
      content.session_id = 'withheld-session-of-this-spec';
    }
    Object.values(record).forEach(rewrite);
  };
  await context.route(`${HOMESERVER}/_matrix/client/**`, async (route) => {
    const response = await route.fetch({ timeout: 0 });
    const text = await response.text();
    if (!text.includes('m.replace')) {
      await route.fulfill({ response, body: text });
      return;
    }
    const json: unknown = JSON.parse(text);
    rewrite(json);
    await route.fulfill({ response, json });
  });
};

/**
 * Regression (P2-e2ee-F006, P2-e2ee-F008): a message edited once, then edited again with an edit
 * the reader cannot decrypt, while the reader has the room open. The row kept the readable edit
 * but showed the note on the newer one only after a reload, and the room's pinned messages
 * showed the message as first sent.
 */
const watchUndecryptableEdit = async (
  readerBrowser: Browser,
  writerBrowser: Browser,
  label: string
) => {
  const id = `${Date.now().toString(36)}${label}`;
  const reader = `live_a_${id}`;
  const writer = `live_b_${id}`;
  const roomId = await encryptedRoom(reader, writer);
  const original = `Pinned target ${id}`;
  const edited = `Pinned target ${id} first edit`;
  const unreadable = `Pinned target ${id} second edit`;
  const viewport = { width: 1280, height: 800 };
  const baseURL = test.info().project.use.baseURL;
  const readerContext = await readerBrowser.newContext({
    viewport,
    baseURL,
    serviceWorkers: 'block',
  });
  const writerContext = await writerBrowser.newContext({ viewport, baseURL });
  const edit = async (page: Page, from: string, to: string) => {
    const composer = page.locator('[data-editable-name="RoomInput"]');
    await composer.press('ArrowUp');
    const editBox = page.locator('[contenteditable="true"]').filter({ hasText: from });
    await expect(editBox).toBeFocused();
    await editBox.press('ControlOrMeta+a');
    await page.keyboard.insertText(to);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(rowWith(page, to)).toBeVisible();
  };
  try {
    const readerPage = await signedIn(readerContext, reader);
    await openFullRoom(readerPage, roomId);
    const writerPage = await signedIn(writerContext, writer);
    await openFullRoom(writerPage, roomId);
    await send(writerPage, original);
    await edit(writerPage, original, edited);
    const row = rowWith(readerPage, edited).first();
    await expect(row).toBeVisible({ timeout: 30_000 });

    await withholdNewEditKeys(readerContext);
    // The reader's /sync that is open already escapes the route: the writer's typing ends it, and
    // the next one goes through the route.
    const routedSync = readerPage.waitForRequest((request) => request.url().includes('/sync?'));
    const composer = writerPage.locator('[data-editable-name="RoomInput"]');
    await composer.click();
    await writerPage.keyboard.insertText('x');
    await routedSync;
    await composer.press('Backspace');
    await edit(writerPage, edited, unreadable);
    // The row keeps the edit it can read and says at once that a newer one could not be read.
    await expect(row.locator('[data-edit-not-decrypted]')).toHaveText(
      "A newer edit couldn't be decrypted",
      { timeout: 20_000 }
    );
    await expect(row).not.toContainText(unreadable);
    if (SHOTS) await readerPage.screenshot({ path: `${SHOTS}/F006-${label}-live-note.png` });

    // The reader pins the message: the pin shows what the row shows.
    const eventId = await row.getAttribute('data-message-id');
    const { access_token: token } = await call<{ access_token: string }>('/login', undefined, {
      type: 'm.login.password',
      identifier: { type: 'm.id.user', user: reader },
      password: PASSWORD,
    });
    const pinned = await fetch(
      `${HOMESERVER}/_matrix/client/v3/rooms/${encodeURIComponent(
        roomId
      )}/state/m.room.pinned_events/`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ pinned: [eventId] }),
      }
    );
    expect(pinned.ok).toBe(true);
    await call('/logout', token, {});
    // After a reload the server's copy of the message bundles its newest edit, the unreadable one.
    await readerPage.reload();
    await expect(row).toBeVisible({ timeout: 60_000 });
    await readerPage.getByRole('button', { name: 'Pinned Messages', exact: true }).click();
    const pins = readerPage.getByRole('dialog', { name: 'Pinned Messages', exact: true });
    await expect(pins.getByText(edited)).toBeVisible({ timeout: 30_000 });
    await expect(pins.getByText(original, { exact: true })).toHaveCount(0);
    if (SHOTS) await readerPage.screenshot({ path: `${SHOTS}/F008-${label}-pins.png` });
  } finally {
    await readerContext.unrouteAll({ behavior: 'ignoreErrors' });
    await readerContext.close();
    await writerContext.close();
  }
};

test.describe('an encrypted message edited while the reader was away', () => {
  test.beforeEach(async () => {
    test.skip(
      !(await disposableHomeserverIsUp()),
      `No homeserver at ${HOMESERVER}; run \`just hs-up\``
    );
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

  test('keeps the original with a note when the edit cannot be decrypted (Chromium)', async ({
    browser,
  }) => {
    await readUndecryptableEdit(browser, browser, 'chromium');
  });

  test('keeps the original with a note when the edit cannot be decrypted (WebKit)', async ({
    browser,
  }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    const webkit = await launchWebKit();
    try {
      await readUndecryptableEdit(browser, webkit, 'webkit');
    } finally {
      await webkit.close();
    }
  });
});

test.describe('an encrypted message edited while the reader watches', () => {
  test.beforeEach(async () => {
    test.skip(
      !(await disposableHomeserverIsUp()),
      `No homeserver at ${HOMESERVER}; run \`just hs-up\``
    );
    test.setTimeout(360_000);
  });

  test('notes an edit it cannot decrypt at once and pins the readable text (Chromium)', async ({
    browser,
  }) => {
    await watchUndecryptableEdit(browser, browser, 'chromium');
  });

  test('notes an edit it cannot decrypt at once and pins the readable text (WebKit)', async ({
    browser,
  }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    const webkit = await launchWebKit();
    try {
      await watchUndecryptableEdit(webkit, browser, 'webkit');
    } finally {
      await webkit.close();
    }
  });
});
