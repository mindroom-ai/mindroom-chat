import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { waitForLoggedInShell } from '../helpers/auth';
import { buildLoginPath } from '../env';

// What a first visit downloads for offline use, on a production build (`scripts/e2e-slot.sh
// --preview`; the dev server's worker precaches nothing and the spec skips there). The worker
// precaches the shell and the signed-in start only, with the images its chunks import
// (scripts/precache-plan.mjs); chunks loaded on demand are kept the first time a page loads them
// (src/sw/swRuntimeAssets.ts). A part whose chunk is missing offline renders nothing and loads on its
// next open (src/app/lib/lazyPart.tsx).
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'first-visit-precache-password';
const GREETING = 'Offline starts need no more than this';

test.use({ serviceWorkers: 'allow' });

const homeserverIsUp = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${HOMESERVER}/_matrix/client/versions`, {
      signal: AbortSignal.timeout(2_000),
    });
    return response.ok;
  } catch {
    return false;
  }
};

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

test('a first visit precaches the signed-in start and keeps on-demand chunks once they load', async ({
  context,
  page,
}) => {
  test.setTimeout(240_000);
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
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

  // Offline, the emoji board was never loaded: it closes again and the app stays up.
  await reloadOffline(context, page);
  const failedLoad = page.waitForEvent('console', {
    predicate: (message) => message.text().includes('[lazy-part] could not load'),
    timeout: 30_000,
  });
  await emojiButton(page).click();
  await failedLoad;
  await expect(emojiButton(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(anEmoji(page)).toHaveCount(0);
  await expectRoom(page);

  // Online again, the next open loads the board, and the worker keeps its chunks.
  await goOnline(context);
  await emojiButton(page).click();
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

  // Offline once more, the board opens from the kept chunks.
  await reloadOffline(context, page);
  await emojiButton(page).click();
  await expect(anEmoji(page)).toBeVisible({ timeout: 30_000 });
  await goOnline(context);
});
