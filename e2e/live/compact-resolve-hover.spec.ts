import { expect, test, type Locator } from '@playwright/test';
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

const expectActionOpacity = async (action: Locator, opacity: number) => {
  await expect
    .poll(() =>
      action.evaluate((element) => {
        let effectiveOpacity = 1;
        for (let current: Element | null = element; current; current = current.parentElement) {
          effectiveOpacity *= Number(getComputedStyle(current).opacity);
        }
        return effectiveOpacity;
      })
    )
    .toBe(opacity);
};

const buildThreadRelation = (rootId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: rootId },
});

test.describe('compact Resolve action', () => {
  test.skip(!hasCredentials, 'E2E_USERNAME / E2E_PASSWORD not set');

  test('overlays on hover without moving text and resolves without opening', async ({
    page,
    hasTouch,
  }) => {
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

    // Keep relative-time labels stable while comparing exact hover geometry.
    await page.clock.setFixedTime(new Date());

    await loginWithPassword(page, { homeserver, username, password });
    await expectLoggedInShellStable(page);
    if (hasTouch) {
      await page.evaluate(() => localStorage.setItem('i18nextLng', 'nl'));
      await page.reload();
    }
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
    const activateAction = (action: Locator) => (hasTouch ? action.tap() : action.click());
    await expect(threadCard).toBeVisible({ timeout: 30_000 });
    await expect(idleThreadCard).toBeVisible({ timeout: 30_000 });
    await expect(resolveButton).toHaveText(hasTouch ? 'Oplossen' : 'Resolve');
    await expectActionOpacity(resolveButton, 0);
    await expectActionOpacity(idleResolveButton, 0);

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
    await expectActionOpacity(resolveButton, 1);
    await expectActionOpacity(idleResolveButton, 0);
    const titleAfterHover = await threadCard.getByText(rootBody, { exact: true }).boundingBox();
    expect(titleAfterHover, 'title bounding box after hover').not.toBeNull();
    expect(titleAfterHover!).toEqual(titleBeforeHover!);
    const actionFade = await resolveButton.evaluate((action) => {
      const style = getComputedStyle(action.parentElement!, '::before');
      return {
        backgroundImage: style.backgroundImage,
        width: Number.parseFloat(style.width),
        insetInlineStart: Number.parseFloat(style.insetInlineStart),
      };
    });
    expect(actionFade.backgroundImage).not.toBe('none');
    expect(actionFade.width).toBeGreaterThan(0);
    expect(actionFade.insetInlineStart).toBe(-actionFade.width);
    const screenshotVariant = process.env.E2E_SCREENSHOT_VARIANT;
    if (screenshotVariant) {
      await page.screenshot({
        path: `ui-audit/compact-resolve-overlay-${screenshotVariant}.png`,
      });
    }

    await page.mouse.move(0, 0);
    await expectActionOpacity(resolveButton, 0);
    await threadCard.focus();
    await page.keyboard.press('Tab');
    await expect(resolveButton).toBeFocused();
    await expectActionOpacity(resolveButton, 1);

    await page.setViewportSize({ width: 420, height: 800 });
    await page.evaluate(() => {
      document.documentElement.dir = 'rtl';
    });
    const rtlFade = await resolveButton.evaluate(
      (action) => getComputedStyle(action.parentElement!, '::before').backgroundImage
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

    // Disabled styles must not reveal an idle action, including on touch layouts.
    await idleResolveButton.evaluate(async (button: HTMLButtonElement) => {
      button.disabled = true;
      await Promise.all(button.getAnimations().map((animation) => animation.finished));
    });
    await expectActionOpacity(idleResolveButton, 0);
    await idleResolveButton.evaluate((button: HTMLButtonElement) => {
      button.disabled = false;
    });

    // Keep the first save pending while resolving another thread.
    let releaseSave!: () => void;
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const tagWrites: string[] = [];
    await page.route('**/state/com.mindroom.thread.tags/**', async (route) => {
      if (route.request().method() !== 'PUT') {
        await route.continue();
        return;
      }
      const stateKey = decodeURIComponent(
        new URL(route.request().url()).pathname.split('/').pop()!
      );
      tagWrites.push(stateKey);
      if (stateKey === JSON.stringify([rootId, 'resolved'])) await saveGate;
      await route.continue();
    });
    await activateAction(resolveButton);
    await expect.poll(() => tagWrites.length).toBe(1);
    await expectActionOpacity(idleResolveButton, 0);
    await expect(idleResolveButton).toBeEnabled();
    if (hasTouch) await idleThreadCard.focus();
    else await idleCardShell.hover();
    await expectActionOpacity(idleResolveButton, 1);
    await activateAction(idleResolveButton);
    await expect
      .poll(() => tagWrites)
      .toEqual([JSON.stringify([rootId, 'resolved']), JSON.stringify([idleRootId, 'resolved'])]);
    releaseSave();
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
    await expect(threadCard).toHaveAccessibleName(hasTouch ? /Opgelost door / : /Resolved by /);

    await expectNoUnexpectedBrowserDiagnostics(diagnostics, 'compact-resolve-hover');
  });
});
