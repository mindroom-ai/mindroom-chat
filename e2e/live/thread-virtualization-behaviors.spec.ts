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
  opts: { longBodies?: boolean; quoteTargetIndex?: number } = {}
): Promise<Seeded> => {
  const roomId = await createPrivateRoom(homeserver, accessToken, {
    name: `Virtualization behaviors ${Date.now()}`,
  });
  const rootId = await sendRoomMessage(homeserver, accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Virtualization behaviors root',
  });
  const replyIds: string[] = [];
  for (let i = 1; i <= REPLY_COUNT; i += 1) {
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
    if (quoteTarget && i === REPLY_COUNT) {
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
