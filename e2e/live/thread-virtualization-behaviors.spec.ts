import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, sendRoomMessage } from '../helpers/matrix';
import { loadAllOlderThreadMessages } from '../helpers/threadTimeline';

/**
 * Live behavior guards for the virtualized thread timeline (PR #44).
 * Each test exercises a behavior that only manifests with real scroll
 * geometry and a real /sync stream:
 *  - open-at-latest lands the viewport at the newest reply
 *  - streaming edits must NOT yank a user who scrolled up back to the bottom
 *  - clicking a reply quote targeting a loaded-but-unmounted row scrolls to it
 *  - expand-all applies to rows that mount only after scrolling
 */

const hasCredentials = !!process.env.E2E_USERNAME;
const REPLY_COUNT = 200;

type Seeded = { roomId: string; rootId: string; replyIds: string[] };

const seedThread = async (
  homeserver: string,
  accessToken: string,
  opts: { longBodies?: boolean; quoteTargetIndex?: number; replyCount?: number } = {}
): Promise<Seeded> => {
  const roomId = await createPrivateRoom(homeserver, accessToken, {
    name: `Virtualization behaviors ${Date.now()}`,
  });
  const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Virtualization behaviors root',
  });
  const replyIds: string[] = [];
  const replyCount = opts.replyCount ?? REPLY_COUNT;
  for (let i = 1; i <= replyCount; i += 1) {
    const longSuffix = opts.longBodies
      ? `\n${Array.from({ length: 12 }, (_v, l) => `long collapsible line ${l} of reply ${i}`).join(
          '\n'
        )}`
      : '';
    const relatesTo: Record<string, unknown> = {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    };
    const quoteTarget =
      opts.quoteTargetIndex !== undefined ? replyIds[opts.quoteTargetIndex] : undefined;
    if (quoteTarget && i === replyCount) {
      relatesTo.is_falling_back = false;
      relatesTo['m.in_reply_to'] = { event_id: quoteTarget };
    }
    // eslint-disable-next-line no-await-in-loop
    const id = await sendRoomMessage(homeserver, accessToken, roomId, {
      msgtype: 'm.text',
      body: `Virt reply ${i}${longSuffix}`,
      'm.relates_to': relatesTo,
    });
    replyIds.push(id);
  }
  return { roomId, rootId, replyIds };
};

const openThread = async (page: Page, seeded: Seeded) => {
  await page.goto(
    `/home/${encodeURIComponent(seeded.roomId)}?threadId=${encodeURIComponent(seeded.rootId)}`
  );
  await page.waitForSelector('[data-message-item]', { timeout: 60_000 });
  await page.waitForTimeout(2_000);
};

const getScrollState = (page: Page) =>
  page.evaluate(() => {
    const row = document.querySelector<HTMLElement>('[data-message-item]');
    let el: HTMLElement | null = row?.parentElement ?? null;
    while (el) {
      const { overflowY } = window.getComputedStyle(el);
      if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight)
        break;
      el = el.parentElement;
    }
    return {
      scrollTop: el?.scrollTop ?? -1,
      scrollHeight: el?.scrollHeight ?? -1,
      clientHeight: el?.clientHeight ?? -1,
      mountedRows: document.querySelectorAll('[data-message-item]').length,
    };
  });

test.describe('virtualized thread behaviors', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');
  test.setTimeout(420_000);

  test('opening a large thread lands the viewport at the latest reply', async ({ page }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const seeded = await seedThread(homeserver, session.accessToken);

    await loginWithPassword(page, { homeserver, username, password });
    await openThread(page, seeded);

    const lastReply = page.getByText(`Virt reply ${REPLY_COUNT}`, { exact: false }).last();
    await expect(lastReply).toBeInViewport({ timeout: 15_000 });

    const state = await getScrollState(page);
    expect(state.scrollTop + state.clientHeight).toBeGreaterThan(state.scrollHeight - 48);
    expect(state.mountedRows).toBeLessThan(60);
    await expect(page.getByRole('button', { name: 'Jump to Latest' })).toHaveCount(0);
  });

  test('streaming edits do not yank a scrolled-up reader back to the bottom', async ({ page }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const seeded = await seedThread(homeserver, session.accessToken);

    await loginWithPassword(page, { homeserver, username, password });
    await openThread(page, seeded);

    // Real wheel input marks user scroll intent, then leaves the bottom zone.
    const timeline = page.locator('[data-message-item]').first();
    await timeline.hover();
    for (let i = 0; i < 12; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -900);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(120);
    }
    const before = await getScrollState(page);
    expect(before.scrollTop + before.clientHeight).toBeLessThan(before.scrollHeight - 300);

    for (let step = 1; step <= 10; step += 1) {
      // eslint-disable-next-line no-await-in-loop
      await sendRoomMessage(homeserver, session.accessToken, seeded.roomId, {
        msgtype: 'm.text',
        body: `* streamed chunk ${step}`,
        'm.new_content': { msgtype: 'm.text', body: `streamed chunk ${step}` },
        'm.relates_to': {
          rel_type: 'm.replace',
          event_id: seeded.replyIds[seeded.replyIds.length - 1],
        },
      });
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(150);
    }
    await page.waitForTimeout(1_500);

    const after = await getScrollState(page);
    // The reader must stay where they were (allow small measurement drift).
    expect(Math.abs(after.scrollTop - before.scrollTop)).toBeLessThan(200);
    expect(after.scrollTop + after.clientHeight).toBeLessThan(after.scrollHeight - 300);
    await expect(page.getByRole('button', { name: 'Jump to Latest' })).toBeVisible();
  });

  // Guards two things: (1) the user-facing CONTRACT — older thread
  // history is reachable by real wheel scrolling alone, never
  // requiring a "Load Older Messages" chip tap; (2) the
  // scroll-driven auto-pagination TRIGGER itself, asserted directly
  // through the threadAutoPaginateBackFired probe counter. The
  // counter assertion is what makes this red when the trigger is
  // removed: on this fast local network the CONTENT assertion alone
  // is also satisfiable by background band backfill (verified — it
  // passed with the trigger stashed), which is exactly the loader
  // that lags on the slow mobile networks where the task #125 jag
  // manifests.
  test('scrolling up auto-loads older replies without the Load Older chip (task #125)', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    // More replies than one THREAD_BATCH_SIZE (200) so the open leaves
    // older history unloaded — the shape where mobile scroll-up used
    // to hard-stop at the loaded-window edge (task #125).
    const seeded = await seedThread(homeserver, session.accessToken, { replyCount: 460 });

    await loginWithPassword(page, { homeserver, username, password });

    // Slow down the MATRIX API (not the app assets) before opening the
    // thread. On an unthrottled local network the background band
    // backfill loads the ENTIRE thread during the open-settle phase
    // (verified via gate logging: count reached full before
    // openPinPending cleared), leaving the trigger nothing to do — the
    // exact opposite of the slow mobile networks where the task #125
    // jag manifests. Per-request latency on /_matrix/* keeps older
    // history unloaded when the walk starts, so the trigger has a real
    // edge to fire against. (A CDP global throttle is unusable here:
    // page.goto re-navigates and the vite dev bundle cannot boot
    // through it.)
    await page.route('**/_matrix/**', async (route) => {
      await new Promise((resolve) => {
        setTimeout(resolve, 1_200);
      });
      await route.continue();
    });

    await openThread(page, seeded);

    // Target: a reply OLDER than the initially-loaded window (open
    // loads the latest THREAD_BATCH_SIZE=200 → replies 261-460), so
    // reaching it proves back-pagination extended the window. NOT
    // reply 1: the oldest ~30 replies of a large thread are
    // unreachable through the current loader (pre-existing gap,
    // documented at the quote-click test below and filed as task
    // #126) — this test proves the auto-trigger, not that gap.
    const targetReplyId = seeded.replyIds[99]; // "Virt reply 100"

    // Sanity: the target must NOT be rendered at open. If it is, the
    // fixture no longer leaves history unloaded and this test can no
    // longer prove auto-pagination — fail loudly rather than pass
    // vacuously.
    expect(await page.locator(`[data-message-id="${targetReplyId}"]`).count()).toBe(0);

    // Real wheel input, never touching the "Load Older Messages" chip.
    // Bounded walk: each iteration wheels up; auto-pagination must
    // extend the window. Exit condition is the MINIMUM mounted reply
    // number rather than an exact-target mount: prepend anchor
    // restores can hop the viewport across any single row between
    // polls, but the minimum mounted number reaching the target depth
    // proves the loaded window extended ~160+ rows past the initial
    // batch — impossible without back-pagination.
    const timeline = page.locator('[data-message-item]').first();
    await timeline.hover();
    const targetReplyNumber = 100;
    const minMountedReplyNumber = () =>
      page.evaluate(() => {
        let min = Number.POSITIVE_INFINITY;
        document.querySelectorAll('[data-message-item]').forEach((row) => {
          const match = /Virt reply (\d+)\b/.exec(row.textContent ?? '');
          if (match) min = Math.min(min, Number(match[1]));
        });
        return Number.isFinite(min) ? min : undefined;
      });
    let deepest: number | undefined;
    for (let i = 0; i < 160; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -1400);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(120);
      // eslint-disable-next-line no-await-in-loop
      const min = await minMountedReplyNumber();
      if (min !== undefined && (deepest === undefined || min < deepest)) deepest = min;
      if (deepest !== undefined && deepest <= targetReplyNumber) break;
    }
    expect(deepest).toBeLessThanOrEqual(targetReplyNumber);

    // The trigger itself must have fired at least once during the
    // walk — this is the assertion that distinguishes trigger-driven
    // loading from band-backfill-driven loading and goes red if the
    // auto-pagination effect is removed.
    const autoFires = await page.evaluate(() => {
      const w = window as Window & {
        __MINDROOM_CACHE_PROBE__?: { snapshot: () => Record<string, number> };
      };
      return w.__MINDROOM_CACHE_PROBE__?.snapshot()?.threadAutoPaginateBackFired ?? 0;
    });
    expect(autoFires).toBeGreaterThanOrEqual(1);
  });

  test('clicking a reply quote targeting a loaded-but-unmounted row scrolls to it', async ({
    page,
  }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    // Target a reply that is distant (far outside the mounted window) but
    // within the slice the thread-open pipeline actually loads. The oldest
    // ~30 replies of a large thread are not loaded by the current pipeline
    // (pre-existing loader gap, unrelated to virtualization).
    const QUOTE_TARGET_INDEX = 59;
    const seeded = await seedThread(homeserver, session.accessToken, {
      quoteTargetIndex: QUOTE_TARGET_INDEX,
    });

    await loginWithPassword(page, { homeserver, username, password });
    await openThread(page, seeded);
    await loadAllOlderThreadMessages(page);

    // Jump back to the bottom where the quoting message lives.
    const jump = page.getByRole('button', { name: 'Jump to Latest' });
    if ((await jump.count()) > 0) {
      await jump.first().click();
      await page.waitForTimeout(1_000);
    }

    // The last reply quotes reply #1; its quote block links the early event
    // (the message's own controls also carry data-event-id, so match the
    // quoted id specifically).
    const quote = page
      .locator(
        `[data-message-id="${seeded.replyIds[REPLY_COUNT - 1]}"] [data-event-id="${
          seeded.replyIds[QUOTE_TARGET_INDEX]
        }"]`
      )
      .first();
    await expect(quote).toBeVisible({ timeout: 15_000 });
    await quote.click();

    const earlyRow = page.locator(`[data-message-id="${seeded.replyIds[QUOTE_TARGET_INDEX]}"]`);
    await expect(earlyRow).toBeVisible({ timeout: 10_000 });
    await expect(earlyRow).toBeInViewport({ timeout: 10_000 });
  });

  test('expand-all applies to rows mounted after scrolling', async ({ page }) => {
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const seeded = await seedThread(homeserver, session.accessToken, { longBodies: true });

    await loginWithPassword(page, { homeserver, username, password });
    await openThread(page, seeded);

    // Sanity: long bodies start collapsed.
    await expect(page.locator('[data-message-item] [aria-expanded="false"]').first()).toBeVisible({
      timeout: 15_000,
    });

    await page.getByRole('button', { name: '[+all]' }).click();
    await page.waitForTimeout(500);
    expect(await page.locator('[data-message-item] [aria-expanded="false"]').count()).toBe(0);

    // Scroll far up so fresh rows mount outside the original window.
    const timeline = page.locator('[data-message-item]').first();
    await timeline.hover();
    for (let i = 0; i < 25; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await page.mouse.wheel(0, -1600);
      // eslint-disable-next-line no-await-in-loop
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(800);

    expect(await page.locator('[data-message-item]').count()).toBeGreaterThan(0);
    expect(await page.locator('[data-message-item] [aria-expanded="false"]').count()).toBe(0);
  });
});
