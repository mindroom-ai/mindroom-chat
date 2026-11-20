import { expect, test } from '@playwright/test';

for (const separator of ['', '&whitespace']) {
  test(`table after grouped tools keeps phone scrolling and grid${separator}`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/e2e/fixtures/message-tables.html?tools${separator}`);
    const table = page.getByRole('table');
    const scrollArea = page.getByRole('region', { name: 'Scrollable table' });
    await expect(scrollArea).toBeVisible();
    await expect(page.getByText('Scroll horizontally')).toBeVisible();
    expect(await scrollArea.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(
      await table
        .locator('td')
        .first()
        .evaluate((cell) => cell.clientWidth)
    ).toBeGreaterThan(120);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
    await expect(table.locator('td').first()).toHaveCSS('border-right-width', '1px');
    await expect(table.locator('td').first()).toHaveCSS('border-right-style', 'solid');
    await expect(table.locator('td').first()).toHaveCSS('border-bottom-width', '1px');
    await expect(table.locator('td').first()).toHaveCSS('border-bottom-style', 'solid');
    expect(
      await table
        .locator('td')
        .first()
        .evaluate((cell) => getComputedStyle(cell).borderColor)
    ).not.toBe('rgba(0, 0, 0, 0)');
    await scrollArea.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scrollArea.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await scrollArea.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(table.locator('td').last()).toBeInViewport();
    const tools = page.getByRole('button', { name: /^Ran 2 tool calls/ });
    const group = tools.locator('..');
    await tools.click();
    await expect(tools).toHaveAttribute('aria-expanded', 'true');
    await expect(group.locator('[data-tool-index]')).toHaveCount(2);
    for (const [index, name] of [
      [1, 'first_tool'],
      [2, 'second_tool'],
    ] as const) {
      const row = group.locator(`[data-tool-index="${index}"]`);
      await expect(row).toHaveCount(1);
      await expect(row.getByText(name, { exact: true })).toBeVisible();
    }
  });
}

for (const format of ['markdown', 'html']) {
  test(`${format} tables scroll without squeezing columns or widening the page`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`/e2e/fixtures/message-tables.html?format=${format}`);
    const table = page.getByRole('table');
    await expect(table).toBeVisible();

    // A complete word must fit even when the message inherits break-word.
    expect(
      await table
        .locator('td')
        .first()
        .evaluate((cell) => cell.clientWidth)
    ).toBeGreaterThan(120);
    const scrollArea = page.getByRole('region', { name: 'Scrollable table' });
    await expect(scrollArea).toBeVisible();
    await expect(page.getByText('Scroll horizontally')).toBeVisible();
    expect(await scrollArea.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

    await scrollArea.focus();
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scrollArea.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await scrollArea.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
    });
    await expect(table.locator('td').last()).toBeInViewport();

    // Both container resizing and streaming replacements update the hint.
    await page.setViewportSize({ width: 1600, height: 900 });
    await expect(page.getByText('Scroll horizontally')).toBeHidden();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(scrollArea).toBeVisible();
    await page.getByRole('button', { name: 'Toggle table width' }).click();
    await expect(page.getByText('Scroll horizontally')).toBeHidden();
    await expect(page.getByRole('region', { name: 'Scrollable table' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Toggle table width' }).click();
    await expect(scrollArea).toBeVisible();
  });
}

test('table grid has faint inner dividers and no outer border in both themes', async ({ page }) => {
  for (const theme of ['', '&dark']) {
    await page.goto(`/e2e/fixtures/message-tables.html?format=html${theme}`);
    const table = page.getByRole('table');
    await expect(table.getByText('Project overview')).toBeVisible();
    await expect(table).toHaveCSS('border-collapse', 'collapse');
    await expect(table).toHaveCSS('border-top-style', 'hidden');
    await expect(table).toHaveCSS('border-right-style', 'hidden');
    await expect(table).toHaveCSS('border-bottom-style', 'hidden');
    await expect(table).toHaveCSS('border-left-style', 'hidden');
    await expect(table.locator('td').first()).toHaveCSS('border-right-width', '1px');
    await expect(table.locator('td').first()).toHaveCSS('border-bottom-width', '1px');
    const color = await table
      .locator('td')
      .first()
      .evaluate((cell) => getComputedStyle(cell).borderColor);
    expect(color).not.toBe('rgba(0, 0, 0, 0)');
    expect(color).not.toBe(await table.evaluate((el) => getComputedStyle(el).color));
  }
});

test('a wide numeric table reads by row on a phone, by keyboard, while it grows', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/fixtures/message-tables.html?matrix');
  const byRow = page.getByRole('button', { name: 'Read by row' });
  const showTable = page.getByRole('button', { name: 'Show table' });
  await expect(page.getByRole('table')).toBeVisible();
  await expect(showTable).toHaveAttribute('aria-pressed', 'true');

  await byRow.focus();
  await page.keyboard.press('Enter');
  // One accessibility tree at a time: the rows replace the table.
  await expect(page.getByRole('table')).toHaveCount(0);
  await expect(page.getByText('Scroll horizontally')).toBeHidden();
  await expect(byRow).toBeFocused();
  await expect(byRow).toHaveAttribute('aria-pressed', 'true');
  const items = page.getByRole('listitem');
  await expect(items).toHaveCount(3);
  const first = items.first();
  await expect(first.getByText('M1', { exact: true })).toBeVisible();
  // Each label sits on the same line as its value, both readable without panning.
  const label = first.getByRole('term').filter({ hasText: 'Capex' });
  const value = first.getByRole('definition').filter({ hasText: '$0.0k' });
  await expect(label).toBeInViewport({ ratio: 1 });
  await expect(value).toBeInViewport({ ratio: 1 });
  expect(Math.abs((await label.boundingBox())!.y - (await value.boundingBox())!.y)).toBeLessThan(4);
  await expect(first.getByRole('link', { name: 'Ledger M1' })).toHaveAttribute(
    'href',
    'https://example.com/ledger/1'
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);

  // A streaming edit that adds a row shows it in the reader too.
  await page.getByRole('button', { name: 'Add row' }).click();
  await expect(items).toHaveCount(4);

  await showTable.focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('list')).toHaveCount(0);
  await expect(page.getByRole('table').locator('tbody tr')).toHaveCount(4);
  await expect(showTable).toBeFocused();
});

test('read by row is offered only for wide simple tables on phones', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/fixtures/message-tables.html?matrix&span');
  await expect(page.getByText('Scroll horizontally')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read by row' })).toHaveCount(0);

  await page.goto('/e2e/fixtures/message-tables.html?matrix');
  await expect(page.getByRole('button', { name: 'Read by row' })).toBeVisible();
  await page.setViewportSize({ width: 900, height: 844 });
  await expect(page.getByRole('button', { name: 'Read by row' })).toHaveCount(0);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/fixtures/message-tables.html');
  await page.getByRole('button', { name: 'Toggle table width' }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read by row' })).toHaveCount(0);
});

test('focus in the reader moves to the table when the reader leaves', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/e2e/fixtures/message-tables.html?matrix');
  await page.getByRole('button', { name: 'Read by row' }).focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Ledger M1' })).toBeFocused();
  // Off phones the reader goes away with the focused link.
  await page.setViewportSize({ width: 900, height: 844 });
  await expect(page.getByRole('link', { name: 'Ledger M1' })).toBeVisible();
  await expect(page.getByRole('table')).toBeFocused();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Read by row' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('list')).toBeVisible();
  // A streamed edit that adds a spanning row makes the table complex while a chip has focus.
  await expect(page.getByRole('button', { name: 'Read by row' })).toBeFocused();
  await page
    .getByRole('button', { name: 'Add spanning row' })
    .evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('button', { name: 'Read by row' })).toHaveCount(0);
  await expect(page.getByRole('table')).toBeFocused();
});
