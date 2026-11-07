import type { Locator, Page } from '@playwright/test';
import {
  expect,
  messageRow,
  openLobby,
  showThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
  waitForThreadEvent,
  type AgentStack,
} from '../helpers/agentStack';

// A reply's tool-call list that a person opened stays open while the reply's later edits and live
// frames arrive: the run's next calls, a denial's outcome and the final answer redraw the reply,
// not the list's state. A watcher in the page records every moment the list was closed or drawn
// again from scratch, so a close that a later frame hides still fails the test.
test.describe.configure({ timeout: 300_000 });

const VIEWPORTS = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'phone', width: 390, height: 844 },
] as const;

type ListWatch = { closed: string[] };

/** The reply's tool-call line: the button that opens its list. */
const toolLine = (row: Locator): Locator =>
  row.getByRole('button', { name: /\d+ tool calls?\b/ });

/**
 * Marks the open list's button and records, on every change to the page, whether the reply still
 * shows that same button open. A new button means the list was drawn again and lost its state.
 */
const watchList = (page: Page, eventId: string) =>
  page.evaluate((id) => {
    const watch: ListWatch = { closed: [] };
    (window as unknown as { listWatch: ListWatch }).listWatch = watch;
    const find = () =>
      [
        ...document.querySelectorAll<HTMLButtonElement>(
          `[data-message-id="${id}"] [data-message-disclosure] > button[aria-expanded]`
        ),
      ].find((button) => /\d+ tool calls?\b/.test(button.textContent ?? ''));
    find()?.setAttribute('data-watched-list', '');
    new MutationObserver(() => {
      const button = find();
      const state = !button
        ? 'gone'
        : !button.hasAttribute('data-watched-list')
        ? `drawn again (${button.getAttribute('aria-expanded')})`
        : button.getAttribute('aria-expanded') !== 'true'
        ? 'closed'
        : undefined;
      if (state && watch.closed.at(-1) !== state) watch.closed.push(state);
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-expanded'],
    });
  }, eventId);

const closedMoments = (page: Page) =>
  page.evaluate(() => (window as unknown as { listWatch: ListWatch }).listWatch.closed);

const openList = async (line: Locator) => {
  await line.click();
  await expect(line).toHaveAttribute('aria-expanded', 'true');
};

const firstReply = (stack: AgentStack, rootId: string) =>
  waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.agents.helper && event.type === 'm.room.message',
    { description: "the helper's reply" }
  );

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
    });

    test(
      'a tool-call list opened while the run goes on stays open through its edits',
      { tag: '@webkit' },
      async ({ page, stack }) => {
        await openLobby(page, stack);
        // Three shell calls; the second sleeps 10 s, so the reply is edited while the list is open.
        const rootId = await startThread(stack, `${uniqueWord('openlist')} #multi`);
        await showThread(page, stack, rootId);
        const reply = messageRow(page, (await firstReply(stack, rootId)).event_id);
        const line = toolLine(reply);
        await expect(line).toBeVisible({ timeout: 60_000 });
        await openList(line);
        await watchList(page, (await firstReply(stack, rootId)).event_id);

        await waitForAgentReply(stack, rootId, (body) => /Finished \*{0,2}multi/.test(body));
        await expect(line).toContainText('Ran 3 tool calls', { timeout: 30_000 });
        // Past the live frames' freshness the reply shows its final edit.
        await page.waitForTimeout(13_000);
        await expect(reply.getByText('echo step three', { exact: true })).toBeVisible();
        expect(await closedMoments(page)).toEqual([]);
        await expect(line).toHaveAttribute('aria-expanded', 'true');
      }
    );

    test(
      'a denied call list opened before the reply ends stays open through its last edits',
      { tag: '@webkit' },
      async ({ page, stack }) => {
        await openLobby(page, stack);
        const rootId = await startThread(stack, `${uniqueWord('denylist')} #approve`);
        await showThread(page, stack, rootId);
        const bar = page.getByRole('region', { name: 'Thread approvals' });
        await bar.getByRole('button', { name: /^Review 1/ }).click({ timeout: 90_000 });
        const dialog = page.getByRole('dialog', { name: 'Helper wants to do 1 thing' });
        await dialog.getByRole('button', { name: 'Deny' }).click();
        await dialog.getByRole('button', { name: 'Confirm deny' }).click();
        await expect(dialog).toContainText('Denied', { timeout: 60_000 });
        await dialog.getByRole('button', { name: 'Close' }).click();

        const replyId = (await firstReply(stack, rootId)).event_id;
        const reply = messageRow(page, replyId);
        const line = toolLine(reply);
        await expect(line).toContainText('Denied 1 tool call', { timeout: 60_000 });
        await openList(line);
        await watchList(page, replyId);

        await waitForAgentReply(stack, rootId, () => true, { timeout: 120_000 });
        await page.waitForTimeout(13_000);
        await expect(reply.locator('[data-tool-index="1"]')).toContainText(
          'echo needs-approval: deploy the stub'
        );
        expect(await closedMoments(page)).toEqual([]);
        await expect(line).toHaveAttribute('aria-expanded', 'true');
      }
    );
  });
}
