import { expect, test } from '@playwright/test';

test('code block headers show the language icon and icon-only actions', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('/e2e/fixtures/code-blocks.html?theme=dark');
  const block = page.locator('pre').first();

  await expect(block.getByRole('img', { name: 'bash' })).toBeVisible();
  await expect(block.locator('[data-code-icon="bash"]')).toHaveCSS('color', 'rgb(94, 204, 113)');
  const wrap = block.getByRole('button', { name: 'Wrap lines', exact: true });
  await expect(wrap).toHaveAttribute('aria-pressed', 'true');

  await block.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(block.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain(
    'brew untap jackielii/tap'
  );
});

test('fenced code stays syntax highlighted while it streams', async ({ page }) => {
  await page.goto('/e2e/fixtures/code-blocks.html');
  const streaming = page.getByRole('region', { name: 'Streaming code' });
  const code = streaming.locator('pre code');
  await expect(code.locator('.token.keyword')).toHaveCount(1);

  await streaming.getByRole('button', { name: 'Stream another line' }).click();
  await streaming.getByRole('button', { name: 'Stream another line' }).click();

  await expect(code).toContainText('const line2 = 2;');
  await expect(code.locator('.token.keyword')).toHaveCount(3);
});
