import { writeFileSync } from 'node:fs';
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
// last edit had 142 words, in a browser that had not seen the thread before), and never first the
// thinking placeholder of the reply's original event (the next live test saw "Thinking (26.0s)" for
// up to 430 ms where the last edit had 100+ words).
test.describe.configure({ timeout: 300_000 });

const wordCount = (text: string): number => text.match(/\bword\d+\b/g)?.length ?? 0;

test(
  'a thread opened mid-stream never first shows an older version of the reply',
  { tag: '@webkit' },
  async ({ page, stack }) => {
    const rootId = await startThread(stack, `${uniqueWord('midstream')} #stopme`);
    // The reply grows over many edits before this browser, which has not seen the thread, opens it
    // (the live test opened it at 100 to 160 words).
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

    // Record the reply row's word count, and whether it shows the thinking placeholder, at every
    // change, from the page load on.
    await page.addInitScript((replyId) => {
      const samples: { at: number; words: number; thinking: boolean }[] = [];
      (window as unknown as { replySamples: typeof samples }).replySamples = samples;
      const record = () => {
        const row = document.querySelector(`[data-message-id="${replyId}"]`);
        if (!row) return;
        const words = row.textContent?.match(/\bword\d+\b/g)?.length ?? 0;
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

    const diag: unknown[] = [];
    await page.addInitScript(() => localStorage.setItem('mindroom.debug.timeline', '1'));
    await page.addInitScript((replyId) => {
      const rows: unknown[] = [];
      (window as unknown as { rowLog: unknown[] }).rowLog = rows;
      let last = '';
      const rec = () => {
        const row = document.querySelector(`[data-message-id="${replyId}"]`);
        const text = row ? (row.textContent ?? '').slice(0, 90) : '<none>';
        if (text !== last) {
          last = text;
          rows.push({ t: Date.now(), text });
        }
      };
      new MutationObserver(rec).observe(document, { childList: true, subtree: true, characterData: true });
    }, editedEvent.event_id);
    page.on('console', (msg) => {
      const text = msg.text();
      if (!text.includes('timeline-debug')) return;
      void Promise.all(msg.args().map((a) => a.jsonValue().catch(() => '?'))).then((args) =>
        diag.push({ t: Date.now(), kind: 'console', args })
      );
    });
    page.on('request', (r) => {
      const u = r.url();
      if (/relations|\/threads|\/event\/|\/context\/|\/sync|\/messages/.test(u))
        diag.push({ t: Date.now(), kind: 'req', url: u.replace(/^.*\/_matrix\/client/, '') });
    });
    page.on('requestfinished', (r) => {
      const u = r.url();
      if (/relations|\/threads|\/event\/|\/context\/|\/sync|\/messages/.test(u))
        diag.push({ t: Date.now(), kind: 'done', url: u.replace(/^.*\/_matrix\/client/, '') });
    });
    diag.push({ t: Date.now(), kind: 'goto', replyId: editedEvent.event_id, rootId });
    await page.goto(threadUrl(stack, rootId), { timeout: 180_000 });
    const reply = messageRow(page, editedEvent.event_id);
    await expect(reply).toBeVisible({ timeout: 90_000 });
    await expect
      .poll(async () => wordCount(await reply.innerText()), { timeout: 60_000 })
      .toBeGreaterThan(editedWords);
    const samples = await page.evaluate(
      () =>
        (window as unknown as { replySamples: { words: number; thinking: boolean }[] })
          .replySamples
    );
    const rowLog = await page.evaluate(() => (window as unknown as { rowLog: unknown[] }).rowLog);
    writeFileSync(
      test.info().outputPath('diag.json'),
      JSON.stringify({ diag, rowLog, samples }, null, 1)
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
  }
);
