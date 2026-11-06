import {
  bodyOf,
  expect,
  inThread,
  lobbyEvents,
  messageRow,
  openLobby,
  showThread,
  startThread,
  streamStatus,
  test,
  threadUrl,
  uniqueWord,
  waitForThreadEvent,
} from '../helpers/agentStack';

// Opening a thread while its reply streams shows the reply at least as far as its last edit, then
// live: never first an older, shorter version of it (the live test saw "word1" for a moment where the
// last edit had 142 words).
test.describe.configure({ timeout: 300_000 });

const wordCount = (text: string): number => text.match(/\bword\d+\b/g)?.length ?? 0;

test(
  'a thread opened mid-stream never first shows an older version of the reply',
  { tag: '@webkit' },
  async ({ page, stack }) => {
    await openLobby(page, stack);
    const rootId = await startThread(stack, `${uniqueWord('midstream')} #stopme`);
    await showThread(page, stack, rootId);
    const pending = await waitForThreadEvent(
      stack,
      rootId,
      (event) => event.sender === stack.agents.helper && event.type === 'm.room.message',
      { description: "the helper's reply" }
    );
    const reply = messageRow(page, pending.event_id);
    // Let the reply grow over a few edits while this page keeps it.
    await expect
      .poll(async () => wordCount(await reply.innerText()), { timeout: 60_000 })
      .toBeGreaterThan(40);

    // From the next page load on, record the reply row's word count at every change.
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
    }, pending.event_id);

    const lastEdit = (await lobbyEvents(stack)).find(
      (event) => event.event_id === pending.event_id && inThread(event, rootId)
    );
    expect(streamStatus(lastEdit!)).toBe('streaming');
    const editedWords = wordCount(bodyOf(lastEdit!));
    expect(editedWords).toBeGreaterThan(20);

    await page.goto(threadUrl(stack, rootId), { timeout: 180_000 });
    await expect(reply).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(async () => wordCount(await reply.innerText()), { timeout: 60_000 })
      .toBeGreaterThan(editedWords);
    const samples = await page.evaluate(
      () => (window as unknown as { replySamples: { words: number }[] }).replySamples
    );
    const shown = samples.map(({ words }) => words).filter((words) => words > 0);
    // The page may first show an edit one interval (5 s, 20 words) older than the one read above.
    expect(
      Math.min(...shown),
      `word counts after the load: ${shown.join(' ')}`
    ).toBeGreaterThanOrEqual(editedWords - 25);
  }
);
