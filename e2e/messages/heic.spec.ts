import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Download, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { buildLoginPath } from '../env';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
} from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

const PASSWORD = 'heic-spec-password';
const FIXTURE_PATH = fileURLToPath(new URL('../fixtures/placeholder.heic', import.meta.url));
const HEIC_BYTES = readFileSync(FIXTURE_PATH);
const CORRUPT_HEIC_BYTES = HEIC_BYTES.subarray(0, 64);

const uploadHeic = async (token: string, filename: string, bytes: Buffer): Promise<string> => {
  const response = await fetch(
    `${HOMESERVER}/_matrix/media/v3/upload?filename=${encodeURIComponent(filename)}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'image/heic' },
      body: bytes,
    }
  );
  expect(response.ok, `media upload answered ${response.status}`).toBe(true);
  const { content_uri: contentUri } = (await response.json()) as { content_uri: string };
  return contentUri;
};

const sendHeicImage = async (
  token: string,
  roomId: string,
  txnId: string,
  filename: string,
  bytes: Buffer
): Promise<string> => {
  const url = await uploadHeic(token, filename, bytes);
  const { event_id: eventId } = await matrixFetch<{ event_id: string }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${encodeURIComponent(txnId)}`,
    {
      method: 'PUT',
      accessToken: token,
      body: JSON.stringify({
        msgtype: 'm.image',
        body: filename,
        filename,
        url,
        info: { mimetype: 'image/heic', w: 600, h: 400, size: bytes.length },
      }),
    }
  );
  return eventId;
};

const readDownloadBytes = async (download: Download): Promise<Buffer> => {
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
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

const openFullRoom = async (page: Page, roomId: string, userId: string) => {
  await seedRoomOverviewState({
    page,
    roomId,
    userId,
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

test('HEIC m.image renders inline, opens in viewer, downloads original, and falls back to file row on decode error', async ({
  browser,
}) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(240_000);

  const stamp = Date.now().toString(36);
  const user = await registerDisposableUser(`heic_plain_${stamp}`, PASSWORD);
  const roomId = await createPrivateRoom(HOMESERVER, user.accessToken, { name: 'HEIC Photos' });
  const eventId = await sendHeicImage(
    user.accessToken,
    roomId,
    `heic_ok_${stamp}`,
    'placeholder.heic',
    HEIC_BYTES
  );
  const corruptEventId = await sendHeicImage(
    user.accessToken,
    roomId,
    `heic_bad_${stamp}`,
    'corrupt.heic',
    CORRUPT_HEIC_BYTES
  );
  await matrixFetch(HOMESERVER, '/logout', {
    method: 'POST',
    accessToken: user.accessToken,
    body: JSON.stringify({}),
  });

  const shotsDir = process.env.HEIC_SHOTS;
  const page = await signIn(browser, user.username, shotsDir ? 2 : 1);
  await openFullRoom(page, roomId, user.userId);

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
    .toEqual({ complete: true, width: 600, height: 400 });

  await timelineImg.click();
  const viewer = page.locator('[data-image-viewer]');
  await expect(viewer).toBeVisible();
  const viewerImg = viewer.locator('img');
  await expect(viewerImg).toBeVisible();
  await expect
    .poll(() => naturalSize(viewerImg))
    .toEqual({ complete: true, width: 600, height: 400 });

  if (shotsDir) {
    await viewer.screenshot({ path: join(shotsDir, 'heic-viewer.png') });
  }

  // Downloading from the viewer must save the original HEIC bytes under the original name.
  const viewerDownload = page.waitForEvent('download');
  await viewer.getByRole('button', { name: 'Download', exact: true }).click();
  const savedOriginal = await viewerDownload;
  expect(savedOriginal.suggestedFilename()).toBe('placeholder.heic');
  expect((await readDownloadBytes(savedOriginal)).equals(HEIC_BYTES)).toBe(true);

  await page.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  // A corrupt HEIC falls back to the normal file row so the original bytes remain downloadable.
  const corruptRow = page.locator(`[data-message-id="${corruptEventId}"]`);
  await expect(corruptRow.getByText('corrupt.heic', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  const corruptDownload = page.waitForEvent('download');
  await corruptRow.getByRole('button', { name: /download/i }).click();
  const savedCorrupt = await corruptDownload;
  expect(savedCorrupt.suggestedFilename()).toBe('corrupt.heic');
  expect((await readDownloadBytes(savedCorrupt)).equals(CORRUPT_HEIC_BYTES)).toBe(true);
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
  const owner = await registerDisposableUser(`heic_owner_${stamp}`, PASSWORD);
  const guest = await registerDisposableUser(`heic_guest_${stamp}`, PASSWORD);
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: owner.accessToken,
    body: JSON.stringify({
      name: 'Encrypted HEIC',
      preset: 'private_chat',
      invite: [guest.userId],
      initial_state: [
        {
          type: 'm.room.encryption',
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' },
        },
      ],
    }),
  });
  await joinRoom(HOMESERVER, guest.accessToken, roomId);
  for (const token of [owner.accessToken, guest.accessToken]) {
    await matrixFetch(HOMESERVER, '/logout', {
      method: 'POST',
      accessToken: token,
      body: JSON.stringify({}),
    });
  }

  const reader = await signIn(browser, guest.username);
  await openFullRoom(reader, roomId, guest.userId);
  const sender = await signIn(browser, owner.username);
  await openFullRoom(sender, roomId, owner.userId);

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
    .toEqual({ complete: true, width: 600, height: 400 });

  await readerImg.click();
  const viewer = reader.locator('[data-image-viewer]');
  await expect(viewer).toBeVisible();
  await expect
    .poll(() => naturalSize(viewer.locator('img')))
    .toEqual({ complete: true, width: 600, height: 400 });
  await reader.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);
});
