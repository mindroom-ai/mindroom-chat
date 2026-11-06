import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
  type Request,
} from '@playwright/test';
import { loginWithPassword, waitForLoggedInShell } from '../helpers/auth';
import { readSessionStore } from '../helpers/accounts';
import { launchWebKit } from '../helpers/webkit';

// A session whose Rust crypto store is gone while its access token stays (site data cleared in
// part, a browser that evicted IndexedDB) must not make up new identity keys for its device: the
// homeserver already has that device's keys, MindRoom's homeserver refuses to replace them
// (`403 M_FORBIDDEN ... device keys are immutable`), and other homeservers would hand the new
// keys to everyone and break the device's verification. The client stops before it syncs and
// shows a screen that explains the keys are lost and offers to sign in again; signing in again
// logs the old device out and keeps the other accounts.
//
// The store can go two ways, and both are covered:
// - it is gone when the page loads;
// - it is still there when the page checks for it, and gone a moment later, when the crypto
//   machine opens it: another tab held it open while the deletion waited (the live finding).
// Needs the slot homeserver: scripts/e2e-slot.sh <slot> --preview npx playwright test <this file>
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'crypto-store-loss-spec-password';
const RUN = Date.now().toString(36);
const WEBKIT = process.env.PLAYWRIGHT_WEBKIT_EXECUTABLE;
// A same-origin page that runs no app code: the deletion happens there, as a person clearing
// one database in the browser's site data would.
const NO_APP_PAGE = '/runtime-config.js';

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

const api = async <T>(path: string, token?: string, body?: unknown): Promise<T> => {
  const response = await fetch(`${HOMESERVER}/_matrix/client/v3${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.ok, `${path} answered ${response.status}`).toBe(true);
  return (await response.json()) as T;
};

type Account = { username: string; userId: string; token: string };

/** A new account, with a session of its own (no crypto) for the checks on the server. */
const register = async (name: string): Promise<Account> => {
  const username = `${name}${RUN}${test.info().project.name.slice(0, 2)}`;
  const { access_token: token, user_id: userId } = await api<{
    access_token: string;
    user_id: string;
  }>('/register', undefined, { username, password: PASSWORD, auth: { type: 'm.login.dummy' } });
  return { username, userId, token };
};

/** The ed25519 key the server holds for one device, or undefined while it has none. */
const serverDeviceKey = async (account: Account, deviceId: string) => {
  const body = await api<{
    device_keys?: Record<string, Record<string, { keys?: Record<string, string> }>>;
  }>('/keys/query', account.token, { device_keys: { [account.userId]: [deviceId] } });
  return body.device_keys?.[account.userId]?.[deviceId]?.keys?.[`ed25519:${deviceId}`];
};

const serverDeviceIds = async (account: Account) =>
  (await api<{ devices: { device_id: string }[] }>('/devices', account.token)).devices.map(
    (device) => device.device_id
  );

/** The browser session of an account, and the name of its device's Rust crypto database. */
const storedSession = async (page: Page, account: Account) => {
  const store = await readSessionStore(page);
  const session = store.sessions.find((item) => item.userId === account.userId);
  if (!session?.deviceId) throw new Error(`No stored session for ${account.userId}`);
  const cryptoDb = `matrix-js-sdk::${session.sessionId}::${encodeURIComponent(
    session.deviceId
  )}::matrix-sdk-crypto`;
  return { sessionId: session.sessionId, deviceId: session.deviceId, cryptoDb };
};

/** Every key upload a page sends from now on, with the status it got. */
const watchKeyUploads = (context: BrowserContext) => {
  const uploads: string[] = [];
  const note = (request: Request) => {
    if (request.method() !== 'POST' || !request.url().includes('/keys/upload')) return;
    request
      .response()
      .then((response) => uploads.push(`${response?.status() ?? 'no response'}`))
      .catch(() => uploads.push('failed'));
  };
  context.on('request', note);
  return uploads;
};

const lostKeysScreen = (page: Page) => page.getByRole('heading', { name: 'Encryption keys lost' });

/** Signs `account` in on `page` and waits until the server has its device's keys. */
const signIn = async (page: Page, account: Account, addAccount = false) => {
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: account.username,
    password: PASSWORD,
    addAccount,
  });
  const session = await storedSession(page, account);
  await expect
    .poll(() => serverDeviceKey(account, session.deviceId), { timeout: 60_000 })
    .toBeTruthy();
  return { ...session, serverKey: (await serverDeviceKey(account, session.deviceId)) ?? '' };
};

/** Deletes a database from a page without app code and waits until it is gone. */
const deleteDatabase = (page: Page, name: string) =>
  page.evaluate(
    (dbName) =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
    name
  );

const lostStoreAtLoad = async (context: BrowserContext) => {
  const other = await register('kept');
  const account = await register('lost');
  const page = await context.newPage();
  await signIn(page, other);
  const session = await signIn(page, account, true);

  await page.goto(NO_APP_PAGE);
  await deleteDatabase(page, session.cryptoDb);
  const uploads = watchKeyUploads(context);
  await page.goto('/home/');

  await expect(lostKeysScreen(page)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(account.userId)).toBeVisible();
  // The shell never mounts, so nothing offers Verify or reads rooms with keys it lacks.
  await expect(page.getByRole('button', { name: /Open account menu for / })).toHaveCount(0);
  await page.waitForTimeout(3_000);
  expect(uploads).toEqual([]);
  expect(await serverDeviceKey(account, session.deviceId)).toBe(session.serverKey);

  // Signing in again logs the old device out, keeps the other account, and starts a new device.
  await page.getByRole('button', { name: 'Sign in again' }).click();
  await expect(page.locator('input[name="serverInput"]')).toHaveValue(HOMESERVER, {
    timeout: 30_000,
  });
  await expect.poll(() => serverDeviceIds(account)).not.toContain(session.deviceId);
  const remaining = await readSessionStore(page);
  expect(remaining.sessions.map((item) => item.userId)).toEqual([other.userId]);

  await page.locator('input[name="usernameInput"]').fill(account.username);
  await page.locator('input[name="passwordInput"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await waitForLoggedInShell(page);
  const fresh = await storedSession(page, account);
  expect(fresh.deviceId).not.toBe(session.deviceId);
  await expect
    .poll(() => serverDeviceKey(account, fresh.deviceId), { timeout: 60_000 })
    .toBeTruthy();
  expect(uploads.filter((status) => status !== '200')).toEqual([]);
  expect((await readSessionStore(page)).sessions.map((item) => item.userId).sort()).toEqual(
    [other.userId, account.userId].sort()
  );
};

const storeRecreatedBehindTheCheck = async (context: BrowserContext) => {
  const account = await register('raced');
  const page = await context.newPage();
  const session = await signIn(page, account);

  // Another tab holds the store open, so the deletion waits; the page reloads meanwhile and still
  // finds the store, then the other tab lets go and the deletion goes through.
  const holder = await context.newPage();
  await holder.goto(NO_APP_PAGE);
  await holder.evaluate(async (dbName) => {
    const held = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(dbName);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const state = { deleted: false };
    Object.assign(window, { heldStore: held, deletionState: state });
    indexedDB.deleteDatabase(dbName).onsuccess = () => {
      state.deleted = true;
    };
  }, session.cryptoDb);
  const uploads = watchKeyUploads(context);
  await page.goto('/home/');
  await page.waitForTimeout(3_000);
  await holder.evaluate(() => (window as unknown as { heldStore: IDBDatabase }).heldStore.close());
  await expect
    .poll(() =>
      holder.evaluate(
        () => (window as unknown as { deletionState: { deleted: boolean } }).deletionState.deleted
      )
    )
    .toBe(true);

  await expect(lostKeysScreen(page)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3_000);
  expect(uploads).toEqual([]);
  expect(await serverDeviceKey(account, session.deviceId)).toBe(session.serverKey);

  // The store this start made is not the device's either: another load says the same.
  await page.reload();
  await expect(lostKeysScreen(page)).toBeVisible({ timeout: 60_000 });
  await page.waitForTimeout(3_000);
  expect(uploads).toEqual([]);
};

const inWebKit = async (
  baseURL: string | undefined,
  run: (context: BrowserContext) => Promise<void>
) => {
  const browser: Browser = await launchWebKit();
  try {
    await run(await browser.newContext({ baseURL, viewport: { width: 1280, height: 800 } }));
  } finally {
    await browser.close();
  }
};

test.beforeEach(async () => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
  test.setTimeout(240_000);
});

test('a store lost before the page loads asks to sign in again (Chromium)', async ({ context }) => {
  await lostStoreAtLoad(context);
});

test('a store lost before the page loads asks to sign in again (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  await inWebKit(baseURL, lostStoreAtLoad);
});

test('a store deleted after the check makes no new device keys (Chromium)', async ({ context }) => {
  await storeRecreatedBehindTheCheck(context);
});

test('a store deleted after the check makes no new device keys (WebKit)', async ({ baseURL }) => {
  test.skip(!WEBKIT, 'Set PLAYWRIGHT_WEBKIT_EXECUTABLE to Playwright’s WebKit');
  await inWebKit(baseURL, storeRecreatedBehindTheCheck);
});
