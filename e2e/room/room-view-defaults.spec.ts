import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  loginToMatrix,
  matrixFetch,
  registerAgentAccount,
  sendRoomMessage,
} from '../helpers/matrix';

const SCREENSHOT = process.env.E2E_SCREENSHOT_DIR;

const threadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

const openRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
};

/** The text of every room timeline row, in the order the rows stand in the document. */
const timelineRowTexts = (page: Page) =>
  page.locator('[data-message-item]').evaluateAll((rows) => rows.map((row) => row.textContent));

test.describe('room view defaults', () => {
  test.skip(!hasPrimaryCredentials(), 'Requires a Matrix test account');

  test('a room of people opens in Threads and a room with an agent as Compact cards with simple filters', async ({
    page,
  }, testInfo) => {
    // Two rooms, two room loads and a reload on a loaded machine.
    test.setTimeout(360_000);
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const { accessToken } = await loginToMatrix(
      homeserver,
      credentials.username,
      credentials.password
    );
    const stamp = Date.now();

    // A room of people: a root, a reply in its thread, then a later root.
    const peopleRoomId = await createPrivateRoom(homeserver, accessToken, {
      name: `People room ${stamp}`,
      topic: 'A room without agents',
    });
    const firstRoot = `First root ${stamp}`;
    const threadReply = `Reply inside the thread ${stamp}`;
    const laterRoot = `Later root ${stamp}`;
    const firstRootId = await sendRoomMessage(homeserver, accessToken, peopleRoomId, {
      msgtype: 'm.text',
      body: firstRoot,
    });
    await sendRoomMessage(homeserver, accessToken, peopleRoomId, {
      msgtype: 'm.text',
      body: threadReply,
      'm.relates_to': threadRelation(firstRootId),
    });
    await sendRoomMessage(homeserver, accessToken, peopleRoomId, {
      msgtype: 'm.text',
      body: laterRoot,
    });

    // A room with an agent and one thread it answered.
    const agentRoomId = await createPrivateRoom(homeserver, accessToken, {
      name: `Agent room ${stamp}`,
      topic: 'A room with an agent',
    });
    const agent = await registerAgentAccount(homeserver, 'helper');
    await matrixFetch(homeserver, `/rooms/${encodeURIComponent(agentRoomId)}/invite`, {
      method: 'POST',
      accessToken,
      body: JSON.stringify({ user_id: agent.userId }),
    });
    await joinRoom(homeserver, agent.accessToken, agentRoomId);
    const agentRootId = await sendRoomMessage(homeserver, accessToken, agentRoomId, {
      msgtype: 'm.text',
      body: `Please check the logs ${stamp}`,
    });
    await sendRoomMessage(homeserver, agent.accessToken, agentRoomId, {
      msgtype: 'm.text',
      body: 'The logs look fine.',
      'm.relates_to': threadRelation(agentRootId),
    });

    await loginWithPassword(page, { homeserver, ...credentials });

    // The room of people opens in Threads: its roots in the order sent, the reply in its thread.
    await openRoom(page, peopleRoomId);
    const rows = page.locator('[data-message-item]');
    await expect(rows.filter({ hasText: laterRoot })).toHaveCount(1, { timeout: 60_000 });
    await expect(rows.filter({ hasText: firstRoot })).toHaveCount(1);
    await expect(rows.filter({ hasText: threadReply })).toHaveCount(0);
    const texts = await timelineRowTexts(page);
    const firstIndex = texts.findIndex((text) => text?.includes(firstRoot));
    const laterIndex = texts.findIndex((text) => text?.includes(laterRoot));
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(laterIndex).toBeGreaterThan(firstIndex);
    await expect(page.locator('[data-compact-room-view]')).toHaveCount(0);
    await expect(page.locator('[data-room-thread-overview]')).toHaveCount(0);
    const viewSwitch = page.locator('[data-room-view-switch]');
    await expect(viewSwitch).toHaveAttribute('aria-pressed', 'false');
    // Threads without agents has no filter bar, so the header offers no filter button.
    const filterButton = page.locator('[data-thread-filter-bar-toggle]');
    await expect(filterButton).toHaveCount(0);
    if (SCREENSHOT) await page.screenshot({ path: `${SCREENSHOT}/V1-people-room-threads.png` });
    await testInfo.attach('people room', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // The switch goes to Compact (with its filter bar and button) and back to Threads.
    await viewSwitch.click();
    await expect(page.locator('[data-compact-room-view]')).toBeVisible();
    await expect(viewSwitch).toHaveAttribute('aria-pressed', 'true');
    await expect(filterButton).toHaveAttribute('aria-pressed', 'true');
    await viewSwitch.click();
    await expect(page.locator('[data-compact-room-view]')).toHaveCount(0);
    await expect(viewSwitch).toHaveAttribute('aria-pressed', 'false');
    await expect(filterButton).toHaveCount(0);
    await expect(rows.filter({ hasText: laterRoot })).toHaveCount(1);
    await expect(rows.filter({ hasText: threadReply })).toHaveCount(0);

    // The room with an agent opens as Compact cards with the simple filter bar.
    await openRoom(page, agentRoomId);
    const compactView = page.locator('[data-compact-room-view]');
    await expect(compactView).toBeVisible({ timeout: 60_000 });
    await expect(viewSwitch).toHaveAttribute('aria-pressed', 'true');
    const overview = page.locator('[data-room-thread-overview]');
    const filterToggles = overview.locator('[data-filter-state]');
    const unresolved = overview.locator('[data-simple-unresolved-toggle]');
    const modeSwitch = overview.locator('[data-thread-filter-mode-switch]');
    await expect(unresolved).toBeVisible();
    // Compact opens with resolved threads hidden.
    await expect(unresolved).toHaveAttribute('aria-pressed', 'true');
    await expect(overview.locator('[data-thread-count]')).toBeVisible();
    await expect(filterToggles).toHaveCount(0);
    await expect(modeSwitch).toHaveAttribute('aria-pressed', 'false');
    await expect(modeSwitch).toHaveAccessibleName('Advanced filters');
    const simpleSwitchColor = await modeSwitch.evaluate(
      (element) => getComputedStyle(element).backgroundColor
    );
    if (SCREENSHOT) {
      await page.screenshot({ path: `${SCREENSHOT}/V3-agent-room-simple-filters.png` });
      await page.screenshot({ path: `${SCREENSHOT}/V5-advanced-switch-off.png` });
    }
    await testInfo.attach('simple filters', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // The header's filter button hides and shows the bar; a reload keeps it hidden.
    await expect(filterButton).toHaveAttribute('aria-pressed', 'true');
    await expect(filterButton).toHaveAccessibleName('Thread filters');
    const hiddenFiltersDot = page.locator('[data-hidden-filters-dot]');
    await expect(hiddenFiltersDot).toHaveCount(0);
    // Hidden, the bar's default Unresolved filter still applies, and the button marks it.
    await filterButton.click();
    await expect(overview).toHaveCount(0);
    await expect(hiddenFiltersDot).toBeVisible();
    await expect(filterButton).toHaveAccessibleName('Thread filters (active)');
    await filterButton.click();
    await expect(hiddenFiltersDot).toHaveCount(0);
    // Turned off, the choice is the room's from now on.
    await unresolved.click();
    await expect(unresolved).toHaveAttribute('aria-pressed', 'false');
    const screenshotBothThemes = async (name: string) => {
      if (!SCREENSHOT) return;
      for (const colorScheme of ['light', 'dark'] as const) {
        // eslint-disable-next-line no-await-in-loop
        await page.emulateMedia({ colorScheme });
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({ path: `${SCREENSHOT}/${name}-${colorScheme}.png` });
      }
      await page.emulateMedia({ colorScheme: 'light' });
    };
    await page.mouse.move(1, 1);
    await screenshotBothThemes('V4-header-filter-shown');
    await filterButton.click();
    await expect(overview).toHaveCount(0);
    await expect(filterButton).toHaveAttribute('aria-pressed', 'false');
    await expect(hiddenFiltersDot).toHaveCount(0);
    await expect(compactView).toBeVisible();
    await page.mouse.move(1, 1);
    await screenshotBothThemes('V4-header-filter-hidden');
    await page.reload();
    await expect(compactView).toBeVisible({ timeout: 120_000 });
    await expect(filterButton).toHaveAttribute('aria-pressed', 'false');
    await expect(overview).toHaveCount(0);
    await filterButton.click();
    await expect(filterButton).toHaveAttribute('aria-pressed', 'true');
    await expect(unresolved).toHaveAttribute('aria-pressed', 'false');

    // A filter keeps applying while the bar is hidden, and the button marks it.
    await unresolved.click();
    await expect(unresolved).toHaveAttribute('aria-pressed', 'true');
    await filterButton.click();
    await expect(overview).toHaveCount(0);
    await expect(hiddenFiltersDot).toBeVisible();
    await expect(filterButton).toHaveAccessibleName('Thread filters (active)');
    await filterButton.click();
    await expect(hiddenFiltersDot).toHaveCount(0);
    await expect(filterButton).toHaveAccessibleName('Thread filters');
    await unresolved.click();
    await expect(unresolved).toHaveAttribute('aria-pressed', 'false');

    // The Advanced filters switch shows every filter, pressed and tinted, and a reload keeps it.
    await modeSwitch.click();
    await expect(modeSwitch).toHaveAttribute('aria-pressed', 'true');
    await expect(filterToggles.first()).toBeVisible();
    await expect(unresolved).toHaveCount(0);
    await page.mouse.move(1, 1);
    await expect
      .poll(() => modeSwitch.evaluate((element) => getComputedStyle(element).backgroundColor))
      .not.toBe(simpleSwitchColor);
    if (SCREENSHOT) {
      await page.screenshot({ path: `${SCREENSHOT}/V2-agent-room-full-filters.png` });
      await page.screenshot({ path: `${SCREENSHOT}/V5-advanced-switch-on.png` });
    }
    await testInfo.attach('advanced filters', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
    // A loaded machine can take a while to show the room again after a reload.
    await page.reload();
    await expect(compactView).toBeVisible({ timeout: 120_000 });
    await expect(modeSwitch).toHaveAttribute('aria-pressed', 'true');
    await expect(filterToggles.first()).toBeVisible();
    await expect(unresolved).toHaveCount(0);

    // Switching back restores the simple bar.
    await modeSwitch.click();
    await expect(modeSwitch).toHaveAttribute('aria-pressed', 'false');
    await expect(filterToggles).toHaveCount(0);
    await expect(unresolved).toBeVisible();

    // With an agent too, the view switch goes from Compact to Threads (roots with their thread
    // chips, the filter bar above them), not to Classic, which would show the reply in the room.
    await viewSwitch.click();
    await expect(viewSwitch).toHaveAttribute('aria-pressed', 'false');
    await expect(compactView).toHaveCount(0);
    await expect(rows.filter({ hasText: `Please check the logs ${stamp}` })).toHaveCount(1, {
      timeout: 60_000,
    });
    await expect(rows.filter({ hasText: 'The logs look fine.' })).toHaveCount(0);
    await expect(overview).toBeVisible();
    await expect(filterButton).toHaveAttribute('aria-pressed', 'true');
    await viewSwitch.click();
    await expect(compactView).toBeVisible();
    await expect(viewSwitch).toHaveAttribute('aria-pressed', 'true');
  });
});
