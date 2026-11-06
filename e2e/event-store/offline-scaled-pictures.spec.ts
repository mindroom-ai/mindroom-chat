import { crc32, deflateSync } from 'node:zlib';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';
import { readSessionStore } from '../helpers/accounts';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  createPrivateRoom,
  redactEvent,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';

// A picture the timeline shows as the homeserver's scaled copy (an unencrypted PNG without a
// sender thumbnail) keeps that copy in the offline cache: reopened while the homeserver does not
// answer, the room still shows it. A redaction removes the copy. Checked against the slot's
// Tuwunel in Chromium on a desktop and in WebKit on a phone.
const PASSWORD = 'offline-scaled-pictures-spec-password';
const RUN = Date.now().toString(36);
const WIDTH = 1200;
const HEIGHT = 900;
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

/** A PNG of two colour bands, larger than the 800x600 box the homeserver scales into. */
const png = (): Buffer => {
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(WIDTH, 0);
  header.writeUInt32BE(HEIGHT, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const rows = Array.from({ length: HEIGHT }, (_, y) => {
    const row = Buffer.alloc(1 + WIDTH * 3);
    for (let x = 0; x < WIDTH; x += 1)
      row.set(y < HEIGHT / 2 ? [70, 130, 200] : [230, 160, 60], 1 + x * 3);
    return row;
  });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

const upload = async (accessToken: string, bytes: Buffer): Promise<string> => {
  const response = await fetch(
    `${DISPOSABLE_HOMESERVER}/_matrix/media/v3/upload?filename=garden.png`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/png' },
      body: bytes,
    }
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { content_uri: string }).content_uri;
};

/** The keys of the saved media in the offline cache `dbName` that belong to `mxcUri`. */
const savedMediaKeys = (page: Page, dbName: string, mxcUri: string): Promise<string[]> =>
  page.evaluate(
    async ({ name, uri }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        if (!db.objectStoreNames.contains('attachments')) return [];
        const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
          const request = db.transaction('attachments').objectStore('attachments').getAllKeys();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        return keys.map(String).filter((key) => key.startsWith(uri));
      } finally {
        db.close();
      }
    },
    { name: dbName, uri: mxcUri }
  );

/** The picture's rendered size once it has loaded, or 0 while it has not. */
const pictureWidth = (page: Page, eventId: string): Promise<number> =>
  page
    .locator(`[data-message-id="${eventId}"] img`)
    .last()
    .evaluate((image: HTMLImageElement) => (image.complete ? image.naturalWidth : 0))
    .catch(() => 0);

const run = async (
  browser: Browser,
  options: BrowserContextOptions,
  engine: string,
  baseURL: string | undefined
) => {
  const user = await registerDisposableUser(`scaled_${engine}_${RUN}`, PASSWORD);
  const roomId = await createPrivateRoom(DISPOSABLE_HOMESERVER, user.accessToken, {
    name: 'Garden photos',
    topic: 'Pictures from the allotment',
  });
  const bytes = png();
  const mxcUri = await upload(user.accessToken, bytes);
  await sendRoomMessage(DISPOSABLE_HOMESERVER, user.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'The beans came up this week.',
  });
  const imageId = await sendRoomMessage(DISPOSABLE_HOMESERVER, user.accessToken, roomId, {
    msgtype: 'm.image',
    body: 'garden.png',
    url: mxcUri,
    info: { mimetype: 'image/png', size: bytes.length, w: WIDTH, h: HEIGHT },
  });

  // A context without the service worker, so stalled homeserver requests reach the route below.
  const context = await browser.newContext({ ...options, baseURL, serviceWorkers: 'block' });
  try {
    const page = await context.newPage();
    await loginWithPassword(page, {
      homeserver: DISPOSABLE_HOMESERVER,
      username: user.username,
      password: PASSWORD,
    });
    await seedRoomOverviewState({ page, roomId, userId: user.userId, viewMode: 'classic' });
    const roomPath = `/home/${encodeURIComponent(roomId)}/`;
    await page.goto(roomPath);
    const { activeSessionId } = await readSessionStore(page);
    expect(activeSessionId).toBeTruthy();
    const dbName = `mindroom-cache::${activeSessionId}`;

    // Online, the timeline shows the homeserver's scaled copy and saves it.
    await expect.poll(() => pictureWidth(page, imageId), { timeout: 30_000 }).toBeGreaterThan(0);
    expect(await pictureWidth(page, imageId)).toBeLessThanOrEqual(800);
    await expect
      .poll(() => savedMediaKeys(page, dbName, mxcUri), { timeout: 30_000 })
      .toEqual([`${mxcUri}#scaled`]);
    await page.close();

    // Reopened while the homeserver answers nothing, the picture comes from the cache.
    let held = 0;
    let release!: () => void;
    const stalled = new Promise<void>((resolve) => {
      release = resolve;
    });
    await context.route(/\/_matrix\//, async (route) => {
      held += 1;
      await stalled;
      await route.abort();
    });
    try {
      const offline = await context.newPage();
      await offline.goto(roomPath);
      await expect.poll(() => held).toBeGreaterThan(0);
      await expect
        .poll(() => pictureWidth(offline, imageId), { timeout: 30_000 })
        .toBeGreaterThan(0);
      expect(await pictureWidth(offline, imageId)).toBeLessThanOrEqual(800);
      await offline.screenshot({ path: test.info().outputPath(`${engine}-offline.png`) });
      await offline.close();
    } finally {
      release();
      await context.unrouteAll({ behavior: 'wait' });
    }

    // A redaction takes the copy out of the cache with the event.
    await redactEvent(DISPOSABLE_HOMESERVER, user.accessToken, roomId, imageId);
    const online = await context.newPage();
    await online.goto(roomPath);
    await expect
      .poll(() => savedMediaKeys(online, dbName, mxcUri), { timeout: 30_000 })
      .toEqual([]);
  } finally {
    await context.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${DISPOSABLE_HOMESERVER}`);
});

test('a scaled picture stays viewable offline and leaves with its redaction (Chromium, desktop)', async ({
  browser,
  baseURL,
}) => {
  test.setTimeout(240_000);
  await run(browser, DESKTOP, 'chromium', baseURL);
});

test('a scaled picture stays viewable offline and leaves with its redaction (WebKit, phone)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.setTimeout(240_000);
  const browser = await launchWebKit();
  try {
    await run(browser, PHONE, 'webkit', baseURL);
  } finally {
    await browser.close();
  }
});
