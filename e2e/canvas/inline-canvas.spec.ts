import { expect, test, type Page } from '@playwright/test';
import { DISPOSABLE_HOMESERVER as HOMESERVER } from '../helpers/disposableAccounts';
import { sendRoomMessage } from '../helpers/matrix';
import { openPanelRoom, panelLocator, type PanelRoom } from '../helpers/sidePanels';

// An inline canvas (`inline: true` on the request) shows its page in the thread, in a frame that
// fits the page's height as the page changes, and leaves the side panel closed until the user opens
// it. The room's homeserver may open canvases by itself, so a panel that stays closed is the inline
// flag's doing.
test.describe.configure({ timeout: 240_000 });
test.use({ viewport: { width: 1280, height: 900 }, video: 'off' });
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

const sendInlineCanvas = (room: PanelRoom, title: string, html: string) =>
  sendRoomMessage(HOMESERVER, room.agent.accessToken, room.roomId, {
    msgtype: 'm.notice',
    body: `Interactive panel: ${title}. Open it in MindRoom Chat to respond.`,
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

const frameHeight = (page: Page, title: string) => async () =>
  (await page.locator(`iframe[title="${title}"]`).boundingBox())?.height ?? 0;

test('an inline canvas fits its page in the thread and leaves the panel closed', async ({
  context,
  page,
}) => {
  const room = await openPanelRoom(context, page);
  await sendInlineCanvas(
    room,
    'Flow mockup',
    '<div style="height:400px;border:1px solid var(--mr-border)">Flow mockup body</div>'
  );
  const frame = page.locator('iframe[title="Flow mockup"]');
  await expect(frame).toBeVisible({ timeout: 60_000 });
  // 400px of content, its 1px border and the page's 8px gutter above and below.
  await expect.poll(frameHeight(page, 'Flow mockup'), { timeout: 20_000 }).toBe(418);
  await expect(
    page
      .frameLocator('iframe[title="Flow mockup"]')
      .frameLocator('iframe')
      .getByText('Flow mockup body')
  ).toBeVisible();

  await page.waitForTimeout(1_500);
  await expect(panelLocator(page, 'canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open canvas', exact: true }).last().click();
  await expect(panelLocator(page, 'canvas')).toBeVisible({ timeout: 30_000 });
});

test('an inline canvas follows absolutely positioned content through transitions as it grows and shrinks', async ({
  context,
  page,
}) => {
  const room = await openPanelRoom(context, page);
  await sendInlineCanvas(
    room,
    'Positioned mockup',
    `<div id="box" style="position:absolute;top:0;left:0;right:0;height:400px;transition:height 0.3s linear">
      <button id="toggle" onclick="box.style.height = box.style.height === '700px' ? '250px' : '700px'">Resize</button>
    </div>`
  );
  await expect(page.locator('iframe[title="Positioned mockup"]')).toBeVisible({ timeout: 60_000 });
  const height = frameHeight(page, 'Positioned mockup');
  // Out-of-flow content keeps its height once the frame has made room for it, and the frame
  // follows its height to the end of each transition.
  await expect.poll(height, { timeout: 20_000 }).toBe(400);
  await page.waitForTimeout(1_000);
  expect(await height()).toBe(400);

  const toggle = page
    .frameLocator('iframe[title="Positioned mockup"]')
    .frameLocator('iframe')
    .getByRole('button', { name: 'Resize' });
  await toggle.click();
  await expect.poll(height, { timeout: 10_000 }).toBe(700);
  await toggle.click();
  await expect.poll(height, { timeout: 10_000 }).toBe(250);
});
