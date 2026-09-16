import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  loginToMatrix,
  matrixFetch,
  setAccountData,
} from '../helpers/matrix';

for (const [themeId, width, simpleMode] of [
  ['dark-theme', 390, true],
  ['silver-theme', 1100, false],
] as const) {
  test(`space header overlays scrolling rooms in ${themeId}`, async ({ page }, testInfo) => {
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    const homeserver = getHomeserver();
    test.skip(
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
      'Local fixture only'
    );
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const savedSettings = await matrixFetch<Record<string, unknown>>(
      homeserver,
      `/user/${encodeURIComponent(session.userId)}/account_data/io.mindroom.settings`,
      { accessToken: session.accessToken }
    ).catch((error: Error) => {
      if (error.message.startsWith('Matrix API 404')) return {};
      throw error;
    });
    const createdRooms: string[] = [];
    try {
      await setAccountData(
        homeserver,
        session.accessToken,
        session.userId,
        'io.mindroom.settings',
        { ...savedSettings, simpleMode }
      );
      const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
        name: 'MindRoom',
      });
      createdRooms.push(spaceId);
      for (let index = 1; index <= 32; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        const roomId = await createPrivateRoom(homeserver, session.accessToken, {
          name: `${String(index).padStart(2, '0')} · ${
            ['🌿 Garden plans', '🎨 Design studio', '📚 Reading room', '💡 New ideas'][index % 4]
          }`,
        });
        createdRooms.push(roomId);
        // eslint-disable-next-line no-await-in-loop
        await addRoomToSpace(homeserver, session.accessToken, spaceId, roomId);
      }

      await page.setViewportSize({ width, height: 844 });
      await page.route('**/v1/local-mindroom/connections', (route) =>
        route.fulfill({ json: { connections: [] } })
      );
      await page.addInitScript((selectedTheme) => {
        const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
        localStorage.setItem(
          'settings',
          JSON.stringify({ ...settings, useSystemTheme: false, themeId: selectedTheme })
        );
      }, themeId);
      await loginWithPassword(page, { homeserver, ...credentials });
      const synced = page.waitForResponse(
        (response) => response.url().includes('/sync?') && response.status() === 200
      );
      await page.goto(`/${encodeURIComponent(spaceId)}/`);
      await synced;
      const panel = page.getByTestId('resizable-page-nav');
      const header = panel.locator('header').filter({ hasText: 'MindRoom' });
      const scroller = panel.locator('[data-y-scrollbar-width]').first();
      const firstRoom = panel.getByRole('link', { name: '01 · 🎨 Design studio', exact: true });
      await expect(firstRoom).toBeVisible();
      await expect(page.getByText('Catching up...', { exact: true })).toHaveCount(0, {
        timeout: 60_000,
      });
      await expect(page.getByRole('button', { name: 'Add account', exact: true })).toHaveCount(
        simpleMode ? 0 : 1
      );
      // Read both rectangles in one snapshot: sync status can move the entire
      // application between separate Playwright calls without moving this header.
      const headerOffset = () =>
        panel.evaluate((element) => {
          const title = element.querySelector('header')!;
          const scroll = element.querySelector('[data-y-scrollbar-width]')!;
          return title.getBoundingClientRect().top - scroll.getBoundingClientRect().top;
        });
      const roomOffset = (name: string) =>
        panel.evaluate((element, roomName) => {
          const title = element.querySelector('header')!.getBoundingClientRect();
          const link = Array.from(element.querySelectorAll('a')).find(
            (node) => node.textContent?.trim() === roomName
          )!;
          return link.getBoundingClientRect().top - title.bottom;
        }, name);
      expect(await roomOffset('01 · 🎨 Design studio')).toBeGreaterThan(0);
      // The old flex layout clips all rooms below the header. The scroller must
      // instead extend behind it, while the header stays fixed and interactive.
      await expect.poll(headerOffset).toBeCloseTo(0, 0);
      await expect(header).toHaveCSS('box-shadow', 'none');
      await expect(header).toHaveCSS('background-image', 'none');
      for (const side of ['top', 'right', 'bottom', 'left']) {
        // eslint-disable-next-line no-await-in-loop
        await expect(header).toHaveCSS(`border-${side}-width`, '0px');
      }
      const material = await header.evaluate((element) => {
        const style = getComputedStyle(element);
        const alpha = Number(style.backgroundColor.split('/')[1]?.replace(')', '').trim());
        return {
          translucent: alpha > 0 && alpha < 1,
          blur: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'),
        };
      });
      expect(material.translucent).toBe(true);
      expect(material.blur).not.toBe('none');
      expect(material.blur).not.toContain('url(');
      await page.screenshot({ path: testInfo.outputPath('space-header-top.png') });

      await scroller.evaluate((element) => {
        element.scrollTop = 210;
      });
      await expect.poll(headerOffset).toBeCloseTo(0, 0);
      await expect
        .poll(() =>
          panel.evaluate((element) => {
            const top = element.querySelector('header')!.getBoundingClientRect();
            return Array.from(element.querySelectorAll('a')).some((link) => {
              const bounds = link.getBoundingClientRect();
              return bounds.top < top.y + top.height && bounds.bottom > top.y;
            });
          })
        )
        .toBe(true);
      // Paint order matters: the title owns the hit target over the passing rooms.
      expect(
        await header.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(bounds.x + 20, bounds.y + 20));
        })
      ).toBe(true);
      await page.screenshot({ path: testInfo.outputPath('space-header-scrolled.png') });
      await header.getByRole('button').click();
      await expect(page.getByRole('button', { name: 'Space Settings', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');

      // Use an interior row so bottom clamping cannot hide a missing header inset.
      const interiorRoom = panel.getByRole('link', { name: '05 · 🎨 Design studio', exact: true });
      await interiorRoom.evaluate((element) => element.scrollIntoView({ block: 'start' }));
      await expect.poll(() => roomOffset('05 · 🎨 Design studio')).toBeCloseTo(0, 0);

      await scroller.evaluate((element) => {
        element.scrollTop = element.scrollHeight;
      });
      const lastRoom = panel.getByRole('link', { name: '32 · 🌿 Garden plans', exact: true });
      await expect(lastRoom).toBeVisible();
      expect(await roomOffset('32 · 🌿 Garden plans')).toBeGreaterThan(0);
      await expect.poll(headerOffset).toBeCloseTo(0, 0);

      // Collapsing the list must not leave a header-sized blank scroll region.
      await scroller.evaluate((element) => {
        element.scrollTop = 0;
      });
      await panel.getByRole('button', { name: 'Rooms', exact: true }).click();
      await expect
        .poll(() => scroller.evaluate((element) => element.scrollHeight - element.clientHeight))
        .toBeLessThanOrEqual(1);
      await expect(panel.getByRole('link', { name: 'Lobby', exact: true })).toBeVisible();
    } finally {
      await setAccountData(
        homeserver,
        session.accessToken,
        session.userId,
        'io.mindroom.settings',
        savedSettings
      );
      for (const roomId of createdRooms.reverse()) {
        // eslint-disable-next-line no-await-in-loop
        await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/leave`, {
          method: 'POST',
          accessToken: session.accessToken,
          body: '{}',
        });
        // eslint-disable-next-line no-await-in-loop
        await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/forget`, {
          method: 'POST',
          accessToken: session.accessToken,
          body: '{}',
        });
      }
    }
  });
}
