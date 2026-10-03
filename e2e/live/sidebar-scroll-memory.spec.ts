import { expect, type Page, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  loginToMatrix,
  sendRoomMessage,
} from '../helpers/matrix';

const FILLER_ROOM_COUNT = 25;

type ThreadSeed = { roomId: string; rootId: string; body: string };

const navScrollTop = (page: Page) =>
  page.evaluate(() => {
    const list = document.querySelector('[data-testid="room-nav-category"]');
    let node = list?.parentElement ?? null;
    while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
    return node?.scrollTop ?? -1;
  });

// Scrolling a row into view lets the virtualizer measure rows and correct the
// offset over the next frames, so compare against the settled position.
const settledNavScrollTop = (page: Page) =>
  page.evaluate(async () => {
    const list = document.querySelector('[data-testid="room-nav-category"]');
    let node = list?.parentElement ?? null;
    while (node && node.scrollHeight <= node.clientHeight) node = node.parentElement;
    if (!node) return -1;
    let previous = node.scrollTop;
    for (let stableFrames = 0, frames = 0; stableFrames < 5 && frames < 120; frames += 1) {
      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
      stableFrames = node.scrollTop === previous ? stableFrames + 1 : 0;
      previous = node.scrollTop;
    }
    return previous;
  });

const expectNavScrollRestored = async (page: Page, before: number) => {
  const isRestored = async () => Math.abs((await navScrollTop(page)) - before) <= 1;
  await expect.poll(isRestored).toBe(true);
  // A late reset after the first restored frame is the reported failure.
  await page.waitForTimeout(500);
  expect(await isRestored()).toBe(true);
};

test('the navigation panel keeps its scroll position across thread and room opens', async ({
  page,
}) => {
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  const homeserver = getHomeserver();
  test.skip(
    !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
    'Local fixture only'
  );
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const runTag = Date.now().toString(36);
  // Home sorts rooms A to Z; other live specs leave rooms in a shared account,
  // so these sort last to stay among the rendered rows near the thread list.
  const roomName = (index: number) =>
    `Zz nav scroll ${runTag} room ${String(index).padStart(2, '0')}`;
  const roomIds: string[] = [];
  for (let index = 0; index < FILLER_ROOM_COUNT; index += 1) {
    roomIds.push(
      await createPrivateRoom(homeserver, session.accessToken, { name: roomName(index) })
    );
  }
  const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
    name: `Zz nav scroll ${runTag} space`,
  });
  const spaceRoomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Zz nav scroll ${runTag} space room`,
  });
  await addRoomToSpace(homeserver, session.accessToken, spaceId, spaceRoomId);
  const threads: ThreadSeed[] = [];
  for (const [index, roomId] of [roomIds[0], roomIds[1]].entries()) {
    const body = `Zz nav scroll ${runTag} thread ${index}`;
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Reply to ${body}`,
      'm.relates_to': {
        rel_type: 'm.thread',
        event_id: rootId,
        is_falling_back: true,
        'm.in_reply_to': { event_id: rootId },
      },
    });
    threads.push({ roomId, rootId, body });
  }

  await loginWithPassword(page, { homeserver, ...credentials });
  const panel = page.getByTestId('resizable-page-nav');
  const threadButton = (thread: ThreadSeed) =>
    panel
      .getByTestId('thread-nav-list')
      .getByRole('button', { name: new RegExp(`^Open thread: ${thread.body}\\.`) });
  const roomLink = (index: number) =>
    panel.getByRole('link', { name: roomName(index), exact: true });
  const openThreadFromNav = async (thread: ThreadSeed) => {
    await expect(threadButton(thread)).toBeAttached();
    await threadButton(thread).scrollIntoViewIfNeeded();
    const before = await settledNavScrollTop(page);
    expect(before).toBeGreaterThan(100);
    await threadButton(thread).click();
    await expect(page).toHaveURL(new RegExp(`threadId=${encodeURIComponent(thread.rootId)}`));
    await expect(page.getByText(`Reply to ${thread.body}`, { exact: true })).toBeVisible();
    return before;
  };

  await test.step('desktop thread opens keep the shared navigation panel in place', async () => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto(`/home/${encodeURIComponent(roomIds[0])}`);
    for (const thread of threads) {
      const before = await openThreadFromNav(thread);
      await expectNavScrollRestored(page, before);
    }
  });

  await test.step('desktop space switches return Home to its previous position', async () => {
    const before = await settledNavScrollTop(page);
    await page.locator(`button[data-id="${spaceId}"]`).click();
    await expect(
      panel.getByRole('link', { name: `Zz nav scroll ${runTag} space room`, exact: true })
    ).toBeVisible();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await expect(threadButton(threads[0])).toBeAttached();
    await expectNavScrollRestored(page, before);
  });

  await test.step('mobile thread opens return to the same navigation position', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/home/');
    for (const thread of threads) {
      const before = await openThreadFromNav(thread);
      await page.goBack();
      await expect(threadButton(thread)).toBeAttached();
      await expectNavScrollRestored(page, before);
    }
  });

  await test.step('mobile room opens return to the same navigation position', async () => {
    const link = roomLink(FILLER_ROOM_COUNT - 5);
    await link.scrollIntoViewIfNeeded();
    const before = await settledNavScrollTop(page);
    expect(before).toBeGreaterThan(100);
    await link.click();
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(roomIds[FILLER_ROOM_COUNT - 5])));
    await page.goBack();
    await expect(link).toBeAttached();
    await expectNavScrollRestored(page, before);
  });
});
