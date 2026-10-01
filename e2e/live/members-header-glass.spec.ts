import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword, setFullInterfaceModeForSession } from '../helpers/auth';
import { expectFloatingNavHeader } from '../helpers/glassVisual';
import { expectInsetScrollbar } from '../helpers/insetScrollbar';
import { createPrivateRoom, joinRoom, loginToMatrix, matrixFetch } from '../helpers/matrix';

for (const themeId of ['dark-theme', 'silver-theme']) {
  test(`Members header stays flat above the scrolling list in ${themeId}`, async ({
    page,
  }, testInfo) => {
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    const homeserver = getHomeserver();
    test.skip(
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
      'Disposable local fixture only'
    );
    const credentials = getPrimaryCredentials();
    const viewer = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const runId = randomUUID().slice(0, 8);
    const registered: Array<{ access_token: string; user_id: string; password: string }> = [];
    let roomId: string | undefined;
    let restoreSettings: (() => Promise<unknown>) | undefined;
    try {
      // Wait for every registration before teardown, including partially failed setup.
      const registrations = await Promise.allSettled(
        Array.from({ length: 29 }, async (_, index) => {
          const password = randomUUID();
          const person = await matrixFetch<{ access_token: string; user_id: string }>(
            homeserver,
            '/register',
            {
              method: 'POST',
              body: JSON.stringify({
                username: `glass_${runId}_${index}`,
                password,
                auth: { type: 'm.login.dummy' },
              }),
            }
          );
          registered.push({ ...person, password });
          await matrixFetch(
            homeserver,
            `/profile/${encodeURIComponent(person.user_id)}/displayname`,
            {
              method: 'PUT',
              accessToken: person.access_token,
              body: JSON.stringify({
                displayname: `Studio member ${String(index + 1).padStart(2, '0')}`,
              }),
            }
          );
          return person;
        })
      );
      const people = registrations.map((result) => {
        if (result.status === 'rejected') throw result.reason;
        return result.value;
      });
      roomId = await createPrivateRoom(homeserver, viewer.accessToken, {
        name: 'Design studio',
        topic: 'Shared projects and creative ideas',
        invite: people.map((person) => person.user_id),
      });
      restoreSettings = await setFullInterfaceModeForSession(homeserver, viewer);
      const joins = await Promise.allSettled(
        people.slice(0, -1).map((person) => joinRoom(homeserver, person.access_token, roomId!))
      );
      joins.forEach((result) => {
        if (result.status === 'rejected') throw result.reason;
      });
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.addInitScript(
        ({ theme, userId }) => {
          localStorage.setItem(`mindroom.members.width:${userId}`, JSON.stringify(380));
          const settings = JSON.parse(localStorage.getItem('settings') ?? '{}');
          localStorage.setItem(
            'settings',
            JSON.stringify({
              ...settings,
              useSystemTheme: false,
              themeId: theme,
              isPeopleDrawer: false,
            })
          );
        },
        { theme: themeId, userId: viewer.userId }
      );
      await loginWithPassword(page, { homeserver, ...credentials });
      await page.evaluate((id) => {
        window.history.pushState(null, '', `/home/${encodeURIComponent(id)}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, roomId);
      await page
        .getByRole('button', { name: 'Show Members', exact: true })
        .click({ timeout: 15000 });
      const header = page.locator('header').filter({
        has: page.getByRole('button', { name: 'Invite people', exact: true }),
      });
      await expect(header.getByText('29 Members', { exact: true })).toBeVisible();
      const drawer = page.getByTestId('resizable-members-panel');
      const scroll = drawer.locator('[data-y-scrollbar-width]');
      await expect(
        drawer.getByRole('button', { name: 'Studio member 01', exact: true })
      ).toBeVisible();
      await expect(page.getByText('Catching up...', { exact: true })).toHaveCount(0, {
        timeout: 60000,
      });
      await header.click({ position: { x: 10, y: 10 } });
      await page.mouse.move(500, 600);
      await expect(page.getByRole('tooltip')).toHaveCount(0);
      await drawer.screenshot({ path: testInfo.outputPath('members-initial.png') });
      await scroll.evaluate((element) => {
        element.scrollTop = 290;
      });
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(250);
      await drawer.screenshot({ path: testInfo.outputPath('members-scrolled.png') });
      await expectFloatingNavHeader(header);
      const bounds = (await header.boundingBox())!;
      await page.mouse.move(bounds.x + 10, bounds.y + 10);
      await expectFloatingNavHeader(header);
      expect(
        await header.evaluate((element) => getComputedStyle(element, '::before').display)
      ).toBe('none');
      // Actual member rows occupy the backdrop; the sticky header retains pointer hits.
      expect(
        await drawer.locator('button[data-user-id]').evaluateAll(
          (buttons, top) =>
            buttons.some((button) => {
              const row = button.getBoundingClientRect();
              return row.y < top.y + top.height && row.bottom > top.y;
            }),
          bounds
        )
      ).toBe(true);
      expect(
        await header.evaluate((element) => {
          const box = element.getBoundingClientRect();
          return element.contains(document.elementFromPoint(box.x + 10, box.y + 10));
        })
      ).toBe(true);
      const toTop = drawer.getByRole('button', { name: 'Scroll to Top', exact: true });
      await expect(toTop).toBeVisible();
      expect((await toTop.boundingBox())!.y).toBeGreaterThanOrEqual(bounds.y + bounds.height);
      await expectInsetScrollbar(page, scroll, header);
      await scroll.getByRole('scrollbar').press('End');
      await expect(
        drawer.getByRole('button', { name: 'Studio member 28', exact: true })
      ).toBeInViewport({ ratio: 1 });
      await toTop.click();
      await expect.poll(() => scroll.evaluate((element) => element.scrollTop)).toBeLessThan(1);
      await header.getByRole('button', { name: '1 Invited', exact: true }).click();
      await expect(
        drawer.getByRole('button', { name: 'Studio member 29', exact: true })
      ).toBeVisible();
      await expectFloatingNavHeader(header);
      await header.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(header).toHaveCount(0);
    } finally {
      const cleanup = await Promise.allSettled([
        restoreSettings?.(),
        (async () => {
          if (!roomId) return;
          await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/leave`, {
            method: 'POST',
            accessToken: viewer.accessToken,
            body: '{}',
          });
          await matrixFetch(homeserver, `/rooms/${encodeURIComponent(roomId)}/forget`, {
            method: 'POST',
            accessToken: viewer.accessToken,
            body: '{}',
          });
        })(),
        ...registered.map((person) =>
          matrixFetch(homeserver, '/account/deactivate', {
            method: 'POST',
            accessToken: person.access_token,
            body: JSON.stringify({
              erase: true,
              auth: {
                type: 'm.login.password',
                identifier: { type: 'm.id.user', user: person.user_id },
                password: person.password,
              },
            }),
          })
        ),
      ]);
      expect
        .soft(
          cleanup.filter((result) => result.status === 'rejected'),
          'Fixture cleanup'
        )
        .toEqual([]);
    }
  });
}
