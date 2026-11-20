import { expect, test, type Locator, type Page } from '@playwright/test';
import { disposableHomeserverIsUp } from '../helpers/disposableAccounts';
import { roomHeader } from '../helpers/roomMenu';
import { openPanel, openPanelRoom, panelLocator, widthOf } from '../helpers/sidePanels';
import { blockWebKitServiceWorkers } from '../helpers/webkit';

// A side panel folded from its frame's strip (the computer's) is its tab alone at the room's end
// edge, and the conversation takes the rest of the row, from the panel's default width and from
// its widest, in Chromium and, tagged `@webkit` for the WebKit project, in WebKit. Folded, the
// panel's box sizes to what it holds, the strip alone; in WebKit a flex item's width, unlike its
// flex basis, counts toward that size, so a strip that took the content's width there kept the
// folded panel as wide as it was. FOLD_SHOTS names a directory for a screenshot of each fold.

test.use({ viewport: { width: 1600, height: 1000 }, video: 'off', ...blockWebKitServiceWorkers });
// The page's live sync may still be in a route when the test ends.
test.afterEach(async ({ context }) => {
  await context.unrouteAll({ behavior: 'ignoreErrors' });
});

const SHOTS = process.env.FOLD_SHOTS;
/** How much wider than its tab a folded panel's box may be: the room's gap (S200). */
const GAP = 8;

/** The panel's box, its card (the box's first child) and the conversation beside it, in px. */
const widths = async (page: Page, panel: Locator) => ({
  panel: await widthOf(panel),
  card: await widthOf(panel.locator(':scope > :first-child')),
  conversation: await widthOf(roomHeader(page)),
});

for (const start of ['default', 'widest'] as const) {
  test(`a side panel folds to its tab from its ${start} width @webkit`, async ({
    browserName,
    context,
    page,
  }) => {
    test.skip(!(await disposableHomeserverIsUp()), 'Needs the disposable homeserver.');
    test.setTimeout(5 * 60_000);
    const room = await openPanelRoom(context, page);
    await openPanel(page, room, 'computer');
    const panel = panelLocator(page, 'computer');
    const settled = () =>
      panel.evaluate((element) =>
        Promise.all(element.getAnimations().map((animation) => animation.finished))
      );
    await settled();
    if (start === 'widest') {
      const opened = await widthOf(panel);
      const splitter = panel.locator(':scope > [role="separator"]');
      await splitter.press('End');
      const widest = Number(await splitter.getAttribute('aria-valuemax'));
      await expect
        .poll(async () => Number(await splitter.getAttribute('aria-valuenow')))
        .toBeGreaterThanOrEqual(widest - 1);
      await settled();
      await expect.poll(() => widthOf(panel)).toBeGreaterThan(opened);
    }
    const beside = await widths(page, panel);

    await panel.getByRole('button', { name: 'Fold Computer to the edge', exact: true }).click();
    const tab = panel.getByRole('button', { name: 'Unfold Computer', exact: true });
    await expect(tab).toBeVisible();
    await settled();
    const folded = { ...(await widths(page, panel)), tab: await widthOf(tab) };
    // eslint-disable-next-line no-console
    console.log(`${browserName} ${start}:`, JSON.stringify({ beside, folded }));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${browserName}-${start}.png` });
    // The box and its card are the tab, and at most the room's gap beside it.
    for (const box of [folded.panel, folded.card]) {
      expect(box).toBeGreaterThanOrEqual(folded.tab - 1);
      expect(box).toBeLessThanOrEqual(folded.tab + GAP);
    }
    expect(folded.conversation).toBeGreaterThan(beside.conversation + beside.panel - 60);

    await tab.click();
    await expect.poll(() => widthOf(panel)).toBe(beside.panel);
  });
}
