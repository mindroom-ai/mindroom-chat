/* eslint-disable no-await-in-loop -- Menus share focus and must open sequentially. */
import { expect, test } from '@playwright/test';
import { expectFloatingNavHeader, pixelDifference, sampleScreenshot } from './helpers/glassVisual';

for (const theme of ['silver', 'dark']) {
  test(`nested titles keep the surrounding panel color in ${theme}`, async ({
    page,
    browserName,
  }) => {
    await page.setViewportSize({ width: 390, height: 480 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?menus&theme=${theme}`);
    await page.getByRole('button', { name: 'Open filters' }).click();
    const title = page.locator('header').filter({ hasText: 'Filters' });
    const scroll = await expectFloatingNavHeader(title);
    await page.mouse.move(1, 1);
    const bounds = (await title.boundingBox())!;
    // Empty regions above/below the seam must match, not form a separately tinted band.
    const [header, body] = await sampleScreenshot(page, [
      { x: bounds.x + bounds.width - 68, y: bounds.y + bounds.height / 2 },
      { x: bounds.x + bounds.width - 68, y: bounds.y + bounds.height + 22 },
    ]);
    expect(pixelDifference(header, body), 'Header matches its enclosing panel').toBeLessThan(9);
    if (browserName === 'chromium') {
      // A new backdrop root can match the colors by disabling nested blur entirely.
      // Verify painted blur over real scrolling text, not just its computed CSS.
      await scroll.evaluate((element) => {
        element.scrollTop = 145;
      });
      const points = Array.from({ length: 200 }, (_, index) => ({
        x: bounds.x + 24 + (index % 40) * 3,
        y: bounds.y + bounds.height - 18 + Math.floor(index / 40) * 3,
      }));
      const blurred = await sampleScreenshot(page, points);
      await title.evaluate((element) => element.style.setProperty('backdrop-filter', 'none'));
      const unblurred = await sampleScreenshot(page, points);
      await title.evaluate((element) => element.style.removeProperty('backdrop-filter'));
      expect(
        blurred.reduce((sum, pixel, index) => sum + pixelDifference(pixel, unblurred[index]), 0),
        'Scrolling text is visibly blurred beneath the title'
      ).toBeGreaterThan(500);
    }
    await page.emulateMedia({ contrast: 'more' });
    await expect(title).toHaveCSS('backdrop-filter', 'none');
    await expect(title).toHaveCSS('background-color', /^rgb\(/);
  });

  test(`custom menus keep flat scrolling titles and keyboard selection in ${theme}`, async ({
    page,
  }, testInfo) => {
    for (const width of [390, 900]) {
      await page.setViewportSize({ width, height: 620 });
      await page.goto(`/e2e/fixtures/glass-surfaces.html?menus&theme=${theme}`);
      await page.getByRole('button', { name: 'Choose model', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Model for this thread' });
      const title = dialog.locator('[data-glass-flat="true"]').first();
      const scroll = await expectFloatingNavHeader(title);
      const search = dialog.getByRole('searchbox');
      await expect(search).toBeFocused();
      const track = scroll.getByRole('scrollbar');
      const bounds = (await track.boundingBox())!;
      await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.8);
      expect(await scroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
      await expect(search).toBeFocused();
      await page.keyboard.press('ArrowDown');
      const activeId = await search.getAttribute('aria-activedescendant');
      const option = page.locator(`[id="${activeId}"]`);
      await expect(option).toBeInViewport({ ratio: 1 });
      expect((await option.boundingBox())!.y).toBeGreaterThanOrEqual(
        (await title.boundingBox())!.y + (await title.boundingBox())!.height - 1
      );
      await scroll.evaluate((element) => {
        element.scrollTop = 160;
      });
      await expectFloatingNavHeader(title);
      await page.mouse.move(1, 1);
      await page.screenshot({ path: testInfo.outputPath(`models-${width}.png`), scale: 'css' });
      await search.fill('Studio model 24');
      await page.keyboard.press('Enter');
      await expect(page.locator('output')).toHaveText('model-24');
      await dialog.getByRole('button', { name: 'Close model picker' }).click();
      await expect(page.getByRole('button', { name: 'Choose model', exact: true })).toBeFocused();
    }

    await page.setViewportSize({ width: 390, height: 480 });
    await page.getByRole('button', { name: 'Open filters' }).click();
    const title = page.locator('header').filter({ hasText: 'Filters' });
    const scroll = await expectFloatingNavHeader(title);
    await scroll.evaluate((element) => {
      element.scrollTop = 200;
    });
    await expectFloatingNavHeader(title);
    await page.screenshot({ path: testInfo.outputPath('thread-filters.png'), scale: 'css' });
    await scroll.getByRole('scrollbar').press('End');
    await page.getByRole('button', { name: 'Filter option 20' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Open filters' })).toBeFocused();

    const invite = page.getByRole('textbox', { name: 'Invite search' });
    await invite.focus();
    const inviteHeader = page.locator('header').filter({ hasText: 'Invite people' });
    const inviteScroll = await expectFloatingNavHeader(inviteHeader);
    const inviteTrack = (await inviteScroll.getByRole('scrollbar').boundingBox())!;
    await page.mouse.click(
      inviteTrack.x + inviteTrack.width / 2,
      inviteTrack.y + inviteTrack.height * 0.8
    );
    await expect(invite).toBeFocused();
    expect(await inviteScroll.evaluate((element) => element.scrollTop)).toBeGreaterThan(100);
    await expectFloatingNavHeader(inviteHeader);
    await page.screenshot({ path: testInfo.outputPath('invite-autocomplete.png'), scale: 'css' });
    await page.keyboard.press('Escape');
    await expect(inviteHeader).toBeHidden();

    await page.getByRole('button', { name: 'Open autocomplete' }).click();
    const suggestions = page.locator('header').filter({ hasText: 'Suggestions' });
    const suggestionsScroll = await expectFloatingNavHeader(suggestions);
    const first = page.getByRole('button', { name: 'Suggestion 1', exact: true });
    const last = page.getByRole('button', { name: 'Suggestion 20', exact: true });
    await last.focus();
    await page.keyboard.press('ArrowDown');
    await expect(first).toBeFocused();
    const bounds = (await suggestionsScroll.getByRole('scrollbar').boundingBox())!;
    await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height * 0.8);
    await expect(first).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(page.getByRole('button', { name: 'Suggestion 2', exact: true })).toBeFocused();
    await suggestionsScroll.evaluate((element) => {
      element.scrollTop = 100;
    });
    await expectFloatingNavHeader(suggestions);
    await page.screenshot({ path: testInfo.outputPath('autocomplete.png'), scale: 'css' });
    await page.keyboard.press('Escape');
    await expect(suggestions).toBeHidden();
  });
}
