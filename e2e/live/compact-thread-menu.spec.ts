import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

test('compact thread actions update tags, summaries and status without opening the thread', async ({
  page,
}, testInfo) => {
  test.skip(
    !hasPrimaryCredentials() || !process.env.E2E_AGENT_USERNAME || !process.env.E2E_AGENT_PASSWORD,
    'Local Matrix accounts required'
  );
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const owner = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const agent = await loginToMatrix(
    homeserver,
    process.env.E2E_AGENT_USERNAME!,
    process.env.E2E_AGENT_PASSWORD!
  );
  const roomId = await createPrivateRoom(homeserver, owner.accessToken, {
    name: `Thread menu ${Date.now()}`,
    topic: 'Compact thread action regression',
    invite: [agent.userId],
  });
  await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/join`, {
    method: 'POST',
    accessToken: agent.accessToken,
    body: '{}',
  });
  const rootId = await sendRoomMessage(homeserver, owner.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'A thread to organize',
  });
  await loginWithPassword(page, { homeserver, ...credentials });
  await expectLoggedInShellStable(page);
  await seedRoomOverviewState({
    page,
    roomId,
    userId: owner.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const overviewUrl = page.url();
  const card = page.locator(`[data-thread-root-id="${rootId}"]`);
  await expect(card).toBeVisible();
  const openMenu = async () => {
    await card.click({ button: 'right' });
    await expect(page.getByRole('menu', { name: 'Thread options' })).toBeVisible();
    expect(page.url()).toBe(overviewUrl);
  };
  await openMenu();
  await page.screenshot({ path: testInfo.outputPath('thread-context-menu.png') });
  await page.getByRole('menuitem', { name: 'Edit tags', exact: true }).click();
  const tags = page.getByRole('dialog', { name: 'Edit tags', exact: true });
  await expect(tags).toBeVisible();
  await tags.getByRole('button', { name: 'Add tag', exact: true }).click();
  await page.getByRole('textbox', { name: 'Filter or create tag' }).fill('urgent');
  await page.getByRole('textbox', { name: 'Filter or create tag' }).press('Enter');
  await expect(tags.getByRole('button', { name: 'Remove urgent tag' })).toBeVisible();
  await tags.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(card).toContainText('urgent');

  await openMenu();
  await page.getByRole('menuitem', { name: 'Edit summary', exact: true }).click();
  const edit = page.getByRole('dialog', { name: 'Edit summary', exact: true });
  await edit
    .getByRole('textbox', { name: 'Summary', exact: true })
    .fill('Manually revised thread summary');
  await edit.getByRole('button', { name: 'Save summary', exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(card).toContainText('Manually revised thread summary');
  expect(page.url()).toBe(overviewUrl);
  await page.reload();
  await expect(card).toContainText('Manually revised thread summary');
  await card.click();
  await expect(page.locator('[data-thread-context-summary]')).toHaveText(
    'Manually revised thread summary'
  );
  await page.goto(overviewUrl);

  await openMenu();
  await page.getByRole('menuitem', { name: 'Regenerate summary', exact: true }).click();
  const regenerate = page.getByRole('dialog', { name: 'Regenerate summary', exact: true });
  await regenerate.getByRole('combobox', { name: 'Agent', exact: true }).selectOption(agent.userId);
  const request = page.waitForRequest(
    (req) =>
      req.method() === 'PUT' &&
      req.url().includes('/send/m.room.message/') &&
      req.postDataJSON()?.body?.includes('set_thread_summary')
  );
  await regenerate.getByRole('button', { name: 'Send request', exact: true }).click();
  const content = (await request).postDataJSON();
  expect(content['m.mentions']).toEqual({ user_ids: [agent.userId] });
  expect(content['m.relates_to']).toMatchObject({ rel_type: 'm.thread', event_id: rootId });
  await expect(regenerate.getByRole('status')).toContainText('Request sent');
  await regenerate.getByRole('button', { name: 'Done', exact: true }).click();
  await sendRoomMessage(homeserver, agent.accessToken, roomId, {
    msgtype: 'm.notice',
    body: 'Fresh agent summary',
    'io.mindroom.thread_summary': {
      version: 1,
      summary: 'Fresh agent summary',
      generated_at: new Date().toISOString(),
    },
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  await expect(card).toContainText('Fresh agent summary');
  await card.click();
  await expect(page.locator('[data-thread-context-summary]')).toHaveText('Fresh agent summary');
  await page.goto(overviewUrl);

  await openMenu();
  await page.getByRole('menuitem', { name: 'Resolve', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Reopen thread', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Reopen thread', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Resolve', exact: true })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Pin thread', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Unpin thread', exact: true })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Resolve', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await card.focus();
  await page.keyboard.press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Thread options' })).toBeVisible();
  await page.keyboard.press('Escape');
  expect(page.url()).toBe(overviewUrl);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await card.locator('..').getByRole('button', { name: 'Thread options', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu', { name: 'Thread options' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('thread-context-menu-narrow.png') });
  await page.getByRole('menuitem', { name: 'Unpin thread', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Pin thread', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await card.click();
  await expect(page.locator('[data-thread-context-summary]')).toHaveText('Fresh agent summary');
});
