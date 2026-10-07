import { expect, test, type Locator, type Page } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, setFullInterfaceModeForSession } from '../helpers/auth';
import {
  createPrivateRoom,
  loginToMatrix,
  matrixFetch,
  sendRoomMessage,
  sendStateEvent,
} from '../helpers/matrix';

const ROOM_NAME = 'Protocol design';
const SUMMARY =
  'Error model and protocol design for state preparation under correlated drive errors';

// Playwright's click scrolls the target into view first, and for a button in
// the sticky banner that scrolls the thread toward the banner's place in the
// flow. Press where the button is instead, as a finger or pointer would.
const press = async (page: Page, touch: boolean, button: Locator) => {
  const box = (await button.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (touch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
};

const openRoute = (page: Page, url: string) =>
  page.evaluate((path) => {
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, url);

// The thread banner stays above the messages while they scroll. Collapsed it
// keeps one row (back, title, More) on every screen, and the choice persists.
for (const viewport of [
  { name: 'desktop', width: 1280, height: 800, touch: false },
  { name: 'phone', width: 390, height: 844, touch: true },
]) {
  test.describe(viewport.name, () => {
    test.use({ hasTouch: viewport.touch, isMobile: viewport.touch });

    test('collapses the thread banner to one row and keeps it collapsed', async ({
      page,
    }, testInfo) => {
      test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      // The local Matrix fixture has no provisioning service.
      await page.route('**/v1/local-mindroom/connections', (route) =>
        route.fulfill({ json: { connections: [] } })
      );
      await page.addInitScript(() => {
        // Seed once, so a reload keeps what the page itself saved.
        if (localStorage.getItem('settings')) return;
        localStorage.setItem(
          'settings',
          JSON.stringify({ useSystemTheme: false, themeId: 'light-theme', isPeopleDrawer: false })
        );
      });
      const homeserver = getHomeserver();
      const credentials = getPrimaryCredentials();
      const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
      const restoreSettings = await setFullInterfaceModeForSession(homeserver, session);
      const roomId = await createPrivateRoom(homeserver, session.accessToken, {
        name: ROOM_NAME,
      }).catch(async (error) => {
        await restoreSettings();
        throw error;
      });
      try {
        const rootId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
          msgtype: 'm.text',
          body: 'Can the current method handle correlated drive errors?',
        });
        const inThread = {
          rel_type: 'm.thread',
          event_id: rootId,
          is_falling_back: true,
          'm.in_reply_to': { event_id: rootId },
        };
        await sendRoomMessage(homeserver, session.accessToken, roomId, {
          msgtype: 'm.notice',
          body: SUMMARY,
          'io.mindroom.thread_summary': {
            version: 1,
            summary: SUMMARY,
            generated_at: Date.now(),
            message_count: 4,
          },
          'm.relates_to': inThread,
        });
        const tagged = { set_by: session.userId, set_at: new Date().toISOString() };
        await sendStateEvent(
          homeserver,
          session.accessToken,
          roomId,
          'com.mindroom.thread.tags',
          rootId,
          { tags: { protocol: tagged, research: tagged } }
        );
        for (let index = 1; index <= 14; index += 1) {
          // eslint-disable-next-line no-await-in-loop
          await sendRoomMessage(homeserver, session.accessToken, roomId, {
            msgtype: 'm.text',
            body: `Step ${index}: Treat the correlated errors as one shared rotation per round.\nMeasuring at the end with post-selection gives the same answer when only the accepted runs matter.`,
            'm.relates_to': inThread,
          });
        }

        await loginWithPassword(page, { homeserver, ...credentials });
        const threadPath = `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(
          rootId
        )}`;
        await openRoute(page, threadPath);
        const banner = page.locator('[data-thread-context-banner]');
        await expect(banner.locator('[data-thread-context-summary]')).toHaveText(SUMMARY);
        const scroll = page.locator('[data-thread-count]').locator('xpath=../..');
        const bottomGap = () =>
          scroll.evaluate(
            (element) => element.scrollHeight - element.scrollTop - element.clientHeight
          );
        await expect.poll(bottomGap).toBeLessThan(2);
        const tag = banner.getByText('protocol', { exact: true }).filter({ visible: true });
        await expect(tag).toHaveCount(1);
        const resolve = banner.getByRole('button', { name: 'Resolve', includeHidden: true });
        await expect(resolve).toBeVisible();
        await page.screenshot({ path: testInfo.outputPath('expanded.png') });
        // The two tags share a row; on a phone it is a row of their own.
        const research = banner.getByText('research', { exact: true }).filter({ visible: true });
        const tagTop = async (pill: Locator) => (await pill.boundingBox())!.y;
        expect(Math.abs((await tagTop(tag)) - (await tagTop(research)))).toBeLessThan(2);
        // A titled thread drops the "Thread View" eyebrow.
        await expect(banner.getByText('Thread View', { exact: true })).toHaveCount(0);
        const expandedHeight = (await banner.boundingBox())!.height;

        await press(
          page,
          viewport.touch,
          banner.getByRole('button', { name: 'Hide thread details' })
        );
        const show = banner.getByRole('button', { name: 'Show thread details' });
        await expect(show).toBeVisible();
        await expect(resolve).toBeAttached();
        await expect(resolve).toBeHidden();
        await expect(tag).toHaveCount(0);
        await expect(banner.locator('[data-thread-context-summary]')).toBeVisible();
        await expect(banner.getByRole('button', { name: 'Thread options' })).toBeVisible();
        await expect.poll(async () => (await banner.boundingBox())!.height).toBeLessThanOrEqual(48);
        // The reader stays at the latest message while the banner shrinks.
        await expect.poll(bottomGap).toBeLessThan(2);
        await expect(page.getByText('Step 14:', { exact: false })).toBeInViewport();
        await page.screenshot({ path: testInfo.outputPath('collapsed.png') });
        await testInfo.attach('heights', {
          body: JSON.stringify(
            { expandedHeight, collapsedHeight: (await banner.boundingBox())!.height },
            null,
            2
          ),
          contentType: 'application/json',
        });

        // Tags and resolving stay reachable from the actions menu.
        await banner.getByRole('button', { name: 'Thread options' }).click();
        const menu = page.getByRole('menu', { name: 'Thread options' });
        await expect(menu.locator('[data-thread-action="tags"]')).toBeVisible();
        await expect(menu.locator('[data-thread-action="resolve"]')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(menu).toBeHidden();

        // The choice holds for the next thread view, also after a reload.
        await page.reload();
        await expect(banner.locator('[data-thread-context-summary]')).toHaveText(SUMMARY);
        await expect(show).toBeVisible();
        await expect(resolve).toBeHidden();

        await press(page, viewport.touch, show);
        await expect(resolve).toBeVisible();
        await expect(tag).toHaveCount(1);
        await expect(banner.getByRole('button', { name: 'Hide thread details' })).toBeVisible();
      } finally {
        await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/leave`, {
          method: 'POST',
          accessToken: session.accessToken,
          body: '{}',
        }).catch(() => undefined);
        await restoreSettings();
      }
    });
  });
}
