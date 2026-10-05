import { expect, test, type Page } from '@playwright/test';

const cardGeometry = (page: Page) =>
  page.locator('[data-thread-root-id]').evaluateAll((cards) =>
    cards.map((card) => {
      const rect = (element: Element | null) => element!.getBoundingClientRect();
      const style = getComputedStyle(card);
      const contentLeft =
        rect(card).left +
        Number.parseFloat(style.borderLeftWidth) +
        Number.parseFloat(style.paddingLeft);
      const contentRight =
        rect(card).right -
        Number.parseFloat(style.borderRightWidth) -
        Number.parseFloat(style.paddingRight);
      const [titleRow, previewRow] = Array.from(card.children);
      const title = titleRow.firstElementChild!;
      const preview = previewRow.firstElementChild!;
      const metadata = card.querySelector('[data-compact-card-metadata="true"]');
      const menu = card.parentElement!.querySelector('[aria-label="More options"]');
      return {
        contentLeft,
        contentRight,
        titleLeft: rect(title).left,
        previewLeft: rect(preview).left,
        previewRight: rect(preview).right,
        previewHasCount: previewRow.querySelector('[data-compact-card-reply-count]') !== null,
        metadataCenter: (rect(metadata).top + rect(metadata).bottom) / 2,
        menuCenter: (rect(menu).top + rect(menu).bottom) / 2,
      };
    })
  );

test('compact cards give the title and preview the full width on a phone', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/e2e/fixtures/compact-thread-cards.html');
  await page.locator('body[data-fixture-ready="true"]').waitFor();

  const cards = await cardGeometry(page);
  expect(cards).toHaveLength(6);
  cards.forEach((card) => {
    // No reserved unread gutter: title and preview start at the content edge.
    expect(Math.abs(card.titleLeft - card.contentLeft)).toBeLessThanOrEqual(1);
    expect(Math.abs(card.previewLeft - card.contentLeft)).toBeLessThanOrEqual(1);
    // Neither the reply count nor the touch menu button narrows the preview.
    expect(card.previewHasCount).toBe(false);
    expect(Math.abs(card.previewRight - card.contentRight)).toBeLessThanOrEqual(1);
    // The menu button sits on the last row.
    expect(Math.abs(card.menuCenter - card.metadataCenter)).toBeLessThanOrEqual(1);
  });

  // Unread threads are marked by an accent edge, not a dot.
  const unread = page.locator('[data-thread-unread="true"]');
  await expect(unread).toHaveCount(2);
  await expect(unread.first()).not.toHaveCSS('box-shadow', 'none');
  await expect(page.locator('[data-thread-root-id]:not([data-thread-unread])').first()).toHaveCSS(
    'box-shadow',
    'none'
  );
  await page.screenshot({ path: testInfo.outputPath('compact-thread-cards-phone.png') });
});
