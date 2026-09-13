import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createHiddenOverviewFilterState,
  createThreadFixture,
  loginToMatrix,
  seedRoomOverviewState,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

const getFocusedRoomPath = (roomId: string, eventId: string) =>
  `/home/${encodeURIComponent(roomId)}/${encodeURIComponent(eventId)}?focusEvent=1`;

const waitForOverviewToolbar = async (page: Page) => {
  await expect(page.locator('[data-room-thread-overview="true"]')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
};

const expectExpandedFocusedTimeline = async (page: Page, rootBody: string) => {
  await waitForOverviewToolbar(page);
  await expect(page.getByRole('button', { name: 'Expanded view' })).toBeVisible();
  await expect(page.getByText('No threads match current filters.')).toHaveCount(0);
  await expect(page.getByText(rootBody)).toBeVisible({ timeout: 30_000 });
};

test.describe('live cinny-031 focused room view', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('focused room permalink shows the message timeline even when overview filters hide the thread', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const fixture = await createThreadFixture(homeserver, accessToken, {
      name: `CINNY-031 Timeline ${stamp}`,
      topic: 'Live fixture for focused room timeline routing.',
      fillerBody: `Timeline filler message ${stamp}`,
      rootBody: `Timeline focused root ${stamp}`,
      replyBody: `Timeline thread reply ${stamp}`,
      txnPrefix: 'cinny-031',
    });

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId: fixture.roomId,
      userId,
      filterState: createHiddenOverviewFilterState(),
    });

    await page.goto(getFocusedRoomPath(fixture.roomId, fixture.rootId));

    await expectExpandedFocusedTimeline(page, fixture.rootBody);
    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-031-focused-timeline');
  });

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
      name: `CINNY-031 Toggle ${stamp}`,
      topic: 'Live fixture for focused room compact-toggle routing.',
      fillerBody: `Toggle filler message ${stamp}`,
      rootBody: `Toggle focused root ${stamp}`,
      replyBody: `Toggle thread reply ${stamp}`,
      txnPrefix: 'cinny-031',
    });

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId: fixture.roomId,
      userId,
      filterState: createHiddenOverviewFilterState(),
    });

    await page.goto(getFocusedRoomPath(fixture.roomId, fixture.rootId));
    await expectExpandedFocusedTimeline(page, fixture.rootBody);

    await page.getByRole('button', { name: 'Expanded view' }).click();
    await expect(page.getByRole('button', { name: 'Compact view' })).toBeVisible();
    await expect(page.getByText('No threads match current filters.')).toBeVisible();
    await expect(page.getByText(fixture.rootBody)).toHaveCount(0);

    await page.getByRole('button', { name: 'Compact view' }).click();
    await expectExpandedFocusedTimeline(page, fixture.rootBody);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-031-focused-toggle');
  });
});
