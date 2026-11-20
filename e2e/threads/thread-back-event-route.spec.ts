import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';

// The iOS app's Back does not step back in history: it puts the address of the page the thread
// was opened from in the thread's place. When that page was the room at an event of the thread (a
// link or a tapped push whose lookup of the event failed), the address led into the thread once
// the thread was loaded: on every Back. The room Back returns to stays the room.
// A browser's Back steps back to that page, which led into the thread once more; it stays the
// room there too.
// A link or a push to an edit of a reply is no such page: it opens the reply's thread.
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
      // The reply is not its thread's latest, which the server sends along with the root.
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
        msgtype: 'm.text',
        body: 'A later sample reply.',
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: root,
          is_falling_back: true,
          'm.in_reply_to': { event_id: answer },
        },
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

// The page on screen, not the copy of the last one that slides away under it.
const LIVE = ':not([data-page-slide-copy] *)';
const banner = (page: Page) => page.locator(`[data-thread-context-banner]${LIVE}`);
const back = (page: Page) => banner(page).getByRole('button', { name: 'Back', exact: true });
const compactRoom = (page: Page) => page.locator(`[data-compact-room-view="true"]${LIVE}`);
const card = (page: Page, rootId: string) =>
  page.locator(`button[data-thread-root-id="${rootId}"]${LIVE}`);

type Address = { roomId: string; eventId?: string; threadId?: string };

/** The room, the event and the open thread the address names. */
const addressOf = (url: URL): Address => {
  const [, , roomId = '', eventId] = url.pathname.split('/').map(decodeURIComponent);
  const threadId = url.searchParams.get('threadId');
  return { roomId, ...(eventId ? { eventId } : {}), ...(threadId ? { threadId } : {}) };
};
const expectAddress = (page: Page, address: Address, what: string) =>
  expect
    .poll(() => addressOf(new URL(page.url())), { message: what, timeout: 30_000 })
    .toEqual(address);

/** The room on screen with its cards and no thread, at `address`. */
const expectRoom = async (page: Page, address: Address, rootId: string, what: string) => {
  await expectAddress(page, address, `${what}: the address`);
  await expect(banner(page), what).toHaveCount(0, { timeout: 20_000 });
  await expect(compactRoom(page), what).toBeVisible({ timeout: 20_000 });
  await expect(card(page, rootId), `${what}: the thread has its card`).toBeVisible();
};

/** The thread on screen, with the reply that was edited. */
const expectThread = async (page: Page, address: Address, what: string) => {
  await expectAddress(page, address, `${what}: the address`);
  await expect(banner(page), what).toBeVisible({ timeout: 30_000 });
  const shown = page.getByText(reply(OPENED)).and(page.locator(LIVE));
  await expect(shown.first(), what).toBeVisible({ timeout: 30_000 });
};

/** What the app asks the server about `eventId`: the event itself, or the timeline around it. */
const lookupOf = (url: URL, eventId: string): 'event' | 'context' | undefined => {
  const [, kind, id] =
    /\/_matrix\/client\/[^/]+\/rooms\/[^/]+\/(event|context)\/([^/]+)$/.exec(url.pathname) ?? [];
  if (id === undefined || decodeURIComponent(id) !== eventId) return undefined;
  return kind === 'event' ? 'event' : 'context';
};

/** The reader's room, signed in as the iOS app or a browser, not yet on the room's page. */
const signIn = async (page: Page, label: string, ios = true) => {
  const seeded = await seed(label);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...seeded.reader });
  if (ios) {
    await page.context().addInitScript(fakeIOS, FAKE_IOS_KEY);
    await page.evaluate((key) => localStorage.setItem(key, '1'), FAKE_IOS_KEY);
  }
  return seeded;
};
const expectPlatform = async (page: Page, ios = true) => {
  const platform = await page.evaluate(() =>
    (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.()
  );
  expect(platform, 'the platform the app runs on').toBe(ios ? 'ios' : 'web');
};

const backFromReplyPage = async (page: Page, ios: boolean) => {
  const { roomId, rootId, replyId } = await signIn(page, ios ? 'reply' : 'web', ios);
  const eventPage = { roomId, eventId: replyId };

  // The link's own visit: the server has no answer about the reply, so the room shows its cards.
  const failed: string[] = [];
  const aboutReply = (url: URL) => lookupOf(url, replyId) !== undefined;
  await page.route(aboutReply, (route) => {
    failed.push(lookupOf(new URL(route.request().url()), replyId) ?? '');
    return route.fulfill({ status: 404, json: { errcode: 'M_NOT_FOUND', error: 'Not found.' } });
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}/${encodeURIComponent(replyId)}`);
  await expect
    .poll(() => failed, { message: 'the app asked about the reply', timeout: 60_000 })
    .toEqual(expect.arrayContaining(['event', 'context']));
  await expectPlatform(page, ios);
  await expectRoom(page, eventPage, rootId, 'the page of the reply shows the room');
  await page.unroute(aboutReply);

  await card(page, rootId).tap();
  await expectThread(page, { roomId, threadId: rootId }, 'the card opens its thread');

  // Leaving a thread leads to its room, whichever page opened it (room/useRoomViewThreadState.ts):
  // here the page of the reply, which the thread has loaded by now. The room shows the reply,
  // for which it asks the server for the timeline around it; with that answered, it is the room.
  const shown = page.waitForResponse(
    (response) => lookupOf(new URL(response.url()), replyId) === 'context',
    { timeout: 30_000 }
  );
  await back(page).tap();
  expect((await shown).ok(), 'the server answers about the reply').toBe(true);
  await expectRoom(page, eventPage, rootId, 'Back from the thread shows the room');
};

for (const [form, ios] of [
  ['the iOS app', true],
  ['a browser', false],
] as const) {
  test(`Back leaves a thread opened on the page of a reply whose lookup failed (${form})`, async ({
    page,
  }) => {
    await backFromReplyPage(page, ios);
  });
}

test('a link to an edit of a thread reply opens the thread, and Back leaves it', async ({
  page,
}) => {
  const { roomId, rootId, replyId, editId } = await signIn(page, 'edit');

  // The thread opens at the reply the edit replaces.
  await page.goto(`/home/${encodeURIComponent(roomId)}/${encodeURIComponent(editId)}`);
  await expectThread(
    page,
    { roomId, eventId: replyId, threadId: rootId },
    'the link opens the thread of the reply'
  );
  await expectPlatform(page);

  // No page of the room is behind the thread, so Back puts the room at the thread's root there.
  await back(page).tap();
  await expectRoom(
    page,
    { roomId, eventId: rootId },
    rootId,
    'Back from the thread shows the room'
  );
});
