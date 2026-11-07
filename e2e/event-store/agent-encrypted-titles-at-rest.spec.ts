import type { Page } from '@playwright/test';
import {
  composer,
  createAgentRoom,
  expect,
  mentionHelper,
  test,
  uniqueWord,
  type AgentStack,
} from '../helpers/agentStack';

// Regression (P2-e2ee-F011): the offline cache keeps an encrypted room's events as ciphertext,
// but it kept the room's AI thread titles, read out of decrypted notices, in the clear (store
// `thread_summaries` of `mindroom-cache`). An encrypted room's titles must stay off disk, and the
// client must still show them after a reload; an unencrypted room's titles are still cached.
test.describe.configure({ timeout: 300_000 });

type StoredTitle = { roomId: string; summaryText: string };

/** Every thread title the page's offline caches hold. */
const storedTitles = (page: Page): Promise<StoredTitle[]> =>
  page.evaluate(async () => {
    const names = (await indexedDB.databases())
      .map((database) => database.name)
      .filter((name): name is string => !!name?.startsWith('mindroom-cache'));
    const titles: StoredTitle[] = [];
    for (const name of names) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (db.objectStoreNames.contains('thread_summaries')) {
        const records = await new Promise<StoredTitle[]>((resolve, reject) => {
          const request = db
            .transaction('thread_summaries', 'readonly')
            .objectStore('thread_summaries')
            .getAll();
          request.onsuccess = () => resolve(request.result as StoredTitle[]);
          request.onerror = () => reject(request.error);
        });
        titles.push(...records);
      }
      db.close();
    }
    return titles;
  });

/** Asks the helper in a new room and waits until the thread shows the title the agent gives it. */
const titledThread = async (page: Page, stack: AgentStack, encrypted: boolean) => {
  const word = uniqueWord(encrypted ? 'sealed' : 'open');
  const roomId = await createAgentRoom(
    stack,
    encrypted ? 'Secure titles' : 'Plain titles',
    encrypted
  );
  await page.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  await mentionHelper(page, stack, `${word} planning notes`);
  const title = page.getByText(new RegExp(`Stub title: .*${word}`)).first();
  await expect(title).toBeVisible({ timeout: 90_000 });
  return { roomId, word };
};

test('the thread titles of an encrypted room stay out of the offline cache', async ({
  page,
  stack,
}) => {
  const plain = await titledThread(page, stack, false);
  const secure = await titledThread(page, stack, true);

  // The unencrypted room's title reaches the cache, so the cache is written and read here.
  await expect
    .poll(async () => (await storedTitles(page)).some((title) => title.roomId === plain.roomId), {
      timeout: 30_000,
      message: "the unencrypted room's title is cached",
    })
    .toBe(true);
  const titles = await storedTitles(page);
  expect(titles.filter((title) => title.roomId === secure.roomId)).toEqual([]);
  expect(titles.filter((title) => title.summaryText.includes(secure.word))).toEqual([]);

  // After a reload the client reads the title out of the thread's events again.
  await page.reload();
  await expect(composer(page)).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText(new RegExp(`Stub title: .*${secure.word}`)).first()).toBeVisible({
    timeout: 90_000,
  });
  expect((await storedTitles(page)).filter((title) => title.roomId === secure.roomId)).toEqual([]);
});
