import { expect, test, type Page } from '@playwright/test';

// A drag on a page's inset scrollbar selects no text (e2e/fixtures/scrollbar-drag.tsx). The page
// scrolls with the held mouse, and the Mac app's web view selected the cards under it as it went
// although the scrollbar cancels the press's pointerdown. Desktop browsers start no selection
// there, so the spec also selects what such a gesture would (from the caret positions under the
// pointer) and checks that nothing is selected while the drag runs.

const open = async (page: Page) => {
  await page.goto('/e2e/fixtures/scrollbar-drag.html');
  const track = page.getByRole('scrollbar', { name: 'Scroll example page' });
  await expect(track).toHaveAttribute('data-overflow', 'true');
  const box = (await track.boundingBox())!;
  return { x: box.x + box.width / 2, top: box.y + 40, bottom: box.y + box.height - 40 };
};

const scrollTop = (page: Page) =>
  page.evaluate(() => {
    const track = document.querySelector('[role="scrollbar"]')!;
    return document.getElementById(track.getAttribute('aria-controls')!)!.scrollTop;
  });

const selected = (page: Page) => page.evaluate(() => window.getSelection()!.toString());

/**
 * Selects the text between the caret positions at two points, as a text gesture would, and returns
 * what it selected after dropping it again, so the page holds only what the drag itself selects.
 */
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
      const text = selection.toString();
      selection.removeAllRanges();
      return text;
    },
    [from, to] as const
  );

/** A real mouse drag over the cards, as a reader selects them. */
const dragOverCards = async (page: Page) => {
  await page.mouse.move(40, 60);
  await page.mouse.down();
  await page.mouse.move(400, 200, { steps: 5 });
  await page.mouse.up();
  return selected(page);
};

test('a drag on the scrollbar scrolls the page and selects no text @webkit', async ({ page }) => {
  const { x, top, bottom } = await open(page);
  await page.mouse.move(x, top);
  await page.mouse.down();
  // Down the track, then back up, drifting off it over the cards as a hand does.
  await page.mouse.move(x - 20, bottom, { steps: 10 });
  const down = await scrollTop(page);
  expect(down).toBeGreaterThan(0);
  expect(await selected(page)).toBe('');
  expect(await selectBetween(page, [40, 60], [x - 200, bottom])).toBe('');
  await page.mouse.move(x - 40, top + 20, { steps: 10 });
  expect(await scrollTop(page)).toBeLessThan(down);
  expect(await selected(page)).toBe('');
  expect(await selectBetween(page, [40, 60], [x - 200, top + 20])).toBe('');
  await page.mouse.up();
  expect(await selected(page)).toBe('');
  // Once released, the page selects again.
  expect(await dragOverCards(page)).not.toBe('');
});

test('a cancelled drag on the scrollbar lets the page select again @webkit', async ({ page }) => {
  const { x, top, bottom } = await open(page);
  await page.evaluate(() => {
    document.addEventListener('pointerdown', (event) => {
      document.body.dataset.pointerId = String(event.pointerId);
    });
  });
  await page.mouse.move(x, top);
  await page.mouse.down();
  await page.mouse.move(x, bottom, { steps: 5 });
  expect(await selectBetween(page, [40, 60], [x - 200, bottom])).toBe('');
  await page
    .getByRole('scrollbar', { name: 'Scroll example page' })
    .dispatchEvent('pointercancel', {
      pointerId: Number(await page.locator('body').getAttribute('data-pointer-id')),
      isPrimary: true,
    });
  await page.mouse.up();
  expect(await dragOverCards(page)).not.toBe('');
});

/** The selection's text and its ends in the order the reader made them (anchor, then focus). */
const selectionEnds = (page: Page) =>
  page.evaluate(() => {
    const { anchorOffset, focusOffset } = window.getSelection()!;
    return { text: window.getSelection()!.toString(), anchorOffset, focusOffset };
  });

test('a drag on the scrollbar keeps what was selected before it @webkit', async ({ page }) => {
  const { x, top, bottom } = await open(page);
  // Selected backwards, from the 20th character to the 2nd, as a drag to the left does.
  await page.evaluate(() => {
    const text = document.querySelector('.selectable')!.firstChild!;
    window.getSelection()!.setBaseAndExtent(text, 20, text, 2);
  });
  const before = await selectionEnds(page);
  expect(before).toEqual({ text: 'ample room 1. The ', anchorOffset: 20, focusOffset: 2 });
  await page.mouse.move(x, top);
  await page.mouse.down();
  await page.mouse.move(x, bottom, { steps: 5 });
  await page.mouse.move(x, top, { steps: 5 });
  await page.mouse.up();
  expect(await selectionEnds(page)).toEqual(before);
});

test('a drag on the scrollbar beside a draft keeps the keys on the scrollbar @webkit', async ({
  page,
}) => {
  const { x, top, bottom } = await open(page);
  // The draft has the focus and a selection, as a composer does while its text is selected.
  const draft = page.getByRole('textbox', { name: 'Example draft' });
  await draft.focus();
  await draft.evaluate((editor) => {
    const text = editor.firstChild!;
    window.getSelection()!.setBaseAndExtent(text, 0, text, 5);
  });
  await page.mouse.move(x, top);
  await page.mouse.down();
  await page.mouse.move(x, bottom, { steps: 5 });
  await page.mouse.move(x, top, { steps: 5 });
  await page.mouse.up();
  const track = page.getByRole('scrollbar', { name: 'Scroll example page' });
  await expect(track).toBeFocused();
  await page.keyboard.press('End');
  // At the bottom: nothing left below the viewport.
  const below = () =>
    page.evaluate(() => {
      const track = document.querySelector('[role="scrollbar"]')!;
      const scroll = document.getElementById(track.getAttribute('aria-controls')!)!;
      return scroll.scrollHeight - scroll.clientHeight - scroll.scrollTop;
    });
  await expect.poll(below).toBeLessThan(1);
  expect(await scrollTop(page)).toBeGreaterThan(0);
});
