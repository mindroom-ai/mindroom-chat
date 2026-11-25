import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  addRoomToSpace,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  sendStateEvent,
  setAccountData,
} from '../helpers/matrix';

// Slack-style Home sidebar: Search -> Rooms (+ inline Add rooms menu) -> Spaces -> Direct messages
// (1:1 human DM with unread, group DM with count avatar, self-DM "you", local draft pencil) ->
// Agents (@mindroom_* agent rows opening in /home/...). Also verifies collapsing Direct messages /
// Agents shows quiet unread dots and turning off Direct Messages in Settings -> Sidebar hides the
// rail button, adds Direct Messages to Home Options, and rolls DM unread onto Home's rail badge.
// Set HOME_DIRECT_AGENTS_SHOTS=<directory> to save home-expanded.png, home-collapsed.png, and
// settings-rail-off.png.
const PASSWORD = 'home-direct-agents-spec-password';
const RUN = Date.now().toString(36);
const SHOTS = process.env.HOME_DIRECT_AGENTS_SHOTS;

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

const homeNav = (page: Page) => page.getByRole('navigation', { name: 'Home', exact: true });
const railNav = (page: Page) => page.getByRole('navigation', { name: 'Main', exact: true });
const roomLink = (scope: Locator, roomId: string) =>
  scope.locator(`a[href*="${encodeURIComponent(roomId)}"], a[href*="${roomId}"]`);

const createDirectRoom = async (
  accessToken: string,
  invite?: string[],
  name?: string
): Promise<string> => {
  const body = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken,
    body: JSON.stringify({
      preset: 'trusted_private_chat',
      invite,
      name,
      is_direct: true,
    }),
  });
  return body.room_id;
};

const setDisplayName = async (accessToken: string, userId: string, displayName: string) => {
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(userId)}/displayname`, {
    method: 'PUT',
    accessToken,
    body: JSON.stringify({ displayname: displayName }),
  });
};

const captureShot = async (page: Page, name: string) => {
  if (!SHOTS) return;
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
  await page.mouse.move(0, 0);
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

test('renders Slack-style Rooms, Spaces, Direct messages, and Agents on Home and supports hiding the Direct Messages rail tab', async ({
  page,
}) => {
  test.setTimeout(240_000);

  // Register invented personas and agents.
  const viewer = await registerDisposableUser(`hda_maya_${RUN}`, PASSWORD);
  const liam = await registerDisposableUser(`hda_liam_${RUN}`, PASSWORD);
  const sora = await registerDisposableUser(`hda_sora_${RUN}`, PASSWORD);
  const devAgent = await registerAgentAccount(HOMESERVER, `dev_${RUN}`);
  const researcher = await registerAgentAccount(HOMESERVER, `researcher_${RUN}`);

  await Promise.all([
    setDisplayName(viewer.accessToken, viewer.userId, 'Maya Patel'),
    setDisplayName(liam.accessToken, liam.userId, "Liam O'Connor"),
    setDisplayName(sora.accessToken, sora.userId, 'Sora Takahashi'),
    setDisplayName(devAgent.accessToken, devAgent.userId, 'DevAgent'),
    setDisplayName(researcher.accessToken, researcher.userId, 'Researcher'),
  ]);

  // Create unspaced room, space + nested room, 1:1 human DM, group DM, self-DM, and 1:1 agent DM.
  const general = await createRoom(HOMESERVER, viewer.accessToken, {
    name: 'general',
    // Invitees get the creator's power, so the agents may publish their io.mindroom.server state.
    preset: 'trusted_private_chat',
    invite: [devAgent.userId, researcher.userId],
  });
  const engineering = await createRoom(HOMESERVER, viewer.accessToken, {
    name: 'Engineering',
    space: true,
  });
  const designReview = await createRoom(HOMESERVER, viewer.accessToken, {
    name: 'design-review',
  });
  await addRoomToSpace(HOMESERVER, viewer.accessToken, engineering, designReview);

  const liamDm = await createDirectRoom(viewer.accessToken, [liam.userId]);
  const groupDm = await createDirectRoom(viewer.accessToken, [liam.userId, sora.userId]);
  const selfDm = await createDirectRoom(viewer.accessToken, undefined, 'Maya Patel');
  const devDm = await createDirectRoom(viewer.accessToken, [devAgent.userId]);

  await Promise.all([
    joinRoom(HOMESERVER, devAgent.accessToken, general),
    joinRoom(HOMESERVER, researcher.accessToken, general),
    joinRoom(HOMESERVER, liam.accessToken, liamDm),
    joinRoom(HOMESERVER, liam.accessToken, groupDm),
    joinRoom(HOMESERVER, sora.accessToken, groupDm),
    joinRoom(HOMESERVER, devAgent.accessToken, devDm),
  ]);

  await Promise.all([
    sendStateEvent(
      HOMESERVER,
      devAgent.accessToken,
      general,
      'io.mindroom.server',
      devAgent.userId,
      { role: 'Builds features' }
    ),
    sendStateEvent(
      HOMESERVER,
      researcher.accessToken,
      general,
      'io.mindroom.server',
      researcher.userId,
      { role: 'Answers research questions' }
    ),
  ]);

  await setAccountData(HOMESERVER, viewer.accessToken, viewer.userId, 'm.direct', {
    [liam.userId]: [liamDm, groupDm],
    [sora.userId]: [groupDm],
    [viewer.userId]: [selfDm],
    [devAgent.userId]: [devDm],
  });

  // Seed unread messages in Liam's 1:1 DM and DevAgent's DM.
  await sendRoomMessage(HOMESERVER, liam.accessToken, liamDm, {
    msgtype: 'm.text',
    body: 'Ready for the walkthrough whenever you are.',
  });
  await sendRoomMessage(HOMESERVER, devAgent.accessToken, devDm, {
    msgtype: 'm.text',
    body: 'Checks are green on the sidebar branch.',
  });

  await loginWithPassword(page, { homeserver: HOMESERVER, ...viewer });

  const nav = homeNav(page);
  const roomsSection = nav.getByTestId('room-nav-category');
  const dmSection = nav.getByTestId('home-direct-section');
  const agentsSection = nav.getByTestId('home-agents-section');

  await expect(roomsSection).toBeVisible({ timeout: 30_000 });
  await expect(dmSection).toBeVisible({ timeout: 30_000 });
  await expect(agentsSection).toBeVisible({ timeout: 30_000 });

  // 1. Populated Home renders Search -> Rooms (+ Add rooms) -> Spaces -> Direct messages -> Agents.
  await expect(nav.locator('[data-home-room-action="create"]')).toHaveCount(0);
  await expect(nav.locator('[data-home-room-action="join"]')).toHaveCount(0);
  const addRoomsBtn = nav.locator('[data-home-room-action="add"]');
  await expect(addRoomsBtn).toBeVisible();

  await addRoomsBtn.click();
  await expect(page.locator('[data-home-room-action="create"]')).toBeVisible();
  await expect(page.locator('[data-home-room-action="join"]')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-home-room-action="create"]')).toHaveCount(0);

  // Verify Direct messages chrome: 1:1 human DM, group DM count badge (3), and self-DM "you" tag.
  const liamRow = roomLink(dmSection, liamDm);
  const groupRow = roomLink(dmSection, groupDm);
  const selfRow = roomLink(dmSection, selfDm);
  await expect(liamRow).toBeVisible({ timeout: 30_000 });
  await expect(groupRow.locator('[data-direct-group-count="3"]')).toBeVisible();
  await expect(selfRow.locator('[data-self-dm-tag="true"]')).toHaveText('you');

  // Verify local draft pencil appears on the group DM row after typing an unsent draft and leaving.
  await groupRow.click();
  const composer = page.locator('[data-room-footer="true"] [contenteditable="true"]').last();
  await expect(composer).toBeVisible({ timeout: 30_000 });
  await composer.click();
  await page.keyboard.type('Draft note for design sync');
  await roomLink(nav, general).click();
  await page.mouse.move(0, 0);
  await expect(groupRow.locator('[data-draft-indicator="true"]')).toBeVisible({ timeout: 15_000 });

  // Verify Engineering space sits between Rooms and Direct messages, and Agents shows DevAgent + Researcher.
  await expect(nav.locator(`button[data-category-id="home|space|${engineering}"]`)).toBeVisible();
  const devRow = roomLink(agentsSection, devDm);
  await expect(agentsSection.getByText('Researcher', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(devRow).toBeVisible({ timeout: 30_000 });
  await expect(devRow).toContainText('DevAgent');
  await captureShot(page, 'home-expanded');

  await devRow.click();
  await expect.poll(() => decodeURIComponent(new URL(page.url()).pathname)).toBe(`/home/${devDm}`);
  await expect(nav).toBeVisible();
  await expect(devRow).toHaveAttribute('aria-current', 'page');

  // Return to general so neither Liam's DM nor DevAgent's DM is selected, then send a fresh agent DM
  // message so both Direct messages and Agents have unread items when collapsed.
  await roomLink(nav, general).click();
  await sendRoomMessage(HOMESERVER, devAgent.accessToken, devDm, {
    msgtype: 'm.text',
    body: 'Follow-up ready in Agents.',
  });

  // 2. Collapsing Direct messages and Agents reveals quiet unread dots on their headers.
  const dmHeader = dmSection.locator('button[data-category-id="mindroom|home-direct"]');
  const agentsHeader = agentsSection.locator('button[data-category-id="mindroom|home-agents"]');
  await dmHeader.click();
  await agentsHeader.click();
  await expect(dmHeader).toHaveAttribute('aria-expanded', 'false');
  await expect(agentsHeader).toHaveAttribute('aria-expanded', 'false');
  await expect(dmHeader.locator('[data-unread]')).toHaveCount(1, { timeout: 20_000 });
  await expect(agentsHeader.locator('[data-unread]')).toHaveCount(1, { timeout: 20_000 });
  await captureShot(page, 'home-collapsed');

  // 3. Turning off Direct Messages in Settings -> Sidebar hides the rail tab, adds it to Home's
  //    options menu, and rolls DM unread onto Home's rail badge.
  const railDirectBtn = railNav(page).getByRole('button', {
    name: 'Direct Messages',
    exact: true,
  });
  const railHomeBtn = railNav(page).getByRole('button', { name: 'Home', exact: true });
  await expect(railDirectBtn).toBeVisible();

  await chooseFromAccountMenu(page, 'Settings');
  await page.getByRole('button', { name: 'Sidebar', exact: true }).click();
  const directSwitch = page.getByRole('switch', {
    name: 'Show Direct Messages in the sidebar',
  });
  await expect(directSwitch).toHaveAttribute('aria-checked', 'true');
  await directSwitch.click();
  await expect(directSwitch).toHaveAttribute('aria-checked', 'false');
  await page.keyboard.press('Escape');

  await expect(railDirectBtn).toHaveCount(0);
  // Home rail item now carries the rolled-up unread badge from Liam's and DevAgent's DMs.
  const homeRailItem = railHomeBtn.locator('xpath=ancestor::div[1]');
  await expect(homeRailItem).toContainText(/[1-9]/);

  // Direct Messages remains reachable from Home's options menu.
  await nav.getByRole('button', { name: 'Home Options', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Direct Messages', exact: true })).toBeVisible();
  await captureShot(page, 'settings-rail-off');
  await page.keyboard.press('Escape');
});
