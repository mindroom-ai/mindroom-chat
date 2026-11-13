import { expect, test, type Page } from '@playwright/test';
import { waitForLoggedInShell } from '../helpers/auth';
import { buildLoginPath } from '../env';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// An offline start in a language other than English, on a production build (`scripts/e2e-slot.sh
// --preview`; the dev server's worker keeps everything it serves and the spec skips there). The
// language's catalog (public/locales/<code>.json) has no hash in its name and is not precached:
// the worker answers it from the network and keeps the latest copy (src/sw/swLanguageFiles.ts), and
// keeps the overlay chunk of Lane C strings like any other on-demand chunk. Without them the whole
// app came up in English offline.
const PASSWORD = 'offline-language-password';
const GREETING = 'Offline auf Deutsch';

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
    { name: 'Sprachprobe', preset: 'private_chat' },
    token
  );
  await matrixPost(
    `/rooms/${encodeURIComponent(roomId)}/send/m.room.message/language-${Date.now()}`,
    { msgtype: 'm.text', body: GREETING },
    token
  );
  return roomId;
};

/** The paths a cache of this origin holds. */
const cachedPaths = (page: Page, cacheName: string): Promise<string[]> =>
  page.evaluate(async (name) => {
    if (!(await caches.has(name))) return [];
    const requests = await (await caches.open(name)).keys();
    return requests.map((request) => new URL(request.url).pathname);
  }, cacheName);

/** The room in German: a sidebar string from the catalog, a Lane C string from the overlay. */
const expectGermanRoom = async (page: Page): Promise<void> => {
  await expect(page.getByText(GREETING, { exact: true }).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  // The catalog: the Direct Messages tab of the rail and the Home header.
  await expect
    .poll(() => page.evaluate(() => /Direktnachrichten|Startseite/.test(document.body.innerHTML)), {
      timeout: 30_000,
    })
    .toBe(true);
  // The overlay: the main navigation landmark (sharedUi.a11y.mainNavigation).
  await expect(page.getByRole('navigation', { name: 'Hauptnavigation' })).toBeAttached();
};

test('an offline start keeps the language: its catalog and its overlay of Lane C strings', async ({
  context,
  page,
}) => {
  test.setTimeout(240_000);
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  const username = `language_${Date.now().toString(36)}`;
  const roomId = await accountWithRoom(username);

  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="usernameInput"]')).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 120_000 })
    .toBe(true);
  const precache = await page.evaluate(async () =>
    (await caches.keys()).some((name) => name.startsWith('workbox-precache'))
  );
  test.skip(!precache, 'Needs a production build: scripts/e2e-slot.sh <n> --preview');

  await page.locator('input[name="usernameInput"]').fill(username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await waitForLoggedInShell(page);
  await page.evaluate(() => window.localStorage.setItem('i18nextLng', 'de'));
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expectGermanRoom(page);

  // The worker kept the catalog and the overlay chunk the page loaded.
  await expect
    .poll(() => cachedPaths(page, 'mindroom-languages'), { timeout: 30_000 })
    .toEqual(['/public/locales/de.json']);
  await expect
    .poll(
      async () =>
        (
          await cachedPaths(page, 'mindroom-build-assets')
        ).filter((path) => /^\/assets\/de-[^/]+\.js$/.test(path)).length,
      { timeout: 30_000 }
    )
    .toBe(1);

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectGermanRoom(page);
  await context.setOffline(false);
});
