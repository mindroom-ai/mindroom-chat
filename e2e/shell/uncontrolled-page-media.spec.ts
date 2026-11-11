import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import {
  createPrivateRoom,
  seedRoomOverviewState,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';

// Media on a homeserver that refuses the legacy media endpoints, which every request routed here
// to `/_matrix/media/v3/` (or r0) stands in for. Timeline pictures are fetched with the access
// token in a header; custom emoji are plain images, which only the service worker can sign. A page
// loaded past the worker (a hard reload) gets it without another reload, and its custom emoji
// load; a window where no worker can run says why they cannot.

test.use({ serviceWorkers: 'allow' });

// A 32x32 PNG of a yellow face.
const FACE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAvUlEQVR42u2XzQ2AIAyFGcKz8eiIjuUg7oQnjVEKr39SE0l6a30fUEub0pfWuqSMmLto3qaimcMgogiMSpwrTIF0ERdBWIuzILzEIQhv8SZECIBa4DwOp2l8DgjW7q8fpgQQH/IUQgCgx28B8LgGJPksc0AE4PE3/ACxAO4QaDKhySuqA1oIKr5Yjt8GgB8jKQRr9wgAB6IWI+oJ0BLb8lN3RaV6j74Bpn0hR7h7Z2wyG3QZTEKMZiGGU++1A80Cfm5xLM63AAAAAElFTkSuQmCC',
  'base64'
);
const PASSWORD = 'uncontrolled-page-media-password';
const LEGACY_MEDIA = /\/_matrix\/media\/(?:v3|r0)\/(?:download|thumbnail)\//;
const NOTICE =
  "Images can't load in this window: the browser runs no service worker for MindRoom here.";

type Fixture = { user: DisposableUser; roomId: string; imageEventId: string };

/** A new account with a room that has a custom emoji pack and one image message. */
const roomWithMedia = async (username: string): Promise<Fixture> => {
  const user = await registerDisposableUser(username, PASSWORD);
  const upload = await fetch(`${DISPOSABLE_HOMESERVER}/_matrix/media/v3/upload?filename=face.png`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png', Authorization: `Bearer ${user.accessToken}` },
    body: FACE_PNG,
  });
  expect(upload.ok, `upload answered ${upload.status}`).toBe(true);
  const { content_uri: mxc } = (await upload.json()) as { content_uri: string };
  const roomId = await createPrivateRoom(DISPOSABLE_HOMESERVER, user.accessToken, {
    name: 'Media Check',
    topic: 'Custom emoji and a picture.',
  });
  await sendStateEvent(
    DISPOSABLE_HOMESERVER,
    user.accessToken,
    roomId,
    'im.ponies.room_emotes',
    '',
    {
      pack: { display_name: 'Faces', usage: ['emoticon'] },
      images: { 'party-parrot': { url: mxc, info: { mimetype: 'image/png', w: 32, h: 32 } } },
    }
  );
  const imageEventId = await sendRoomMessage(
    DISPOSABLE_HOMESERVER,
    user.accessToken,
    roomId,
    {
      msgtype: 'm.image',
      body: 'face.png',
      url: mxc,
      info: { mimetype: 'image/png', w: 32, h: 32, size: FACE_PNG.length },
    },
    `media-${Date.now()}`
  );
  return { user, roomId, imageEventId };
};

/** Refuses legacy media as such a homeserver does, and counts each request for it. */
const refuseLegacyMedia = async (context: BrowserContext): Promise<string[]> => {
  const legacy: string[] = [];
  await context.route(LEGACY_MEDIA, (route) => {
    legacy.push(route.request().url());
    return route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({ errcode: 'M_FORBIDDEN', error: 'Legacy media is turned off' }),
    });
  });
  return legacy;
};

const signInToRoom = async (page: Page, { user, roomId }: Fixture): Promise<void> => {
  await loginWithPassword(page, {
    homeserver: DISPOSABLE_HOMESERVER,
    username: user.username,
    password: user.password,
  });
  // Classic view shows the image as a plain timeline row.
  await seedRoomOverviewState({ page, roomId, userId: user.userId, viewMode: 'classic' });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
};

/** Whether `image` has decoded a picture: a broken image has no natural width. */
const loaded = (page: Page, selector: string) =>
  page
    .locator(selector)
    .first()
    .evaluate(
      (image) =>
        (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0
    )
    .catch(() => false);

const timelineImage = (eventId: string) => `[data-message-id="${eventId}"] img`;

const CUSTOM_EMOJI = '[aria-label="party-parrot emoji"] img';

/** Opens the composer's emoji board on the room's custom emoji. */
const searchEmojiBoard = async (page: Page): Promise<void> => {
  await page.getByRole('button', { name: 'Emoji', exact: true }).last().click();
  await page.getByPlaceholder('Search', { exact: true }).fill('party-parrot');
  await expect(page.locator(CUSTOM_EMOJI).first()).toBeAttached();
};

// The status pill; the status region reads the same text out.
const notice = (page: Page) => page.getByTestId('client-sync-status').filter({ hasText: NOTICE });

test('after a hard reload the custom emoji and images load without the legacy media endpoints', async ({
  context,
  page,
}) => {
  test.setTimeout(180_000);
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${DISPOSABLE_HOMESERVER}`);
  const fixture = await roomWithMedia(`media_${Date.now().toString(36)}`);
  const legacy = await refuseLegacyMedia(context);

  await signInToRoom(page, fixture);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => loaded(page, timelineImage(fixture.imageEventId))).toBe(true);

  // Shift+reload: the browser loads the page past the service worker.
  let documentLoads = 0;
  page.on('domcontentloaded', () => {
    documentLoads += 1;
  });
  legacy.length = 0;
  const cdp = await context.newCDPSession(page);
  const reloaded = page.waitForEvent('domcontentloaded');
  await cdp.send('Page.reload', { ignoreCache: true });
  await reloaded;

  await expect
    .poll(() => loaded(page, timelineImage(fixture.imageEventId)), { timeout: 30_000 })
    .toBe(true);
  await searchEmojiBoard(page);
  await expect.poll(() => loaded(page, CUSTOM_EMOJI)).toBe(true);

  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // The hard reload itself, and no reload after it.
  expect(documentLoads).toBe(1);
  expect(legacy).toEqual([]);
  await expect(notice(page)).toHaveCount(0);
});

test('a window where no service worker can run says why its images do not load', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${DISPOSABLE_HOMESERVER}`);
  const fixture = await roomWithMedia(`media_blocked_${Date.now().toString(36)}`);
  const context = await browser.newContext({ serviceWorkers: 'block' });
  try {
    const legacy = await refuseLegacyMedia(context);
    const page = await context.newPage();
    await signInToRoom(page, fixture);
    // Timeline pictures carry the token themselves, so they still load, and nothing is said yet.
    await expect
      .poll(() => loaded(page, timelineImage(fixture.imageEventId)), { timeout: 30_000 })
      .toBe(true);
    await expect(notice(page)).toHaveCount(0);

    await searchEmojiBoard(page);
    await expect(notice(page)).toBeVisible({ timeout: 30_000 });
    expect(await loaded(page, CUSTOM_EMOJI)).toBe(false);
    expect(legacy.length).toBeGreaterThan(0);
    expect(await page.evaluate(() => navigator.serviceWorker?.controller ?? null)).toBeNull();
  } finally {
    await context.close();
  }
});
