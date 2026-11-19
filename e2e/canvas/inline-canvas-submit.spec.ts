import { expect, test, type Page } from '@playwright/test';
import { DISPOSABLE_HOMESERVER as HOMESERVER } from '../helpers/disposableAccounts';
import { sendRoomMessage } from '../helpers/matrix';
import { openPanelRoom, type PanelRoom } from '../helpers/sidePanels';

// An inline canvas answers from the thread: the member who asked fills its form, confirms the
// answer in the bar under the page, and sees the receipt; the form's inputs come back when the row
// scrolls out of view and back, and after a reload. Desktop and phone width.
// Set INLINE_SUBMIT_SHOTS=<directory> for screenshots of the confirm bar.
test.describe.configure({ timeout: 300_000 });
test.use({ video: 'off' });
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

const TITLE = 'Plan picker';
const FORM = `<form data-mindroom-label="Plan chosen">
  <label>Team name <input id="team" name="team"></label>
  <label>Plan <select id="plan" name="plan"><option>Basic</option><option>Pro</option></select></label>
  <button type="submit">Choose</button>
</form>`;

const TALL_TITLE = 'Long survey';
const TALL_FORM = `<div style="height:1600px">Questions start below.</div>
<form data-mindroom-label="Survey done"><input id="note" name="note"><button type="submit">Finish</button></form>
<div style="height:1600px">More questions follow.</div>`;

const sendInlineForm = (room: PanelRoom, title = TITLE, html = FORM) =>
  sendRoomMessage(HOMESERVER, room.agent.accessToken, room.roomId, {
    msgtype: 'm.notice',
    body: `Interactive panel: ${TITLE}. Open it in MindRoom Chat to respond.`,
    'm.relates_to': { rel_type: 'm.thread', event_id: room.rootId },
    'io.mindroom.ui_action': {
      version: 1,
      action: 'show_canvas',
      requester_id: room.viewer.userId,
      agent_user_id: room.agent.userId,
      room_id: room.roomId,
      thread_id: room.rootId,
      inline: true,
      canvas: { title, html },
    },
  });

const canvasPage = (page: Page) =>
  page.frameLocator(`iframe[title="${TITLE}"]`).frameLocator('iframe');

/** Marks the scroller around the canvas's row (or, once it has left, a filler's) and moves it to one end. */
const scrollThread = (page: Page, end: 'top' | 'bottom') =>
  page.evaluate(
    ({ title, end: to }) => {
      let scroller = document.querySelector<HTMLElement>('[data-e2e-thread-scroller]');
      if (!scroller) {
        const anchor =
          document.querySelector(`iframe[title="${title}"]`) ??
          [...document.querySelectorAll('body *')].find(
            (line) => line.childElementCount === 0 && line.textContent?.startsWith('Filler line')
          );
        let node = anchor?.parentElement ?? null;
        while (
          node &&
          // The thread may not overflow yet.
          !/(auto|scroll)/.test(getComputedStyle(node).overflowY)
        )
          node = node.parentElement;
        if (!node) throw new Error('no scroller around the canvas');
        node.setAttribute('data-e2e-thread-scroller', '');
        scroller = node;
      }
      scroller.scrollTop = to === 'top' ? 0 : scroller.scrollHeight;
    },
    { title: TITLE, end }
  );

for (const [name, viewport] of [
  ['desktop', { width: 1280, height: 900 }],
  ['phone', { width: 390, height: 844 }],
] as const) {
  test.describe(name, () => {
    test.use({ viewport });

    test(`an inline form sends a confirmed answer and keeps its inputs (${name})`, async ({
      context,
      page,
    }) => {
      const room = await openPanelRoom(context, page);
      await sendInlineForm(room);
      await expect(page.locator(`iframe[title="${TITLE}"]`)).toBeVisible({ timeout: 60_000 });
      const form = canvasPage(page);
      await form.locator('#team').fill('Team Lark');
      await form.locator('#plan').selectOption('Pro');
      await form.getByRole('button', { name: 'Choose' }).click();

      // The answer waits in the thread, under the page, for the user's Send.
      const send = page.locator('[data-canvas-send]');
      await expect(send).toBeVisible();
      await expect(page.getByText(/Send to .+: Plan chosen/)).toBeVisible();
      await expect(page.getByText('what you enter here may leave this page')).toBeVisible();
      const shots = process.env.INLINE_SUBMIT_SHOTS;
      if (shots) {
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${shots}/inline-confirm-bar-${name}.png` });
      }
      await expect(send).toBeEnabled();
      await send.click();
      await expect(page.locator('[data-canvas-status]')).toHaveText(/Sent to .+: Plan chosen/, {
        timeout: 30_000,
      });
      await expect(page.locator('[data-canvas-receipt]')).toContainText('Plan chosen', {
        timeout: 30_000,
      });

      // An answer staged again and left unsent is dropped when the row scrolls away.
      await form.getByRole('button', { name: 'Choose' }).click();
      await expect(send).toBeVisible();
      // Finds the thread's scroller while the canvas is still in it.
      await scrollThread(page, 'bottom');
      // The viewer's own long lines, which the thread never folds as it folds an agent's run. A
      // thread keeps rows two screens above and below the ones shown, so they must fill many more.
      for (let index = 0; index < 40; index += 1) {
        await sendRoomMessage(HOMESERVER, room.viewer.accessToken, room.roomId, {
          msgtype: 'm.text',
          body: `Filler line ${index + 1}. ${'Placeholder words to scroll past. '.repeat(25)}`,
          'm.relates_to': { rel_type: 'm.thread', event_id: room.rootId },
        });
      }
      await expect(page.getByText(/^Filler line 40\./)).toBeAttached({
        timeout: 60_000,
      });
      await expect
        .poll(
          async () => {
            await scrollThread(page, 'bottom');
            return page.locator(`iframe[title="${TITLE}"]`).count();
          },
          { timeout: 30_000 }
        )
        .toBe(0);
      await expect
        .poll(
          async () => {
            await scrollThread(page, 'top');
            return page.locator(`iframe[title="${TITLE}"]`).count();
          },
          { timeout: 30_000 }
        )
        .toBe(1);
      await expect(form.locator('#team')).toHaveValue('Team Lark');
      await expect(form.locator('#plan')).toHaveValue('Pro');
      await expect(send).toHaveCount(0);

      // A reload starts the page from what it kept on this device.
      await page.reload();
      await expect(page.getByText(/^Filler line 40\./)).toBeVisible({ timeout: 60_000 });
      // The thread may still settle at its latest row after loading, so scroll up until the page reads.
      const restored = async () => {
        await scrollThread(page, 'top');
        return Promise.all([
          form.locator('#team').inputValue({ timeout: 2_000 }),
          form.locator('#plan').inputValue({ timeout: 2_000 }),
        ]).catch(() => []);
      };
      await expect.poll(restored, { timeout: 60_000 }).toEqual(['Team Lark', 'Pro']);
    });

    test(`a tall inline page keeps Send and Discard above the composer and Jump to Latest (${name})`, async ({
      context,
      page,
    }) => {
      const room = await openPanelRoom(context, page);
      await sendInlineForm(room, TALL_TITLE, TALL_FORM);
      await expect(page.locator(`iframe[title="${TALL_TITLE}"]`)).toBeVisible({ timeout: 60_000 });
      const form = page.frameLocator(`iframe[title="${TALL_TITLE}"]`).frameLocator('iframe');
      await form.locator('#note').fill('All fine');
      await form.getByRole('button', { name: 'Finish' }).click();
      await expect(page.locator('[data-canvas-send]')).toBeEnabled();
      // Without scrolling, Send and Discard are on screen and nothing (the composer, Jump to
      // Latest) covers either.
      const target = (selector: string) =>
        page.locator(selector).evaluate((control) => {
          const box = control.getBoundingClientRect();
          const x = box.left + box.width / 2;
          const y = box.top + box.height / 2;
          return {
            x,
            y,
            onScreen: box.top >= 0 && box.bottom <= innerHeight,
            hit: control.contains(document.elementFromPoint(x, y)),
          };
        });
      const discard = await target('[data-canvas-discard]');
      expect(discard).toMatchObject({ onScreen: true, hit: true });
      expect(await target('[data-canvas-send]')).toMatchObject({ onScreen: true, hit: true });
      const shots = process.env.INLINE_SUBMIT_SHOTS;
      if (shots) await page.screenshot({ path: `${shots}/inline-tall-bar-${name}.png` });
      await page.mouse.click(discard.x, discard.y);
      await expect(page.locator('[data-canvas-send]')).toHaveCount(0);
      await form.getByRole('button', { name: 'Finish' }).click();
      await expect(page.locator('[data-canvas-send]')).toBeEnabled();
      const send = await target('[data-canvas-send]');
      expect(send).toMatchObject({ onScreen: true, hit: true });
      await page.mouse.click(send.x, send.y);
      await expect(page.locator('[data-canvas-status]')).toHaveText(/Sent to .+: Survey done/, {
        timeout: 30_000,
      });
    });
  });
}
