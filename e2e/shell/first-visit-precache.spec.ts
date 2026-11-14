import { expect, test, type BrowserContext, type Frame, type Page } from '@playwright/test';
import { waitForLoggedInShell } from '../helpers/auth';
import { buildLoginPath } from '../env';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// What a first visit downloads for offline use, on a production build (`scripts/e2e-slot.sh
// --preview`; the dev server's worker precaches nothing and the spec skips there). The worker
// precaches the shell and the signed-in start only, with the images its chunks import
// (scripts/precache-plan.mjs); chunks loaded on demand are kept the first time a page loads them
// (src/sw/swRuntimeAssets.ts). A part whose chunk is missing offline shows a message with Retry
// (src/app/lib/lazyPart.tsx, src/app/shell/PartUnavailable.tsx).
// Set LAZY_RETRY_SHOTS=<directory> to also save the board's Retry view on a desktop and a phone, in
// light and dark.
const SHOTS = process.env.LAZY_RETRY_SHOTS;
const PASSWORD = 'first-visit-precache-password';
const GREETING = 'Offline starts need no more than this';

test.use({ serviceWorkers: 'allow' });

const matrixPost = async <T>(path: string, body: unknown, token?: string): Promise<T> => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    method: path.includes('/send/') ? 'PUT' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  expect(response.ok, `${path} answered ${response.status}`).toBe(true);
  return (await response.json()) as T;
};

/** A new account with one room that holds one message; answers the room ID. */
const accountWithRoom = async (username: string): Promise<string> => {
  const { access_token: token } = await matrixPost<{ access_token: string }>('/register', {
    username,
    password: PASSWORD,
    auth: { type: 'm.login.dummy' },
  });
  const { room_id: roomId } = await matrixPost<{ room_id: string }>(
    '/createRoom',
    { name: 'Precache Check', preset: 'private_chat' },
    token
  );
  await matrixPost(
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/precache-${Date.now()}`,
    { msgtype: 'm.text', body: GREETING },
    token
  );
  return roomId;
};

/** The paths each cache of this origin holds, by cache name. */
const cachedPaths = (page: Page): Promise<Record<string, string[]>> =>
  page.evaluate(async () => {
    const result: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      // eslint-disable-next-line no-await-in-loop
      const requests = await (await caches.open(name)).keys();
      result[name] = requests.map((request) => new URL(request.url).pathname);
    }
    return result;
  });

const precached = async (page: Page): Promise<string[]> =>
  Object.entries(await cachedPaths(page)).find(([name]) =>
    name.startsWith('workbox-precache')
  )?.[1] ?? [];

const keptAtRuntime = async (page: Page): Promise<string[]> =>
  (await cachedPaths(page))['mindroom-build-assets'] ?? [];

// The composer's button; a message's own reaction button comes earlier on the page.
const emojiButton = (page: Page) => page.getByRole('button', { name: 'Emoji', exact: true }).last();
const anEmoji = (page: Page) => page.getByRole('button', { name: /^grinning face/i }).first();
const retryButton = (page: Page) => page.getByRole('button', { name: 'Retry', exact: true });

const expectRoom = async (page: Page): Promise<void> => {
  // The Compact view shows a thread's first message as its title and its preview.
  await expect(page.getByText(GREETING, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Unexpected Application Error!')).toHaveCount(0);
};

// Offline for the page and its service worker. Playwright's offline mode does not stop the worker's
// own fetches everywhere: on macOS (Chrome for Testing 145) they still reach the server while the
// worker reports navigator.onLine false. So every request that leaves the browser fails as well.
const goOffline = async (context: BrowserContext): Promise<void> => {
  await context.setOffline(true);
  await context.route('**/*', (route) => route.abort('internetdisconnected'));
};

const goOnline = async (context: BrowserContext): Promise<void> => {
  await context.unrouteAll();
  await context.setOffline(false);
};

const reloadOffline = async (context: BrowserContext, page: Page): Promise<void> => {
  await goOffline(context);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectRoom(page);
};

test(
  'a first visit precaches the signed-in start and keeps on-demand chunks once they load',
  { tag: '@webkit' },
  async ({ browserName, context, page }) => {
    test.setTimeout(240_000);
    test.skip(
      !(await disposableHomeserverIsUp()),
      `No homeserver at ${HOMESERVER}; run \`just hs-up\``
    );
    const username = `precache_${Date.now().toString(36)}`;
    const roomId = await accountWithRoom(username);

    // Every build file the page asks for, from the first request on.
    const requested = new Set<string>();
    page.on('request', (request) => {
      const url = new URL(request.url());
      if (url.pathname.startsWith('/assets/')) requested.add(url.pathname);
    });

    await page.goto(buildLoginPath(HOMESERVER));
    await expect(page.locator('input[name="usernameInput"]')).toBeVisible({ timeout: 60_000 });
    await expect
      .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 120_000 })
      .toBe(true);
    const shell = await precached(page);
    test.skip(
      !shell.includes('/index.html'),
      'Needs a production build: scripts/e2e-slot.sh <n> --preview'
    );

    // The precache holds the crypto wasm and the startup images (the logo), and no on-demand chunk,
    // thinking mark (an image shown only while an agent thinks) or sound.
    expect(shell.some((path) => path.endsWith('.wasm'))).toBe(true);
    expect(shell.some((path) => /^\/assets\/mindroom-logo-[^/]+\.png$/.test(path))).toBe(true);
    expect(
      shell.filter((path) =>
        /^\/assets\/(?:emoji|EmojiBoard|katex|KaTeX_|RoomCall|ComputerScreen|thinking-mark)/.test(
          path
        )
      )
    ).toEqual([]);
    expect(shell.filter((path) => /\.(?:ogg|mp3)$/.test(path))).toEqual([]);

    await page.locator('input[name="usernameInput"]').fill(username);
    await page.locator('input[name="passwordInput"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await waitForLoggedInShell(page);
    await page.goto(`/home/${encodeURIComponent(roomId)}`);
    await expectRoom(page);

    // Every script, style sheet, font and wasm the signed-in start loaded comes from the precache, so
    // the same start works offline.
    const startup = [...requested].filter((path) => /\.(?:js|css|woff2|wasm)$/.test(path));
    expect(startup.length).toBeGreaterThan(0);
    expect(startup.filter((path) => !shell.includes(path))).toEqual([]);

    // Offline, the emoji board was never loaded: it says so, offers Retry, and the app stays up;
    // Retry while still offline keeps the page. Chromium starts the page again offline first. In
    // Playwright's WebKit an offline reload never reaches the service worker
    // (offline-room-content.live.spec.ts skips WebKit for the same reason), and its routes do not
    // see the worker's requests but do fail navigations, so there the page goes offline as it is,
    // through offline mode alone, and the last offline step runs in Chromium only.
    const chromium = browserName === 'chromium';
    if (chromium) await reloadOffline(context, page);
    else await context.setOffline(true);
    const failedLoad = page.waitForEvent('console', {
      predicate: (message) => message.text().includes('[lazy-part] could not load'),
      timeout: 30_000,
    });
    await emojiButton(page).click();
    await failedLoad;
    await expect(
      page.getByText("This couldn't load. Check your connection and try again.")
    ).toBeVisible();
    await expect(anEmoji(page)).toHaveCount(0);
    // Escape closes the view as it closes the board, and the next open shows it again.
    await page.keyboard.press('Escape');
    await expect(retryButton(page)).toHaveCount(0);
    await expect(emojiButton(page)).toHaveAttribute('aria-pressed', 'false');
    await emojiButton(page).click();
    await expect(retryButton(page)).toBeVisible();
    if (SHOTS) {
      // The board opens again at each size, as it does on that device.
      const desktop = page.viewportSize() ?? { width: 1280, height: 800 };
      const phone = { width: 390, height: 844 };
      for (const [label, size, colorScheme] of [
        ['desktop-light', desktop, 'light'],
        ['desktop-dark', desktop, 'dark'],
        ['phone-light', phone, 'light'],
        ['phone-dark', phone, 'dark'],
        ['desktop-light', desktop, 'light'],
      ] as const) {
        // eslint-disable-next-line no-await-in-loop
        await page.keyboard.press('Escape');
        // eslint-disable-next-line no-await-in-loop
        await expect(retryButton(page)).toHaveCount(0);
        // eslint-disable-next-line no-await-in-loop
        await page.setViewportSize(size);
        // eslint-disable-next-line no-await-in-loop
        await page.emulateMedia({ colorScheme });
        // eslint-disable-next-line no-await-in-loop
        await emojiButton(page).click();
        // eslint-disable-next-line no-await-in-loop
        await expect(retryButton(page)).toBeInViewport();
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({ path: `${SHOTS}/lazy-retry-board-${browserName}-${label}.png` });
      }
      await page.emulateMedia({ colorScheme: null });
    }
    let reloaded = false;
    const onNavigation = (frame: Frame) => {
      if (frame === page.mainFrame()) reloaded = true;
    };
    page.on('framenavigated', onNavigation);
    const failedRetry = page.waitForEvent('console', {
      predicate: (message) => message.text().includes('[lazy-part] could not load'),
      timeout: 30_000,
    });
    await retryButton(page).click();
    await failedRetry;
    await expect(retryButton(page)).toBeEnabled();
    expect(reloaded).toBe(false);
    await expectRoom(page);

    // Online again, Retry loads the board, and the worker keeps its chunks. Chrome 145 and WebKit 26
    // fail every later import of a module that failed once in the page, so there Retry reloads the
    // page, which holds nothing to lose, and the board opens after it.
    if (chromium) await goOnline(context);
    else await context.setOffline(false);
    await retryButton(page).click();
    await expect
      .poll(async () => reloaded || (await anEmoji(page).isVisible()), { timeout: 60_000 })
      .toBe(true);
    page.off('framenavigated', onNavigation);
    const retried = reloaded ? 'Retry reloaded the page' : 'Retry loaded the board in place';
    test.info().annotations.push({ type: 'retry', description: retried });
    console.log(`[first-visit-precache] ${retried}`);
    if (reloaded) {
      await expectRoom(page);
      await emojiButton(page).click();
    }
    await expect(anEmoji(page)).toBeVisible({ timeout: 60_000 });
    await page.keyboard.press('Escape');
    await expect
      .poll(
        async () =>
          (await keptAtRuntime(page)).filter((path) => /\/assets\/(?:EmojiBoard|emoji)-/.test(path))
            .length,
        {
          timeout: 30_000,
        }
      )
      .toBe(2);

    // Offline once more, the board opens from the kept chunks (Chromium only, as above).
    if (!chromium) return;
    await reloadOffline(context, page);
    await emojiButton(page).click();
    await expect(anEmoji(page)).toBeVisible({ timeout: 30_000 });
    await goOnline(context);
  }
);
