import { randomUUID } from 'node:crypto';
import { type Page, expect, test } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createThreadFixture, joinRoom, matrixFetch, sendStateEvent } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

test.use({ video: 'off' });

// The dock's line: the typing strip and the jobs bar (RoomOverlay.css `DockBars`).
const geometry = (page: Page) =>
  page.evaluate(() => {
    const bar = document.querySelector('[role="region"][aria-label$="background jobs"]');
    const line = bar?.parentElement?.parentElement;
    const strip = [...(line?.children ?? [])].find(
      (child) => child.getAttribute('role') === 'status'
    );
    const box = (element: Element | null | undefined) => {
      if (!element) return null;
      const { left, right, top, bottom } = element.getBoundingClientRect();
      return { left, right, top, bottom };
    };
    return { line: box(line), bar: box(bar), strip: box(strip) };
  });

test('listed jobs span the dock line over the typing strip, which keeps its place', async ({
  page,
  context,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
  test.setTimeout(3 * 60_000);
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const password = randomUUID();
  const register = (username: string) =>
    matrixFetch<{ access_token: string; user_id: string }>(HOMESERVER, '/register', {
      method: 'POST',
      body: JSON.stringify({ username, password, auth: { type: 'm.login.dummy' } }),
    });
  const username = `dock_viewer_${suffix}`;
  const viewer = await register(username);
  const agent = await register(`mindroom_helper_${suffix}`);
  const typer = await register(`dock_typer_${suffix}`);
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(typer.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: typer.access_token,
    body: JSON.stringify({ displayname: 'Ana' }),
  });
  const fixture = await createThreadFixture(HOMESERVER, viewer.access_token, {
    name: 'Placeholder room',
    topic: 'Placeholder topic',
    rootBody: 'Placeholder root message',
    replyBody: 'Placeholder reply',
    invite: [agent.user_id, typer.user_id],
  });
  await joinRoom(HOMESERVER, agent.access_token, fixture.roomId);
  await joinRoom(HOMESERVER, typer.access_token, fixture.roomId);
  const levelsPath = `/rooms/${encodeURIComponent(fixture.roomId)}/state/m.room.power_levels`;
  const levels = await matrixFetch<Record<string, unknown>>(HOMESERVER, levelsPath, {
    accessToken: viewer.access_token,
  });
  await sendStateEvent(HOMESERVER, viewer.access_token, fixture.roomId, 'm.room.power_levels', '', {
    ...levels,
    events: { ...(levels.events as Record<string, number>), 'io.mindroom.background_jobs': 0 },
  });
  const job = (jobId: string, tool: string) => ({
    job_id: jobId,
    thread_id: fixture.rootId,
    kind: 'tool',
    tool,
    status: 'running',
    requester_id: viewer.user_id,
    started_at: new Date(Date.now() - 30_000).toISOString(),
  });
  await sendStateEvent(
    HOMESERVER,
    agent.access_token,
    fixture.roomId,
    'io.mindroom.background_jobs',
    agent.user_id,
    { jobs: [job('job_1', 'placeholder_task_alpha'), job('job_2', 'placeholder_task_beta')] }
  );
  const setTyping = (typing: boolean) =>
    matrixFetch(
      HOMESERVER,
      `/rooms/${encodeURIComponent(fixture.roomId)}/typing/${encodeURIComponent(typer.user_id)}`,
      {
        method: 'PUT',
        accessToken: typer.access_token,
        body: JSON.stringify({ typing, timeout: 120_000 }),
      }
    );
  await context.route('**/config.json', async (route) => {
    const response = await route.fetch();
    const config = await response.json();
    await route.fulfill({
      json: {
        ...config,
        homeserverList: [HOMESERVER],
        defaultHomeserver: 0,
        allowCustomHomeservers: true,
        hashRouter: { enabled: false },
        auth: { allowRegistration: false, disablePasswordLogin: false },
      },
    });
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password });
  await page.goto(`/home/${encodeURIComponent(fixture.roomId)}`);
  const bar = page.getByRole('region', { name: '2 background jobs' });
  const title = bar.getByRole('button', { name: '2 background jobs' });
  const strip = page.getByRole('status').filter({ hasText: /is typing/ });
  const rows = bar.getByRole('listitem');
  await expect(bar).toBeVisible();

  // A phone at a small page zoom: the strip and the bar share the line.
  await page.setViewportSize({ width: 393, height: 852 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '75%';
  });
  // Listed before anyone types, then someone types: the list keeps the line, the strip its place.
  await title.click();
  await expect(rows).toHaveCount(2);
  await setTyping(true);
  await expect(strip).toBeVisible();
  // The strip rises into place.
  await strip.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished))
  );
  const typedWhileListed = await geometry(page);
  expect(typedWhileListed.bar!.left).toBeCloseTo(typedWhileListed.line!.left, 0);
  expect(typedWhileListed.bar!.right).toBeCloseTo(typedWhileListed.line!.right, 0);
  // Under the bar, on the same line: the dock gained no row.
  expect(typedWhileListed.strip!.bottom).toBeCloseTo(typedWhileListed.bar!.bottom, 0);
  await page.screenshot({ path: testInfo.outputPath('phone-typed-while-listed.png') });
  await title.click();
  await expect(rows).toHaveCount(0);
  const beside = await geometry(page);
  expect(beside.strip!.right).toBeLessThan(beside.bar!.left);

  // Listed beside the strip, then too narrow for both: the strip goes below the bar, as unlisted.
  await title.click();
  await expect(rows).toHaveCount(2);
  await page.setViewportSize({ width: 320, height: 852 });
  await expect
    .poll(async () => (await geometry(page)).strip!.top)
    .toBeGreaterThan((await geometry(page)).bar!.bottom - 1);
  const narrowListed = await geometry(page);
  await title.click();
  await expect(rows).toHaveCount(0);
  const narrow = await geometry(page);
  expect(narrow.line!.top).toBeCloseTo(narrowListed.line!.top, 0);
  expect(narrow.strip).toEqual(narrowListed.strip);

  // A desktop: the mouse rests on the title while the strip's button has the keyboard.
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.setViewportSize({ width: 1280, height: 800 });
  const drop = strip.getByRole('button');
  await drop.focus();
  await title.hover();
  await expect(rows).toHaveCount(2);
  await expect(drop).toBeFocused();
  const focused = await geometry(page);
  expect(focused.strip!.right).toBeLessThan(focused.bar!.left);
  await page.screenshot({ path: testInfo.outputPath('desktop-focused-strip.png') });
  await setTyping(false);
});
