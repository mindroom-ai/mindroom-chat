import {
  bodyOf,
  expect,
  messageRow,
  startThread,
  streamStatus,
  test,
  threadUrl,
  uniqueWord,
  waitForThreadEvent,
} from '../helpers/agentStack';

// Opening a thread while its reply streams shows the reply at least as far as its last edit, then
// live: never first an older, shorter version of it (the live test saw "word1" for a moment where the
// last edit had 142 words, in a browser that had not seen the thread before).
test.describe.configure({ timeout: 300_000 });

const wordCount = (text: string): number => text.match(/\bword\d+\b/g)?.length ?? 0;

test(
  'a thread opened mid-stream never first shows an older version of the reply',
  { tag: '@webkit' },
  async ({ page, stack }) => {
    const rootId = await startThread(stack, `${uniqueWord('midstream')} #stopme`);
    // The reply grows over a few edits before this browser, which has not seen the thread, opens it.
    const editedEvent = await waitForThreadEvent(
      stack,
      rootId,
      (event) =>
        event.sender === stack.agents.helper &&
        streamStatus(event) === 'streaming' &&
        wordCount(bodyOf(event)) > 40,
      { description: 'the helper reply after a few edits' }
    );
    const editedWords = wordCount(bodyOf(editedEvent));

    // Record the reply row's word count at every change, from the page load on.
    await page.addInitScript((replyId) => {
      const samples: { at: number; words: number }[] = [];
      (window as unknown as { replySamples: typeof samples }).replySamples = samples;
      const record = () => {
        const row = document.querySelector(`[data-message-id="${replyId}"]`);
        if (!row) return;
        const words = row.textContent?.match(/\bword\d+\b/g)?.length ?? 0;
        if (samples[samples.length - 1]?.words !== words)
          samples.push({ at: performance.now(), words });
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
      () => (window as unknown as { replySamples: { words: number }[] }).replySamples
    );
    const shown = samples.map(({ words }) => words).filter((words) => words > 0);
    // Nothing older than the edit the server had before the page loaded.
    expect(
      Math.min(...shown),
      `word counts after the load: ${shown.join(' ')}`
    ).toBeGreaterThanOrEqual(editedWords);
  }
);
