import { crc32, deflateSync } from 'node:zlib';
import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { joinRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Opening a room full of pictures and files fetches only what the person can see: thumbnails for
// the pictures near the viewport, and files only when someone opens or saves them. Checked against
// the slot's Tuwunel with real uploads. Set MEDIA_ROOM_SHOTS=<directory> to save the room.
const PASSWORD = 'media-room-requests-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.MEDIA_ROOM_SHOTS;
const IMAGES = 40;
const FILES = 40;

/** A small PNG of two colour bands, so each picture looks different in screenshots. */
const png = (index: number): Buffer => {
  const width = 160;
  const height = 120;
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const hue = (index * 47) % 256;
  const rows = Array.from({ length: height }, (_, y) => {
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
      const top = y < height / 2;
      row.set(top ? [hue, 120, 255 - hue] : [40, hue, 160], 1 + x * 3);
    }
    return row;
  });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

test.use({ viewport: { width: 1280, height: 800 } });

const register = async (name: string) => {
  const username = `mrr_${name}_${RUN}`;
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

const upload = async (accessToken: string, bytes: Buffer, type: string): Promise<string> => {
  const response = await fetch(`${HOMESERVER}/_matrix/media/v3/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': type },
    body: bytes,
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { content_uri: string }).content_uri;
};

/** Pictures first, then text files: the room opens at the files, the pictures above them. */
const seedMediaRoom = async () => {
  const reader = await register('reader');
  const writer = await register('writer');
  const roomId = await createRoom(HOMESERVER, writer.accessToken, {
    name: 'Media Room',
    invite: [reader.userId],
  });
  await joinRoom(HOMESERVER, reader.accessToken, roomId);
  const kinds = new Map<string, 'image' | 'file'>();
  for (let index = 0; index < IMAGES; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const url = await upload(writer.accessToken, png(index), 'image/png');
    kinds.set(url.split('/').pop()!, 'image');
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
      msgtype: 'm.image',
      body: `photo-${String(index).padStart(3, '0')}.png`,
      url,
      // A phone photo's size, as the sender declares it.
      info: { mimetype: 'image/png', w: 1600, h: 1200, size: 2_400_000 },
    });
  }
  for (let index = 0; index < FILES; index += 1) {
    const text = `notes ${index}\n${'line of meeting notes for the planning review\n'.repeat(200)}`;
    // eslint-disable-next-line no-await-in-loop
    const url = await upload(writer.accessToken, Buffer.from(text), 'text/plain');
    kinds.set(url.split('/').pop()!, 'file');
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, writer.accessToken, roomId, {
      msgtype: 'm.file',
      body: `notes-${String(index).padStart(3, '0')}.txt`,
      url,
      info: { mimetype: 'text/plain', size: text.length },
    });
  }
  return { reader, kinds };
};

type MediaRequest = { kind: 'image' | 'file' | 'other'; endpoint: string };

const recordMediaRequests = (page: Page, kinds: Map<string, 'image' | 'file'>) => {
  const requests: MediaRequest[] = [];
  page.on('request', (request) => {
    const match =
      /\/_matrix\/(?:client\/v1|media\/v3)\/media\/(download|thumbnail)\/[^/]+\/([^/?#]+)/.exec(
        request.url()
      );
    const [, endpoint, mediaId] = match ?? [];
    if (endpoint && mediaId) requests.push({ endpoint, kind: kinds.get(mediaId) ?? 'other' });
  });
  return requests;
};

/** Waits until no new media request started for a second. */
const settle = async (requests: MediaRequest[]) => {
  let last = -1;
  await expect
    .poll(
      () => {
        const settled = requests.length === last;
        last = requests.length;
        return settled;
      },
      { intervals: [1_000], timeout: 30_000 }
    )
    .toBe(true);
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a media room loads thumbnails near the viewport and files only on request @webkit', async ({
  page,
}) => {
  test.setTimeout(180_000);
  const { reader, kinds } = await seedMediaRoom();
  const requests = recordMediaRequests(page, kinds);
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: reader.username,
    password: PASSWORD,
  });
  await page.getByText('Media Room', { exact: true }).first().click();
  await expect(page.getByText('notes-039.txt', { exact: true })).toBeVisible({ timeout: 20_000 });
  await settle(requests);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/media-room-open.png` });
  const atOpen = requests.slice();

  // Up to the pictures: each one near the viewport loads once, as a thumbnail.
  const timeline = page.getByText('notes-039.txt', { exact: true });
  const box = (await timeline.boundingBox())!;
  await page.mouse.move(box.x, box.y);
  await expect
    .poll(
      async () => {
        await page.mouse.wheel(0, -1500);
        return page.getByRole('img', { name: 'photo-020.png' }).isVisible();
      },
      { intervals: [300], timeout: 60_000 }
    )
    .toBe(true);
  await settle(requests);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/media-room-pictures.png` });

  // eslint-disable-next-line no-console
  console.log(
    'MEDIA',
    JSON.stringify({
      atOpen: atOpen.length,
      atOpenFiles: atOpen.filter((request) => request.kind === 'file').length,
      total: requests.length,
      byKind: requests.reduce<Record<string, number>>((counts, request) => {
        const key = `${request.kind}:${request.endpoint}`;
        return { ...counts, [key]: (counts[key] ?? 0) + 1 };
      }, {}),
    })
  );
  expect(atOpen.filter((request) => request.kind !== 'other')).toEqual([]);
  expect(requests.filter((request) => request.kind === 'file')).toEqual([]);
  const pictures = requests.filter((request) => request.kind === 'image');
  expect(pictures.length).toBeGreaterThan(0);
  expect(pictures.length).toBeLessThan(IMAGES);
  expect(pictures.every((request) => request.endpoint === 'thumbnail')).toBe(true);

  // The viewer shows the original, loaded when it opens.
  const shown = requests.length;
  await page.getByRole('img', { name: 'photo-020.png' }).click();
  await expect(page.getByRole('dialog', { name: 'photo-020.png' })).toBeVisible();
  await expect
    .poll(() =>
      requests
        .slice(shown)
        .filter((request) => request.kind !== 'other' && request.endpoint === 'download')
    )
    .toEqual([{ kind: 'image', endpoint: 'download' }]);
});
