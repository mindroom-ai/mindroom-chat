import { expect, test } from '@playwright/test';

// A server answers a path it has no file for with the app shell, so a frame of the app whose page
// is gone (the PDF viewer's frame page, say) gets the whole app: a second copy, on the same account
// and storage as the page around it. The app does not start inside a frame of its own origin.
test('the app does not start inside a frame of its own origin', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  const signIn = 'input[name="serverInput"]';
  await page.goto('/');
  await expect(page.locator(signIn)).toBeVisible({ timeout: 30_000 });

  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.title = 'Missing page';
    frame.src = '/missing-frame-page.html';
    document.body.append(frame);
  });
  await expect
    .poll(() => pageErrors)
    .toContainEqual(expect.stringContaining('does not start inside a frame of its own origin'));
  const frame = page.frameLocator('iframe[title="Missing page"]');
  await expect(frame.locator('#root')).toBeEmpty();
  await expect(frame.locator(signIn)).toHaveCount(0);
  // The page around the frame goes on.
  await expect(page.locator(signIn)).toBeVisible();
});
