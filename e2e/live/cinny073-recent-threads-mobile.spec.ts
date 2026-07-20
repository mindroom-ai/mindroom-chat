import { expect, type Page, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createDefaultThreadFilterState,
  createThreadFixture,
  loginToMatrix,
  seedRoomOverviewState,
  type ThreadFixture,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;
const MOBILE_BREAKPOINT = 750;

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

const getRecentThreadButton = (page: Page, rootBody: string) =>
  page.getByTestId('recent-threads-panel').getByRole('button', {
    name: new RegExp(`Open thread: ${escapeRegex(rootBody)}`, 'i'),
  });

const getRecentThreadsToggle = (page: Page) => page.getByRole('button', { name: 'Recent Threads' });

const getRecentThreadsSeparator = (page: Page) =>
  page.getByRole('separator', { name: 'Resize recent threads panel' });

const getThreadRow = (page: Page, fixture: ThreadFixture) =>
  page.locator(`[data-sidebar-thread-root-id="${fixture.rootId}"]`);

const getRoomsCategoryButton = (page: Page) => page.locator('button[data-category-id="home|room"]');

const getThreadsCategoryButton = (page: Page) =>
  page.locator('button[data-category-id="mindroom|threads"]');

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
      localStorage.setItem(
        `recentThreadsPanelHeight:${nextUserId}`,
        JSON.stringify({ v: 1, height: 200 })
      );
      localStorage.setItem(
        `recentThreadsPanelMobileExpanded:${nextUserId}`,
        JSON.stringify({ v: 1, expanded: false })
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

const waitForRecentThreadEntries = async (page: Page, fixtures: ThreadFixture[]) => {
  await Promise.all(
    fixtures.map((fixture) =>
      expect(getRecentThreadButton(page, fixture.rootBody)).toBeVisible({ timeout: 30_000 })
    )
  );
};

const prepareThreadFixtures = async () => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const stamp = Date.now();
  const fixtures: ThreadFixture[] = [];
  const roomNames: string[] = [];

  for (let index = 0; index < 2; index += 1) {
    const roomName = `CINNY-073 ${index} ${stamp}`;
    roomNames.push(roomName);
    fixtures.push(
      await createThreadFixture(homeserver, session.accessToken, {
        name: roomName,
        topic: 'Regression fixture for peer thread navigation coverage.',
        rootBody: `CINNY-073 thread nav root ${index} ${stamp}`,
        replyBody: `CINNY-073 thread nav reply ${index} ${stamp}`,
        txnPrefix: 'cinny-073',
      })
    );
  }

  return { fixtures, homeserver, password, roomNames, session, username };
};

test.describe('live cinny073 peer thread navigation', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  for (const viewport of VIEWPORTS) {
    test(`renders Rooms and Threads as peer categories at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      test.slow();

      const diagnostics = attachBrowserDiagnostics(page);
      const { fixtures, homeserver, password, roomNames, session, username } =
        await prepareThreadFixtures();

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
      await expect(roomsCategory).toBeVisible();
      await expect(threadsCategory).toBeVisible();
      await expect(
        page.locator('[data-testid="room-nav-category"] + [data-testid="thread-nav-category"]')
      ).toHaveCount(1);
      await expect(getRoomsCategoryButton(page)).toHaveText('Rooms');
      await expect(getThreadsCategoryButton(page)).toHaveText('Threads');
      await waitForThreadEntries(page, fixtures);

      if (viewport.width <= MOBILE_BREAKPOINT) {
        const recentThreadsToggle = getRecentThreadsToggle(page);
        await expect(recentThreadsToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(page.getByTestId('recent-threads-panel')).toHaveCount(0);
        await recentThreadsToggle.click();
        await expect(recentThreadsToggle).toHaveAttribute('aria-expanded', 'true');
        await waitForRecentThreadEntries(page, fixtures);
      } else {
        await expect(page.getByRole('heading', { name: 'Recent Threads' })).toBeVisible();
        await expect(getRecentThreadsSeparator(page)).toBeVisible();
        await waitForRecentThreadEntries(page, fixtures);
      }

      await getRoomsCategoryButton(page).click();
      await expect(getRoomsCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await expect(roomsCategory.getByText(roomNames[0], { exact: true })).toHaveCount(0);
      await waitForThreadEntries(page, fixtures);

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
      await getThreadsCategoryButton(page).click();
      await waitForThreadEntries(page, fixtures);

      await page.reload();
      await waitForLoggedInShell(page);
      await expect(getRoomsCategoryButton(page)).toHaveAttribute('aria-expanded', 'false');
      await waitForThreadEntries(page, fixtures);
      if (viewport.width <= MOBILE_BREAKPOINT) {
        await expect(getRecentThreadsToggle(page)).toHaveAttribute('aria-expanded', 'true');
      }
      await waitForRecentThreadEntries(page, fixtures);
      if (viewport.label === 'desktop') {
        await expect(
          getThreadRow(page, fixtures[1]).getByRole('button', { name: 'Unpin thread' })
        ).toHaveAttribute('aria-pressed', 'true');
      }

      await getRoomsCategoryButton(page).click();
      await expect(getRoomsCategoryButton(page)).toHaveAttribute('aria-expanded', 'true');

      await expectNoUnexpectedBrowserDiagnostics(
        diagnostics,
        `cinny073-peer-thread-navigation-${viewport.label}`
      );
    });
  }
});
