import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';

// In the iOS app, Back from a thread shows the room's cards and stays there when the thread was
// opened from its card on the room's page at an event of that thread: the address of a link or a
// tapped push that did not lead into the thread, because it names an edit of a reply, or because
// the lookup of the reply failed. The app's Back there puts that page's address in the thread's
// place, and the address led into the thread once the thread was loaded: on every Back.
const PASSWORD = 'thread-back-event-route-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const TOPICS = 20;
const OPENED = 3;
const FAKE_IOS_KEY = 'thread-back-event-route-fake-ios';

test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.setTimeout(240_000);
});

const topic = (index: number) => `Sample topic ${index}: sort the placeholder items for review`;
const reply = (index: number) => `Noted sample topic ${index}; the placeholder list is ready.`;

const seed = async (label: string) => {
  const suffix = `${label}_${RUN}${test.info().repeatEachIndex}`;
  const reader = await registerDisposableUser(`tber_reader_${suffix}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, `tber_agent_${suffix}`);
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Sample room',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  let rootId = '';
  let replyId = '';
  let editId = '';
  for (let index = 1; index <= TOPICS; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    const root = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
      msgtype: 'm.text',
      body: topic(index),
    });
    // eslint-disable-next-line no-await-in-loop
    const answer = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
      msgtype: 'm.text',
      body: reply(index),
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: root,
        is_falling_back: true,
        'm.in_reply_to': { event_id: root },
      },
    });
    if (index === OPENED) {
      rootId = root;
      replyId = answer;
      // eslint-disable-next-line no-await-in-loop
      editId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
        msgtype: 'm.text',
        body: `* ${reply(index)}`,
        'm.new_content': { msgtype: 'm.text', body: reply(index) },
        'm.relates_to': { rel_type: 'm.replace', event_id: answer },
      });
    }
  }
  return { reader, roomId, rootId, replyId, editId };
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

/** Waits until no thread is open and the room shows its cards, and checks it stays that way. */
const expectRoom = async (page: Page, what: string) => {
  await expect(banner(page), what).toHaveCount(0, { timeout: 20_000 });
  await expect(compactRoom(page), what).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1_500);
  await expect(banner(page), `${what}: no thread comes back`).toHaveCount(0);
  expect(openThread(page), `${what}: the address`).toBeNull();
};

// The server's answers about one event: the event itself and the timeline around it.
const EVENT_LOOKUPS = /\/_matrix\/client\/[^/]+\/rooms\/[^/]+\/(event|context)\//;

/**
 * Opens the room at an event of a thread as the iOS app, where the room's cards show; then the
 * thread from its card, and leaves it.
 */
const openFromEventPageAndBack = async (page: Page, event: 'edit' | 'reply') => {
  const { reader, roomId, rootId, replyId, editId } = await seed(event);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await page.context().addInitScript(fakeIOS, FAKE_IOS_KEY);
  await page.evaluate((key) => localStorage.setItem(key, '1'), FAKE_IOS_KEY);
  // The page of an edit never leads into the thread; the page of the reply does not while the
  // server cannot be asked about it.
  if (event === 'reply') await page.route(EVENT_LOOKUPS, (route) => route.abort());
  const eventId = event === 'edit' ? editId : replyId;
  await page.goto(`/home/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}`);
  await expect(card(page, rootId)).toBeVisible({ timeout: 60_000 });
  const platform = await page.evaluate(() =>
    (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.()
  );
  expect(platform, 'the platform the app runs on').toBe('ios');
  await expectRoom(page, 'the page of the event shows the room');
  await page.unroute(EVENT_LOOKUPS);

  await card(page, rootId).tap();
  await expect.poll(() => openThread(page), { timeout: 30_000 }).toBe(rootId);
  await expect(page.getByText(reply(OPENED)).first()).toBeVisible({ timeout: 30_000 });

  // Leaving a thread leads to its room, whichever page opened it (room/useRoomViewThreadState.ts).
  await back(page).tap();
  await expectRoom(page, 'Back from the thread shows the room');
  await expect(card(page, rootId), 'the thread has its card').toBeVisible();
};

test('Back leaves a thread opened on the page of an edit of one of its replies', async ({
  page,
}) => {
  await openFromEventPageAndBack(page, 'edit');
});

test('Back leaves a thread opened on the page of a reply whose lookup failed', async ({ page }) => {
  await openFromEventPageAndBack(page, 'reply');
});
