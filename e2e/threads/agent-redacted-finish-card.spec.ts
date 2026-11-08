import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  composer,
  createAgentRoom,
  expect,
  mentionHelper,
  openNewSession,
  test,
  type AgentStack,
  type MatrixEvent,
} from '../helpers/agentStack';
import { matrixFetch, redactEvent } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (P3-webkit-cards-F004): a finished streamed reply whose finishing edit was redacted
// showed "streaming" on its card on the devices that watched it, for good, while others showed it
// finished. The redaction takes the reply back to the edit before, which still says it streams,
// but the reply's stream ended: nothing streams any more.
test.describe.configure({ timeout: 420_000 });

const FINISHED = new Set(['completed', 'complete', 'done', 'cancelled', 'error', 'failed']);

const roomEvents = async (stack: AgentStack, roomId: string): Promise<MatrixEvent[]> =>
  (
    await matrixFetch<{ chunk: MatrixEvent[] }>(
      stack.homeserver,
      `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=200`,
      { accessToken: stack.tester.accessToken }
    )
  ).chunk;

/** The tester's question and the helper's edit that finished its reply. */
const finishedReply = async (stack: AgentStack, roomId: string) => {
  let found: { rootId: string; finishId: string } | undefined;
  await expect
    .poll(
      async () => {
        const events = await roomEvents(stack, roomId);
        const root = events.find(
          (event) => event.sender === stack.tester.userId && !event.content['m.relates_to']
        );
        const finish = events.find(
          (event) =>
            event.sender === stack.agents.helper &&
            (event.content['m.relates_to'] as { rel_type?: string } | undefined)?.rel_type ===
              'm.replace' &&
            FINISHED.has(String(event.content['io.mindroom.stream_status']))
        );
        found = root && finish ? { rootId: root.event_id, finishId: finish.event_id } : undefined;
        return !!found;
      },
      { timeout: 120_000, intervals: [1000], message: 'the finished reply' }
    )
    .toBe(true);
  return found as { rootId: string; finishId: string };
};

const card = (page: Page, rootId: string) =>
  page.locator(`button[data-thread-root-id="${rootId}"][data-attention-state]`).first();

/** The card does not say "streaming" for 15 polls in a row, a second apart. */
const expectCardFinished = async (page: Page, rootId: string, who: string, log: string[]) => {
  let held = 0;
  await expect
    .poll(
      async () => {
        const state = await card(page, rootId).getAttribute('data-attention-state');
        log.push(`${who}: ${state}`);
        held = state === 'streaming' ? 0 : held + 1;
        return held >= 15;
      },
      { timeout: 60_000, intervals: [1000], message: `${who}: the card does not stream` }
    )
    .toBe(true);
};

test("a reply whose finishing edit was redacted stays finished on its card's watchers", async ({
  page: desk,
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const log: string[] = [];
  const webkit = await launchWebKit();
  try {
    const roomId = await createAgentRoom(stack, 'Redacted finish', false);
    const room = encodeURIComponent(roomId);
    const phone = await openNewSession(webkit, stack, {
      baseURL,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    await desk.goto(`/home/${room}`, { timeout: 180_000 });
    await phone.goto(`/home/${room}`, { timeout: 180_000 });
    await expect(composer(desk)).toBeVisible({ timeout: 90_000 });
    await mentionHelper(desk, stack, '#slow what changed in the release?');
    const { rootId, finishId } = await finishedReply(stack, roomId);
    // Compact's composer opened the new thread; its card is in the room's list.
    await desk.goto(`/home/${room}`, { timeout: 180_000 });
    const watchers: Array<[string, Page]> = [
      ['desk', desk],
      ['phone', phone],
    ];
    for (const [who, page] of watchers) {
      // eslint-disable-next-line no-await-in-loop
      await expect(card(page, rootId)).toBeVisible({ timeout: 90_000 });
      // eslint-disable-next-line no-await-in-loop
      await expectCardFinished(page, rootId, `${who} before`, log);
    }

    // The room's admin redacts the edit that finished the reply.
    await redactEvent(stack.homeserver, stack.tester.accessToken, roomId, finishId);
    for (const [who, page] of watchers) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await expectCardFinished(page, rootId, `${who} after the redaction`, log);
      } finally {
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({ path: test.info().outputPath(`redacted-finish-${who}.png`) });
      }
    }
  } finally {
    writeFileSync(test.info().outputPath('cards.log'), `${log.join('\n')}\n`);
    await webkit.close();
  }
});
