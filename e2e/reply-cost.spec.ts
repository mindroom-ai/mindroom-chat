import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendRoomMessage } from './helpers/matrix';

// Explicit opt-in to an isolated, disposable local Matrix server with open registration.
const homeserver = process.env.E2E_UI_ACTIONS_HOMESERVER;
test.use({ video: 'off' });

// Point the app at the disposable homeserver.
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
        auth: { allowRegistration: false, disablePasswordLogin: false },
      },
    });
  });

const aiRun = (usd: string) => ({
  version: 1,
  status: 'completed',
  model: { config: 'luna', display_name: 'Luna', id: 'gpt-6-luna', provider: 'openai' },
  usage: { input_tokens: 1674, output_tokens: 31, total_tokens: 1705, cache_read_tokens: 1408 },
  cost: { usd },
});

test('replies show their cost, and the thread its running total', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  // Several window sizes and color schemes.
  test.slow();
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `cost_viewer_${suffix}`;
  const viewer = await register(username);
  const agent = await register(`mindroom_code_${suffix}`);
  await matrixFetch(homeserver!, `/profile/${encodeURIComponent(agent.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: agent.access_token,
    body: JSON.stringify({ displayname: 'Code' }),
  });
  const fixture = await createThreadFixture(homeserver!, viewer.access_token, {
    name: 'Cost check',
    topic: 'Reply costs',
    rootBody: 'Plan the release',
    replyBody: 'Keep it short',
    invite: [agent.user_id],
  });
  await joinRoom(homeserver!, agent.access_token, fixture.roomId);
  const inThread = {
    rel_type: 'm.thread',
    event_id: fixture.rootId,
    is_falling_back: true,
    'm.in_reply_to': { event_id: fixture.rootId },
  };
  await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Cut the branch first.',
    'io.mindroom.ai_run': aiRun('0.0123'),
    'm.relates_to': inThread,
  });
  await sendRoomMessage(homeserver!, viewer.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'And then?',
    'm.relates_to': inThread,
  });
  // A streamed reply starts without metadata; its final edit carries the cost.
  const streamed = await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Thinking...',
    'io.mindroom.stream_status': 'streaming',
    'm.relates_to': inThread,
  });
  await sendRoomMessage(homeserver!, agent.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: '* Then tag it.',
    'm.new_content': {
      msgtype: 'm.text',
      body: 'Then tag it.',
      'io.mindroom.stream_status': 'completed',
      'io.mindroom.ai_run': aiRun('0.0051'),
    },
    'm.relates_to': { rel_type: 'm.replace', event_id: streamed },
  });
  // Anyone can write the same keys; only MindRoom's own accounts count.
  await sendRoomMessage(homeserver!, viewer.access_token, fixture.roomId, {
    msgtype: 'm.text',
    body: 'Sounds good',
    'io.mindroom.ai_run': aiRun('100'),
    'm.relates_to': inThread,
  });

  await routeConfig(context);
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, { homeserver: homeserver!, username, password });
  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  await expect(page.getByText('Then tag it.', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Catching up/)).toHaveCount(0);

  const first = page.getByRole('button', {
    name: 'This reply: $0.012 · Conversation so far: $0.012 across 1 reply',
    exact: true,
  });
  const second = page.getByRole('button', {
    name: 'This reply: $0.0051 · Conversation so far: $0.017 across 2 replies',
    exact: true,
  });
  await expect(first).toHaveText('$0.012');
  await expect(second).toHaveText('$0.0051');
  const banner = page.locator('[data-thread-context-banner="true"]');
  const total = banner.getByRole('note', {
    name: 'Conversation cost: $0.017 across 2 replies',
    exact: true,
  });
  await expect(total).toHaveText('$0.017');
  // The viewer's own message wrote the keys too, but shows no cost.
  await expect(page.getByRole('button', { name: /^This reply: \$100/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('desktop-light.png') });

  await second.click();
  const cost = page.getByText('Cost: $0.0051', { exact: true });
  await expect(cost).toBeVisible();
  await expect(
    page.getByText('Conversation so far: $0.017 across 2 replies', { exact: true })
  ).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('desktop-dialog-light.png') });
  await page.keyboard.press('Escape');
  await expect(cost).toHaveCount(0);
  await second.blur();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('desktop-dark.png') });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(total).toBeVisible();
  await expect(second).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('phone-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: testInfo.outputPath('phone-light.png') });
});
