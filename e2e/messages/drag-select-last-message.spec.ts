import { expect, test, type Locator } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import { joinRoom, registerAgentAccount, sendRoomMessage } from '../helpers/matrix';
import {
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// A triple click on the last item of a thread's last message, held and dragged up over the items
// above, keeps extending the selection there. Chromium ended that paragraph selection in the
// composer below, then moved the selection and the focus into the composer on the drag's first
// move. Runs against the disposable homeserver of `just hs-up` or of a slot of scripts/e2e-slot.sh.
const PASSWORD = 'drag-select-last-message-password';
const ITEMS = [
  ['Alpha', 'the orchard survey and the soil samples from the north field.'],
  ['Bravo', 'the bridge repairs and the detour signs on the river road.'],
  ['Charlie', 'the library hours, the reading room and the new study desks.'],
  ['Delta', 'the bakery order, a few loaves of rye, and the delivery time.'],
];

/** The viewport point at the middle of `word` in `row`'s text. */
const wordPoint = (row: Locator, word: string): Promise<{ x: number; y: number }> =>
  row.evaluate((element, wanted) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(wanted) ?? -1;
      if (at >= 0) {
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + wanted.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    throw new Error(`"${wanted}" is not in the message`);
  }, word);

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

test('a held triple click on the last message drags its selection up', async ({ page }) => {
  test.setTimeout(180_000);
  const reader = await registerDisposableUser(`mrc_dragsel_${Date.now().toString(36)}`, PASSWORD);
  const agent = await registerAgentAccount(HOMESERVER, 'helper');
  const roomId = await createRoom(HOMESERVER, reader.accessToken, {
    name: 'Weekly plan',
    invite: [agent.userId],
  });
  await joinRoom(HOMESERVER, agent.accessToken, roomId);
  const rootId = await sendRoomMessage(HOMESERVER, reader.accessToken, roomId, {
    msgtype: 'm.text',
    body: 'Could you plan the week?',
  });
  const listId = await sendRoomMessage(HOMESERVER, agent.accessToken, roomId, {
    msgtype: 'm.text',
    body: ITEMS.map(([lead, text]) => `- **${lead}:** ${text}`).join('\n'),
    format: 'org.matrix.custom.html',
    formatted_body: `<ul>${ITEMS.map(
      ([lead, text]) => `<li><strong>${lead}:</strong> ${text}</li>`
    ).join('')}</ul>`,
    'm.relates_to': {
      rel_type: 'm.thread',
      event_id: rootId,
      is_falling_back: true,
      'm.in_reply_to': { event_id: rootId },
    },
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await loginWithPassword(page, { homeserver: HOMESERVER, ...reader });
  await page.goto(`/home/${encodeURIComponent(roomId)}/?threadId=${encodeURIComponent(rootId)}`);
  const row = page.locator(`[data-message-id="${listId}"]`).last();
  await expect(row).toBeVisible({ timeout: 60_000 });
  // The composer had the caret before, as it does once a thread opens.
  await page.locator('[data-room-footer="true"] [contenteditable="true"]').last().click();

  // Both words in view and on top, where the timeline has settled.
  let start = { x: 0, y: 0 };
  let end = { x: 0, y: 0 };
  await expect
    .poll(async () => {
      start = await wordPoint(row, 'loaves');
      end = await wordPoint(row, 'bridge');
      return row.evaluate(
        (element, points) =>
          points.every(({ x, y }) => element.contains(document.elementFromPoint(x, y))),
        [start, end]
      );
    }, 'both words are in view, inside the row')
    .toBe(true);
  await page.mouse.move(start.x, start.y);
  for (const clickCount of [1, 2]) {
    await page.mouse.down({ clickCount });
    await page.mouse.up({ clickCount });
  }
  await page.mouse.down({ clickCount: 3 });
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(
      start.x + ((end.x - start.x) * step) / 10,
      start.y + ((end.y - start.y) * step) / 10
    );
    await page.waitForTimeout(40);
  }
  const held = await page.evaluate(() => {
    const selection = document.getSelection();
    const inComposer = (node: Node | null | undefined) =>
      !!(node instanceof Element ? node : node?.parentElement)?.closest('[data-slate-editor]');
    return {
      text: selection?.toString() ?? '',
      inComposer: inComposer(selection?.anchorNode) || inComposer(selection?.focusNode),
      composerFocused: !!document.activeElement?.closest('[data-slate-editor]'),
    };
  });
  await page.mouse.up({ clickCount: 3 });

  expect(held, 'the selection stays in the message').toEqual({
    text: expect.stringContaining('Bravo:') as unknown as string,
    inComposer: false,
    composerFocused: false,
  });
  expect(held.text).toContain('Delta:');
});
