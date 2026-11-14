import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import { createThreadFixture, loginToMatrix, seedRoomOverviewState } from '../helpers/matrix';
import { roomViewSwitch } from '../helpers/roomViewSwitch';

const hasCredentials = !!process.env.E2E_USERNAME;

const getFocusedRoomPath = (roomId: string, eventId: string) =>
  `/home/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}?focusEvent=1`;

const waitForOverviewToolbar = async (page: Page) => {
  await expect(roomViewSwitch(page)).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
};

const expectExpandedFocusedTimeline = async (page: Page, rootBody: string) => {
  await waitForOverviewToolbar(page);
  await expect(roomViewSwitch(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(
    page.getByTestId('room-virtual-inner').getByText(rootBody, { exact: true })
  ).toBeVisible({ timeout: 30_000 });
};

const createNaturalFocusedOverviewState = () => ({
  v: 1 as const,
  resolved: 'any' as const,
  snoozed: 'any' as const,
  streaming: 'any' as const,
  scheduled: 'any' as const,
  unread: 'any' as const,
  idle: 'any' as const,
  sortBy: 'natural' as const,
  sortDirection: 'desc' as const,
  tags: {},
  searchQuery: '',
  statusMode: 'and' as const,
});

test.describe('live issue-031 focused room view', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('focused room permalink can switch from expanded timeline to compact view and back', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const fixture = await createThreadFixture(homeserver, accessToken, {
      name: `ISSUE-031 Toggle ${stamp}`,
      topic: 'Live fixture for focused room compact-toggle routing.',
      fillerBody: `Toggle filler message ${stamp}`,
      rootBody: `Toggle focused root ${stamp}`,
      replyBody: `Toggle thread reply ${stamp}`,
      txnPrefix: 'issue-031',
    });

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId: fixture.roomId,
      userId,
      filterState: createNaturalFocusedOverviewState(),
    });

    await page.goto(getFocusedRoomPath(fixture.roomId, fixture.rootId));
    await expectExpandedFocusedTimeline(page, fixture.rootBody);

    await roomViewSwitch(page).click();
    await expect(roomViewSwitch(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible();
    await expect(page.locator(`[data-thread-root-id="${fixture.rootId}"]`)).toBeVisible();
    await expect(page.locator('[data-message-item]', { hasText: fixture.rootBody })).toHaveCount(0);

    await roomViewSwitch(page).click();
    await expectExpandedFocusedTimeline(page, fixture.rootBody);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'issue-031-focused-toggle');
  });
});
