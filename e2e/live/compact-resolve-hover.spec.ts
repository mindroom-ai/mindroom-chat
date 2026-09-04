import { expect, test } from '@playwright/test';
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

const buildThreadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

test.describe('compact Resolve action', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('reveals on hover and focus, stays in its RTL lane, and resolves without opening', async ({
    page,
  }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomName = `Compact resolve hover ${stamp}`;
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: roomName,
      topic: 'Live fixture for the Compact room Resolve action.',
    });
    const rootId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      { msgtype: 'm.text', body: `Resolve this compact thread ${stamp}` },
      'compact-resolve-hover-root'
    );
    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: `Compact resolve reply ${stamp}`,
        'm.relates_to': buildThreadRelation(rootId),
      },
      'compact-resolve-hover-reply'
    );

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    await seedRoomOverviewState({
      page,
      roomId,
      userId: session.userId,
      viewMode: 'compact',
      filterState: createDefaultThreadFilterState(),
    });

    const roomLink = page.getByRole('link', { name: roomName }).first();
    await expect(roomLink).toBeVisible({ timeout: 30_000 });
    await roomLink.click();

    const threadCard = page.locator(`[data-thread-root-id="${rootId}"]`);
    const cardShell = threadCard.locator('xpath=..');
    const resolveButton = cardShell.locator('[data-compact-thread-resolve="true"]');
    await expect(threadCard).toBeVisible({ timeout: 30_000 });
    await expect(resolveButton).toHaveCSS('opacity', '0');

    await cardShell.hover();
    await expect(resolveButton).toHaveCSS('opacity', '1');

    await page.mouse.move(0, 0);
    await expect(resolveButton).toHaveCSS('opacity', '0');
    await threadCard.focus();
    await page.keyboard.press('Tab');
    await expect(resolveButton).toBeFocused();
    await expect(resolveButton).toHaveCSS('opacity', '1');

    await page.setViewportSize({ width: 420, height: 800 });
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
    });
    const layout = await cardShell.evaluate((shell) => {
      const card = shell.querySelector<HTMLElement>('[data-thread-root-id]');
      const action = shell.querySelector<HTMLElement>('[data-compact-thread-resolve]');
      if (!card || !action) throw new Error('Compact card action layout is incomplete.');

      const shellRect = shell.getBoundingClientRect();
      const actionRect = action.getBoundingClientRect();
      return {
        direction: getComputedStyle(shell).direction,
        shellLeft: shellRect.left,
        shellRight: shellRect.right,
        actionLeft: actionRect.left,
        actionRight: actionRect.right,
        actionWidth: actionRect.width,
        paddingInlineEnd: Number.parseFloat(getComputedStyle(card).paddingInlineEnd),
      };
    });

    expect(layout.direction).toBe('rtl');
    expect(layout.actionLeft).toBeGreaterThanOrEqual(layout.shellLeft);
    expect(layout.actionRight).toBeLessThanOrEqual(layout.shellRight);
    expect(layout.paddingInlineEnd).toBeGreaterThan(layout.actionWidth);

    await resolveButton.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('threadId')).toBeNull();
    await expect(resolveButton).toHaveCount(0);
    await expect(threadCard).toHaveAccessibleName(/Resolved by /);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'compact-resolve-hover');
  });
});
