import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  composer,
  createEncryptedAgentRoom,
  expect,
  mentionHelper,
  openNewSession,
  sendFromComposer,
  test,
  type AgentStack,
} from '../helpers/agentStack';
import { matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (P2-e2ee-F005, the streaming part): in an encrypted room, the card of a thread whose
// follow-up reply had finished read "streaming" on WebKit devices, for 15 minutes and through
// reloads, while Chromium showed it finished, and some gave the tester's follow-up question as the
// helper's words. The phone here has the room's keys; a later WebKit session has none.
test.describe.configure({ timeout: 420_000 });

// Set E2EE_SHOTS=<directory> to save each device's room.
const SHOTS = process.env.E2EE_SHOTS;

type Raw = {
  event_id: string;
  sender: string;
  content: Record<string, unknown> & {
    'm.relates_to'?: { rel_type?: string; event_id?: string };
  };
};

const FINISHED = new Set(['completed', 'complete', 'done', 'cancelled', 'error', 'failed']);

/** The tester's question and how many of the helper's replies in its thread have finished. */
const threadState = async (stack: AgentStack, roomId: string) => {
  const { chunk } = await matrixFetch<{ chunk: Raw[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=500`,
    { accessToken: stack.tester.accessToken }
  );
  const root = chunk.find(
    (event) => event.sender === stack.tester.userId && !event.content['m.relates_to']
  );
  const finished = new Set(
    chunk
      .filter(
        (event) =>
          event.sender === stack.agents.helper &&
          event.content['m.relates_to']?.rel_type === 'm.replace' &&
          FINISHED.has(String(event.content['io.mindroom.stream_status']))
      )
      .map((event) => event.content['m.relates_to']?.event_id)
  );
  return { rootId: root?.event_id, finished: finished.size };
};

const waitForFinishedReplies = async (stack: AgentStack, roomId: string, count: number) => {
  await expect
    .poll(async () => (await threadState(stack, roomId)).finished, {
      timeout: 120_000,
      intervals: [1000],
      message: `${count} finished replies`,
    })
    .toBeGreaterThanOrEqual(count);
};

/**
 * The card's text holds no "streaming" for 15 polls in a row (a second apart), and never gives the
 * tester's follow-up question as the helper's words.
 */
const expectCardSettled = async (page: Page, rootId: string, log: string[], who: string) => {
  const card = page.locator(`[data-thread-root-id="${rootId}"]`).first();
  await expect(card).toBeVisible({ timeout: 90_000 });
  let held = 0;
  let misattributed = false;
  await expect
    .poll(
      async () => {
        const text = (await card.innerText().catch(() => '')).replace(/\s+/g, ' ');
        log.push(`${who}: ${text}`);
        if (!misattributed && /Helper: #slow follow up/.test(text)) {
          misattributed = true;
          const name = `misattributed-${who.replace(/ /g, '-')}.png`;
          await page.screenshot({ path: test.info().outputPath(name) });
        }
        held = /\bstreaming\b/i.test(text) ? 0 : held + 1;
        return held >= 15;
      },
      { timeout: 90_000, intervals: [1000], message: `${who}: the finished thread does not stream` }
    )
    .toBe(true);
  expect(misattributed, `${who}: the question shows as the helper's`).toBe(false);
};

test("an encrypted room's card shows a finished follow-up reply as finished (WebKit)", async ({
  page: desk,
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const log: string[] = [];
  const webkit = await launchWebKit();
  try {
    // Both devices exist before the room does, so both receive its keys.
    await desk.goto('/home/', { timeout: 180_000 });
    const phone = await openNewSession(webkit, stack, {
      baseURL,
      viewport: { width: 390, height: 844 },
      hasTouch: true,
    });
    const roomId = await createEncryptedAgentRoom(stack, 'Secure follow-up');
    const room = encodeURIComponent(roomId);

    // A first reply, then a follow-up in the same thread; both stream and finish.
    await desk.goto(`/home/${room}`, { timeout: 180_000 });
    await expect(composer(desk)).toBeVisible({ timeout: 90_000 });
    await mentionHelper(desk, stack, '#slow what changed in the release?');
    await waitForFinishedReplies(stack, roomId, 1);
    const { rootId } = await threadState(stack, roomId);
    if (!rootId) throw new Error("The tester's question is not in the room");
    await desk.goto(`/home/${room}?threadId=${encodeURIComponent(rootId)}`, { timeout: 180_000 });
    await expect(composer(desk)).toBeVisible({ timeout: 90_000 });
    await sendFromComposer(desk, '#slow follow up in thread');
    await waitForFinishedReplies(stack, roomId, 2);

    // A WebKit device that signs in afterwards holds none of the room's keys.
    const keyless = await openNewSession(webkit, stack, {
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    for (const [who, page] of [
      ['phone', phone],
      ['keyless WebKit', keyless],
      ['desk', desk],
    ] as Array<[string, Page]>) {
      // eslint-disable-next-line no-await-in-loop
      await page.goto(`/home/${room}`, { timeout: 180_000 });
      // eslint-disable-next-line no-await-in-loop
      await expectCardSettled(page, rootId, log, who);
      if (SHOTS) {
        // eslint-disable-next-line no-await-in-loop
        await page.screenshot({ path: `${SHOTS}/follow-up-card-${who.replace(/ /g, '-')}.png` });
      }
    }
  } finally {
    writeFileSync(test.info().outputPath('cards.log'), `${log.join('\n')}\n`);
    await webkit.close();
  }
});
