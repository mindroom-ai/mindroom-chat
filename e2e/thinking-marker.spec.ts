import { expect, test, type Page } from '@playwright/test';

async function sample(page: Page, time: number) {
  return page.evaluate((currentTime) => {
    document.getAnimations().forEach((animation) => {
      animation.pause();
      animation.currentTime = currentTime;
    });
    const svg = document.querySelector('[role="status"] svg')!;
    const core = svg.querySelector('use[href$="-central-cube"]')!;
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
  await expect(status.locator('svg')).toHaveCount(1);
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
      const svg = statuses.nth(index).locator('svg');
      await expect(svg).toHaveCSS('width', `${size}px`);
      await expect(svg).toHaveCSS('height', `${size}px`);
      await expect(svg).toHaveAttribute('focusable', 'false');
    }
    expect(await page.getByRole('img').count()).toBe(0);
    await expect.poll(() => page.evaluate(() => document.getAnimations().length)).toBe(0);
    expect(await sample(page, 3990)).toEqual(await sample(page, 0));
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
    ).toBe(true);
  }
});

test('thinking marker paints its glass faces and gold core', async ({ page }) => {
  await page.goto('/e2e/fixtures/thinking-marker.html?dark');
  const markers = page.getByRole('status', { name: 'AI is responding' }).locator('svg');
  await expect(markers).toHaveCount(2);
  await sample(page, 0);

  for (const marker of await markers.all()) {
    const screenshot = await marker.screenshot();
    const paint = await page.evaluate(async (png) => {
      const image = new window.Image();
      image.src = 'data:image/png;base64,' + png;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, image.width, image.height);
      let glass = 0;
      let gold = 0;
      for (let index = 0; index < data.length; index += 4) {
        const [red, green, blue, alpha] = data.slice(index, index + 4);
        if (alpha > 128 && blue > red + 20 && green > red + 15) glass += 1;
        if (alpha > 128 && red > 100 && red > green * 1.08 && green > blue * 1.15) gold += 1;
      }
      return { glass, gold, area: image.width * image.height };
    }, screenshot.toString('base64'));
    expect(paint.glass, 'the blue glass faces must visibly paint').toBeGreaterThan(
      paint.area * 0.12
    );
    expect(paint.gold, 'the gold cube must visibly paint').toBeGreaterThan(paint.area * 0.02);
  }
});
