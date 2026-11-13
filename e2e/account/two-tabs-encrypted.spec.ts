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
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';

// Two tabs of one session share a device: each runs its own sync loop and its own Rust crypto
// machine over the same IndexedDB crypto store, with nothing coordinating them (R7-01). This
// client keeps that, as MindRoom Chat does (e2e/account/account-multitab.spec.ts), so this spec checks
// that it costs no messages: Alice has the room open in two tabs while Bob, on his own device,
// writes to her in an encrypted room. Messages go every way while both tabs stay open, again
// after one tab reloads, and again after Bob signs in on a second device (a new Olm session
// with Alice's device, started from one of her one-time keys). Every message must decrypt in
// both of Alice's tabs and on Bob's devices, and no Megolm message index may carry two of
// Alice's messages (read from the ciphertexts on the server). The test writes what each page saw
// (rows it could not decrypt, crypto console lines, the shared store's sizes) to
// `crypto-evidence.json` in its output directory. Needs the slot homeserver:
//   scripts/e2e-slot.sh <slot> --preview npx playwright test e2e/account/two-tabs-encrypted.spec.ts
//
// Two of these checks fail today (workstream A1, 2026-11-04; full evidence in the A1 report,
// .baspowers/sdd/2026-11-03-m2-core-parity/A1-report.md), and the spec expects exactly those, so
// any other failure fails it. Over 10 runs:
// - 10 of 10: the two tabs encrypt with one shared outbound Megolm session, each from its own
//   copy of the ratchet, so two of Alice's messages go out under the same message index (the
//   same message key). The spec requires a reused index; once tabs of one session no longer run
//   two crypto machines at once, that check fails and must then require none.
// - 2 of 10: Bob's new device claims a one-time key that neither tab holds any more ("Failed to
//   create a new Olm session from a pre-key message: InboundCreation(MissingOneTimeKey(..))" in
//   both tabs), so its room key is lost and its message never decrypts for Alice, not even
//   after minutes; in 2 more runs one tab lacked the key and the other still had it. A tab that
//   logged the missing key may miss the new device's messages; nothing else may go unread.
const PASSWORD = 'two-tabs-spec-password';
// Long enough for a busy machine; a message that never decrypts fails after it.
const READ_TIMEOUT_MS = 30_000;
/** Bob's second device, which signs in last and claims one of the shared device's one-time keys. */
const NEW_DEVICE = 'bob device 2';
const MISSING_KEY = /MissingOneTimeKey/;
// Each message in the timeline is one row, so the whole conversation stays rendered.
test.use({ viewport: { width: 1440, height: 1600 } });

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
  page.on('pageerror', (error) =>
    log.push(`${new Date().toISOString()} pageerror ${error.message}`)
  );
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

/** What one reader showed after one step; `joinedLate` readers hold no keys for older rows. */
/**
 * The message index of a Megolm ciphertext: a version byte (3), then field 1 (tag 0x08) as a
 * varint. Undefined when the bytes do not start that way.
 */
const megolmIndex = (ciphertext: string): number | undefined => {
  const bytes = Buffer.from(ciphertext, 'base64');
  if (bytes[0] !== 3 || bytes[1] !== 0x08) return undefined;
  let index = 0;
  for (let at = 2, shift = 0; at < bytes.length; at += 1, shift += 7) {
    const byte = bytes[at] ?? 0;
    index += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return index;
  }
  return undefined;
};

type EncryptedEvent = {
  event_id: string;
  type: string;
  sender: string;
  content: { session_id?: string; ciphertext?: unknown };
};

/**
 * Alice's encrypted events, as the server keeps them, grouped by Megolm session and message
 * index; any group with two events used one message key twice. Read through a session of Bob's
 * that signs in and out without crypto.
 */
const reusedMegolmIndexes = async (roomId: string, bob: string, alice: string) => {
  const { access_token: token } = await call<{ access_token: string }>('/login', undefined, {
    type: 'm.login.password',
    identifier: { type: 'm.id.user', user: bob },
    password: PASSWORD,
  });
  const { chunk } = await call<{ chunk: EncryptedEvent[] }>(
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=200`,
    token
  );
  await call('/logout', token, {});
  const byIndex = new Map<string, string[]>();
  for (const event of chunk) {
    const { session_id: session, ciphertext } = event.content;
    if (event.type !== 'm.room.encrypted' || event.sender !== alice) continue;
    if (!session || typeof ciphertext !== 'string') continue;
    const key = `${session} #${megolmIndex(ciphertext) ?? '?'}`;
    byIndex.set(key, [...(byIndex.get(key) ?? []), event.event_id]);
  }
  return [...byIndex].filter(([, events]) => events.length > 1);
};

type Phase = {
  phase: string;
  reader: string;
  missing: string[];
  unreadable: string[];
  joinedLate: boolean;
};

const failedStep = ({ missing, unreadable, joinedLate }: Phase) =>
  missing.length > 0 || (!joinedLate && unreadable.length > 0);

test('two tabs of one session read every message of an encrypted room', async ({ browser }) => {
  test.skip(
    !(await disposableHomeserverIsUp()),
    `No homeserver at ${HOMESERVER}; run \`just hs-up\``
  );
  test.setTimeout(420_000);

  const run = `${Date.now().toString(36)}${test.info().repeatEachIndex}`;
  const { roomId, alice, bob } = await encryptedRoomOf(`tabs_a_${run}`, `tabs_b_${run}`);
  const messages: string[] = [];
  const outcomes: Phase[] = [];
  let reused: [string, string[]][] | undefined;
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
      const joinedLate = reader.readsFrom > 0;
      outcomes.push({ phase, reader: reader.name, missing, unreadable, joinedLate });
    }
  };

  /**
   * The known one-time key loss: one of Alice's tabs logged the missing key, and all it cannot
   * read are the messages of Bob's new device (their rows show as undecryptable).
   */
  const knownKeyLoss = ({ reader, missing }: Phase) =>
    reader.startsWith('alice tab') &&
    missing.length > 0 &&
    missing.every((text) => text.includes(`from ${NEW_DEVICE} `)) &&
    readers.some((tab) => tab.name === reader && tab.log.some((line) => MISSING_KEY.test(line)));

  /** One message from the reader, then every reader must show it before the next one. */
  const say = async (from: Reader, phase: string) => {
    const text = `${phase} ${messages.length + 1} from ${from.name} ${run}`;
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
      NEW_DEVICE,
      await signedIn(await context(browser), bob.username),
      messages.length
    );
    await openFullRoom(bobLaptop.page, roomId);
    readers.push(bobLaptop);
    await say(bobLaptop, 'new device');
    await say(firstTab, 'new device');
    await say(secondTab, 'new device');
    await say(bobPhone, 'new device');

    reused = await reusedMegolmIndexes(roomId, bob.username, alice.userId);
    const unexpected = outcomes.filter(failedStep).filter((outcome) => !knownKeyLoss(outcome));
    expect(unexpected, 'every reader reads every message it holds a key for').toEqual([]);
    expect(
      reused,
      'known: two tabs reuse Megolm message indexes; once none are, require none here'
    ).not.toEqual([]);
  } finally {
    // Written on every run, so a passing run also shows that the late device's history rows
    // were seen as undecryptable (the check can see a failure); attached when one failed.
    const evidence = {
      roomId,
      accounts: { alice: alice.userId, bob: bob.userId },
      messages,
      failures: outcomes.filter(failedStep),
      reusedMegolmIndexes: reused,
      lateDeviceHistoryRows: outcomes.filter((outcome) => outcome.joinedLate).at(-1)?.unreadable,
      store: await storeSizes(firstTab.page).catch((error: unknown) => String(error)),
      console: Object.fromEntries(readers.map((reader) => [reader.name, reader.log])),
    };
    const file = test.info().outputPath('crypto-evidence.json');
    writeFileSync(file, JSON.stringify(evidence, null, 2));
    if (evidence.failures.length > 0 || test.info().errors.length > 0) {
      await test.info().attach('crypto-evidence', { path: file, contentType: 'application/json' });
    }
    await Promise.all(contexts.map((created) => created.close()));
  }
});
