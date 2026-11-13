import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { buildLoginPath } from '../env';
import { createDefaultThreadFilterState, seedRoomOverviewState } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Attachments against the disposable homeserver of `just hs-up`: a large picture goes out with a
// thumbnail that the timeline shows while the viewer opens the original, an encrypted room
// decrypts both for the other person, files download whole, spoilers stay hidden until revealed,
// and a file over the server's upload limit fails at once without holding back the rest.
const PASSWORD = 'media-spec-password';

const matrix = async <T>(path: string, init: { token?: string; body?: unknown } = {}) => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    method: init.body ? 'POST' : 'GET',
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

/** A room both people have joined, made through sessions that sign out again. */
const createSharedRoom = async (
  owner: string,
  guest: string,
  { encrypted }: { encrypted: boolean }
): Promise<string> => {
  const ownerToken = await register(owner);
  const guestToken = await register(guest);
  const { room_id: roomId } = await matrix<{ room_id: string }>('/createRoom', {
    token: ownerToken,
    body: {
      name: encrypted ? 'Harbor Survey' : 'Upload Desk',
      preset: 'private_chat',
      invite: [`@${guest}:matrix.localhost`],
      initial_state: encrypted
        ? [
            {
              type: 'm.room.encryption',
              state_key: '',
              content: { algorithm: 'm.megolm.v1.aes-sha2' },
            },
          ]
        : [],
    },
  });
  await matrix(`/join/${encodeURIComponent(roomId)}`, { token: guestToken, body: {} });
  await matrix('/logout', { token: ownerToken, body: {} });
  await matrix('/logout', { token: guestToken, body: {} });
  return roomId;
};

const signIn = async (browser: Browser, username: string): Promise<Page> => {
  const page = await (await browser.newContext()).newPage();
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 90_000 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return page;
};

/**
 * Opens the room in the Full view, where each message is its own row. A room without agents
 * opens in Threads and its switch returns there, so the spec chooses Classic for it.
 */
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

/** A JPEG of the given size, drawn by the browser so the picture really decodes. */
const drawPicture = async (page: Page, width: number, height: number): Promise<Buffer> => {
  const base64 = await page.evaluate(
    async ({ w, h }) => {
      const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
      const context = canvas.getContext('2d')!;
      const gradient = context.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, '#1d4ed8');
      gradient.addColorStop(1, '#f97316');
      context.fillStyle = gradient;
      context.fillRect(0, 0, w, h);
      const blob = await new Promise<Blob>((resolve) => {
        canvas.toBlob((result) => resolve(result!), 'image/jpeg', 0.9);
      });
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = '';
      bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
      });
      return btoa(binary);
    },
    { w: width, h: height }
  );
  return Buffer.from(base64, 'base64');
};

type StagedFile = { name: string; mimeType: string; buffer: Buffer };

const stageFiles = async (page: Page, files: StagedFile[]) => {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Attach files', exact: true }).click();
  await (await chooser).setFiles(files);
  for (const file of files) {
    await expect(page.getByText(file.name, { exact: true }).first()).toBeVisible();
  }
};

const sendWithCaption = async (page: Page, caption: string) => {
  await page.locator('[data-editable-name="RoomInput"]').click();
  await page.keyboard.type(caption);
  await page.keyboard.press('Enter');
};

const naturalWidth = (page: Page, selector: string) =>
  page
    .locator(selector)
    .last()
    .evaluate((image: HTMLImageElement) => image.naturalWidth);

test('pictures and files reach the other person in an encrypted room', async ({ browser }) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(300_000);

  const stamp = Date.now().toString(36);
  const roomId = await createSharedRoom(`ines_${stamp}`, `omar_${stamp}`, { encrypted: true });

  // The reader's session exists before anything is sent, so the room key reaches it.
  const reader = await signIn(browser, `omar_${stamp}`);
  await openFullRoom(reader, roomId, `omar_${stamp}`);
  const sender = await signIn(browser, `ines_${stamp}`);
  await openFullRoom(sender, roomId, `ines_${stamp}`);

  const notes = 'Tide tables for the survey, version 3\n';
  await stageFiles(sender, [
    { name: 'harbor.jpg', mimeType: 'image/jpeg', buffer: await drawPicture(sender, 1600, 1000) },
    { name: 'tides.txt', mimeType: 'text/plain', buffer: Buffer.from(notes) },
  ]);
  await sendWithCaption(sender, 'Survey pictures');
  await expect(sender.getByText('Survey pictures', { exact: true })).toBeVisible({
    timeout: 60_000,
  });

  // Both timelines show the 800 pixel thumbnail rather than the whole picture.
  for (const page of [sender, reader]) {
    const picture = page.locator('img[alt="harbor.jpg"]');
    await expect(picture).toBeVisible({ timeout: 60_000 });
    await expect.poll(() => naturalWidth(page, 'img[alt="harbor.jpg"]')).toBe(800);
  }

  // The viewer opens the original.
  await reader.locator('img[alt="harbor.jpg"]').click();
  const viewer = reader.locator('[data-image-viewer]');
  await expect(viewer).toBeVisible();
  await expect.poll(() => naturalWidth(reader, '[data-image-viewer] img')).toBe(1600);
  await reader.keyboard.press('Escape');
  await expect(viewer).toHaveCount(0);

  // The file downloads decrypted and whole.
  const fileRow = reader.locator('[data-message-id]').filter({ hasText: 'tides.txt' });
  const download = reader.waitForEvent('download');
  await fileRow.getByRole('button', { name: /download/i }).click();
  const saved = await download;
  expect(saved.suggestedFilename()).toBe('tides.txt');
  const stream = await saved.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  expect(Buffer.concat(chunks).toString()).toBe(notes);
});

test('spoilers stay hidden and an oversize file does not hold back the rest', async ({
  browser,
}) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(240_000);

  const stamp = Date.now().toString(36);
  const roomId = await createSharedRoom(`lena_${stamp}`, `teo_${stamp}`, { encrypted: false });
  const page = await signIn(browser, `lena_${stamp}`);
  // The server allows uploads of 4 KB in this test.
  await page.route('**/media/config', (route) =>
    route.fulfill({ status: 200, json: { 'm.upload.size': 4_000 } })
  );
  await openFullRoom(page, roomId, `lena_${stamp}`);

  await stageFiles(page, [
    { name: 'plot-twist.jpg', mimeType: 'image/jpeg', buffer: await drawPicture(page, 40, 30) },
    { name: 'archive.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(8_000) },
    { name: 'summary.txt', mimeType: 'text/plain', buffer: Buffer.from('All findings, short.\n') },
  ]);
  await expect(page.getByText(/File is too large\. Maximum upload size is/)).toBeVisible();
  await page.getByRole('button', { name: 'Spoiler', exact: true }).click();
  await sendWithCaption(page, 'Findings attached');

  // The caption and the files within the limit go out; the oversize file stays with its error.
  await expect(page.getByText('Findings attached', { exact: true })).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.locator('[data-message-id]').filter({ hasText: 'summary.txt' })).toBeVisible();
  await expect(page.locator('[data-message-id]').filter({ hasText: 'archive.bin' })).toHaveCount(0);
  await expect(page.getByText(/File is too large\. Maximum upload size is/)).toBeVisible();

  // The spoiler hides the picture until it is revealed.
  const reveal = page
    .locator('[data-message-id]')
    .getByRole('button', { name: 'Spoiler', exact: true });
  await expect(reveal).toBeVisible();
  await reveal.click();
  await expect(reveal).toHaveCount(0);
  await expect(page.locator('img[alt="plot-twist.jpg"]')).toBeVisible();
});
