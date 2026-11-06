import type { Page } from '@playwright/test';
import {
  expect,
  messageRow,
  openLobby,
  showThread,
  startThread,
  streamStatus,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
} from '../helpers/agentStack';

// Typing notices are room-wide, but an agent types for the reply it streams in one thread. A thread
// never names an agent as typing while that agent does not stream there, so a finished thread stays
// quiet while the agent answers in another one. Where the agent's streaming reply is in view, its
// dots and Stop button already say that it writes, so the strip above the composer leaves it out
// too, as MindRoom Chat shows no strip at all: the strip sat 25 px under Stop and covered it on
// each new line of the reply.
test.describe.configure({ timeout: 300_000 });

// AGENT_UI_SHOTS=<directory> also saves screenshots of the result.
const shot = async (page: Page, name: string) => {
  if (process.env.AGENT_UI_SHOTS)
    await page.screenshot({ path: `${process.env.AGENT_UI_SHOTS}/${name}.png` });
};

const typingStrip = (page: Page) => page.getByText('Helper is typing...', { exact: true });

test(
  'an agent streaming in one thread is not named as typing there or in another thread',
  { tag: '@webkit' },
  async ({ page, stack }) => {
    await openLobby(page, stack);
    const word = uniqueWord('typing');
    const finishedId = await startThread(stack, `${word} finished question`);
    await waitForAgentReply(stack, finishedId, (body) => body.includes('finished question'));

    // A long reply streams in another thread.
    const streamingId = await startThread(stack, `${word} long question #stopme`);
    const streaming = await waitForThreadEvent(
      stack,
      streamingId,
      (event) => event.sender === stack.agents.helper && streamStatus(event) === 'streaming',
      { description: 'the long reply streaming' }
    );

    await showThread(page, stack, streamingId);
    // The reply shows its dots and Stop; the strip above the composer stays empty.
    await expect(
      messageRow(page, streaming.event_id).getByRole('button', { name: 'Stop', exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await page.waitForTimeout(3_000);
    await expect(typingStrip(page)).toHaveCount(0);

    await showThread(page, stack, finishedId);
    // Long enough for a typing strip to show.
    await page.waitForTimeout(3_000);
    await expect(typingStrip(page)).toHaveCount(0);
    await shot(page, `typing-finished-thread-${test.info().project.name}`);
  }
);

type Frame = {
  /** The streaming reply's row shows on screen. */
  replyShown: boolean;
  strip: { top: number; bottom: number } | null;
  stop: { top: number; bottom: number } | null;
};

/** The strip, the reply and its Stop button on every animation frame for `ms`. */
const recordFrames = (page: Page, replyId: string, ms: number): Promise<Frame[]> =>
  page.evaluate(
    ([id, duration]) =>
      new Promise<Frame[]>((resolve) => {
        const frames: Frame[] = [];
        const box = (element: Element | null | undefined) => {
          if (!element) return null;
          const { top, bottom } = element.getBoundingClientRect();
          return { top, bottom };
        };
        const started = performance.now();
        const read = () => {
          const row = document.querySelector(`[data-message-id="${id}"]`);
          const rowBox = row?.getBoundingClientRect();
          const strip = [...document.querySelectorAll('[role="status"]')].find((element) =>
            element.textContent?.includes('is typing')
          );
          const stop = row
            ? [...row.querySelectorAll('button')].find(
                (button) => button.textContent?.trim() === 'Stop'
              )
            : undefined;
          frames.push({
            replyShown: !!rowBox && rowBox.bottom > 0 && rowBox.top < window.innerHeight,
            strip: box(strip),
            stop: box(stop),
          });
          if (performance.now() - started < duration) requestAnimationFrame(read);
          else resolve(frames);
        };
        requestAnimationFrame(read);
      }),
    [replyId, ms] as const
  );

test.describe('on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test(
    'the Stop button of a streaming reply is never under a typing strip',
    { tag: '@webkit' },
    async ({ page, stack }) => {
      test.fixme(true, 'design-choices vs earlier E, fix on wip/phone-typing-strip');
      await openLobby(page, stack);
      // 400 words, one every quarter second: the reply fills the screen and grows a line at a time.
      const rootId = await startThread(stack, `${uniqueWord('stopstrip')} #stopme`);
      const streaming = await waitForThreadEvent(
        stack,
        rootId,
        (event) => event.sender === stack.agents.helper && streamStatus(event) === 'streaming',
        { description: 'the long reply streaming' }
      );
      await showThread(page, stack, rootId);
      await expect(
        messageRow(page, streaming.event_id).getByRole('button', { name: 'Stop', exact: true })
      ).toBeVisible({ timeout: 30_000 });
      await shot(page, `typing-stop-phone-${test.info().project.name}`);

      const frames = await recordFrames(page, streaming.event_id, 10_000);
      await shot(page, `typing-stop-phone-streamed-${test.info().project.name}`);
      const streamed = frames.filter((frame) => frame.replyShown && frame.stop);
      expect(streamed.length).toBeGreaterThan(100);
      // No strip while the reply shows, so nothing ever covers Stop.
      const withStrip = streamed.filter((frame) => frame.strip);
      expect(withStrip.length, `frames with a strip, first: ${JSON.stringify(withStrip[0])}`).toBe(
        0
      );
    }
  );
});
