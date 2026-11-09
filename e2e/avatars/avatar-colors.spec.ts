import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import {
  AVATAR_SWATCHES,
  avatarSwatchIndex,
} from '../../src/app/avatars/avatarSwatches';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createDefaultThreadFilterState,
  createPrivateRoom,
  createPrivateSpace,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
  setDirectAccountData,
} from '../helpers/matrix';
import { roomViewSwitch } from '../helpers/roomViewSwitch';
import { defined } from '../../src/test/utils/defined';

// Avatars without a picture take one color per user or room ID, on every screen: the room header
// tile, the lobby, the room intro, Activity, the Direct list, the Compact bars, the members and
// the messages. A direct chat takes the color of the person it is with.

// A disposable local Matrix server with open registration (`just hs-up` or scripts/e2e-slot.sh).
const homeserver = process.env.E2E_UI_ACTIONS_HOMESERVER;
test.use({ video: 'off' });

type Account = { access_token: string; user_id: string };

type Seeded = {
  username: string;
  password: string;
  viewer: string;
  peer: string;
  roomId: string;
  rootId: string;
  spaceId: string;
  directId: string;
};

const seed = async (): Promise<Seeded> => {
  const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
  const password = randomUUID();
  const register = async (username: string, displayname: string): Promise<Account> => {
    const account = await matrixFetch<Account>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
    await matrixFetch(homeserver!, `/profile/${encodeURIComponent(account.user_id)}/displayname`, {
      method: 'PUT',
      accessToken: account.access_token,
      body: JSON.stringify({ displayname }),
    });
    return account;
  };

  const username = `colors_viewer_${suffix}`;
  const viewer = await register(username, 'Olive Viewer');
  const peer = await register(`colors_peer_${suffix}`, 'Pat Peer');

  const spaceId = await createPrivateSpace(homeserver!, viewer.access_token, {
    name: 'Color Space',
    topic: 'Rooms without pictures',
  });
  const roomId = await createPrivateRoom(homeserver!, viewer.access_token, {
    name: 'Color Room',
    topic: 'No picture here',
    invite: [peer.user_id],
  });
  await addRoomToSpace(homeserver!, viewer.access_token, spaceId, roomId);
  await joinRoom(homeserver!, peer.access_token, roomId);
  const rootId = await sendRoomMessage(homeserver!, peer.access_token, roomId, {
    msgtype: 'm.text',
    body: 'Which color is the launch room?',
  });
  const inThread = {
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  };
  await sendRoomMessage(homeserver!, viewer.access_token, roomId, {
    msgtype: 'm.text',
    body: 'The same one everywhere',
    ...inThread,
  });
  // The peer answers last, so Activity's row for the thread shows the peer.
  await sendRoomMessage(homeserver!, peer.access_token, roomId, {
    msgtype: 'm.text',
    body: 'Teal, then',
    ...inThread,
  });

  const directId = await createPrivateRoom(homeserver!, viewer.access_token, {
    name: '',
    topic: '',
    preset: 'trusted_private_chat',
    invite: [peer.user_id],
    isDirect: true,
  });
  await setDirectAccountData(
    homeserver!,
    viewer.access_token,
    viewer.user_id,
    peer.user_id,
    directId
  );
  await joinRoom(homeserver!, peer.access_token, directId);
  await sendRoomMessage(homeserver!, peer.access_token, directId, {
    msgtype: 'm.text',
    body: 'Just us two',
  });

  return {
    username,
    password,
    viewer: viewer.user_id,
    peer: peer.user_id,
    roomId,
    rootId,
    spaceId,
    directId,
  };
};

const routeConfig = (context: BrowserContext) =>
  context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [homeserver],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
      },
    });
  });

const rgb = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  return `rgb(${r}, ${g}, ${b})`;
};

/** The fill an ID's fallback must have: its swatch on light or dark themes. */
const swatchOf = (id: string, kind: 'light' | 'dark') =>
  rgb(defined(AVATAR_SWATCHES[avatarSwatchIndex(id)], `the swatch of ${id}`)[kind]);

type Fill = { id: string; fill: string };

/** Fills of the fallbacks on screen, by the ID their color follows. */
const fillsOnScreen = (page: Page): Promise<Fill[]> =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[data-avatar-fallback-id]'))
      .filter((node) => node.getClientRects().length > 0)
      .map((node) => ({
        id: node.dataset.avatarFallbackId ?? '',
        fill: getComputedStyle(node).backgroundColor,
      }))
  );

/** Waits until every ID in `ids` shows a fallback, then returns what the screen shows. */
const expectFallbacks = async (page: Page, screen: string, ids: string[]) => {
  await expect
    .poll(
      async () => {
        const shown = new Set((await fillsOnScreen(page)).map((fill) => fill.id));
        return ids.filter((id) => !shown.has(id));
      },
      { message: `${screen}: fallbacks missing`, timeout: 30_000 }
    )
    .toEqual([]);
  return fillsOnScreen(page);
};

test('a user or room without a picture has one color on every screen', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  test.slow();
  const seeded = await seed();
  await routeConfig(context);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'light' });
  await loginWithPassword(page, {
    homeserver: homeserver!,
    username: seeded.username,
    password: seeded.password,
  });

  const seen: (Fill & { screen: string })[] = [];
  const record = async (screen: string, ids: string[]) => {
    const fills = await expectFallbacks(page, screen, ids);
    seen.push(...fills.map((fill) => ({ ...fill, screen })));
    await page.screenshot({ path: testInfo.outputPath(`${screen}.png`) });
  };

  // The Compact view: the header tile, the faces on the thread bar, the members, the rail. A room
  // without agents opens in Threads unless the reader chose a view.
  await seedRoomOverviewState({
    page,
    roomId: seeded.roomId,
    userId: seeded.viewer,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(seeded.roomId)}/`);
  await expect(page.getByText('Which color is the launch room?').first()).toBeVisible({
    timeout: 30_000,
  });
  // The members panel opens with the room on wide screens; open it if it was closed.
  const showMembers = page.getByRole('button', { name: /show members/i }).first();
  if (await showMembers.isVisible()) await showMembers.click();
  await expect(page.getByText(/^\d+ Members$/)).toBeVisible();
  await record('room-compact', [seeded.roomId, seeded.peer, seeded.viewer]);

  // The thread: both message avatars.
  await page.goto(
    `/home/${encodeURIComponent(seeded.roomId)}/?threadId=${encodeURIComponent(seeded.rootId)}`
  );
  await expect(page.getByText('The same one everywhere').first()).toBeVisible({
    timeout: 30_000,
  });
  await record('thread', [seeded.roomId, seeded.peer, seeded.viewer]);

  // The Full view starts with the room intro.
  await page.goto(`/home/${encodeURIComponent(seeded.roomId)}/`);
  await expect(roomViewSwitch(page)).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 });
  await roomViewSwitch(page).click();
  await expect(roomViewSwitch(page)).toHaveAttribute('aria-pressed', 'false');
  await record('room-full', [seeded.roomId, seeded.peer]);
  await expect
    .poll(() =>
      page.evaluate(
        (roomId) =>
          document.querySelectorAll(`[data-avatar-fallback-id="${CSS.escape(roomId)}"]`).length,
        seeded.roomId
      )
    )
    .toBeGreaterThanOrEqual(2);

  // The space's lobby and its rail button, and the room listed in it.
  await page.goto(`/${encodeURIComponent(seeded.spaceId)}/lobby/`);
  await record('lobby', [seeded.spaceId, seeded.roomId]);

  // Activity's row for the thread shows the peer, who answered last.
  await page.goto('/activity/');
  await expect(page.locator('[data-activity-row]').first()).toContainText('Teal, then', {
    timeout: 30_000,
  });
  await record('activity', [seeded.peer]);

  // The Direct list and the direct chat show the person, in their color.
  await page.goto('/direct/');
  await record('direct-list', [seeded.peer]);
  await page.goto(`/direct/${encodeURIComponent(seeded.directId)}/`);
  await expect(page.getByText('Just us two').first()).toBeVisible({ timeout: 30_000 });
  await record('direct-room', [seeded.peer]);
  expect(seen.filter((fill) => fill.id === seeded.directId)).toEqual([]);

  // Every fallback of one ID has that ID's swatch, on whichever screen it shows.
  for (const { id, fill, screen } of seen) {
    expect(`${screen} ${id} ${fill}`).toBe(`${screen} ${id} ${swatchOf(id, 'light')}`);
  }
  const screensOf = (id: string) =>
    new Set(seen.filter((fill) => fill.id === id).map((f) => f.screen));
  expect([...screensOf(seeded.roomId)].sort()).toEqual(
    ['lobby', 'room-compact', 'room-full', 'thread'].sort()
  );
  expect([...screensOf(seeded.peer)].sort()).toEqual(
    ['activity', 'direct-list', 'direct-room', 'room-compact', 'room-full', 'thread'].sort()
  );

  // Dark themes use the pale swatch of the same hue.
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto(`/home/${encodeURIComponent(seeded.roomId)}/`);
  await expect(page.getByText('Which color is the launch room?').first()).toBeVisible({
    timeout: 30_000,
  });
  const dark = await expectFallbacks(page, 'room-dark', [seeded.roomId, seeded.peer]);
  await page.screenshot({ path: testInfo.outputPath('room-dark.png') });
  for (const { id, fill } of dark) {
    expect(`${id} ${fill}`).toBe(`${id} ${swatchOf(id, 'dark')}`);
  }
});
