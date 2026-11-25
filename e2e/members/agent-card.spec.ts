import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
  type DisposableUser,
} from '../helpers/disposableAccounts';
import {
  getStateEvent,
  joinRoom,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
  sendStateEvent,
  type MatrixSession,
} from '../helpers/matrix';

// An agent's profile card. The page answers for the deployment's MindRoom server (no MindRoom
// runs): its client session and the agent's profile route, with the agent's configured tools.
// On a phone the card is a sheet named by the agent's name. Under More, the room's founder changes
// the agent's power through the power chip's menu, which opens inside the sheet: Escape closes only
// that menu and leaves the focus on the chip. An ordinary member sees the chip as a plain tag and no
// kick or ban. On a short desktop window the card stays inside the window as its tools arrive and
// More opens. Without a configured apiUrl, the card discovers the agent's server from its
// io.mindroom.server room state. AGENT_CARD_SHOTS=<directory> saves the sheet, menu and card.
const PASSWORD = 'agent-card-spec-password';
const RUN = randomUUID().replaceAll('-', '').slice(0, 8);
const MINDROOM_API = 'http://127.0.0.1:29597';
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const SHOTS = process.env.AGENT_CARD_SHOTS;
const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };
const PROFILE = {
  role: null,
  model: { config: 'example', display_name: 'Example Model' },
  tools: [
    {
      name: 'files',
      display_name: 'File Tools',
      description: 'Read and write files',
      category: 'development',
      mcp_server: null,
    },
    {
      name: 'search',
      display_name: 'Web Search',
      description: 'Search the web',
      category: 'research',
      mcp_server: null,
    },
  ],
};

let founder: DisposableUser;
let member: DisposableUser;
let agent: MatrixSession;
let roomId = '';
let rootId = '';

test.use({ video: 'off', trace: 'off' });

test.beforeAll(async () => {
  if (!(await disposableHomeserverIsUp())) return;
  founder = await registerDisposableUser(`card_founder_${RUN}`, PASSWORD);
  member = await registerDisposableUser(`card_member_${RUN}`, PASSWORD);
  agent = await registerAgentAccount(HOMESERVER, 'helper');
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(agent.userId)}/displayname`, {
    method: 'PUT',
    accessToken: agent.accessToken,
    body: JSON.stringify({ displayname: 'Helper' }),
  });
  const created = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: founder.accessToken,
    body: JSON.stringify({
      preset: 'private_chat',
      name: `Agent card ${RUN}`,
      invite: [agent.userId, member.userId],
    }),
  });
  roomId = created.room_id;
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  await joinRoom(HOMESERVER, member.accessToken, roomId);
  rootId = await sendRoomMessage(HOMESERVER, founder.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Can you sort the weekly planning notes?',
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Sorted by project, newest first.',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
});

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** Answers for the MindRoom server: a session for `user` and the agent's profile. */
const serveMindroom = async (
  context: BrowserContext,
  user: DisposableUser,
  computersApiUrl = MINDROOM_API
) => {
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = (await response.json()) as Record<string, Record<string, unknown>>;
    await route.fulfill({
      response,
      json: {
        ...config,
        homeserverList: [HOMESERVER],
        defaultHomeserver: 0,
        mindroom: { ...config.mindroom, computers: { apiUrl: computersApiUrl } },
      },
    });
  });
  await context.route(`${MINDROOM_API}/**`, async (route) => {
    const url = route.request().url();
    if (route.request().method() === 'OPTIONS')
      return route.fulfill({ status: 204, headers: CORS });
    if (url.endsWith('/api/client-sessions')) {
      return route.fulfill({
        headers: CORS,
        json: {
          session_token: `s-${RUN}`,
          user_id: user.userId,
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        },
      });
    }
    if (url.endsWith(`/agents/${encodeURIComponent(agent.userId)}/profile`)) {
      return route.fulfill({ headers: CORS, json: PROFILE });
    }
    return route.fulfill({ status: 404, headers: CORS, json: { detail: 'Not Found' } });
  });
};

/** Signs `user` in and opens the thread with the agent's reply. */
const openThread = async (page: Page, context: BrowserContext, user: DisposableUser) => {
  await serveMindroom(context, user);
  await loginWithPassword(page, { homeserver: HOMESERVER, ...user });
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
  await expect(page.getByText('Sorted by project, newest first.')).toBeVisible({ timeout: 60_000 });
};

const agentAvatar = (page: Page) => page.locator(`[data-user-id="${agent.userId}"]`).first();

test.describe('on a phone', () => {
  test.use(PHONE);

  test('the founder changes the agent power from its sheet, whose menu Escape closes alone', async ({
    page,
    context,
  }) => {
    test.slow();
    await openThread(page, context, founder);
    await agentAvatar(page).tap();
    const sheet = page.getByRole('dialog', { name: 'Helper', exact: true });
    await expect(sheet.getByText('Configured tools')).toBeVisible({ timeout: 30_000 });
    await expect(
      sheet.getByText('Availability can vary by request and permissions.')
    ).toBeVisible();
    await sheet.getByRole('button', { name: 'More', exact: true }).tap();
    await expect(sheet.getByText(agent.userId, { exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Kick', exact: true })).toBeVisible();

    const chip = sheet.getByRole('button', { name: 'Member' });
    await chip.tap();
    const menu = page.getByRole('menu', { name: 'Member' });
    await expect(menu.getByRole('menuitemradio', { name: /Moderator/ })).toBeVisible();
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-power-menu.png` });
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(chip).toBeFocused();

    await chip.tap();
    await menu.getByRole('menuitemradio', { name: /Moderator/ }).tap();
    await expect(sheet.getByRole('button', { name: 'Moderator' })).toBeVisible({ timeout: 20_000 });
    const levels = await getStateEvent(
      HOMESERVER,
      founder.accessToken,
      roomId,
      'm.room.power_levels',
      ''
    );
    expect((levels?.users as Record<string, number> | undefined)?.[agent.userId]).toBe(50);
    // With no menu open, Escape closes the sheet.
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
  });

  test('an ordinary member sees the power as a tag and no kick or ban', async ({
    page,
    context,
  }) => {
    test.slow();
    await openThread(page, context, member);
    await agentAvatar(page).tap();
    const sheet = page.getByRole('dialog', { name: 'Helper', exact: true });
    await expect(sheet.getByText('Configured tools')).toBeVisible({ timeout: 30_000 });
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/phone-sheet.png` });
    await sheet.getByRole('button', { name: 'More', exact: true }).tap();
    await expect(sheet.getByText(agent.userId, { exact: true })).toBeVisible();
    await expect(sheet.getByText(/^(Member|Moderator)$/)).toBeVisible();
    await expect(sheet.getByRole('button', { name: /^(Member|Moderator)$/ })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Kick', exact: true })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Ban', exact: true })).toHaveCount(0);
  });
});

test('on a short window the card stays inside it as its tools arrive and More opens', async ({
  page,
  context,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 560 });
  await openThread(page, context, member);
  await agentAvatar(page).click();
  const card = page.getByRole('dialog', { name: 'Helper', exact: true });
  await expect(card.getByText('Configured tools')).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'More', exact: true }).click();
  await expect(card.getByText(agent.userId, { exact: true })).toBeInViewport();
  const box = (await card.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(560);
  // Closing the card with More open leaves the page as it was.
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
  await expect(page.getByText('Sorted by project, newest first.')).toBeVisible();
});

test('discovers the agent server from room state when config.json sets no apiUrl', async ({
  page,
  context,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1280, height: 800 });
  const created = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: founder.accessToken,
    body: JSON.stringify({
      preset: 'private_chat',
      name: `Agent card discovered ${RUN}`,
      invite: [agent.userId, member.userId],
      power_level_content_override: { events: { 'io.mindroom.server': 0 } },
    }),
  });
  const discoveredRoom = created.room_id;
  await joinRoom(HOMESERVER, agent.accessToken, discoveredRoom);
  await joinRoom(HOMESERVER, member.accessToken, discoveredRoom);
  await sendStateEvent(
    HOMESERVER,
    agent.accessToken,
    discoveredRoom,
    'io.mindroom.server',
    agent.userId,
    {
      api_origin: MINDROOM_API,
      computer: false,
      role: 'Sorts weekly planning notes',
    }
  );
  const discoveredRoot = await sendRoomMessage(HOMESERVER, founder.accessToken, discoveredRoom, {
    msgtype: 'm.text',
    body: 'Can you sort the weekly planning notes?',
  });
  await sendRoomMessage(HOMESERVER, agent.accessToken, discoveredRoom, {
    msgtype: 'm.text',
    body: 'Notes are grouped by project.',
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: discoveredRoot,
      is_falling_back: true,
      'm.in_reply_to': { event_id: discoveredRoot },
    },
  });

  await serveMindroom(context, member, '');
  await loginWithPassword(page, { homeserver: HOMESERVER, ...member });
  await page.goto(
    `/home/${encodeURIComponent(discoveredRoom)}?threadId=${encodeURIComponent(discoveredRoot)}`
  );
  await expect(page.getByText('Notes are grouped by project.')).toBeVisible({ timeout: 60_000 });
  await agentAvatar(page).click();
  const card = page.getByRole('dialog', { name: 'Helper', exact: true });
  await expect(card.getByText('Example Model', { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(card.getByText('Sorts weekly planning notes', { exact: true })).toBeVisible();
  await expect(card.getByText('Configured tools', { exact: true })).toBeVisible();
  await expect(card.getByText('File Tools', { exact: true })).toBeVisible();
  await expect(card.getByText('Web Search', { exact: true })).toBeVisible();
  if (SHOTS) {
    await page.mouse.move(0, 0);
    await page.waitForFunction(
      () => !document.getAnimations().some((animation) => animation instanceof CSSTransition)
    );
    await card.screenshot({ path: `${SHOTS}/discovered-card.png` });
  }
});
