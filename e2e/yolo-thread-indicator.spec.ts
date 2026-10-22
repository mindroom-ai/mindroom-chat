import { randomUUID } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';
import { loginWithPassword } from './helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendStateEvent } from './helpers/matrix';

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

// The header names the end in the default 12-hour clock, with the day when it is not today.
const clock = (timestamp: number) =>
  new Date(timestamp).toLocaleString('en', {
    weekday: new Date(timestamp).toDateString() === new Date().toDateString() ? undefined : 'short',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

test('the thread header says whose YOLO window is open there, until when', async ({
  page,
  context,
  browser,
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

  await routeConfig(context);
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

  // On a phone, the viewer's window, a colleague's, and an active permission share the header: each takes its
  // own line rather than hiding another, none runs under the thread actions, and the viewer's end time is shown in
  // full; a long name may end in an ellipsis, with the whole text in its title.
  const grantEnd = new Date(Date.now() + 10 * 60_000).toISOString();
  await matrixFetch(
    homeserver!,
    `/rooms/${encodeURIComponent(fixture.roomId)}/send/io.mindroom.tool_approval/grant-${suffix}`,
    {
      method: 'PUT',
      accessToken: router.access_token,
      body: JSON.stringify({
        msgtype: 'io.mindroom.tool_approval',
        body: 'Approved: save_note',
        approval_id: `grant-${suffix}`,
        tool_name: 'save_note',
        agent_name: 'assistant',
        status: 'approved',
        approvable: true,
        approver_user_id: viewer.user_id,
        requester_id: viewer.user_id,
        arguments: { title: 'Release notes' },
        requested_at: new Date().toISOString(),
        expires_at: grantEnd,
        resolved_at: new Date().toISOString(),
        resolved_by: viewer.user_id,
        auto_approval: { grant_id: `grant-${suffix}`, expires_at: grantEnd, revoked_at: null },
        thread_id: fixture.rootId,
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: fixture.rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: fixture.rootId },
        },
      }),
    }
  );
  const permissions = banner.getByRole('button', { name: '1 active permission', exact: true });
  const options = banner.getByRole('button', { name: 'Thread options', exact: true });
  const show = banner.getByRole('button', { name: 'Show thread details', exact: true });
  const fullText = (chip: typeof own) =>
    chip.evaluate((node) => node.scrollWidth <= node.clientWidth);
  const leftOf = async (chip: typeof own, control: typeof own) => {
    const [chipBox, controlBox] = [await chip.boundingBox(), await control.boundingBox()];
    return !!chipBox && !!controlBox && chipBox.x + chipBox.width <= controlBox.x;
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(permissions).toBeVisible();
  // The repeated "Thread View" label gives way to the status chips.
  await expect(banner.getByText('Thread View', { exact: true })).toBeHidden();
  for (const chip of [own, theirs, permissions]) {
    await expect(chip).toBeVisible();
    expect(await leftOf(chip, options)).toBe(true);
  }
  expect(await fullText(own)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('phone-dark.png') });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: testInfo.outputPath('phone-light.png') });

  // Collapsed, the chips stay between Back and Show details, which stays on screen.
  await options.click();
  await page.getByRole('menuitem', { name: 'Hide thread details' }).click();
  await expect(show).toBeInViewport();
  for (const chip of [own, theirs, permissions]) {
    await expect(chip).toBeVisible();
    expect(await leftOf(chip, show)).toBe(true);
  }
  expect(await fullText(own)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('phone-collapsed-light.png') });

  // On the narrowest phones, neither layout pushes a control off screen or under a chip.
  await page.setViewportSize({ width: 320, height: 640 });
  await expect(show).toBeInViewport();
  for (const chip of [own, theirs, permissions]) expect(await leftOf(chip, show)).toBe(true);
  await show.click();
  await expect(options).toBeInViewport();
  for (const chip of [own, theirs, permissions]) expect(await leftOf(chip, options)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('phone-narrow-light.png') });
  await page.setViewportSize({ width: 390, height: 844 });

  // MindRoom usually titles a thread with a summary.
  const summarize = (summary: string) =>
    matrixFetch(
      homeserver!,
      `/rooms/${encodeURIComponent(fixture.roomId)}/send/m.room.message/${randomUUID()}`,
      {
        method: 'PUT',
        accessToken: router.access_token,
        body: JSON.stringify({
          msgtype: 'm.notice',
          body: summary,
          'io.mindroom.thread_summary': {
            version: 1,
            summary,
            generated_at: new Date().toISOString(),
            message_count: 2,
          },
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: fixture.rootId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: fixture.rootId },
          },
        }),
      }
    );

  // A phone held sideways puts the chips beside the title and moves the title below them when too little room is
  // left, so neither is squeezed and the chips stay clear of the thread actions.
  await summarize('Release notes drafted and the build tag prepared for review');
  const sideways = await browser.newContext({
    viewport: { width: 667, height: 375 },
    hasTouch: true,
  });
  await routeConfig(sideways);
  const landscape = await sideways.newPage();
  await loginWithPassword(landscape, { homeserver: homeserver!, username, password });
  await landscape.goto(
    `/home/${encodeURIComponent(fixture.roomId)}?threadId=${encodeURIComponent(fixture.rootId)}`
  );
  const sidewaysBanner = landscape.locator('[data-thread-context-banner="true"]');
  const sidewaysTitle = sidewaysBanner.getByText('Release notes drafted', { exact: false });
  await expect(sidewaysTitle).toBeVisible();
  const sidewaysOptions = sidewaysBanner.getByRole('button', {
    name: 'Thread options',
    exact: true,
  });
  const sidewaysOwn = sidewaysBanner.getByText(`YOLO until ${clock(ownEnd)}`, { exact: true });
  const sidewaysChips = [
    sidewaysOwn,
    sidewaysBanner.getByText(`YOLO for Robin until ${clock(colleagueEnd)}`, { exact: true }),
    sidewaysBanner.getByRole('button', { name: '1 active permission', exact: true }),
  ];
  // The two wider ones also show the room list and members, which leave 844 too little room for the viewer's end time.
  for (const [width, height, ownInFull] of [
    [667, 375, true],
    [844, 390, false],
    [932, 430, true],
  ] as const) {
    await landscape.setViewportSize({ width, height });
    await expect(sidewaysOptions).toBeInViewport();
    for (const chip of sidewaysChips) {
      await expect(chip).toBeVisible();
      expect(await leftOf(chip, sidewaysOptions)).toBe(true);
    }
    if (ownInFull) expect(await fullText(sidewaysOwn)).toBe(true);
    expect((await sidewaysTitle.boundingBox())?.width ?? 0).toBeGreaterThan(80);
    await landscape.screenshot({ path: testInfo.outputPath(`phone-landscape-${width}-light.png`) });
  }
  // A short title that fits beside the remaining chip stays on its line.
  await publish([]);
  await summarize('Ship it');
  const shortTitle = sidewaysBanner.getByText('Ship it', { exact: true });
  await expect(shortTitle).toBeVisible();
  await expect(sidewaysBanner.getByText(/^YOLO/)).toHaveCount(0);
  const middle = async (locator: typeof shortTitle) => {
    const box = await locator.boundingBox();
    return box ? box.y + box.height / 2 : Number.NaN;
  };
  expect(Math.abs((await middle(shortTitle)) - (await middle(sidewaysChips[2])))).toBeLessThan(4);
  await sideways.close();

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
