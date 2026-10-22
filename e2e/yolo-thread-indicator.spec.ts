import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendStateEvent } from './helpers/matrix';

// Explicit opt-in to an isolated, disposable local Matrix server with open registration.
const homeserver = process.env.E2E_UI_ACTIONS_HOMESERVER;
test.use({ video: 'off' });

const clock = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' });

test('the thread header says whose YOLO window is open there, until when', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!homeserver, 'Set E2E_UI_ACTIONS_HOMESERVER to a disposable local Matrix server.');
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(homeserver!, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `yolo_viewer_${suffix}`;
  const viewer = await register(username);
  const colleague = await register(`yolo_colleague_${suffix}`);
  const router = await register(`mindroom_router_${suffix}`);
  await matrixFetch(homeserver!, `/profile/${encodeURIComponent(colleague.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: colleague.access_token,
    body: JSON.stringify({ displayname: 'Robin' }),
  });
  const fixture = await createThreadFixture(homeserver!, viewer.access_token, {
    name: 'Release prep',
    topic: 'YOLO indicator',
    rootBody: 'Write the release notes and tag the build',
    replyBody: 'On it',
    invite: [router.user_id, colleague.user_id],
  });
  await joinRoom(homeserver!, router.access_token, fixture.roomId);
  await joinRoom(homeserver!, colleague.access_token, fixture.roomId);
  // MindRoom's router creates its rooms and so may write this state; here the viewer created the room.
  const powerLevelsPath = `/rooms/${encodeURIComponent(fixture.roomId)}/state/m.room.power_levels`;
  const powerLevels = await matrixFetch<Record<string, unknown>>(homeserver!, powerLevelsPath, {
    accessToken: viewer.access_token,
  });
  await sendStateEvent(
    homeserver!,
    viewer.access_token,
    fixture.roomId,
    'm.room.power_levels',
    '',
    {
      ...powerLevels,
      events: { ...(powerLevels.events as Record<string, number>), 'io.mindroom.yolo': 0 },
    }
  );
  const publish = (
    windows: { threadId: string | null; requesterId: string; expiresAt: number }[]
  ) =>
    sendStateEvent(
      homeserver!,
      router.access_token,
      fixture.roomId,
      'io.mindroom.yolo',
      router.user_id,
      {
        windows: windows.map(({ threadId, requesterId, expiresAt }) => ({
          thread_id: threadId,
          requester_id: requesterId,
          expires_at: new Date(expiresAt).toISOString(),
        })),
      }
    );
  const ownEnd = Date.now() + 30 * 60_000;
  const colleagueEnd = Date.now() + 2 * 60 * 60_000;
  await publish([
    { threadId: fixture.rootId, requesterId: viewer.user_id, expiresAt: ownEnd },
    { threadId: fixture.rootId, requesterId: colleague.user_id, expiresAt: colleagueEnd },
    { threadId: '$another-thread', requesterId: viewer.user_id, expiresAt: ownEnd },
  ]);

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
      },
    });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, { homeserver: homeserver!, username, password });
  await page.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  await expect(page.getByText(fixture.replyBody, { exact: true })).toBeVisible();

  // The viewer's own window and a colleague's, each with when it ends; another thread's is not here.
  const banner = page.locator('[data-thread-context-banner="true"]');
  const own = banner.getByText(`YOLO until ${clock(ownEnd)}`, { exact: true });
  const theirs = banner.getByText(`YOLO for Robin until ${clock(colleagueEnd)}`, { exact: true });
  await expect(own).toBeVisible();
  await expect(theirs).toBeVisible();
  await expect(banner.getByText(/^YOLO/)).toHaveCount(2);
  await expect(own).toHaveAttribute('title', /Send !yolo off to end it/);
  await expect(page.getByText(/^Catching up/)).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('desktop-light.png') });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: testInfo.outputPath('desktop-dark.png') });

  // On a phone, the chip stays in the header in light and dark.
  await publish([{ threadId: fixture.rootId, requesterId: viewer.user_id, expiresAt: ownEnd }]);
  await expect(banner.getByText(/^YOLO/)).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(own).toBeVisible();
  // The repeated "Thread View" label gives way, so the end time is not cut short.
  await expect(banner.getByText('Thread View', { exact: true })).toBeHidden();
  expect(await own.evaluate((chip) => chip.scrollWidth <= chip.clientWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('phone-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: testInfo.outputPath('phone-light.png') });

  // A window that ends goes away on its own, and `!yolo off` clears the state.
  const shortEnd = Date.now() + 5_000;
  await publish([{ threadId: fixture.rootId, requesterId: viewer.user_id, expiresAt: shortEnd }]);
  await expect(banner.getByText(`YOLO until ${clock(shortEnd)}`, { exact: true })).toBeVisible();
  await expect(banner.getByText(/^YOLO/)).toHaveCount(0, { timeout: 15_000 });
  await publish([{ threadId: fixture.rootId, requesterId: viewer.user_id, expiresAt: ownEnd }]);
  await expect(own).toBeVisible();
  await publish([]);
  await expect(banner.getByText(/^YOLO/)).toHaveCount(0);
});
