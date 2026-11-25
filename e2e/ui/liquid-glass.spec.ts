import { expect, test } from '@playwright/test';
import { pixelDifference, sampleScreenshot } from '../helpers/glassVisual';

// The effect is drawn only on a GPU; headless runners have none, so the page is told it has one.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function getContextOnGpu(
      this: HTMLCanvasElement,
      type: string,
      ...rest: unknown[]
    ) {
      if (type !== 'webgl') {
        return getContext.apply(this, [type, ...rest] as Parameters<typeof getContext>);
      }
      return {
        getExtension: (name: string) =>
          name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL: 37446 } : null,
        getParameter: () => 'Test GPU',
      };
    } as typeof getContext;
  });
});

test('bends the backdrop at the curved rim while keeping the center steady', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 400 });
  await page.goto('/e2e/fixtures/liquid-glass.html?optics');
  const lens = page.getByTestId('optical-lens');
  await expect(lens).toHaveAttribute('data-liquid-glass', 'active');
  const edge = Array.from({ length: 15 }, (_, index) => ({ x: 102 + index, y: 180 }));
  const center = Array.from({ length: 48 }, (_, index) => ({ x: 230 + index, y: 180 }));
  const bent = await sampleScreenshot(page, [...edge, ...center]);
  await lens.evaluate((element) => {
    element.style.backdropFilter = 'blur(3px)';
  });
  const flat = await sampleScreenshot(page, [...edge, ...center]);
  const deltas = bent.map((pixel, index) => pixelDifference(pixel, flat[index]!));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  expect(mean(deltas.slice(0, edge.length)), 'visible lens bending at the rim').toBeGreaterThan(60);
  expect(mean(deltas.slice(edge.length)), 'neutral glass center').toBeLessThan(30);
});

test('tracks light without rebuilding the filter and releases it for accessibility', async ({
  page,
}) => {
  await page.goto('/e2e/fixtures/liquid-glass.html');
  const menu = page.getByTestId('showcase-menu');
  // Font loading can resize the menu and legitimately replace its filter.
  // Let that layout and its ResizeObserver update settle before testing pointer motion.
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  await expect(menu).toHaveAttribute('data-liquid-glass', 'active');
  const filter = await menu.evaluate((element) =>
    element.style.getPropertyValue('--liquid-glass-filter')
  );
  await menu.hover({ position: { x: 40, y: 30 } });
  await expect
    .poll(() =>
      menu.evaluate((element) => element.style.getPropertyValue('--liquid-glass-light-x'))
    )
    .not.toBe('');
  const first = await menu.evaluate((element) =>
    element.style.getPropertyValue('--liquid-glass-light-x')
  );
  await menu.hover({ position: { x: 220, y: 130 } });
  await expect
    .poll(() =>
      menu.evaluate((element) => element.style.getPropertyValue('--liquid-glass-light-x'))
    )
    .not.toBe(first);
  expect(
    await menu.evaluate((element) => element.style.getPropertyValue('--liquid-glass-filter'))
  ).toBe(filter);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      menu.evaluate((element) => element.style.getPropertyValue('--liquid-glass-light-x'))
    )
    .toBe('');
  await page.emulateMedia({ contrast: 'more' });
  await expect(menu).not.toHaveAttribute('data-liquid-glass', 'active');
  await expect(menu).toHaveCSS('backdrop-filter', 'none');
  await expect(page.locator('[data-liquid-glass-defs]')).toHaveCount(0);
  await page.emulateMedia({ contrast: 'no-preference' });
  await expect(menu).toHaveAttribute('data-liquid-glass', 'active');
});

test('lights the rim near the pointer without a resting interior glow', async ({ page }) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto('/e2e/fixtures/liquid-glass.html?theme=dark');
  const menu = page.getByTestId('showcase-menu');
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  });
  await expect(menu).toHaveCSS('background-image', 'none');
  await page.mouse.move(0, 0);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  const box = (await menu.boundingBox())!;
  const points = [
    { x: box.x + box.width / 2, y: Math.floor(box.y) },
    { x: box.x + box.width / 2, y: Math.floor(box.y) + 1 },
    { x: box.x + box.width / 2, y: Math.floor(box.y) + 12 },
  ];
  const resting = await sampleScreenshot(page, points);

  await menu.hover({ position: { x: Math.round(box.width / 2), y: 6 } });
  await expect
    .poll(() =>
      menu.evaluate((element) => element.style.getPropertyValue('--liquid-glass-light-x'))
    )
    .not.toBe('');
  await expect(menu).toHaveCSS('background-image', 'none');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      )
  );
  const hovered = await sampleScreenshot(page, points);
  const rimDelta =
    pixelDifference(hovered[0]!, resting[0]!) + pixelDifference(hovered[1]!, resting[1]!);
  const interiorDelta = pixelDifference(hovered[2]!, resting[2]!);
  expect(rimDelta, 'pointer hover brightens the rim near the cursor').toBeGreaterThan(40);
  expect(interiorDelta, 'interior glass stays unclouded').toBeLessThan(10);
  expect(rimDelta, 'rim catches more pointer light than the interior').toBeGreaterThan(
    interiorDelta + 30
  );
});

test('keeps glass buttons at scale none on hover and active under reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 900, height: 600 });
  await page.goto('/e2e/fixtures/liquid-glass.html');
  const button = page.getByTestId('showcase-button');
  await expect(button).toBeVisible();

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await button.hover();
  expect(await button.evaluate((element) => element.matches(':hover'))).toBe(true);
  await expect(button).toHaveCSS('scale', 'none');
  await page.mouse.down();
  expect(await button.evaluate((element) => element.matches(':active'))).toBe(true);
  await expect(button).toHaveCSS('scale', 'none');
  await page.mouse.up();

  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await button.hover();
  await expect(button).not.toHaveCSS('scale', 'none');
});

test('matches asymmetric corner radii in the optical displacement map', async ({ page }) => {
  await page.setViewportSize({ width: 600, height: 400 });
  await page.goto('/e2e/fixtures/liquid-glass.html?optics=sheet');
  const lens = page.getByTestId('optical-lens');
  await expect(lens).toHaveAttribute('data-liquid-glass', 'active');
  await expect(page.locator('feGaussianBlur[edgeMode="duplicate"]')).toHaveCount(1);
  await expect(page.locator('feDisplacementMap')).toHaveCount(1);
  await expect(page.locator('feColorMatrix')).toHaveCount(0);
  await expect(page.locator('feBlend')).toHaveCount(0);

  const topRounded: Array<{ x: number; y: number }> = [];
  for (let x = 108; x <= 113; x += 1) {
    for (let y = 88; y <= 92; y += 1) {
      if (Math.hypot(124 - x, 104 - y) <= 22.5) topRounded.push({ x, y });
    }
  }
  const botSquare: Array<{ x: number; y: number }> = [];
  for (let x = 101; x <= 106; x += 1) {
    for (let y = 293; y <= 298; y += 1) botSquare.push({ x, y });
  }
  const botInnerMirror: Array<{ x: number; y: number }> = [];
  for (let x = 108; x <= 113; x += 1) {
    for (let y = 287; y <= 291; y += 1) {
      if (Math.hypot(124 - x, y - 275) <= 22.5) botInnerMirror.push({ x, y });
    }
  }

  const allPoints = [...topRounded, ...botSquare, ...botInnerMirror];
  const bent = await sampleScreenshot(page, allPoints);
  await lens.evaluate((element) => {
    element.style.backdropFilter = 'blur(3px)';
  });
  const flat = await sampleScreenshot(page, allPoints);
  const deltas = bent.map((pixel, index) => pixelDifference(pixel, flat[index]!));
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const roundedEnd = topRounded.length;
  const squareEnd = roundedEnd + botSquare.length;
  expect(mean(deltas.slice(0, roundedEnd)), 'rounded top corner bends').toBeGreaterThan(30);
  expect(
    mean(deltas.slice(roundedEnd, squareEnd)),
    'square bottom corner bends to edge'
  ).toBeGreaterThan(40);
  expect(
    mean(deltas.slice(squareEnd)),
    'square corner interior does not curve like a rounded arc'
  ).toBeLessThan(25);
});
