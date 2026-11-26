import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Locator, type Page, type Response } from '@playwright/test';
import { bytesToSize } from '../../src/app/lib/common';
import { chooseFromAccountMenu, loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  createDefaultThreadFilterState,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  type MatrixSession,
} from '../helpers/matrix';

// Client-side media compression end-to-end coverage against real Chromium and the disposable
// Tuwunel homeserver (`just hs-up` or `scripts/e2e-slot.sh`). Set
// `MEDIA_COMPRESSION_SHOTS=<directory>` to save clean placeholder screenshots for PR attachment.
const PASSWORD = 'media-compression-spec-password';
const RUN = Date.now().toString(36);
const SHOTS_DIR = process.env.MEDIA_COMPRESSION_SHOTS;
const SETTINGS_ACCOUNT_DATA_TYPE = 'io.mindroom.client.settings';
const IMAGE_CHUNK_RE = /compressImage(?:\.ts|-[^/]+\.js)/;
const VIDEO_CHUNK_RE = /compressVideo(?:\.ts|-[^/]+\.js)/;
const MIN_VIDEO_BYTES = 1024 * 1024;
const ARROW = '\u2192';

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
  viewport: { width: 1280, height: 800 },
});

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
});

type Rect = { x: number; y: number; width: number; height: number };

type RoomMessageEvent = {
  type: string;
  event_id: string;
  content: {
    msgtype?: string;
    body?: string;
    url?: string;
    info?: {
      mimetype?: string;
      size?: number;
      w?: number;
      h?: number;
    };
  };
};

type DownloadedMedia = {
  contentType: string;
  bytes: Buffer;
};

type GeneratedVideo = {
  name: string;
  mimeType: 'video/webm' | 'video/mp4';
  buffer: Buffer;
};

const unionRects = (
  rects: readonly Rect[],
  pad: number,
  viewport: { width: number; height: number }
): Rect => {
  const left = Math.max(0, Math.floor(Math.min(...rects.map((rect) => rect.x)) - pad));
  const top = Math.max(0, Math.floor(Math.min(...rects.map((rect) => rect.y)) - pad));
  const right = Math.min(
    viewport.width,
    Math.ceil(Math.max(...rects.map((rect) => rect.x + rect.width)) + pad)
  );
  const bottom = Math.min(
    viewport.height,
    Math.ceil(Math.max(...rects.map((rect) => rect.y + rect.height)) + pad)
  );
  return {
    x: left,
    y: top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
};

const waitForUiSettle = async (page: Page): Promise<void> => {
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await page.mouse.move(0, 0);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => resolve());
        });
      })
  );
};

/**
 * Tracks page-initiated chunk requests so lazy chunk checks work in both Vite dev mode (where
 * hundreds of ESM files exceed the default 250-entry PerformanceResourceTiming buffer) and
 * production `--preview` builds.
 */
const trackChunkRequests = (page: Page) => {
  const requestedUrls: string[] = [];
  page.on('request', (request) => {
    requestedUrls.push(request.url());
  });
  return {
    hasLoaded: async (pattern: RegExp): Promise<boolean> => {
      if (requestedUrls.some((url) => pattern.test(url))) return true;
      return page.evaluate((source) => {
        const regex = new RegExp(source);
        return performance.getEntriesByType('resource').some((entry) => regex.test(entry.name));
      }, pattern.source);
    },
  };
};

const setupRoom = async (page: Page, tag: string, options: { seedMessages?: boolean } = {}) => {
  const account = await registerDisposableUser(`mc_${tag}_${RUN}`, PASSWORD);
  const roomId = await createRoom(HOMESERVER, account.accessToken, {
    name: 'Media Compression Test',
  });

  if (options.seedMessages) {
    await sendRoomMessage(HOMESERVER, account.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Ready to review the updated layout captures.',
    });
    await sendRoomMessage(HOMESERVER, account.accessToken, roomId, {
      msgtype: 'm.text',
      body: 'Drop the high-resolution screenshot or clip whenever it is ready.',
    });
  }

  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: account.username,
    password: PASSWORD,
  });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: account.userId,
    viewMode: 'classic',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);

  const composer = page.locator('[data-editable-name="RoomInput"]');
  await expect(composer).toBeVisible({ timeout: 60_000 });

  const viewSwitch = page.locator('[data-room-view-switch]');
  if (
    (await viewSwitch.isVisible().catch(() => false)) &&
    (await viewSwitch.getAttribute('aria-pressed')) === 'true'
  ) {
    await viewSwitch.click();
    await expect(composer).toBeVisible({ timeout: 30_000 });
  }

  return { account, roomId, composer };
};

const readAccountMediaCompression = async (account: MatrixSession): Promise<unknown> => {
  try {
    const content = await matrixFetch<Record<string, unknown>>(
      HOMESERVER,
      `/user/${encodeURIComponent(account.userId)}/account_data/${SETTINGS_ACCOUNT_DATA_TYPE}`,
      { accessToken: account.accessToken }
    );
    return content.mediaCompression;
  } catch {
    return undefined;
  }
};

const latestRoomMessages = async (
  account: MatrixSession,
  roomId: string
): Promise<RoomMessageEvent[]> => {
  const result = await matrixFetch<{ chunk: RoomMessageEvent[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=20`,
    { accessToken: account.accessToken }
  );
  return result.chunk.filter((event) => event.type === 'm.room.message');
};

const downloadMatrixMedia = async (accessToken: string, mxc: string): Promise<DownloadedMedia> => {
  expect(mxc.startsWith('mxc://')).toBe(true);
  const mediaPath = mxc.slice('mxc://'.length);
  const response = await fetch(`${HOMESERVER}/_matrix/client/v1/media/download/${mediaPath}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  expect(response.ok, `Media download failed (${response.status}) for ${mxc}`).toBe(true);
  const contentType = response.headers.get('content-type') ?? '';
  const bytes = Buffer.from(await response.arrayBuffer());
  return { contentType, bytes };
};

const waitForMediaUpload = (
  page: Page,
  expectedFilenames: readonly string[],
  timeout = 60_000
): Promise<Response> =>
  page.waitForResponse(
    (response) => {
      if (response.request().method() !== 'POST') return false;
      if (!response.url().startsWith(HOMESERVER)) return false;
      if (!/\/_matrix\/media\/[^/]+\/upload\b/.test(response.url())) return false;
      const filename = new URL(response.url()).searchParams.get('filename');
      return filename !== null && expectedFilenames.includes(filename);
    },
    { timeout }
  );

const parseUploadMxc = async (response: Response): Promise<string> => {
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { content_uri?: unknown };
  expect(typeof body.content_uri).toBe('string');
  const mxc = body.content_uri as string;
  expect(mxc.startsWith('mxc://')).toBe(true);
  return mxc;
};

const getUploadBoard = (page: Page): Locator =>
  page
    .locator('header', { has: page.getByRole('button', { name: 'Remove All', exact: true }) })
    .locator('xpath=..');

const waitForUploadSuccessIcon = async (uploadBoard: Locator): Promise<void> => {
  await expect(uploadBoard.getByRole('progressbar')).toHaveCount(0, { timeout: 60_000 });
  await expect(uploadBoard.getByRole('alert')).toHaveCount(0);
  await expect(uploadBoard.locator('svg[style*="color"]')).toBeVisible({ timeout: 30_000 });
};

const attachSingleFile = async (
  page: Page,
  file: { name: string; mimeType: string; buffer: Buffer }
): Promise<void> => {
  const chooserPromise = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  const chooser = await chooserPromise;
  await chooser.setFiles([file]);
};

const sendWithCaption = async (page: Page, caption: string): Promise<void> => {
  const composer = page.locator('[data-editable-name="RoomInput"]');
  await composer.click();
  await page.keyboard.type(caption);
  await page.keyboard.press('Enter');
};

/**
 * Draws a synthetic 2600x1600 high-entropy PNG with gradients, geometric dashboard panels, and
 * subtle deterministic dither so lossless PNG is large (> 150 KiB) while lossy WebP shrinks
 * dramatically after resizing to <= 2048 px.
 */
const drawHighEntropyPng = async (page: Page, width: number, height: number): Promise<Buffer> => {
  const base64 = await page.evaluate(
    async ({ w, h }) => {
      const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not acquire 2D canvas context');

      const bg = ctx.createLinearGradient(0, 0, w, h);
      bg.addColorStop(0, '#0f172a');
      bg.addColorStop(0.35, '#1d4ed8');
      bg.addColorStop(0.7, '#0d9488');
      bg.addColorStop(1, '#f59e0b');
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, w, h);

      // Layered radial halos and mock dashboard cards for realistic photographic + UI detail.
      const halos: ReadonlyArray<readonly [number, number, number, string]> = [
        [w * 0.22, h * 0.28, w * 0.32, 'rgba(56, 189, 248, 0.45)'],
        [w * 0.78, h * 0.24, w * 0.28, 'rgba(251, 146, 60, 0.42)'],
        [w * 0.55, h * 0.76, w * 0.35, 'rgba(167, 139, 250, 0.38)'],
      ];
      for (const [cx, cy, radius, color] of halos) {
        const radial = ctx.createRadialGradient(cx, cy, 10, cx, cy, radius);
        radial.addColorStop(0, color);
        radial.addColorStop(1, 'rgba(15, 23, 42, 0)');
        ctx.fillStyle = radial;
        ctx.fillRect(0, 0, w, h);
      }

      for (let col = 0; col < 4; col += 1) {
        for (let row = 0; row < 2; row += 1) {
          const x = 140 + col * 590;
          const y = 180 + row * 640;
          ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
          ctx.fillRect(x, y, 520, 520);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
          ctx.lineWidth = 4;
          ctx.strokeRect(x, y, 520, 520);

          const barGrad = ctx.createLinearGradient(x, y, x + 520, y + 520);
          barGrad.addColorStop(0, `hsl(${(col * 75 + row * 120) % 360}, 78%, 62%)`);
          barGrad.addColorStop(1, `hsl(${(col * 75 + row * 120 + 60) % 360}, 72%, 44%)`);
          ctx.fillStyle = barGrad;
          ctx.beginPath();
          ctx.arc(x + 260, y + 260, 150, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Deterministic subtle dither breaks lossless PNG scanline prediction while letting
      // downscaled lossy WebP compress tightly.
      const imageData = ctx.getImageData(0, 0, w, h);
      const { data } = imageData;
      for (let y = 0; y < h; y += 1) {
        const rowOffset = y * w * 4;
        const yHash = Math.imul(y + 1, 668265263);
        for (let x = y & 1; x < w; x += 2) {
          let hash = Math.imul(x + 1, 374761393) ^ yHash;
          hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
          hash ^= hash >>> 16;
          const idx = rowOffset + x * 4;
          data[idx] = (data[idx] ?? 0) + ((hash & 7) - 3);
          data[idx + 1] = (data[idx + 1] ?? 0) + (((hash >>> 3) & 7) - 3);
          data[idx + 2] = (data[idx + 2] ?? 0) + (((hash >>> 6) & 7) - 3);
        }
      }
      ctx.putImageData(imageData, 0, 0);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((result) => {
          if (result) resolve(result);
          else reject(new Error('Failed to encode PNG canvas'));
        }, 'image/png');
      });

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read PNG blob'));
        reader.readAsDataURL(blob);
      });
      return dataUrl.slice(dataUrl.indexOf(',') + 1);
    },
    { w: width, h: height }
  );

  return Buffer.from(base64, 'base64');
};

const measureImageDimensions = async (
  page: Page,
  bytes: Buffer,
  mimeType: string
): Promise<{ width: number; height: number }> =>
  page.evaluate(
    async ({ base64, type }) => {
      const binary = atob(base64);
      const raw = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        raw[index] = binary.charCodeAt(index);
      }
      const bitmap = await createImageBitmap(new Blob([raw], { type }));
      const dimensions = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return dimensions;
    },
    { base64: bytes.toString('base64'), type: mimeType }
  );

/**
 * Generates a synthetic > 1 MiB video clip in Chromium via Canvas + MediaRecorder (real VP8 WebM
 * stream so mediabunny can demux and decode real frames). Falls back to a > 1 MiB synthetic MP4
 * buffer if MediaRecorder is unavailable or produces a smaller clip in the test environment.
 */
const createSyntheticVideo = async (page: Page): Promise<GeneratedVideo> => {
  const recordedBase64 = await page.evaluate(async (minBytes) => {
    if (typeof MediaRecorder === 'undefined') return null;
    const candidateMimes = ['video/webm;codecs=vp8', 'video/webm'];
    const mimeType = candidateMimes.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    if (!mimeType) return null;

    const width = 1280;
    const height = 720;
    const mainCanvas = Object.assign(document.createElement('canvas'), { width, height });
    const mainCtx = mainCanvas.getContext('2d');
    const tileCanvas = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
    const tileCtx = tileCanvas.getContext('2d');
    if (!mainCtx || !tileCtx) return null;
    mainCtx.imageSmoothingEnabled = false;

    const tileImage = tileCtx.createImageData(320, 180);
    const tilePixels = new Uint32Array(tileImage.data.buffer);
    let seed = 0x12345678;
    let frameIndex = 0;

    const paintFrame = () => {
      frameIndex += 1;
      let state = (seed ^ Math.imul(frameIndex, 0x9e3779b1)) >>> 0;
      for (let index = 0; index < tilePixels.length; index += 1) {
        state ^= state << 13;
        state ^= state >>> 17;
        state ^= state << 5;
        tilePixels[index] = (state >>> 0) | 0xff000000;
      }
      seed = state;
      tileCtx.putImageData(tileImage, 0, 0);
      mainCtx.drawImage(tileCanvas, 0, 0, width, height);
      mainCtx.fillStyle = 'rgba(15, 23, 42, 0.75)';
      mainCtx.fillRect(48, 48, 420, 88);
      mainCtx.fillStyle = '#f8fafc';
      mainCtx.font = 'bold 36px sans-serif';
      mainCtx.fillText(`Synthetic Clip #${frameIndex}`, 72, 106);
    };

    paintFrame();

    const stream = mainCanvas.captureStream(30);
    const chunks: Blob[] = [];
    let totalBytes = 0;
    let stopRequested = false;

    try {
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 16_000_000,
      });

      const stopRecording = () => {
        if (stopRequested) return;
        stopRequested = true;
        if (recorder.state !== 'inactive') recorder.stop();
      };

      const done = new Promise<Blob | null>((resolve) => {
        const hardTimeout = window.setTimeout(() => {
          stopRecording();
          resolve(null);
        }, 6_000);

        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) {
            chunks.push(event.data);
            totalBytes += event.data.size;
          }
          if (totalBytes >= minBytes + 150_000 && frameIndex >= 15) {
            stopRecording();
          }
        };

        recorder.onerror = () => {
          window.clearTimeout(hardTimeout);
          resolve(null);
        };

        recorder.onstop = () => {
          window.clearTimeout(hardTimeout);
          resolve(new Blob(chunks, { type: 'video/webm' }));
        };
      });

      const painter = window.setInterval(paintFrame, 33);
      const maxDuration = window.setTimeout(stopRecording, 3_500);
      recorder.start(150);

      const blob = await done;
      window.clearInterval(painter);
      window.clearTimeout(maxDuration);
      for (const track of stream.getTracks()) track.stop();

      if (!blob || blob.size <= minBytes) return null;

      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error ?? new Error('Failed to read WebM blob'));
        reader.readAsDataURL(blob);
      });
      return dataUrl.slice(dataUrl.indexOf(',') + 1);
    } catch {
      for (const track of stream.getTracks()) track.stop();
      return null;
    }
  }, MIN_VIDEO_BYTES);

  if (recordedBase64) {
    const buffer = Buffer.from(recordedBase64, 'base64');
    if (buffer.byteLength > MIN_VIDEO_BYTES) {
      return { name: 'demo-recording.webm', mimeType: 'video/webm', buffer };
    }
  }

  // Fallback synthetic > 1 MiB MP4 buffer (valid ftyp header + mdat payload) when MediaRecorder
  // cannot emit a > 1 MiB clip in the current browser environment.
  const totalBytes = MIN_VIDEO_BYTES + 160_000;
  const fallback = Buffer.alloc(totalBytes);
  const ftypHeader = Buffer.from([
    0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, 0x69, 0x73, 0x6f, 0x32,
  ]);
  ftypHeader.copy(fallback, 0);
  fallback.writeUInt32BE(totalBytes - ftypHeader.length, ftypHeader.length);
  fallback.write('mdat', ftypHeader.length + 4, 'ascii');
  return { name: 'demo-recording.mp4', mimeType: 'video/mp4', buffer: fallback };
};

test('Settings -> Chats media compression selector defaults to Balanced and persists across reload', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { account } = await setupRoom(page, 'settings', { seedMessages: true });

  const openChatsSettings = async (): Promise<Locator> => {
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    if (!(await dialog.isVisible())) {
      await chooseFromAccountMenu(page, 'Settings');
    }
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('navigation', { name: 'Settings' })
      .getByRole('button', { name: 'Chats', exact: true })
      .click();
    await expect(dialog.locator('[data-setting-id="mediaCompression"]')).toBeVisible();
    return dialog;
  };

  const selectPreset = async (dialog: Locator, label: 'Off' | 'Balanced' | 'Small') => {
    const tile = dialog.locator('[data-setting-id="mediaCompression"]');
    const trigger = tile.getByRole('button');
    await trigger.click();
    const option = page.getByRole('menuitemradio', { name: label, exact: true });
    await expect(option).toBeVisible();
    await option.click();
    await expect(trigger).toHaveText(label);
  };

  let dialog = await openChatsSettings();
  const tile = () => dialog.locator('[data-setting-id="mediaCompression"]');
  const trigger = () => tile().getByRole('button');

  await expect(tile()).toContainText('Media compression');
  await expect(trigger()).toHaveText('Balanced');

  if (SHOTS_DIR) {
    mkdirSync(SHOTS_DIR, { recursive: true });
    const editorSection = dialog
      .locator('[data-settings-heading]', { hasText: 'Editor' })
      .locator('xpath=..');
    await expect(editorSection).toBeVisible();
    await waitForUiSettle(page);
    const editorBox = await editorSection.boundingBox();
    const viewport = page.viewportSize();
    if (editorBox && viewport) {
      await page.screenshot({
        path: path.join(SHOTS_DIR, 'settings-chats-compression.png'),
        clip: unionRects([editorBox], 16, viewport),
      });
    }
  }

  // Switch to Small and verify persistence across reload.
  await selectPreset(dialog, 'Small');
  await expect.poll(() => readAccountMediaCompression(account), { timeout: 30_000 }).toBe('small');

  await page.reload();
  await waitForLoggedInShell(page);
  await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible({ timeout: 60_000 });
  dialog = await openChatsSettings();
  await expect(trigger()).toHaveText('Small');

  // Switch to Off and verify persistence across reload.
  await selectPreset(dialog, 'Off');
  await expect.poll(() => readAccountMediaCompression(account), { timeout: 30_000 }).toBe('off');

  await page.reload();
  await waitForLoggedInShell(page);
  await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible({ timeout: 60_000 });
  dialog = await openChatsSettings();
  await expect(trigger()).toHaveText('Off');

  // Switch back to Balanced and verify persistence across reload.
  await selectPreset(dialog, 'Balanced');
  await expect
    .poll(() => readAccountMediaCompression(account), { timeout: 30_000 })
    .toBe('balanced');

  await page.reload();
  await waitForLoggedInShell(page);
  await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible({ timeout: 60_000 });
  dialog = await openChatsSettings();
  await expect(trigger()).toHaveText('Balanced');
});

test('compresses large PNG to WebP on attach, supports Use original, and sends cleanly', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const chunks = trackChunkRequests(page);
  const { account, roomId } = await setupRoom(page, 'image', { seedMessages: true });

  expect(await chunks.hasLoaded(IMAGE_CHUNK_RE)).toBe(false);
  expect(await chunks.hasLoaded(VIDEO_CHUNK_RE)).toBe(false);

  const pngBuffer = await drawHighEntropyPng(page, 2600, 1600);
  expect(pngBuffer.byteLength).toBeGreaterThan(150 * 1024);

  const compressedUploadPromise = waitForMediaUpload(page, ['dashboard-capture.webp']);
  await attachSingleFile(page, {
    name: 'dashboard-capture.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });

  await expect.poll(() => chunks.hasLoaded(IMAGE_CHUNK_RE), { timeout: 30_000 }).toBe(true);
  expect(await chunks.hasLoaded(VIDEO_CHUNK_RE)).toBe(false);

  const compressedResponse = await compressedUploadPromise;
  const compressedMxc = await parseUploadMxc(compressedResponse);
  const uploadedWebp = await downloadMatrixMedia(account.accessToken, compressedMxc);

  expect(uploadedWebp.contentType).toMatch(/^image\/webp\b/i);
  expect(uploadedWebp.bytes.subarray(0, 4).toString('ascii')).toBe('RIFF');
  expect(uploadedWebp.bytes.subarray(8, 12).toString('ascii')).toBe('WEBP');
  expect(uploadedWebp.bytes.byteLength).toBeLessThan(Math.floor(pngBuffer.byteLength * 0.5));

  const uploadedDims = await measureImageDimensions(page, uploadedWebp.bytes, 'image/webp');
  expect(uploadedDims.width).toBeLessThanOrEqual(2048);
  expect(uploadedDims.height).toBeLessThanOrEqual(2048);
  expect(uploadedDims).toEqual({ width: 2048, height: 1260 });

  const uploadBoard = getUploadBoard(page);
  await expect(uploadBoard).toBeVisible();
  await expect(uploadBoard.getByText('dashboard-capture.webp', { exact: true })).toBeVisible();

  const expectedReductionText = `${bytesToSize(pngBuffer.byteLength)} ${ARROW} ${bytesToSize(uploadedWebp.bytes.byteLength)}`;
  await expect(uploadBoard.getByText(expectedReductionText, { exact: true })).toBeVisible();

  const useOriginalButton = uploadBoard.getByRole('button', { name: 'Use original', exact: true });
  await expect(useOriginalButton).toBeVisible();
  await waitForUploadSuccessIcon(uploadBoard);

  const previewDims = await uploadBoard
    .locator('img')
    .first()
    .evaluate((image: HTMLImageElement) => ({
      width: image.naturalWidth,
      height: image.naturalHeight,
    }));
  expect(previewDims).toEqual({ width: 2048, height: 1260 });

  if (SHOTS_DIR) {
    mkdirSync(SHOTS_DIR, { recursive: true });
    await waitForUiSettle(page);
    const boardBox = await uploadBoard.boundingBox();
    const composerBox = await page.locator('[data-room-footer] [data-editor-layout]').boundingBox();
    const viewport = page.viewportSize();
    if (boardBox && composerBox && viewport) {
      await page.screenshot({
        path: path.join(SHOTS_DIR, 'upload-card-compressed.png'),
        clip: unionRects([boardBox, composerBox], 20, viewport),
      });
    }
  }

  // Click Use original and verify the card and Matrix upload revert to the full PNG.
  const originalUploadPromise = waitForMediaUpload(page, ['dashboard-capture.png']);
  await useOriginalButton.click();

  await expect(uploadBoard.getByText('dashboard-capture.png', { exact: true })).toBeVisible();
  await expect(uploadBoard.getByText('dashboard-capture.webp', { exact: true })).toHaveCount(0);
  await expect(
    uploadBoard.getByText(bytesToSize(pngBuffer.byteLength), { exact: true })
  ).toBeVisible();
  await expect(uploadBoard.getByText(expectedReductionText, { exact: true })).toHaveCount(0);
  await expect(useOriginalButton).toHaveCount(0);

  const originalResponse = await originalUploadPromise;
  const originalMxc = await parseUploadMxc(originalResponse);
  const uploadedOriginal = await downloadMatrixMedia(account.accessToken, originalMxc);
  expect(uploadedOriginal.contentType).toMatch(/^image\/png\b/i);
  expect(uploadedOriginal.bytes.byteLength).toBe(pngBuffer.byteLength);
  await waitForUploadSuccessIcon(uploadBoard);

  // Send the reverted original PNG and verify it lands in the room timeline.
  await sendWithCaption(page, 'Original screenshot attached');
  await expect(uploadBoard).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText('Original screenshot attached', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('img[alt="dashboard-capture.png"]')).toBeVisible({ timeout: 60_000 });

  await expect
    .poll(async () => {
      const messages = await latestRoomMessages(account, roomId);
      return messages.find(
        (event) =>
          event.content.msgtype === 'm.image' && event.content.body === 'dashboard-capture.png'
      )?.content;
    })
    .toMatchObject({
      msgtype: 'm.image',
      body: 'dashboard-capture.png',
      url: originalMxc,
      info: expect.objectContaining({
        mimetype: 'image/png',
        size: pngBuffer.byteLength,
        w: 2600,
        h: 1600,
      }),
    });

  // Also verify sending a compressed WebP without reverting writes image/webp <= 2048 to the room.
  const secondUploadPromise = waitForMediaUpload(page, ['compressed-send.webp']);
  await attachSingleFile(page, {
    name: 'compressed-send.png',
    mimeType: 'image/png',
    buffer: pngBuffer,
  });
  const secondMxc = await parseUploadMxc(await secondUploadPromise);
  await expect(uploadBoard.getByText('compressed-send.webp', { exact: true })).toBeVisible();
  await waitForUploadSuccessIcon(uploadBoard);

  await sendWithCaption(page, 'Compressed screenshot attached');
  await expect(uploadBoard).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText('Compressed screenshot attached', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('img[alt="compressed-send.webp"]')).toBeVisible({ timeout: 60_000 });

  await expect
    .poll(async () => {
      const messages = await latestRoomMessages(account, roomId);
      return messages.find(
        (event) =>
          event.content.msgtype === 'm.image' && event.content.body === 'compressed-send.webp'
      )?.content;
    })
    .toMatchObject({
      msgtype: 'm.image',
      body: 'compressed-send.webp',
      url: secondMxc,
      info: expect.objectContaining({
        mimetype: 'image/webp',
        w: 2048,
        h: 1260,
      }),
    });
});

test('attaching a > 1 MiB video loads lazy mediabunny chunk, compresses or falls back cleanly, and sends', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const pageErrors: Error[] = [];
  page.on('pageerror', (error) => {
    pageErrors.push(error);
  });

  const chunks = trackChunkRequests(page);
  const { account, roomId } = await setupRoom(page, 'video', { seedMessages: true });

  const hasWebCodecs = await page.evaluate(
    () => typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined'
  );
  expect(hasWebCodecs).toBe(true);
  expect(await chunks.hasLoaded(VIDEO_CHUNK_RE)).toBe(false);

  const video = await createSyntheticVideo(page);
  expect(video.buffer.byteLength).toBeGreaterThan(MIN_VIDEO_BYTES);

  const expectedFilenames = Array.from(new Set(['demo-recording.mp4', video.name]));
  const uploadPromise = waitForMediaUpload(page, expectedFilenames, 90_000);

  await attachSingleFile(page, video);

  // Lazy compressVideo (mediabunny) chunk must load only after attaching the > 1 MiB video.
  await expect.poll(() => chunks.hasLoaded(VIDEO_CHUNK_RE), { timeout: 30_000 }).toBe(true);

  const uploadResponse = await uploadPromise;
  const uploadedMxc = await parseUploadMxc(uploadResponse);
  const uploadedMedia = await downloadMatrixMedia(account.accessToken, uploadedMxc);

  const uploadBoard = getUploadBoard(page);
  await expect(uploadBoard).toBeVisible();
  await expect(uploadBoard.getByText('Compressing...', { exact: true })).toHaveCount(0, {
    timeout: 60_000,
  });
  await waitForUploadSuccessIcon(uploadBoard);

  const useOriginalButton = uploadBoard.getByRole('button', { name: 'Use original', exact: true });
  const compressedToMp4 = await useOriginalButton.isVisible();

  let expectedTimelineName: string;
  if (compressedToMp4) {
    expectedTimelineName = 'demo-recording.mp4';
    await expect(uploadBoard.getByText(expectedTimelineName, { exact: true })).toBeVisible();
    const expectedReductionText = `${bytesToSize(video.buffer.byteLength)} ${ARROW} ${bytesToSize(uploadedMedia.bytes.byteLength)}`;
    await expect(uploadBoard.getByText(expectedReductionText, { exact: true })).toBeVisible();
    expect(uploadedMedia.contentType).toMatch(/^video\/mp4\b/i);
    expect(uploadedMedia.bytes.byteLength).toBeLessThan(video.buffer.byteLength);
    expect(uploadedMedia.bytes.subarray(4, 8).toString('ascii')).toBe('ftyp');
  } else {
    expectedTimelineName = video.name;
    await expect(uploadBoard.getByText(expectedTimelineName, { exact: true })).toBeVisible();
    await expect(
      uploadBoard.getByText(bytesToSize(video.buffer.byteLength), { exact: true })
    ).toBeVisible();
    expect(uploadedMedia.bytes.byteLength).toBe(video.buffer.byteLength);
    expect(uploadedMedia.contentType).toContain(video.mimeType);
  }

  await sendWithCaption(page, 'Video clip attached');
  await expect(uploadBoard).toHaveCount(0, { timeout: 60_000 });
  await expect(page.getByText('Video clip attached', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(
    page.locator(`[data-message-id] [title="${expectedTimelineName}"]`).last()
  ).toBeVisible({ timeout: 60_000 });

  await expect
    .poll(async () => {
      const messages = await latestRoomMessages(account, roomId);
      return messages.find(
        (event) =>
          event.content.msgtype === 'm.video' && event.content.body === expectedTimelineName
      )?.content;
    })
    .toMatchObject({
      msgtype: 'm.video',
      body: expectedTimelineName,
      url: uploadedMxc,
      info: expect.objectContaining({
        size: uploadedMedia.bytes.byteLength,
      }),
    });

  expect(pageErrors).toEqual([]);
});
