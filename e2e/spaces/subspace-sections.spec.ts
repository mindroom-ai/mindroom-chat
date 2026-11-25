import { mkdirSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContextOptions,
  type Locator,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  joinRoom,
  matrixFetch,
  sendRoomMessage,
  sendStateEvent,
  setAccountData,
} from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// A space lists its own rooms followed by inline collapsible sections for joined descendant
// sub-spaces in pre-order DFS: editable empty sub-spaces stay visible as drop targets while
// non-editable empty organizers are skipped without hiding their populated descendants.
// Dragging a room onto another eligible section moves it there and persists across reload.
// Collapsing a section hides its rooms, persists across reload, keeps the currently selected room
// visible, and shows a compact unread dot while any hidden room has unread messages. Clicking a
// room in any section opens it under the parent space route, keyboard room-stepping crosses
// sections, and visiting a sub-space directly still shows Back to the parent. Set
// SUBSPACES_SECTIONS_SHOTS (or SUBSPACES_MENU_SHOTS) to capture screenshots.
const PASSWORD = 'subspace-sections-spec-password';
const RUN = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const SHOTS =
  process.env.SPACE_QUICK_ACTIONS_SHOTS ??
  process.env.SUBSPACES_SECTIONS_SHOTS ??
  process.env.SUBSPACES_MENU_SHOTS;
const PARENT = 'Field Notes';
const PARENT_ROOMS = ['Book Swap', 'Garden Club', 'Harbor Plans'];
const DESIGN = 'Design Team';
const DESIGN_ROOMS = ['Design Review', 'Icon Sketches'];
const ORGANIZER = 'Operations';
const READONLY_ORGANIZER = 'Readonly Archive';
const RESEARCH = 'Research Group';
const RESEARCH_ROOMS = ['Field Interviews', 'Reading List'];
const ALL_ROOMS = [...PARENT_ROOMS, ...DESIGN_ROOMS, ...RESEARCH_ROOMS];
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

const register = async (name: string) => {
  const username = `sss_${name}_${RUN}`;
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

type Seed = {
  username: string;
  parent: string;
  design: string;
  organizer: string;
  readonlyOrganizer: string;
  research: string;
  roomIds: Record<string, string>;
};
const seeds = new Map<string, Promise<Seed>>();

/**
 * One account per engine: Field Notes -> (own rooms, Design Team, editable empty Operations ->
 * Research Group, and non-editable empty Readonly Archive owned by peer). Reading List stays
 * unread for unread-dot checks; tests avoid opening it.
 */
const seed = async (engine: string): Promise<Seed> => {
  const viewer = await register(`viewer_${engine}`);
  const peer = await register(`peer_${engine}`);
  const token = viewer.accessToken;
  const via = new URL(HOMESERVER).host;
  const roomIds: Record<string, string> = {};
  const space = async (name: string) => createPrivateSpace(HOMESERVER, token, { name, topic: '' });
  const rooms = async (spaceId: string, names: string[], unread?: string) => {
    for (const name of names) {
      const roomId = await createPrivateRoom(HOMESERVER, token, {
        name,
        topic: 'Weekly notes and decisions',
        invite: [peer.userId],
      });
      roomIds[name] = roomId;
      await addRoomToSpace(HOMESERVER, token, spaceId, roomId);
      if (name === unread) {
        await joinRoom(HOMESERVER, peer.accessToken, roomId);
        await sendRoomMessage(HOMESERVER, peer.accessToken, roomId, {
          msgtype: 'm.text',
          body: 'The interview notes from Tuesday are up, have a look when you can.',
        });
      }
    }
  };
  const parent = await space(PARENT);
  const design = await space(DESIGN);
  const organizer = await space(ORGANIZER);
  const readonlyOrganizer = await createPrivateSpace(HOMESERVER, peer.accessToken, {
    name: READONLY_ORGANIZER,
    topic: '',
    invite: [viewer.userId],
  });
  await joinRoom(HOMESERVER, token, readonlyOrganizer);
  const research = await space(RESEARCH);
  await addRoomToSpace(HOMESERVER, token, parent, design);
  await addRoomToSpace(HOMESERVER, token, parent, organizer);
  await sendStateEvent(HOMESERVER, token, parent, 'm.space.child', readonlyOrganizer, {
    via: [via],
  });
  await addRoomToSpace(HOMESERVER, token, organizer, research);
  await rooms(parent, PARENT_ROOMS);
  await rooms(design, DESIGN_ROOMS);
  await rooms(research, RESEARCH_ROOMS, 'Reading List');
  await setAccountData(HOMESERVER, token, viewer.userId, 'io.mindroom.spaces', {
    sidebar: [parent],
  });
  return {
    username: viewer.username,
    parent,
    design,
    organizer,
    readonlyOrganizer,
    research,
    roomIds,
  };
};

const signIn = async (
  browser: Browser,
  engine: string,
  options: BrowserContextOptions,
  language?: string
) => {
  if (!seeds.has(engine)) seeds.set(engine, seed(engine));
  const seeded = await seeds.get(engine)!;
  const context = await browser.newContext(options);
  // A missing control fails its step quickly instead of the whole test's timeout.
  context.setDefaultTimeout(30_000);
  const page = await context.newPage();
  // The slot has no provisioning service.
  await page.route('**/v1/local-mindroom/connections', (route) =>
    route.fulfill({ json: { connections: [] } })
  );
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: seeded.username,
    password: PASSWORD,
  });
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  if (language) {
    await page.evaluate((code) => localStorage.setItem('i18nextLng', code), language);
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
    await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  }
  await page.goto('/home/');
  await expect(page.locator(`[data-id="${seeded.parent}"]`).first()).toBeVisible();
  return { context, page, seeded };
};

const escaped = (value: string) => encodeURIComponent(value).replace(/[!$.]/g, '\\$&');
const spacePath = (space: string) => new RegExp(`/${escaped(space)}/?$`);
const lobbyPath = (space: string) => new RegExp(`/${escaped(space)}/lobby/?$`);
const roomPath = (space: string, roomId: string) =>
  new RegExp(`/${escaped(space)}/${escaped(roomId)}/?$`);

const list = (page: Page) => page.getByTestId('resizable-page-nav');
// A row's name also holds its unread count; the rooms' names share no words.
const roomRow = (page: Page, name: string) => list(page).getByRole('link', { name });
const sectionButton = (page: Page, categoryId: string) =>
  list(page).locator(`[data-category-id="${categoryId}"]`);
const sectionContainer = (page: Page, categoryId: string) =>
  sectionButton(page, categoryId).locator('xpath=../..');
const sectionRoomIds = (page: Page, categoryId: string) =>
  sectionContainer(page, categoryId)
    .locator('[data-room-id]')
    .evaluateAll(
      (nodes, ownerCategoryId) =>
        nodes
          .filter((node) => {
            const ownerSection = node.closest('[data-depth]');
            if (!ownerSection) return true;
            const ownerButton = ownerSection.querySelector(
              ':scope > [role="heading"] [data-category-id]'
            );
            return ownerButton?.getAttribute('data-category-id') === ownerCategoryId;
          })
          .map((node) => node.getAttribute('data-room-id')),
      categoryId
    );

const dragToSection = async (
  page: Page,
  from: Locator,
  to: Locator,
  whileOver?: () => Promise<void>
) => {
  const start = (await from.boundingBox())!;
  const target = (await to.boundingBox())!;
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2 + 12, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await whileOver?.();
  await page.mouse.up();
};

/** The list shows exactly these rooms of the seeded hierarchy. */
const expectRooms = async (page: Page, shown: string[]) => {
  for (const name of ALL_ROOMS) {
    if (shown.includes(name)) await expect(roomRow(page, name), name).toBeVisible();
    else await expect(roomRow(page, name), name).toHaveCount(0);
  }
};

const checkDesktop = async (browser: Browser, engine: string, language?: string) => {
  const { context, page, seeded } = await signIn(browser, engine, DESKTOP, language);
  const rootId = `${seeded.parent}|room`;
  const designId = `${seeded.parent}|subspace|${seeded.design}`;
  const organizerId = `${seeded.parent}|subspace|${seeded.organizer}`;
  const readonlyOrganizerId = `${seeded.parent}|subspace|${seeded.readonlyOrganizer}`;
  const researchId = `${seeded.parent}|subspace|${seeded.research}`;

  await page.locator(`[data-id="${seeded.parent}"]`).first().click();
  await expect(page).toHaveURL(lobbyPath(seeded.parent));
  await expect(list(page).locator('[data-subspaces-menu]')).toHaveCount(0);

  // Editable empty sub-spaces (Operations) render as drop targets while non-editable empty
  // organizers (Readonly Archive) stay hidden.
  await expect(sectionButton(page, rootId)).toBeVisible();
  await expect(sectionButton(page, designId)).toBeVisible();
  await expect(sectionButton(page, organizerId)).toBeVisible();
  await expect(sectionButton(page, readonlyOrganizerId)).toHaveCount(0);
  await expect(sectionButton(page, researchId)).toBeVisible();
  await expectRooms(page, ALL_ROOMS);

  // An English sub-space header reads left to right in Arabic too.
  const designText = sectionButton(page, designId).getByText(DESIGN, { exact: true });
  expect(await designText.evaluate((element) => getComputedStyle(element).direction)).toBe('ltr');
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/subspace-sections-${engine}-${language ?? 'en'}.png` });
  }

  // Collapsing Research Group hides its rooms and shows the unread dot; Design Team has no unread.
  await sectionButton(page, researchId).click();
  await expect(sectionButton(page, researchId)).toHaveAttribute('aria-expanded', 'false');
  await expect(sectionButton(page, researchId).locator('[data-unread]')).toHaveCount(1);
  await expect(sectionButton(page, researchId)).toHaveAttribute('aria-label', new RegExp(RESEARCH));
  await sectionButton(page, designId).click();
  await expect(sectionButton(page, designId)).toHaveAttribute('aria-expanded', 'false');
  await expect(sectionButton(page, designId).locator('[data-unread]')).toHaveCount(0);
  await expectRooms(page, PARENT_ROOMS);
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/subspace-sections-collapsed-${engine}-${language ?? 'en'}.png`,
    });
  }

  // Collapsed state persists across reload.
  await page.reload();
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await expect(sectionButton(page, researchId)).toHaveAttribute('aria-expanded', 'false');
  await expect(sectionButton(page, researchId).locator('[data-unread]')).toHaveCount(1);
  await expect(sectionButton(page, designId)).toHaveAttribute('aria-expanded', 'false');
  await expectRooms(page, PARENT_ROOMS);

  // Opening a room in a sub-space keeps the parent space route; collapsing keeps it visible.
  await sectionButton(page, designId).click();
  await roomRow(page, 'Design Review').click();
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Design Review']!));
  await sectionButton(page, designId).click();
  await expect(sectionButton(page, designId)).toHaveAttribute('aria-expanded', 'false');
  await expectRooms(page, [...PARENT_ROOMS, 'Design Review']);

  // Direct sub-space URL still shows Back to the parent space.
  await page.goto(`/${encodeURIComponent(seeded.design)}/lobby/`);
  await expect(page).toHaveURL(lobbyPath(seeded.design));
  await expectRooms(page, DESIGN_ROOMS);
  await list(page)
    .getByRole('button', { name: new RegExp(PARENT) })
    .click();
  await expect(page).toHaveURL(new RegExp(`/${escaped(seeded.parent)}/`));
  await context.close();
};

const checkKeyboard = async (browser: Browser, engine: string) => {
  const { context, page, seeded } = await signIn(browser, engine, DESKTOP);
  const designId = `${seeded.parent}|subspace|${seeded.design}`;

  await page.goto(`/${encodeURIComponent(seeded.parent)}/lobby/`);
  await expectRooms(page, ALL_ROOMS);
  await roomRow(page, 'Harbor Plans').click();
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Harbor Plans']!));

  // Alt+ArrowDown steps across Rooms -> Design Team -> Research Group (past empty Operations).
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Design Review']!));
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Icon Sketches']!));
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Field Interviews']!));

  // Alt+ArrowUp steps back across the same section boundaries.
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Icon Sketches']!));
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Design Review']!));
  await page.keyboard.press('Alt+ArrowUp');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Harbor Plans']!));

  // Collapsing Design Team via keyboard makes Alt+ArrowDown skip straight to Research Group.
  await sectionButton(page, designId).focus();
  await page.keyboard.press('Enter');
  await expect(sectionButton(page, designId)).toHaveAttribute('aria-expanded', 'false');
  await page.keyboard.press('Alt+ArrowDown');
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Field Interviews']!));
  await context.close();
};

const checkDragMove = async (browser: Browser, engine: string) => {
  // Isolated account so Matrix state moves do not affect the shared seed of other tests.
  const { context, page, seeded } = await signIn(browser, `${engine}_drag`, DESKTOP);
  const rootId = `${seeded.parent}|room`;
  const designId = `${seeded.parent}|subspace|${seeded.design}`;
  const organizerId = `${seeded.parent}|subspace|${seeded.organizer}`;
  const bookSwap = seeded.roomIds['Book Swap']!;
  const gardenClub = seeded.roomIds['Garden Club']!;
  const harborPlans = seeded.roomIds['Harbor Plans']!;
  const designReview = seeded.roomIds['Design Review']!;
  const iconSketches = seeded.roomIds['Icon Sketches']!;

  await page.goto(`/${encodeURIComponent(seeded.parent)}/lobby/`);
  await expect(sectionButton(page, organizerId)).toBeVisible();
  await expect
    .poll(() => sectionRoomIds(page, rootId))
    .toEqual([bookSwap, gardenClub, harborPlans]);
  await expect.poll(() => sectionRoomIds(page, organizerId)).toEqual([]);

  // Drag Book Swap from Rooms into the empty Operations sub-space section.
  await dragToSection(
    page,
    list(page).locator(`[data-room-id="${bookSwap}"]`),
    sectionButton(page, organizerId),
    async () => {
      await expect(sectionContainer(page, organizerId)).toHaveAttribute(
        'data-section-drop-target',
        'true'
      );
      if (SHOTS) {
        await page.screenshot({ path: `${SHOTS}/subspace-sections-drag-target-${engine}.png` });
      }
    }
  );
  await expect.poll(() => sectionRoomIds(page, organizerId)).toEqual([bookSwap]);
  await expect.poll(() => sectionRoomIds(page, rootId)).toEqual([gardenClub, harborPlans]);
  await expect(page).toHaveURL(lobbyPath(seeded.parent));

  // Drag Harbor Plans from Rooms onto populated Design Team (highlights the whole section).
  await dragToSection(
    page,
    list(page).locator(`[data-room-id="${harborPlans}"]`),
    list(page).locator(`[data-room-id="${designReview}"]`),
    async () => {
      await expect(sectionContainer(page, designId)).toHaveAttribute(
        'data-section-drop-target',
        'true'
      );
      await expect(list(page).locator('[data-drop-at]')).toHaveCount(0);
    }
  );
  await expect.poll(() => sectionRoomIds(page, rootId)).toEqual([gardenClub]);
  await expect
    .poll(() => sectionRoomIds(page, designId))
    .toEqual([designReview, harborPlans, iconSketches]);
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/subspace-sections-after-move-${engine}.png` });
  }

  // Both moves persist across a full reload.
  await page.reload();
  await expect(page.getByTestId('client-sync-status')).toHaveCount(0, { timeout: 60_000 });
  await expect.poll(() => sectionRoomIds(page, rootId)).toEqual([gardenClub]);
  await expect
    .poll(() => sectionRoomIds(page, designId))
    .toEqual([designReview, harborPlans, iconSketches]);
  await expect.poll(() => sectionRoomIds(page, organizerId)).toEqual([bookSwap]);
  await context.close();
};

const checkQuickActions = async (browser: Browser, engine: string) => {
  // Isolated account so room creation and sub-space removal do not mutate other tests' seed.
  const { context, page, seeded } = await signIn(browser, `${engine}_quick`, DESKTOP);
  const rootId = `${seeded.parent}|room`;
  const designId = `${seeded.parent}|subspace|${seeded.design}`;
  const researchId = `${seeded.parent}|subspace|${seeded.research}`;

  if (SHOTS) mkdirSync(SHOTS, { recursive: true });

  await page.goto(`/${encodeURIComponent(seeded.parent)}/lobby/`);
  await expect(sectionButton(page, designId)).toBeVisible();
  await expect(sectionButton(page, researchId)).toBeVisible();

  // Space overview sub-space room cards align flush-left with root room cards.
  const rootLobbyCard = page.locator(`[data-lobby-entry="${seeded.roomIds['Book Swap']!}"]`);
  const subspaceLobbyCard = page.locator(
    `[data-lobby-entry="${seeded.roomIds['Design Review']!}"]`
  );
  await expect(rootLobbyCard).toBeVisible({ timeout: 30_000 });
  await expect(subspaceLobbyCard).toBeVisible({ timeout: 30_000 });
  const [rootCardBox, subspaceCardBox] = await Promise.all([
    rootLobbyCard.boundingBox(),
    subspaceLobbyCard.boundingBox(),
  ]);
  expect(Math.abs(rootCardBox!.x - subspaceCardBox!.x)).toBeLessThanOrEqual(2);

  // Space header ⋮ omits Add entries (deduplicated against +), and Leave Space names the space.
  await list(page).getByRole('button', { name: 'Space Options', exact: true }).click();
  const headerOptionsMenu = page.getByRole('menu');
  await expect(
    headerOptionsMenu.getByRole('menuitem', { name: 'Space Settings', exact: true })
  ).toBeVisible();
  await expect(
    headerOptionsMenu.getByRole('menuitem', { name: 'New Room', exact: true })
  ).toHaveCount(0);
  await headerOptionsMenu.getByRole('menuitem', { name: 'Leave Space', exact: true }).click();
  const leaveSpaceDialog = page.getByRole('alertdialog', { name: 'Leave Space' });
  await expect(leaveSpaceDialog).toBeVisible();
  await expect(leaveSpaceDialog.getByText(PARENT, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(leaveSpaceDialog).toHaveCount(0);

  // 1. Space header + opens the 4-item Add menu and creates a room directly in the root space.
  await list(page)
    .getByRole('button', { name: `Add to ${PARENT}`, exact: true })
    .click();
  const headerAddMenu = page.getByRole('menu');
  await expect(
    headerAddMenu.getByRole('menuitem', { name: 'New Room', exact: true })
  ).toBeVisible();
  await expect(
    headerAddMenu.getByRole('menuitem', { name: 'Add Existing Room', exact: true })
  ).toBeVisible();
  await expect(
    headerAddMenu.getByRole('menuitem', { name: 'New Sub-space', exact: true })
  ).toBeVisible();
  await expect(
    headerAddMenu.getByRole('menuitem', { name: 'Add Existing Sub-space', exact: true })
  ).toBeVisible();
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/space-header-add-menu.png` });
  }
  await headerAddMenu.getByRole('menuitem', { name: 'New Room', exact: true }).click();
  const createRootDialog = page.getByRole('dialog');
  await createRootDialog.locator('input[name="nameInput"]').fill('Header Quick Room');
  await createRootDialog.locator('button[type="submit"]').click();
  await expect(
    sectionContainer(page, rootId).getByRole('link', { name: 'Header Quick Room' })
  ).toBeVisible({ timeout: 30_000 });

  // 2. Sub-space section + adds a new room directly into Design Team.
  await sectionButton(page, designId).hover();
  await list(page)
    .getByRole('button', { name: `Add to ${DESIGN}`, exact: true })
    .click();
  const designAddMenu = page.getByRole('menu');
  await expect(
    designAddMenu.getByRole('menuitem', { name: 'New Sub-space', exact: true })
  ).toBeVisible();
  await designAddMenu.getByRole('menuitem', { name: 'New Room', exact: true }).click();
  const createDesignDialog = page.getByRole('dialog');
  await createDesignDialog.locator('input[name="nameInput"]').fill('Design Quick Room');
  await createDesignDialog.locator('button[type="submit"]').click();
  await expect(roomRow(page, 'Design Quick Room')).toBeVisible({ timeout: 30_000 });

  // Return to Field Notes and confirm Design Quick Room lives under Design Team, not root Rooms.
  await page.locator(`[data-id="${seeded.parent}"]`).first().click();
  const designQuickRoomLink = sectionContainer(page, designId).getByRole('link', {
    name: 'Design Quick Room',
  });
  await expect(designQuickRoomLink).toBeVisible({ timeout: 30_000 });
  await expect(
    sectionContainer(page, rootId).getByRole('link', { name: 'Design Quick Room' })
  ).toHaveCount(0);

  // Right-clicking a room inside a sub-space offers Remove from <sub-space> and unlinks it.
  await designQuickRoomLink.click({ button: 'right' });
  const roomContextMenu = page.getByRole('menu');
  await expect(
    roomContextMenu.getByRole('menuitem', { name: `Remove from ${DESIGN}`, exact: true })
  ).toBeVisible();
  await roomContextMenu
    .getByRole('menuitem', { name: `Remove from ${DESIGN}`, exact: true })
    .click();
  await expect(designQuickRoomLink).toHaveCount(0);

  // 3. Desktop sub-space ⋮ opens management-only options without repeating Add entries.
  await sectionButton(page, designId).hover();
  await list(page)
    .getByRole('button', { name: `${DESIGN} options`, exact: true })
    .click();
  const designOptionsMenu = page.getByRole('menu');
  await expect(
    designOptionsMenu.getByRole('menuitem', { name: 'New Room', exact: true })
  ).toHaveCount(0);
  await expect(
    designOptionsMenu.getByRole('menuitem', { name: 'Space Settings', exact: true })
  ).toBeVisible();
  await expect(
    designOptionsMenu.getByRole('menuitem', { name: 'Pin to Sidebar', exact: true })
  ).toBeVisible();
  await expect(
    designOptionsMenu.getByRole('menuitem', { name: `Remove from ${PARENT}`, exact: true })
  ).toBeVisible();
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/subspace-section-menu.png` });
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);

  // 4. Right-clicking nested Research Group includes both Add and Remove from immediate parent.
  await sectionButton(page, researchId).click({ button: 'right' });
  const researchMenu = page.getByRole('menu');
  await expect(researchMenu.getByRole('menuitem', { name: 'New Room', exact: true })).toBeVisible();
  await expect(
    researchMenu.getByRole('menuitem', { name: `Remove from ${ORGANIZER}`, exact: true })
  ).toBeVisible();
  await researchMenu
    .getByRole('menuitem', { name: `Remove from ${ORGANIZER}`, exact: true })
    .click();
  await expect(sectionButton(page, researchId)).toHaveCount(0);

  // 5. Left-rail right-click on Field Notes opens the grouped rail context menu.
  await sectionContainer(page, rootId).getByRole('link', { name: 'Header Quick Room' }).click();
  await page.locator(`[data-id="${seeded.parent}"]`).first().click({ button: 'right' });
  const railMenu = page.getByRole('menu');
  for (const entry of ['New Room', 'New Sub-space', 'Space overview', 'Leave Space']) {
    // eslint-disable-next-line no-await-in-loop
    await expect(railMenu.getByRole('menuitem', { name: entry, exact: true })).toBeVisible();
  }
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/rail-context-menu.png` });
  }
  await railMenu.getByRole('menuitem', { name: 'Space overview', exact: true }).click();
  await expect(page).toHaveURL(lobbyPath(seeded.parent));

  await context.close();
};

const checkPhone = async (browser: Browser, engine: string, language?: string) => {
  const { context, page, seeded } = await signIn(browser, engine, PHONE, language);
  const designId = `${seeded.parent}|subspace|${seeded.design}`;
  const organizerId = `${seeded.parent}|subspace|${seeded.organizer}`;
  const readonlyOrganizerId = `${seeded.parent}|subspace|${seeded.readonlyOrganizer}`;

  await page.locator(`[data-id="${seeded.parent}"]`).first().tap();
  await expect(page).toHaveURL(spacePath(seeded.parent));
  await expect(sectionButton(page, organizerId)).toBeVisible();
  await expect(sectionButton(page, readonlyOrganizerId)).toHaveCount(0);
  await expectRooms(page, ALL_ROOMS);
  if (SHOTS) {
    await page.screenshot({
      path: `${SHOTS}/subspace-sections-phone-${engine}-${language ?? 'en'}.png`,
    });
  }

  if (!language) {
    // Phone sub-space headers hide `+` and fold Add entries into `⋮`.
    await expect(
      list(page).getByRole('button', { name: `Add to ${DESIGN}`, exact: true })
    ).toBeHidden();
    await list(page)
      .getByRole('button', { name: `${DESIGN} options`, exact: true })
      .tap();
    const phoneDesignMenu = page.getByRole('menu');
    await expect(
      phoneDesignMenu.getByRole('menuitem', { name: 'New Room', exact: true })
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);
  }

  await sectionButton(page, designId).tap();
  await expect(sectionButton(page, designId)).toHaveAttribute('aria-expanded', 'false');
  await expectRooms(page, [...PARENT_ROOMS, ...RESEARCH_ROOMS]);
  await sectionButton(page, designId).tap();
  await expectRooms(page, ALL_ROOMS);

  // Tapping a room inside a sub-space opens it under the parent space route.
  await roomRow(page, 'Design Review').tap();
  await expect(page).toHaveURL(roomPath(seeded.parent, seeded.roomIds['Design Review']!));

  // Direct sub-space URL still shows Back to the parent space on a phone.
  await page.goto(`/${encodeURIComponent(seeded.design)}/`);
  await expect(page).toHaveURL(spacePath(seeded.design));
  await expectRooms(page, DESIGN_ROOMS);
  await list(page)
    .getByRole('button', { name: new RegExp(PARENT) })
    .tap();
  await expect(page).toHaveURL(spacePath(seeded.parent));
  await expectRooms(page, ALL_ROOMS);
  await context.close();
};

const inWebKit = async (check: (browser: Browser, engine: string) => Promise<void>) => {
  const browser = await launchWebKit();
  try {
    await check(browser, 'webkit');
  } finally {
    await browser.close();
  }
};

test.beforeEach(async () => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(180_000);
});

test('a parent shows inline collapsible sub-space sections with persistence and unread dots', async ({
  browser,
}) => {
  await checkDesktop(browser, 'chromium');
});

test('inline sub-space sections in Arabic', async ({ browser }) => {
  await checkDesktop(browser, 'chromium', 'ar');
});

test('keyboard room-stepping crosses inline sub-space sections', async ({ browser }) => {
  await checkKeyboard(browser, 'chromium');
});

test('dragging a room across sections moves it into an empty or populated sub-space and persists', async ({
  browser,
}) => {
  await checkDragMove(browser, 'chromium');
});

test('space header +, sub-space section actions, and rail right-click quick actions work end-to-end', async ({
  browser,
}) => {
  await checkQuickActions(browser, 'chromium');
});

test('on a phone sub-space sections collapse inline and back returns to the parent', async ({
  browser,
}) => {
  await checkPhone(browser, 'chromium');
});

test('on a phone in Arabic', async ({ browser }) => {
  await checkPhone(browser, 'chromium', 'ar');
});

test.describe('WebKit', () => {
  test.beforeEach(() => {
    test.skip(!WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  });
  test('inline sections on a desktop', () =>
    inWebKit((browser) => checkDesktop(browser, 'webkit')));
  test('keyboard stepping across sections', () =>
    inWebKit((browser) => checkKeyboard(browser, 'webkit')));
  test('dragging a room across sections', () =>
    inWebKit((browser) => checkDragMove(browser, 'webkit')));
  test('inline sections on a phone', () => inWebKit((browser) => checkPhone(browser, 'webkit')));
});
