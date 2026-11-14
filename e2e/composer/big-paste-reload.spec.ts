import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { matrixFetch, type MatrixSession } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// A paste too large for a message becomes a "Pasted text" chip that sends as a file. The draft is
// kept across a reload, and so must the pasted text be: after a reload, Enter sends the file with
// the message. When the browser did not keep the text, the chip leaves the draft with a notice,
// and the message never carries a chip without its file. Runs in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit, on a desktop and a phone,
// against the disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh. Set
// BIG_PASTE_SHOTS=<directory> to save screenshots.
const PASSWORD = 'big-paste-reload-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.BIG_PASTE_SHOTS;
const FILLER_ROOMS = 25;
const PREFIX = 'Here is the build log from this morning:';
const LINES = 2_500;
const PASTE_KEY = 'io.mindroom.paste_attachment';
const LOST_NOTICE = 'Pasted text was not kept with this draft. Paste it again before sending.';

test.use({ launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** A build log of 2,500 lines, about 150,000 characters. */
const buildLog = (): string =>
  Array.from(
    { length: LINES },
    (_, index) =>
      `2026-11-06T09:${String(Math.floor(index / 60) % 60).padStart(2, '0')}:${String(
        index % 60
      ).padStart(2, '0')} INFO step ${index + 1}: compiled module ${index % 97} in ${
        (index * 7) % 400
      } ms`
  ).join('\n');

type RoomEvent = { type: string; event_id: string; content: Record<string, unknown> };

const latestEvents = async (session: MatrixSession, roomId: string): Promise<RoomEvent[]> => {
  const page = await matrixFetch<{ chunk: RoomEvent[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=20`,
    { accessToken: session.accessToken }
  );
  return page.chunk.filter((event) => event.type === 'm.room.message');
};

const openRoom = async (page: Page, tag: string) => {
  const writer = await registerDisposableUser(`bpr_${tag}_${RUN}`, PASSWORD);
  await Promise.all(
    Array.from({ length: FILLER_ROOMS }, (_, index) =>
      createRoom(HOMESERVER, writer.accessToken, { name: `Project room ${index + 1} ${RUN}` })
    )
  );
  const roomId = await createRoom(HOMESERVER, writer.accessToken, {
    name: `Log review ${tag} ${RUN}`,
  });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: writer.username,
    password: PASSWORD,
  });
  await page.evaluate(
    (id) => localStorage.setItem(`roomViewMode:${id}`, JSON.stringify('classic')),
    roomId
  );
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });
  return { writer, roomId, composer };
};

/** Types the message's start and pastes the log after it, as the clipboard would. */
const pasteLog = async (page: Page, log: string) => {
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await composer.click();
  await composer.pressSequentially(`${PREFIX} `);
  await composer.evaluate((element, text) => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    element.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
    );
  }, log);
  const chip = composer.locator('[data-editor-inline="paste-marker"]');
  await expect(chip).toHaveCount(1);
  await expect(chip).toContainText(/^mindroom-paste-[a-f0-9]{6}\.txt/);
  return (await chip.innerText()).trim();
};

const shoot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const keptAcrossReload = async (page: Page, tag: string) => {
  const { writer, roomId, composer } = await openRoom(page, tag);
  const log = buildLog();
  const fileName = await pasteLog(page, log);
  // The text is stored in the background; give it a moment as a person would.
  await page.waitForTimeout(1_000);

  await page.reload();
  await expect(composer).toBeVisible({ timeout: 60_000 });
  const chip = composer.locator('[data-editor-inline="paste-marker"]');
  await expect(chip).toHaveText(fileName);
  await expect(composer).toContainText(PREFIX);
  // The file is staged again (its card names it), and no notice asks for it.
  await expect(page.locator(`[title="${fileName}"]`)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(LOST_NOTICE)).toHaveCount(0);
  await expect(page.getByText(/^Not kept with this draft/)).toHaveCount(0);
  await shoot(page, `kept-after-reload-${tag}`);

  await composer.press('Enter');
  await expect(chip).toHaveCount(0);
  // The message and the file with the whole log reach the room.
  const hasFile = async () =>
    (await latestEvents(writer, roomId)).some((event) => PASTE_KEY in event.content);
  await expect.poll(hasFile, { timeout: 30_000 }).toBe(true);
  const events = await latestEvents(writer, roomId);
  const file = events.find((event) => PASTE_KEY in event.content)!;
  expect(file.content.msgtype).toBe('m.file');
  const url = String(file.content.url ?? '');
  const [server, mediaId] = url.replace('mxc://', '').split('/');
  const download = await fetch(
    `${HOMESERVER}/_matrix/client/v1/media/download/${server}/${mediaId}`,
    { headers: { Authorization: `Bearer ${writer.accessToken}` } }
  );
  expect(download.ok).toBe(true);
  expect(await download.text()).toBe(log);
  await shoot(page, `kept-after-send-${tag}`);
};

const lostAcrossReload = async (page: Page, tag: string) => {
  const { writer, roomId, composer } = await openRoom(page, tag);
  await pasteLog(page, buildLog());
  await page.waitForTimeout(1_000);
  // As in a browser that did not keep the text (private window, cleared site data).
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const request = indexedDB.deleteDatabase('mindroom-paste-drafts');
        request.onsuccess = () => resolve();
        request.onerror = () => resolve();
        request.onblocked = () => resolve();
      })
  );

  await page.reload();
  await expect(composer).toBeVisible({ timeout: 60_000 });
  await expect(composer).toContainText(PREFIX);
  await expect(page.getByText(LOST_NOTICE)).toBeVisible({ timeout: 20_000 });
  await expect(composer.locator('[data-editor-inline="paste-marker"]')).toHaveCount(0);
  await shoot(page, `lost-after-reload-${tag}`);

  await composer.press('Enter');
  await expect
    .poll(async () => (await latestEvents(writer, roomId)).length, { timeout: 30_000 })
    .toBe(1);
  const [sent] = await latestEvents(writer, roomId);
  expect(String(sent!.content.body)).toContain(PREFIX);
  expect(String(sent!.content.body)).not.toContain('mindroom-paste');
  expect(PASTE_KEY in sent!.content).toBe(false);
};

const inContext = async (
  browser: Browser,
  options: BrowserContextOptions,
  run: (page: Page) => Promise<void>
) => {
  const context = await browser.newContext(options);
  try {
    await run(await context.newPage());
  } finally {
    await context.close();
  }
};

const withWebKit = async (run: (browser: Browser) => Promise<void>) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  const browser = await launchWebKit();
  try {
    await run(browser);
  } finally {
    await browser.close();
  }
};

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

const KEPT = 'a large paste in a draft is sent with its file after a reload';
const LOST = 'a large paste the browser did not keep leaves the draft with a notice';

test(`${KEPT} (Chromium, desktop)`, async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  await inContext(browser, { ...DESKTOP, baseURL }, (page) => keptAcrossReload(page, 'kcd'));
});

test(`${KEPT} (WebKit, desktop)`, async ({ baseURL }) => {
  test.setTimeout(150_000);
  await withWebKit((browser) =>
    inContext(browser, { viewport: { width: 1440, height: 900 }, baseURL }, (page) =>
      keptAcrossReload(page, 'kwd')
    )
  );
});

test(`${KEPT} (WebKit, phone)`, async ({ baseURL }) => {
  test.setTimeout(150_000);
  await withWebKit((browser) =>
    inContext(browser, { ...PHONE, baseURL }, (page) => keptAcrossReload(page, 'kwp'))
  );
});

test(`${LOST} (Chromium, desktop)`, async ({ browser, baseURL }) => {
  test.setTimeout(150_000);
  await inContext(browser, { ...DESKTOP, baseURL }, (page) => lostAcrossReload(page, 'lcd'));
});

test(`${LOST} (WebKit, phone)`, async ({ baseURL }) => {
  test.setTimeout(150_000);
  await withWebKit((browser) =>
    inContext(browser, { ...PHONE, baseURL }, (page) => lostAcrossReload(page, 'lwp'))
  );
});
