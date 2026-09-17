import { expect, test } from '@playwright/test';
import { getHomeserver, getPrimaryCredentials, hasPrimaryCredentials } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  addRoomToSpace,
  createPrivateRoom,
  createPrivateSpace,
  loginToMatrix,
  matrixFetch,
  sendRoomMessage,
  setAccountData,
} from '../helpers/matrix';

for (const [themeId, width] of [
  ['dark-theme', 390],
  ['silver-theme', 1100],
] as const) {
  test('Recently Opened floats over every room list in ' + themeId, async ({ page }, testInfo) => {
    test.setTimeout(240_000);
    test.skip(!hasPrimaryCredentials(), 'Local Matrix credentials required');
    const homeserver = getHomeserver();
    test.skip(
      !['localhost', '127.0.0.1', '[::1]'].includes(new URL(homeserver).hostname),
      'Local fixture only'
    );
    const credentials = getPrimaryCredentials();
    const session = await loginToMatrix(homeserver, credentials.username, credentials.password);
    const readAccountData = (type: string) =>
      matrixFetch<Record<string, unknown>>(
        homeserver,
        '/user/' + encodeURIComponent(session.userId) + '/account_data/' + type,
        { accessToken: session.accessToken }
      ).catch((error: Error) => {
        if (error.message.startsWith('Matrix API 404')) return {};
        throw error;
      });
    const [savedSettings, savedDirects] = await Promise.all([
      readAccountData('io.mindroom.settings'),
      readAccountData('m.direct'),
    ]);
    const rooms: string[] = [];
    try {
      await setAccountData(
        homeserver,
        session.accessToken,
        session.userId,
        'io.mindroom.settings',
        {
          ...savedSettings,
          simpleMode: width < 750,
        }
      );
      const spaceId = await createPrivateSpace(homeserver, session.accessToken, {
        name: 'Design studio',
        topic: 'Local navigation glass fixture',
      });
      rooms.push(spaceId);
      const recent = [];
      for (let index = 1; index <= 32; index += 1) {
        // eslint-disable-next-line no-await-in-loop
        const roomId = await createPrivateRoom(homeserver, session.accessToken, {
          name: String(index).padStart(2, '0') + ' · Design studio',
          topic: 'Local navigation glass fixture',
        });
        rooms.push(roomId);
        if (index <= 16) {
          // eslint-disable-next-line no-await-in-loop
          await addRoomToSpace(homeserver, session.accessToken, spaceId, roomId);
        }
        if (index <= 10) {
          const summaryText = 'Review the next design iteration ' + index;
          // eslint-disable-next-line no-await-in-loop
          const threadId = await sendRoomMessage(homeserver, session.accessToken, roomId, {
            msgtype: 'm.text',
            body: summaryText,
          });
          // eslint-disable-next-line no-await-in-loop
          await sendRoomMessage(homeserver, session.accessToken, roomId, {
            msgtype: 'm.text',
            body: 'The updated sketches are ready to review.',
            'm.relates_to': { rel_type: 'm.thread', event_id: threadId },
          });
          recent.push({ roomId, threadId, summaryText, openedAt: Date.now() - index });
        }
      }
      await setAccountData(homeserver, session.accessToken, session.userId, 'm.direct', {
        ...savedDirects,
        '@avery:example.org': rooms.slice(17),
      });
      await page.setViewportSize({ width, height: 640 });
      await page.route('**/v1/local-mindroom/connections', (route) =>
        route.fulfill({ json: { connections: [] } })
      );
      await page.addInitScript(
        ({ selectedTheme, userId, entries }) => {
          localStorage.setItem(
            'settings',
            JSON.stringify({
              useSystemTheme: false,
              themeId: selectedTheme,
              isPeopleDrawer: false,
            })
          );
          localStorage.setItem('recentThreads:' + userId, JSON.stringify({ v: 1, entries }));
          localStorage.setItem(
            'closedNavCategories' + userId,
            JSON.stringify(['mindroom|recently-opened', 'mindroom|threads'])
          );
          localStorage.setItem('recentlyOpenedPanelHeight:' + userId, '220');
        },
        { selectedTheme: themeId, userId: session.userId, entries: recent }
      );
      await loginWithPassword(page, { homeserver, ...credentials });
      const nav = page.getByTestId('resizable-page-nav');
      const footer = nav.getByTestId('recently-opened-nav-panel');
      const toggle = footer.locator('button[data-category-id="mindroom|recently-opened"]');
      const navigate = (path: string) =>
        page.evaluate((url) => {
          window.history.pushState(null, '', url);
          window.dispatchEvent(new PopStateEvent('popstate'));
        }, path);

      for (const [path, title] of [
        ['/home/', 'Home'],
        ['/direct/', 'Direct Messages'],
        ['/' + encodeURIComponent(spaceId) + '/', 'Design studio'],
      ]) {
        // eslint-disable-next-line no-await-in-loop
        await test.step(title, async () => {
          await navigate(path);
          const header = nav.locator('header').filter({ hasText: title });
          await expect(header).toBeVisible();
          const scroll = header.locator('xpath=ancestor::*[@data-y-scrollbar-width][1]');
          for (const expanded of [false, true]) {
            if ((await toggle.getAttribute('aria-expanded')) !== String(expanded)) {
              // eslint-disable-next-line no-await-in-loop
              await toggle.click();
            }
            // eslint-disable-next-line no-await-in-loop
            await scroll.evaluate((el) => {
              el.scrollTop = Math.min(180, (el.scrollHeight - el.clientHeight) / 2);
            });
            // A real room row must paint behind the footer, inside the main scroll viewport.
            // eslint-disable-next-line no-await-in-loop
            await expect
              .poll(() =>
                footer.evaluate((el) => {
                  const bottom = el.getBoundingClientRect();
                  const viewport = el.parentElement!.querySelector('[data-y-scrollbar-width]')!;
                  const visible = viewport.getBoundingClientRect();
                  return (
                    visible.bottom >= bottom.bottom - 1 &&
                    Array.from(viewport.querySelectorAll('a')).some((link) => {
                      const row = link.getBoundingClientRect();
                      return row.top < bottom.bottom && row.bottom > bottom.top;
                    })
                  );
                })
              )
              .toBe(true);
            // eslint-disable-next-line no-await-in-loop
            const material = await footer.evaluate((el) => {
              const style = getComputedStyle(el);
              return {
                background: style.backgroundColor,
                blur: style.backdropFilter || style.getPropertyValue('-webkit-backdrop-filter'),
                border: style.borderTopWidth,
                shadow: style.boxShadow,
                divider: getComputedStyle(el, '::before').content,
              };
            });
            expect(material.background).toMatch(/\/\s*0\.\d+\)|rgba\([^)]*,\s*0\.\d+\)/);
            expect(material.blur).toContain('blur(3px)');
            expect(material.border).toBe('0px');
            expect(material.shadow).toBe('none');
            expect(material.divider).toBe('none');
            // eslint-disable-next-line no-await-in-loop
            await page.screenshot({
              path: testInfo.outputPath(title + (expanded ? '-expanded.png' : '-collapsed.png')),
              scale: 'css',
            });
            // The final room must be reachable above the panel, regardless of list ordering.
            // eslint-disable-next-line no-await-in-loop
            await scroll.evaluate((el) => {
              el.scrollTop = el.scrollHeight;
            });
            const last = scroll.getByRole('link').last();
            // eslint-disable-next-line no-await-in-loop
            await expect(last).toBeVisible();
            // eslint-disable-next-line no-await-in-loop
            await expect
              .poll(async () => {
                const row = (await last.boundingBox())!;
                return (await footer.boundingBox())!.y - (row.y + row.height);
              })
              .toBeGreaterThanOrEqual(0);
            // eslint-disable-next-line no-await-in-loop
            const href = await last.getAttribute('href');
            const target = scroll.locator(`a[href=${JSON.stringify(href)}]`);
            // Native focus scrolling must also reveal a room already obscured by glass.
            // eslint-disable-next-line no-await-in-loop
            await toggle.focus();
            // eslint-disable-next-line no-await-in-loop
            const shift = (await footer.boundingBox())!.y + 4 - (await target.boundingBox())!.y;
            // eslint-disable-next-line no-await-in-loop
            await scroll.evaluate((el, delta) => {
              el.scrollTop -= delta;
            }, shift);
            // eslint-disable-next-line no-await-in-loop
            expect((await target.boundingBox())!.y).toBeGreaterThanOrEqual(
              (await footer.boundingBox())!.y
            );
            // eslint-disable-next-line no-await-in-loop
            expect((await target.boundingBox())!.y).toBeLessThan(
              (await footer.boundingBox())!.y + (await footer.boundingBox())!.height
            );
            // eslint-disable-next-line no-await-in-loop
            await target.focus();
            // eslint-disable-next-line no-await-in-loop
            await expect
              .poll(async () => {
                const row = (await target.boundingBox())!;
                return (await footer.boundingBox())!.y - (row.y + row.height);
              })
              .toBeGreaterThanOrEqual(0);
          }
          const recentList = footer.getByTestId('recently-opened-nav-list');
          const roomScrollTop = await scroll.evaluate((el) => el.scrollTop);
          await recentList.evaluate((el) => {
            el.scrollTop = el.scrollHeight;
          });
          expect(await recentList.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
          expect(await scroll.evaluate((el) => el.scrollTop)).toBe(roomScrollTop);
          const before = (await footer.boundingBox())!.height;
          const resize = footer.getByRole('separator', { name: 'Resize Recently Opened' });
          await resize.focus();
          await page.keyboard.press('ArrowUp');
          await expect.poll(async () => (await footer.boundingBox())!.height).toBe(before + 16);
          await toggle.click();
          await expect(footer).toHaveAttribute('data-collapsed', 'true');
        });
      }
    } finally {
      const cleanup = await Promise.allSettled([
        setAccountData(
          homeserver,
          session.accessToken,
          session.userId,
          'io.mindroom.settings',
          savedSettings
        ),
        setAccountData(homeserver, session.accessToken, session.userId, 'm.direct', savedDirects),
        ...rooms.map(async (roomId) => {
          await matrixFetch(homeserver, '/rooms/' + encodeURIComponent(roomId) + '/leave', {
            method: 'POST',
            accessToken: session.accessToken,
            body: '{}',
          });
          await matrixFetch(homeserver, '/rooms/' + encodeURIComponent(roomId) + '/forget', {
            method: 'POST',
            accessToken: session.accessToken,
            body: '{}',
          });
        }),
      ]);
      expect
        .soft(
          cleanup.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
          'Could not clean up Recently Opened fixture'
        )
        .toEqual([]);
    }
  });
}
