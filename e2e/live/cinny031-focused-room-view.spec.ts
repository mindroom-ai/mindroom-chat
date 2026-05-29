import { expect, test, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createHiddenOverviewFilterState,
  createPrivateRoom,
  createThreadFixture,
  loginToMatrix,
  sendRoomMessage,
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
  await expect(page.getByRole('button', { name: 'Threaded view' })).toBeVisible();
  await expect(page.getByText(rootBody)).toBeVisible({ timeout: 30_000 });
};

const createNaturalFocusedOverviewState = () => ({
  v: 1 as const,
  resolved: 'any' as const,
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

const getMessageOrderIndex = async (page: Page, body: string) => {
  const item = page.locator('[data-message-item]', { hasText: body }).first();
  await expect(item).toBeVisible({ timeout: 30_000 });
  const index = await item.getAttribute('data-message-item');
  expect(index).not.toBeNull();
  return Number(index);
};

const waitForDistinctServerTimestamp = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 25);
  });

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
      filterState: createNaturalFocusedOverviewState(),
    });

    await page.goto(getFocusedRoomPath(fixture.roomId, fixture.rootId));
    await expectExpandedFocusedTimeline(page, fixture.rootBody);

    await page.getByRole('button', { name: 'Compact view' }).click();
    await expect(page.getByRole('button', { name: 'Compact view' })).toBeVisible();
    await expect(page.locator('[data-compact-room-view="true"]')).toBeVisible();
    await expect(page.locator(`[data-thread-root-id="${fixture.rootId}"]`)).toBeVisible();
    await expect(page.locator('[data-message-item]', { hasText: fixture.rootBody })).toHaveCount(0);

    await page.getByRole('button', { name: 'Threaded view' }).click();
    await expectExpandedFocusedTimeline(page, fixture.rootBody);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-031-focused-toggle');
  });

  test('focused room permalink keeps visible zero-reply roots in overview order while cycling sort modes', async ({
    page,
  }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const { accessToken, userId } = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomId = await createPrivateRoom(homeserver, accessToken, {
      name: `CINNY-031 Natural ${stamp}`,
      topic: 'Live fixture for focused room natural ordering.',
    });
    const fillerBody = `Natural filler message ${stamp}`;
    const firstRootBody = `Natural zero-reply root A ${stamp}`;
    const secondRootBody = `Natural zero-reply root B ${stamp}`;

    await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: fillerBody,
      },
      'cinny-031'
    );
    await waitForDistinctServerTimestamp();
    await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: firstRootBody,
      },
      'cinny-031'
    );
    await waitForDistinctServerTimestamp();
    const secondRootId = await sendRoomMessage(
      homeserver,
      accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: secondRootBody,
      },
      'cinny-031'
    );

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId,
      userId,
      filterState: createNaturalFocusedOverviewState(),
    });

    await page.goto(getFocusedRoomPath(roomId, secondRootId));
    await waitForOverviewToolbar(page);
    await expect(page.getByRole('button', { name: 'Threaded view' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Threads in timeline order' })).toBeVisible();
    await expect(page.getByText('Showing all 3 threads.')).toBeVisible();
    await expect(page.getByText(fillerBody)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(firstRootBody)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(secondRootBody)).toBeVisible({ timeout: 30_000 });

    const naturalFillerIndex = await getMessageOrderIndex(page, fillerBody);
    const naturalFirstIndex = await getMessageOrderIndex(page, firstRootBody);
    const naturalSecondIndex = await getMessageOrderIndex(page, secondRootBody);
    expect(naturalFillerIndex).toBeLessThan(naturalFirstIndex);
    expect(naturalFirstIndex).toBeLessThan(naturalSecondIndex);

    await page.getByRole('button', { name: 'Threads in timeline order' }).click();
    await expect(
      page.getByRole('button', { name: 'Sort threads by last reply, newest first' })
    ).toBeVisible();

    const descFillerIndex = await getMessageOrderIndex(page, fillerBody);
    const descFirstIndex = await getMessageOrderIndex(page, firstRootBody);
    const descSecondIndex = await getMessageOrderIndex(page, secondRootBody);
    expect(descSecondIndex).toBeLessThan(descFirstIndex);
    expect(descFirstIndex).toBeLessThan(descFillerIndex);

    await page.getByRole('button', { name: 'Sort threads by last reply, newest first' }).click();
    await expect(
      page.getByRole('button', { name: 'Sort threads by last reply, oldest first' })
    ).toBeVisible();

    const ascFillerIndex = await getMessageOrderIndex(page, fillerBody);
    const ascFirstIndex = await getMessageOrderIndex(page, firstRootBody);
    const ascSecondIndex = await getMessageOrderIndex(page, secondRootBody);
    expect(ascFillerIndex).toBeLessThan(ascFirstIndex);
    expect(ascFirstIndex).toBeLessThan(ascSecondIndex);

    await page.getByRole('button', { name: 'Sort threads by last reply, oldest first' }).click();
    await expect(page.getByRole('button', { name: 'Threads in timeline order' })).toBeVisible();

    const naturalAgainFillerIndex = await getMessageOrderIndex(page, fillerBody);
    const naturalAgainFirstIndex = await getMessageOrderIndex(page, firstRootBody);
    const naturalAgainSecondIndex = await getMessageOrderIndex(page, secondRootBody);
    expect(naturalAgainFillerIndex).toBeLessThan(naturalAgainFirstIndex);
    expect(naturalAgainFirstIndex).toBeLessThan(naturalAgainSecondIndex);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-031-focused-natural-order');
  });
});
