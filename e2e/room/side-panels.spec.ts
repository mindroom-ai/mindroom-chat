import { expect, test } from '@playwright/test';
import { disposableHomeserverIsUp } from '../helpers/disposableAccounts';
import {
  CORE_PANELS,
  checkPanelFrame,
  closePanel,
  openPanel,
  openPanelRoom,
  panelLocator,
  widthOf,
} from '../helpers/sidePanels';
import { roomHeader } from '../helpers/roomMenu';

// One side panel at a time beside a room, against the disposable homeserver: for every pair of
// the computer, a canvas, the call, the sub-agents and the members, opening the second takes the
// side panel from the first, which closes and does not come back when the second closes; only the
// members stay open behind the call, and show again once it closes.

test.use({ viewport: { width: 1600, height: 1000 }, video: 'off' });
// The page's live sync may still be in a route when the test ends.
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

test('each core side panel takes the place of every other', async ({ context, page }) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(10 * 60_000);
  const room = await openPanelRoom(context, page);

  for (const first of CORE_PANELS) {
    for (const then of CORE_PANELS.filter((panel) => panel !== first)) {
      // eslint-disable-next-line no-await-in-loop
      await test.step(`${then} after ${first}`, async () => {
        await openPanel(page, room, first);
        await openPanel(page, room, then);
        for (const other of CORE_PANELS.filter((panel) => panel !== then)) {
          // eslint-disable-next-line no-await-in-loop
          await expect(panelLocator(page, other)).toHaveCount(0);
        }
        await closePanel(page, then);
        if (first === 'members' && then === 'call') {
          await expect(panelLocator(page, 'members')).toBeVisible();
          await closePanel(page, 'members');
        }
        for (const panel of CORE_PANELS) {
          // eslint-disable-next-line no-await-in-loop
          await expect(panelLocator(page, panel)).toHaveCount(0);
        }
      });
    }
  }
});

test('a core side panel fills the room and folds to a tab at its edge, per room', async ({
  context,
  page,
}, testInfo) => {
  test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
  test.setTimeout(5 * 60_000);
  const room = await openPanelRoom(context, page);
  await openPanel(page, room, 'call');
  await checkPanelFrame(page, testInfo, room, { panel: panelLocator(page, 'call'), label: 'Call' });
});

test(
  'a core side panel dragged far over the conversation fills the room, and Shrink brings back its width',
  {
    tag: '@webkit',
  },
  async ({ context, page }) => {
    test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
    test.setTimeout(5 * 60_000);
    const room = await openPanelRoom(context, page);
    await openPanel(page, room, 'subagents');
    const panel = panelLocator(page, 'subagents');
    const fill = panel.getByRole('button', { name: 'Fill the room with Sub-agents', exact: true });
    const splitter = panel.getByRole('separator');
    // The panel has moved in to its width.
    await panel.evaluate((element) =>
      Promise.all(element.getAnimations().map((animation) => animation.finished))
    );
    const besideWidth = await widthOf(panel);
    const conversationWidth = await widthOf(roomHeader(page));

    const handle = (await splitter.boundingBox())!;
    const start = handle.x + handle.width / 2;
    const y = handle.y + handle.height / 2;
    const widest = Number(await splitter.getAttribute('aria-valuemax'));
    const overConversation = async () => {
      await page.mouse.move(start - conversationWidth + 40, y, { steps: 10 });
      // Held over the conversation, the panel follows the pointer past its widest.
      await expect(panel).toHaveAttribute('data-expand-preview', 'true');
      await expect(splitter).toHaveAttribute('aria-valuetext', 'Fill the room with Sub-agents');
      expect(await widthOf(panel)).toBeGreaterThan(widest + 40);
      // It reaches over the conversation, which keeps the width it has beside the panel at its
      // widest.
      const besideWidest = conversationWidth + besideWidth - widest;
      expect(Math.abs((await widthOf(roomHeader(page))) - besideWidest)).toBeLessThanOrEqual(1);
    };
    await page.mouse.move(start, y);
    await page.mouse.down();
    await overConversation();
    // Back where it started, nothing changed.
    await page.mouse.move(start, y, { steps: 10 });
    await expect(panel).not.toHaveAttribute('data-expand-preview', 'true');
    await expect
      .poll(async () => Math.abs((await widthOf(roomHeader(page))) - conversationWidth))
      .toBeLessThanOrEqual(1);
    await overConversation();
    await page.mouse.up();

    await expect(fill).toHaveAttribute('aria-pressed', 'true');
    await expect(panel).toHaveAttribute('data-filled', 'true');
    await expect(roomHeader(page)).toHaveCount(0);
    await fill.click();
    await expect(fill).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => widthOf(panel)).toBe(besideWidth);
  }
);
