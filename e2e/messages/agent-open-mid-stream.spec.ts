import type { Page } from '@playwright/test';
import {
  bodyOf,
  expect,
  messageRow,
  openLobby,
  showThread,
  startThread,
  streamStatus,
  test,
  threadUrl,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
} from '../helpers/agentStack';

// Opening a thread while its reply streams shows the reply at least as far as its last edit, then
// live: never first an older, shorter version of it (the live test saw "word1" for a moment where the
// last edit had 142 words, in a browser that had not seen the thread before), and never first the
// thinking placeholder of the reply's original event (the next live test saw "Thinking (26.0s)" for
// up to 430 ms where the last edit had 100+ words, in a browser that had the room open when the
// reply started and then loaded the thread's address).
test.describe.configure({ timeout: 300_000 });

const wordCount = (text: string): number => text.match(/\bword\d+\b/g)?.length ?? 0;

type Sample = { at: number; words: number; thinking: boolean };

/** The words of the reply's newest revision that the page's event cache holds. */
const savedReplyWords = (page: Page, replyId: string): Promise<number> =>
  page.evaluate(async (id) => {
    type Raw = {
      content?: Record<string, unknown>;
      unsigned?: { 'm.relations'?: Record<string, Raw | undefined> };
    };
    let most = 0;
    for (const { name } of await indexedDB.databases()) {
      if (!name) continue;
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      if (db.objectStoreNames.contains('events')) {
        const records = await new Promise<{ eventId?: string; rawEvent?: Raw }[]>((resolve) => {
          const request = db.transaction('events', 'readonly').objectStore('events').getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => resolve([]);
        });
        records
          .filter((record) => record.eventId === id)
          .forEach(({ rawEvent }) => {
            const edit = rawEvent?.unsigned?.['m.relations']?.['m.replace'];
            const newContent = edit?.content?.['m.new_content'] as { body?: unknown } | undefined;
            const body = newContent?.body ?? rawEvent?.content?.body;
            const words = typeof body === 'string' ? body.match(/word\d+/g)?.length ?? 0 : 0;
            most = Math.max(most, words);
          });
      }
      db.close();
    }
    return most;
  }, replyId);

const openMidStream = async (
  page: Page,
  stack: AgentStack,
  rootId: string,
  { reload = false }: { reload?: boolean } = {}
) => {
  // The reply grows over many edits before the page loads the thread (the live test opened it at
  // 100 to 160 words).
  const editedEvent = await waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === stack.agents.helper &&
      streamStatus(event) === 'streaming' &&
      wordCount(bodyOf(event)) > 100,
    { description: 'the helper reply after many edits' }
  );
  const editedWords = wordCount(bodyOf(editedEvent));
  // A page that received the edit saves it a second later (edits are coalesced before they are
  // written); the reload comes after that, so the page has saved what it showed.
  if (reload) await page.waitForTimeout(2_000);
  // What the page holds of the reply before it reloads; it only saves more until then.
  const saved = reload ? await savedReplyWords(page, editedEvent.event_id) : 0;

  // Record the reply row's word count, and whether it shows the thinking placeholder, at every
  // change, from the page load on.
  await page.addInitScript((replyId) => {
    const samples: Sample[] = [];
    (window as unknown as { replySamples: typeof samples }).replySamples = samples;
    const record = () => {
      const row = document.querySelector(`[data-message-id="${replyId}"]`);
      if (!row) return;
      // No word boundaries: the row's text runs the time, the words and Stop together.
      const words = row.textContent?.match(/word\d+/g)?.length ?? 0;
      // The thinking placeholder, not the streaming dots that share its label: it has the mark.
      const thinking = !!row.querySelector('[role="status"] img');
      const last = samples[samples.length - 1];
      if (last?.words !== words || last.thinking !== thinking)
        samples.push({ at: performance.now(), words, thinking });
    };
    new MutationObserver(record).observe(document, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }, editedEvent.event_id);

  await page.goto(threadUrl(stack, rootId), { timeout: 180_000 });
  const reply = messageRow(page, editedEvent.event_id);
  await expect(reply).toBeVisible({ timeout: 90_000 });
  await expect
    .poll(async () => wordCount(await reply.innerText()), { timeout: 60_000 })
    .toBeGreaterThan(editedWords);
  const samples = await page.evaluate(
    () => (window as unknown as { replySamples: Sample[] }).replySamples
  );
  // eslint-disable-next-line no-console
  console.log(`FIRSTPAINT ${test.info().project.name} ${reload ? 'reload' : 'fresh'} ${test.info().title.slice(0, 30)} first=${samples[0]?.at?.toFixed(0)} ${JSON.stringify(samples.slice(0, 3).map(({ at, words, thinking }) => [Math.round(at), words, thinking]))}`);
  // The row's first paint already has the reply's text: no placeholder, no empty row.
  expect(
    samples.filter(({ words, thinking }) => thinking || words === 0),
    `samples after the load: ${JSON.stringify(samples)}`
  ).toEqual([]);
  const shown = samples.map(({ words }) => words).filter((words) => words > 0);
  if (reload) {
    // A reload first paints the newest revision the page holds: at least what its cache saved,
    // which may trail the server's last edit (never a restored older one, such as "word1"); from
    // there the reply only grows.
    expect(saved, 'the page saved the streaming reply before the reload').toBeGreaterThan(0);
    expect(
      shown[0] ?? 0,
      `saved ${saved} words; word counts after the load: ${shown.join(' ')}`
    ).toBeGreaterThanOrEqual(saved);
    expect(
      shown.filter((words, index) => index > 0 && words < (shown[index - 1] ?? 0)),
      `word counts after the load: ${shown.join(' ')}`
    ).toEqual([]);
    return;
  }
  // Nothing much older than the edit the server had before the page loaded: the first paint may
  // trail it by a few words, never by an edit interval (5 s, 20 words).
  expect(Math.min(...shown), `word counts after the load: ${shown.join(' ')}`).toBeGreaterThan(
    editedWords - 20
  );
};

test(
  'a thread opened mid-stream never first shows an older version of the reply',
  { tag: '@webkit' },
  async ({ page, stack }) => {
    // This browser has not seen the thread.
    const rootId = await startThread(stack, `${uniqueWord('midstream')} #stopme`);
    await openMidStream(page, stack, rootId);
  }
);

test(
  'a reload into a thread mid-stream first paints the reply text the room saw start',
  { tag: '@webkit' },
  async ({ page, stack }) => {
    // The room is open when the reply starts, so this browser holds its placeholder, then loads
    // the thread's address.
    await openLobby(page, stack);
    const rootId = await startThread(stack, `${uniqueWord('midreload')} #stopme`);
    await openMidStream(page, stack, rootId, { reload: true });
  }
);

// The client's restored copy of the thread (the SDK's saved sync) can hold the reply's placeholder
// while the page's saved copy has its text; the first paint shows the text (P2-lane3-F002: about
// one run in three showed the placeholder for 415 to 570 ms first).
test(
  'a reload from another thread into a thread mid-stream first paints the reply text',
  { tag: '@webkit' },
  async ({ page, stack }) => {
    // The browser sits in another thread of the room while the reply starts and streams (the live
    // test's second device did), so the client has not fetched the reply's thread, then loads that
    // thread's address.
    await openLobby(page, stack);
    const otherId = await startThread(stack, `${uniqueWord('midother')} first question`);
    await showThread(page, stack, otherId);
    const rootId = await startThread(stack, `${uniqueWord('midreload')} #stopme`);
    await openMidStream(page, stack, rootId, { reload: true });
  }
);
