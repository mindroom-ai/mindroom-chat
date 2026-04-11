import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials } from '../env';
import { expectLoggedInShellStable, loginWithPassword } from '../helpers/auth';
import {
  attachBrowserDiagnostics,
  expectNoUnexpectedBrowserDiagnostics,
} from '../helpers/browserDiagnostics';
import {
  createPrivateRoom,
  createThreadFixture,
  loginToMatrix,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';

const hasCredentials = !!process.env.E2E_USERNAME;

test.describe('live CINNY-001 last open thread restore', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('re-entering a room restores its last open thread', async ({ page }) => {
    test.slow();

    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomWithThread = await createThreadFixture(homeserver, session.accessToken, {
      name: `CINNY-001 Thread ${stamp}`,
      topic: 'Live fixture for restoring the last open thread on room entry.',
      rootBody: `CINNY-001 root ${stamp}`,
      replyBody: `CINNY-001 reply ${stamp}`,
      txnPrefix: 'cinny-001',
    });
    const fallbackRoomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: `CINNY-001 Fallback ${stamp}`,
      topic: 'Secondary room used while leaving and re-entering the thread room.',
    });
    const fallbackRoomBody = `CINNY-001 fallback ${stamp}`;
    const fallbackRoomTopic = 'Secondary room used while leaving and re-entering the thread room.';

    await sendRoomMessage(
      homeserver,
      session.accessToken,
      fallbackRoomId,
      {
        msgtype: 'm.text',
        body: fallbackRoomBody,
      },
      'cinny-001'
    );

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId: roomWithThread.roomId,
      userId: session.userId,
      viewMode: 'normal',
    });
    await seedRoomOverviewState({
      page,
      roomId: fallbackRoomId,
      userId: session.userId,
      viewMode: 'normal',
    });

    await page.goto(
      `/home/${encodeURIComponent(roomWithThread.roomId)}?threadId=${encodeURIComponent(
        roomWithThread.rootId
      )}`
    );

    await expect(page.getByText('Thread View')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText(roomWithThread.replyBody)).toBeVisible({ timeout: 30_000 });

    await page.goto(`/home/${encodeURIComponent(fallbackRoomId)}`);
    await expect(page.getByRole('button', { name: fallbackRoomTopic })).toBeVisible({
      timeout: 30_000,
    });

    await page.goto(`/home/${encodeURIComponent(roomWithThread.roomId)}`);

    await expect
      .poll(() => new URL(page.url()).searchParams.get('threadId'), {
        timeout: 10_000,
        message: 'Room re-entry should restore the previously open thread',
      })
      .toBe(roomWithThread.rootId);

    await expect(page.getByText('Thread View')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(roomWithThread.replyBody)).toBeVisible({ timeout: 10_000 });

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'cinny-001-last-open-thread');
  });
});
