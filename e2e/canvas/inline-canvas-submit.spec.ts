import { expect, test, type Page } from '@playwright/test';
import { DISPOSABLE_HOMESERVER as HOMESERVER } from '../helpers/disposableAccounts';
import { matrixFetch, sendRoomMessage } from '../helpers/matrix';
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
      // Provenance disclosure sits behind the header info tip, not inside the answer bar.
      const info = page.locator('button[aria-label^="Interactive panel from"]');
      await expect(info).toBeVisible();
      await info.click();
      await expect(page.getByRole('tooltip')).toContainText(
        'what you enter here may leave this page'
      );

      const form = canvasPage(page);
      await form.locator('#team').fill('Team Lark');
      await form.locator('#plan').selectOption('Pro');
      await form.getByRole('button', { name: 'Choose' }).click();

      // Real user click enters the 2.5 s undo bar with summary chips, Data, Undo, and Send now.
      const send = page.locator('[data-canvas-send]');
      const discard = page.locator('[data-canvas-discard]');
      const inspect = page.locator('[data-canvas-inspect]');
      await expect(send).toBeEnabled();
      await expect(page.locator('[data-canvas-staged-headline]')).toHaveText(
        /Sending to .+: Plan chosen/
      );
      await expect(page.locator('[data-canvas-summary]')).toContainText('team: Team Lark');
      await expect(page.locator('[data-canvas-summary]')).toContainText('plan: Pro');
      await expect(discard).toHaveText('Undo');
      await expect(send).toHaveText('Send now');
      const shots = process.env.INLINE_SUBMIT_SHOTS;
      if (shots) {
        await page.screenshot({ path: `${shots}/inline-confirm-bar-${name}.png` });
      }
      // Opening Data pauses the countdown and shows the JSON payload; Send now sends immediately.
      await inspect.click();
      await expect(page.locator('[data-canvas-staged-headline]')).toHaveText(
        /Send to .+: Plan chosen/
      );
      await expect(page.locator('pre')).toContainText('"team": "Team Lark"');
      await page.waitForTimeout(2_800);
      await expect(page.locator('[data-canvas-receipt]')).toHaveCount(0);
      await send.click();
      await expect(page.locator('[data-canvas-status]')).toHaveText(/Sent to .+: Plan chosen/, {
        timeout: 30_000,
      });
      await expect(page.locator('[data-canvas-receipt]')).toContainText('Plan chosen', {
        timeout: 30_000,
      });

      // After the 5.5 s cooldown expires, leaving a gesture submission alone auto-sends after 2.5 s.
      await page.waitForTimeout(5_600);
      await form.getByRole('button', { name: 'Choose' }).click();
      await expect(page.locator('[data-canvas-staged-headline]')).toHaveText(
        /Sending to .+: Plan chosen/
      );
      await expect(page.locator('[data-canvas-receipt]')).toHaveCount(2, { timeout: 30_000 });

      // Right after auto-send (inside cooldown), a new submission waits for explicit confirm and is
      // dropped when the row scrolls away.
      await form.getByRole('button', { name: 'Choose' }).click();
      await expect(send).toHaveText('Send');
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
      await page.waitForTimeout(150);
      // Re-submitting right after Undo stays inside the cooldown and enters explicit confirm.
      await form.getByRole('button', { name: 'Finish' }).click();
      await expect(page.locator('[data-canvas-send]')).toHaveText('Send');
      await expect(page.locator('[data-canvas-discard]')).toHaveText('Discard');
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

test('untrusted canvas scripts cannot forge a user gesture or auto-send without an inside click', async ({
  context,
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const room = await openPanelRoom(context, page);
  const viewerResponses = async () =>
    (
      await matrixFetch<{
        chunk: Array<{ sender: string; content: Record<string, unknown> }>;
      }>(HOMESERVER, `/rooms/${encodeURIComponent(room.roomId)}/messages?dir=b&limit=50`, {
        accessToken: room.viewer.accessToken,
      })
    ).chunk.filter(
      (event) =>
        event.sender === room.viewer.userId && Boolean(event.content['io.mindroom.canvas_response'])
    );

  const expectExplicitConfirmOnly = async (title: string, html: string, label: string) => {
    // Click the top-level composer so the host page itself has fresh user activation.
    await page.locator('[data-slate-editor="true"]').click();
    await sendInlineForm(room, title, html);
    await expect(page.locator(`iframe[title="${title}"]`)).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('[data-canvas-send]')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('[data-canvas-staged-headline]')).toHaveText(
      new RegExp(`Send to .+: ${label}`)
    );
    await expect(page.getByText(/Sending to /)).toHaveCount(0);
    await expect(page.locator('[data-canvas-send]')).toHaveText('Send');
    await expect(page.locator('[data-canvas-discard]')).toHaveText('Discard');
    await page.waitForTimeout(3_200);
    expect(await viewerResponses()).toHaveLength(0);
    await expect(page.locator('[data-canvas-send]')).toBeVisible();
    await page.locator('[data-canvas-discard]').click();
    await expect(page.locator('[data-canvas-send]')).toHaveCount(0);
  };

  // 1. Programmatic focus + requestSubmit + button.click() + mindroom.submit() while host has activation.
  await expectExplicitConfirmOnly(
    'Scripted submit probe',
    `<form id="f" data-mindroom-label="Programmatic">
      <input id="inp" name="v" value="1">
      <button id="btn" type="submit">Go</button>
    </form>
    <script>
      setTimeout(() => {
        document.getElementById('inp').focus();
        document.getElementById('f').requestSubmit();
        document.getElementById('btn').click();
        mindroom.submit({ v: 'direct' }, { label: 'Direct' });
      }, 150);
    </script>`,
    'Programmatic'
  );

  // 2. Forged userGesture: true via wrapper (parent.postMessage): wrapper overwrites with its own activation.
  await expectExplicitConfirmOnly(
    'Wrapper spoof probe',
    `<p>Wrapper spoof</p><script>
      setTimeout(() => parent.postMessage(
        { type: 'mindroom.canvas.submit', version: 1, data: { spoof: 'wrapper' }, label: 'Spoofed wrapper', userGesture: true },
        '*'
      ), 150);
    </script>`,
    'Spoofed wrapper'
  );

  // 3. Forged userGesture: true bypassing wrapper (parent.parent.postMessage): Chat strips untrusted userGesture.
  await expectExplicitConfirmOnly(
    'Direct spoof probe',
    `<p>Direct spoof</p><script>
      setTimeout(() => parent.parent.postMessage(
        { type: 'mindroom.canvas.submit', version: 1, data: { spoof: 'direct' }, label: 'Spoofed direct', userGesture: true },
        '*'
      ), 150);
    </script>`,
    'Spoofed direct'
  );

  // 4. Submit -> Undo -> delayed scripted follow-up within browser's 5 s user activation window.
  const postUndoTitle = 'Post-Undo follow-up probe';
  await sendInlineForm(
    room,
    postUndoTitle,
    `<button id="go">Choose</button>
    <script>
      document.getElementById('go').addEventListener('click', () => {
        mindroom.submit({ step: 'initial' }, { label: 'Initial choice' });
        setTimeout(() => mindroom.submit({ step: 'sneaky' }, { label: 'Sneaky retry' }), 1000);
      });
    </script>`
  );
  await expect(page.locator(`iframe[title="${postUndoTitle}"]`)).toBeVisible({ timeout: 60_000 });
  await page
    .frameLocator(`iframe[title="${postUndoTitle}"]`)
    .frameLocator('iframe')
    .getByRole('button', { name: 'Choose' })
    .click();
  await expect(page.locator('[data-canvas-staged-headline]')).toHaveText(
    /Sending to .+: Initial choice/
  );
  await page.locator('[data-canvas-discard]').click();
  await expect(page.locator('[data-canvas-send]')).toHaveCount(0);
  // 1 s later the canvas retries inside the same transient activation window; cooldown must hold it
  // in explicit confirm and never auto-send.
  await expect(page.locator('[data-canvas-staged-headline]')).toHaveText(
    /Send to .+: Sneaky retry/,
    { timeout: 5_000 }
  );
  await expect(page.getByText(/Sending to /)).toHaveCount(0);
  await expect(page.locator('[data-canvas-send]')).toHaveText('Send');
  await expect(page.locator('[data-canvas-discard]')).toHaveText('Discard');
  await page.waitForTimeout(3_200);
  expect(await viewerResponses()).toHaveLength(0);
});
