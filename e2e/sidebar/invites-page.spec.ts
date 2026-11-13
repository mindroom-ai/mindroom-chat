import { expect, test, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { joinRoom, matrixFetch } from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// The Invites page: a centered title, a Filter label over the list chips, a heading with Accept
// All for the list shown, and one card per invite with its picture or a colored letter, small
// chips over the name of a direct chat, Decline and Accept side by side at the card's end, and
// the inviter on a quiet line under it. The Activity list beside it shows each pending invite as a
// row of its own. The cards are checked in Chromium and, when
// PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's WebKit, in WebKit. Set INVITES_SHOTS=<directory>
// to also save the page in dark and light themes and at a phone's width.
const PASSWORD = 'invites-page-spec-password';
const SHOTS = process.env.INVITES_SHOTS;

// A 48 px gradient with a pale disc, so one room has a picture of its own.
const ROOM_PICTURE = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAACMUlEQVR42s3WaTfUYRgG8OvjIPua7LvsOw1Fu6JIpMVOlnZLpVAzGMMQWbMTbUTSYn/jG/Sm9z1z5o3Oecbk//ybc59zfYDfec557uuCmVZp1qU071SZa1QWHa0W6rZD7Sztlm1qy1a1larDSqmxfqmxftFpw9LSZdustWvS2j3vtn/WY9/Y49D4yuFpr+OTXsfHfU4NfU71r53r+53r+l1qB1weDR5+OOj6YMj1/vARlnsjbndH3O68ca8Zda8e9aga86ga96wc97w94VUx6VU+6V025VM2DVIan9JpkNL4lsyAlMa3eAakNH5FsyCl8St8C1Ia/wIdiJDGv2AOpDQBt+Yhr+b3r11D+RdNwM15mEajj1FN4I13kEVjlLI3+2gCr7+Had7mL5BhTVA+A5lWo48hTdC1DzC9Rh+uJlgHEvvhkkFcTXDeRwjeG+kgnuZo7icIXj/JIK4m5CoDid1i6SCeJiRnAYLNIBnE1YReWYRgT0kH8TSh2YsQbE3JIK4mLPszBDtcOoinCctagviikFETfpmB5Ng3cmnCLy1DlrV1INA+mohMBpJv+wm+DdNEZHyBvEtUUBOZsYL/sYsN9ZRRTeTFFZDSRF34ClKaqPRVkNJEn18FKU3MuW8gpYk5+x2kNLE6ECVN7JkfIKWJO81AlDRxp36ClCb+5BpIaeLT1kBKk5C6DlKahNQNkNIknmAgSprE45sgpUlK2QIpTVLyFkhpjim2QUqjUOz8AagjATipQGfoAAAAAElFTkSuQmCC',
  'base64'
);

type Account = { username: string; userId: string; accessToken: string };

const register = async (prefix: string, displayname: string): Promise<Account> => {
  // A random part too, so tests that run at once in other workers never pick the same name.
  const username = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token };
};

const uploadPicture = async (accessToken: string): Promise<string> => {
  const response = await fetch(`${HOMESERVER}/_matrix/media/v3/upload?filename=room.png`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'image/png' },
    body: ROOM_PICTURE,
  });
  expect(response.ok, `media upload answered ${response.status}`).toBe(true);
  return ((await response.json()) as { content_uri: string }).content_uri;
};

type RoomOptions = {
  name: string;
  topic: string;
  invite: string[];
  isDirect?: boolean;
  initialState?: { type: string; state_key: string; content: Record<string, unknown> }[];
};

const createRoom = async (inviter: Account, options: RoomOptions): Promise<string> => {
  const body = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: inviter.accessToken,
    body: JSON.stringify({
      name: options.name,
      topic: options.topic,
      preset: options.isDirect ? 'trusted_private_chat' : 'private_chat',
      is_direct: options.isDirect,
      invite: options.invite,
      initial_state: options.initialState,
    }),
  });
  return body.room_id;
};

/**
 * The viewer, with invites from a person (an encrypted direct chat) and from a bridge's bot (two
 * portal rooms, one with a picture). A room the viewer shares with both makes them known, so all
 * three invites land under Primary.
 */
const seedInvites = async (): Promise<Account> => {
  const viewer = await register('invites_viewer', 'Riley Test');
  const person = await register('invites_person', 'Maya Lind');
  const bridge = await register('invites_bridgebot', 'Relay Bridge Bot');
  const shared = await createRoom(person, {
    name: 'Shared lounge',
    topic: 'Everyone',
    invite: [viewer.userId, bridge.userId],
  });
  await joinRoom(HOMESERVER, viewer.accessToken, shared);
  await joinRoom(HOMESERVER, bridge.accessToken, shared);

  await createRoom(bridge, {
    name: 'Ada Park',
    topic: 'Relay private chat',
    invite: [viewer.userId],
  });
  const picture = await uploadPicture(bridge.accessToken);
  await createRoom(bridge, {
    name: 'Design crew',
    topic: 'Relay group chat',
    invite: [viewer.userId],
    initialState: [{ type: 'm.room.avatar', state_key: '', content: { url: picture } }],
  });
  await createRoom(person, {
    name: 'Maya Lind',
    topic: '',
    invite: [viewer.userId],
    isDirect: true,
    initialState: [
      {
        type: 'm.room.encryption',
        state_key: '',
        content: { algorithm: 'm.megolm.v1.aes-sha2' },
      },
    ],
  });
  return viewer;
};

const openInvites = async (page: Page, viewer: Account) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: viewer.username,
    password: PASSWORD,
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/activity/invites/');
  await expect(inviteCards(page)).toHaveCount(3, { timeout: 30_000 });
};

const inviteCards = (page: Page) => page.locator('[data-invite-room-id]');

const box = async (locator: Locator) => {
  const found = await locator.boundingBox();
  expect(found, 'a visible element').not.toBeNull();
  return found ?? { x: 0, y: 0, width: 0, height: 0 };
};

test.beforeAll(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const checkInviteCards = async (page: Page) => {
  // The Activity list beside the page shows each pending invite.
  const nav = page.getByRole('navigation', { name: 'Activity' });
  await expect(nav.locator('[data-activity-row="invite"]')).toHaveCount(3);

  // The Primary chip is pressed and counts its invites; the empty lists show no number.
  const filter = page.getByRole('group', { name: 'Filter' });
  await expect(filter.getByRole('button', { name: 'Primary 3' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await expect(filter.getByRole('button', { name: 'Public', exact: true })).toBeVisible();
  await expect(filter.getByRole('button', { name: 'Spam', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Primary', level: 2 })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Accept All' })).toBeVisible();

  const cards = inviteCards(page);
  for (let index = 0; index < 3; index += 1) {
    const card = cards.nth(index);
    const name = await box(card.getByRole('heading', { level: 3 }));
    const decline = await box(card.getByRole('button', { name: 'Decline', exact: true }));
    const accept = await box(card.getByRole('button', { name: 'Accept', exact: true }));
    const cardBox = await box(card);
    // One row: both buttons share their vertical center, Decline first, and the row is the
    // name's, not a line under it.
    expect(Math.abs(decline.y + decline.height / 2 - (accept.y + accept.height / 2))).toBeLessThan(
      1
    );
    expect(decline.x + decline.width).toBeLessThanOrEqual(accept.x);
    expect(accept.y).toBeLessThan(name.y + name.height);
    // At the card's end.
    expect(cardBox.x + cardBox.width - (accept.x + accept.width)).toBeLessThan(32);
  }

  // The direct chat shows its chips over the name, the portal rooms show none.
  const direct = cards.filter({ hasText: 'Direct Message' });
  await expect(direct).toHaveCount(1);
  await expect(direct.getByText('Encrypted', { exact: true })).toBeVisible();
  await expect(direct.getByText(/^From: /)).toContainText('Maya Lind');
  await expect(cards.filter({ hasText: 'Relay Bridge Bot' })).toHaveCount(2);

  // Right to left, the buttons keep their row at the card's other end, Decline still first.
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
  for (let index = 0; index < 3; index += 1) {
    const card = cards.nth(index);
    const decline = await box(card.getByRole('button', { name: 'Decline', exact: true }));
    const accept = await box(card.getByRole('button', { name: 'Accept', exact: true }));
    const cardBox = await box(card);
    expect(Math.abs(decline.y - accept.y)).toBeLessThan(1);
    expect(accept.x + accept.width).toBeLessThanOrEqual(decline.x);
    expect(accept.x - cardBox.x).toBeLessThan(32);
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/rtl-check.png` });
  await page.evaluate(() => document.documentElement.setAttribute('dir', 'ltr'));

  // A phone's width moves the buttons under the name and nothing overflows the card. The app
  // swaps in its phone layout a render after the resize; until then the desktop layout is drawn
  // at the phone's width, so the cards are measured once the phone's Back button leads the page.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Back', exact: true })).toBeVisible();
  await expect(nav).toBeHidden();
  for (let index = 0; index < 3; index += 1) {
    const card = cards.nth(index);
    const name = await box(card.getByRole('heading', { level: 3 }));
    const accept = await box(card.getByRole('button', { name: 'Accept', exact: true }));
    const cardBox = await box(card);
    expect(accept.y).toBeGreaterThanOrEqual(name.y + name.height);
    expect(accept.x + accept.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    expect(await card.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
};

test('every invite card keeps Decline and Accept in one row at its end (Chromium)', async ({
  page,
}) => {
  test.slow();
  const viewer = await seedInvites();
  await openInvites(page, viewer);
  await checkInviteCards(page);
});

test('every invite card keeps Decline and Accept in one row at its end (WebKit)', async ({
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  test.slow();
  const viewer = await seedInvites();
  await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, async (page) => {
    await openInvites(page, viewer);
    await checkInviteCards(page);
  });
});

test('saves the Invites page in dark and light themes and at a phone width', async ({ page }) => {
  test.skip(!SHOTS, 'Set INVITES_SHOTS=<directory> to save the screenshots');
  test.slow();
  const viewer = await seedInvites();
  await openInvites(page, viewer);

  const theme = async (themeId: string) => {
    await page.evaluate((id) => {
      const settings = JSON.parse(localStorage.getItem('settings') ?? '{}') as object;
      localStorage.setItem(
        'settings',
        JSON.stringify({ ...settings, useSystemTheme: false, themeId: id })
      );
    }, themeId);
    await page.reload();
    await expect(inviteCards(page)).toHaveCount(3, { timeout: 60_000 });
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
    // The pictures have loaded.
    await expect
      .poll(() =>
        page
          .locator('[data-invite-room-id] img')
          .evaluateAll((images) =>
            images.every((image) => (image as HTMLImageElement).naturalWidth > 0)
          )
      )
      .toBe(true);
    await page.mouse.move(0, 0);
  };

  for (const [themeId, label] of [
    ['dark-theme', 'dark'],
    ['light-theme', 'light'],
  ] as const) {
    await theme(themeId);
    await page.screenshot({ path: `${SHOTS}/L13-invites-${label}.png` });
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await theme('dark-theme');
  await page.screenshot({ path: `${SHOTS}/L13-invites-phone.png` });
});
