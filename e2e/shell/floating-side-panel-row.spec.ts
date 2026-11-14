import { expect, test, type Page } from '@playwright/test';
import { loginWithPassword } from '../helpers/auth';
import { createRoom } from '../helpers/createRoom';
import {
  CHROMIUM_WITH_SCROLLBARS,
  DISPOSABLE_HOMESERVER as HOMESERVER,
  disposableHomeserverIsUp,
  registerDisposableUser,
} from '../helpers/disposableAccounts';

// In the floating cards layout a room's side panel is a card with a gap around it: the panel keeps
// the gap above and below, and the row it sits in keeps the gap at its end. That end gap comes from
// a rule that asks only rows marked `data-panel-row` (PanelRow), so a side panel mounted in another
// parent would silently lose it. Every panel the layout treats as a side panel sits in such a row.
const PASSWORD = 'floating-side-panel-row-spec-password';
const RUN = Date.now().toString(36);

test.use({ viewport: { width: 1280, height: 800 }, launchOptions: CHROMIUM_WITH_SCROLLBARS });

test.beforeEach(async () => {
  test.skip(!(await disposableHomeserverIsUp()), `No homeserver at ${HOMESERVER}`);
});

/** The panels the layout treats as side panels (it gives them the gap above), with their rows. */
const sidePanels = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-side='end']"))
      .map((panel) => ({ panel, gap: getComputedStyle(panel).paddingTop }))
      // A page's own column (the thread column) is flat: no gap.
      .filter(({ gap }) => gap !== '0px')
      .map(({ panel, gap }) => {
        const row = panel.parentElement;
        return {
          gap,
          inPanelRow: !!row?.hasAttribute('data-panel-row'),
          rowEndGap: row ? getComputedStyle(row).paddingInlineEnd : '',
        };
      })
  );

const expectInPanelRows = async (page: Page, where: string) => {
  const panels = await sidePanels(page);
  expect(panels.length, `${where}: the members panel is a side panel`).toBeGreaterThan(0);
  for (const { gap, inPanelRow, rowEndGap } of panels) {
    expect(inPanelRow, `${where}: the side panel sits in a panel row`).toBe(true);
    expect(rowEndGap, `${where}: the row keeps the gap at its end`).toBe(gap);
  }
};

test('the side panels of a room and of a space lobby sit in panel rows that keep the gap at their end', async ({
  page,
}) => {
  test.setTimeout(120_000);
  const username = `fspr_host_${RUN}`;
  const host = await registerDisposableUser(username, PASSWORD);
  const roomId = await createRoom(HOMESERVER, host.accessToken, { name: `Panel row ${RUN}` });
  const spaceId = await createRoom(HOMESERVER, host.accessToken, {
    name: `Panel row space ${RUN}`,
    space: true,
  });
  await loginWithPassword(page, { homeserver: HOMESERVER, username, password: PASSWORD });

  // The members panel opens beside the room and the lobby on wide screens.
  await page.goto(`/home/${encodeURIComponent(roomId)}`);
  await expect(page.getByRole('button', { name: 'Invite people' })).toBeVisible({
    timeout: 60_000,
  });
  await expectInPanelRows(page, 'room');

  await page.goto(`/${encodeURIComponent(spaceId)}/lobby/`);
  await expect(page.getByRole('button', { name: 'Invite people' })).toBeVisible({
    timeout: 60_000,
  });
  await expectInPanelRows(page, 'lobby');
});
