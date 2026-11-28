import { expect, test } from '@playwright/test';
import { DISPOSABLE_HOMESERVER as HOMESERVER } from '../helpers/disposableAccounts';
import { sendRoomMessage } from '../helpers/matrix';
import { openPanelRoom } from '../helpers/sidePanels';

// Set INLINE_CANVAS_HOVER_SHOTS=<directory> to save the three hover screenshots.
const HOVER_SHOTS = process.env.INLINE_CANVAS_HOVER_SHOTS;

test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 1280, height: 900 }, video: 'off' });
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

test('the message hover pill stays off an inline canvas', async ({ context, page }) => {
  const room = await openPanelRoom(context, page);
  page.setDefaultTimeout(5_000);
  const title = 'Sprint status board';
  const height = 650;
  const rel = { rel_type: 'm.thread', event_id: room.rootId };
  const send = (body: string, key = room.agent.accessToken) =>
    sendRoomMessage(HOMESERVER, key, room.roomId, { msgtype: 'm.text', body, 'm.relates_to': rel });
  await send('Here is the latest sprint board.');
  const canvasId = await sendRoomMessage(HOMESERVER, room.agent.accessToken, room.roomId, {
    msgtype: 'm.notice',
    body: `Interactive panel: ${title}`,
    'm.relates_to': rel,
    'io.mindroom.ui_action': {
      version: 1,
      action: 'show_canvas',
      requester_id: room.viewer.userId,
      agent_user_id: room.agent.userId,
      room_id: room.roomId,
      thread_id: room.rootId,
      inline: true,
      canvas: {
        title,
        html: `<style>body{margin:0;padding:0}section{box-sizing:border-box;height:${height}px;padding:8px}</style>
     <section><strong>Sprint 14 · Release planning</strong>
       <p><button style="float:right" onclick="this.nextElementSibling.textContent='Open tasks'">Apply filter</button>
       <span role="status">All tasks</span></p>
       <ul><li>Update export preview — In progress</li><li>Review keyboard shortcuts — Done</li></ul></section>`,
      },
    },
  });
  const followUpId = await send('Follow-up summary');
  // Viewer notes add scroll room and leave the follow-up as the last agent reply in its turn.
  const notesId = await send('Next steps\nTest\nReview\nShip\nRecap', room.viewer.accessToken);
  const message = (id: string) => page.locator(`[data-message-id="${id}"]`);
  const canvasRow = message(canvasId);
  const notice = canvasRow.locator('[data-canvas-notice-title]');
  const frame = canvasRow.locator(`iframe[title="${title}"]`);
  const board = frame.contentFrame().frameLocator('iframe');
  const apply = board.getByRole('button', { name: 'Apply filter', exact: true });
  const scroll = page.locator('[data-thread-header-scroller]');
  const pills = canvasRow.getByRole('button', {
    name: /^(Reply|Add Reaction)$/,
    includeHidden: true,
  });
  const settle = () =>
    page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  const capture = async (name: string) => {
    await settle();
    if (HOVER_SHOTS) await page.screenshot({ path: `${HOVER_SHOTS}/${name}.png` });
  };
  await apply.waitFor({ timeout: 60_000 });
  await expect
    .poll(async () => (await frame.boundingBox())?.height, { timeout: 20_000 })
    .toBe(height);
  await message(notesId).hover({ timeout: 60_000 });
  await page.mouse.wheel(0, -(await scroll.evaluate((el) => el.scrollHeight)));
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBe(0);
  await notice.hover();
  await capture('unscrolled-canvas-hover');
  const unscrolled = await pills.count();
  await notice.click({ button: 'right' });
  const replyItem = page.getByRole('menuitem', { name: 'Reply', exact: true });
  await expect(replyItem).toBeVisible();
  const addReaction = page.getByRole('menuitem', { name: 'Add Reaction', exact: true });
  await expect(addReaction).toBeVisible();
  const inMenu = await pills.count();
  await page.keyboard.press('Escape');
  await expect(replyItem).toBeHidden();
  await page.mouse.wheel(0, await scroll.evaluate((el) => el.scrollHeight));
  const gap = () => scroll.evaluate((s) => Math.abs(s.scrollHeight - s.clientHeight - s.scrollTop));
  await expect.poll(gap).toBeLessThanOrEqual(1);
  const followUp = message(followUpId);
  await followUp.hover();
  await capture('next-row-hover');
  const senderLines = await followUp.locator('[data-message-sender-line]').count();
  const pill = followUp.locator('[data-message-toolbar]');
  const card = canvasRow.locator('[data-inline-canvas]');
  const nextPill = (await pill.isVisible()) ? await pill.boundingBox() : null;
  const cardAtBottom = (await card.isVisible()) ? await card.boundingBox() : null;
  const { top, bottom } = await scroll.evaluate((s) => ({
    top: s.querySelector('[data-thread-header]')!.getBoundingClientRect().bottom,
    bottom: s.getBoundingClientRect().bottom - parseFloat(getComputedStyle(s).scrollPaddingBottom),
  }));
  // Put the button just below the sticky header, where the old pill would cover it.
  await expect(async () => {
    const { y, height: h } = (await apply.boundingBox())!;
    await scroll.evaluate((el, dy) => el.scrollBy(0, dy), y - h / 2 - top);
    await settle();
    expect(Math.abs((await apply.boundingBox())!.y - h / 2 - top)).toBeLessThanOrEqual(1);
  }).toPass({ timeout: 15_000 });
  const { x, y, width, height: h } = (await apply.boundingBox())!;
  const heading = (await notice.boundingBox())!;
  expect(heading.y + heading.height).toBeLessThanOrEqual(top);
  await page.mouse.move(((await canvasRow.boundingBox())!.x + heading.x) / 2, y + h / 2);
  await settle();
  await page.mouse.move(x + width / 2, y + h / 2);
  await capture('scrolled-canvas-hover');
  expect([unscrolled, inMenu, await pills.count()], 'canvas hover pills').toEqual([0, 0, 0]);
  if (!cardAtBottom || !nextPill)
    throw new Error('Expected a visible canvas card and follow-up pill');
  const end = cardAtBottom.y + cardAtBottom.height;
  expect(senderLines).toBe(0);
  expect(cardAtBottom.y).toBeLessThan(top);
  expect(end).toBeGreaterThan(top);
  expect(end).toBeLessThan(bottom);
  expect(nextPill.y).toBeGreaterThanOrEqual(end);
  await apply.click({ timeout: 10_000 });
  await expect(board.getByRole('status')).toHaveText('Open tasks');

  await canvasRow.evaluate((el) => el.focus({ preventScroll: true }));
  const menu = page.getByRole('menu').filter({ has: replyItem });
  const items = menu.getByRole('menuitem');
  await page.keyboard.press('Shift+F10');
  await expect(items.first()).toBeFocused();
  await expect(addReaction).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(canvasRow).toBeFocused();
  await expect(pills).toHaveCount(0);
});
