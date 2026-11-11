import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  composer,
  createAgentRoom,
  createEncryptedAgentRoom,
  expect,
  mentionHelper,
  messageRow,
  test,
  type AgentStack,
} from '../helpers/agentStack';
import { matrixFetch } from '../helpers/matrix';

// Regression (P2-e2ee-F011 follow-up): the offline cache keeps an encrypted room's events as
// ciphertext and its thread titles in memory only, but two other stores kept text read out of its
// decrypted events in the clear in localStorage: the preview of a recently opened thread (up to
// 120 characters of the thread's root) and the text of the message a reply draft quotes. Neither
// may hold an encrypted room's text, an older version's copies are deleted, and the person's own
// unsent draft stays. A thread's reply target goes with its view and is not kept at all; the room
// composer's is, without an encrypted room's text. After a reload the sidebar and the room
// composer's reply bar show the text again, read from the decrypted events.
test.describe.configure({ timeout: 360_000 });

// Set E2EE_SHOTS=<directory> to save the page after the reload.
const SHOTS = process.env.E2EE_SHOTS;

type Raw = {
  event_id: string;
  sender: string;
  content: { 'm.relates_to'?: { rel_type?: string; event_id?: string } };
};

const roomEvents = async (stack: AgentStack, roomId: string): Promise<Raw[]> =>
  (
    await matrixFetch<{ chunk: Raw[] }>(
      stack.homeserver,
      `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=100`,
      { accessToken: stack.tester.accessToken }
    )
  ).chunk;

/** The tester's question, which roots the helper's thread, and the helper's reply in it. */
const askHelper = async (
  page: Page,
  stack: AgentStack,
  roomId: string,
  question: string
): Promise<{ rootId: string; replyId: string }> => {
  await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  await mentionHelper(page, stack, question);
  let ids: { rootId: string; replyId: string } | undefined;
  await expect
    .poll(
      async () => {
        const events = await roomEvents(stack, roomId);
        const root = events.find(
          (event) => event.sender === stack.tester.userId && !event.content['m.relates_to']
        );
        // The oldest of the helper's thread events: its answer, before the thread's title notice.
        const reply = [...events]
          .reverse()
          .find(
            (event) =>
              event.sender === stack.agents.helper &&
              event.content['m.relates_to']?.rel_type === 'm.thread' &&
              event.content['m.relates_to'].event_id === root?.event_id
          );
        ids = root && reply ? { rootId: root.event_id, replyId: reply.event_id } : undefined;
        return !!ids;
      },
      { timeout: 120_000, intervals: [1000], message: "the helper's reply" }
    )
    .toBe(true);
  return ids!;
};

/** Opens the thread, replies to the helper's answer and, optionally, leaves words unsent. */
const replyInThread = async (
  page: Page,
  roomId: string,
  ids: { rootId: string; replyId: string },
  unsent?: string
) => {
  await page.goto(
    `/home/${encodeURIComponent(roomId)}?threadId=${encodeURIComponent(ids.rootId)}`,
    { timeout: 180_000 }
  );
  const answer = messageRow(page, ids.replyId);
  await expect(answer).toContainText('You said', { timeout: 90_000 });
  await answer.hover();
  await answer.getByRole('button', { name: 'Reply', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancel reply' })).toBeVisible();
  if (unsent) {
    await composer(page).click();
    await page.keyboard.type(unsent);
    await expect(composer(page)).toContainText(unsent);
  }
};

/** The page's localStorage, parsed where it holds JSON. */
const readStorage = (page: Page) =>
  page.evaluate(() =>
    Object.fromEntries(
      Object.keys(localStorage).map((key) => {
        const raw = localStorage.getItem(key) ?? '';
        try {
          return [key, JSON.parse(raw) as unknown];
        } catch {
          return [key, raw];
        }
      })
    )
  );

type Recent = { roomId: string; threadId: string; summaryText?: string };

const recentEntry = (storage: Record<string, unknown>, userId: string, roomId: string) =>
  (storage[`recentThreads:${userId}`] as { entries?: Recent[] } | undefined)?.entries?.find(
    (entry) => entry.roomId === roomId
  );

const replyEntry = (storage: Record<string, unknown>, userId: string, roomId: string) =>
  storage[`roomInputReply:${JSON.stringify([userId, roomId])}`] as
    | { eventId?: string; body?: string; formattedBody?: string }
    | undefined;

/** Whether `stored` (any JSON) holds `word` anywhere. */
const holds = (stored: unknown, word: string): boolean =>
  JSON.stringify(stored ?? '').includes(word);

/** The encrypted room's entries in both stores, which must not hold `word`. */
const secretEntries = (storage: Record<string, unknown>, userId: string, roomId: string) => [
  recentEntry(storage, userId, roomId),
  replyEntry(storage, userId, roomId),
];

/** The first line of the recently opened thread's row in the sidebar: its title or preview. */
const shownTitle = async (page: Page, roomId: string, rootId: string): Promise<string> => {
  const row = page
    .getByTestId('recently-opened-nav-list')
    .locator(`[data-scroll-anchor="${roomId}|${rootId}"]`);
  const text = await row.innerText({ timeout: 1_000 }).catch(() => '');
  return text.split('\n')[0]?.trim() ?? '';
};

/** Opens the sidebar's Recently Opened list, which starts collapsed. */
const openRecentlyOpened = async (page: Page) => {
  const header = page.locator('button[data-category-id="mindroom|recently-opened"]');
  await expect(header).toBeVisible({ timeout: 90_000 });
  const list = page.getByTestId('recently-opened-nav-list');
  if (!(await list.isVisible())) await header.click();
  await expect(list).toBeVisible();
};

/** Goes Home inside the running app, so the page keeps what it holds in memory. */
const goHome = async (page: Page) => {
  await page.evaluate(() => {
    window.history.pushState(null, '', '/home/');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await openRecentlyOpened(page);
};

test('an encrypted room leaves no thread preview and no quoted reply text in localStorage', async ({
  page,
  stack,
}) => {
  const secretWord = `ledger${Date.now().toString(36)}`;
  const plainWord = `lunch${Date.now().toString(36)}`;
  const unsent = 'my own unsent words';
  const secret = await createEncryptedAgentRoom(stack, 'Secure ledger');
  const plain = await createAgentRoom(stack, 'Plain lunch', false);
  const user = stack.tester.userId;

  const plainIds = await askHelper(page, stack, plain, `what is for ${plainWord}?`);
  await replyInThread(page, plain, plainIds);
  const secretIds = await askHelper(page, stack, secret, `where is the ${secretWord}?`);
  await replyInThread(page, secret, secretIds, unsent);

  // The sidebar shows both threads with their text; the page holds it in memory.
  await goHome(page);
  let secretTitle = '';
  await expect
    .poll(
      async () => {
        secretTitle = await shownTitle(page, secret, secretIds.rootId);
        return secretTitle.length > 0 && secretTitle !== 'Encrypted thread';
      },
      { timeout: 60_000, message: "the encrypted room's thread shows its text" }
    )
    .toBe(true);

  // The unencrypted room keeps its thread's text; the encrypted room names its thread without its
  // text, and keeps the person's own unsent words. The threads' reply targets went with their views.
  let storage: Record<string, unknown> = {};
  await expect
    .poll(
      async () => {
        storage = await readStorage(page);
        return [
          !!recentEntry(storage, user, plain)?.summaryText,
          recentEntry(storage, user, secret)?.threadId === secretIds.rootId,
        ];
      },
      { timeout: 30_000, message: 'both rooms are in the stores' }
    )
    .toEqual([true, true]);
  expect(recentEntry(storage, user, secret)?.summaryText).toBeUndefined();
  expect(replyEntry(storage, user, plain)).toBeUndefined();
  expect(replyEntry(storage, user, secret)).toBeUndefined();
  for (const text of [secretTitle, 'You said', secretWord]) {
    expect(holds(secretEntries(storage, user, secret), text), text).toBe(false);
  }
  const ownDraftKey = `roomInputDraft:${JSON.stringify([user, secret, secretIds.rootId])}`;
  expect(holds(storage[ownDraftKey], unsent)).toBe(true);

  // An older version stored the encrypted room's texts, its room composer's reply target (the
  // thread's root) among them: they are deleted once the client starts, the target kept without
  // its text.
  await page.evaluate(
    ({ userId, roomId, rootId, word, title }) => {
      const recentKey = `recentThreads:${userId}`;
      const recent = JSON.parse(localStorage.getItem(recentKey) ?? '{}') as {
        entries?: Array<{ roomId: string; summaryText?: string }>;
      };
      recent.entries?.forEach((entry) => {
        if (entry.roomId === roomId) entry.summaryText = title;
      });
      localStorage.setItem(recentKey, JSON.stringify(recent));
      localStorage.setItem(
        `roomInputReply:${JSON.stringify([userId, roomId])}`,
        JSON.stringify({
          userId,
          eventId: rootId,
          body: `where is the ${word}?`,
          formattedBody: `where is the <b>${word}</b>?`,
        })
      );
    },
    { userId: user, roomId: secret, rootId: secretIds.rootId, word: secretWord, title: secretTitle }
  );
  await page.goto('/home/', { timeout: 180_000 });
  await openRecentlyOpened(page);
  await expect
    .poll(
      async () => {
        const entries = secretEntries(await readStorage(page), user, secret);
        return [secretTitle, 'You said', secretWord].some((text) => holds(entries, text));
      },
      { timeout: 60_000, message: "the older version's texts are deleted" }
    )
    .toBe(false);
  storage = await readStorage(page);
  expect(!!recentEntry(storage, user, plain)?.summaryText).toBe(true);
  expect(replyEntry(storage, user, secret)).toMatchObject({ eventId: secretIds.rootId, body: '' });
  expect(holds(storage[ownDraftKey], unsent)).toBe(true);

  // After the next reload the page reads the texts again from the decrypted events: the recently
  // opened thread shows its text, and back in the room the composer's reply bar quotes the root.
  await page.goto('/home/', { timeout: 180_000 });
  await openRecentlyOpened(page);
  await expect
    .poll(() => shownTitle(page, secret, secretIds.rootId), {
      timeout: 90_000,
      message: "the encrypted room's thread shows its text again",
    })
    .toBe(secretTitle);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/text-at-rest-home-after-reload.png` });
  await page
    .getByTestId('recently-opened-nav-list')
    .locator(`[data-scroll-anchor="${secret}|${secretIds.rootId}"]`)
    .getByRole('button')
    .first()
    .click();
  await expect(composer(page)).toContainText(unsent, { timeout: 90_000 });
  await page
    .locator('[data-thread-context-banner]')
    .getByRole('button', { name: 'Back', exact: true })
    .click();
  const replyBar = page.getByRole('button', { name: 'Cancel reply' }).locator('xpath=..');
  await expect(replyBar).toContainText(secretWord, { timeout: 90_000 });
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/text-at-rest-thread-after-reload.png` });
  // Showing them stores nothing again.
  await page.waitForTimeout(3_000);
  storage = await readStorage(page);
  for (const text of [secretTitle, 'You said', secretWord]) {
    expect(holds(secretEntries(storage, user, secret), text), text).toBe(false);
  }
  // For the record: every key that still holds the word (the person's own messages may).
  writeFileSync(
    test.info().outputPath('keys-holding-the-word.txt'),
    `${Object.keys(storage)
      .filter((key) => holds(storage[key], secretWord))
      .join('\n')}\n`
  );
});
