import { expect, test, type Locator, type Page } from '@playwright/test';
import { chooseFromAccountMenu, loginWithPassword } from '../helpers/auth';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
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

  // Register invented personas and 7 invented agents (exceeding the 6-item Agents compact cap).
  const agentSpecs = [
    { slug: 'dev', name: 'DevAgent', role: 'Builds features' },
    { slug: 'researcher', name: 'Researcher', role: 'Answers research questions' },
    { slug: 'reviewer', name: 'Reviewer', role: 'Reviews pull requests' },
    { slug: 'planner', name: 'Planner', role: 'Plans project milestones' },
    { slug: 'triage', name: 'TriageBot', role: 'Triages incoming issues' },
    { slug: 'docs', name: 'DocsHelper', role: 'Maintains documentation' },
    { slug: 'release', name: 'ReleaseBot', role: 'Coordinates releases' },
  ] as const;

  const [viewer, liam, sora, ...agents] = await Promise.all([
    registerDisposableUser(`hda_maya_${RUN}`, PASSWORD),
    registerDisposableUser(`hda_liam_${RUN}`, PASSWORD),
    registerDisposableUser(`hda_sora_${RUN}`, PASSWORD),
    ...agentSpecs.map((spec) => registerAgentAccount(HOMESERVER, `${spec.slug}_${RUN}`)),
  ]);
  const devAgent = agents[0]!;

  await Promise.all([
    setDisplayName(viewer.accessToken, viewer.userId, 'Maya Patel'),
    setDisplayName(liam.accessToken, liam.userId, "Liam O'Connor"),
    setDisplayName(sora.accessToken, sora.userId, 'Sora Takahashi'),
    ...agents.map((agent, index) =>
      setDisplayName(agent.accessToken, agent.userId, agentSpecs[index]!.name)
    ),
  ]);

  // Create unspaced room, two spaces + rooms, 1:1 human DM, group DM, self-DM, and 1:1 agent DM.
  const createDm = (invite?: string[], name?: string) =>
    createPrivateRoom(HOMESERVER, viewer.accessToken, {
      preset: 'trusted_private_chat',
      invite,
      name,
      isDirect: true,
    });
  const general = await createPrivateRoom(HOMESERVER, viewer.accessToken, {
    name: 'general',
    // Invitees get the creator's power, so the agents may publish their io.mindroom.server state.
    preset: 'trusted_private_chat',
    invite: agents.map((agent) => agent.userId),
  });
  const [engineering, designReview, product, roadmap] = await Promise.all([
    createPrivateSpace(HOMESERVER, viewer.accessToken, { name: 'Engineering' }),
    createPrivateRoom(HOMESERVER, viewer.accessToken, { name: 'design-review' }),
    createPrivateSpace(HOMESERVER, viewer.accessToken, { name: 'Product' }),
    createPrivateRoom(HOMESERVER, viewer.accessToken, { name: 'roadmap' }),
  ]);
  await Promise.all([
    addRoomToSpace(HOMESERVER, viewer.accessToken, engineering, designReview),
    addRoomToSpace(HOMESERVER, viewer.accessToken, product, roadmap),
  ]);

  const liamDm = await createDm([liam.userId]);
  const groupDm = await createDm([liam.userId, sora.userId]);
  const selfDm = await createDm(undefined, 'Maya Patel');
  const devDm = await createDm([devAgent.userId]);

  await Promise.all([
    ...agents.map((agent) => joinRoom(HOMESERVER, agent.accessToken, general)),
    joinRoom(HOMESERVER, liam.accessToken, liamDm),
    joinRoom(HOMESERVER, liam.accessToken, groupDm),
    joinRoom(HOMESERVER, sora.accessToken, groupDm),
    joinRoom(HOMESERVER, devAgent.accessToken, devDm),
  ]);

  await Promise.all(
    agents.map((agent, index) =>
      sendStateEvent(HOMESERVER, agent.accessToken, general, 'io.mindroom.server', agent.userId, {
        role: agentSpecs[index]!.role,
      })
    )
  );

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
  await expect(addRoomsBtn).toBeFocused();

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

  // Verify Engineering and Product spaces sit between Rooms and Direct messages, and Agents caps at 5 + Show all (7).
  await expect(nav.locator(`button[data-category-id="home|space|${engineering}"]`)).toBeVisible();
  await expect(nav.locator(`button[data-category-id="home|space|${product}"]`)).toBeVisible();
  const devRow = roomLink(agentsSection, devDm);
  await expect(agentsSection.getByText('Researcher', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(devRow).toBeVisible({ timeout: 30_000 });
  await expect(devRow).toContainText('DevAgent');
  const agentsCapToggle = agentsSection.locator('[data-home-agents-action="toggle-all"]');
  await expect(agentsCapToggle).toHaveText('Show all (7)', { timeout: 30_000 });
  await expect(agentsSection.getByText('TriageBot', { exact: true })).toHaveCount(0);
  await captureShot(page, 'home-expanded');

  await agentsCapToggle.click();
  await expect(agentsCapToggle).toHaveText('Show less');
  await expect(agentsSection.getByText('TriageBot', { exact: true })).toBeVisible();
  await agentsCapToggle.click();
  await expect(agentsCapToggle).toHaveText('Show all (7)');
  await expect(agentsSection.getByText('TriageBot', { exact: true })).toHaveCount(0);

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
