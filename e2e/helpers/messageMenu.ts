import type { Locator, Page } from '@playwright/test';

/** The middle of the first `word` in the text of `row`, scrolled into view, in page pixels. */
const wordPoint = (row: Locator, word: string): Promise<{ x: number; y: number }> =>
  row.evaluate((element, wanted) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const at = node.textContent?.indexOf(wanted) ?? -1;
      if (at >= 0) {
        node.parentElement?.scrollIntoView({ block: 'nearest' });
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + wanted.length);
        const rect = range.getBoundingClientRect();
        return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
      }
    }
    throw new Error(`"${wanted}" is not in the message`);
  }, word);

/**
 * Opens the menu of the message `row` as a person would, at a `word` of its text that is no link:
 * a right click on a desktop, and on a phone (a page with touch) a tap on the word, then on the
 * message's More Options. A synthetic `contextmenu` event carries no pointer position, so the menu
 * it opens sits at the window's top-left.
 */
export const openMessageMenu = async (page: Page, row: Locator, word: string, phone: boolean) => {
  const { x, y } = await wordPoint(row, word);
  if (phone) {
    await page.touchscreen.tap(x, y);
    await row.getByRole('button', { name: 'More Options', exact: true }).tap();
    return;
  }
  await page.mouse.move(x, y);
  await page.mouse.click(x, y, { button: 'right' });
};
