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
  // The row's first paint already has the reply's text: no placeholder, no empty row.
  expect(
    samples.filter(({ words, thinking }) => thinking || words === 0),
    `samples after the load: ${JSON.stringify(samples)}`
  ).toEqual([]);
  const shown = samples.map(({ words }) => words).filter((words) => words > 0);
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
