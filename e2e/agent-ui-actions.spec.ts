import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendRoomMessage } from './helpers/matrix';

// Explicit opt-in to an isolated, disposable local Matrix server with open registration.
const homeserver = process.env.E2E_UI_ACTIONS_HOMESERVER;
const computerApi = 'http://127.0.0.1:28179';
test.use({ video: 'off' });

test('agent requests open the active conversation and leave passive history buttons', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  const origin = new URL(homeserver!);
  expect(origin.protocol).toBe('http:');
  expect(['127.0.0.1', 'localhost', '[::1]']).toContain(origin.hostname);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `ui_viewer_${suffix}`;
  const viewer = await register(username);
  const agent = await register(`mindroom_ui_${suffix}`);
  const otherAgent = await register(`mindroom_other_${suffix}`);
  const fixture = await createThreadFixture(homeserver!, viewer.access_token, {
    name: 'Agent UI requests',
    topic: 'Local UI action regression',
    rootBody: 'Show the browser while working',
    replyBody: 'The active conversation',
    invite: [agent.user_id, otherAgent.user_id],
  });
  await joinRoom(homeserver!, agent.access_token, fixture.roomId);
  await joinRoom(homeserver!, otherAgent.access_token, fixture.roomId);
  const otherRoot = await sendRoomMessage(homeserver!, viewer.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Another conversation',
  });
  await sendRoomMessage(homeserver!, viewer.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Another conversation reply',
    'm.relates_to': { rel_type: 'm.thread', event_id: otherRoot },
  });
  const sendAction = (
    threadId: string,
    action: Record<string, string>,
    body: string,
    sender = agent
  ) =>
    sendRoomMessage(homeserver!, sender.access_token, fixture.roomId, {
      msgtype: 'm.notice',
      body,
      'm.relates_to': { rel_type: 'm.thread', event_id: threadId },
      'io.mindroom.ui_action': {
        version: 1,
        requester_id: viewer.user_id,
        agent_user_id: sender.user_id,
        room_id: fixture.roomId,
        thread_id: threadId,
        ...action,
      },
    });
  const sessions: Record<string, unknown>[] = [];
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await context.route(`${computerApi}/**`, (route) => {
    if (route.request().method() === 'POST') sessions.push(route.request().postDataJSON());
    // Exercise real authenticated viewer creation without depending on a running worker/VNC.
    return route.fulfill({ status: 503, json: { detail: 'Local fixture computer unavailable' } });
  });
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [homeserver],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
        auth: { allowRegistration: false, disablePasswordLogin: false },
        mindroom: { ...config.mindroom, computers: { apiUrl: computerApi } },
      },
    });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await loginWithPassword(page, { homeserver: homeserver!, username, password });
  const threadPath = (id: string) =>
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(id)}`;
  await page.goto(threadPath(fixture.rootId));
  await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();
  await page.bringToFront();
  await expect.poll(() => page.evaluate(() => document.hasFocus())).toBe(true);
  const panel = page.getByRole('complementary', { name: 'Computer panel' });
  await sendAction(fixture.rootId, { action: 'show_computer' }, 'Watch my computer');
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Local fixture computer unavailable')).toBeVisible();
  expect(sessions).toHaveLength(1);
  expect(sessions[0]).toMatchObject({ agent_user_id: agent.user_id, room_id: fixture.roomId });
  expect(sessions[0].openid_token).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('desktop-agent-computer.png') });
  await panel.getByRole('button', { name: 'Close computer', exact: true }).click();
  await expect(panel).toHaveCount(0);

  // A request in a different thread cannot steal this conversation's UI.
  await sendAction(otherRoot, { action: 'show_computer' }, 'Watch the other conversation');
  await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Sync reached the passive request',
    'm.relates_to': { rel_type: 'm.thread', event_id: fixture.rootId },
  });
  await expect(page.getByText('Sync reached the passive request', { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);
  await page.goto(threadPath(otherRoot));
  const viewComputer = page.getByRole('button', { name: 'View computer', exact: true });
  await expect(viewComputer).toBeVisible();
  await expect(panel).toHaveCount(0);
  await viewComputer.click();
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Local fixture computer unavailable')).toBeVisible();
  await panel.getByRole('button', { name: 'Close computer', exact: true }).click();
  await page.reload();
  await expect(viewComputer).toBeVisible();
  await expect(panel).toHaveCount(0);
  expect(sessions).toHaveLength(2);

  await sendAction(otherRoot, { action: 'open_settings', section: 'about' }, 'Open About settings');
  await expect(page.getByRole('heading', { name: 'About', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('heading', { name: 'About', exact: true })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await sendAction(otherRoot, { action: 'open_panel', panel: 'members' }, 'Show Members');
  const members = page.getByRole('dialog', { name: 'Members', exact: true });
  await expect(members).toBeVisible();
  await members.getByRole('button', { name: 'Close', exact: true }).click();
  await sendAction(otherRoot, { action: 'show_computer' }, 'Watch on mobile', otherAgent);
  await expect(panel).toBeVisible();
  await expect(panel.getByText('Local fixture computer unavailable')).toBeVisible();
  expect(sessions).toHaveLength(3);
  expect(sessions[2]).toMatchObject({ agent_user_id: otherAgent.user_id });
  const bounds = await panel.boundingBox();
  expect(bounds).toMatchObject({ x: 0, y: 0, width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('mobile-agent-computer.png') });
  expect(pageErrors).toEqual([]);
});
