import { expect, test, type Page } from '@playwright/test';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
} from '../helpers/disposableAccounts';
import { matrixFetch, sendRoomMessage } from '../helpers/matrix';
import { openPanel, openPanelRoom, panelLocator, type PanelRoom } from '../helpers/sidePanels';

// A side panel that fills the room (the call's, from its frame's Fill) keeps the conversation under
// it as it was, against the disposable homeserver: a voice message being recorded goes on and is
// sent once the panel is back beside the conversation, no read receipt goes out for a message that
// arrives while the panel fills the room (one does once the conversation shows again), and the
// reader is where they were in the thread. On a phone, where a panel covers the conversation, the
// recording goes on under it too.

test.use({
  viewport: { width: 1600, height: 1000 },
  video: 'off',
  launchOptions: {
    // The other launch options repeat playwright.config.ts; the microphone is Chromium's fake one.
    executablePath: process.env.CHROMIUM_PATH || undefined,
    args: [
      '--disable-features=IsolateSandboxedIframes',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
    ],
  },
});
// The page's live sync may still be in a route when the test ends.
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

/** The read receipts the page sends, as they go out. */
const recordReceipts = (page: Page) => {
  const receipts: string[] = [];
  page.on('request', (request) => {
    const receipt = /\/receipt\/[^/]+\/([^/?]+)/.exec(decodeURIComponent(request.url()));
    if (receipt?.[1]) receipts.push(receipt[1]);
  });
  return receipts;
};

const reply = (room: PanelRoom, body: string) =>
  sendRoomMessage(HOMESERVER, room.agent.accessToken, room.roomId, {
    msgtype: 'm.text',
    body,
    'm.relates_to': { rel_type: 'm.thread', event_id: room.rootId },
  });

const voiceMessages = async (room: PanelRoom): Promise<number> => {
  const { chunk } = await matrixFetch<{ chunk: { content: { msgtype?: string } }[] }>(
    HOMESERVER,
    `/rooms/${encodeURIComponent(room.roomId)}/messages?dir=b&limit=100`,
    { accessToken: room.viewer.accessToken }
  );
  return chunk.filter((event) => event.content.msgtype === 'm.audio').length;
};

/** The thread's scroll area, which stays the same element while the conversation is hidden. */
const threadScroller = async (page: Page) => {
  await page.evaluate(() => {
    let scroller = document.querySelector('[data-thread-count]')?.parentElement ?? null;
    while (scroller && !/(auto|scroll)/.test(getComputedStyle(scroller).overflowY)) {
      scroller = scroller.parentElement;
    }
    scroller?.setAttribute('data-e2e-thread-scroller', '');
  });
  return page.locator('[data-e2e-thread-scroller]');
};

/** Where the reader is in the thread: its scroll offset and the reply 200 px below its top. */
const readerPlace = async (page: Page) =>
  (await threadScroller(page)).evaluate((scroller) => {
    const rect = scroller.getBoundingClientRect();
    const row = document
      .elementFromPoint(rect.left + rect.width / 2, rect.top + 200)
      ?.closest('[data-message-id]');
    return {
      scrollTop: Math.round(scroller.scrollTop),
      reply: row?.textContent?.match(/Reply \d+ of the thread/)?.[0],
    };
  });

/** Starts a voice message in the composer; skips the test where the browser has no microphone. */
const startRecording = async (page: Page) => {
  const discard = page.getByRole('button', { name: 'Discard voice recording' });
  await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
  const recordingError = page.getByText('Voice Recording Error', { exact: true });
  await expect(discard.or(recordingError).first()).toBeVisible({ timeout: 15_000 });
  test.skip(await recordingError.isVisible(), 'This browser offers no microphone to record from');
  return discard;
};

test('a side panel filling the room keeps the conversation under it as it was', async ({
  context,
  page,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  await context.grantPermissions(['microphone']);
  const room = await openPanelRoom(context, page);
  const receipts = recordReceipts(page);
  const shot = (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  const fill = panelLocator(page, 'call').getByRole('button', {
    name: 'Fill the room with Call',
    exact: true,
  });
  const discard = await startRecording(page);

  // Filled, the room shows the call alone; back beside the conversation, the recording goes on.
  await openPanel(page, room, 'call');
  await shot('recording');
  await fill.click();
  await expect(fill).toHaveAttribute('aria-pressed', 'true');
  await expect(discard).toBeHidden();
  await shot('filled');
  await fill.click();
  await expect(discard).toBeVisible();
  await shot('unfolded');

  // A reply that arrives while the call fills the room gets no receipt, until the conversation
  // shows again.
  await fill.click();
  await expect(fill).toHaveAttribute('aria-pressed', 'true');
  const unseen = await reply(room, 'Arrived while the call fills the room');
  await expect(page.getByText('Arrived while the call fills the room').last()).toBeAttached({
    timeout: 60_000,
  });
  // A receipt goes out on the next frame after a message arrives: give it a few.
  await page.waitForTimeout(2_000);
  expect(receipts).not.toContain(unseen);
  await fill.click();
  await expect.poll(() => receipts).toContain(unseen);

  // The recording, still going, is sent.
  await expect(discard).toBeVisible();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect.poll(() => voiceMessages(room), { timeout: 45_000 }).toBe(1);

  // Up in a longer thread, the reader stays where they were across Fill.
  for (let index = 1; index <= 60; index += 1) {
    // eslint-disable-next-line no-await-in-loop
    await reply(room, `Reply ${index} of the thread, long enough to give its row some height`);
  }
  await expect(page.getByText(/^Reply 60 of the thread/).last()).toBeVisible({ timeout: 60_000 });
  await (
    await threadScroller(page)
  ).evaluate((scroller) => {
    // eslint-disable-next-line no-param-reassign
    scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) / 2;
  });
  await page.waitForTimeout(1_500);
  const before = await readerPlace(page);
  expect(before.reply).toBeDefined();
  await fill.click();
  await expect(fill).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(1_000);
  await fill.click();
  await expect(fill).toHaveAttribute('aria-pressed', 'false');
  await page.waitForTimeout(1_500);
  expect(await readerPlace(page)).toEqual(before);
});

test('on a phone, a side panel over the conversation keeps the recording under it', async ({
  browser,
}) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  try {
    await context.grantPermissions(['microphone']);
    const page = await context.newPage();
    const room = await openPanelRoom(context, page);
    const discard = await startRecording(page);
    await openPanel(page, room, 'computer');
    await expect(discard).toBeHidden();
    await page.screenshot({ path: test.info().outputPath('phone-covered.png') });
    await panelLocator(page, 'computer')
      .getByRole('button', { name: 'Close computer', exact: true })
      .click();
    await expect(discard).toBeVisible();
  } finally {
    await context.close();
  }
});
