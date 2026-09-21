import { expect, test, type Locator } from '@playwright/test';
import { pixelDifference, sampleScreenshot } from './helpers/glassVisual';

const highlight = (surface: Locator) =>
  surface.evaluate((element) => ({
    x: (element as HTMLElement).style.getPropertyValue('--liquid-glass-light-x'),
    background: getComputedStyle(element).backgroundImage,
  }));

for (const theme of ['light', 'dark']) {
  test(`collapsed tool and approval headers visibly track the pointer in ${theme}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 1100 });
    await page.goto(`/e2e/fixtures/glass-surfaces.html?messages&theme=${theme}`);
    await page.evaluate(() => document.fonts.ready);
    for (const id of ['tool', 'history']) {
      const surface = page.getByTestId(id).locator(':scope > *').first();
      await surface.hover({ position: { x: 250, y: 18 } });
      await expect.poll(async () => (await highlight(surface)).x).not.toBe('');
      const bounds = (await surface.boundingBox())!;
      const points = [{ x: bounds.x + 250, y: bounds.y + 18 }];
      const [near] = await sampleScreenshot(page, points);
      const first = await highlight(surface);
      await surface.hover({ position: { x: 450, y: 18 } });
      await expect.poll(async () => (await highlight(surface)).x).not.toBe(first.x);
      const [far] = await sampleScreenshot(page, points);
      expect(pixelDifference(near, far)).toBeGreaterThan(0);
    }
  });

  for (const fixture of ['messages', 'controls']) {
    test(`${fixture} cards follow the pointer and respect motion preferences in ${theme}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 800, height: 1800 });
      await page.goto(`/e2e/fixtures/glass-surfaces.html?${fixture}&theme=${theme}`);
      await page.evaluate(() => document.fonts.ready);
      const ids =
        fixture === 'messages'
          ? ['summary', 'tool', 'history', 'approval', 'receipt', 'approval-group']
          : ['attachment', 'paste', 'link'];
      for (const id of ids) {
        const host = page.getByTestId(id);
        const surface = id === 'link' ? host : host.locator(':scope > *').first();
        await surface.hover({ position: { x: 12, y: 12 } });
        await expect.poll(async () => (await highlight(surface)).x).not.toBe('');
        const first = await highlight(surface);
        await surface.hover({ position: { x: 120, y: 18 } });
        await expect
          .poll(async () => (await highlight(surface)).background)
          .not.toBe(first.background);
        await expect(surface).not.toHaveAttribute('data-liquid-glass', 'active');
        await page.mouse.move(0, 0);
        await expect.poll(async () => (await highlight(surface)).x).toBe('');
        await page.emulateMedia({ reducedMotion: 'reduce' });
        await surface.hover({ position: { x: 120, y: 18 } });
        await expect.poll(async () => (await highlight(surface)).x).toBe('');
        await page.emulateMedia({ reducedMotion: 'no-preference', contrast: 'more' });
        await surface.hover({ position: { x: 12, y: 12 } });
        await expect(surface).toHaveCSS('background-image', 'none');
        await page.emulateMedia({ contrast: 'no-preference' });
      }
      if (fixture === 'messages') {
        const history = page.getByTestId('history').locator('details').first();
        await history.locator(':scope > summary').click();
        const nested = history.locator('details[aria-label="Resolved tool approval request"]');
        await nested.hover({ position: { x: 120, y: 18 } });
        await expect.poll(async () => (await highlight(history)).x).not.toBe('');
        expect((await highlight(nested)).x).toBe('');
        await expect(nested).toHaveCSS('background-image', 'none');
        await expect(nested).toHaveCSS('backdrop-filter', 'none');
      }
    });
  }
}
