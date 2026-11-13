import { expect, test, type BrowserContextOptions } from '@playwright/test';
import { getHomeserver } from '../env';
import { loginWithPassword } from '../helpers/auth';
import {
  createPrivateRoom,
  joinRoom,
  matrixFetch,
  seedRoomOverviewState,
  sendRoomMessage,
} from '../helpers/matrix';
import { WEBKIT_EXECUTABLE, launchWebKit } from '../helpers/webkit';
import { CHROMIUM_WITH_SCROLLBARS } from '../helpers/disposableAccounts';

// A limited sync replaces a small room's timeline while an older page is still running. Its
// direct relink page fails once, so it shows an empty chain and asks for history through the
// command still waiting on the old page. Once that page lands, the new chain must page itself.
// Each real back page waits at least three seconds. Gates hold the old page until both the
// limited sync and the empty view have arrived, rather than relying on the rename's timing.
const PASSWORD = 'limited-backpage-password';
const homeserver = getHomeserver();
const SHOTS = process.env.LIMITED_BACKPAGE_SHOTS;
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 800 } };
const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

type Account = { username: string; userId: string; accessToken: string };
const register = async (prefix: string, displayname: string): Promise<Account> => {
  const username = `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const result = await matrixFetch<{ user_id: string; access_token: string }>(
    homeserver,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(homeserver, `/profile/${encodeURIComponent(result.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: result.access_token,
    body: JSON.stringify({ displayname }),
  });
  return { username, userId: result.user_id, accessToken: result.access_token };
};

const gate = () => {
  let release = () => undefined as void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
};

test.use({
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

for (const engine of ['chromium', 'webkit'] as const) {
  for (const [form, options] of [
    ['desktop', DESKTOP],
    ['phone', PHONE],
  ] as const) {
    for (const theme of ['light', 'dark'] as const) {
      for (const viewMode of ['threaded', 'classic'] as const) {
        test(`old back page after limited sync: ${engine}, ${form}, ${theme}, ${viewMode}`, async ({
          browser,
          baseURL,
        }, testInfo) => {
          test.skip(engine === 'webkit' && !WEBKIT_EXECUTABLE, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE');
          test.setTimeout(90_000);
          const host = engine === 'webkit' ? await launchWebKit() : undefined;
          const context = await (host ?? browser).newContext({
            ...options,
            baseURL,
            colorScheme: theme,
            // WebKit does not route requests made through the service worker.
            serviceWorkers: 'block',
          });
          const oldPage = gate();
          const backgroundPage = gate();
          const firstPageStarted = gate();
          const directPageFailed = gate();
          const syncReleased = gate();
          let holdSync = false;
          let heldSyncs = 0;
          const pages: { kind: string; completed: boolean }[] = [];
          const activeTokens = new Map<string, number>();
          const oldTokens = new Set<string>();
          let renameRequested = false;
          let releasingOld = false;
          let rowsAfterDirectFailure: number | undefined;
          const duplicates: string[] = [];
          try {
            const page = await context.newPage();
            const viewer = await register('limited_reader', 'Name Before');
            const helper = await register('limited_member', 'Room Member');
            await Promise.all(
              Array.from({ length: 25 }, (_, index) =>
                createPrivateRoom(homeserver, viewer.accessToken, {
                  name: `Project ${index + 1}`,
                  topic: 'Planning and release updates',
                })
              )
            );
            const roomId = await createPrivateRoom(homeserver, viewer.accessToken, {
              name: 'History recovery',
              topic: 'Planning notes and a release checklist',
              invite: [helper.userId],
            });
            // More hidden history than the startup sync's 20 events: the fresh client cannot
            // already know the room's start, so opening this short visible timeline must page.
            await Promise.all(
              Array.from({ length: 30 }, (_, index) =>
                matrixFetch(
                  homeserver,
                  `/rooms/${encodeURIComponent(roomId)}/send/io.mindroom.test.hidden/seed-${index}`,
                  {
                    method: 'PUT',
                    accessToken: viewer.accessToken,
                    body: JSON.stringify({ index }),
                  }
                )
              )
            );
            await joinRoom(homeserver, helper.accessToken, roomId);
            await Promise.all(
              Array.from({ length: 12 }, (_, index) =>
                sendRoomMessage(homeserver, helper.accessToken, roomId, {
                  msgtype: 'm.text',
                  body: `Planning note ${
                    index + 1
                  }: review the schedule and confirm the remaining checklist items.\nKeep the release notes ready for the next review.`,
                })
              )
            );
            const messageId = await sendRoomMessage(homeserver, viewer.accessToken, roomId, {
              msgtype: 'm.text',
              body: 'The release checklist is in the pinned notes. Check each item before publishing.',
            });
            await page.goto('/login');
            await page.evaluate((themeId) => {
              const settings: Record<string, unknown> = JSON.parse(
                localStorage.getItem('settings') ?? '{}'
              );
              localStorage.setItem(
                'settings',
                JSON.stringify({ ...settings, useSystemTheme: false, themeId })
              );
            }, `${theme}-theme`);
            await seedRoomOverviewState({ page, roomId, userId: viewer.userId, viewMode });
            await page.route(/\/_matrix\/client\/v\d+\/rooms\/[^/]+\/messages\?/, async (route) => {
              const url = new URL(route.request().url());
              if (
                !decodeURIComponent(url.pathname).includes(roomId) ||
                url.searchParams.get('dir') !== 'b'
              ) {
                await route.continue();
                return;
              }
              const token = url.searchParams.get('from') ?? '';
              if (!renameRequested) oldTokens.add(token);
              const kind = !token
                ? 'background'
                : releasingOld
                ? 'recovery'
                : oldTokens.has(token)
                ? 'old'
                : 'direct-failure';
              const entry = {
                kind,
                completed: false,
              };
              pages.push(entry);
              if (kind === 'recovery' && activeTokens.has(token))
                duplicates.push(`page ${pages.length}`);
              activeTokens.set(token, (activeTokens.get(token) ?? 0) + 1);
              try {
                // The independent offline sweep starts without a token and owns its cursor.
                // Keep it pending so it cannot heal or race the foreground pagination.
                if (kind === 'background') await backgroundPage.promise;
                if (kind === 'old') {
                  firstPageStarted.release();
                  await oldPage.promise;
                }
                await new Promise((resolve) => {
                  setTimeout(resolve, 3_000);
                });
                if (kind === 'direct-failure') {
                  await route.fulfill({
                    status: 403,
                    json: { errcode: 'M_FORBIDDEN', error: 'One failed history page' },
                  });
                  directPageFailed.release();
                } else {
                  await route.fulfill({ response: await route.fetch() });
                }
                entry.completed = true;
              } finally {
                const remaining = (activeTokens.get(token) ?? 1) - 1;
                if (remaining === 0) activeTokens.delete(token);
                else activeTokens.set(token, remaining);
              }
            });
            // While `holdSync` is set, the client's next /sync waits (see the limited sync below).
            await page.route(/\/_matrix\/client\/v\d+\/sync\?/, async (route) => {
              if (holdSync) {
                heldSyncs += 1;
                await syncReleased.promise;
              }
              await route.continue();
            });
            await loginWithPassword(page, {
              homeserver,
              username: viewer.username,
              password: PASSWORD,
            });
            await seedRoomOverviewState({ page, roomId, userId: viewer.userId, viewMode });
            // Stay in the same client: a full navigation would cancel its pending old page,
            // and WebKit can finish background cache loading before that navigation starts.
            await page.evaluate((path) => {
              window.history.pushState(null, '', path);
              window.dispatchEvent(new PopStateEvent('popstate'));
            }, `/home/${encodeURIComponent(roomId)}`);
            const message = page.locator(`[data-message-id="${messageId}"]`);
            await expect(message).toContainText('Name Before', { timeout: 30_000 });
            const timeline = page.getByTestId('room-virtual-inner');
            // Visit both physical ends to request older history in either row order. This
            // makes the old page explicit instead of depending on the opening fill's timing.
            const scrollRoom = (edge: 'start' | 'end') =>
              timeline.evaluate((inner, end) => {
                let scroller = inner.parentElement;
                while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY))
                  scroller = scroller.parentElement;
                if (!scroller) throw new Error('No room scroller');
                const previous = {
                  top: scroller.scrollTop,
                  max: scroller.scrollHeight - scroller.clientHeight,
                };
                scroller.scrollTop = end === 'start' ? 0 : scroller.scrollHeight;
                scroller.dispatchEvent(new Event('scroll'));
                return previous;
              }, edge);
            const reader = await scrollRoom('start');
            await page.waitForTimeout(100);
            await scrollRoom('end');
            await page.waitForTimeout(100);
            await expect
              .poll(() => pages.filter((entry) => entry.kind === 'old').length)
              .toBeGreaterThan(0);
            await firstPageStarted.promise;
            // The other end may have unmounted the target row. Restore the reader's end
            // through the scroller before asking for that row again.
            await scrollRoom(reader.top > reader.max / 2 ? 'end' : 'start');
            await expect(message).toBeVisible();
            // The actual tokened command must be running before the limited sync arrives.
            await page.waitForTimeout(600);
            renameRequested = true;
            // The limited sync: the client's next /sync waits while the room gets more events
            // than one sync brings (20), so the server marks the room's timeline limited. A
            // profile change alone no longer does (Tuwunel v1.9.4-mindroom.27 keeps the join
            // position). One event wakes the sync the client is waiting on, so the next one waits.
            const sendHidden = (txnId: string) =>
              matrixFetch(
                homeserver,
                `/rooms/${encodeURIComponent(roomId)}/send/io.mindroom.test.hidden/${txnId}`,
                { method: 'PUT', accessToken: viewer.accessToken, body: JSON.stringify({ txnId }) }
              );
            holdSync = true;
            await sendHidden('wake');
            await expect.poll(() => heldSyncs).toBeGreaterThan(0);
            await matrixFetch(
              homeserver,
              `/profile/${encodeURIComponent(viewer.userId)}/displayname`,
              {
                method: 'PUT',
                accessToken: viewer.accessToken,
                body: JSON.stringify({ displayname: 'Name After' }),
              }
            );
            await matrixFetch(
              homeserver,
              `/user/${encodeURIComponent(viewer.userId)}/account_data/io.mindroom.client.settings`,
              {
                method: 'PUT',
                accessToken: viewer.accessToken,
                body: JSON.stringify({ version: 1, hideMembershipEvents: true }),
              }
            );
            await Promise.all(Array.from({ length: 25 }, (_, index) => sendHidden(`gap-${index}`)));
            holdSync = false;
            syncReleased.release();
            await expect
              .poll(() => pages.some((entry) => entry.kind === 'direct-failure'), {
                timeout: 20_000,
              })
              .toBe(true);
            await directPageFailed.promise;
            await expect(page.getByText(/Room Member joined the room/)).toHaveCount(0);
            // Row retention or a cache hydration may keep the message mounted through the
            // failed direct page. The required behavior is recovery after the old page lands,
            // not that the fixed client first draws an empty room.
            rowsAfterDirectFailure = await message.count();
            expect(
              pages.filter((entry) => entry.kind === 'old').every((entry) => !entry.completed),
              'old pages still pending when direct page fails'
            ).toBe(true);
            releasingOld = true;
            oldPage.release();
            try {
              await expect(message).toContainText('Name After', { timeout: 12_000 });
              await expect(message).toBeVisible();
              await expect(page.getByText(/Room Member joined the room/)).toHaveCount(0);
              // An unchanged token or the end of history stops pagination. No further sync or
              // interaction is needed; the command still deduplicates concurrent requests.
              await expect
                .poll(() =>
                  pages
                    .filter((entry) => entry.kind !== 'background')
                    .every((entry) => entry.completed)
                )
                .toBe(true);
              const completedPages = pages.length;
              await page.waitForTimeout(3_500);
              expect(pages.length, 'pagination stops after room history is linked').toBe(
                completedPages
              );
              expect(duplicates, 'no simultaneous requests for one back token').toEqual([]);
              if (SHOTS)
                await page.screenshot({
                  path: `${SHOTS}/${engine}-${form}-${theme}-${viewMode}.png`,
                });
            } finally {
              await testInfo.attach('back-page-order', {
                body: JSON.stringify({ pages, duplicates }),
                contentType: 'application/json',
              });
            }
          } finally {
            await testInfo.attach('all-back-pages', {
              body: JSON.stringify({ pages, duplicates, rowsAfterDirectFailure }),
              contentType: 'application/json',
            });
            oldPage.release();
            backgroundPage.release();
            syncReleased.release();
            await Promise.all(context.pages().map((page) => page.unrouteAll({ behavior: 'wait' })));
            await context.close();
            await host?.close();
          }
        });
      }
    }
  }
}
