import {
  expect,
  openLobby,
  showThread,
  startThread,
  streamStatus,
  test,
  uniqueWord,
  waitForThreadEvent,
} from '../helpers/agentStack';
import { setRoomCompact } from '../helpers/roomViewSwitch';

// A reply that streams and finishes while the reader is in another thread of the room previews its
// text on the room's card after a reload (live-test finding P2-lane3-F003: two cards kept
// "Helper: Thinking..." through four reloads, until their threads were opened). The client fetches
// only threads that are opened, so the reply's edits never reached the reply in memory, and the page
// saved the reply as its placeholder. With a live MindRoom backend, desktop, Chromium and WebKit.
// AGENT_UI_SHOTS=<directory> saves the room's cards after the reload.
test.describe.configure({ timeout: 300_000 });

const SHOTS = process.env.AGENT_UI_SHOTS;

test(
  'a reply that finished while the reader was in another thread previews its text after a reload',
  { tag: '@webkit' },
  async ({ page, stack }) => {
    await openLobby(page, stack);
    await setRoomCompact(page, true);
    const otherId = await startThread(stack, `${uniqueWord('cardother')} first question`);
    await showThread(page, stack, otherId);

    // 30 words, one every quarter second, while the reader stays in the other thread.
    const rootId = await startThread(stack, `${uniqueWord('cardclosed')} #slow`);
    await waitForThreadEvent(
      stack,
      rootId,
      (event) => event.sender === stack.agents.helper && streamStatus(event) === 'completed',
      { description: 'the finished reply' }
    );
    // The page saves a reply a second after its last edit.
    await page.waitForTimeout(3_000);

    // Record every text the thread's card shows from the reload on.
    await page.addInitScript((id) => {
      const texts: string[] = [];
      (window as unknown as { cardTexts: string[] }).cardTexts = texts;
      new MutationObserver(() => {
        const card = document.querySelector(`button[data-thread-root-id="${id}"]`);
        const text = card?.textContent ?? '';
        if (card && texts[texts.length - 1] !== text) texts.push(text);
      }).observe(document, { childList: true, subtree: true, characterData: true });
    }, rootId);
    await page.goto(`/home/${encodeURIComponent(stack.rooms.lobby)}`, { timeout: 180_000 });
    const card = page.locator(`button[data-thread-root-id="${rootId}"]`).first();
    await expect(card).toContainText('word30', { timeout: 60_000 });
    if (SHOTS)
      await page.screenshot({
        path: `${SHOTS}/card-closed-thread-${test.info().project.name}.png`,
      });
    const texts = await page.evaluate(
      () => (window as unknown as { cardTexts: string[] }).cardTexts
    );
    expect(
      texts.filter((text) => /Thinking/.test(text)),
      'card texts after the reload that show the placeholder'
    ).toEqual([]);
  }
);
