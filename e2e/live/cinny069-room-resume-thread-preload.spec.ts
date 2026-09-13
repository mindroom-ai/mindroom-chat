import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;
const iPhone13 = devices['iPhone 13'];

test.use({
  viewport: iPhone13.viewport,
  userAgent: iPhone13.userAgent,
  deviceScaleFactor: iPhone13.deviceScaleFactor,
  isMobile: iPhone13.isMobile,
  hasTouch: iPhone13.hasTouch,
});

const buildThreadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

const dispatchResumeSignals = async (page: import('@playwright/test').Page) => {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('pageshow'));
  });
};

test.describe('room resume thread preload', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('refreshes all visible compact thread cards on resume without requiring a thread click', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomName = `CINNY-069 Resume ${stamp}`;
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: roomName,
      topic: 'Regression fixture for stale visible thread cards after page resume.',
    });

    const threads = await Promise.all(
      Array.from({ length: 3 }, async (_value, index) => {
        const rootBody = `CINNY-069 root ${index} ${stamp}`;
        const replyBody = `CINNY-069 reply ${index} ${stamp}`;
        const rootId = await sendRoomMessage(
          homeserver,
          session.accessToken,
          roomId,
          {
            msgtype: 'm.text',
            body: rootBody,
          },
          'cinny-069'
        );

        await sendRoomMessage(
          homeserver,
          session.accessToken,
          roomId,
          {
            msgtype: 'm.text',
            body: replyBody,
            'm.relates_to': buildThreadRelation(rootId),
          },
          'cinny-069'
        );

        return {
          rootBody,
          rootId,
          replyBody,
        };
      })
    );

    const threadLoadPattern = /\/_matrix\/client\/v1\/rooms\/.*\/(threads|relations)\b/;
    let blockedThreadLoadCount = 0;
    await page.route(threadLoadPattern, async (route) => {
      blockedThreadLoadCount += 1;
      await route.abort();
    });

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible({ timeout: 30_000 });

    const cards = threads.map(({ rootId }) => page.locator(`[data-thread-root-id="${rootId}"]`));
    await Promise.all(cards.map((card) => card.waitFor({ timeout: 30_000 })));

    const staleCardTexts = await Promise.all(cards.map((card) => card.innerText()));
    staleCardTexts.forEach((cardText, index) => {
      expect(cardText).not.toContain(threads[index].replyBody);
      expect(cardText).toContain(threads[index].rootBody);
    });
    expect(blockedThreadLoadCount).toBeGreaterThan(0);

    const latestReplyBody = `CINNY-069 reply latest ${stamp}`;
    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: latestReplyBody,
        'm.relates_to': buildThreadRelation(threads[0].rootId),
      },
      'cinny-069'
    );

    await page.unroute(threadLoadPattern);
    await dispatchResumeSignals(page);

    await expect(cards[0]).toContainText(latestReplyBody, { timeout: 30_000 });
    await expect(cards[1]).toContainText(threads[1].replyBody, { timeout: 30_000 });
    await expect(cards[2]).toContainText(threads[2].replyBody, { timeout: 30_000 });

    await cards[0].click();
    await expect(page.getByText('Thread View')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(latestReplyBody)).toBeVisible({ timeout: 30_000 });

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-069-room-resume-thread-preload');
  });
});
