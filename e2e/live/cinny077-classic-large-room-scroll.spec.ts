import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createDefaultThreadFilterState,
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  seedRoomOverviewState,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;
const MESSAGE_COUNT = 700;

type ScrollSample = {
  scrollTop: number;
  scrollHeight: number;
  mountedMessageCount: number;
  firstVisibleMessage: string;
};

const sendLargeRoomMessages = async (
  homeserver: string,
  accessToken: string,
  roomId: string,
  stamp: number
) => {
  let nextIndex = 1;

  await Promise.all(
    Array.from({ length: 20 }, async () => {
      while (nextIndex <= MESSAGE_COUNT) {
        const index = nextIndex;
        nextIndex += 1;

        await matrixFetch(
          homeserver,
          `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/cinny-077-${stamp}-${index}`,
          {
            method: 'PUT',
            accessToken,
            body: JSON.stringify({
              msgtype: 'm.text',
              body: `CINNY-077 classic large room ${stamp} message ${String(index).padStart(
                4,
                '0'
              )}`,
            }),
          }
        );
      }
    })
  );
};

const sampleClassicRoomScroll = async (page: Page): Promise<ScrollSample[]> =>
  page.evaluate(async () => {
    const findTimelineScrollRoot = (): HTMLElement => {
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter(
        (element) => {
          const { overflowY } = window.getComputedStyle(element);
          return (
            (overflowY === 'auto' || overflowY === 'scroll') &&
            !!element.querySelector('[data-message-id]')
          );
        }
      );

      const timelineRoot = candidates.sort((a, b) => b.scrollHeight - a.scrollHeight)[0];
      if (!timelineRoot) {
        throw new Error('Unable to find room timeline scroll root.');
      }
      return timelineRoot;
    };

    const firstVisibleMessage = (root: HTMLElement): string => {
      const rootRect = root.getBoundingClientRect();
      const visibleItem = Array.from(root.querySelectorAll<HTMLElement>('[data-message-id]')).find(
        (item) => {
          const rect = item.getBoundingClientRect();
          return rect.bottom > rootRect.top + 8 && rect.top < rootRect.bottom - 8;
        }
      );

      return visibleItem?.textContent?.match(/message \d{4}/)?.[0] ?? '';
    };

    const scrollRoot = findTimelineScrollRoot();
    const samples: ScrollSample[] = [];

    for (let index = 0; index < 60; index += 1) {
      samples.push({
        scrollTop: Math.round(scrollRoot.scrollTop),
        scrollHeight: Math.round(scrollRoot.scrollHeight),
        mountedMessageCount: document.querySelectorAll('[data-message-id]').length,
        firstVisibleMessage: firstVisibleMessage(scrollRoot),
      });

      await new Promise((resolve) => {
        setTimeout(resolve, 200);
      });
    }

    return samples;
  });

test.describe('CINNY-077: classic large room loading scroll stability', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('opening a large classic room does not jump while backfill is loading', async ({ page }) => {
    test.slow();

    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `CINNY-077 Classic Large ${stamp}`,
      topic: 'Regression fixture for classic large-room loading scroll stability.',
    });

    await sendLargeRoomMessages(homeserver, accessToken, roomId, stamp);

    await loginWithPassword(page, { homeserver, username, password });
    await seedRoomOverviewState({
      page,
      roomId,
      userId,
      viewMode: 'classic',
      filterState: createDefaultThreadFilterState(),
    });

    let backPaginationRequests = 0;
    await page.route(/\/rooms\/.*\/messages(?:\?|$)/, async (route) => {
      backPaginationRequests += 1;
      await new Promise((resolve) => {
        setTimeout(resolve, 250);
      });
      await route.continue();
    });

    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await expect(
      page.getByText(`message ${String(MESSAGE_COUNT).padStart(4, '0')}`).first()
    ).toBeVisible({
      timeout: 30_000,
    });

    const samples = await sampleClassicRoomScroll(page);
    const visibleSamples = samples.filter((sample) => sample.firstVisibleMessage.length > 0);
    expect(visibleSamples.length).toBeGreaterThan(0);

    const firstVisibleMessages = new Set(
      visibleSamples.map((sample) => sample.firstVisibleMessage)
    );
    const scrollTopDelta =
      Math.max(...visibleSamples.map((sample) => sample.scrollTop)) -
      Math.min(...visibleSamples.map((sample) => sample.scrollTop));

    expect(firstVisibleMessages).toEqual(new Set([visibleSamples[0].firstVisibleMessage]));
    expect(scrollTopDelta).toBeLessThanOrEqual(2);
    expect(backPaginationRequests).toBeLessThanOrEqual(1);
  });
});
