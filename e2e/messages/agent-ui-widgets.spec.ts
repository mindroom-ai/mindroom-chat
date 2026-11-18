import type { Locator } from '@playwright/test';
import {
  bodyOf,
  expect,
  messageRow,
  openThread,
  startThread,
  test,
  uniqueWord,
  waitForAgentReply,
} from '../helpers/agentStack';

// The stub's #chart reply: a sentence, a `ui` chart block and a sentence, which a backend with
// `ui_widgets` on the helper sends as a fallback block and the reply's io.mindroom.ui.
test.describe.configure({ timeout: 300_000 });

/** The vertical order of the reply's first sentence, its chart and its last sentence. */
const order = (row: Locator) =>
  row.evaluate((element) => {
    const top = (node: Element | null | undefined) => node?.getBoundingClientRect().top ?? NaN;
    const paragraphs = [...element.querySelectorAll('p')];
    const first = paragraphs.find((p) => p.textContent?.includes('Signups peaked'));
    const last = paragraphs.find((p) => p.textContent?.includes('March is still'));
    return [top(first), top(element.querySelector('figure')), top(last)];
  });

test('an agent reply draws its chart between its sentences, after a reload and on a phone', async ({
  page,
  stack,
}) => {
  const checkout = process.env.E2E_MINDROOM_CHECKOUT ?? 'the default MindRoom checkout';
  test.skip(
    !stack.uiWidgets,
    `${checkout} at ${stack.sha} has no ui_widgets, so this run is no evidence for widgets`
  );
  const rootId = await startThread(stack, `${uniqueWord('signups')} #chart`);
  const reply = await waitForAgentReply(stack, rootId, (body) => body.includes('```mindroom-ui-'));
  // Other clients read the fallback table, never the widget's JSON.
  expect(bodyOf(reply)).not.toContain('"series"');

  await openThread(page, stack, rootId);
  const row = messageRow(page, reply.event_id);
  const figure = row.locator('figure', { hasText: 'Signups' });
  await expect(figure).toBeVisible({ timeout: 60_000 });
  await expect(row.locator('pre')).toHaveCount(0);
  const [first, chart, last] = await order(row);
  expect(first).toBeLessThan(chart!);
  expect(chart).toBeLessThan(last!);

  await figure.getByRole('button', { name: 'Table' }).click();
  await expect(figure.locator('tbody tr')).toHaveCount(3);

  await page.reload();
  await expect(figure).toBeVisible({ timeout: 90_000 });
  await expect(figure.locator('[dir="ltr"] svg')).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(figure).toBeVisible();
  const fits = await row.evaluate((element) => {
    const card = element.querySelector('figure')?.getBoundingClientRect();
    const box = element.getBoundingClientRect();
    return (
      !!card &&
      card.left >= box.left &&
      card.right <= box.right &&
      document.documentElement.scrollWidth <= window.innerWidth
    );
  });
  expect(fits).toBe(true);
});
