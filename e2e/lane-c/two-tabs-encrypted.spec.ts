import { writeFileSync } from 'node:fs';
import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
} from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { buildLoginPath } from '../env';

// Two tabs of one session share a device: each runs its own sync loop and its own Rust crypto
// machine over the same IndexedDB crypto store, with nothing coordinating them (R7-01). This
// client keeps that, as MindRoom Chat does (e2e/account-multitab.spec.ts), so this spec checks
// that it costs no messages: Alice has the room open in two tabs while Bob, on his own device,
// writes to her in an encrypted room. Messages go every way while both tabs stay open, again
// after one tab reloads, and again after Bob signs in on a second device (a new Olm session
// with Alice's device, started from one of her one-time keys). Every message must decrypt in
// both of Alice's tabs and on Bob's devices. When it does not, the test writes what each page
// saw (rows it could not decrypt, crypto console lines, the shared store's sizes) to
// `crypto-evidence.json` in its output directory. Needs the slot homeserver:
//   scripts/e2e-slot.sh <slot> --preview npx playwright test e2e/lane-c/two-tabs-encrypted.spec.ts
const HOMESERVER = `http://127.0.0.1:${process.env.E2E_MATRIX_PORT ?? '28008'}`;
const PASSWORD = 'two-tabs-spec-password';
// Long enough for a busy machine; a message that never decrypts fails after it.
const READ_TIMEOUT_MS = 30_000;
// Each message in the timeline is one row, so the whole conversation stays rendered.
test.use({ viewport: { width: 1440, height: 1600 } });

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

const call = async <T>(path: string, token?: string, body?: unknown): Promise<T> => {
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

const registered = async (username: string) => {
  const { access_token: token, user_id: userId } = await call<{
    access_token: string;
    user_id: string;
  }>('/register', undefined, { username, password: PASSWORD, auth: { type: 'm.login.dummy' } });
  return { token, account: { userId, username } };
};

/**
 * Alice's encrypted room with Bob in it, set up over sessions without crypto that sign out
 * again, so the only devices left are the browser sessions this spec starts.
 */
const encryptedRoomOf = async (alice: string, bob: string) => {
  const owner = await registered(alice);
  const guest = await registered(bob);
  const { room_id: roomId } = await call<{ room_id: string }>('/createRoom', owner.token, {
    name: 'Two Tabs',
    preset: 'private_chat',
    invite: [guest.account.userId],
    initial_state: [
      { type: 'm.room.encryption', state_key: '', content: { algorithm: 'm.megolm.v1.aes-sha2' } },
    ],
  });
  await call(`/join/${encodeURIComponent(roomId)}`, guest.token, {});
  await call('/logout', owner.token, {});
  await call('/logout', guest.token, {});
  return { roomId, alice: owner.account, bob: guest.account };
};

/** A page with its name, and the crypto lines its console printed. */
type Reader = { name: string; page: Page; log: string[]; readsFrom: number };

const CRYPTO_LINE = /decrypt|olm|megolm|one.?time|otk|room key|withheld|replay|ratchet|session/i;

const watch = (name: string, page: Page, readsFrom: number): Reader => {
  const log: string[] = [];
  page.on('console', (message: ConsoleMessage) => {
    const text = message.text();
    if (CRYPTO_LINE.test(text)) log.push(`${new Date().toISOString()} ${message.type()} ${text}`);
  });
  page.on('pageerror', (error) => log.push(`${new Date().toISOString()} pageerror ${error.message}`));
  return { name, page, log, readsFrom };
};

const signedIn = async (context: BrowserContext, username: string): Promise<Page> => {
  const page = await context.newPage();
  // A first load on a busy machine can take longer than the sign-in helper waits.
  await page.goto(buildLoginPath(HOMESERVER));
  await expect(page.locator('input[name="serverInput"]')).toBeVisible({ timeout: 90_000 });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });
  return page;
};

/** Opens the room in the Full view, where each message is its own row. */
const openFullRoom = async (page: Page, roomId: string) => {
  await page.goto(`/home/${encodeURIComponent(roomId)}/`);
  const viewSwitch = page.locator('[data-room-view-switch]');
  await expect(viewSwitch).toBeVisible({ timeout: 60_000 });
  if ((await viewSwitch.getAttribute('aria-pressed')) === 'true') await viewSwitch.click();
  await expect(page.locator('[data-editable-name="RoomInput"]')).toBeVisible();
};

/** The expected texts a page does not show yet, and the rows it could not decrypt. */
const readout = (page: Page, texts: string[]) =>
  page.evaluate((expected) => {
    const rows = [...document.querySelectorAll('[data-message-id]')];
    const shown = rows.map((row) => row.textContent ?? '').join('\n');
    return {
      missing: expected.filter((text) => !shown.includes(text)),
      unreadable: rows
        .filter((row) => /Couldn't decrypt|not decrypted yet/.test(row.textContent ?? ''))
        .map((row) => row.getAttribute('data-message-id') ?? '?'),
    };
  }, texts);

/** The shared store's databases with the row count of each object store, for the evidence. */
const storeSizes = (page: Page) =>
  page.evaluate(async () => {
    const sizes: Record<string, Record<string, number>> = {};
    const databases = await indexedDB.databases();
    const crypto = databases.filter((info) => /crypto/i.test(info.name ?? ''));
    for (const { name } of crypto) {
      if (!name) continue;
      // eslint-disable-next-line no-await-in-loop
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      const counts: Record<string, number> = {};
      for (const store of [...db.objectStoreNames]) {
        // eslint-disable-next-line no-await-in-loop
        counts[store] = await new Promise<number>((resolve) => {
          const request = db.transaction(store).objectStore(store).count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve(-1);
        });
      }
      db.close();
      sizes[name] = counts;
    }
    return sizes;
  });

type Phase = { phase: string; reader: string; missing: string[]; unreadable: string[] };

test('two tabs of one session read every message of an encrypted room', async ({ browser }) => {
  test.skip(!(await homeserverIsUp()), `No homeserver at ${HOMESERVER}; run \`just hs-up\``);
  test.setTimeout(420_000);

  const run = `${Date.now().toString(36)}${test.info().repeatEachIndex}`;
  const { roomId, alice, bob } = await encryptedRoomOf(`tabs_a_${run}`, `tabs_b_${run}`);
  const messages: string[] = [];
  const outcomes: Phase[] = [];
  const contexts: BrowserContext[] = [];
  const context = async (target: Browser) => {
    const created = await target.newContext();
    contexts.push(created);
    return created;
  };

  const aliceContext = await context(browser);
  const firstTab = watch('alice tab 1', await signedIn(aliceContext, alice.username), 0);
  await openFullRoom(firstTab.page, roomId);
  const secondTab = watch('alice tab 2', await aliceContext.newPage(), 0);
  await openFullRoom(secondTab.page, roomId);
  const bobPhone = watch('bob device 1', await signedIn(await context(browser), bob.username), 0);
  await openFullRoom(bobPhone.page, roomId);
  const readers = [firstTab, secondTab, bobPhone];

  /** Every reader shows the messages it can read, and no row it could not decrypt. */
  const everyoneReads = async (phase: string) => {
    for (const reader of readers) {
      const expected = messages.slice(reader.readsFrom);
      const stillMissing = async () => (await readout(reader.page, expected)).missing;
      // Waits for the decryption; what is still missing then is recorded below, softly, so the
      // later phases run too and the evidence covers all of them.
      // eslint-disable-next-line no-await-in-loop
      await expect
        .poll(stillMissing, { timeout: READ_TIMEOUT_MS })
        .toEqual([])
        .catch(() => undefined);
      // eslint-disable-next-line no-await-in-loop
      const { missing, unreadable } = await readout(reader.page, expected);
      // A device that joined later has no key for what came before it; only its own rows count.
      const late = reader.readsFrom > 0;
      outcomes.push({ phase, reader: reader.name, missing, unreadable: late ? [] : unreadable });
      expect.soft(missing, `${phase}: ${reader.name} cannot read`).toEqual([]);
      if (!late) expect.soft(unreadable, `${phase}: ${reader.name} undecryptable rows`).toEqual([]);
    }
  };

  /** One message from the reader, then every reader must show it before the next one. */
  const say = async (from: Reader, phase: string) => {
    const text = `${phase} from ${from.name} ${run}`;
    const composer = from.page.locator('[data-editable-name="RoomInput"]');
    await composer.click();
    await from.page.keyboard.type(text);
    await from.page.keyboard.press('Enter');
    await expect(from.page.locator('[data-message-id]', { hasText: text })).toBeVisible();
    messages.push(text);
    await everyoneReads(`${phase} (${from.name} said)`);
  };

  try {
    // Both tabs open: each of them writes, and Bob answers each.
    await say(firstTab, 'open');
    await say(bobPhone, 'open');
    await say(secondTab, 'open');
    await say(bobPhone, 'open');

    // The second tab starts a new crypto machine on the store the first tab kept writing to.
    await secondTab.page.reload();
    await openFullRoom(secondTab.page, roomId);
    await everyoneReads('reloaded');
    await say(secondTab, 'reloaded');
    await say(bobPhone, 'reloaded');
    await say(firstTab, 'reloaded');

    // Bob's new device claims one of the shared device's one-time keys for its first message.
    const bobLaptop = watch(
      'bob device 2',
      await signedIn(await context(browser), bob.username),
      messages.length
    );
    await openFullRoom(bobLaptop.page, roomId);
    readers.push(bobLaptop);
    await say(bobLaptop, 'new device');
    await say(firstTab, 'new device');
    await say(secondTab, 'new device');
    await say(bobPhone, 'new device');
  } finally {
    const failed = outcomes.some((outcome) => outcome.missing.length + outcome.unreadable.length);
    if (failed || test.info().errors.length > 0) {
      const evidence = {
        roomId,
        accounts: { alice: alice.userId, bob: bob.userId },
        messages,
        failures: outcomes.filter((outcome) => outcome.missing.length + outcome.unreadable.length),
        store: await storeSizes(firstTab.page).catch((error: unknown) => String(error)),
        console: Object.fromEntries(readers.map((reader) => [reader.name, reader.log])),
      };
      const file = test.info().outputPath('crypto-evidence.json');
      writeFileSync(file, JSON.stringify(evidence, null, 2));
      await test.info().attach('crypto-evidence', { path: file, contentType: 'application/json' });
    }
    await Promise.all(contexts.map((created) => created.close()));
  }
});
