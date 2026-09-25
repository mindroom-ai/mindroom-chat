import { expect, test } from '@playwright/test';

for (const [label, width, query] of [
  ['phone light', 390, ''],
  ['desktop dark', 1280, '?dark'],
] as const) {
  test(`document cards and edit review fit the ${label} layout`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 1200 });
    await page.goto(`/e2e/fixtures/document-cards.html${query}`);
    const cards = page.getByRole('region', { name: 'Microsoft 365 document' });
    await expect(cards).toHaveCount(4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);

    const edited = page.locator('[data-case="thread/edited"]');
    await expect(edited.getByText('Raise growth to 12% and refresh the narrative')).toBeVisible();
    await expect(edited.getByText('Applied', { exact: true })).toBeVisible();
    await expect(edited.getByRole('link', { name: 'Open in Excel' })).toHaveAttribute(
      'href',
      /^ms-excel:ofe\|u\|https:\/\/contoso\.sharepoint\.com\//
    );
    await expect(edited.getByRole('link', { name: 'Open in browser' })).toHaveAttribute(
      'target',
      '_blank'
    );

    const partial = page.locator('[data-case="thread/edited-partial"]');
    await expect(partial.getByText('Partially applied')).toBeVisible();
    await expect(partial.getByText('changed since it was read, skipped')).toBeVisible();

    const review = page.locator('[data-case="review"]');
    await expect(review.getByRole('table')).toHaveCount(2);
    await expect(review.getByText('B4', { exact: true })).toBeVisible();
    await expect(review.getByText('format 0%')).toBeVisible();
    await expect(
      review.getByText('Some values are hidden in this preview because they look like secrets.')
    ).toBeVisible();
    await testInfo.attach(`document-cards-${width}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: 'image/png',
    });
  });
}
