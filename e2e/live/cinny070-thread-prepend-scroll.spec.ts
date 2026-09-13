import { devices, expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
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
const REPLY_COUNT = 450;
const iPhone13 = devices['iPhone 13'];

test.use({
  viewport: iPhone13.viewport,
  userAgent: iPhone13.userAgent,
  deviceScaleFactor: iPhone13.deviceScaleFactor,
  isMobile: iPhone13.isMobile,
  hasTouch: iPhone13.hasTouch,
});

type VisibleAnchor = {
  eventId: string;
  top: number;
  text: string;
};

const scrollThreadTimelineToTop = async (
  page: import('@playwright/test').Page
): Promise<boolean> =>
  page.evaluate(() => {
    const firstMessage = document.querySelector<HTMLElement>('[data-message-id]');
    if (!firstMessage) return false;

    let scrollContainer: HTMLElement | null = firstMessage.parentElement;
    while (scrollContainer && scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
      scrollContainer = scrollContainer.parentElement;
    }
    if (!scrollContainer) return false;

    scrollContainer.scrollTop = 0;
    return true;
  });

const getVisibleThreadAnchor = async (
  page: import('@playwright/test').Page
): Promise<VisibleAnchor | null> =>
  page.evaluate(() => {
    const firstMessage = document.querySelector<HTMLElement>('[data-message-id]');
    if (!firstMessage) return null;

    let scrollContainer: HTMLElement | null = firstMessage.parentElement;
    while (scrollContainer && scrollContainer.scrollHeight <= scrollContainer.clientHeight) {
      scrollContainer = scrollContainer.parentElement;
    }
    if (!scrollContainer) return null;

    const scrollRect = scrollContainer.getBoundingClientRect();
    const messageItems = Array.from(
      scrollContainer.querySelectorAll<HTMLElement>('[data-message-id]')
    );
    const anchor = messageItems.find((item) => item.getBoundingClientRect().bottom > scrollRect.top);
    const eventId = anchor?.getAttribute('data-message-id');
    if (!anchor || !eventId) return null;

    return {
      eventId,
      top: anchor.getBoundingClientRect().top,
      text: anchor.textContent ?? '',
    };
  });

const getAnchorDisplacement = async (
  page: import('@playwright/test').Page,
  anchor: VisibleAnchor
): Promise<{ found: boolean; top: number | null; text: string }> =>
  page.evaluate((expected) => {
    const anchorElement = document.querySelector<HTMLElement>(
      `[data-message-id="${CSS.escape(expected.eventId)}"]`
    );
    if (!anchorElement) {
      return { found: false, top: null, text: '' };
    }
    return {
      found: true,
      top: anchorElement.getBoundingClientRect().top,
      text: anchorElement.textContent ?? '',
    };
  }, anchor);

test.describe('CINNY-070: thread prepend pagination preserves scroll anchor', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('loading older thread messages does not jump back to the thread bottom', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `CINNY-070 ${stamp}`,
      topic: 'Regression fixture for thread prepend scroll anchoring',
    });
    const rootBody = `CINNY-070 long thread root ${stamp}`;

    const rootId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: rootBody,
      },
      'cinny-070-root'
    );

    for (let index = 1; index <= REPLY_COUNT; index += 1) {
      await sendRoomMessage(
        homeserver,
        session.accessToken,
        roomId,
        {
          msgtype: 'm.text',
          body: `CINNY-070 reply ${index}`,
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: rootId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: rootId },
          },
        },
        `cinny-070-reply-${index}`
      );
    }

    await loginWithPassword(page, { homeserver, username, password });
    await seedRoomOverviewState({
      page,
      roomId,
      userId: session.userId,
      viewMode: 'normal',
      filterState: createDefaultThreadFilterState(),
    });

    await page.goto(`/home/${encodeURIComponent(roomId)}`);

    const rootMessage = page.locator(`[data-message-id="${rootId}"]`);
    await expect(rootMessage).toBeVisible({ timeout: 30_000 });

    const threadButton = rootMessage.getByRole('button', {
      name: /Thread\s+\d+\s+replies/i,
    });
    await expect(threadButton).toBeVisible({ timeout: 30_000 });
    await threadButton.click();

    await expect(page.getByText('Thread View')).toBeVisible({ timeout: 30_000 });

    const loadOlderButton = page.getByRole('button', { name: 'Load Older Messages' });
    await expect(loadOlderButton).toBeVisible({ timeout: 30_000 });
    expect(await scrollThreadTimelineToTop(page)).toBe(true);
    await expect(loadOlderButton).toBeVisible({ timeout: 30_000 });

    const anchor = await getVisibleThreadAnchor(page);
    expect(anchor).not.toBeNull();
    if (!anchor) return;

    await loadOlderButton.evaluate((button: HTMLButtonElement) => button.click());

    await expect(loadOlderButton).toHaveCount(0, { timeout: 30_000 });

    await expect
      .poll(
        async () => {
          const displacement = await getAnchorDisplacement(page, anchor);
          if (!displacement.found) return Number.POSITIVE_INFINITY;
          if (!displacement.text.includes(anchor.text.trim().slice(0, 16))) {
            return Number.POSITIVE_INFINITY;
          }
          return Math.abs((displacement.top ?? 0) - anchor.top);
        },
        {
          timeout: 30_000,
          message:
            'Expected the previously visible thread message to stay anchored after prepending older replies',
        }
      )
      .toBeLessThanOrEqual(64);

    const displacement = await getAnchorDisplacement(page, anchor);
    expect(displacement.found).toBe(true);
    expect(Math.abs((displacement.top ?? 0) - anchor.top)).toBeLessThanOrEqual(64);
    await expect(page.getByText('Failed to load this thread')).toHaveCount(0);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny070-thread-prepend-scroll');
  });
});
