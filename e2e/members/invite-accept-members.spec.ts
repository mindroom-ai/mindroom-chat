import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import { matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { onWebKitPage, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// An invite accepted in the app (Join on its Activity row, or on the room's invite page): the
// room then knows its members as a room opened any other way does. The inviter is listed under
// their name and role, their messages carry their name, and a direct chat is named after them,
// also after a reload. Runs in Chromium and, when PLAYWRIGHT_WEBKIT_EXECUTABLE names Playwright's
// WebKit, in WebKit, against the disposable homeserver. INVITE_ACCEPT_SHOTS=<directory> saves the
// room after the accept.
const PASSWORD = 'invite-accept-members-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.INVITE_ACCEPT_SHOTS;
const HOST_NAME = 'Ari Host';
const GUEST_NAME = 'Noa Guest';

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const setDisplayName = (user: DisposableUser, displayname: string) =>
  matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(user.userId)}/displayname`, {
    method: 'PUT',
    accessToken: user.accessToken,
    body: JSON.stringify({ displayname }),
  });

const localpart = (userId: string): string => userId.slice(1).split(':')[0] ?? userId;

type People = { host: DisposableUser; guest: DisposableUser };

const registerPeople = async (tag: string): Promise<People> => {
  const host = await registerDisposableUser(`iam_host_${tag}_${RUN}`, PASSWORD);
  const guest = await registerDisposableUser(`iam_guest_${tag}_${RUN}`, PASSWORD);
  await setDisplayName(host, HOST_NAME);
  await setDisplayName(guest, GUEST_NAME);
  return { host, guest };
};

/** The host creates a room (a direct chat when `name` is undefined), posts, and invites the guest. */
const inviteGuest = async (
  { host, guest }: People,
  name: string | undefined,
  body: string
): Promise<string> => {
  if (name === undefined) {
    // A direct chat invites at creation, so the invite carries `is_direct`, as a client's does.
    const direct = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
      method: 'POST',
      accessToken: host.accessToken,
      body: JSON.stringify({
        preset: 'trusted_private_chat',
        is_direct: true,
        invite: [guest.userId],
      }),
    });
    await sendRoomMessage(HOMESERVER, host.accessToken, direct.room_id, {
      msgtype: 'm.text',
      body,
    });
    return direct.room_id;
  }
  const created = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: host.accessToken,
    body: JSON.stringify({ preset: 'private_chat', name }),
  });
  const roomId = created.room_id;
  await sendRoomMessage(HOMESERVER, host.accessToken, roomId, { msgtype: 'm.text', body });
  await matrixFetch(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/invite`, {
    method: 'POST',
    accessToken: host.accessToken,
    body: JSON.stringify({ user_id: guest.userId }),
  });
  return roomId;
};

const signIn = async (page: Page, guest: DisposableUser) => {
  await loginWithPassword(page, { homeserver: HOMESERVER, ...guest });
};

/** The joined room lists the host by name with their role, and heads their message with it. */
const expectHostKnown = async (page: Page, { host }: People, body: string) => {
  const message = page.getByText(body, { exact: true }).first();
  await expect(message).toBeVisible({ timeout: 30_000 });
  // The header's button says Hide Members while the panel is open.
  const showMembers = page.getByRole('button', { name: 'Members', exact: true });
  await expect(showMembers.or(page.getByRole('button', { name: 'Hide Members' }))).toBeVisible();
  if (await showMembers.isVisible()) await showMembers.click();
  // The panel: the nearest box around its name filter that holds member rows. The filter also
  // invites for someone the room lets invite.
  const panel = page
    .getByRole('textbox', { name: /^(Type name|Search or invite people)\.\.\.$/ })
    .locator('xpath=ancestor::*[.//button[@data-user-id]][1]');
  const hostRow = panel.locator(`button[data-user-id="${host.userId}"]`);
  await expect(hostRow).toContainText(HOST_NAME, { timeout: 20_000 });
  // The host created the room, so the panel lists them under its top role.
  await expect(page.getByText('Founder', { exact: true })).toBeVisible();
  await expect(page.getByText(HOST_NAME, { exact: true }).first()).toBeVisible();
  const timeline = page.locator('main, [role="main"]').first();
  await expect(timeline.getByText(localpart(host.userId), { exact: true })).toHaveCount(0);
};

/**
 * Reloads once the saved sync holds the join: the client saves it within 10 s of a state change.
 * The next start replays that copy, which has no invite state to fall back on.
 */
const reloadFromSavedSync = async (page: Page) => {
  await page.waitForTimeout(12_000);
  await page.reload();
};

/** Joins with the invite's row in the rail's Activity popover, as people do, without a reload. */
const acceptFromActivity = async (page: Page, roomLabel: string) => {
  await page
    .getByRole('navigation', { name: 'Main', exact: true })
    .getByRole('button', { name: /^Activity/ })
    .click();
  const popover = page.getByRole('dialog', { name: 'Activity', exact: true });
  const row = popover.locator('[data-activity-row="invite"]').filter({ hasText: roomLabel });
  await row.first().getByRole('button', { name: 'Join', exact: true }).click({ timeout: 30_000 });
  await expect(row).toHaveCount(0, { timeout: 30_000 });
  await page.keyboard.press('Escape');
  await expect(popover).toBeHidden();
};

/**
 * Opens the room from the rail's section and its room list, without loading the page again; the
 * section may open on the room already. The section's button is pressed only from elsewhere:
 * pressed while its section shows, it folds the room list away.
 */
const openRoom = async (
  page: Page,
  section: 'Home' | 'Direct Messages',
  roomId: string,
  name: RegExp
) => {
  const sectionPath = section === 'Home' ? '/home/' : '/direct/';
  if (!new URL(page.url()).pathname.startsWith(sectionPath)) {
    await page.getByRole('button', { name: section, exact: true }).first().click();
  }
  const inRoom = () => decodeURIComponent(page.url()).includes(roomId);
  await expect(async () => {
    if (!inRoom()) await page.getByRole('link', { name }).first().click({ timeout: 5_000 });
    expect(inRoom()).toBe(true);
  }).toPass({ timeout: 30_000 });
};

const acceptedFromActivity = async (page: Page, browserName: string) => {
  const people = await registerPeople(`activity_${browserName}`);
  const roomName = `Accept probe ${browserName} ${RUN}`;
  const body = `Welcome to the accept probe ${browserName}`;
  // The guest is signed in when the invite arrives, as people usually are.
  await signIn(page, people.guest);
  const roomId = await inviteGuest(people, roomName, body);
  await acceptFromActivity(page, roomName);
  await openRoom(page, 'Home', roomId, new RegExp(roomName));
  await expectHostKnown(page, people, body);
  await reloadFromSavedSync(page);
  await expectHostKnown(page, people, body);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/activity-accept-${browserName}.png` });
};

const acceptedOnInvitePage = async (page: Page, browserName: string) => {
  const people = await registerPeople(`page_${browserName}`);
  const roomName = `Join page probe ${browserName} ${RUN}`;
  const body = `Welcome to the join page probe ${browserName}`;
  const roomId = await inviteGuest(people, roomName, body);
  await signIn(page, people.guest);
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  await page
    .getByRole('button', { name: /^(Join|Accept)$/ })
    .first()
    .click({ timeout: 30_000 });
  await expectHostKnown(page, people, body);
  await reloadFromSavedSync(page);
  await expectHostKnown(page, people, body);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/invite-page-join-${browserName}.png` });
};

const directChatNamedAfterHost = async (page: Page, browserName: string) => {
  const people = await registerPeople(`dm_${browserName}`);
  const body = `Hi there, a direct message ${browserName}`;
  await signIn(page, people.guest);
  const roomId = await inviteGuest(people, undefined, body);
  await acceptFromActivity(page, HOST_NAME);
  // The direct chat is listed and titled with the host's name, never their Matrix ID.
  await openRoom(page, 'Direct Messages', roomId, new RegExp(HOST_NAME));
  await expect(page.getByRole('link', { name: new RegExp(HOST_NAME) }).first()).toBeVisible();
  await expectHostKnown(page, people, body);
  await expect(page.getByText(people.host.userId, { exact: true })).toHaveCount(0);
  await reloadFromSavedSync(page);
  await expectHostKnown(page, people, body);
  await expect(page.getByText(people.host.userId, { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: HOST_NAME, level: 1 })).toBeVisible();
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/direct-accept-${browserName}.png` });
};

const cases = [
  ['a Join in Activity lists the inviter by name', acceptedFromActivity],
  ['Join on the invite page lists the inviter by name', acceptedOnInvitePage],
  ['an accepted direct chat is named after the inviter', directChatNamedAfterHost],
] as const;

for (const [title, run] of cases) {
  test(`${title} (Chromium)`, async ({ page, browserName }) => {
    test.setTimeout(180_000);
    await run(page, browserName);
  });

  test(`${title} (WebKit)`, async ({ baseURL }) => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
    test.setTimeout(180_000);
    await onWebKitPage({ viewport: { width: 1280, height: 800 }, baseURL }, (page) =>
      run(page, 'webkit')
    );
  });
}
