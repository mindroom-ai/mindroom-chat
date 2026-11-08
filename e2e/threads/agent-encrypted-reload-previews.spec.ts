import { writeFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  composer,
  createEncryptedAgentRoom,
  expect,
  mentionHelper,
  openNewSession,
  test,
  type AgentStack,
} from '../helpers/agentStack';
import { matrixFetch } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// Regression (P3-webkit-cards-F010): in an encrypted room with many threads, each a person's
// question, the helper's reply and its title notice, a device that had shown every reply showed,
// after a reload, the person's own question on the cards of the older threads instead of the
// helper's reply, on WebKit and Chromium, and kept it while the threads stayed quiet. The server
// bundles no previews for encrypted rooms, and the thread's summary names its title notice, so a
// card knows the reply only from the thread's events: the ones the device loaded, or the copies
// its event cache holds.
test.describe.configure({ timeout: 900_000 });

const THREADS = Number(process.env.ENCRYPTED_RELOAD_THREADS ?? '24');
/**
 * Room events sent after the threads, so that they are older than what a reload restores without
 * the threads: the saved sync keeps a room's latest 500 events (LARGE_SYNC_ARCHIVE_TIMELINE_LIMIT),
 * about 40 of the finding's threads.
 */
const LATER_EVENTS = Number(process.env.ENCRYPTED_RELOAD_LATER_EVENTS ?? '600');
// Set ENCRYPTED_RELOAD_SHOTS=<directory> to save each device's room.
const SHOTS = process.env.ENCRYPTED_RELOAD_SHOTS;

type ServedEvent = {
  event_id: string;
  sender: string;
  content: { 'm.relates_to'?: unknown };
  unsigned?: { 'm.relations'?: { 'm.thread'?: { count?: number } } };
};

/** The tester's thread roots, from the room's history (the thread list lists encrypted rooms partly). */
const testerRoots = async (stack: AgentStack, roomId: string): Promise<ServedEvent[]> => {
  const { chunk } = await matrixFetch<{ chunk: ServedEvent[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=1000`,
    { accessToken: stack.tester.accessToken }
  );
  return chunk.filter(
    (event) => event.sender === stack.tester.userId && !event.content['m.relates_to']
  );
};

/** Events of a type nobody shows or answers, which only move the room's history on. */
const sendLaterEvents = async (stack: AgentStack, roomId: string) => {
  const send = (index: number) =>
    matrixFetch(
      stack.homeserver,
      `/rooms/${encodeURIComponent(
        roomId
      )}/send/io.mindroom.e2e.later/later-${Date.now()}-${index}`,
      {
        method: 'PUT',
        accessToken: stack.tester.accessToken,
        body: JSON.stringify({ index }),
      }
    );
  for (let start = 0; start < LATER_EVENTS; start += 20) {
    // eslint-disable-next-line no-await-in-loop
    await Promise.all(
      Array.from({ length: Math.min(20, LATER_EVENTS - start) }, (_, offset) =>
        send(start + offset)
      )
    );
  }
};

/** What the last poll saw, for the log when the wait fails. */
let lastPoll = '';

/** The tester's threads that hold the helper's reply and its title notice, by the root's own summary. */
const answeredThreads = async (stack: AgentStack, roomId: string): Promise<ServedEvent[]> => {
  const roots = await testerRoots(stack, roomId);
  const served = await Promise.all(
    roots.map((root) =>
      matrixFetch<ServedEvent>(
        stack.homeserver,
        `/rooms/${encodeURIComponent(roomId)}/event/${encodeURIComponent(root.event_id)}`,
        { accessToken: stack.tester.accessToken }
      )
    )
  );
  const counts = served.map((root) => root.unsigned?.['m.relations']?.['m.thread']?.count ?? 0);
  const { chunk: listed } = await matrixFetch<{ chunk: ServedEvent[] }>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(roomId)}/threads?limit=100`,
    { accessToken: stack.tester.accessToken, apiVersion: 'v1' }
  );
  lastPoll = `the tester's roots ${roots.length}, counts ${counts.join(',')}; /threads lists ${
    listed.length
  }`;
  return served.filter((_root, index) => (counts[index] ?? 0) >= 2);
};

/** Waits until every thread has the helper's reply and its title notice. */
const waitForAnsweredThreads = async (stack: AgentStack, roomId: string, count: number) => {
  await expect
    .poll(async () => (await answeredThreads(stack, roomId)).length, {
      timeout: 420_000,
      intervals: [2000],
      message: `${count} answered and titled threads`,
    })
    .toBeGreaterThanOrEqual(count);
};

type CardText = { rootId: string; preview: string };

const cardTexts = (page: Page): Promise<CardText[]> =>
  page.locator('button[data-thread-root-id][data-attention-state]').evaluateAll((elements) =>
    elements.map((element) => ({
      rootId: element.getAttribute('data-thread-root-id') ?? '',
      // The card's second row is its preview: "<sender>: <text>".
      preview: (element.querySelector(':scope > div:nth-of-type(2)')?.textContent ?? '').trim(),
    }))
  );

/** Cards whose preview is not the helper's reply ("Hello from ...", the stub's answer). */
const cardsWithoutReply = async (page: Page, rootIds: Set<string>): Promise<CardText[]> =>
  (await cardTexts(page)).filter(
    (card) => rootIds.has(card.rootId) && !card.preview.includes('Hello from')
  );

const reloadKeepsReplies = async (
  page: Page,
  roomId: string,
  rootIds: Set<string>,
  who: string,
  log: string[]
) => {
  const room = encodeURIComponent(roomId);
  const allCards = page.locator('button[data-thread-root-id][data-attention-state]');
  // Live, the device shows every reply.
  await page.goto(`/home/${room}`, { timeout: 180_000 });
  await expect.poll(() => allCards.count(), { timeout: 90_000 }).toBeGreaterThanOrEqual(THREADS);
  await expect
    .poll(async () => (await cardsWithoutReply(page, rootIds)).length, {
      timeout: 120_000,
      intervals: [1000],
      message: `${who}: every card previews the reply before the reload`,
    })
    .toBe(0);

  await page.reload({ timeout: 180_000 });
  await expect.poll(() => allCards.count(), { timeout: 90_000 }).toBeGreaterThanOrEqual(THREADS);
  const startedAt = Date.now();
  let wrong: CardText[] = [];
  // The finding's count rose for about 10 s after the reload, then stayed; read for 30 s.
  for (const at of [3_000, 10_000, 20_000, 30_000]) {
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(Math.max(0, startedAt + at - Date.now()));
    // eslint-disable-next-line no-await-in-loop
    wrong = await cardsWithoutReply(page, rootIds);
    log.push(`${who} +${at / 1000}s: ${wrong.length} of ${rootIds.size} cards without the reply`);
    wrong.forEach((card) => log.push(`  ${card.rootId}: ${card.preview}`));
  }
  if (SHOTS) {
    await allCards.last().scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${SHOTS}/reload-previews-${who}.png` });
  }
  expect(
    wrong,
    `${who}: cards that preview something else than the reply after the reload`
  ).toEqual([]);
};

test("after a reload, an encrypted room's older cards still preview the replies", async ({
  page: desk,
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const log: string[] = [];
  const webkit = await launchWebKit();
  try {
    // Both devices exist before the room does, so both receive its keys.
    await desk.setViewportSize({ width: 1440, height: 900 });
    await desk.goto('/home/', { timeout: 180_000 });
    const phone = await openNewSession(webkit, stack, {
      baseURL,
      viewport: { width: 1440, height: 900 },
    });
    const roomId = await createEncryptedAgentRoom(stack, 'Secure board');
    const room = encodeURIComponent(roomId);
    await phone.goto(`/home/${room}`, { timeout: 180_000 });

    await desk.goto(`/home/${room}`, { timeout: 180_000 });
    const banner = desk.locator('[data-thread-context-banner]');
    for (let i = 0; i < THREADS; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await expect(composer(desk)).toBeVisible({ timeout: 90_000 });
      // eslint-disable-next-line no-await-in-loop
      await mentionHelper(desk, stack, `Board item ${i} needs an answer`);
      // Compact's composer starts a thread and opens it; the next question starts from the room.
      // eslint-disable-next-line no-await-in-loop
      await banner.getByRole('button', { name: 'Back', exact: true }).click({ timeout: 30_000 });
      // eslint-disable-next-line no-await-in-loop
      await expect(banner).toHaveCount(0, { timeout: 30_000 });
    }
    try {
      await waitForAnsweredThreads(stack, roomId, THREADS);
    } finally {
      log.push(`server: ${lastPoll}`);
    }
    await sendLaterEvents(stack, roomId);
    const rootIds = new Set(
      (await answeredThreads(stack, roomId)).map((thread) => thread.event_id)
    );

    for (const [who, page] of [
      ['webkit', phone],
      ['chromium', desk],
    ] as Array<[string, Page]>) {
      // eslint-disable-next-line no-await-in-loop
      await reloadKeepsReplies(page, roomId, rootIds, who, log);
    }
  } finally {
    writeFileSync(test.info().outputPath('cards.log'), `${log.join('\n')}\n`);
    await webkit.close();
  }
});
