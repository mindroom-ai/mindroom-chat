import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import { createPrivateRoom, loginToMatrix, matrixFetch, sendRoomMessage } from '../helpers/matrix';

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
]) {
  test(`thread messages scroll behind the pinned summary at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    await page.setViewportSize(viewport);
    // The local Matrix fixture has no provisioning service.
    await page.route('**/v1/local-mindroom/connections', (route) =>
      route.fulfill({ json: { connections: [] } })
    );
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem(
        'settings',
        JSON.stringify({ useSystemTheme: false, themeId: 'dark-theme', isPeopleDrawer: false })
      );
    });
    const homeserver = getHomeserver();
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const roomId = await createPrivateRoom(homeserver, session.accessToken, {
      name: 'Design review',
      topic: 'Local glass layout fixture',
    });
    try {
      const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.text',
        body: 'Review the floating thread summary',
      });
      await sendRoomMessage(homeserver, session.accessToken, roomId, {
        msgtype: 'm.notice',
        body: 'Keep the conversation visible beneath the thread controls',
        'io.mindroom.thread_summary': {
          version: 1,
          summary: 'Keep the conversation visible beneath the thread controls',
          generated_at: Date.now(),
          message_count: 1,
        },
        'm.relates_to': {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        },
      });
      for (let index = 1; index <= 16; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        await sendRoomMessage(homeserver, session.accessToken, roomId, {
          msgtype: 'm.text',
          body: `Design note ${index}: Messages should flow underneath the translucent summary.\nKeep the controls clear and easy to reach while reading the conversation.`,
          'm.relates_to': {
            rel_type: 'm.thread',
            event_id: rootId,
            is_falling_back: true,
            'm.in_reply_to': { event_id: rootId },
          },
        });
      }
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.evaluate((url) => {
        window.history.pushState(null, '', url);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(rootId)}`);
      const banner = page.locator('[data-thread-context-summary]').locator('xpath=../../../..');
      const scroll = page.locator('[data-thread-count]').locator('xpath=../..');
      await expect(banner).toBeVisible();
      await expect(page.getByText('Design note 16:', { exact: false })).toBeInViewport();
      const initialBanner = await banner.boundingBox();
      const viewportBox = await scroll.boundingBox();
      expect(initialBanner).not.toBeNull();
      expect(viewportBox).not.toBeNull();
      expect(viewportBox!.y, 'the message viewport extends behind the summary').toBeLessThan(
        initialBanner!.y
      );
      await expect
        .poll(() =>
          scroll.evaluate((element) =>
            Number.parseFloat(getComputedStyle(element).scrollPaddingTop)
          )
        )
        .toBeGreaterThan(initialBanner!.height);

      await page.mouse.move(
        viewportBox!.x + viewportBox!.width / 2,
        initialBanner!.y + initialBanner!.height + 60
      );
      await page.mouse.wheel(0, -10000);
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(2);
      const firstMessage = page.locator('[data-message-item="0"]');
      await expect(firstMessage).toBeVisible();
      const firstBox = await firstMessage.boundingBox();
      expect(firstBox!.y, 'the first message can be read below the summary').toBeGreaterThanOrEqual(
        initialBanner!.y + initialBanner!.height
      );

      await page.mouse.wheel(0, 380);
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(250);
      await expect
        .poll(async () => (await banner.boundingBox())!.y)
        .toBeCloseTo(initialBanner!.y, 0);
      const rowsBehindBanner = await page.locator('[data-message-item]').evaluateAll(
        (rows, box) =>
          rows.filter((row) => {
            const rect = row.getBoundingClientRect();
            return rect.top < box.y + box.height && rect.bottom > box.y;
          }).length,
        initialBanner!
      );
      expect(rowsBehindBanner, 'rendered messages continue behind the glass').toBeGreaterThan(0);
      await page.mouse.move(viewport.width - 2, viewport.height - 2);
      await page.screenshot({ path: testInfo.outputPath('thread-overlay.png') });

      const expansionButton = page.getByRole('button', { name: /^\[[+-]all\]$/ });
      const expansionLabel = await expansionButton.textContent();
      await expansionButton.click();
      await expect(expansionButton).not.toHaveText(expansionLabel!);
      await banner.getByRole('button', { name: 'Resolve', exact: true }).click();
      await expect(banner.getByRole('button', { name: 'Resolved', exact: true })).toBeVisible();
      if (viewport.width === 390) {
        await page.setViewportSize({ width: 390, height: 568 });
        await expect(
          banner.getByRole('button', { name: 'Resolved', exact: true })
        ).toBeInViewport();
      }
      await page.mouse.move(viewportBox!.x + viewportBox!.width / 2, 300);
      await page.mouse.wheel(0, -10000);
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(2);
      await expect
        .poll(async () => {
          const headerBox = (await banner.boundingBox())!;
          const rootBox = (await firstMessage.boundingBox())!;
          return rootBox.y - headerBox.y - headerBox.height;
        })
        .toBeGreaterThanOrEqual(0);
      const targetMessage = page.locator('[data-message-item="4"]');
      await targetMessage.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await expect
        .poll(async () => {
          const headerBox = (await banner.boundingBox())!;
          const targetBox = (await targetMessage.boundingBox())!;
          return targetBox.y - headerBox.y - headerBox.height;
        })
        .toBeGreaterThanOrEqual(0);
      await banner.getByRole('button').first().click();
      await expect(page.locator('[data-thread-context-summary]')).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally {
      await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/leave`, {
        method: 'POST',
        accessToken: session.accessToken,
        body: '{}',
      });
      await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/forget`, {
        method: 'POST',
        accessToken: session.accessToken,
        body: '{}',
      });
    }
  });
}
