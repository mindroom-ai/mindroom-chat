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

const sendInlineCanvas = (
  room: PanelRoom,
  title: string,
  html: string,
  presentation: { raw?: true; width?: number } = {}
) =>
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
      canvas: { title, html, ...presentation },
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

// One pixel PNG for the remote image.
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64'
);

test('a raw page renders at its own width, shrunk to the column, with remote assets', async ({
  context,
  page,
}) => {
  await context.route('https://assets.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PIXEL })
  );
  const room = await openPanelRoom(context, page, { canvas: { remoteAssets: true } });
  await sendInlineCanvas(
    room,
    'Site preview',
    `<div id="hero" style="height:600px"><span id="width"></span>
      <img id="remote" src="https://assets.example.test/dot.png" width="40" height="40"></div>
     <script>document.getElementById('width').textContent = String(innerWidth);</script>`,
    { raw: true, width: 1440 }
  );
  const frame = page.locator('iframe[title="Site preview"]');
  await expect(frame).toBeVisible({ timeout: 60_000 });
  const inner = page.frameLocator('iframe[title="Site preview"]').frameLocator('iframe');
  // The page lays out at 1440 CSS pixels, its desktop breakpoint, whatever the column's width.
  await expect(inner.locator('#width')).toHaveText('1440');
  // Raw: the browser's own 8px body margin and white page, nothing from Chat.
  expect(await inner.locator('body').evaluate((body) => getComputedStyle(body).marginTop)).toBe(
    '8px'
  );
  await expect
    .poll(() => inner.locator('#remote').evaluate((image: HTMLImageElement) => image.naturalWidth))
    .toBe(1);
  // 600px of content plus the 8px margins, shown at the column's scale.
  const column = await frame.evaluate((element) => element.parentElement!.clientWidth);
  const scale = Math.min(1, column / 1440);
  await expect
    .poll(async () => (await frame.locator('xpath=..').boundingBox())?.height ?? 0, {
      timeout: 20_000,
    })
    .toBeCloseTo(616 * scale, 0);
  expect((await frame.boundingBox())?.width).toBeCloseTo(1440 * scale, 0);
});

test('without the deployment switch, a remote asset stays blocked', async ({ context, page }) => {
  let requested = false;
  await context.route('https://assets.example.test/**', (route) => {
    requested = true;
    return route.fulfill({ contentType: 'image/png', body: PIXEL });
  });
  const room = await openPanelRoom(context, page);
  await sendInlineCanvas(
    room,
    'Blocked preview',
    '<img id="remote" src="https://assets.example.test/dot.png" width="40" height="40">',
    { raw: true }
  );
  const inner = page.frameLocator('iframe[title="Blocked preview"]').frameLocator('iframe');
  await expect(inner.locator('#remote')).toBeAttached({ timeout: 60_000 });
  await page.waitForTimeout(1_000);
  expect(
    await inner.locator('#remote').evaluate((image: HTMLImageElement) => image.naturalWidth)
  ).toBe(0);
  expect(requested).toBe(false);
});
