import { expect, test } from '@playwright/test';
import { disposableHomeserverIsUp } from '../helpers/disposableAccounts';
import {
  CORE_PANELS,
  closePanel,
  openPanel,
  openPanelRoom,
  panelLocator,
} from '../helpers/sidePanels';

// One side panel at a time beside a room, against the disposable homeserver: for every pair of
// the computer, a canvas, the call and the members, opening the second takes the side panel from
// the first, which closes and does not come back when the second closes; only the members stay
// open behind the call, and show again once it closes.

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
