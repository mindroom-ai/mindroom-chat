import { mkdirSync } from 'node:fs';
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
import {
  createDefaultThreadFilterState,
  joinRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Bidirectional controls (U+202A to U+202E, U+2066 to U+2069, U+200E, U+200F, U+061C) in a file's
// name change the order it shows in: `scan<U+202E>gpj.exe` reads as `scanexe.jpg`. Wherever the
// app names an attachment, each control shows as its code point instead: a picture's tooltip,
// alternative text and viewer, a video's tooltip and its thumbnail, a file's Open and Download
// buttons and its viewer, a staged upload's card, and the notice naming staged files a reload
// could not keep. A caption is message text and shows its controls too. Against the disposable
// homeserver of a slot, on a phone (390 by 844, touch) and a desktop (1280 by 800), in Chromium
// and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set
// DIRECTION_FILES_SHOTS=<directory> to save each view.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'direction-files-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.DIRECTION_FILES_SHOTS;
const ROOM_NAME = 'Receipts Desk';
const FILLER_ROOMS = 24;
const HISTORY = 16;

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };

const CONTROL = /[؜‎‏‪-‮⁦-⁩]/;

const IMAGE_NAME = 'scan‮gpj.exe';
const IMAGE_NAME_SHOWN = 'scan<U+202E>gpj.exe';
const CAPTION = 'Receipt for ‮hcram‬ lunch';
const CAPTION_SHOWN = 'Receipt for <U+202E>hcram<U+202C> lunch';
const VIDEO_NAME = 'walkthrough‮4pm.exe';
const VIDEO_NAME_SHOWN = 'walkthrough<U+202E>4pm.exe';
const STILL_NAME = 'site-visit⁧vom.scr';
const STILL_NAME_SHOWN = 'site-visit<U+2067>vom.scr';
const TEXT_NAME = 'notes‮txt.exe';
const TEXT_NAME_SHOWN = 'notes<U+202E>txt.exe';
const UPLOAD_NAME = 'budget‮slx.bat';
const UPLOAD_NAME_SHOWN = 'budget<U+202E>slx.bat';

// A 1 by 1 PNG.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

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

type Account = MatrixSession & { username: string };

const registerAndLogin = async (name: string): Promise<Account> => {
  const username = `bidifiles_${name}_${RUN}`;
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

const upload = async (accessToken: string, body: Buffer, type: string): Promise<string> => {
  const response = await fetch(`${HOMESERVER}/_matrix/media/v3/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': type },
    body,
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { content_uri: string }).content_uri;
};

type World = {
  reader: Account;
  roomId: string;
  imageId: string;
  videoId: string;
  stillId: string;
  textId: string;
};

/**
 * Two people in a room among 24 others, a few lines of talk, then the member's attachments: a
 * picture with a caption, a video, a video whose file is gone but whose thumbnail is there, and a
 * text file, each named with direction controls.
 */
const seed = async (engine: string): Promise<World> => {
  const reader = await registerAndLogin(`reader_${engine}`);
  const member = await registerAndLogin(`member_${engine}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: ROOM_NAME,
    invite: [member.userId],
  });
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  for (let index = 1; index <= FILLER_ROOMS; index += 1)
    await createRoom(HOMESERVER, reader.accessToken, { name: `Ledger room ${index}` });
  for (let index = 1; index <= HISTORY; index += 1) {
    const fromMember = index % 2 === 0;
    await sendRoomMessage(HOMESERVER, (fromMember ? member : reader).accessToken, roomId, {
      msgtype: 'm.text',
      body: fromMember
        ? `Entry ${index}: the receipts for this week are scanned and filed in the shared folder.`
        : `Entry ${index}: did the lunch receipts make it into this week's batch?`,
    });
  }
  const send = (content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, member.accessToken, roomId, content);
  const picture = await upload(member.accessToken, PNG, 'image/png');
  const imageId = await send({
    msgtype: 'm.image',
    body: CAPTION,
    filename: IMAGE_NAME,
    url: picture,
    info: { mimetype: 'image/png', w: 320, h: 240, size: PNG.length },
  });
  const clip = Buffer.from('not a playable video, only bytes to load');
  const videoId = await send({
    msgtype: 'm.video',
    body: VIDEO_NAME,
    url: await upload(member.accessToken, clip, 'video/mp4'),
    info: { mimetype: 'video/mp4', w: 320, h: 240, size: clip.length },
  });
  // The video's own file is gone; its thumbnail stays up, with the Retry button over it.
  const stillId = await send({
    msgtype: 'm.video',
    body: STILL_NAME,
    url: `mxc://${member.userId.split(':')[1]}/missing${RUN}`,
    info: {
      mimetype: 'video/mp4',
      w: 320,
      h: 240,
      size: 4096,
      thumbnail_url: await upload(member.accessToken, PNG, 'image/png'),
      thumbnail_info: { mimetype: 'image/png', w: 1, h: 1, size: PNG.length },
    },
  });
  const notes = 'Lunch receipts\nTotal: 42.10\n';
  const textId = await send({
    msgtype: 'm.file',
    body: TEXT_NAME,
    url: await upload(member.accessToken, Buffer.from(notes), 'text/plain'),
    info: { mimetype: 'text/plain', size: Buffer.byteLength(notes) },
  });
  return { reader, roomId, imageId, videoId, stillId, textId };
};

const row = (page: Page, eventId: string): Locator =>
  page.locator(`[data-message-id="${eventId}"]`).first();

const shot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

/** The scope shows `shown` and holds no control character. */
const expectShown = async (scope: Locator, shown: string) => {
  await expect(scope).toContainText(shown, { timeout: 30_000 });
  expect(await scope.textContent()).not.toMatch(CONTROL);
};

/** The element's attribute reads `shown`, controls written out. */
const expectAttribute = async (element: Locator, name: string, shown: string) => {
  await expect(element).toHaveAttribute(name, shown, { timeout: 30_000 });
};

/** Some image in the scope has `shown` as its `name` attribute, and none holds a control. */
const expectImageAttribute = async (scope: Locator, name: 'alt' | 'title', shown: string) => {
  const values = () =>
    scope
      .locator('img')
      .evaluateAll(
        (images, attribute) => images.map((image) => image.getAttribute(attribute)),
        name
      );
  await expect.poll(values, { timeout: 30_000 }).toContain(shown);
  expect((await values()).filter((value) => value && CONTROL.test(value))).toEqual([]);
};

/** Drags a file over the room, and drops it there when `drop`, as a file manager would. */
const dragFile = (area: Locator, name: string, drop: boolean) =>
  area.evaluate(
    (element, args) => {
      const data = new DataTransfer();
      data.items.add(new File(['month,total\nMarch,42.10\n'], args.name, { type: 'text/csv' }));
      for (const type of args.drop ? ['dragenter', 'dragover', 'drop'] : ['dragenter', 'dragover'])
        element.dispatchEvent(
          new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true })
        );
    },
    { name, drop }
  );

const openRoom = async (page: Page, world: World) => {
  await seedRoomOverviewState({
    page,
    roomId: world.roomId,
    userId: world.reader.userId,
    viewMode: 'threaded',
    filterState: createDefaultThreadFilterState(),
  });
  await page.evaluate((route) => {
    window.history.pushState(null, '', route);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, `/home/${encodeURIComponent(world.roomId)}/`);
  await expect(page.getByRole('heading', { name: ROOM_NAME }).first()).toBeVisible({
    timeout: 60_000,
  });
};

const check = async (page: Page, world: World, label: string) => {
  await openRoom(page, world);
  // Evidence only: the upload card and the lost-files notice, shot as they are.
  const area = page.locator('[data-room-footer]');
  await dragFile(area, UPLOAD_NAME, true);
  await expect(area.getByText(/^budget/)).toBeVisible({ timeout: 30_000 });
  await shot(page, `${label}-upload-card`);
  await page.reload();
  await openRoom(page, world);
  await expect(page.getByText(/^Not kept with this draft:/)).toBeVisible({ timeout: 30_000 });
  await shot(page, `${label}-lost-files`);
};

const run = async (browser: Browser, baseURL: string | undefined, engine: string) => {
  const world = await seed(engine);
  for (const [viewport, options] of [
    ['phone', PHONE],
    ['desktop', DESKTOP],
  ] as const) {
    const context = await browser.newContext({ ...options, baseURL });
    try {
      const page = await context.newPage();
      const pageErrors: string[] = [];
      page.on('pageerror', (error) => pageErrors.push(`${error.name}: ${error.message}`));
      await loginWithPassword(page, {
        homeserver: HOMESERVER,
        username: world.reader.username,
        password: PASSWORD,
      });
      await check(page, world, `${engine}-${viewport}`);
      expect(pageErrors, `uncaught errors in ${engine} ${viewport}`).toEqual([]);
    } finally {
      await context.close();
    }
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('file names show direction controls as code points (Chromium)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(300_000);
  await run(browser, baseURL, 'chromium');
});

test('file names show direction controls as code points (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(300_000);
  const browser = await launchWebKit();
  try {
    await run(browser, baseURL, 'webkit');
  } finally {
    await browser.close();
  }
});
