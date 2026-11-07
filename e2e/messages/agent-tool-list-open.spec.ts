import { mkdirSync } from 'node:fs';
import type { Locator, Page, TestInfo } from '@playwright/test';
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
// not the list's state. MindRoom streams a reply as a notice whose run details arrive later, and
// its last edit makes it text. A watcher in the page records every moment the list was closed or
// drawn again from scratch, so a close that a later frame hides still fails the test. On a desktop
// (1280 by 800) and a phone (390 by 844, touch), in Chromium and WebKit. TOOL_LIST_SHOTS names a
// directory for screenshots.
test.describe.configure({ timeout: 300_000 });

const SHOTS = process.env.TOOL_LIST_SHOTS;
const VIEWPORTS = [
  { name: 'desktop', viewport: { width: 1280, height: 800 }, hasTouch: false },
  { name: 'phone', viewport: { width: 390, height: 844 }, hasTouch: true },
] as const;

type ListWatch = { changes: string[] };

/** The reply's tool-call line: the button that opens its list. */
const toolLine = (row: Locator): Locator =>
  row.getByRole('button', { name: /\d+ tool calls?\b/ });

/**
 * Marks the open list's button, and every element up to the reply's row, and records each change
 * of what the reply shows: the same button closed, no button, or a button drawn again, naming the
 * element whose subtree was drawn again.
 */
const watchList = (page: Page, eventId: string) =>
  page.evaluate((id) => {
    const watch: ListWatch = { changes: [] };
    (window as unknown as { listWatch: ListWatch }).listWatch = watch;
    const started = performance.now();
    // The line's text runs its title into its detail ("Ran 3 tool callsrun_shell_command").
    const find = () =>
      [
        ...document.querySelectorAll(
          `[data-message-id="${id}"] [data-message-disclosure] > button[aria-expanded]`
        ),
      ].find((button) => /\d+ tool calls?/.test(button.textContent ?? ''));
    for (
      let element: Element | null = find() ?? null;
      element && !element.hasAttribute('data-message-id');
      element = element.parentElement
    ) {
      element.setAttribute('data-watched-list', '');
    }
    const describe = (element: Element) =>
      `${element.tagName.toLowerCase()}${[...element.attributes]
        .filter(({ name }) => name !== 'data-watched-list' && name !== 'style')
        .map(({ name, value }) => `[${name}=${value.slice(0, 40)}]`)
        .join('')}`;
    const drawnAgain = (button: Element) => {
      let root: Element = button;
      while (root.parentElement && !root.parentElement.hasAttribute('data-watched-list')) {
        if (root.parentElement.hasAttribute('data-message-id')) break;
        root = root.parentElement;
      }
      return `drawn again (${button.getAttribute('aria-expanded')}) from ${describe(root)}`;
    };
    let last: string | undefined;
    new MutationObserver(() => {
      const button = find();
      const state = !button
        ? 'gone'
        : !button.hasAttribute('data-watched-list')
        ? drawnAgain(button)
        : button.getAttribute('aria-expanded') !== 'true'
        ? 'closed'
        : undefined;
      if (state !== last && state !== undefined)
        watch.changes.push(`${Math.round(performance.now() - started)} ms: ${state}`);
      last = state;
    }).observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-expanded'],
    });
  }, eventId);

const listChanges = (page: Page) =>
  page.evaluate(() => (window as unknown as { listWatch: ListWatch }).listWatch.changes);

const openList = async (line: Locator, touch: boolean) => {
  await (touch ? line.tap() : line.click());
  await expect(line).toHaveAttribute('aria-expanded', 'true');
};

const shot = async (page: Page, testInfo: TestInfo, name: string) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/${testInfo.project.name}-${name}.png` });
};

const firstReply = (stack: AgentStack, rootId: string) =>
  waitForThreadEvent(
    stack,
    rootId,
    (event) => event.sender === stack.agents.helper && event.type === 'm.room.message',
    { description: "the helper's reply" }
  );

for (const { name, viewport, hasTouch } of VIEWPORTS) {
  test.describe(name, () => {
    test.use({ viewport, hasTouch });

    test(
      'a tool-call list opened while the run goes on stays open through its edits',
      { tag: '@webkit' },
      async ({ page, stack }, testInfo) => {
        await openLobby(page, stack);
        // Three shell calls; the second sleeps 10 s, so the reply is edited while the list is open.
        const rootId = await startThread(stack, `${uniqueWord('openlist')} #multi`);
        await showThread(page, stack, rootId);
        const replyId = (await firstReply(stack, rootId)).event_id;
        const reply = messageRow(page, replyId);
        const line = toolLine(reply);
        await expect(line).toBeVisible({ timeout: 60_000 });
        await openList(line, hasTouch);
        await watchList(page, replyId);

        await waitForAgentReply(stack, rootId, (body) => /Finished \*{0,2}multi/.test(body));
        await expect(line).toContainText('Ran 3 tool calls', { timeout: 30_000 });
        // Past the live frames' freshness the reply shows its final edit.
        await page.waitForTimeout(13_000);
        expect(await listChanges(page)).toEqual([]);
        await expect(reply.getByText('echo step three', { exact: true })).toBeVisible();
        await expect(line).toHaveAttribute('aria-expanded', 'true');
        await shot(page, testInfo, `${name}-ran`);
      }
    );

    test(
      'a denied call list opened before the reply ends stays open through its last edits',
      { tag: '@webkit' },
      async ({ page, stack }, testInfo) => {
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
        await openList(line, hasTouch);
        await watchList(page, replyId);

        await waitForAgentReply(stack, rootId, () => true, { timeout: 120_000 });
        await page.waitForTimeout(13_000);
        expect(await listChanges(page)).toEqual([]);
        await expect(reply.locator('[data-tool-index="1"]')).toContainText(
          'echo needs-approval: deploy the stub'
        );
        await expect(line).toHaveAttribute('aria-expanded', 'true');
        await shot(page, testInfo, `${name}-denied`);
      }
    );
  });
}
