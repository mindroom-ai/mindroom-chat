import { expect, type Page, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

const THREAD_COUNT = 40;
const COMPACT_VIEW = '[data-compact-room-view="true"]';

type Session = Awaited<ReturnType<typeof loginToMatrix>>;

const sendThreadReply = (
  homeserver: string,
  session: Session,
  roomId: string,
  rootId: string,
  body: string
) =>
  sendRoomMessage(homeserver, session.accessToken, roomId, {
    msgtype: 'm.text',
    body,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });

type CardLayout = {
  /** The cards fully in view, top to bottom, by their top relative to the viewport. */
  offsets: Record<string, number>;
  /** The glass room header covers this much of the viewport's top. */
  headerHeight: number;
  scrollTop: number;
};

// The overview's layout once it has stopped moving.
const settledCardLayout = (page: Page): Promise<CardLayout> =>
  page.evaluate(async (selector) => {
    const view = document.querySelector<HTMLElement>(selector);
    if (!view) return { offsets: {}, headerHeight: 0, scrollTop: -1 };
    let previous = view.scrollTop;
    for (let stableFrames = 0, frames = 0; stableFrames < 5 && frames < 120; frames += 1) {
      await new Promise((resolve) => {
        requestAnimationFrame(resolve);
      });
      stableFrames = view.scrollTop === previous ? stableFrames + 1 : 0;
      previous = view.scrollTop;
    }
    const { top, bottom } = view.getBoundingClientRect();
    const offsets: Record<string, number> = {};
    view.querySelectorAll<HTMLElement>('button[data-thread-root-id]').forEach((card) => {
      const rect = card.getBoundingClientRect();
      if (rect.top >= top && rect.bottom <= bottom) {
        offsets[card.dataset.threadRootId!] = rect.top - top;
      }
    });
    return {
      offsets,
      headerHeight: parseFloat(getComputedStyle(view).paddingTop),
      scrollTop: view.scrollTop,
    };
  }, COMPACT_VIEW);

const scrollOverviewTo = (page: Page, scrollTop: number) =>
  page.evaluate(
    ([selector, top]) => {
      document.querySelector<HTMLElement>(selector)!.scrollTop = top;
    },
    [COMPACT_VIEW, scrollTop] as const
  );

const clickThreadExitButton = (page: Page) =>
  page.evaluate(() => {
    const exitButton = document.querySelector('[data-thread-context-banner] button');
    if (!(exitButton instanceof HTMLButtonElement)) throw new Error('Thread exit button not found');
    exitButton.click();
  });

// A logged-in page and a compact room of THREAD_COUNT threads with a reply each, the first oldest.
const setUpCompactRoom = async (page: Page) => {
  const homeserver = getHomeserver();
  const credentials = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
  const runTag = Date.now().toString(36);
  const roomId = await createPrivateRoom(homeserver, session.accessToken, {
    name: `Compact scroll ${runTag}`,
  });
  const roots: string[] = [];
  for (let index = 0; index < THREAD_COUNT; index += 1) {
    const body = `Compact scroll ${runTag} thread ${index}`;
    const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
      msgtype: 'm.text',
      body,
    });
    await sendThreadReply(homeserver, session, roomId, rootId, `First reply to ${body}`);
    roots.push(rootId);
  }

  await page.setViewportSize({ width: 1280, height: 720 });
  await loginWithPassword(page, { homeserver, ...credentials });
  await seedRoomOverviewState({
    page,
    roomId,
    userId: session.userId,
    viewMode: 'compact',
    filterState: createDefaultThreadFilterState(),
  });
  return { homeserver, session, runTag, roomId, roots };
};

test('the compact overview keeps its cards in place when threads re-sort during a thread visit', async ({
  page,
}) => {
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  test.slow();
  const { homeserver, session, runTag, roomId, roots } = await setUpCompactRoom(page);

  // Opens the first card below the header and, while the thread is open, gets
  // replies in it and in the thread at the bottom of the list, so both sort
  // above the cards in view. Leaving the thread, the cards below the opened
  // one, most of the view, must be exactly where they were.
  const visitThreadAndReturn = async (scrollTop: number, leave: () => Promise<unknown>) => {
    await scrollOverviewTo(page, scrollTop);
    const { offsets: before, headerHeight } = await settledCardLayout(page);
    const inView = Object.keys(before);
    const openedIndex = inView.findIndex((rootId) => before[rootId]! >= headerHeight);
    const opened = inView[openedIndex]!;
    const below = inView.slice(openedIndex + 1);
    expect(below.length).toBeGreaterThan(openedIndex + 1);
    const lastRootId = await page
      .locator(`${COMPACT_VIEW} button[data-thread-root-id]`)
      .last()
      .getAttribute('data-thread-root-id');
    expect(inView).not.toContain(lastRootId);
    // A locator click first scrolls a card the header overlaps, which would
    // move the overview before it is left; a reader's tap does not.
    const card = await page
      .locator(`${COMPACT_VIEW} button[data-thread-root-id="${opened}"]`)
      .boundingBox();
    await page.mouse.click(card!.x + card!.width / 2, card!.y + card!.height / 2);
    await expect(page).toHaveURL(new RegExp(`threadId=${encodeURIComponent(opened)}`));
    const reply = `Reply while open ${runTag} ${scrollTop}`;
    // Sent first, so the open thread's reply showing means both have synced.
    await sendThreadReply(homeserver, session, roomId, lastRootId!, `Elsewhere ${reply}`);
    await sendThreadReply(homeserver, session, roomId, opened, reply);
    await expect(page.getByText(reply, { exact: true })).toBeVisible();

    await leave();
    await expect(page).not.toHaveURL(/threadId=/);
    await expect(page.locator(COMPACT_VIEW)).toBeVisible();
    const cards = page.locator(`${COMPACT_VIEW} button[data-thread-root-id]`);
    await expect(cards.nth(0)).toHaveAttribute('data-thread-root-id', opened);
    await expect(cards.nth(1)).toHaveAttribute('data-thread-root-id', lastRootId!);
    const { offsets: after } = await settledCardLayout(page);
    for (const rootId of below) {
      expect(
        Math.abs(after[rootId]! - before[rootId]!),
        `card ${roots.indexOf(rootId)} moved from ${before[rootId]} to ${after[rootId]}`
      ).toBeLessThanOrEqual(1);
    }
  };

  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.locator(`${COMPACT_VIEW} button[data-thread-root-id]`).first()).toBeVisible();

  await test.step('desktop browser Back', async () => {
    await visitThreadAndReturn(900, () => page.goBack());
  });

  await test.step('desktop thread exit button', async () => {
    await visitThreadAndReturn(1500, () => clickThreadExitButton(page));
  });

  await test.step('mobile browser Back', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await visitThreadAndReturn(1200, () => page.goBack());
  });
});

test('the compact overview a focus address opened stays where the reader left it', async ({
  page,
}) => {
  test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
  test.slow();
  const { roomId, roots } = await setUpCompactRoom(page);
  const cards = page.locator(`${COMPACT_VIEW} button[data-thread-root-id]`);

  // A thread left from its link puts this address in its place, and Back from a thread opened
  // later returns to it. Its card was shown once; the reader has scrolled to the top since.
  const focusAddress = (rootId: string) =>
    `/home/${encodeURIComponent(roomId)}/${encodeURIComponent(rootId)}?focusEvent=1`;
  const openTopCardAfterFocus = async (
    focusedRootId: string,
    enter: () => Promise<unknown> = () => page.goto(focusAddress(focusedRootId))
  ) => {
    await enter();
    await expect(
      page.locator(`${COMPACT_VIEW} button[data-thread-root-id="${focusedRootId}"]`)
    ).toBeInViewport();
    await scrollOverviewTo(page, 0);
    expect((await settledCardLayout(page)).scrollTop).toBe(0);
    const topRootId = await cards.first().getAttribute('data-thread-root-id');
    const card = await cards.first().boundingBox();
    await page.mouse.click(card!.x + card!.width / 2, card!.y + card!.height / 2);
    await expect(page).toHaveURL(new RegExp(`threadId=${encodeURIComponent(topRootId!)}`));
  };
  const expectAtTop = async () => {
    await expect(page).not.toHaveURL(/threadId=/);
    await expect(page.locator(COMPACT_VIEW)).toBeVisible();
    expect((await settledCardLayout(page)).scrollTop).toBe(0);
  };

  await test.step('browser Back', async () => {
    await openTopCardAfterFocus(roots[3]!);
    await page.goBack();
    await expectAtTop();
  });

  await test.step('thread exit button', async () => {
    await openTopCardAfterFocus(roots[6]!);
    await clickThreadExitButton(page);
    await expectAtTop();
  });

  // The address as the app writes it: in place of a thread that was opened from a link.
  await test.step('browser Back to the address a linked thread left', async () => {
    const linkedRootId = roots[9]!;
    await openTopCardAfterFocus(linkedRootId, async () => {
      await page.goto(
        `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(linkedRootId)}`
      );
      await expect(page.locator('[data-thread-context-banner]')).toBeVisible();
      await clickThreadExitButton(page);
      await expect(page).toHaveURL(/focusEvent=1/);
    });
    await page.goBack();
    await expectAtTop();
  });
});
