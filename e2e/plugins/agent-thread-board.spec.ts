import type { Locator, Page } from '@playwright/test';
import {
  expect,
  openLobby,
  routerToken,
  startThread,
  test,
  uniqueWord,
  waitForThreadEvent,
  type AgentStack,
} from '../helpers/agentStack';
import { matrixFetch, sendStateEvent } from '../helpers/matrix';
import { roomMoreOptions } from '../helpers/roomMenu';

// The client SDK's `ThreadBoard` end to end: a production build with the example client plugin
// (src/app/plugins/__fixtures__/example-plugin) against the agent stack. The plugin's "Example
// board" panel shows the lobby's threads in a column each by state, and moves them without a
// reload: a reply that streams puts its thread in Working until it ends (Open), and so does a
// background job; the board's own card actions resolve a thread (Done), reopen it (Open) and
// snooze it (Later, saying until when); a snooze whose time passes wakes its thread (Open); a
// schedule puts its thread in Later with its next run, until it runs or is cancelled; and choosing
// a card opens its thread in the room's page beside the board.
//   MINDROOM_CLIENT_PLUGINS=$PWD/src/app/plugins/__fixtures__/example-plugin \
//     scripts/e2e-slot.sh <slot> --preview npx playwright test e2e/plugins/agent-thread-board.spec.ts
test.skip(
  !process.env.MINDROOM_CLIENT_PLUGINS?.includes('example-plugin'),
  'needs a build with the example client plugin in MINDROOM_CLIENT_PLUGINS'
);
test.describe.configure({ timeout: 600_000 });
test.use({ viewport: { width: 1600, height: 900 } });

const TAGS_EVENT = 'com.mindroom.thread.tags';
const SCHEDULE_EVENT = 'com.mindroom.scheduled.task';

const boardPanel = (page: Page): Locator =>
  page.getByRole('region', { name: 'Example board', exact: true });

/** The card of `rootId` in the board's column `column`. */
const cardIn = (panel: Locator, column: string, rootId: string): Locator =>
  panel.locator(`[data-thread-board-column="${column}"] [data-thread-root-id="${rootId}"]`);

const heading = (panel: Locator, column: string): Locator =>
  panel.locator(`[data-thread-board-column="${column}"] > h2`);

/** Opens the "Example board" panel from the room menu. */
const openBoard = async (page: Page): Promise<Locator> => {
  await roomMoreOptions(page).click();
  await page.getByRole('menuitemcheckbox', { name: 'Example board', exact: true }).click();
  const panel = boardPanel(page);
  await expect(panel).toBeVisible({ timeout: 30_000 });
  return panel;
};

/** The helper's first reply in the thread. */
const helperReply = (stack: AgentStack, rootId: string) =>
  waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.agents.helper && event.type === 'm.room.message',
    { timeout: 90_000, description: "the helper's reply" }
  );

const tag = (stack: AgentStack, rootId: string, name: string, data?: Record<string, unknown>) =>
  sendStateEvent(
    stack.homeserver,
    stack.tester.accessToken,
    stack.rooms.lobby,
    TAGS_EVENT,
    JSON.stringify([rootId, name]),
    { set_by: stack.tester.userId, set_at: new Date().toISOString(), ...(data ? { data } : {}) }
  );

type StateEvent = {
  type: string;
  state_key: string;
  sender: string;
  content: { status?: string; thread_id?: string; workflow?: string };
};

/** The thread a schedule posts in: at the top of its content, or in its workflow. */
const scheduleThread = ({ content }: StateEvent): string | undefined => {
  if (content.thread_id) return content.thread_id;
  try {
    return (JSON.parse(content.workflow ?? '{}') as { thread_id?: string }).thread_id;
  } catch {
    return undefined;
  }
};

/** Cancels the thread's pending schedules as the agent account that made them. */
const cancelSchedules = async (stack: AgentStack, rootId: string) => {
  const state = await matrixFetch<StateEvent[]>(
    stack.homeserver,
    `/rooms/${encodeURIComponent(stack.rooms.lobby)}/state`,
    { accessToken: stack.tester.accessToken }
  );
  const tasks = state.filter(
    (event) =>
      event.type === SCHEDULE_EVENT &&
      event.content.status === 'pending' &&
      scheduleThread(event) === rootId
  );
  expect(tasks.map((task) => task.sender)).toEqual([stack.agents.router]);
  await Promise.all(
    tasks.map((task) =>
      sendStateEvent(
        stack.homeserver,
        routerToken(stack),
        stack.rooms.lobby,
        SCHEDULE_EVENT,
        task.state_key,
        { ...task.content, status: 'cancelled' }
      )
    )
  );
};

const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`board-${name}.png`) });

test("a plugin's board keeps each thread in the column of its state, without a reload", async ({
  page,
  stack,
}) => {
  const word = uniqueWord('board');
  const openRoot = await startThread(stack, `${word} open`);
  const doneRoot = await startThread(stack, `${word} done`);
  const wakeRoot = await startThread(stack, `${word} wakes`);
  const cancelRoot = await startThread(stack, `${word} #schedule`);
  await Promise.all([helperReply(stack, openRoot), helperReply(stack, doneRoot)]);
  await helperReply(stack, wakeRoot);
  await tag(stack, doneRoot, 'resolved');

  await openLobby(page, stack);
  const panel = await openBoard(page);
  for (const [column, name] of [
    ['working', 'Working'],
    ['later', 'Later'],
    ['open', 'Open'],
    ['done', 'Done'],
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await expect(heading(panel, column)).toHaveText(new RegExp(`^${name} \\d+$`));
  }
  await expect(cardIn(panel, 'open', openRoot)).toBeVisible({ timeout: 60_000 });
  await expect(cardIn(panel, 'done', doneRoot)).toBeVisible({ timeout: 60_000 });
  // A schedule puts its thread in Later, its card saying when it runs.
  const scheduled = cardIn(panel, 'later', cancelRoot);
  await expect(scheduled).toBeVisible({ timeout: 90_000 });
  await expect(scheduled.getByRole('img', { name: /^1 pending scheduled task, / })).toBeVisible();

  // A reply that streams, a background job and a schedule about to run, all at once.
  const streamRoot = await startThread(stack, `${word} #work words=300 wps=10`);
  const jobRoot = await startThread(stack, `${word} #job`);
  const soonRoot = await startThread(stack, `${word} #schedulesoon`);
  await expect(cardIn(panel, 'working', streamRoot)).toBeVisible({ timeout: 60_000 });
  await expect(cardIn(panel, 'working', jobRoot)).toBeVisible({ timeout: 60_000 });
  await expect(cardIn(panel, 'later', soonRoot)).toBeVisible({ timeout: 90_000 });
  await shot(page, 'working');

  // The card's Resolve puts the thread in Done, its menu's Reopen back in Open.
  await panel
    .locator(`[data-thread-board-column="open"] [data-scroll-anchor="${openRoot}"]`)
    .hover();
  await panel
    .locator(`[data-thread-board-column="open"] [data-scroll-anchor="${openRoot}"]`)
    .locator('[data-compact-thread-resolve]')
    .click();
  const done = cardIn(panel, 'done', openRoot);
  await expect(done).toBeVisible({ timeout: 30_000 });
  await done.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Reopen thread', exact: true }).click();
  await expect(cardIn(panel, 'open', openRoot)).toBeVisible({ timeout: 30_000 });
  // The menu stays open to show the result, as in the Compact view.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Thread options' })).toHaveCount(0);

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

  // A snooze whose time passes wakes its thread, with nothing else happening in it.
  await tag(stack, wakeRoot, 'snoozed', { until: new Date(Date.now() + 30_000).toISOString() });
  await expect(cardIn(panel, 'later', wakeRoot)).toBeVisible({ timeout: 20_000 });
  await shot(page, 'columns');
  await expect(cardIn(panel, 'open', wakeRoot)).toBeVisible({ timeout: 60_000 });

  // The stream ends and the job finishes: their threads go to Open, each card in one column.
  await expect(cardIn(panel, 'open', streamRoot)).toBeVisible({ timeout: 120_000 });
  await expect(cardIn(panel, 'open', jobRoot)).toBeVisible({ timeout: 120_000 });
  for (const rootId of [streamRoot, jobRoot, openRoot, wakeRoot]) {
    // eslint-disable-next-line no-await-in-loop
    await expect(panel.locator(`[data-thread-root-id="${rootId}"]`)).toHaveCount(1);
  }

  // A schedule that ran leaves Later; one that is cancelled too.
  await waitForThreadEvent(
    stack,
    soonRoot,
    (event) =>
      event.sender === stack.agents.router &&
      String(event.content.body ?? '').includes('[Automated Task]'),
    { timeout: 120_000, description: 'the automated task' }
  );
  await expect(cardIn(panel, 'later', soonRoot)).toHaveCount(0, { timeout: 60_000 });
  await expect(cardIn(panel, 'open', soonRoot)).toBeVisible({ timeout: 120_000 });
  await cancelSchedules(stack, cancelRoot);
  await expect(cardIn(panel, 'open', cancelRoot)).toBeVisible({ timeout: 30_000 });

  // Choosing a card opens its thread in the room's page; the board stays.
  await cardIn(panel, 'done', doneRoot).click();
  await expect(page.locator('[data-thread-context-banner]')).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(new RegExp(`threadId=${encodeURIComponent(doneRoot)}`));
  await expect(cardIn(panel, 'done', doneRoot)).toBeVisible();
  await shot(page, 'opened');
});
