import { expect, test, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

// Open beside: a thread card's menu keeps the open thread (A) and shows the card's thread (B) in a
// second column, a side panel of the room with its own banner, timeline and composer. On a wide
// page the room's messages stay beside A (three columns); narrower, A fills the page beside B. B
// survives a reload, Close removes it and takes the focus back to A's composer, and a phone does
// not offer it.

const column = (page: Page): Locator => page.getByTestId('thread-column');
const second = (page: Page): Locator => page.getByTestId('second-thread-panel');
const composerIn = (scope: Locator): Locator => scope.locator('[data-editable-name="RoomInput"]');
const card = (page: Page, rootId: string): Locator =>
  page.locator(`[data-thread-root-id="${rootId}"]`);

const openCardMenu = async (page: Page, rootId: string) => {
  await card(page, rootId).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Thread options' });
  await expect(menu).toBeVisible();
  return menu;
};

test('Open beside shows a second thread in its own column at each width', async ({
  page,
}, testInfo) => {
  test.skip(!hasPrimaryCredentials(), 'Local Matrix accounts required');
  test.slow();
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const owner = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const roomId = await createPrivateRoom(homeserver, owner.accessToken, {
    name: `Open beside ${Date.now()}`,
    topic: 'Example room for two threads at once',
  });
  const thread = async (body: string) => {
    const rootId = await sendRoomMessage(homeserver, owner.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    await sendRoomMessage(homeserver, owner.accessToken, roomId, {
      msgtype: 'm.text',
      body: `${body} reply`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
    return rootId;
  };
  const alpha = await thread('Example thread alpha');
  const beta = await thread('Example thread beta');

  await page.setViewportSize({ width: 1920, height: 1080 });
  await loginWithPassword(page, { homeserver, ...credentials });
  await expectLoggedInShellStable(page);
  await seedRoomOverviewState({
    page,
    roomId,
    userId: owner.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  // The thread column beside the room's messages where the page has room.
  await page.addInitScript(() =>
    window.localStorage.setItem('mindroom.threadColumn.layout', '"beside"')
  );
  await page.goto(`/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(alpha)}`);
  await expect(column(page).getByText('Example thread alpha reply')).toBeVisible({
    timeout: 30_000,
  });
  await expect(card(page, beta)).toBeVisible({ timeout: 30_000 });

  // Wide: messages | A | B.
  await (await openCardMenu(page, beta)).getByRole('menuitem', { name: 'Open beside' }).click();
  await expect(second(page).getByText('Example thread beta reply')).toBeVisible({
    timeout: 30_000,
  });
  await expect(column(page)).toBeVisible();
  await expect(column(page)).not.toHaveAttribute('data-filled', 'true');
  await expect(card(page, alpha)).toBeVisible();
  await expect(composerIn(second(page))).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('open-beside-1920.png') });

  // Typing in B goes to B.
  await page.keyboard.type('Example message beta');
  await page.keyboard.press('Enter');
  await expect(second(page).getByText('Example message beta', { exact: true })).toBeVisible({
    timeout: 30_000,
  });
  await expect(column(page).getByText('Example message beta', { exact: true })).toHaveCount(0);

  // B survives a reload.
  await page.reload();
  await expect(second(page).getByText('Example thread beta reply')).toBeVisible({
    timeout: 30_000,
  });
  await expect(column(page).getByText('Example thread alpha reply')).toBeVisible();

  // Narrower: A fills the page beside B.
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(column(page)).toHaveAttribute('data-filled', 'true');
  await expect(column(page)).toBeVisible();
  await expect(second(page)).toBeVisible();
  const [a, b] = await Promise.all([column(page).boundingBox(), second(page).boundingBox()]);
  expect(a && b && a.x + a.width <= b.x + 1).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('open-beside-1280.png') });

  // Close takes the focus to A's composer.
  await composerIn(second(page)).click();
  await second(page).getByRole('button', { name: 'Close thread' }).click();
  await expect(second(page)).toHaveCount(0);
  await expect(composerIn(column(page))).toBeFocused();

  // A phone does not offer it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  const menu = await openCardMenu(page, beta);
  await expect(menu.getByRole('menuitem', { name: 'Open thread' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Open beside' })).toHaveCount(0);
});
