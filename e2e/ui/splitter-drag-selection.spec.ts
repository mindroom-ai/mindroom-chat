import { expect, test, type Page } from '@playwright/test';

// A drag on a side panel's splitter selects no text on the page (e2e/fixtures/splitter-drag.tsx).
// A panel at its widest stays put while the held mouse goes on over the conversation, where the
// Mac app's web view selected messages although the splitter cancels the press's pointerdown.
// Desktop browsers start no selection there, so the spec selects what such a gesture would (from
// the caret positions under the pointer) and checks that nothing is selected while the drag runs.
// SPLITTER_SHOTS names a directory for a screenshot of the page in the middle of the drag.

const open = async (page: Page, query = '') => {
  await page.goto(`/e2e/fixtures/splitter-drag.html${query}`);
  const splitter = page.getByRole('separator', { name: 'Resize Example panel' });
  await expect(splitter).toBeVisible();
  const box = (await splitter.boundingBox())!;
  return { panel: page.getByTestId('example-panel'), x: box.x + box.width / 2, y: box.y + 120 };
};

const width = async (page: Page) => (await page.getByTestId('example-panel').boundingBox())!.width;

/** Selects the text between the caret positions at two points, as a text gesture would. */
const selectBetween = (page: Page, from: [number, number], to: [number, number]) =>
  page.evaluate(
    ([[x1, y1], [x2, y2]]) => {
      const start = document.caretRangeFromPoint(x1, y1);
      const end = document.caretRangeFromPoint(x2, y2);
      const selection = window.getSelection()!;
      if (start && end) {
        selection.setBaseAndExtent(
          start.startContainer,
          start.startOffset,
          end.endContainer,
          end.endOffset
        );
      }
      return selection.toString();
    },
    [from, to] as const
  );

/** A real mouse drag over the conversation, as a reader selects messages. */
const dragOverConversation = async (page: Page) => {
  await page.mouse.move(40, 30);
  await page.mouse.down();
  await page.mouse.move(300, 120, { steps: 5 });
  await page.mouse.up();
  return page.evaluate(() => window.getSelection()!.toString());
};

test('a drag on the splitter of a panel at its widest selects no text @webkit', async ({
  page,
}) => {
  const { x, y } = await open(page);
  const widest = await width(page);
  await page.mouse.move(x, y);
  await page.mouse.down();
  // Past the widest, over the conversation: the panel stays and the pointer leaves the splitter.
  await page.mouse.move(x - 300, y + 30, { steps: 10 });
  expect(await width(page)).toBe(widest);
  expect(await selectBetween(page, [24, 24], [x - 300, y + 30])).toBe('');
  const shots = process.env.SPLITTER_SHOTS;
  if (shots) {
    await page.screenshot({ path: `${shots}/${test.info().project.name}-drag.png` });
  }
  await page.mouse.up();
  expect(await width(page)).toBe(widest);
  // Once released, the page selects again.
  expect(await dragOverConversation(page)).not.toBe('');
});

test('a drag on the splitter resizes the panel and selects no text on its way @webkit', async ({
  page,
}) => {
  const { x, y } = await open(page, '?width=500');
  expect(await width(page)).toBe(500);
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y, { steps: 5 });
  expect(await selectBetween(page, [24, 24], [300, 200])).toBe('');
  await page.mouse.up();
  expect(await width(page)).toBe(400);
  // And to the conversation's side, wider.
  await page.mouse.move(x + 100, y);
  await page.mouse.down();
  await page.mouse.move(x - 100, y, { steps: 5 });
  await page.mouse.up();
  expect(await width(page)).toBe(600);
  expect(await dragOverConversation(page)).not.toBe('');
});

test('a cancelled drag on the splitter lets the page select again @webkit', async ({ page }) => {
  const { x, y } = await open(page);
  await page.evaluate(() => {
    document.addEventListener('pointerdown', (event) => {
      document.body.dataset.pointerId = String(event.pointerId);
    });
  });
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x - 200, y, { steps: 5 });
  expect(await selectBetween(page, [24, 24], [300, 200])).toBe('');
  await page
    .getByRole('separator', { name: 'Resize Example panel' })
    .dispatchEvent('pointercancel', {
      pointerId: Number(await page.locator('body').getAttribute('data-pointer-id')),
      isPrimary: true,
    });
  await page.mouse.up();
  expect(await dragOverConversation(page)).not.toBe('');
});
