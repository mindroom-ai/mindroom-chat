import {
  expect,
  messageRow,
  openLobby,
  showThread,
  startThread,
  streamStatus,
  test,
  uniqueWord,
  waitForThreadEvent,
} from '../helpers/agentStack';

// A tap on Stop of a streaming reply on a phone opens no message toolbar (live-test finding
// P2-lane3-F004). The cancelled reply ends shorter than the text the reader saw, so the thread's
// rows move, and the row that slid under the finger opened its hover toolbar over its own text,
// where it stayed. With a live MindRoom backend, phone 390 by 844 with touch, in Chromium and
// WebKit. AGENT_UI_SHOTS=<directory> saves the thread after the Stop.
test.describe.configure({ timeout: 300_000 });

const SHOTS = process.env.AGENT_UI_SHOTS;
const wordCount = (text: string): number => text.match(/\bword\d+\b/g)?.length ?? 0;

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test(
    'a tap on Stop of a streaming reply opens no message toolbar',
    { tag: '@webkit' },
    async ({ page, stack }) => {
      await openLobby(page, stack);
      // 400 words, one every quarter second.
      const rootId = await startThread(stack, `${uniqueWord('phonestop')} #stopme`);
      await showThread(page, stack, rootId);
      const streaming = await waitForThreadEvent(
        stack,
        rootId,
        (event) => event.sender === stack.agents.helper && streamStatus(event) === 'streaming',
        { description: 'a streaming reply' }
      );
      const reply = messageRow(page, streaming.event_id);
      const stop = reply.getByRole('button', { name: 'Stop', exact: true });
      await expect(stop).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(async () => wordCount(await reply.innerText()), { timeout: 60_000 })
        .toBeGreaterThanOrEqual(40);
      await stop.tap();

      await waitForThreadEvent(
        stack,
        rootId,
        (event) => event.event_id === streaming.event_id && streamStatus(event) === 'cancelled',
        { description: 'the cancelled reply' }
      );
      await expect(reply).toContainText('[Response cancelled by user]', { timeout: 30_000 });
      // Long enough for the rows to settle and for a toolbar to show.
      await page.waitForTimeout(3_000);
      if (SHOTS)
        await page.screenshot({
          path: `${SHOTS}/stop-phone-toolbar-${test.info().project.name}.png`,
        });
      await expect(
        page.getByRole('button', { name: 'More Options', exact: true }).filter({ visible: true }),
        'message toolbars after the tap on Stop'
      ).toHaveCount(0);
    }
  );
});
