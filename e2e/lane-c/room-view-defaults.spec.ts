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

  test('a room of people opens in Threads and a room with an agent as Compact cards', async ({
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
    if (SCREENSHOT) await page.screenshot({ path: `${SCREENSHOT}/V1-people-room-threads.png` });
    await testInfo.attach('people room', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // The switch goes to Compact and back to Threads.
    await viewSwitch.click();
    await expect(page.locator('[data-compact-room-view]')).toBeVisible();
    await expect(viewSwitch).toHaveAttribute('aria-pressed', 'true');
    await viewSwitch.click();
    await expect(page.locator('[data-compact-room-view]')).toHaveCount(0);
    await expect(viewSwitch).toHaveAttribute('aria-pressed', 'false');
    await expect(rows.filter({ hasText: laterRoot })).toHaveCount(1);
    await expect(rows.filter({ hasText: threadReply })).toHaveCount(0);

    // The room with an agent opens as Compact cards with the full filter bar.
    await openRoom(page, agentRoomId);
    await expect(page.locator('[data-compact-room-view]')).toBeVisible({ timeout: 60_000 });
    await expect(viewSwitch).toHaveAttribute('aria-pressed', 'true');
    const overview = page.locator('[data-room-thread-overview]');
    const filterToggles = overview.locator('[data-filter-state]');
    await expect(filterToggles.first()).toBeVisible();
    const modeSwitch = overview.locator('[data-thread-filter-mode-switch]');
    await expect(modeSwitch).toHaveAttribute('aria-pressed', 'false');
    await expect(overview.locator('[data-simple-unresolved-toggle]')).toHaveCount(0);
    if (SCREENSHOT) {
      await page.screenshot({ path: `${SCREENSHOT}/V2-agent-room-full-filters.png` });
    }
    await testInfo.attach('full filters', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // The filter-mode switch shows the simple bar, which a reload keeps.
    await modeSwitch.click();
    const unresolved = overview.locator('[data-simple-unresolved-toggle]');
    await expect(modeSwitch).toHaveAttribute('aria-pressed', 'true');
    await expect(filterToggles).toHaveCount(0);
    await expect(overview.locator('[data-thread-count]')).toBeVisible();
    await expect(unresolved).toBeVisible();
    // A loaded machine can take a while to show the room again after a reload.
    await page.reload();
    await expect(page.locator('[data-compact-room-view]')).toBeVisible({ timeout: 120_000 });
    await expect(modeSwitch).toHaveAttribute('aria-pressed', 'true');
    await expect(filterToggles).toHaveCount(0);
    await expect(overview.locator('[data-thread-count]')).toBeVisible();
    await expect(unresolved).toHaveAttribute('aria-pressed', 'false');
    if (SCREENSHOT) {
      await page.screenshot({ path: `${SCREENSHOT}/V3-agent-room-simple-filters.png` });
    }
    await testInfo.attach('simple filters', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });

    // Unresolved toggles.
    await unresolved.click();
    await expect(unresolved).toHaveAttribute('aria-pressed', 'true');
    await unresolved.click();
    await expect(unresolved).toHaveAttribute('aria-pressed', 'false');

    // Switching back restores the full bar.
    await modeSwitch.click();
    await expect(modeSwitch).toHaveAttribute('aria-pressed', 'false');
    await expect(filterToggles.first()).toBeVisible();
    await expect(unresolved).toHaveCount(0);
  });
});
