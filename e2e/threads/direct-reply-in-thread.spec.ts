import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { matrixFetch, sendRoomMessage, setDirectAccountData } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  CHROMIUM_WITH_SCROLLBARS,
} from '../helpers/disposableAccounts';

// Reply in Thread in a direct chat between two people opens the thread, as it does in any other
// room: the thread's banner shows, the reply goes into the thread (an `m.thread` relation on the
// server), and the other person sees it behind the root's thread chip and in the opened thread,
// not in the conversation. Once with a plain direct chat and once with an encrypted one; both
// keep 60 earlier messages, so the conversation scrolls. Needs the slot homeserver:
//   scripts/e2e-slot.sh <slot> --preview npx playwright test e2e/threads/direct-reply-in-thread.spec.ts

const PASSWORD = 'direct-reply-in-thread-password';
const HISTORY = 60;
const TIMEOUT = 60_000;

test.use({
  viewport: { width: 1280, height: 800 },
  launchOptions: CHROMIUM_WITH_SCROLLBARS,
});

type Account = { username: string; userId: string; accessToken: string };

const register = async (prefix: string, displayname: string): Promise<Account> => {
  const username = `${prefix}_${Date.now().toString(36)}`;
  const body = await matrixFetch<{ user_id: string; access_token: string }>(
    HOMESERVER,
    '/register',
    {
      method: 'POST',
      body: JSON.stringify({ username, password: PASSWORD, auth: { type: 'm.login.dummy' } }),
    }
  );
  await matrixFetch(HOMESERVER, `/profile/${encodeURIComponent(body.user_id)}/displayname`, {
    method: 'PUT',
    accessToken: body.access_token,
    body: JSON.stringify({ displayname }),
  });
  return { username, userId: body.user_id, accessToken: body.access_token };
};

/**
 * Alice's direct chat with Bob, listed as direct for both, with an earlier conversation. The
 * encrypted chat turns encryption on after that history, so the messages of the test are
 * encrypted by the browsers.
 */
const createDirectChat = async (alice: Account, bob: Account, encrypted: boolean) => {
  const { room_id: roomId } = await matrixFetch<{ room_id: string }>(HOMESERVER, '/createRoom', {
    method: 'POST',
    accessToken: alice.accessToken,
    body: JSON.stringify({ preset: 'trusted_private_chat', is_direct: true, invite: [bob.userId] }),
  });
  await matrixFetch(HOMESERVER, `/join/${encodeURIComponent(roomId)}`, {
    method: 'POST',
    accessToken: bob.accessToken,
    body: '{}',
  });
  await setDirectAccountData(HOMESERVER, alice.accessToken, alice.userId, bob.userId, roomId);
  await setDirectAccountData(HOMESERVER, bob.accessToken, bob.userId, alice.userId, roomId);
  for (let index = 0; index < HISTORY; index += 1) {
    const sender = index % 2 === 0 ? alice : bob;
    // eslint-disable-next-line no-await-in-loop
    await sendRoomMessage(HOMESERVER, sender.accessToken, roomId, {
      msgtype: 'm.text',
      body: `Earlier message ${index + 1}: catching up on the week.`,
    });
  }
  if (encrypted) {
    await matrixFetch(HOMESERVER, `/rooms/${encodeURIComponent(roomId)}/state/m.room.encryption/`, {
      method: 'PUT',
      accessToken: alice.accessToken,
      body: JSON.stringify({ algorithm: 'm.megolm.v1.aes-sha2' }),
    });
  }
  return roomId;
};

const signIn = async (browser: Browser, account: Account): Promise<Page> => {
  const page = await (await browser.newContext()).newPage();
  await loginWithPassword(page, {
    homeserver: HOMESERVER,
    username: account.username,
    password: PASSWORD,
  });
  return page;
};

const rowsOf = (page: Page) => page.locator('[data-message-item]');
const rowWith = (page: Page, text: string) => rowsOf(page).filter({ hasText: text });
const threadIdOf = (page: Page) => new URL(page.url()).searchParams.get('threadId');
const banner = (page: Page) => page.locator('[data-thread-context-banner]');
const chipOf = (row: Locator) => row.locator('button[data-thread-root-id]');

/** Sends a message from the composer and waits until it shows. */
const send = async (page: Page, text: string) => {
  await page.locator('[data-editable-name="RoomInput"]').click();
  await page.keyboard.type(text);
  await page.keyboard.press('Enter');
  await expect(rowWith(page, text)).toHaveCount(1, { timeout: TIMEOUT });
};

/** The senders of the root's thread replies on the server, encrypted ones included. */
const threadReplySenders = async (account: Account, roomId: string, rootId: string) => {
  const { chunk } = await matrixFetch<{ chunk: Array<{ sender: string }> }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(roomId)}/relations/${encodeURIComponent(rootId)}/m.thread`,
    { accessToken: account.accessToken, apiVersion: 'v1' }
  );
  return chunk.map((event) => event.sender);
};

for (const encrypted of [false, true]) {
  const kind = encrypted ? 'an encrypted' : 'a plain';

  test(`Reply in Thread in ${kind} direct chat opens the thread and the reply stays in it for both people`, async ({
    browser,
  }) => {
    test.skip(
      !(await disposableHomeserverIsUp()),
      `No homeserver at ${HOMESERVER}; run \`just hs-up\``
    );
    // Two sign-ins, two room loads and the sync of each message on a loaded machine.
    test.setTimeout(360_000);

    const tag = encrypted ? 'enc' : 'plain';
    const alice = await register(`dm_thread_alice_${tag}`, 'Alice');
    const bob = await register(`dm_thread_bob_${tag}`, 'Bob');
    const roomId = await createDirectChat(alice, bob, encrypted);

    const alicePage = await signIn(browser, alice);
    const bobPage = await signIn(browser, bob);
    const roomPath = `/direct/${encodeURIComponent(roomId)}/`;
    await alicePage.goto(roomPath);
    await bobPage.goto(roomPath);
    await expect(rowWith(alicePage, `Earlier message ${HISTORY}:`)).toHaveCount(1, {
      timeout: TIMEOUT,
    });
    await expect(rowWith(bobPage, `Earlier message ${HISTORY}:`)).toHaveCount(1, {
      timeout: TIMEOUT,
    });

    const ROOT = 'Did you see the new release notes?';
    const OTHER = 'Not yet, where are they?';
    const REPLY = 'Found them in the docs folder, thanks!';
    const ANSWER = 'Great, the changelog is linked from there too.';
    await send(alicePage, ROOT);
    await expect(rowWith(bobPage, ROOT)).toHaveCount(1, { timeout: TIMEOUT });
    await send(bobPage, OTHER);
    await expect(rowWith(alicePage, OTHER)).toHaveCount(1, { timeout: TIMEOUT });
    const rootId = await rowWith(bobPage, ROOT).getAttribute('data-message-id');
    expect(rootId).toMatch(/^\$/);

    // Bob replies in a thread from the hover toolbar: the thread opens with its banner.
    const bobRoot = rowWith(bobPage, ROOT);
    await bobRoot.hover();
    await bobRoot.getByRole('button', { name: 'Reply in Thread', exact: true }).click();
    await expect.poll(() => threadIdOf(bobPage), { timeout: TIMEOUT }).toBe(rootId);
    await expect(banner(bobPage)).toBeVisible({ timeout: TIMEOUT });
    await expect(rowWith(bobPage, OTHER)).toHaveCount(0);
    await send(bobPage, REPLY);
    expect(threadIdOf(bobPage)).toBe(rootId);
    await expect(banner(bobPage)).toBeVisible();

    // The server has the reply in the root's thread.
    await expect
      .poll(() => threadReplySenders(alice, roomId, rootId!), { timeout: TIMEOUT })
      .toEqual([bob.userId]);

    // Alice sees the reply behind the root's chip, not in the conversation, and in the thread.
    const aliceRoot = rowWith(alicePage, ROOT);
    await expect(chipOf(aliceRoot)).toContainText('1 reply', { timeout: TIMEOUT });
    await expect(rowWith(alicePage, REPLY)).toHaveCount(0);
    await chipOf(aliceRoot).click();
    await expect.poll(() => threadIdOf(alicePage), { timeout: TIMEOUT }).toBe(rootId);
    await expect(banner(alicePage)).toBeVisible({ timeout: TIMEOUT });
    await expect(rowWith(alicePage, REPLY)).toHaveCount(1, { timeout: TIMEOUT });

    // Alice answers in the thread, and Bob, who has it open, sees the answer there.
    await send(alicePage, ANSWER);
    await expect(rowWith(bobPage, ANSWER)).toHaveCount(1, { timeout: TIMEOUT });
    await expect
      .poll(() => threadReplySenders(bob, roomId, rootId!), { timeout: TIMEOUT })
      .toEqual([alice.userId, bob.userId]);

    // Back in the conversation, Bob sees neither reply, only the root's chip with both.
    await bobPage
      .locator('[data-thread-context-banner]')
      .getByRole('button', { name: 'Back', exact: true })
      .click();
    await expect.poll(() => threadIdOf(bobPage), { timeout: TIMEOUT }).toBeNull();
    await expect(chipOf(rowWith(bobPage, ROOT))).toContainText('2 replies', { timeout: TIMEOUT });
    await expect(rowWith(bobPage, OTHER)).toHaveCount(1);
    await expect(rowWith(bobPage, REPLY)).toHaveCount(0);
    await expect(rowWith(bobPage, ANSWER)).toHaveCount(0);
  });
}
