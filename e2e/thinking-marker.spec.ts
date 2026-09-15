import { expect, test, type Page } from '@playwright/test';

async function sample(page: Page, time: number) {
  return page.evaluate((currentTime) => {
    document.getAnimations().forEach((animation) => {
      animation.pause();
      animation.currentTime = currentTime;
    });
    const svg = document.querySelector('[role="status"] svg')!;
    const core = svg.querySelector('use[href$="#central-cube"]')!;
    const rotor = svg.parentElement!;
    const aura = rotor.previousElementSibling!;
    const styles = [rotor, core, aura].map((element) => {
      const style = getComputedStyle(element);
      return [style.transform, style.filter, style.opacity];
    });
    return { rotor: styles[0], core: styles[1], aura: styles[2] };
  }, time);
}

test('thinking marker plays the whole-M flips before the glowing core', async ({ page }) => {
  await page.goto('/e2e/fixtures/thinking-marker.html');
  const status = page.getByRole('status', { name: 'AI is responding' }).first();
  await expect(status.locator('svg')).toHaveCount(1);
  for (const part of await status.locator('use').all()) {
    await expect
      .poll(() => part.evaluate((element) => (element as SVGGraphicsElement).getBBox().width))
      .toBeGreaterThan(0);
  }
  const initial = await sample(page, 0);
  for (const time of [1350, 1980, 2430, 5760, 6480, 6930]) {
    const frame = await sample(page, time);
    expect(frame.rotor).not.toEqual(initial.rotor);
    expect(frame.core).toEqual(initial.core);
    expect(frame.aura).toEqual(initial.aura);
  }
  const settled = await sample(page, 9000);
  for (const time of [10320, 11040, 11520, 12060]) {
    const frame = await sample(page, time);
    expect(frame.rotor).toEqual(settled.rotor);
    expect(frame.core).not.toEqual(settled.core);
    expect(frame.aura).not.toEqual(settled.aura);
  }
  expect(await sample(page, 15000)).toEqual(initial);
});

test('thinking marker fits chat text and honors reduced motion in both themes', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['', '?dark']) {
    await page.goto(`/e2e/fixtures/thinking-marker.html${theme}`);
    const statuses = page.getByRole('status', { name: 'AI is responding' });
    await expect(statuses).toHaveCount(2);
    for (const [index, size] of [24, 21].entries()) {
      const svg = statuses.nth(index).locator('svg');
      await expect(svg).toHaveCSS('width', `${size}px`);
      await expect(svg).toHaveCSS('height', `${size}px`);
      await expect(svg).toHaveAttribute('focusable', 'false');
    }
    expect(await page.getByRole('img').count()).toBe(0);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(await sample(page, 11040)).toEqual(await sample(page, 0));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true
    );
  }
});
