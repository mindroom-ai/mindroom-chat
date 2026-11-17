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
      // A selection unfolds the pressed tab's label and folds the last one's; the scroll steps
      // below measure the bar once that motion has ended.
      const settled = () =>
        expect
          .poll(() => frame.evaluate((element) => element.getAnimations({ subtree: true }).length))
          .toBe(0);
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
      await settled();
      // The now-visible active label remains reachable, including after reverse navigation.
      for (let index = 4; index > 0; index -= 1) await pressTab(page, true);
      await expect(tabs.first()).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true');
      await settled();
      await expect(
        tabs
          .first()
          .getByText(language === 'it' ? 'Serve il tuo intervento' : 'Needs you', { exact: true })
      ).toBeVisible();
      // Arrow steps return to the start (the pressed tab's icon makes it more than one step).
      await expect
        .poll(async () => {
          await page.keyboard.press('ArrowLeft');
          return frame.evaluate((element) => element.scrollLeft);
        })
        .toBe(0);
      await page.screenshot({
        path: testInfo.outputPath(`impl2-overflow-${width}-${language}.png`),
      });
    });
  }
}

const workflowDescriptions = [
  ['needsYou', 'Needs you', 'Background approval needed, or nothing running or scheduled.'],
  ['working', 'Working', 'An agent is replying, or a subagent or background tool is running.'],
  ['later', 'Later', 'Snoozed, or waiting for a scheduled task.'],
  ['done', 'Done', 'Resolved threads.'],
  ['all', 'All', 'Every thread matching your other filters.'],
] as const;

for (const interaction of ['hover', 'keyboard focus'] as const) {
  test(`workflow descriptions appear on ${interaction} outside the scrollport`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 500 });
    await page.addInitScript(() => {
      localStorage.setItem('settings', JSON.stringify({ simpleThreadFilters: false }));
    });
    await page.goto('/e2e/fixtures/thread-workflow-tabs.html?lang=en');
    const tabs = page.locator('[data-thread-tab]');
    await expect(tabs).toHaveCount(5);
    if (interaction === 'keyboard focus') {
      // Enter through keyboard navigation, not a synthetic focus event.
      await tabs.nth(1).focus();
      await pressTab(page, true);
    }
    for (const [index, [key, label, description]] of workflowDescriptions.entries()) {
      const tab = page.locator(`[data-thread-tab="${key}"]`);
      if (interaction === 'hover') await tab.hover();
      else await expect(tab).toBeFocused();
      const tooltip = page.getByRole('tooltip').filter({ hasText: description });
      await expect(tooltip).toBeVisible({ timeout: 5000 });
      await expect(tooltip).toHaveText(description);
      await expect(tab).toHaveAttribute('aria-label', `${label} ${key === 'all' ? '3996' : '999'}`);
      await expect(tab).toContainText(key === 'all' ? '3996' : '999');
      await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true');
      // The real provider portals the tooltip out of the overflow-clipped tabs.
      await expect(tab.locator('..').getByRole('tooltip')).toHaveCount(0);
      const box = (await tooltip.boundingBox())!;
      const frame = (await tab.locator('..').boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(frame.y + frame.height);
      expect(
        await tooltip.evaluate((element) => element.closest('[data-room-thread-overview]'))
      ).toBeNull();
      if (index === 0 && interaction === 'hover') {
        await page.screenshot({ path: testInfo.outputPath('impl3-tooltip.png') });
      }
      if (interaction === 'hover') await page.mouse.move(380, 450);
      else await pressTab(page);
      await expect(tooltip).not.toBeVisible();
    }
  });
}
