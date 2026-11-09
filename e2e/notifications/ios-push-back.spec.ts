import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  setDirectAccountData,
  type MatrixSession,
} from '../helpers/matrix';

// The iOS app opens a tapped push as a page opened from outside the app: a thread's back chevron
// leads to the thread's room, and the room's to its list, never to the page the app was left on
// (another conversation, or another account's). The app runs as the iOS app here: Capacitor's iOS
// platform with a stand-in for the push plugin, whose taps the test fires as iOS would deliver
// them. At 390 by 844 with touch, in Chromium. IOS_PUSH_BACK_SHOTS=<directory> saves the thread
// and the pages its chevrons lead to.
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'ios-push-back-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const SHOTS = process.env.IOS_PUSH_BACK_SHOTS;
const FAKE_IOS_KEY = 'e2e-ios-push-back';

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

const register = async (name: string): Promise<MatrixSession & { username: string }> => {
  const username = `ipb_${name}_${RUN}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  return { username, userId: body.user_id, accessToken: body.access_token };
};

const text = (body: string) => ({ msgtype: 'm.text', body });
const inThread = (rootId: string, body: string) => ({
  ...text(body),
  'm.relates_to': {
    rel_type: 'm.thread',
    event_id: rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: rootId },
  },
});

type Seed = {
  username: string;
  dm: string;
  dmEvent: string;
  room: string;
  root: string;
  reply: string;
};

/** A reader with a direct chat and a room with an agent, where a reply in a thread is pushed. */
const seed = async (name: string): Promise<Seed> => {
  const reader = await register(`r${name}`);
  const writer = await register(`w${name}`);
  const dm = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: writer.accessToken,
    body: JSON.stringify({
      preset: 'trusted_private_chat',
      is_direct: true,
      invite: [reader.userId],
    }),
  });
  await joinRoom(HOMESERVER, reader.accessToken, dm.room_id);
  await setDirectAccountData(
    HOMESERVER,
    reader.accessToken,
    reader.userId,
    writer.userId,
    dm.room_id
  );
  const say = (roomId: string, content: Record<string, unknown>) =>
    sendRoomMessage(HOMESERVER, writer.accessToken, roomId, content, 'ios-push-back');
  const dmEvent = await say(dm.room_id, text('Did you see the release plan in Harbor Plans?'));
  const agent = await registerAgentAccount(HOMESERVER, `ipb${name}`);
  const room = await createPrivateRoom(HOMESERVER, writer.accessToken, {
    name: 'Harbor Plans',
    topic: 'Crane schedule and releases',
    invite: [reader.userId, agent.userId],
  });
  await joinRoom(HOMESERVER, reader.accessToken, room);
  const root = await say(room, text('Release plan for the north pier: who signs off?'));
  await say(room, inThread(root, 'The harbor master signs off on Monday.'));
  const reply = await say(room, inThread(root, 'Then the cranes start on Wednesday.'));
  return { username: reader.username, dm: dm.room_id, dmEvent, room, root, reply };
};

/**
 * Capacitor as the iOS app has it, once the test sets FAKE_IOS_KEY: the iOS platform, with a push
 * plugin whose `pushNotificationActionPerformed` listeners `window.tapPush(data)` calls with a
 * tapped notification of that data, as the native plugin does; it returns how many it reached.
 */
function fakeIOS(key: string) {
  if (localStorage.getItem(key) !== '1') return;
  type Listener = { id: string; callback: (data: unknown) => void };
  const listeners: Record<string, Listener[]> = {};
  let next = 1;
  const win = window as unknown as Record<string, unknown>;
  win.CapacitorCustomPlatform = { name: 'ios', plugins: {} };
  win.Capacitor = {
    PluginHeaders: [
      {
        name: 'PushNotifications',
        methods: [
          { name: 'addListener', rtype: 'callback' },
          ...['removeListener', 'checkPermissions', 'register'].map((name) => ({
            name,
            rtype: 'promise',
          })),
        ],
      },
    ],
    nativeCallback: (
      _plugin: string,
      _method: string,
      options: { eventName: string },
      callback: (data: unknown) => void
    ) => {
      const id = String(next++);
      (listeners[options.eventName] ||= []).push({ id, callback });
      return id;
    },
    nativePromise: (_plugin: string, method: string, options: { callbackId?: string }) => {
      if (method === 'checkPermissions') return Promise.resolve({ receive: 'denied' });
      if (method === 'removeListener') {
        for (const name of Object.keys(listeners)) {
          listeners[name] = (listeners[name] ?? []).filter(({ id }) => id !== options.callbackId);
        }
      }
      return Promise.resolve({});
    },
  };
  win.tapPush = (data: Record<string, unknown>) => {
    const tapped = listeners.pushNotificationActionPerformed ?? [];
    tapped.forEach(({ callback }) =>
      callback({ actionId: 'tap', notification: { id: String(next++), data } })
    );
    return tapped.length;
  };
}

/** Taps a push of `data`, once the app listens for taps. */
const tapPush = (page: Page, data: Record<string, string>) =>
  expect
    .poll(
      () =>
        page.evaluate(
          (push) => (window as unknown as { tapPush?: (d: unknown) => number }).tapPush?.(push),
          data
        ),
      { timeout: 20_000 }
    )
    .toBeGreaterThan(0);

type Place = { path: string; room: string | null; thread: string | null };
const place = (page: Page): Place => {
  const url = new URL(page.url());
  const room = url.pathname
    .split('/')
    .map((segment) => decodeURIComponent(segment))
    .find((segment) => segment.startsWith('!'));
  return { path: url.pathname, room: room ?? null, thread: url.searchParams.get('threadId') };
};
const expectAt = (page: Page, expected: Partial<Place>, step: string) =>
  expect.poll(() => place(page), { message: step, timeout: 20_000 }).toMatchObject(expected);

const roomBack = (page: Page) =>
  page.getByRole('banner').getByRole('button', { name: 'Back', exact: true });
const threadBack = (page: Page) =>
  page.locator('[data-thread-context-banner]').getByRole('button', { name: 'Back', exact: true });
const listLink = (page: Page, name: string) =>
  page.getByTestId('resizable-page-nav').getByRole('link', { name });

const shoot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
};

const signedIn = async (page: Page) => {
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
};

/** Signs `username` in, then reloads the app as the iOS app. */
const signIn = async (browser: Browser, username: string) => {
  const context = await browser.newContext(PHONE);
  context.setDefaultTimeout(30_000);
  await context.addInitScript(fakeIOS, FAKE_IOS_KEY);
  const page = await context.newPage();
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  await signedIn(page);
  return { context, page };
};

const asIOSApp = async (page: Page) => {
  await page.evaluate((key) => localStorage.setItem(key, '1'), FAKE_IOS_KEY);
  await page.goto('/home/');
  await signedIn(page);
  await expect(listLink(page, 'Harbor Plans')).toBeVisible({ timeout: 60_000 });
};

/** The thread a tapped push opened: its chevron leads to its room, and the room's to the list. */
const backFromPushedThread = async (page: Page, { room, root }: Seed, shots: string) => {
  await expectAt(page, { room, thread: root }, 'the push opens the reply in its thread');
  await expect(threadBack(page)).toBeVisible();
  await shoot(page, `${shots}-1-thread`);
  await threadBack(page).tap();
  await expectAt(page, { room, thread: null }, "the thread's chevron leads to its room");
  await expect(roomBack(page)).toBeVisible();
  await shoot(page, `${shots}-2-room`);
  await roomBack(page).tap();
  await expectAt(page, { path: '/home/', room: null, thread: null }, "then to the room's list");
  await expect(listLink(page, 'Harbor Plans')).toBeVisible();
  await shoot(page, `${shots}-3-list`);
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
});

test('a thread a tapped push opened over another conversation leads back to its room', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const data = await seed('one');
  const { context, page } = await signIn(browser, data.username);
  try {
    await asIOSApp(page);
    await tapPush(page, { room_id: data.dm, event_id: data.dmEvent });
    await expectAt(page, { room: data.dm, thread: null }, 'the first push opens the direct chat');
    await tapPush(page, { room_id: data.room, event_id: data.reply });
    await backFromPushedThread(page, data, 'one-account');
  } finally {
    await context.close();
  }
});

test("a thread another account's push opened leads back to that account's room", async ({
  browser,
}) => {
  test.setTimeout(240_000);
  const first = await seed('first');
  const second = await seed('second');
  const { context, page } = await signIn(browser, first.username);
  try {
    await loginWithPassword(page, {
      homeserver: HOMESERVER,
      username: second.username,
      password: PASSWORD,
      addAccount: true,
    });
    await signedIn(page);
    // The first account is active, in its direct chat; the second account last showed the
    // pushed thread. Each account's pushes carry its tag on this device.
    await page.evaluate(
      ({ firstUser, secondUser, room, root }) => {
        const key = 'mindroom_multi_account_store';
        const store = JSON.parse(localStorage.getItem(key) ?? '{}') as {
          activeSessionId: string;
          sessions: { sessionId: string; userId: string; lastKnownPath?: string }[];
        };
        const of = (username: string) =>
          store.sessions.find(({ userId }) => userId.startsWith(`@${username}:`))!;
        localStorage.setItem(`mindroom_ios_push_profile_tag::${of(firstUser).sessionId}`, 'tag-1');
        localStorage.setItem(`mindroom_ios_push_profile_tag::${of(secondUser).sessionId}`, 'tag-2');
        of(secondUser).lastKnownPath = `/home/${encodeURIComponent(
          room
        )}/?threadId=${encodeURIComponent(root)}`;
        store.activeSessionId = of(firstUser).sessionId;
        localStorage.setItem(key, JSON.stringify(store));
      },
      {
        firstUser: first.username,
        secondUser: second.username,
        room: second.room,
        root: second.root,
      }
    );
    await asIOSApp(page);
    await tapPush(page, { room_id: first.dm, event_id: first.dmEvent, mindroom_account: 'tag-1' });
    await expectAt(page, { room: first.dm, thread: null }, 'the first push opens the direct chat');
    await tapPush(page, {
      room_id: second.room,
      event_id: second.reply,
      mindroom_account: 'tag-2',
    });
    await backFromPushedThread(page, second, 'two-accounts');
  } finally {
    await context.close();
  }
});
