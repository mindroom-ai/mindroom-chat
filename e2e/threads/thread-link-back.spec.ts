import {
  expect,
  test,
  type BrowserContext,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { addRoomToSpace, joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';

// A link in a thread to another thread of the same room opens that thread, and one Back from it
// shows the room's cards and stays there, on a phone, in the iOS app and on a desktop. The room is
// in a space and both have aliases, so the link names them by alias and the room ID route
// replaces the address. The link showed the room's cards instead: a delayed alias replacement put
// the link's event route back over its redirect into the thread (shell/ClientLayout.tsx).
const PASSWORD = 'thread-link-back-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TOPICS = 20;
const LINKED = 3;
const FAKE_IOS_KEY = 'thread-link-back-fake-ios';
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.setTimeout(240_000);
});

const topic = (index: number) => `Sample topic ${index}: sort the placeholder items for review`;
const reply = (index: number) => `Noted sample topic ${index}; the placeholder list is ready.`;

const seed = async (label: string) => {
  const suffix = `${label}_${RUN}${test.info().repeatEachIndex}`;
  const reader = await registerDisposableUser(`tlb_reader_${suffix}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `tlb_agent_${suffix}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Sample room',
    invite: [agent.userId],
    alias: `tlb_room_${suffix}`,
  });
  const spaceId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Sample space',
    space: true,
    alias: `tlb_space_${suffix}`,
  });
  await addRoomToSpace(HOMESERVER, reader.accessToken, spaceId, roomId);
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const roots: string[] = [];
  for (let index = 1; index <= TOPICS; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: topic(index),
    });
    roots.push(rootId);
    const href = `https://matrix.to/#/${roomId}/${roots[LINKED - 1] ?? ''}?via=localhost`;
    const linking = index === TOPICS;
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: linking ? `${reply(index)} See [the earlier one](${href}).` : reply(index),
      ...(linking
        ? {
            format: 'org.matrix.custom.html',
            formatted_body: `${reply(index)} See <a href="${href}">the earlier one</a>.`,
          }
        : {}),
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
  }
  return {
    reader,
    roomId,
    spaceId,
    sourceRootId: roots[TOPICS - 1] ?? '',
    linkedRootId: roots[LINKED - 1] ?? '',
  };
};

/** Capacitor as the iOS app has it, once the test sets FAKE_IOS_KEY: the iOS platform. */
function fakeIOS(key: string) {
  if (localStorage.getItem(key) !== '1') return;
  const win = window as unknown as Record<string, unknown>;
  win.CapacitorCustomPlatform = { name: 'ios', plugins: {} };
  win.Capacitor = {
    PluginHeaders: [],
    nativeCallback: () => '1',
    nativePromise: () => Promise.resolve({}),
  };
}

const banner = (page: Page) => page.locator('[data-thread-context-banner]');
const back = (page: Page) => banner(page).getByRole('button', { name: 'Back', exact: true });
const openThread = (page: Page) => new URL(page.url()).searchParams.get('threadId');
const compactRoom = (page: Page) => page.locator('[data-compact-room-view="true"]');
const card = (page: Page, rootId: string) =>
  page.locator(`button[data-thread-root-id="${rootId}"]`);

/** Waits until the open thread is the one of `rootId`, its reply shown. */
const expectThread = async (page: Page, rootId: string, index: number, what: string) => {
  await expect
    .poll(() => openThread(page), { message: `${what}: the address`, timeout: 30_000 })
    .toBe(rootId);
  await expect(banner(page), what).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(reply(index)).first(), what).toBeVisible({ timeout: 30_000 });
};

/** Waits until no thread is open and the room shows its cards, and checks it stays that way. */
const expectRoom = async (page: Page, what: string) => {
  await expect(banner(page), what).toHaveCount(0, { timeout: 20_000 });
  await expect(compactRoom(page), what).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
  await expect(banner(page), `${what}: no thread comes back`).toHaveCount(0);
  expect(openThread(page), `${what}: the address`).toBeNull();
};

const press = (touch: boolean, target: Locator) => (touch ? target.tap() : target.click());

const followLinkAndBack = async (
  context: BrowserContext,
  page: Page,
  touch: boolean,
  ios: boolean,
  label: string
) => {
  const { reader, roomId, spaceId, sourceRootId, linkedRootId } = await seed(label);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  if (ios) {
    await context.addInitScript(fakeIOS, FAKE_IOS_KEY);
    await page.evaluate((key) => localStorage.setItem(key, '1'), FAKE_IOS_KEY);
  }
  await page.goto(`/${encodeURIComponent(spaceId)}/${encodeURIComponent(roomId)}/`);
  await expect(compactRoom(page)).toBeVisible({ timeout: 60_000 });
  const platform = await page.evaluate(() =>
    (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.()
  );
  expect(platform, 'the platform the app runs on').toBe(ios ? 'ios' : 'web');
  await expect(card(page, sourceRootId)).toBeVisible({ timeout: 60_000 });
  await press(touch, card(page, sourceRootId));
  await expectThread(page, sourceRootId, TOPICS, 'the card opens its thread');

  const link = page.locator(`a[data-mention-event-id="${linkedRootId}"]`).first();
  await expect(link).toBeVisible({ timeout: 30_000 });
  await press(touch, link);
  await expectThread(page, linkedRootId, LINKED, 'the link opens the linked thread');

  // Leaving a thread leads to its room, whichever page opened it (room/useRoomViewThreadState.ts).
  await press(touch, back(page));
  await expectRoom(page, 'Back from the linked thread shows the room');
  await expect(card(page, linkedRootId), 'the linked thread has its card').toBeVisible();
};

for (const [form, options, ios] of [
  ['phone', PHONE, false],
  ['iOS app', PHONE, true],
  ['desktop', DESKTOP, false],
] as const) {
  test.describe(form, () => {
    test.use(options);

    test(`a link to another thread of a space room opens it, and Back leaves it (${form})`, async ({
      context,
      page,
    }) => {
      await followLinkAndBack(context, page, options === PHONE, ios, form[0] ?? 'x');
    });
  });
}
