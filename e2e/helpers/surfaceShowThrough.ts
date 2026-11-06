import type { Locator, Page } from '@playwright/test';
import { contrastRatio, sampleScreenshot, type Rgba } from './glassVisual';

/**
 * How much of the page shows through a glass surface. With everything inside `surface` hidden,
 * the screen is sampled every 6 px over `area` (the surface itself by default, 12 px in from its
 * edges): `spread` is how much the samples' brightness varies (0 to 255; a plain fill is 0), and
 * `contrast` the lowest contrast `text` (its color at its opacity) has against any of them.
 * `alpha` is the surface's own background alpha.
 */
export const surfaceShowThrough = async (
  page: Page,
  surface: Locator,
  text: Locator,
  area: Locator = surface
) => {
  const color = await text.evaluate((element): Rgba => {
    const style = getComputedStyle(element);
    const numbers = style.color.match(/[\d.]+/g)!.map(Number);
    let opacity = 1;
    for (let node: Element | null = element; node; node = node.parentElement) {
      opacity *= Number(getComputedStyle(node).opacity);
    }
    return [numbers[0]!, numbers[1]!, numbers[2]!, opacity];
  });
  const alpha = await surface.evaluate((element) => {
    const background = getComputedStyle(element).backgroundColor;
    const numbers = background.match(/[\d.]+/g)!.map(Number);
    if (background.includes('/')) return numbers[numbers.length - 1]!;
    return background.startsWith('rgba') ? numbers[3]! : 1;
  });
  const box = (await area.boundingBox())!;
  await surface.evaluate((element) => element.setAttribute('data-surface-probe', ''));
  const hide = await page.addStyleTag({
    content: '[data-surface-probe] * { visibility: hidden !important; }',
  });
  let pixels: Rgba[];
  try {
    const points: Array<{ x: number; y: number }> = [];
    for (let y = box.y + 12; y < box.y + box.height - 12; y += 6) {
      for (let x = box.x + 12; x < box.x + box.width - 12; x += 6) points.push({ x, y });
    }
    pixels = await sampleScreenshot(page, points);
  } finally {
    await hide.evaluate((element) => (element as HTMLStyleElement).remove());
    await surface.evaluate((element) => element.removeAttribute('data-surface-probe'));
  }
  const brightness = pixels.map(([red, green, blue]) => (red + green + blue) / 3);
  return {
    alpha,
    spread: Math.round(Math.max(...brightness) - Math.min(...brightness)),
    contrast:
      Math.round(Math.min(...pixels.map((pixel) => contrastRatio(color, pixel))) * 100) / 100,
  };
};
