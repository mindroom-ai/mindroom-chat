import type { Locator, Page } from '@playwright/test';
import {
  expect,
  openLobby,
  startThread,
  test,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
} from '../helpers/agentStack';
import { roomMoreOptions } from '../helpers/roomMenu';

// The client SDK's `ThreadBoard` end to end: a production build with the example client plugin
// (src/app/plugins/__fixtures__/example-plugin) against the agent stack. The plugin's "Example
// board" panel shows the lobby's threads in a column each by state, and moves them without a
// reload: a thread whose reply streams is in Working and moves to Open as the reply ends, one the
// helper resolves is in Done, one with a pending schedule is in Later with its next run; the
// board's own card actions resolve a thread (Done), reopen it (Open) and snooze it (Later, with
// its time); and choosing a card opens its thread in the room's page beside the board.
//   MINDROOM_CLIENT_PLUGINS=$PWD/src/app/plugins/__fixtures__/example-plugin \
//     scripts/e2e-slot.sh <slot> --preview npx playwright test e2e/plugins/agent-thread-board.spec.ts
test.skip(
  !process.env.MINDROOM_CLIENT_PLUGINS?.includes('example-plugin'),
  'needs a build with the example client plugin in MINDROOM_CLIENT_PLUGINS'
);
test.describe.configure({ timeout: 360_000 });
test.use({ viewport: { width: 1600, height: 900 } });

const STREAM_EVENT_TIMEOUT = 90_000;

const boardPanel = (page: Page): Locator =>
  page.getByRole('region', { name: 'Example board', exact: true });

/** The card of `rootId` in the board's column `column`. */
const cardIn = (panel: Locator, column: string, rootId: string): Locator =>
  panel.locator(`[data-thread-board-column="${column}"] [data-thread-root-id="${rootId}"]`);

const heading = (panel: Locator, column: string): Locator =>
  panel.locator(`[data-thread-board-column="${column}"] h2`);

/** Opens the "Example board" panel from the room menu. */
const openBoard = async (page: Page): Promise<Locator> => {
  await roomMoreOptions(page).click();
  await page.getByRole('menuitemcheckbox', { name: 'Example board', exact: true }).click();
  const panel = boardPanel(page);
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
};

/** The helper's reply in the thread, once it is sent in full. */
const finishedReply = (stack: AgentStack, rootId: string) =>
  waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.agents.helper && event.type === 'm.room.message',
    { timeout: STREAM_EVENT_TIMEOUT, description: "the helper's reply" }
  );

test("a plugin's board keeps each thread in the column of its state, without a reload", async ({
  page,
  stack,
}) => {
  const word = uniqueWord('board');
  const openRoot = await startThread(stack, `${word} open`);
  const resolvedRoot = await startThread(stack, `${word} #resolve`);
  const scheduledRoot = await startThread(stack, `${word} #schedule`);
  await finishedReply(stack, openRoot);

  await openLobby(page, stack);
  const panel = await openBoard(page);
  await expect(heading(panel, 'working')).toHaveText(/^Working \d+$/);
  await expect(heading(panel, 'later')).toHaveText(/^Later \d+$/);
  await expect(heading(panel, 'open')).toHaveText(/^Open \d+$/);
  await expect(heading(panel, 'done')).toHaveText(/^Done \d+$/);
  await expect(cardIn(panel, 'open', openRoot)).toBeVisible({ timeout: 60_000 });
  await expect(cardIn(panel, 'done', resolvedRoot)).toBeVisible({ timeout: 90_000 });
  // The schedule's next run shows on its card.
  const scheduled = cardIn(panel, 'later', scheduledRoot);
  await expect(scheduled).toBeVisible({ timeout: 90_000 });
  await expect(scheduled.getByRole('img', { name: /^1 pending scheduled task, / })).toBeVisible();

  // A reply that streams puts its thread in Working; once it ends, the thread is in Open.
  const streamRoot = await startThread(stack, `${word} #work words=400 wps=15`);
  await expect(cardIn(panel, 'working', streamRoot)).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: test.info().outputPath('board-working.png') });
  await expect(cardIn(panel, 'open', streamRoot)).toBeVisible({ timeout: 120_000 });
  await expect(panel.locator(`[data-thread-root-id="${streamRoot}"]`)).toHaveCount(1);

  // The card's Resolve puts the thread in Done, its menu's Reopen back in Open.
  const open = cardIn(panel, 'open', openRoot);
  await open.hover();
  await panel
    .locator(`[data-thread-board-column="open"] [data-scroll-anchor="${openRoot}"]`)
    .locator('[data-compact-thread-resolve]')
    .click();
  const done = cardIn(panel, 'done', openRoot);
  await expect(done).toBeVisible({ timeout: 30_000 });
  await done.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reopen thread', exact: true }).click();
  await expect(cardIn(panel, 'open', openRoot)).toBeVisible({ timeout: 30_000 });

  // Snoozed from its menu, the thread is in Later and its card says until when.
  await cardIn(panel, 'open', openRoot).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Snooze', exact: true }).click();
  await page
    .getByRole('menu', { name: 'Snooze until' })
    .getByRole('menuitemradio', { name: /^Tomorrow 09:00/ })
    .click();
  const snoozed = cardIn(panel, 'later', openRoot);
  await expect(snoozed).toBeVisible({ timeout: 30_000 });
  await expect(snoozed).toContainText('Snoozed until');
  await page.screenshot({ path: test.info().outputPath('board-columns.png') });

  // Choosing a card opens its thread in the room's page; the board stays.
  await cardIn(panel, 'done', resolvedRoot).click();
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(new RegExp(`threadId=${encodeURIComponent(resolvedRoot)}`));
  await expect(cardIn(panel, 'done', resolvedRoot)).toBeVisible();
});
