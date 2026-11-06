import type { Browser, BrowserContextOptions, Locator, Page } from '@playwright/test';
import {
  bodyOf,
  expect,
  openNewSession,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
  type AgentStack,
  type MatrixEvent,
} from '../helpers/agentStack';
import { createPrivateRoom, sendRoomMessage, sendStateEvent } from '../helpers/matrix';
import { launchWebKit, WEBKIT_EXECUTABLE } from '../helpers/webkit';

// MindRoom titles a thread with an `m.notice` thread event that carries `io.mindroom.thread_summary`.
// The server's thread summary names that notice as the thread's latest event until someone writes
// after it. A card the device has not loaded knows the thread only from that summary, and a card
// on screen loads the thread's latest page. Two devices of one account, against a real MindRoom
// backend with the stub model:
// - L4-F028: a device that signed in after the titles were written shows each title it learned
//   (from the summary or from a loaded page) also after a later reply and after a reload, while
//   the threads are not loaded again.
// - L4-F028 at scale: in a room whose titles are older than the history a new device reads first,
//   the device shows every title once the room's state holds them, as MindRoom is to write them.
// - L6-F007: after a reload, the card of a thread whose reply the device received but never
//   loaded previews the agent's reply, not the person's prompt, while the summary names the title.
test.describe.configure({ timeout: 420_000 });

const PHONE: BrowserContextOptions = {
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
};

const summaryOf = (event: MatrixEvent): unknown =>
  (event.content['io.mindroom.thread_summary'] as { summary?: unknown } | undefined)?.summary;

const card = (page: Page, rootId: string): Locator =>
  page.locator(`button[data-thread-root-id="${rootId}"]`).first();
// The title line carries the full title as its tooltip; the second row is the preview.
const cardTitle = (page: Page, rootId: string): Locator =>
  card(page, rootId).locator(':scope > div').first().locator('[title]').first();
const cardPreview = (page: Page, rootId: string): Locator =>
  card(page, rootId).locator(':scope > div').nth(1);

const lobbyUrl = (stack: AgentStack) => `/home/${encodeURIComponent(stack.rooms.lobby)}`;

/**
 * Holds every request that would load one of these threads, as if their cards were never shown:
 * a request that does not answer leaves the thread unloaded.
 */
const holdThreadLoads = async (page: Page, rootIds: string[]) => {
  const encoded = rootIds.map((rootId) => encodeURIComponent(rootId));
  await page.route(
    (url) =>
      url.pathname.includes('/relations/') &&
      encoded.some((rootId) => url.pathname.includes(rootId)),
    () => undefined
  );
};

type TitledThread = { rootId: string; title: string };

/** A lobby thread the helper answered and MindRoom titled. */
const titledThread = async (stack: AgentStack, prompt: string): Promise<TitledThread> => {
  const rootId = await startThread(stack, prompt);
  await waitForAgentReply(stack, rootId, (body) => body.includes('You said'), {
    timeout: 120_000,
  });
  const notice = await waitForThreadEvent(
    stack,
    rootId,
    (event) => typeof summaryOf(event) === 'string',
    { timeout: 120_000, description: "the thread's title" }
  );
  return { rootId, title: String(summaryOf(notice)) };
};

/** The tester writes in the thread and the helper answers: the title is no longer the newest event. */
const continueThread = async (stack: AgentStack, rootId: string, text: string) => {
  await sendRoomMessage(stack.homeserver, stack.tester.accessToken, stack.rooms.lobby, {
    msgtype: 'm.text',
    body: text,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });
  await waitForThreadEvent(
    stack,
    rootId,
    (event) =>
      event.sender === stack.agents.helper &&
      event.content['io.mindroom.stream_status'] === 'completed' &&
      bodyOf(event).includes(text),
    { timeout: 120_000, description: 'the second reply' }
  );
};

/** Waits until the card's first line reads the title, attaching every card's text when it does not. */
const expectCardTitle = async (page: Page, rootId: string, title: string, step: string) => {
  try {
    await expect(cardTitle(page, rootId)).toHaveAttribute('title', title, { timeout: 30_000 });
  } catch (error) {
    const cards = await page
      .locator('button[data-thread-root-id]')
      .evaluateAll((elements) =>
        elements.map(
          (element) => `${element.getAttribute('data-thread-root-id')}: ${element.textContent}`
        )
      );
    await test.info().attach(`${step}-cards.txt`, { body: cards.join('\n') });
    await page.screenshot({ path: test.info().outputPath(`${step}.png`) });
    throw error;
  }
};

const secondDeviceKeepsTitles = async (
  stack: AgentStack,
  browser: Browser,
  baseURL: string | undefined,
  engine: string
) => {
  const word = uniqueWord('titles');
  // Titled, then continued: its title is in no server summary, only in the thread's history.
  const continued = await titledThread(stack, `${word} continued thread`);
  await continueThread(stack, continued.rootId, `${word} one more question`);
  // Titled last: the server's summary names the title.
  const listed = await titledThread(stack, `${word} listed thread`);

  const second = await openNewSession(browser, stack, { baseURL, ...PHONE });
  try {
    // The listed thread is never loaded on this device; the continued one loads once, on screen.
    await holdThreadLoads(second, [listed.rootId]);
    await second.goto(lobbyUrl(stack), { timeout: 180_000 });
    await expectCardTitle(second, listed.rootId, listed.title, `${engine}-first-load`);
    await expectCardTitle(second, continued.rootId, continued.title, `${engine}-first-load`);

    // Someone writes in the listed thread: the server's summary moves past the title.
    await continueThread(stack, listed.rootId, `${word} a later question`);
    // The live sync brings the reply within moments.
    await second.waitForTimeout(5_000);
    await expectCardTitle(second, listed.rootId, listed.title, `${engine}-later-reply`);

    // After a reload, neither thread loads again.
    await holdThreadLoads(second, [continued.rootId]);
    await second.reload({ timeout: 180_000 });
    await expect(card(second, listed.rootId)).toBeVisible({ timeout: 90_000 });
    await expectCardTitle(second, listed.rootId, listed.title, `${engine}-reload`);
    await expectCardTitle(second, continued.rootId, continued.title, `${engine}-reload`);
    await second.screenshot({ path: test.info().outputPath(`second-device-${engine}.png`) });
  } finally {
    await second.context().close();
  }
};

test('a second device keeps the titles it learned, without loading the threads again', async ({
  stack,
  browser,
  baseURL,
}) => {
  await secondDeviceKeepsTitles(stack, browser, baseURL, 'chromium');
});

test('a second device keeps the titles it learned, without loading the threads again (WebKit)', async ({
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const webkit = await launchWebKit();
  try {
    await secondDeviceKeepsTitles(stack, webkit, baseURL, 'webkit');
  } finally {
    await webkit.close();
  }
});

/**
 * The device is in another room while a thread of the lobby gets its reply and title, so the
 * thread is never loaded; after a reload its card previews the reply, while its thread loads are
 * held (as for an off-screen card).
 */
const reloadKeepsReplyPreview = async (page: Page, stack: AgentStack, engine: string) => {
  const elsewhere = await createPrivateRoom(stack.homeserver, stack.tester.accessToken, {
    name: `Elsewhere ${uniqueWord('room')}`,
    topic: 'A room without agents',
  });
  await page.goto(`/home/${encodeURIComponent(elsewhere)}`, { timeout: 180_000 });
  await expect(page.getByRole('textbox', { name: 'Send a message...' })).toBeVisible({
    timeout: 90_000,
  });
  const word = uniqueWord('preview');
  const rootId = await startThread(stack, `${word} please answer`);
  await waitForAgentReply(stack, rootId, (body) => body.includes('You said'), {
    timeout: 120_000,
  });
  await waitForThreadEvent(stack, rootId, (event) => typeof summaryOf(event) === 'string', {
    timeout: 120_000,
    description: "the thread's title",
  });
  // The live sync brings the events within moments; the card in the lobby is not mounted.
  await page.waitForTimeout(5_000);

  await holdThreadLoads(page, [rootId]);
  await page.goto(lobbyUrl(stack), { timeout: 180_000 });
  await expect(card(page, rootId)).toBeVisible({ timeout: 90_000 });
  try {
    // The stub's reply quotes the prompt after "Hello from".
    await expect(cardPreview(page, rootId)).toContainText('Hello from', { timeout: 30_000 });
  } finally {
    await page.screenshot({ path: test.info().outputPath(`reload-preview-${engine}.png`) });
  }
};

test('after a reload, the card of a thread never loaded previews the reply', async ({
  page,
  stack,
}) => {
  await reloadKeepsReplyPreview(page, stack, 'chromium');
});

test('after a reload, the card of a thread never loaded previews the reply (WebKit)', async ({
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const webkit = await launchWebKit();
  try {
    const page = await openNewSession(webkit, stack, { baseURL, ...PHONE });
    await reloadKeepsReplyPreview(page, stack, 'webkit');
  } finally {
    await webkit.close();
  }
});

const BOARD_THREADS = 120;

const threadRelation = (rootId: string, lastId: string) => ({
  rel_type: 'm.thread',
  event_id: rootId,
  is_falling_back: true,
  'm.in_reply_to': { event_id: lastId },
});

/**
 * A room of the tester with 120 threads, every second one titled after its first reply and
 * continued after its title, as a busy MindRoom room is: about 800 events, so the titles of the
 * older threads are in history a new device does not read at first. With `titlesInState`, the
 * room's state holds each title as MindRoom is to write it.
 */
const seedBoard = async (stack: AgentStack, titlesInState: boolean) => {
  const roomId = await createPrivateRoom(stack.homeserver, stack.tester.accessToken, {
    name: `Board ${uniqueWord('board')}`,
    topic: 'Busy board',
  });
  const send = (content: Record<string, unknown>) =>
    sendRoomMessage(stack.homeserver, stack.tester.accessToken, roomId, content);
  const titles = new Map<string, string>();
  for (let i = 0; i < BOARD_THREADS; i += 1) {
    const rootId = await send({ msgtype: 'm.text', body: `Topic ${i}. Can you take a look?` });
    let last = await send({
      msgtype: 'm.text',
      body: `Reply 1 on topic ${i}`,
      'm.relates_to': threadRelation(rootId, rootId),
    });
    if (i % 2 === 0) {
      const title = `Title of topic ${i}`;
      const metadata = {
        version: 1,
        summary: title,
        message_count: 1,
        generated_at: new Date().toISOString(),
        model: 'default',
      };
      const noticeId = await send({
        msgtype: 'm.notice',
        body: title,
        'm.relates_to': threadRelation(rootId, last),
        'io.mindroom.thread_summary': metadata,
      });
      if (titlesInState)
        await sendStateEvent(
          stack.homeserver,
          stack.tester.accessToken,
          roomId,
          'io.mindroom.thread_summary',
          rootId,
          { ...metadata, event_id: noticeId }
        );
      titles.set(rootId, title);
    }
    for (let r = 2; r <= 2 + (i % 8); r += 1) {
      last = await send({
        msgtype: 'm.text',
        body: `Reply ${r} on topic ${i}`,
        'm.relates_to': threadRelation(rootId, last),
      });
    }
  }
  return { roomId, titles };
};

/** How many of the room's Compact cards (on screen or not) show their thread's title. */
const countTitledCards = async (page: Page, titles: Map<string, string>) => {
  const cards = await page
    .locator('button[data-thread-root-id][data-attention-state]')
    .evaluateAll((elements) =>
      elements.map((element) => [
        element.getAttribute('data-thread-root-id') ?? '',
        element.querySelector(':scope > div [title]')?.getAttribute('title') ?? '',
      ])
    );
  return cards.filter(([rootId, shown]) => !!rootId && titles.get(rootId) === shown).length;
};

const newDeviceKnowsTitlesFromState = async (
  stack: AgentStack,
  browser: Browser,
  baseURL: string | undefined,
  engine: string
) => {
  const { roomId, titles } = await seedBoard(stack, true);
  const device = await openNewSession(browser, stack, { baseURL, ...PHONE });
  try {
    await device.goto(`/home/${encodeURIComponent(roomId)}`, { timeout: 180_000 });
    // A room without agents opens in its timeline; the switch moves it to Compact.
    const toggle = device.locator('[data-room-view-switch]');
    await expect(toggle).toBeVisible({ timeout: 90_000 });
    if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(() => device.locator('button[data-thread-root-id][data-attention-state]').count(), {
        timeout: 60_000,
      })
      .toBe(BOARD_THREADS);
    try {
      await expect
        .poll(() => countTitledCards(device, titles), {
          timeout: 20_000,
          message: 'every titled thread shows its title',
        })
        .toBe(titles.size);
    } finally {
      // The oldest threads, whose titles are furthest back in the room's history.
      await device
        .locator('button[data-thread-root-id][data-attention-state]')
        .last()
        .scrollIntoViewIfNeeded();
      await device.screenshot({ path: test.info().outputPath(`state-titles-${engine}.png`) });
    }
  } finally {
    await device.context().close();
  }
};

test("a new device shows every title the room's state holds", async ({
  stack,
  browser,
  baseURL,
}) => {
  await newDeviceKnowsTitlesFromState(stack, browser, baseURL, 'chromium');
});

test("a new device shows every title the room's state holds (WebKit)", async ({
  stack,
  baseURL,
}) => {
  test.skip(!WEBKIT_EXECUTABLE, 'PLAYWRIGHT_WEBKIT_EXECUTABLE names no WebKit');
  const webkit = await launchWebKit();
  try {
    await newDeviceKnowsTitlesFromState(stack, webkit, baseURL, 'webkit');
  } finally {
    await webkit.close();
  }
});
