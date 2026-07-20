import { expect, type Page, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  addRoomToSpace,
  createDefaultThreadFilterState,
  createPrivateSpace,
  createThreadFixture,
  loginToMatrix,
  seedRoomOverviewState,
  type ThreadFixture,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

type ViewportFixture = {
  height: number;
  label: string;
  width: number;
};

const VIEWPORTS: ViewportFixture[] = [
  { label: 'desktop', width: 1440, height: 900 },
  { label: 'tablet', width: 768, height: 1024 },
  { label: 'mobile-wide', width: 480, height: 800 },
  { label: 'mobile-narrow', width: 360, height: 640 },
];

const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const getThreadButton = (page: Page, rootBody: string) =>
  page.getByTestId('thread-nav-list').getByRole('button', {
    name: new RegExp(`Open thread: ${escapeRegex(rootBody)}`, 'i'),
  });

const getRecentlyOpenedThreadButton = (page: Page, rootBody: string) =>
  page.getByTestId('recently-opened-nav-list').getByRole('button', {
    name: new RegExp(`Open thread: ${escapeRegex(rootBody)}`, 'i'),
  });

const getThreadRow = (page: Page, fixture: ThreadFixture) =>
  page.locator(`[data-sidebar-thread-root-id="${fixture.rootId}"]`);

const getRoomsCategoryButton = (page: Page) => page.locator('button[data-category-id="home|room"]');

const getThreadsCategoryButton = (page: Page) =>
  page.locator('button[data-category-id="mindroom|threads"]');

const getRecentlyOpenedCategoryButton = (page: Page) =>
  page.locator('button[data-category-id="mindroom|recently-opened"]');

const seedRecentThreadsState = async ({
  page,
  userId,
  fixtures,
}: {
  page: Page;
  userId: string;
  fixtures: ThreadFixture[];
}) => {
  const openedAtBase = Date.now();
  const entries = fixtures.map((fixture, index) => ({
    roomId: fixture.roomId,
    threadId: fixture.rootId,
    openedAt: openedAtBase - index,
    summaryText: fixture.rootBody,
  }));

  await page.evaluate(
    ({ nextUserId, nextEntries }) => {
      localStorage.setItem(
        `recentThreads:${nextUserId}`,
        JSON.stringify({ v: 1, entries: nextEntries })
      );
    },
    { nextUserId: userId, nextEntries: entries }
  );
};

const waitForThreadEntries = async (page: Page, fixtures: ThreadFixture[]) => {
  await Promise.all(
    fixtures.map((fixture) =>
      expect(getThreadButton(page, fixture.rootBody)).toBeVisible({ timeout: 30_000 })
    )
  );
};

const waitForRecentlyOpenedEntries = async (page: Page, fixtures: ThreadFixture[]) => {
  await Promise.all(
    fixtures.map((fixture) =>
      expect(getRecentlyOpenedThreadButton(page, fixture.rootBody)).toBeVisible({
        timeout: 30_000,
      })
    )
  );
};

const expectRecentlyOpenedAtViewportBottom = async (page: Page, viewportHeight: number) => {
  await expect
    .poll(async () => {
      const bounds = await page.getByTestId('recently-opened-nav-panel').boundingBox();
      if (!bounds) return Number.POSITIVE_INFINITY;
      return Math.abs(bounds.y + bounds.height - viewportHeight);
    })
    .toBeLessThanOrEqual(1);
};

const prepareThreadFixtures = async (threadCount: number) => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const stamp = Date.now();
  const fixtures: ThreadFixture[] = [];
  const roomNames: string[] = [];

  for (let index = 0; index < threadCount; index += 1) {
    const roomName = `CINNY-073 ${index} ${stamp}`;
    roomNames.push(roomName);
    fixtures.push(
      await createThreadFixture(homeserver, session.accessToken, {
        name: roomName,
        topic: 'Regression fixture for persistent thread navigation coverage.',
        rootBody: `CINNY-073 thread nav root ${index} ${stamp}`,
        replyBody: `CINNY-073 thread nav reply ${index} ${stamp}`,
        txnPrefix: 'cinny-073',
      })
    );
  }

  const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
    name: `CINNY-073 Space ${stamp}`,
    topic: 'Regression fixture for persistent Recently Opened placement.',
  });
  await addRoomToSpace(homeserver, session.accessToken, spaceId, fixtures[0].roomId);

  return { fixtures, homeserver, password, roomNames, session, spaceId, username };
};

test.describe('live cinny073 persistent thread navigation', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  for (const viewport of VIEWPORTS) {
    test(`keeps Recently Opened at the bottom at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      test.slow();

      const diagnostics = attachBrowserDiagnostics(page);
      const threadCount = viewport.label === 'mobile-narrow' ? 10 : 2;
      const { fixtures, homeserver, password, roomNames, session, spaceId, username } =
        await prepareThreadFixtures(threadCount);

      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginWithPassword(page, { homeserver, username, password });

      for (const fixture of fixtures) {
        await seedRoomOverviewState({
          page,
          roomId: fixture.roomId,
          userId: session.userId,
          viewMode: 'threaded',
          filterState: createDefaultThreadFilterState(),
        });
      }
      await seedRecentThreadsState({ page, userId: session.userId, fixtures });

      await page.goto('/home/');
      await waitForLoggedInShell(page);

      const roomsCategory = page.getByTestId('room-nav-category');
      const threadsCategory = page.getByTestId('thread-nav-category');
      const recentlyOpenedCategory = page.getByTestId('recently-opened-nav-category');
      const recentlyOpenedPanel = page.getByTestId('recently-opened-nav-panel');
      await expect(roomsCategory).toBeVisible();
      await expect(threadsCategory).toBeVisible();
      await expect(recentlyOpenedCategory).toBeVisible();
      await expect(recentlyOpenedPanel).toBeVisible();
      await expect(
        page.locator('[data-testid="room-nav-category"] + [data-testid="thread-nav-category"]')
      ).toHaveCount(1);
      await expect(
        page.locator(
          '[data-testid="thread-nav-category"] + [data-testid="recently-opened-nav-panel"]'
        )
      ).toHaveCount(0);
      await expect(getRoomsCategoryButton(page)).toHaveText('Rooms');
      await expect(getThreadsCategoryButton(page)).toHaveText('Threads');
      await expect(getRecentlyOpenedCategoryButton(page)).toHaveText('Recently Opened');
      await expect(getRecentlyOpenedCategoryButton(page)).toHaveAttribute('aria-expanded', 'true');
      await waitForThreadEntries(page, fixtures);
      await waitForRecentlyOpenedEntries(page, fixtures);
      await expectRecentlyOpenedAtViewportBottom(page, viewport.height);
      if (viewport.label === 'mobile-narrow') {
        const oldestThreadButton = getRecentlyOpenedThreadButton(
          page,
          fixtures[fixtures.length - 1].rootBody
        );
        await expect
          .poll(async () => (await recentlyOpenedPanel.boundingBox())?.height ?? Infinity)
          .toBeLessThanOrEqual(viewport.height * 0.45 + 1);
        await expect(oldestThreadButton).not.toBeInViewport();
        await oldestThreadButton.scrollIntoViewIfNeeded();
        await expect(oldestThreadButton).toBeInViewport();
        await expect
          .poll(() =>
            page.getByTestId('recently-opened-nav-list').evaluate((list) => list.scrollTop)
          )
          .toBeGreaterThan(0);
      }

      await getRoomsCategoryButton(page).click();
      await expect(getRoomsCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(roomsCategory.getByText(roomNames[0], { exact: true })).toHaveCount(0);
      await waitForThreadEntries(page, fixtures);
      await waitForRecentlyOpenedEntries(page, fixtures);

      if (viewport.label === 'desktop') {
        const secondRow = getThreadRow(page, fixtures[1]);
        const pinButton = secondRow.getByRole('button', { name: 'Pin thread' });
        await pinButton.click();
        await expect(pinButton).toHaveAttribute('aria-pressed', 'true');
        await expect
          .poll(() =>
            page
              .locator('[data-sidebar-thread-root-id]')
              .first()
              .getAttribute('data-sidebar-thread-root-id')
          )
          .toBe(fixtures[1].rootId);

        await page.mouse.move(viewport.width - 20, viewport.height - 20);
        await secondRow.hover();
        const tooltip = page.getByRole('tooltip');
        await expect(tooltip).toBeVisible();
        await expect(tooltip).toContainText('Room');
        await expect(tooltip).toContainText('Agents');
        await expect(tooltip).toContainText('Messages');
        await expect(tooltip).toContainText('Last activity');
      }

      await page.screenshot({
        path: `/tmp/cinny073-thread-nav-${viewport.width}.png`,
        fullPage: true,
      });

      await getThreadsCategoryButton(page).click();
      await expect(getThreadsCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('thread-nav-list')).toHaveCount(0);
      await waitForRecentlyOpenedEntries(page, fixtures);
      await getThreadsCategoryButton(page).click();
      await waitForThreadEntries(page, fixtures);

      await getRecentlyOpenedCategoryButton(page).click();
      await expect(getRecentlyOpenedCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('recently-opened-nav-list')).toHaveCount(0);

      await page.reload();
      await waitForLoggedInShell(page);
      await expect(getRoomsCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await waitForThreadEntries(page, fixtures);
      await expect(getRecentlyOpenedCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('recently-opened-nav-list')).toHaveCount(0);
      await getRecentlyOpenedCategoryButton(page).click();
      await waitForRecentlyOpenedEntries(page, fixtures);
      if (viewport.label === 'desktop') {
        await expect(
          getThreadRow(page, fixtures[1]).getByRole('button', { name: 'Unpin thread' })
        ).toHaveAttribute('aria-pressed', 'true');
      }

      await getRoomsCategoryButton(page).click();
      await expect(getRoomsCategoryButton(page)).toHaveAttribute('aria-expanded', 'true');

      await page.goto('/direct/');
      await waitForLoggedInShell(page);
      await waitForRecentlyOpenedEntries(page, fixtures);
      await expectRecentlyOpenedAtViewportBottom(page, viewport.height);

      await page.goto(`/${encodeURIComponent(spaceId)}/`);
      await waitForLoggedInShell(page);
      await waitForRecentlyOpenedEntries(page, fixtures);
      await expectRecentlyOpenedAtViewportBottom(page, viewport.height);

      await expectNoUnexpectedBrowserDiagnostics(
        diagnostics,
        `cinny073-persistent-thread-navigation-${viewport.label}`
      );
    });
  }
});
