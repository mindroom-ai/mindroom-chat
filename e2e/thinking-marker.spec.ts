import { expect, test, type Page } from '@playwright/test';

async function sample(page: Page, time: number) {
  return page.evaluate((currentTime) => {
    document.getAnimations().forEach((animation) => {
      animation.pause();
      animation.currentTime = currentTime;
    });
    const svg = document.querySelector('[role="status"] svg')!;
    const core = document.querySelector('use[href$="#central-cube"]')!.parentElement!
      .parentElement!;
    const rotor = svg.parentElement!;
    const aura = rotor.previousElementSibling!;
    const styles = [rotor, core, aura].map((element) => {
      const style = getComputedStyle(element);
      return [style.transform, style.filter, style.opacity];
    });
    return { rotor: styles[0], core: styles[1], aura: styles[2] };
  }, time);
}

test('thinking marker plays the glowing core between the horizontal and vertical flips', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/thinking-marker.html');
  const status = page.getByRole('status', { name: 'AI is responding' }).first();
  await expect(status.locator('svg')).toHaveCount(2);
  for (const part of await status.locator('use').all()) {
    await expect
      .poll(() => part.evaluate((element) => (element as SVGGraphicsElement).getBBox().width))
      .toBeGreaterThan(0);
  }
  const initial = await sample(page, 0);
  for (const time of [720, 1350, 1800]) {
    const frame = await sample(page, time);
    expect(frame.rotor).not.toEqual(initial.rotor);
    expect(frame.core).toEqual(initial.core);
    expect(frame.aura).toEqual(initial.aura);
  }
  const settled = await sample(page, 2790);
  for (const time of [3270, 3990, 4470, 5010]) {
    const frame = await sample(page, time);
    expect(frame.rotor).toEqual(settled.rotor);
    expect(frame.core).not.toEqual(settled.core);
    expect(frame.aura).not.toEqual(settled.aura);
  }
  const coreSettled = await sample(page, 6570);
  for (const time of [7020, 7740, 8190]) {
    const frame = await sample(page, time);
    expect(frame.rotor).not.toEqual(coreSettled.rotor);
    expect(frame.core).toEqual(coreSettled.core);
    expect(frame.aura).toEqual(coreSettled.aura);
  }
  expect(await sample(page, 9000)).toEqual(initial);
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
    for (const [index, size] of [32, 28].entries()) {
      for (const svg of await statuses.nth(index).locator('svg').all()) {
        await expect(svg).toHaveCSS('width', `${size}px`);
        await expect(svg).toHaveCSS('height', `${size}px`);
        await expect(svg).toHaveAttribute('focusable', 'false');
      }
    }
    expect(await page.getByRole('img').count()).toBe(0);
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(await sample(page, 3990)).toEqual(await sample(page, 0));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  }
});

test('thinking motion does not continuously repaint the artwork or text', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'Paint tracing uses the Chromium protocol');
  await page.goto('/e2e/fixtures/thinking-marker.html');
  await expect(page.getByRole('status')).toHaveCount(2);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  const cdp = await page.context().newCDPSession(page);
  let paintCount = 0;
  cdp.on('Tracing.dataCollected', ({ value }) => {
    paintCount += value.filter(
      (event: { name: string; ph: string }) => event.name === 'Paint' && event.ph === 'X'
    ).length;
  });
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline',
    transferMode: 'ReportEvents',
  });
  // Cover a complete flip / glowing-core / flip cycle.
  await page.waitForTimeout(9500);
  const complete = new Promise<void>((resolve) => {
    cdp.once('Tracing.tracingComplete', resolve);
  });
  await cdp.send('Tracing.end');
  await complete;
  await cdp.detach();
  expect(paintCount).toBeLessThan(60);
});
