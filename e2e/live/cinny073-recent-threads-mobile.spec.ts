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
const SEEDED_DESKTOP_HEIGHT = 400;

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

const getRecentThreadsStaticHeading = (page: Page) =>
  page.locator('h2', { hasText: 'Recent Threads' });

const getRecentThreadsToggle = (page: Page) =>
  page.getByRole('button', { name: 'Recent Threads' });

const getRecentThreadsSeparator = (page: Page) =>
  page.getByRole('separator', { name: 'Resize recent threads panel' });

const getRecentThreadButton = (page: Page, rootBody: string) =>
  page.getByRole('button', {
    name: new RegExp(`Open thread: ${escapeRegex(rootBody)}`, 'i'),
  });

const seedRecentThreadsState = async ({
  page,
  userId,
  fixtures,
  desktopHeight = SEEDED_DESKTOP_HEIGHT,
  mobileExpanded = false,
}: {
  page: Page;
  userId: string;
  fixtures: ThreadFixture[];
  desktopHeight?: number;
  mobileExpanded?: boolean;
}) => {
  const openedAtBase = Date.now();
  const entries = fixtures.map((fixture, index) => ({
    roomId: fixture.roomId,
    threadId: fixture.rootId,
    openedAt: openedAtBase - index,
    summaryText: fixture.rootBody,
  }));

  await page.evaluate(
    ({ nextUserId, nextEntries, nextDesktopHeight, nextMobileExpanded }) => {
      localStorage.setItem(
        `recentThreads:${nextUserId}`,
        JSON.stringify({ v: 1, entries: nextEntries })
      );
      localStorage.setItem(
        `recentThreadsPanelHeight:${nextUserId}`,
        JSON.stringify({ v: 1, height: nextDesktopHeight })
      );
      localStorage.setItem(
        `recentThreadsPanelMobileExpanded:${nextUserId}`,
        JSON.stringify({ v: 1, expanded: nextMobileExpanded })
      );
    },
    {
      nextUserId: userId,
      nextEntries: entries,
      nextDesktopHeight: desktopHeight,
      nextMobileExpanded: mobileExpanded,
    }
  );
};

const clearLastOpenThreadState = async ({
  page,
  userId,
  roomId,
}: {
  page: Page;
  userId: string;
  roomId: string;
}) => {
  await page.evaluate(
    ({ nextUserId, nextRoomId }) => {
      const storeKey = `lastOpenThread${nextUserId}`;
      const current = JSON.parse(localStorage.getItem(storeKey) ?? '{}') as Record<string, string>;
      if (!(nextRoomId in current)) return;
      delete current[nextRoomId];
      localStorage.setItem(storeKey, JSON.stringify(current));
    },
    {
      nextUserId: userId,
      nextRoomId: roomId,
    }
  );
};

const waitForRecentThreadEntries = async (page: Page, fixtures: ThreadFixture[]) => {
  await Promise.all(
    fixtures.map((fixture) =>
      expect(getRecentThreadButton(page, fixture.rootBody)).toBeVisible({
        timeout: 30_000,
      })
    )
  );
};

const expectThreadRoute = async (page: Page, fixture: ThreadFixture) => {
  await expect(page.getByText('Thread View')).toBeVisible({ timeout: 30_000 });
  await expect.poll(() => new URL(page.url()).pathname).toContain(encodeURIComponent(fixture.roomId));
  await expect.poll(() => new URL(page.url()).searchParams.get('threadId')).toBe(fixture.rootId);
};

const dragRecentThreadsSeparator = async (page: Page, deltaY: number) => {
  const separator = getRecentThreadsSeparator(page);
  const box = await separator.boundingBox();
  if (!box) {
    throw new Error('Recent threads separator bounding box not available');
  }

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;

  await page.mouse.move(centerX, centerY);
  await page.mouse.down();
  await page.mouse.move(centerX, centerY + deltaY);
  await page.mouse.up();
};

const prepareRecentThreadFixtures = async () => {
  const homeserver = getHomeserver();
  const { username, password } = getPrimaryCredentials();
  const session = await loginToMatrix(homeserver, username, password);
  const stamp = Date.now();

  const fixtures = await Promise.all(
    Array.from({ length: 2 }, async (_value, index) =>
      createThreadFixture(homeserver, session.accessToken, {
        name: `CINNY-073 ${index} ${stamp}`,
        topic: 'Regression fixture for recent-thread mobile layout coverage.',
        rootBody: `CINNY-073 recent thread root ${index} ${stamp}`,
        replyBody: `CINNY-073 recent thread reply ${index} ${stamp}`,
        txnPrefix: 'cinny-073',
      })
    )
  );

  return {
    fixtures,
    homeserver,
    password,
    session,
    username,
  };
};

test.describe('live cinny073 recent threads mobile shell', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  for (const viewport of VIEWPORTS) {
    test(`renders and persists the recent-threads shell at ${viewport.width}x${viewport.height}`, async ({
      page,
    }) => {
      test.slow();

      const diagnostics = attachBrowserDiagnostics(page);
      const { fixtures, homeserver, password, session, username } =
        await prepareRecentThreadFixtures();

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

      await seedRecentThreadsState({
        page,
        userId: session.userId,
        fixtures,
      });

      // Sidebar assertions must happen on /home/, not on a room route, because MobileFriendlyPageNav
      // intentionally route-gates page-nav content away from room views.
      await page.goto('/home/');
      await waitForLoggedInShell(page);

      if (viewport.width <= MOBILE_BREAKPOINT) {
        const toggle = getRecentThreadsToggle(page);

        await expect(getRecentThreadsStaticHeading(page)).toHaveCount(0);
        await expect(toggle).toHaveCount(1);
        await expect(page.locator('button[aria-expanded]').filter({ hasText: 'Recent Threads' })).toHaveCount(1);
        await expect(toggle).toHaveAttribute('aria-expanded', 'false');
        await expect(getRecentThreadButton(page, fixtures[0].rootBody)).toHaveCount(0);
        await page.screenshot({
          path: `/tmp/cinny073-${viewport.width}-collapsed.png`,
          fullPage: true,
        });

        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await waitForRecentThreadEntries(page, fixtures);
        await page.screenshot({
          path: `/tmp/cinny073-${viewport.width}-expanded.png`,
          fullPage: true,
        });

        await page.reload();
        await waitForLoggedInShell(page);
        await expect(getRecentThreadsToggle(page)).toHaveAttribute('aria-expanded', 'true');
        await waitForRecentThreadEntries(page, fixtures);

        await getRecentThreadButton(page, fixtures[0].rootBody).click();
        await expectThreadRoute(page, fixtures[0]);

        if (viewport.width === 480) {
          // Bare `/home/` now intentionally restores the last open thread on startup,
          // so clear that single-room restore entry before validating the landscape
          // page-nav layout.
          await clearLastOpenThreadState({
            page,
            userId: session.userId,
            roomId: fixtures[0].roomId,
          });
          await page.goto('/home/');
          await expect(getRecentThreadsToggle(page)).toBeVisible({ timeout: 30_000 });
          await page.setViewportSize({ width: 800, height: 480 });

          const separator = getRecentThreadsSeparator(page);
          await expect(separator).toBeVisible({ timeout: 30_000 });
          await expect
            .poll(async () => Number(await separator.getAttribute('aria-valuenow')))
            .toBeLessThanOrEqual(Math.round(480 * 0.6));
          await page.screenshot({
            path: `/tmp/cinny073-${viewport.width}-rotated.png`,
            fullPage: true,
          });
        }
      } else {
        await expect(getRecentThreadsStaticHeading(page)).toBeVisible({ timeout: 30_000 });

        const separator = getRecentThreadsSeparator(page);
        await expect(separator).toBeVisible({ timeout: 30_000 });
        await waitForRecentThreadEntries(page, fixtures);

        const initialHeight = Number(await separator.getAttribute('aria-valuenow'));
        await dragRecentThreadsSeparator(page, -60);
        await expect
          .poll(async () => Number(await getRecentThreadsSeparator(page).getAttribute('aria-valuenow')))
          .toBeGreaterThan(initialHeight);
        await page.screenshot({
          path: `/tmp/cinny073-${viewport.width}-resized.png`,
          fullPage: true,
        });

        const resizedHeight = Number(
          await getRecentThreadsSeparator(page).getAttribute('aria-valuenow')
        );
        await page.reload();
        await waitForLoggedInShell(page);
        await expect(getRecentThreadsSeparator(page)).toHaveAttribute(
          'aria-valuenow',
          `${resizedHeight}`
        );
      }

      await expectNoUnexpectedBrowserDiagnostics(
        diagnostics,
        `cinny073-recent-threads-mobile-${viewport.label}`
      );
    });
  }
});
