import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { buildLoginPath } from '../env';
import { createDefaultThreadFilterState, seedRoomOverviewState } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

const PASSWORD = 'heic-spec-password';
const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/placeholder.heic', import.meta.url));
const HEIC_BYTES = readFileSync(FIXTURE_PATH);

const matrix = async <T>(
  path: string,
  init: { method?: 'GET' | 'POST' | 'PUT'; token?: string; body?: unknown } = {}
): Promise<T> => {
  const method = init.method ?? (init.body ? 'POST' : 'GET');
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  expect(response.ok, `${path} answered ${response.status}`).toBe(true);
  return (await response.json()) as T;
};

const register = async (username: string): Promise<string> => {
  const { access_token: token } = await matrix<{ access_token: string }>('/register', {
    body: { username, password: PASSWORD, auth: { type: 'm.login.dummy' } },
  });
  return token;
};

const uploadHeic = async (token: string, filename: string): Promise<string> => {
  const response = await fetch(
    `${HOMESERVER}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'image/heic',
      },
      body: HEIC_BYTES,
    }
  );
  expect(response.ok, `media upload answered ${response.status}`).toBe(true);
  const { content_uri: contentUri } = (await response.json()) as { content_uri: string };
  return contentUri;
};

const signIn = async (browser: Browser, username: string, deviceScaleFactor = 1): Promise<Page> => {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor,
  });
  const page = await context.newPage();
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 90_000 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return page;
};

const openFullRoom = async (page: Page, roomId: string, username: string) => {
  await seedRoomOverviewState({
    page,
    roomId,
    userId: `@${username}:matrix.localhost`,
    viewMode: 'classic',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const viewSwitch = page.locator('[data-room-view-switch]');
  await expect(viewSwitch).toBeVisible({ timeout: 30_000 });
  if ((await viewSwitch.getAttribute('aria-pressed')) === 'true') await viewSwitch.click();
};

const naturalSize = (locator: ReturnType<Page['locator']>) =>
  locator.evaluate((image: HTMLImageElement) => ({
    complete: image.complete,
    width: image.naturalWidth,
    height: image.naturalHeight,
  }));

test('HEIC m.image renders inline in timeline, opens in viewer, and downloads original HEIC', async ({
  browser,
}) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(240_000);

  const stamp = Date.now().toString(36);
  const username = `heic_plain_${stamp}`;
  const token = await register(username);
  const { room_id: roomId } = await matrix<{ room_id: string }>('/createRoom', {
    token,
    body: { name: 'HEIC Photos', preset: 'private_chat' },
  });

  const contentUri = await uploadHeic(token, 'placeholder.heic');
  const { event_id: eventId } = await matrix<{ event_id: string }>(
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/heic_${stamp}`,
    {
      method: 'PUT',
      token,
      body: {
        msgtype: 'm.image',
        body: 'placeholder.heic',
        filename: 'placeholder.heic',
        url: contentUri,
        info: {
          mimetype: 'image/heic',
          w: 600,
          h: 400,
          size: HEIC_BYTES.length,
        },
      },
    }
  );
  await matrix('/logout', { token, body: {} });

  const shotsDir = process.env.HEIC_SHOTS;
  const page = await signIn(browser, username, shotsDir ? 2 : 1);
  await openFullRoom(page, roomId, username);

  const row = page.locator(`[data-message-id="${eventId}"]`);
  await expect(row).toBeVisible({ timeout: 60_000 });

  // Wait for the row to settle either as a decoded <img> (fixed) or as a file row (origin/main).
  await expect
    .poll(
      async () => {
        const img = row.locator('img[alt="placeholder.heic"]');
        if ((await img.count()) > 0) {
          const size = await naturalSize(img.first());
          if (size.complete && size.width > 0) return 'image';
        }
        const downloadButton = row.getByRole('button', { name: /download/i });
        if ((await downloadButton.count()) > 0 && (await downloadButton.first().isVisible())) {
          return 'file';
        }
        return 'pending';
      },
      { timeout: 60_000 }
    )
    .not.toBe('pending');

  if (shotsDir) {
    mkdirSync(shotsDir, { recursive: true });
    await row.screenshot({ path: join(shotsDir, 'heic-timeline.png') });
  }

  const timelineImg = row.locator('img[alt="placeholder.heic"]');
  await expect(timelineImg).toBeVisible();
  await expect
    .poll(() => naturalSize(timelineImg))
    .toEqual({
      complete: true,
      width: 600,
      height: 400,
    });

  // Open the full viewer and check the image renders there too.
  await timelineImg.click();
  const viewer = page.locator('[data-image-viewer]');
  await expect(viewer).toBeVisible();
  const viewerImg = viewer.locator('img');
  await expect(viewerImg).toBeVisible();
  await expect
    .poll(() => naturalSize(viewerImg))
    .toEqual({
      complete: true,
      width: 600,
      height: 400,
    });

  if (shotsDir) {
    await viewer.screenshot({ path: join(shotsDir, 'heic-viewer.png') });
  }

  // Downloading from the viewer must save the original HEIC bytes under the original name.
  const downloadPromise = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'Download', exact: true }).click();
  const saved = await downloadPromise;
  expect(saved.suggestedFilename()).toBe('placeholder.heic');
  const stream = await saved.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).equals(HEIC_BYTES)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
});

test('encrypted HEIC m.image renders inline and opens in viewer for another participant', async ({
  browser,
}) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(300_000);

  const stamp = Date.now().toString(36);
  const owner = `heic_owner_${stamp}`;
  const guest = `heic_guest_${stamp}`;
  const ownerToken = await register(owner);
  const guestToken = await register(guest);
  const { room_id: roomId } = await matrix<{ room_id: string }>('/createRoom', {
    token: ownerToken,
    body: {
      name: 'Encrypted HEIC',
      preset: 'private_chat',
      invite: [`@${guest}:matrix.localhost`],
      initial_state: [
        {
          type: 'm.room.encryption',
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        },
      ],
    },
  });
  await matrix(`/join/${encodeURIComponent(roomId)}`, { token: guestToken, body: {} });
  await matrix('/logout', { token: ownerToken, body: {} });
  await matrix('/logout', { token: guestToken, body: {} });

  // Reader joins before the image is sent so the Megolm room key reaches it.
  const reader = await signIn(browser, guest);
  await openFullRoom(reader, roomId, guest);
  const sender = await signIn(browser, owner);
  await openFullRoom(sender, roomId, owner);

  const chooser = sender.waitForEvent('filechooser');
  await sender.getByRole('button', { name: 'Attach files', exact: true }).click();
  await (
    await chooser
  ).setFiles([{ name: 'placeholder.heic', mimeType: 'image/heic', buffer: HEIC_BYTES }]);
  await expect(sender.getByText('placeholder.heic', { exact: true }).first()).toBeVisible();

  await sender.locator('[data-editable-name="RoomInput"]').click();
  await sender.keyboard.press('Enter');

  const readerImg = reader.locator('img[alt="placeholder.heic"]');
  await expect(readerImg).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => naturalSize(readerImg))
    .toEqual({
      complete: true,
      width: 600,
      height: 400,
    });

  await readerImg.click();
  const viewer = reader.locator('[data-image-viewer]');
  await expect(viewer).toBeVisible();
  await expect
    .poll(() => naturalSize(viewer.locator('img')))
    .toEqual({
      complete: true,
      width: 600,
      height: 400,
    });
  await reader.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
});
