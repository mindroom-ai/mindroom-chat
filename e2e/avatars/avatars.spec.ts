import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createThreadFixture,
  joinRoom,
  matrixFetch,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';
import { defined } from '../../src/test/utils/defined';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Avatars come from MXC everywhere they show (rail, room list, header, members, Compact bars,
// messages), with or without a service worker to authenticate the media requests, and an agent
// reply's model name sits centred under the agent's avatar, its provider's logo on the corner.

test.use({ video: 'off' });

// A solid square PNG, so the spec carries its own pictures.
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes: Buffer) => {
  let c = 0xffffffff;
  for (const byte of bytes) c = defined(crcTable[(c ^ byte) & 0xff], 'a CRC entry') ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([length, typed, crc]);
};
const squarePng = (edge: number, [r, g, b]: [number, number, number]) => {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(edge, 0);
  header.writeUInt32BE(edge, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array(edge).fill([r, g, b]).flat())]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.concat(Array(edge).fill(row)))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};

const upload = async (accessToken: string, png: Buffer) => {
  const response = await fetch(`${HOMESERVER}/_matrix/media/v3/upload?filename=avatar.png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/png' },
    body: png,
  });
  expect(response.ok).toBe(true);
  return ((await response.json()) as { content_uri: string }).content_uri;
};

const routeConfig = (context: BrowserContext) =>
  context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [HOMESERVER],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
      },
    });
  });

/** Every image the locator finds has loaded a picture. */
const expectLoaded = async (images: Locator, minimum = 1) => {
  await expect
    .poll(
      () =>
        images.evaluateAll((nodes) =>
          nodes.map((node) => {
            const image = node as HTMLImageElement;
            return image.complete && image.naturalWidth > 0;
          })
        ),
      { timeout: 20_000 }
    )
    .toEqual(expect.arrayContaining([true]));
  const states = await images.evaluateAll((nodes) =>
    nodes.map(
      (node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth > 0
    )
  );
  expect(states.length).toBeGreaterThanOrEqual(minimum);
  expect(states.every(Boolean)).toBe(true);
};

type Seeded = { username: string; password: string; roomId: string; rootId: string };

const seed = async (): Promise<Seeded> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const password = randomUUID();
  const register = async (username: string, displayname: string, rgb: [number, number, number]) => {
    const account = await matrixFetch<{ access_token: string; user_id: string }>(
      HOMESERVER,
      '/register',
      {
        method: 'POST',
        body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
      }
    );
    const profile = `/profile/${encodeURIComponent(account.user_id)}`;
    const avatarUrl = await upload(account.access_token, squarePng(128, rgb));
    for (const [field, value] of Object.entries({ displayname, avatar_url: avatarUrl })) {
      // eslint-disable-next-line no-await-in-loop
      await matrixFetch(HOMESERVER, `${profile}/${field}`, {
        method: 'PUT',
        accessToken: account.access_token,
        body: JSON.stringify({ [field]: value }),
      });
    }
    return account;
  };

  const username = `avatar_viewer_${suffix}`;
  const viewer = await register(username, 'Avery Viewer', [200, 80, 60]);
  const agent = await register(`mindroom_research_${suffix}`, 'Research', [60, 150, 120]);
  const fixture = await createThreadFixture(HOMESERVER, viewer.access_token, {
    name: 'Avatar Room',
    topic: 'Pictures everywhere',
    rootBody: 'Compare the churn numbers',
    replyBody: 'With last quarter, please',
    invite: [agent.user_id],
  });
  await joinRoom(HOMESERVER, agent.access_token, fixture.roomId);
  await sendStateEvent(HOMESERVER, viewer.access_token, fixture.roomId, 'm.room.avatar', '', {
    url: await upload(viewer.access_token, squarePng(128, [70, 90, 200])),
  });
  await sendRoomMessage(HOMESERVER, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Churn came in at 2.9%, down from 3.4%.',
    'io.mindroom.stream_status': 'completed',
    'io.mindroom.ai_run': {
      version: 1,
      status: 'completed',
      model: {
        config: 'sonnet',
        display_name: 'Claude Sonnet 5.5',
        id: 'claude-sonnet-5-5',
        provider: 'anthropic',
      },
    },
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: fixture.rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: fixture.replyId },
    },
  });
  return { username, password, roomId: fixture.roomId, rootId: fixture.rootId };
};

const checkAvatars = async (page: Page, seeded: Seeded) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.username,
    password: seeded.password,
  });
  // The account avatar on the rail.
  await expectLoaded(page.locator('button[aria-label^="Open account menu for "] img'));

  await page.goto(`/home/${encodeURIComponent(seeded.roomId)}/`);
  await expect(page.getByText('Compare the churn numbers').first()).toBeVisible({
    timeout: 30_000,
  });
  // The room's picture in the room list and the header, the faces on the Compact bar, and the
  // members.
  await expectLoaded(page.locator('img[alt="Avatar Room"]'), 2);
  await expectLoaded(page.locator('[data-compact-card-metadata] img'), 2);
  if ((await page.locator('img[alt="Research"]').count()) === 0) {
    await page
      .getByRole('button', { name: /show members/i })
      .first()
      .click();
  }
  await expectLoaded(page.locator('img[alt="Research"]'));
  await expectLoaded(page.locator('img[alt="Avery Viewer"]'));

  await page.goto(
    `/home/${encodeURIComponent(seeded.roomId)}/?threadId=${encodeURIComponent(seeded.rootId)}`
  );
  const reply = page.locator('[data-message-id]').filter({ hasText: 'Churn came in at 2.9%' });
  await expect(reply).toBeVisible({ timeout: 30_000 });
  const avatar = reply.locator('img[alt="Research"]');
  await expectLoaded(avatar);
  await expectLoaded(page.locator('[data-message-id] img[alt="Avery Viewer"]'));

  // The name hangs centred under the avatar, at most 4 px past it on each side and two lines tall,
  // the provider's logo sits over the avatar's bottom corner on the text's side, and the sender's
  // name beside the avatar stays clear of all three. Measured in one pass, as rows re-render.
  await expect(reply.getByLabel(/^Model: /)).toBeVisible();
  const layout = () =>
    reply.evaluate((row) => {
      const image = row.querySelector('img[alt="Research"]');
      const face = image?.getBoundingClientRect();
      const mark = image?.closest('[data-user-id]')?.nextElementSibling?.getBoundingClientRect();
      const button = row.querySelector('[aria-label^="Model: "]');
      const label = button?.firstElementChild?.getBoundingClientRect();
      const name = [...row.querySelectorAll('button, span')]
        .find((node) => node.textContent === 'Research')
        ?.getBoundingClientRect();
      if (!face || !mark || !button || !label || !name) return 'missing';
      const badge = button.getBoundingClientRect();
      return {
        gapBelow: Math.round(badge.top - face.bottom),
        offCentre: Math.round(
          Math.abs(badge.left + badge.width / 2 - (face.left + face.width / 2))
        ),
        widerBy: Math.round(badge.width - face.width),
        lines: Math.round(label.height / 12),
        markPastCorner: [
          Math.round(mark.right - face.right),
          Math.round(mark.bottom - face.bottom),
        ],
        nameClear: name.left >= mark.right && name.left >= badge.right,
      };
    });
  await expect.poll(layout).not.toBe('missing');
  const measured = await layout();
  expect(measured).toMatchObject({ offCentre: 0, markPastCorner: [4, 4], nameClear: true });
  if (typeof measured === 'string') throw new Error(measured);
  expect(measured.gapBelow).toBeGreaterThanOrEqual(0);
  expect(measured.gapBelow).toBeLessThanOrEqual(8);
  // "Claude Sonnet 5.5" is wider than 44 px, so it takes the whole 4 px on each side.
  expect(measured.widerBy).toBe(8);
  expect(measured.lines).toBeGreaterThanOrEqual(1);
  expect(measured.lines).toBeLessThanOrEqual(2);
};

for (const serviceWorkers of ['allow', 'block'] as const) {
  test.describe(`avatars with service workers ${
    serviceWorkers === 'allow' ? 'on' : 'blocked'
  }`, () => {
    test.use({ serviceWorkers });

    test('load from MXC on every screen and keep the model badge under the agent', async ({
      page,
      context,
    }, testInfo) => {
      test.skip(
        !(await disposableHomeserverIsUp()),
        `No homeserver at ${HOMESERVER}; run \`just hs-up\``
      );
      test.slow();
      const seeded = await seed();
      await routeConfig(context);
      await checkAvatars(page, seeded);
      await page.screenshot({ path: testInfo.outputPath('thread.png') });
    });
  });
}
