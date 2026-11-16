/* eslint-disable no-await-in-loop */
// Keyboard focus and scrolling must be checked in sequence.
import { writeFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { pressTab } from '../helpers/keyboard';

// Italian's active label is longer than English's "Needs you".
test.use({ video: 'off', trace: 'off' });
for (const width of [320, 390]) {
  for (const language of ['en', 'it']) {
    test(`large workflow buckets remain reachable at ${width}px in ${language}`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await page.addInitScript(() => {
        localStorage.setItem('settings', JSON.stringify({ simpleThreadFilters: false }));
      });
      await page.goto(`/e2e/fixtures/thread-workflow-tabs.html?lang=${language}`);
      const tabs = page.locator('[data-thread-tab]');
      await expect(tabs).toHaveCount(5);
      await page.evaluate(() => document.fonts.ready);
      const frame = tabs.first().locator('..');
      const metrics = await frame.evaluate((element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          height: box.height,
          width: box.width,
          x: box.x,
          right: box.right,
          lastTabRight: element.lastElementChild!.getBoundingClientRect().right,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          overflowX: style.overflowX,
          pageWidth: document.documentElement.clientWidth,
          pageScrollWidth: document.documentElement.scrollWidth,
        };
      });
      await writeFile(
        testInfo.outputPath(`metrics-overflow-${width}-${language}.json`),
        JSON.stringify(metrics, null, 2)
      );
      const overflowing = metrics.scrollWidth > metrics.clientWidth;
      if (width === 320 || language === 'it') expect(overflowing).toBe(true);
      expect(metrics.overflowX).toBe('auto');
      expect(metrics.height).toBe(32);
      expect(metrics.x + metrics.width).toBeLessThanOrEqual(width);
      expect(metrics.pageScrollWidth).toBe(metrics.pageWidth);
      await tabs.first().focus();
      // Tab reaches every button; native arrow scrolling can reveal a partly visible edge.
      for (let index = 0; index < 5; index += 1) {
        const tab = tabs.nth(index);
        await expect(tab).toBeFocused();
        await expect(tab).toHaveAttribute('aria-label', /\S/);
        const bounds = (await tab.boundingBox())!;
        const outer = (await frame.boundingBox())!;
        if (bounds.x + bounds.width > outer.x + outer.width + 1) {
          // Native focus may leave an edge visible; arrow steps reveal the complete button.
          for (let step = 0; step < 4; step += 1) await page.keyboard.press('ArrowRight');
        }
        await expect
          .poll(
            async () => {
              const bounds = (await tab.boundingBox())!;
              const outer = (await frame.boundingBox())!;
              return Math.max(outer.x - bounds.x, bounds.x + bounds.width - outer.x - outer.width);
            },
            { message: `focused tab ${index} stays inside the scrollport` }
          )
          .toBeLessThanOrEqual(1);
        if (index < 4) await pressTab(page);
      }
      if (overflowing) {
        expect(await frame.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      }
      await page.keyboard.press('Enter');
      await expect(tabs.last()).toHaveAttribute('aria-pressed', 'true');
      // The now-visible active label remains reachable, including after reverse navigation.
      for (let index = 4; index > 0; index -= 1) await pressTab(page, true);
      await expect(tabs.first()).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true');
      await expect(
        tabs
          .first()
          .getByText(language === 'it' ? 'Serve il tuo intervento' : 'Needs you', { exact: true })
      ).toBeVisible();
      await page.keyboard.press('ArrowLeft');
      await expect(frame).toHaveJSProperty('scrollLeft', 0);
      await page.screenshot({
        path: testInfo.outputPath(`impl2-overflow-${width}-${language}.png`),
      });
    });
  }
}
