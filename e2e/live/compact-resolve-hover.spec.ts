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
  matrixFetch,
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

  test('overlays on hover without moving text and resolves without opening', async ({ page }) => {
    const diagnostics = attachBrowserDiagnostics(page);
    const homeserver = getHomeserver();
    const { username, password } = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, username, password);
    const stamp = Date.now();
    const roomName = `Compact resolve hover ${stamp}`;
    const rootBody = `Resolve this compact thread ${stamp}`;
    const idleRootBody = `Leave this compact thread idle ${stamp}`;
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: roomName,
      topic: 'Live fixture for the Compact room Resolve action.',
    });
    const rootId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      { msgtype: 'm.text', body: rootBody },
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
    const idleRootId = await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      { msgtype: 'm.text', body: idleRootBody },
      'compact-resolve-idle-root'
    );
    await sendRoomMessage(
      homeserver,
      session.accessToken,
      roomId,
      {
        msgtype: 'm.text',
        body: `Idle compact reply ${stamp}`,
        'm.relates_to': buildThreadRelation(idleRootId),
      },
      'compact-resolve-idle-reply'
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
    const idleThreadCard = page.locator(`[data-thread-root-id="${idleRootId}"]`);
    const idleCardShell = idleThreadCard.locator('xpath=..');
    const idleResolveButton = idleCardShell.locator('[data-compact-thread-resolve="true"]');
    await expect(threadCard).toBeVisible({ timeout: 30_000 });
    await expect(idleThreadCard).toBeVisible({ timeout: 30_000 });
    await expect(resolveButton).toHaveCSS('opacity', '0');
    await expect(idleResolveButton).toHaveCSS('opacity', '0');

    const titleBeforeHover = await threadCard.getByText(rootBody, { exact: true }).boundingBox();
    expect(titleBeforeHover, 'title bounding box before hover').not.toBeNull();
    const restingPadding = await threadCard.evaluate((card) => {
      const style = getComputedStyle(card);
      return {
        inlineStart: Number.parseFloat(style.paddingInlineStart),
        inlineEnd: Number.parseFloat(style.paddingInlineEnd),
      };
    });
    expect(restingPadding.inlineEnd).toBe(restingPadding.inlineStart);

    await cardShell.hover();
    await expect(resolveButton).toHaveCSS('opacity', '1');
    await expect(idleResolveButton).toHaveCSS('opacity', '0');
    const titleAfterHover = await threadCard.getByText(rootBody, { exact: true }).boundingBox();
    expect(titleAfterHover, 'title bounding box after hover').not.toBeNull();
    expect(titleAfterHover!).toEqual(titleBeforeHover!);
    const actionFade = await resolveButton.evaluate((action) => {
      const style = getComputedStyle(action, '::before');
      return {
        backgroundImage: style.backgroundImage,
        width: Number.parseFloat(style.width),
      };
    });
    expect(actionFade.backgroundImage).not.toBe('none');
    expect(actionFade.width).toBeGreaterThan(0);
    const screenshotVariant = process.env.E2E_SCREENSHOT_VARIANT;
    if (screenshotVariant) {
      await page.screenshot({
        path: `ui-audit/compact-resolve-overlay-${screenshotVariant}.png`,
      });
    }

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
    const rtlFade = await resolveButton.evaluate(
      (action) => getComputedStyle(action, '::before').backgroundImage
    );
    expect(rtlFade).toContain('to left');
    const layout = await cardShell.evaluate((shell) => {
      const card = shell.querySelector<HTMLElement>('[data-thread-root-id]');
      const action = shell.querySelector<HTMLElement>('[data-compact-thread-resolve]');
      if (!card || !action) throw new Error('Compact card action layout is incomplete.');

      const shellRect = shell.getBoundingClientRect();
      const cardRect = card.getBoundingClientRect();
      const actionRect = action.getBoundingClientRect();
      const paddingInlineEnd = Number.parseFloat(getComputedStyle(card).paddingInlineEnd);
      const paddingInlineStart = Number.parseFloat(getComputedStyle(card).paddingInlineStart);
      return {
        direction: getComputedStyle(shell).direction,
        shellLeft: shellRect.left,
        shellRight: shellRect.right,
        actionLeft: actionRect.left,
        actionRight: actionRect.right,
        actionWidth: actionRect.width,
        paddingInlineEnd,
        paddingInlineStart,
        cardWidth: cardRect.width,
      };
    });

    expect(layout.direction).toBe('rtl');
    expect(layout.actionLeft).toBeGreaterThanOrEqual(layout.shellLeft);
    expect(layout.actionRight).toBeLessThanOrEqual(layout.shellRight);
    expect(layout.paddingInlineEnd).toBe(layout.paddingInlineStart);
    expect(layout.cardWidth).toBeGreaterThan(layout.actionWidth);
    expect(layout.actionLeft - layout.shellLeft).toBeLessThan(
      layout.shellRight - layout.actionRight
    );

    await resolveButton.click();
    await expect.poll(() => new URL(page.url()).searchParams.get('threadId')).toBeNull();
    const resolvedStatePath = `/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(
      'com.mindroom.thread.tags'
    )}/${encodeURIComponent(JSON.stringify([rootId, 'resolved']))}`;
    await expect
      .poll(
        async () => {
          try {
            const content = await matrixFetch<{ set_by?: string }>(homeserver, resolvedStatePath, {
              accessToken: session.accessToken,
            });
            return content.set_by;
          } catch {
            return undefined;
          }
        },
        { timeout: 30_000 }
      )
      .toBe(session.userId);
    await expect(resolveButton).toHaveCount(0);
    await expect(threadCard).toHaveAccessibleName(/Resolved by /);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'compact-resolve-hover');
  });
});
