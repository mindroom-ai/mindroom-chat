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

// A website preview (raw, or with its own width) is laid out in a 16:10 browser window, 568 to 1080
// page pixels tall, shrunk with the page: its box shows as much of the window as the page fills (the
// whole window unless `fill` says less), and the rest scrolls inside it.
const expectWindow = async (
  page: Page,
  title: string,
  { width = 0, scrolls = true, fill = (windowHeight: number) => windowHeight } = {}
) => {
  const frame = page.locator(`iframe[title="${title}"]`);
  await expect(frame).toBeVisible({ timeout: 60_000 });
  const column = await frame.evaluate((element) => element.parentElement!.clientWidth);
  // The column is narrower than a page with its own width, so the page really is shrunk.
  if (width) expect(column).toBeLessThan(width);
  const scale = width ? column / width : 1;
  const windowHeight = Math.min(1080, Math.max(568, Math.round(((width || column) * 10) / 16)));
  expect((await frame.boundingBox())?.height).toBeCloseTo(windowHeight * scale, 0);
  const expected = fill(windowHeight) * scale;
  const shown = async () => (await frame.locator('xpath=..').boundingBox())?.height ?? 0;
  await expect.poll(shown, { timeout: 20_000 }).toBeCloseTo(expected, 0);
  await page.waitForTimeout(1_500);
  expect(await shown()).toBeCloseTo(expected, 0);
  const inner = page.frameLocator(`iframe[title="${title}"]`).frameLocator('iframe');
  expect(
    await inner
      .locator('body')
      .evaluate(() => document.scrollingElement!.scrollHeight > window.innerHeight)
  ).toBe(scrolls);
};

// A fitted page shows as tall as the page, which does not scroll.
const expectFitted = async (page: Page, title: string) => {
  const frame = page.locator(`iframe[title="${title}"]`).locator('xpath=..');
  const inner = page.frameLocator(`iframe[title="${title}"]`).frameLocator('iframe');
  const pageHeight = () =>
    inner
      .locator('body')
      .evaluate(() => Math.ceil(document.documentElement.getBoundingClientRect().height));
  await expect
    .poll(async () => (await frame.boundingBox())?.height ?? 0, { timeout: 20_000 })
    .toBeCloseTo(await pageHeight(), 0);
  expect(
    await inner
      .locator('body')
      .evaluate(() => document.scrollingElement!.scrollHeight <= window.innerHeight)
  ).toBe(true);
};

test('a website preview sized by its viewport stops at a browser window and scrolls inside it', async ({
  context,
  page,
}) => {
  const room = await openPanelRoom(context, page);
  const hero =
    '<header style="height:60px">Header</header><section style="height:100vh">Hero</section>' +
    '<footer style="height:40px">Footer</footer>';
  // Two 100vh sections grow twice as fast as their frame.
  const heroes =
    '<section style="height:100vh">One</section><section style="height:100vh">Two</section>' +
    '<footer style="height:40px">Footer</footer>';
  // An animation elsewhere on the page changes nothing about its window.
  const animated =
    '<style>@keyframes pulse{50%{opacity:.4}}h1{animation:pulse 1s infinite}</style>' +
    '<header><h1>Brand</h1></header><section style="height:100vh">Hero</section><footer>Footer</footer>';
  await sendInlineCanvas(room, 'Hero page', hero, { raw: true });
  await sendInlineCanvas(room, 'Hero site', hero, { raw: true, width: 1440 });
  await sendInlineCanvas(room, 'Two heroes', heroes, { raw: true });
  await sendInlineCanvas(room, 'Animated hero', animated, { raw: true });
  // Exactly 100vh fills the window and has nothing to scroll.
  await sendInlineCanvas(
    room,
    'Exact viewport',
    '<style>body{margin:0}</style><div style="height:100vh">Exact</div>',
    { raw: true }
  );
  await expectWindow(page, 'Hero page');
  await expectWindow(page, 'Hero site', { width: 1440 });
  await expectWindow(page, 'Two heroes');
  await expectWindow(page, 'Animated hero');
  await expectWindow(page, 'Exact viewport', { scrolls: false });
});

test('a website preview with sections of part of its viewport keeps its height', async ({
  context,
  page,
}) => {
  const room = await openPanelRoom(context, page);
  // An 80vh hero and a footer: 720 + 100 + the 8px margins in a 900px desktop window.
  await sendInlineCanvas(
    room,
    'Partial hero',
    '<section style="min-height:80vh">Hero</section><footer style="height:100px">Footer</footer>',
    { raw: true, width: 1440 }
  );
  // Half the window, with no margin: exactly half of it shows.
  await sendInlineCanvas(
    room,
    'Half viewport',
    '<style>body{margin:0}</style><div style="height:50vh">Half</div>',
    { raw: true }
  );
  await expectWindow(page, 'Partial hero', { width: 1440, scrolls: false, fill: () => 836 });
  await expectWindow(page, 'Half viewport', {
    scrolls: false,
    fill: (windowHeight) => Math.ceil(windowHeight / 2),
  });
});

test('pages that grow by themselves are fitted: a preview below its window, a themed page past it', async ({
  context,
  page,
}) => {
  const room = await openPanelRoom(context, page);
  // An accordion opening through a max-height transition, then a box growing with an ease transition.
  const accordion = (answer: number) =>
    `<style>.a{overflow:hidden;max-height:0;transition:max-height 1s linear}.a.o{max-height:1000px}
      #g{height:40px;transition:height .8s ease}</style>
    <p>FAQ</p><div class="a" id="a"><div style="height:${answer}px">Answer</div></div><div id="g"></div>
    <script>setTimeout(() => a.classList.add('o'), 200); setTimeout(() => { g.style.height = '100px'; }, 1500);</script>`;
  await sendInlineCanvas(room, 'Preview accordion', accordion(300), { raw: true });
  await sendInlineCanvas(room, 'Themed accordion', accordion(1200));
  const themed = page.locator('iframe[title="Themed accordion"]');
  await expect(themed).toBeVisible({ timeout: 60_000 });
  await expect
    .poll(async () => (await themed.boundingBox())?.height ?? 0, { timeout: 20_000 })
    .toBeGreaterThan(1080);
  await page.waitForTimeout(1_500);
  await expectFitted(page, 'Preview accordion');
  expect(
    (await page.locator('iframe[title="Preview accordion"]').locator('xpath=..').boundingBox())
      ?.height
  ).toBeLessThan(568);
  await expectFitted(page, 'Themed accordion');
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
  expect(column).toBeLessThan(1440);
  const scale = column / 1440;
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

test("a raw page follows the browser's color scheme, not Chat's theme, inline and in the panel", async ({
  browser,
}) => {
  // The browser prefers light while Chat shows its dark theme.
  const context = await browser.newContext({
    colorScheme: 'light',
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    localStorage.setItem(
      'settings',
      JSON.stringify({ useSystemTheme: false, themeId: 'dark-theme' })
    );
  });
  const room = await openPanelRoom(context, page);
  await sendInlineCanvas(
    room,
    'Scheme preview',
    `<p id="scheme"></p><script>
      document.getElementById('scheme').textContent =
        matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    </script>`,
    { raw: true }
  );
  const inline = page.frameLocator('iframe[title="Scheme preview"]').frameLocator('iframe');
  await expect(inline.locator('#scheme')).toHaveText('light', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Open canvas', exact: true }).last().click();
  const panel = page
    .locator('aside[aria-label="Canvas panel"] iframe')
    .contentFrame()
    .locator('iframe')
    .contentFrame();
  await expect(panel.locator('#scheme')).toHaveText('light', { timeout: 30_000 });
  await context.unrouteAll({ behavior: 'ignoreErrors' });
  await context.close();
});
