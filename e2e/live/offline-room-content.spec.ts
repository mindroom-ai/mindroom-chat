import { devices, expect, test, webkit, type BrowserContext, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { readSessionStore } from '../helpers/accounts';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  setAccountData,
  type MatrixSession,
} from '../helpers/matrix';

const phone = devices['iPhone 13'];
const imageBytes = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a3f8AAAAASUVORK5CYII=',
  'base64'
);
const fullBody = 'Complete historical body restored from persistent attachment storage.';
const fillerCount = 24;

type OfflineFixture = {
  session: MatrixSession;
  roomId: string;
  roomName: string;
  rootId: string;
  bodyId: string;
  imageId: string;
  bodyUri: string;
  imageUri: string;
  savedSettings: Record<string, unknown>;
};

const uploadMedia = async (
  homeserver: string,
  accessToken: string,
  bytes: Buffer,
  contentType: string
): Promise<string> => {
  const response = await fetch(`${homeserver}/_matrix/media/v3/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': contentType,
    },
    body: bytes,
  });
  expect(response.status).toBe(200);
  const content = (await response.json()) as { content_uri?: string };
  expect(content.content_uri).toEqual(expect.any(String));
  return content.content_uri as string;
};

const createOfflineFixture = async (homeserver: string): Promise<OfflineFixture> => {
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const bodyUri = await uploadMedia(
    homeserver,
    session.accessToken,
    Buffer.from(
      JSON.stringify({
        msgtype: 'm.text',
        body: fullBody,
        format: 'org.matrix.custom.html',
        formatted_body: `<p>${fullBody}</p>`,
      })
    ),
    'application/json'
  );
  const imageUri = await uploadMedia(homeserver, session.accessToken, imageBytes, 'image/png');
  const roomName = `Offline historical content ${Date.now()}`;
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: roomName,
    topic: 'Historical room and thread content saved by the production offline controller.',
  });
  let savedSettings: Record<string, unknown> | undefined;
  try {
    const rootId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      { msgtype: 'm.text', body: 'Historical offline thread root' },
      'offline-room-content'
    );
    const relation = {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    };
    const bodyId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: 'Short historical preview only',
        url: bodyUri,
        'io.mindroom.long_text': { version: 2, encoding: 'matrix_event_content_json' },
        'm.relates_to': relation,
      },
      'offline-room-content'
    );
    const imageId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.image',
        body: 'Historical offline pixel',
        url: imageUri,
        info: { mimetype: 'image/png', size: imageBytes.length, w: 1, h: 1 },
        'm.relates_to': relation,
      },
      'offline-room-content'
    );

    for (let index = 0; index < fillerCount; index += 1) {
      // Keep the historical thread outside the real SDK initial timeline window.
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(
        homeserver,
        session.accessToken,
        roomId,
        { msgtype: 'm.text', body: `Newer tail message ${index + 1}` },
        'offline-room-content'
      );
    }

    const filter = encodeURIComponent(
      JSON.stringify({ room: { rooms: [roomId], timeline: { limit: 20 } } })
    );
    const initialSync = await matrixFetch<{
      rooms: { join: Record<string, { timeline: { events: Array<{ event_id: string }> } }> };
    }>(homeserver, `/sync?timeout=0&filter=${filter}`, { accessToken: session.accessToken });
    const initialTailIds = initialSync.rooms.join[roomId].timeline.events.map(
      (event) => event.event_id
    );
    expect(initialTailIds).toHaveLength(20);
    expect(initialTailIds).not.toContain(rootId);
    expect(initialTailIds).not.toContain(bodyId);
    expect(initialTailIds).not.toContain(imageId);

    savedSettings = await matrixFetch<Record<string, unknown>>(
      homeserver,
      `/user/${encodeURIComponent(session.userId)}/account_data/io.mindroom.settings`,
      { accessToken: session.accessToken }
    ).catch((error: Error) => {
      if (error.message.startsWith('Matrix API 404')) return {};
      throw error;
    });
    await setAccountData(homeserver, session.accessToken, session.userId, 'io.mindroom.settings', {
      ...savedSettings,
      simpleMode: false,
    });

    return {
      session,
      roomId,
      roomName,
      rootId,
      bodyId,
      imageId,
      bodyUri,
      imageUri,
      savedSettings,
    };
  } catch (error) {
    await forgetFixtureRoom(homeserver, { session, roomId, savedSettings });
    throw error;
  }
};

const readPersistedCoverage = async (
  page: Page,
  dbName: string,
  fixture: OfflineFixture
): Promise<{ attachments: number; events: number }> =>
  page.evaluate(
    async ({ name, eventKeys, attachmentUris }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        const transaction = db.transaction(['events', 'attachments'], 'readonly');
        const events = transaction.objectStore('events');
        const attachments = transaction.objectStore('attachments');
        const eventRows = await Promise.all(
          eventKeys.map(
            (key) =>
              new Promise<boolean>((resolve, reject) => {
                const request = events.get(key);
                request.onsuccess = () => resolve(!!request.result);
                request.onerror = () => reject(request.error);
              })
          )
        );
        const attachmentRows = await Promise.all(
          attachmentUris.map(
            (uri) =>
              new Promise<boolean>((resolve, reject) => {
                const request = attachments.get(uri);
                request.onsuccess = () => resolve(!!request.result);
                request.onerror = () => reject(request.error);
              })
          )
        );
        return {
          events: eventRows.filter(Boolean).length,
          attachments: attachmentRows.filter(Boolean).length,
        };
      } finally {
        db.close();
      }
    },
    {
      name: dbName,
      eventKeys: [
        `${fixture.roomId}||${fixture.rootId}`,
        `${fixture.roomId}|${fixture.rootId}|${fixture.bodyId}`,
        `${fixture.roomId}|${fixture.rootId}|${fixture.imageId}`,
      ],
      attachmentUris: [fixture.bodyUri, fixture.imageUri],
    }
  );

const openRoomSettings = async (page: Page, roomName: string): Promise<void> => {
  const roomHeader = page.locator('header').filter({ hasText: roomName });
  await roomHeader.getByRole('button').last().click();
  await page.getByRole('button', { name: 'Room Settings', exact: true }).click();
  const general = page.getByRole('button', { name: 'General', exact: true });
  await expect(general).toBeVisible();
  await general.click();
};

const warmHistoricalContent = async (
  page: Page,
  homeserver: string,
  fixture: OfflineFixture
): Promise<{ cacheDbName: string; sdkDbName: string; threadUrl: string }> => {
  const credentials = getPrimaryCredentials();
  await loginWithPassword(page, { homeserver, ...credentials });
  await seedRoomOverviewState({
    page,
    roomId: fixture.roomId,
    userId: fixture.session.userId,
    viewMode: 'compact',
  });
  await page.getByRole('link', { name: fixture.roomName, exact: true }).first().click();
  await expect(page.getByRole('button', { name: 'Send message', exact: true })).toBeVisible();

  await openRoomSettings(page, fixture.roomName);
  const download = page.getByRole('button', { name: 'Download entire room', exact: true });
  await expect(download).toBeEnabled();
  await download.click();

  const { activeSessionId } = await readSessionStore(page);
  expect(activeSessionId).toBeTruthy();
  const cacheDbName = `mindroom-cache::${activeSessionId}`;
  await expect
    .poll(() => readPersistedCoverage(page, cacheDbName, fixture), { timeout: 30_000 })
    .toEqual({ events: 3, attachments: 2 });

  await page.keyboard.press('Escape');
  const root = page.locator(`[data-thread-root-id="${fixture.rootId}"]`);
  await expect(root).toBeVisible({ timeout: 10_000 });
  await root.click();
  await expect(
    page.locator(`[data-message-id="${fixture.bodyId}"]`).getByText(fullBody, { exact: true })
  ).toBeVisible();
  const image = page.locator(`[data-message-id="${fixture.imageId}"] img`).last();
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)
    )
    .toBe(true);
  const threadUrl = page.url();

  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await page.route('**/public/offline-e2e-inert.html', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Offline fixture idle</title><p>Offline fixture idle</p>',
    })
  );
  await page.goto('/public/offline-e2e-inert.html');
  await expect(page.getByText('Offline fixture idle', { exact: true })).toBeVisible();
  const filter = encodeURIComponent(
    JSON.stringify({ room: { rooms: [fixture.roomId], timeline: { limit: 1 } } })
  );
  const sync = await matrixFetch<{
    next_batch: string;
    rooms: { join: Record<string, { timeline: { events: Array<{ event_id: string }> } }> };
  }>(homeserver, `/sync?timeout=0&filter=${filter}`, {
    accessToken: fixture.session.accessToken,
  });
  const savedTailIds = sync.rooms.join[fixture.roomId].timeline.events.map(
    (event) => event.event_id
  );
  expect(savedTailIds).toHaveLength(1);
  expect(savedTailIds).not.toContain(fixture.rootId);
  expect(savedTailIds).not.toContain(fixture.bodyId);
  expect(savedTailIds).not.toContain(fixture.imageId);
  const sdkDbName = `matrix-js-sdk:web-sync-store::${activeSessionId}`;
  await page.evaluate(
    async ({ dbName, savedSync }) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(dbName);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          const transaction = db.transaction('sync', 'readwrite');
          transaction.objectStore('sync').put({
            clobber: '-',
            nextBatch: savedSync.next_batch,
            roomsData: savedSync.rooms,
          });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
        });
      } finally {
        db.close();
      }
    },
    { dbName: sdkDbName, savedSync: sync }
  );

  return { cacheDbName, sdkDbName, threadUrl };
};

const expectHistoricalContent = async (page: Page, fixture: OfflineFixture): Promise<void> => {
  await expect(page.locator(`[data-message-id="${fixture.rootId}"]`)).toBeVisible({
    timeout: 10_000,
  });
  await expect(
    page.locator(`[data-message-id="${fixture.bodyId}"]`).getByText(fullBody, { exact: true })
  ).toBeVisible({ timeout: 10_000 });
  const image = page.locator(`[data-message-id="${fixture.imageId}"] img`).last();
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)
    )
    .toBe(true);
};

const forgetFixtureRoom = async (
  homeserver: string,
  fixture: Pick<OfflineFixture, 'session' | 'roomId'> &
    Partial<Pick<OfflineFixture, 'savedSettings'>>
): Promise<void> => {
  try {
    if (fixture.savedSettings)
      await setAccountData(
        homeserver,
        fixture.session.accessToken,
        fixture.session.userId,
        'io.mindroom.settings',
        fixture.savedSettings
      );
  } finally {
    await matrixFetch(homeserver, `/rooms/${encodeURIComponent(fixture.roomId)}/leave`, {
      method: 'POST',
      accessToken: fixture.session.accessToken,
      body: '{}',
    });
    await matrixFetch(homeserver, `/rooms/${encodeURIComponent(fixture.roomId)}/forget`, {
      method: 'POST',
      accessToken: fixture.session.accessToken,
      body: '{}',
    });
  }
};

test.describe('persisted historical room content', () => {
  test.use({
    viewport: phone.viewport,
    isMobile: true,
    hasTouch: true,
    serviceWorkers: 'allow',
  });

  test('reopens an older thread body and decoded image while Chromium is offline', async ({
    browserName,
    context,
    page,
  }) => {
    test.setTimeout(180_000);
    test.skip(
      browserName !== 'chromium',
      'Chromium provides reliable offline service-worker navigation'
    );
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    const homeserver = getHomeserver();
    let fixture: OfflineFixture | undefined;
    try {
      fixture = await createOfflineFixture(homeserver);
      const { threadUrl } = await warmHistoricalContent(page, homeserver, fixture);
      await page.close();
      await context.setOffline(true);
      const reopened = await context.newPage();
      await reopened.goto(threadUrl, { waitUntil: 'domcontentloaded' });
      await expectHistoricalContent(reopened, fixture);
    } finally {
      try {
        await context.setOffline(false);
      } finally {
        if (fixture) await forgetFixtureRoom(homeserver, fixture);
      }
    }
  });

  test('reopens an older thread body and decoded image after a WebKit profile restart', async ({
    baseURL,
    browserName,
  }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(browserName !== 'webkit', 'Persistent-profile restart coverage uses WebKit');
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    expect(baseURL).toEqual(expect.any(String));
    const homeserver = getHomeserver();
    const profile = testInfo.outputPath('persistent-profile');
    const contextOptions = {
      baseURL,
      viewport: phone.viewport,
      isMobile: true,
      hasTouch: true,
    };
    let fixture: OfflineFixture | undefined;
    let context: BrowserContext = await webkit.launchPersistentContext(profile, {
      ...contextOptions,
      serviceWorkers: 'allow',
    });
    try {
      fixture = await createOfflineFixture(homeserver);
      const page = context.pages()[0] ?? (await context.newPage());
      const { threadUrl } = await warmHistoricalContent(page, homeserver, fixture);
      await page.evaluate(async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      });
      await context.close();

      context = await webkit.launchPersistentContext(profile, {
        ...contextOptions,
        serviceWorkers: 'block',
      });
      let releaseRequests!: () => void;
      const requestsHeld = new Promise<void>((resolve) => {
        releaseRequests = resolve;
      });
      let matrixRequestsHeld = 0;
      await context.route(/\/_matrix\//, async (route) => {
        matrixRequestsHeld += 1;
        await requestsHeld;
        await route.abort();
      });
      try {
        const reopened = context.pages()[0] ?? (await context.newPage());
        await reopened.goto(threadUrl, { waitUntil: 'domcontentloaded' });
        await expect.poll(() => matrixRequestsHeld).toBeGreaterThan(0);
        await expectHistoricalContent(reopened, fixture);
      } finally {
        releaseRequests();
        await context.unrouteAll({ behavior: 'wait' });
      }
    } finally {
      try {
        await context.close();
      } finally {
        if (fixture) await forgetFixtureRoom(homeserver, fixture);
      }
    }
  });
});
